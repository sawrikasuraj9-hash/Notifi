package com.yashihalls.pay;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public final class PayConfigStore {
    private static final String PREFS = "yashi_halls_pay_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_SECRET = "secret_key";
    private static final String KEY_BOT_LINKED = "bot_linked";
    private static final String KEY_DEVICE_NAME = "device_name";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_SERVICE_ACTIVE = "service_active";
    private static final String KEY_STORE_NAME = "store_name";
    private static final String KEY_RULES = "capture_rules_json";
    private static final String KEY_PAYMENTS = "caught_payments_json";
    private static final String KEY_THEME = "ui_theme";
    private static final String KEY_PALETTE = "ui_palette";
    private static final String KEY_AUTOLOCK = "ui_autolock";
    private static final String KEY_LANGUAGE = "ui_language";
    private static final String KEY_HIDE_BALANCE = "hide_today_balance";
    private static final String KEY_LOGS = "event_logs";

    public static final String ACTION_LOG_UPDATED = "com.yashihalls.pay.LOG_UPDATED";
    public static final String ACTION_PAYMENTS_UPDATED = "com.yashihalls.pay.PAYMENTS_UPDATED";

    private static final long SEVEN_DAYS_MS = 7L * 24L * 60L * 60L * 1000L;

    public static final class RuleItem {
        public String id;
        public String name;
        public String source; // "sms", "notification", "both"
        public String senderFilter;
        public String keyword;
        public boolean enabled;

        public RuleItem(String id, String name, String source, String senderFilter, String keyword, boolean enabled) {
            this.id = id;
            this.name = name;
            this.source = source;
            this.senderFilter = senderFilter;
            this.keyword = keyword;
            this.enabled = enabled;
        }
    }

    public static final class PaymentRecord {
        public String id;
        public String ruleName;
        public String source;
        public String bank;
        public String sender;
        public String appPackage;
        public double amountLkr;
        public String rawMessage;
        public String status; // "sending", "sent", "failed"
        public String matchedOrderId;
        public long timestampMs;
    }

    public static final class ParsedLinkKey {
        public final String serverUrl;
        public final String secretKey;
        public ParsedLinkKey(String serverUrl, String secretKey) {
            this.serverUrl = serverUrl;
            this.secretKey = secretKey;
        }
    }

    private PayConfigStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String getServerUrl(Context ctx) {
        return prefs(ctx).getString(KEY_SERVER_URL, "").trim();
    }

    public static void setServerUrl(Context ctx, String url) {
        String clean = url == null ? "" : url.trim();
        while (clean.endsWith("/")) {
            clean = clean.substring(0, clean.length() - 1);
        }
        prefs(ctx).edit().putString(KEY_SERVER_URL, clean).apply();
    }

    public static String getSecretKey(Context ctx) {
        return prefs(ctx).getString(KEY_SECRET, "").trim();
    }

    public static void setSecretKey(Context ctx, String secret) {
        prefs(ctx).edit().putString(KEY_SECRET, secret == null ? "" : secret.trim()).apply();
    }

    public static boolean isBotLinked(Context ctx) {
        return prefs(ctx).getBoolean(KEY_BOT_LINKED, false)
                && !getSecretKey(ctx).isEmpty()
                && !getServerUrl(ctx).isEmpty();
    }

    public static void setBotLinked(Context ctx, boolean linked) {
        prefs(ctx).edit().putBoolean(KEY_BOT_LINKED, linked).apply();
    }

    public static ParsedLinkKey parseBotLinkKey(String rawInput, String fallbackUrl) {
        String raw = rawInput == null ? "" : rawInput.trim();
        if (raw.isEmpty()) return null;

        if (raw.startsWith("YHP.") || raw.startsWith("YHP_")) {
            try {
                String encoded = raw.substring(4).trim();
                int flags = Base64.URL_SAFE | Base64.NO_WRAP;
                byte[] decodedBytes = Base64.decode(encoded, flags);
                String jsonStr = new String(decodedBytes, StandardCharsets.UTF_8);
                JSONObject obj = new JSONObject(jsonStr);
                String u = obj.optString("u", fallbackUrl).trim();
                String k = obj.optString("k", "").trim();
                while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
                if (!k.isEmpty()) {
                    return new ParsedLinkKey(u, k);
                }
            } catch (Throwable ignored) {}
        }

        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            return null;
        }

        String fb = fallbackUrl == null ? "" : fallbackUrl.trim();
        while (fb.endsWith("/")) fb = fb.substring(0, fb.length() - 1);
        if (raw.length() >= 8) {
            return new ParsedLinkKey(fb, raw);
        }
        return null;
    }

    public static String getDeviceName(Context ctx) {
        String saved = prefs(ctx).getString(KEY_DEVICE_NAME, "").trim();
        if (!saved.isEmpty()) return saved;
        String fallback = (Build.MANUFACTURER + " " + Build.MODEL).trim();
        return fallback.isEmpty() ? "Android Device" : fallback;
    }

    public static void setDeviceName(Context ctx, String name) {
        prefs(ctx).edit().putString(KEY_DEVICE_NAME, name == null ? "" : name.trim()).apply();
    }

    public static String getDeviceId(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String id = p.getString(KEY_DEVICE_ID, "");
        if (id == null || id.isEmpty()) {
            String androidId = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
            id = (androidId != null && !androidId.isEmpty())
                    ? "yh-" + androidId
                    : "yh-" + UUID.randomUUID().toString().substring(0, 12);
            p.edit().putString(KEY_DEVICE_ID, id).apply();
        }
        return id;
    }

    public static boolean isServiceActive(Context ctx) {
        return prefs(ctx).getBoolean(KEY_SERVICE_ACTIVE, false);
    }

    public static void setServiceActive(Context ctx, boolean active) {
        prefs(ctx).edit().putBoolean(KEY_SERVICE_ACTIVE, active).apply();
    }

    public static String getStoreName(Context ctx) {
        return prefs(ctx).getString(KEY_STORE_NAME, "YASHI BUSINESS STORE");
    }

    public static void setStoreName(Context ctx, String name) {
        if (name != null && !name.trim().isEmpty()) {
            prefs(ctx).edit().putString(KEY_STORE_NAME, name.trim()).apply();
        }
    }

    // Theme / Palette / AutoLock / Language
    public static String getTheme(Context ctx) {
        return prefs(ctx).getString(KEY_THEME, "dark");
    }

    public static void setTheme(Context ctx, String theme) {
        prefs(ctx).edit().putString(KEY_THEME, theme).apply();
    }

    public static String getPalette(Context ctx) {
        return prefs(ctx).getString(KEY_PALETTE, "obsidian");
    }

    public static void setPalette(Context ctx, String palette) {
        prefs(ctx).edit().putString(KEY_PALETTE, palette).apply();
    }

    public static String getAutoLock(Context ctx) {
        return prefs(ctx).getString(KEY_AUTOLOCK, "1min");
    }

    public static void setAutoLock(Context ctx, String autoLock) {
        prefs(ctx).edit().putString(KEY_AUTOLOCK, autoLock).apply();
    }

    public static String getLanguage(Context ctx) {
        return prefs(ctx).getString(KEY_LANGUAGE, "en");
    }

    public static void setLanguage(Context ctx, String lang) {
        prefs(ctx).edit().putString(KEY_LANGUAGE, lang).apply();
    }

    public static boolean isHideBalance(Context ctx) {
        return prefs(ctx).getBoolean(KEY_HIDE_BALANCE, false);
    }

    public static void setHideBalance(Context ctx, boolean hide) {
        prefs(ctx).edit().putBoolean(KEY_HIDE_BALANCE, hide).apply();
    }

    public static int getBatteryLevel(Context ctx) {
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent status = ctx.registerReceiver(null, filter);
            if (status == null) return -1;
            int level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) {
                return Math.round((level * 100f) / scale);
            }
        } catch (Throwable ignored) {}
        return -1;
    }

    public static String getSimOperator(Context ctx) {
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null && tm.getNetworkOperatorName() != null) {
                return tm.getNetworkOperatorName().trim();
            }
        } catch (Throwable ignored) {}
        return "";
    }

    // --- RULES ENGINE ---
    public static synchronized List<RuleItem> getRules(Context ctx) {
        List<RuleItem> out = new ArrayList<>();
        try {
            String raw = prefs(ctx).getString(KEY_RULES, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                out.add(new RuleItem(
                        o.optString("id", UUID.randomUUID().toString()),
                        o.optString("name", "Rule"),
                        o.optString("source", "both"),
                        o.optString("senderFilter", ""),
                        o.optString("keyword", ""),
                        o.optBoolean("enabled", true)
                ));
            }
        } catch (Throwable ignored) {}
        return out;
    }

    public static synchronized void saveRules(Context ctx, List<RuleItem> rules) {
        JSONArray arr = new JSONArray();
        for (RuleItem r : rules) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", r.id);
                o.put("name", r.name);
                o.put("source", r.source);
                o.put("senderFilter", r.senderFilter);
                o.put("keyword", r.keyword);
                o.put("enabled", r.enabled);
                arr.put(o);
            } catch (Throwable ignored) {}
        }
        prefs(ctx).edit().putString(KEY_RULES, arr.toString()).apply();
    }

    public static synchronized void addRule(Context ctx, RuleItem rule) {
        List<RuleItem> list = getRules(ctx);
        for (RuleItem existing : list) {
            if (existing.name.equalsIgnoreCase(rule.name)
                    && existing.source.equalsIgnoreCase(rule.source)
                    && existing.senderFilter.equalsIgnoreCase(rule.senderFilter)
                    && existing.keyword.equalsIgnoreCase(rule.keyword)) {
                return;
            }
        }
        list.add(0, rule);
        saveRules(ctx, list);
    }

    public static synchronized boolean hasRuleWithName(Context ctx, String name) {
        List<RuleItem> list = getRules(ctx);
        for (RuleItem r : list) {
            if (r.name.equalsIgnoreCase(name)) return true;
        }
        return false;
    }

    public static synchronized void toggleRule(Context ctx, String id) {
        List<RuleItem> list = getRules(ctx);
        for (RuleItem r : list) {
            if (r.id.equals(id)) {
                r.enabled = !r.enabled;
                break;
            }
        }
        saveRules(ctx, list);
    }

    public static synchronized void deleteRule(Context ctx, String id) {
        List<RuleItem> list = getRules(ctx);
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).id.equals(id)) {
                list.remove(i);
                break;
            }
        }
        saveRules(ctx, list);
    }

    public static RuleItem matchRule(Context ctx, String source, String senderOrTitle, String appPackage, String body) {
        String combined = ((senderOrTitle == null ? "" : senderOrTitle) + " "
                + (appPackage == null ? "" : appPackage) + " "
                + (body == null ? "" : body)).toLowerCase(Locale.US);

        if (combined.trim().length() < 6) return null;
        if (combined.contains("otp") || combined.contains("one time password")
                || combined.contains("verification code") || combined.contains("pin is")) {
            return null;
        }

        String senderLower = ((senderOrTitle == null ? "" : senderOrTitle) + " "
                + (appPackage == null ? "" : appPackage)).toLowerCase(Locale.US);
        String bodyLower = (body == null ? "" : body).toLowerCase(Locale.US);

        List<RuleItem> rules = getRules(ctx);
        for (RuleItem r : rules) {
            if (!r.enabled) continue;
            if (!"both".equalsIgnoreCase(r.source) && !r.source.equalsIgnoreCase(source)) {
                continue;
            }
            String sf = r.senderFilter == null ? "" : r.senderFilter.trim().toLowerCase(Locale.US);
            if (!sf.isEmpty() && !senderLower.contains(sf) && !combined.contains(sf)) {
                continue;
            }
            String kw = r.keyword == null ? "" : r.keyword.trim().toLowerCase(Locale.US);
            if (!kw.isEmpty() && !bodyLower.contains(kw) && !combined.contains(kw)) {
                continue;
            }
            return r;
        }
        return null;
    }

    public static double extractAmountLkr(String text) {
        if (text == null) return 0;
        Pattern p = Pattern.compile("(?:LKR|Rs\\.?|රු\\.?)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(text);
        if (m.find()) {
            try {
                String numStr = m.group(1).replace(",", "");
                return Double.parseDouble(numStr);
            } catch (Throwable ignored) {}
        }
        return 0;
    }

    // --- PAYMENTS LEDGER (Auto-clears SENT items > 7 days) ---
    public static synchronized List<PaymentRecord> getPayments(Context ctx) {
        List<PaymentRecord> out = new ArrayList<>();
        long cutoff = System.currentTimeMillis() - SEVEN_DAYS_MS;
        boolean pruned = false;
        try {
            String raw = prefs(ctx).getString(KEY_PAYMENTS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                PaymentRecord rec = new PaymentRecord();
                rec.id = o.optString("id", UUID.randomUUID().toString());
                rec.ruleName = o.optString("ruleName", "Rule");
                rec.source = o.optString("source", "sms");
                rec.bank = o.optString("bank", "Bank / Wallet");
                rec.sender = o.optString("sender", "");
                rec.appPackage = o.optString("appPackage", "");
                rec.amountLkr = o.optDouble("amountLkr", 0);
                rec.rawMessage = o.optString("rawMessage", "");
                rec.status = o.optString("status", "sent");
                rec.matchedOrderId = o.optString("matchedOrderId", "");
                rec.timestampMs = o.optLong("timestampMs", System.currentTimeMillis());

                if ("sent".equals(rec.status) && rec.timestampMs < cutoff) {
                    pruned = true;
                    continue;
                }
                out.add(rec);
            }
            if (pruned) {
                savePayments(ctx, out);
            }
        } catch (Throwable ignored) {}
        return out;
    }

    private static synchronized void savePayments(Context ctx, List<PaymentRecord> list) {
        JSONArray arr = new JSONArray();
        int limit = Math.min(list.size(), 100);
        for (int i = 0; i < limit; i++) {
            PaymentRecord rec = list.get(i);
            try {
                JSONObject o = new JSONObject();
                o.put("id", rec.id);
                o.put("ruleName", rec.ruleName);
                o.put("source", rec.source);
                o.put("bank", rec.bank);
                o.put("sender", rec.sender);
                o.put("appPackage", rec.appPackage);
                o.put("amountLkr", rec.amountLkr);
                o.put("rawMessage", rec.rawMessage);
                o.put("status", rec.status);
                o.put("matchedOrderId", rec.matchedOrderId);
                o.put("timestampMs", rec.timestampMs);
                arr.put(o);
            } catch (Throwable ignored) {}
        }
        prefs(ctx).edit().putString(KEY_PAYMENTS, arr.toString()).apply();
    }

    public static synchronized PaymentRecord addPendingPayment(
            Context ctx, String ruleName, String source, String sender, String appPackage, String rawMessage
    ) {
        PaymentRecord rec = new PaymentRecord();
        rec.id = "pay-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 4);
        rec.ruleName = ruleName == null || ruleName.isEmpty() ? "Matched Rule" : ruleName;
        rec.source = source;
        rec.bank = sender == null || sender.isEmpty() ? rec.ruleName : sender;
        rec.sender = sender == null ? "" : sender;
        rec.appPackage = appPackage == null ? "" : appPackage;
        rec.amountLkr = extractAmountLkr(rawMessage);
        rec.rawMessage = rawMessage == null ? "" : rawMessage;
        rec.status = "sending";
        rec.matchedOrderId = "";
        rec.timestampMs = System.currentTimeMillis();

        List<PaymentRecord> list = getPayments(ctx);
        list.add(0, rec);
        savePayments(ctx, list);
        notifyPaymentsUpdated(ctx);
        return rec;
    }

    public static synchronized void updatePaymentStatus(
            Context ctx, String id, String status, String bank, double amountLkr, String matchedOrderId
    ) {
        List<PaymentRecord> list = getPayments(ctx);
        for (PaymentRecord rec : list) {
            if (rec.id.equals(id)) {
                rec.status = status;
                if (bank != null && !bank.isEmpty()) rec.bank = bank;
                if (amountLkr > 0) rec.amountLkr = amountLkr;
                if (matchedOrderId != null && !"null".equalsIgnoreCase(matchedOrderId)) {
                    rec.matchedOrderId = matchedOrderId;
                }
                break;
            }
        }
        savePayments(ctx, list);
        notifyPaymentsUpdated(ctx);
    }

    public static double getTodayTotalLkr(Context ctx) {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        long startOfDay = cal.getTimeInMillis();

        double total = 0;
        for (PaymentRecord rec : getPayments(ctx)) {
            if (rec.timestampMs >= startOfDay && rec.amountLkr > 0) {
                total += rec.amountLkr;
            }
        }
        return total;
    }

    public static void notifyPaymentsUpdated(Context ctx) {
        Intent broadcast = new Intent(ACTION_PAYMENTS_UPDATED);
        broadcast.setPackage(ctx.getPackageName());
        ctx.sendBroadcast(broadcast);
    }

    // --- ENCRYPTED BACKUP & RESTORE (AES-256-GCM + PBKDF2WithHmacSHA256) ---
    public static String exportEncryptedBackup(Context ctx, String password) throws Exception {
        if (password == null || password.length() < 4) {
            throw new IllegalArgumentException("Password must be at least 4 characters.");
        }
        JSONObject payload = new JSONObject();
        payload.put("v", 2);
        payload.put("serverUrl", getServerUrl(ctx));
        payload.put("secretKey", getSecretKey(ctx));
        payload.put("storeName", getStoreName(ctx));
        payload.put("theme", getTheme(ctx));
        payload.put("palette", getPalette(ctx));
        payload.put("autoLock", getAutoLock(ctx));
        payload.put("language", getLanguage(ctx));
        payload.put("rules", new JSONArray(prefs(ctx).getString(KEY_RULES, "[]")));

        byte[] salt = new byte[16];
        byte[] iv = new byte[12];
        SecureRandom rng = new SecureRandom();
        rng.nextBytes(salt);
        rng.nextBytes(iv);

        SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 65536, 256);
        byte[] keyBytes = skf.generateSecret(spec).getEncoded();
        SecretKeySpec aesKey = new SecretKeySpec(keyBytes, "AES");

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, aesKey, new GCMParameterSpec(128, iv));
        byte[] encrypted = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        JSONObject wrapper = new JSONObject();
        wrapper.put("app", "YASHI_HALLS_PAY");
        wrapper.put("alg", "AES-256-GCM-PBKDF2");
        wrapper.put("salt", Base64.encodeToString(salt, Base64.NO_WRAP));
        wrapper.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        wrapper.put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));
        return wrapper.toString(2);
    }

    public static void importEncryptedBackup(Context ctx, String encryptedJson, String password) throws Exception {
        if (password == null || password.isEmpty()) {
            throw new IllegalArgumentException("Enter backup password.");
        }
        JSONObject wrapper = new JSONObject(encryptedJson);
        byte[] salt = Base64.decode(wrapper.getString("salt"), Base64.NO_WRAP);
        byte[] iv = Base64.decode(wrapper.getString("iv"), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(wrapper.getString("data"), Base64.NO_WRAP);

        SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 65536, 256);
        byte[] keyBytes = skf.generateSecret(spec).getEncoded();
        SecretKeySpec aesKey = new SecretKeySpec(keyBytes, "AES");

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, aesKey, new GCMParameterSpec(128, iv));
        byte[] plainBytes = cipher.doFinal(encrypted);
        JSONObject payload = new JSONObject(new String(plainBytes, StandardCharsets.UTF_8));

        String url = payload.optString("serverUrl", "");
        String secret = payload.optString("secretKey", "");
        setServerUrl(ctx, url);
        setSecretKey(ctx, secret);
        setBotLinked(ctx, !url.isEmpty() && !secret.isEmpty());
        setStoreName(ctx, payload.optString("storeName", "YASHI BUSINESS STORE"));
        setTheme(ctx, payload.optString("theme", "dark"));
        setPalette(ctx, payload.optString("palette", "obsidian"));
        setAutoLock(ctx, payload.optString("autoLock", "1min"));
        setLanguage(ctx, payload.optString("language", "en"));
        JSONArray rulesArr = payload.optJSONArray("rules");
        if (rulesArr != null) {
            prefs(ctx).edit().putString(KEY_RULES, rulesArr.toString()).apply();
        }
    }

    // --- LOGS ---
    public static synchronized void appendLog(Context ctx, String line) {
        String ts = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        String entry = "[" + ts + "] " + line;
        List<String> list = getLogs(ctx);
        list.add(0, entry);
        while (list.size() > 40) {
            list.remove(list.size() - 1);
        }
        JSONArray arr = new JSONArray();
        for (String item : list) arr.put(item);
        prefs(ctx).edit().putString(KEY_LOGS, arr.toString()).apply();

        Intent broadcast = new Intent(ACTION_LOG_UPDATED);
        broadcast.setPackage(ctx.getPackageName());
        ctx.sendBroadcast(broadcast);
    }

    public static synchronized List<String> getLogs(Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            String raw = prefs(ctx).getString(KEY_LOGS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                out.add(arr.optString(i, ""));
            }
        } catch (Throwable ignored) {}
        return out;
    }

    public static synchronized void clearLogs(Context ctx) {
        prefs(ctx).edit().putString(KEY_LOGS, "[]").apply();
        Intent broadcast = new Intent(ACTION_LOG_UPDATED);
        broadcast.setPackage(ctx.getPackageName());
        ctx.sendBroadcast(broadcast);
    }
}
