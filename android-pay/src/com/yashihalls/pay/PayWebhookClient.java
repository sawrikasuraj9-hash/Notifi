package com.yashihalls.pay;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class PayWebhookClient {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);

    public interface Callback {
        void onComplete(boolean ok, String message);
    }

    private PayWebhookClient() {}

    public static void pingAsync(final Context ctx, final Callback cb) {
        EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                String baseUrl = PayConfigStore.getServerUrl(ctx);
                String secret = PayConfigStore.getSecretKey(ctx);
                if (baseUrl.isEmpty() || secret.isEmpty()) {
                    if (cb != null) cb.onComplete(false, "Paste your Business Bot .paykey first.");
                    return;
                }
                try {
                    JSONObject body = new JSONObject();
                    body.put("deviceId", PayConfigStore.getDeviceId(ctx));
                    body.put("deviceName", PayConfigStore.getDeviceName(ctx));
                    body.put("appVersion", "2.0.0");
                    int bat = PayConfigStore.getBatteryLevel(ctx);
                    if (bat >= 0) body.put("batteryLevel", bat);
                    String sim = PayConfigStore.getSimOperator(ctx);
                    if (!sim.isEmpty()) body.put("simOperator", sim);

                    HttpResult res = postJson(baseUrl + "/api/business/pay/ping", secret, body);
                    if (res.code >= 200 && res.code < 300) {
                        JSONObject json = new JSONObject(res.body);
                        if (json.optBoolean("success", false)) {
                            String storeName = json.optString("storeName", "YASHI BUSINESS STORE");
                            String botName = json.optString("botName", "YASHI BUSINESS");
                            boolean online = json.optBoolean("botOnline", false);
                            PayConfigStore.setStoreName(ctx, storeName);
                            PayConfigStore.setBotLinked(ctx, true);
                            String msg = "Linked: " + storeName + " (" + botName + (online ? " • ONLINE" : " • READY") + ")";
                            PayConfigStore.appendLog(ctx, "LINKED -> " + storeName);
                            if (cb != null) cb.onComplete(true, msg);
                            return;
                        }
                    }
                    String errMsg = parseErrorMessage(res.body, "HTTP " + res.code);
                    PayConfigStore.appendLog(ctx, "LINK ERR (" + res.code + "): " + errMsg);
                    if (cb != null) cb.onComplete(false, errMsg);
                } catch (Exception e) {
                    String err = e.getMessage() != null ? e.getMessage() : "Connection failed";
                    PayConfigStore.appendLog(ctx, "LINK FAIL: " + err);
                    if (cb != null) cb.onComplete(false, err);
                }
            }
        });
    }

    public static void sendPaymentAsync(
            final Context ctx,
            final String recordId,
            final String source,
            final String sender,
            final String appPackage,
            final String rawMessage,
            final Callback cb
    ) {
        EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                String baseUrl = PayConfigStore.getServerUrl(ctx);
                String secret = PayConfigStore.getSecretKey(ctx);
                if (baseUrl.isEmpty() || secret.isEmpty()) {
                    if (recordId != null) {
                        PayConfigStore.updatePaymentStatus(ctx, recordId, "failed", sender, 0, "");
                    }
                    PayConfigStore.appendLog(ctx, "SKIPPED (" + source + "): Bot not linked");
                    if (cb != null) cb.onComplete(false, "Link your Business Bot first.");
                    return;
                }

                Exception lastEx = null;
                for (int attempt = 1; attempt <= 2; attempt++) {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("source", source);
                        body.put("sender", sender == null ? "" : sender);
                        body.put("appPackage", appPackage == null ? "" : appPackage);
                        body.put("rawMessage", rawMessage == null ? "" : rawMessage);
                        body.put("deviceId", PayConfigStore.getDeviceId(ctx));
                        body.put("deviceName", PayConfigStore.getDeviceName(ctx));
                        body.put("appVersion", "2.0.0");
                        int bat = PayConfigStore.getBatteryLevel(ctx);
                        if (bat >= 0) body.put("batteryLevel", bat);
                        String sim = PayConfigStore.getSimOperator(ctx);
                        if (!sim.isEmpty()) body.put("simOperator", sim);

                        HttpResult res = postJson(baseUrl + "/api/business/pay/webhook", secret, body);
                        if (res.code >= 200 && res.code < 300) {
                            JSONObject json = new JSONObject(res.body);
                            String status = json.optString("status", "ok");
                            double amt = json.optDouble("amountLkr", 0);
                            String bank = json.optString("bank", sender);
                            String matchedOrder = json.optString("matchedOrderId", "");
                            if (recordId != null) {
                                PayConfigStore.updatePaymentStatus(
                                        ctx,
                                        recordId,
                                        "ignored".equalsIgnoreCase(status) ? "ignored" : "sent",
                                        bank,
                                        amt,
                                        matchedOrder
                                );
                            }
                            String logMsg = bank + " LKR " + amt + " [" + status + "]"
                                    + (matchedOrder != null && !matchedOrder.isEmpty() && !"null".equals(matchedOrder)
                                    ? " -> " + matchedOrder : "");
                            PayConfigStore.appendLog(ctx, "SENT OK: " + logMsg);
                            if (cb != null) cb.onComplete(true, logMsg);
                            return;
                        } else {
                            String errMsg = parseErrorMessage(res.body, "HTTP " + res.code);
                            if (recordId != null) {
                                PayConfigStore.updatePaymentStatus(ctx, recordId, "failed", sender, 0, "");
                            }
                            PayConfigStore.appendLog(ctx, "REJECTED (" + res.code + "): " + errMsg);
                            if (cb != null) cb.onComplete(false, errMsg);
                            return;
                        }
                    } catch (Exception e) {
                        lastEx = e;
                        try { Thread.sleep(1200); } catch (InterruptedException ignored) {}
                    }
                }
                if (recordId != null) {
                    PayConfigStore.updatePaymentStatus(ctx, recordId, "failed", sender, 0, "");
                }
                String err = lastEx != null && lastEx.getMessage() != null ? lastEx.getMessage() : "Network error";
                PayConfigStore.appendLog(ctx, "SEND FAIL: " + err);
                if (cb != null) cb.onComplete(false, err);
            }
        });
    }

    private static String parseErrorMessage(String rawBody, String fallback) {
        try {
            JSONObject obj = new JSONObject(rawBody);
            String m = obj.optString("message", "");
            if (!m.isEmpty()) return m;
        } catch (Throwable ignored) {}
        return fallback;
    }

    private static final class HttpResult {
        final int code;
        final String body;
        HttpResult(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }

    private static HttpResult postJson(String urlStr, String secret, JSONObject payload) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + secret);
            conn.setRequestProperty("X-Yashi-Pay-Secret", secret);

            byte[] out = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }

            int code = conn.getResponseCode();
            InputStream stream = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (stream != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line);
                    }
                }
            }
            return new HttpResult(code, sb.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
