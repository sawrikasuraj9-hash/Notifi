package com.yashihalls.pay;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 1001;
    private static final int REQ_EXPORT_BACKUP = 2001;
    private static final int REQ_IMPORT_BACKUP = 2002;
    private static final int REQ_DEVICE_UNLOCK = 3001;

    private int currentTab = 0; // 0=Home, 1=Rules, 2=Payments, 3=Settings
    private long backgroundedAtMs = 0L;
    private boolean isLocked = false;
    private String pendingBackupPassword = "";

    private PayTheme theme;
    private FrameLayout rootWrapper;
    private LinearLayout mainScaffold;
    private LinearLayout lockOverlay;
    private ScrollView contentScroll;
    private LinearLayout pageContainer;
    private TextView topStatusText;
    private View topStatusDot;
    private LinearLayout topStatusPill;
    private LinearLayout bottomNav;

    private EditText keyInputView;
    private EditText customUrlInputView;
    private boolean showAdvancedUrl = false;

    private final BroadcastReceiver updateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            renderScreen();
        }
    };

    private static final class ReadyPreset {
        final String name;
        final String source;
        final String sender;
        final String keyword;

        ReadyPreset(String name, String source, String sender, String keyword) {
            this.name = name;
            this.source = source;
            this.sender = sender;
            this.keyword = keyword;
        }
    }

    private static final ReadyPreset[] READY_PRESETS = new ReadyPreset[]{
            new ReadyPreset("Sampath Bank", "sms", "SAMPATHTXN", "credited"),
            new ReadyPreset("eZ Cash", "sms", "eZ Cash", "Received"),
            new ReadyPreset("Commercial Bank", "sms", "COMBANK", "credited"),
            new ReadyPreset("BOC / SmartPay", "sms", "BOC", "credited"),
            new ReadyPreset("HNB / SOLO", "sms", "HNB", "credited"),
            new ReadyPreset("FriMi", "notification", "frimi", "received"),
            new ReadyPreset("People's Bank", "sms", "PEOPLES", "credited"),
            new ReadyPreset("Dialog Genie", "sms", "Genie", "received"),
            new ReadyPreset("LOLC iPay", "notification", "ipay", "credited"),
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildScaffold();
        renderScreen();
        syncBackgroundService();
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter filter = new IntentFilter();
        filter.addAction(PayConfigStore.ACTION_LOG_UPDATED);
        filter.addAction(PayConfigStore.ACTION_PAYMENTS_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(updateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateReceiver, filter);
        }

        checkAutoLockOnResume();
        renderScreen();
        syncBackgroundService();
    }

    @Override
    protected void onPause() {
        super.onPause();
        backgroundedAtMs = System.currentTimeMillis();
        try { unregisterReceiver(updateReceiver); } catch (Throwable ignored) {}
    }

    private void checkAutoLockOnResume() {
        if (backgroundedAtMs <= 0L) return;
        String lockMode = PayConfigStore.getAutoLock(this);
        long thresholdMs = 60_000L;
        if ("immediately".equals(lockMode)) thresholdMs = 1500L;
        else if ("5min".equals(lockMode)) thresholdMs = 300_000L;

        if (System.currentTimeMillis() - backgroundedAtMs >= thresholdMs) {
            isLocked = true;
            backgroundedAtMs = 0L;
            updateLockOverlay();
        }
        backgroundedAtMs = 0L;
    }

    private void syncBackgroundService() {
        boolean ready = PayConfigStore.isBotLinked(this) && !PayConfigStore.getRules(this).isEmpty();
        if (ready && !PayConfigStore.isServiceActive(this)) {
            PayConfigStore.setServiceActive(this, true);
        }
        if (PayConfigStore.isServiceActive(this) && PayConfigStore.isBotLinked(this)) {
            KeepAliveService.start(this);
        }
    }

    private void buildScaffold() {
        rootWrapper = new FrameLayout(this);

        mainScaffold = new LinearLayout(this);
        mainScaffold.setOrientation(LinearLayout.VERTICAL);
        mainScaffold.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Top Bar
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(18), dp(14), dp(18), dp(6));

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setOrientation(LinearLayout.HORIZONTAL);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        brandRow.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        View brandDot = new View(this);
        LinearLayout.LayoutParams bdLp = new LinearLayout.LayoutParams(dp(8), dp(8));
        bdLp.rightMargin = dp(8);
        brandDot.setLayoutParams(bdLp);
        brandDot.setId(View.generateViewId());
        brandRow.addView(brandDot);

        TextView brandLbl = new TextView(this);
        brandLbl.setText("YASHI HALLS PAY");
        brandLbl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        brandLbl.setTypeface(Typeface.DEFAULT_BOLD);
        brandLbl.setLetterSpacing(0.18f);
        brandRow.addView(brandLbl);

        topBar.addView(brandRow);

        topStatusPill = new LinearLayout(this);
        topStatusPill.setOrientation(LinearLayout.HORIZONTAL);
        topStatusPill.setGravity(Gravity.CENTER_VERTICAL);
        topStatusPill.setPadding(dp(12), dp(6), dp(12), dp(6));
        topStatusDot = new View(this);
        LinearLayout.LayoutParams tdLp = new LinearLayout.LayoutParams(dp(6), dp(6));
        tdLp.rightMargin = dp(6);
        topStatusDot.setLayoutParams(tdLp);
        topStatusPill.addView(topStatusDot);

        topStatusText = new TextView(this);
        topStatusText.setText("Setup");
        topStatusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        topStatusText.setTypeface(Typeface.DEFAULT_BOLD);
        topStatusPill.addView(topStatusText);
        topStatusPill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                currentTab = 0;
                renderScreen();
            }
        });
        topBar.addView(topStatusPill);
        mainScaffold.addView(topBar);

        // Main Scroll Content
        contentScroll = new ScrollView(this);
        contentScroll.setFillViewport(true);
        LinearLayout.LayoutParams scLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        contentScroll.setLayoutParams(scLp);

        pageContainer = new LinearLayout(this);
        pageContainer.setOrientation(LinearLayout.VERTICAL);
        pageContainer.setPadding(dp(16), dp(4), dp(16), dp(24));
        contentScroll.addView(pageContainer);
        mainScaffold.addView(contentScroll);

        // Bottom Navigation
        bottomNav = new LinearLayout(this);
        bottomNav.setOrientation(LinearLayout.HORIZONTAL);
        bottomNav.setPadding(dp(8), dp(8), dp(8), dp(10));
        bottomNav.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        mainScaffold.addView(bottomNav);

        rootWrapper.addView(mainScaffold);

        // Lock Overlay
        lockOverlay = new LinearLayout(this);
        lockOverlay.setOrientation(LinearLayout.VERTICAL);
        lockOverlay.setGravity(Gravity.CENTER);
        lockOverlay.setPadding(dp(28), dp(28), dp(28), dp(28));
        lockOverlay.setVisibility(View.GONE);
        lockOverlay.setClickable(true);
        rootWrapper.addView(lockOverlay);

        setContentView(rootWrapper);
    }

    private void renderScreen() {
        theme = PayTheme.resolve(this);

        // Apply window & status bar colors
        Window w = getWindow();
        if (w != null) {
            w.setStatusBarColor(theme.bg);
            w.setNavigationBarColor(theme.navBg);
        }
        mainScaffold.setBackgroundColor(theme.bg);

        // Update Top Bar colors
        LinearLayout topBar = (LinearLayout) mainScaffold.getChildAt(0);
        LinearLayout brandRow = (LinearLayout) topBar.getChildAt(0);
        View brandDot = brandRow.getChildAt(0);
        TextView brandLbl = (TextView) brandRow.getChildAt(1);
        brandDot.setBackground(theme.circle(theme.accent));
        brandLbl.setTextColor(theme.textSecondary);

        boolean allSetupDone = isAllSetupComplete();
        topStatusPill.setBackground(theme.rounded(this,
                allSetupDone ? theme.successBg : theme.pillActiveBg, Color.TRANSPARENT, 20));
        topStatusDot.setBackground(theme.circle(allSetupDone ? theme.success : theme.textSecondary));
        topStatusText.setText(allSetupDone
                ? theme.t("Running", "ක්‍රියාත්මකයි", "نشط")
                : theme.t("Setup", "සැකසුම", "إعداد"));
        topStatusText.setTextColor(allSetupDone ? theme.success : theme.textSecondary);

        if ("ar".equals(theme.lang)) {
            mainScaffold.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        } else {
            mainScaffold.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        }

        // Rebuild current tab body
        pageContainer.removeAllViews();
        if (currentTab == 0) renderHomeTab();
        else if (currentTab == 1) renderRulesTab();
        else if (currentTab == 2) renderPaymentsTab();
        else renderSettingsTab();

        renderBottomNav();
        updateLockOverlay();
    }

    private void renderBottomNav() {
        bottomNav.removeAllViews();
        bottomNav.setBackgroundColor(theme.navBg);

        int[] icons = new int[]{
                R.drawable.ic_home,
                R.drawable.ic_rules,
                R.drawable.ic_payments,
                R.drawable.ic_settings
        };
        String[] labels = new String[]{
                theme.t("Home", "මුල් පිටුව", "الرئيسية"),
                theme.t("Rules", "නීති", "القواعد"),
                theme.t("Payments", "ගෙවීම්", "المدفوعات"),
                theme.t("Settings", "සැකසුම්", "الإعدادات")
        };

        for (int i = 0; i < 4; i++) {
            final int tabIdx = i;
            boolean active = (currentTab == i);

            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            item.setPadding(dp(4), dp(2), dp(4), dp(2));

            FrameLayout pill = new FrameLayout(this);
            pill.setPadding(dp(18), dp(6), dp(18), dp(6));
            if (active) {
                pill.setBackground(theme.rounded(this, theme.pillActiveBg, Color.TRANSPARENT, 20));
            }
            ImageView iv = theme.icon(this, icons[i], 20, active ? theme.accent : theme.textSecondary);
            FrameLayout.LayoutParams ivLp = new FrameLayout.LayoutParams(dp(20), dp(20));
            ivLp.gravity = Gravity.CENTER;
            iv.setLayoutParams(ivLp);
            pill.addView(iv);
            item.addView(pill);

            TextView tv = new TextView(this);
            tv.setText(labels[i]);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            tv.setTypeface(active ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            tv.setTextColor(active ? theme.accent : theme.textSecondary);
            tv.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams tvLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            tvLp.topMargin = dp(4);
            tv.setLayoutParams(tvLp);
            item.addView(tv);

            item.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    currentTab = tabIdx;
                    contentScroll.scrollTo(0, 0);
                    renderScreen();
                }
            });

            bottomNav.addView(item);
        }
    }

    // ==================== TAB 1: HOME ====================
    private void renderHomeTab() {
        addPageHeader(
                theme.t("YASHI HALLS Pay", "YASHI HALLS Pay", "YASHI HALLS Pay"),
                theme.t(
                        "Catches the payments that reach this phone and sends them to your bot.",
                        "මෙම දුරකථනයට ලැබෙන ගෙවීම් පණිවිඩ අල්ලා ඔබේ Business Bot වෙත යවයි.",
                        "يلتقط المدفوعات التي تصل إلى هذا الهاتف ويرسلها إلى البوت الخاص بك."
                )
        );

        // Card 1: Link to your bot
        LinearLayout linkCard = makeCard();
        linkCard.addView(makeCardTitleRow(R.drawable.ic_link,
                theme.t("Link to your bot", "ඔබේ Bot සමඟ සම්බන්ධ කරන්න", "الربط بالبوت الخاص بك")));

        boolean linked = PayConfigStore.isBotLinked(this);
        if (linked) {
            TextView linkedInfo = makeBodyText(
                    theme.t("Linked to ", "සම්බන්ධිත Store: ", "متصل بـ ") + PayConfigStore.getStoreName(this)
                            + "\n" + PayConfigStore.getServerUrl(this),
                    theme.success
            );
            linkedInfo.setTypeface(Typeface.DEFAULT_BOLD);
            linkCard.addView(linkedInfo);

            LinearLayout btnRow = makeHorizontalRow(12);
            TextView pingBtn = makePillButton(
                    theme.t("Test connection", "සම්බන්ධතාව පරීක්ෂා කරන්න", "اختبار الاتصال"),
                    theme.accent, theme.accentBtnText, Color.TRANSPARENT, false);
            pingBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Toast.makeText(MainActivity.this, "Pinging Business Bot...", Toast.LENGTH_SHORT).show();
                    PayWebhookClient.pingAsync(MainActivity.this, new PayWebhookClient.Callback() {
                        @Override
                        public void onComplete(final boolean ok, final String message) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                                    renderScreen();
                                }
                            });
                        }
                    });
                }
            });
            btnRow.addView(pingBtn);

            TextView unlinkBtn = makePillButton(
                    theme.t("Unlink", "වෙන් කරන්න", "إلغاء الربط"),
                    theme.inputBg, theme.danger, theme.cardBorder, false);
            LinearLayout.LayoutParams ulp = (LinearLayout.LayoutParams) unlinkBtn.getLayoutParams();
            ulp.leftMargin = dp(8);
            unlinkBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    PayConfigStore.setBotLinked(MainActivity.this, false);
                    PayConfigStore.setSecretKey(MainActivity.this, "");
                    PayConfigStore.setServiceActive(MainActivity.this, false);
                    KeepAliveService.stop(MainActivity.this);
                    renderScreen();
                }
            });
            btnRow.addView(unlinkBtn);
            linkCard.addView(btnRow);
        } else {
            linkCard.addView(makeBodyText(
                    theme.t(
                            "On WhatsApp send .paykey (or .payapp key) to your Business Bot. Copy the key it sends to your chat and paste it here.",
                            "WhatsApp හි ඔබේ Business Bot වෙත .paykey (හෝ .payapp key) යවන්න. එය එවන Key එක Copy කර මෙහි Paste කර Link ඔබන්න.",
                            "على واتساب أرسل .paykey إلى البوت الخاص بك. انسخ المفتاح وألصقه هنا."
                    ),
                    theme.textSecondary
            ));

            keyInputView = makeInputField("YHP....", PayConfigStore.getSecretKey(this), false);
            LinearLayout.LayoutParams kilp = (LinearLayout.LayoutParams) keyInputView.getLayoutParams();
            kilp.topMargin = dp(12);
            linkCard.addView(keyInputView);

            if (showAdvancedUrl) {
                customUrlInputView = makeInputField(
                        "https://your-business-bot-url.run.app",
                        PayConfigStore.getServerUrl(this),
                        false
                );
                LinearLayout.LayoutParams cilp = (LinearLayout.LayoutParams) customUrlInputView.getLayoutParams();
                cilp.topMargin = dp(8);
                linkCard.addView(customUrlInputView);
            }

            LinearLayout btnRow = makeHorizontalRow(12);
            TextView pasteBtn = makePillButton(
                    theme.t("Paste", "Paste", "لصق"),
                    theme.inputBg, theme.textPrimary, theme.cardBorder, false);
            pasteBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null
                            && cm.getPrimaryClip().getItemCount() > 0) {
                        CharSequence clip = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                        if (clip != null) {
                            keyInputView.setText(clip.toString().trim());
                            Toast.makeText(MainActivity.this, "Key pasted", Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        Toast.makeText(MainActivity.this, "Clipboard is empty", Toast.LENGTH_SHORT).show();
                    }
                }
            });
            btnRow.addView(pasteBtn);

            TextView linkBtn = makePillButtonWithIcon(
                    R.drawable.ic_link,
                    theme.t("Link", "Link", "ربط"),
                    theme.accent, theme.accentBtnText, Color.TRANSPARENT);
            LinearLayout.LayoutParams lblp = (LinearLayout.LayoutParams) linkBtn.getLayoutParams();
            lblp.leftMargin = dp(10);
            linkBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    handleLinkBot();
                }
            });
            btnRow.addView(linkBtn);

            TextView advToggle = new TextView(this);
            advToggle.setText(showAdvancedUrl ? "Hide URL" : "Server URL");
            advToggle.setTextColor(theme.textMuted);
            advToggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            advToggle.setPadding(dp(12), dp(8), dp(4), dp(8));
            advToggle.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAdvancedUrl = !showAdvancedUrl;
                    renderScreen();
                }
            });
            btnRow.addView(advToggle);

            linkCard.addView(btnRow);
        }
        pageContainer.addView(linkCard);

        // Card 2: Setup checklist
        LinearLayout setupCard = makeCard();
        setupCard.addView(makeCardTitleRow(R.drawable.ic_shield,
                theme.t("Setup", "සැකසුම් පරීක්ෂාව", "الإعداد")));

        boolean notifOk = isNotificationAccessEnabled();
        boolean smsOk = hasSmsPermissions();
        boolean postNotifOk = hasPostNotificationsPermission();
        boolean batteryOk = isIgnoringBatteryOptimizations();
        boolean ruleOk = !PayConfigStore.getRules(this).isEmpty();

        setupCard.addView(makeSetupRow(
                theme.t("Notification access", "Notification අවසරය", "إذن الإشعارات"),
                notifOk,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                    }
                }
        ));
        setupCard.addView(makeSetupRow(
                theme.t("SMS permission", "SMS කියවීමේ අවසරය", "إذن الرسائل القصيرة"),
                smsOk,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        requestRuntimePermissions();
                    }
                }
        ));
        setupCard.addView(makeSetupRow(
                theme.t("Show notifications", "Notification පෙන්වීම", "عرض الإشعارات"),
                postNotifOk,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        requestRuntimePermissions();
                    }
                }
        ));
        setupCard.addView(makeSetupRow(
                theme.t("No battery limits", "Battery සීමා ඉවත් කිරීම", "بدون قيود البطارية"),
                batteryOk,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        try {
                            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                            i.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(i);
                        } catch (Throwable t) {
                            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                        }
                    }
                }
        ));
        setupCard.addView(makeSetupRow(
                theme.t("At least one rule", "අවම වශයෙන් එක් Rule එකක්", "قاعدة واحدة على الأقل"),
                ruleOk,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        currentTab = 1;
                        renderScreen();
                    }
                }
        ));

        TextView restrictedNote = makeBodyText(
                theme.t(
                        "If a switch is grey or says \"restricted\": App info → ⋮ (top right) → Allow restricted settings, then try again.",
                        "Switch එක අළු පාට නම් හෝ \"restricted\" ලෙස පෙන්වයි නම්: App info → ⋮ (ඉහළ දකුණ) → Allow restricted settings ඔබා නැවත උත්සාහ කරන්න.",
                        "إذا كان المفتاح رمادياً: معلومات التطبيق ← ⋮ ← السماح بالإعدادات المقيدة."
                ),
                theme.textMuted
        );
        restrictedNote.setPadding(0, dp(10), 0, dp(10));
        setupCard.addView(restrictedNote);

        TextView appInfoBtn = makePillButtonWithIcon(
                R.drawable.ic_info,
                theme.t("Open App info", "App info විවෘත කරන්න", "معلومات التطبيق"),
                theme.inputBg, theme.accent, theme.cardBorder);
        appInfoBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAppInfoSettings();
            }
        });
        setupCard.addView(appInfoBtn);
        pageContainer.addView(setupCard);

        // Card 3: Keep it running
        LinearLayout keepCard = makeCard();
        keepCard.addView(makeCardTitleRow(R.drawable.ic_rocket,
                theme.t("Keep it running", "නොනැවතී 24/7 ක්‍රියාත්මකව තබන්න", "إبقائه يعمل")));
        keepCard.addView(makeBodyText(
                "• Xiaomi / Redmi / POCO: App info → Autostart ON · Battery saver → No restrictions\n"
                        + "• Oppo / Realme / Vivo: App info → Battery → Allow background activity · Auto launch ON\n"
                        + "• Samsung: Battery → Unrestricted · not in \"Sleeping apps\"\n"
                        + "• Any phone: lock YASHI HALLS Pay in Recent apps (padlock) if your phone has it",
                theme.textSecondary
        ));

        TextView autoStartBtn = makePillButtonWithIcon(
                R.drawable.ic_rocket,
                theme.t("Open auto-start settings", "Auto-start සැකසුම් විවෘත කරන්න", "فتح إعدادات البدء التلقائي"),
                theme.inputBg, theme.accent, theme.cardBorder);
        LinearLayout.LayoutParams asLp = (LinearLayout.LayoutParams) autoStartBtn.getLayoutParams();
        asLp.topMargin = dp(12);
        autoStartBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAutoStartSettings();
            }
        });
        keepCard.addView(autoStartBtn);
        pageContainer.addView(keepCard);
    }

    private void handleLinkBot() {
        String raw = keyInputView != null ? keyInputView.getText().toString().trim() : "";
        String fallbackUrl = customUrlInputView != null
                ? customUrlInputView.getText().toString().trim()
                : PayConfigStore.getServerUrl(this);

        if (raw.isEmpty()) {
            Toast.makeText(this, "Paste the key sent by .paykey on WhatsApp.", Toast.LENGTH_SHORT).show();
            return;
        }

        PayConfigStore.ParsedLinkKey parsed = PayConfigStore.parseBotLinkKey(raw, fallbackUrl);
        if (parsed == null || parsed.secretKey.isEmpty()) {
            Toast.makeText(this, "Invalid Bot Key format. Copy the exact YHP key from Business Bot.", Toast.LENGTH_LONG).show();
            return;
        }
        if (parsed.serverUrl.isEmpty()) {
            showAdvancedUrl = true;
            renderScreen();
            Toast.makeText(this, "Enter Server URL or use the full YHP key from .paykey", Toast.LENGTH_LONG).show();
            return;
        }

        PayConfigStore.setServerUrl(this, parsed.serverUrl);
        PayConfigStore.setSecretKey(this, parsed.secretKey);
        Toast.makeText(this, "Linking to Business Bot...", Toast.LENGTH_SHORT).show();

        PayWebhookClient.pingAsync(this, new PayWebhookClient.Callback() {
            @Override
            public void onComplete(final boolean ok, final String message) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (ok) {
                            syncBackgroundService();
                        }
                        Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                        renderScreen();
                    }
                });
            }
        });
    }

    // ==================== TAB 2: RULES ====================
    private void renderRulesTab() {
        addPageHeader(
                theme.t("Rules", "නීති (Rules)", "القواعد"),
                theme.t(
                        "Only messages that match a rule are caught. Everything else never leaves this phone.",
                        "මෙම නීතිවලට ගැලපෙන පණිවිඩ පමණක් ග්‍රහණය කෙරේ. අනෙකුත් කිසිදු පණිවිඩයක් දුරකථනයෙන් පිටතට නොයයි.",
                        "يتم التقاط الرسائل المطابقة للقاعدة فقط. كل شيء آخر لا يغادر هذا الهاتف أبداً."
                )
        );

        // Ready Rules Card
        LinearLayout readyCard = makeCard();
        readyCard.addView(makeCardTitleRow(R.drawable.ic_bolt,
                theme.t("Ready rules", "සූදානම් නීති (Ready rules)", "قواعد جاهزة")));

        for (final ReadyPreset preset : READY_PRESETS) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(10), 0, dp(10));

            FrameLayout iconBox = new FrameLayout(this);
            iconBox.setBackground(theme.rounded(this, theme.inputBg, theme.cardBorder, 10));
            iconBox.setPadding(dp(9), dp(9), dp(9), dp(9));
            ImageView chatIv = theme.icon(this, R.drawable.ic_chat, 16, theme.textSecondary);
            iconBox.addView(chatIv);
            row.addView(iconBox);

            LinearLayout infoCol = new LinearLayout(this);
            infoCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams icLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            icLp.leftMargin = dp(12);
            icLp.rightMargin = dp(8);
            infoCol.setLayoutParams(icLp);

            TextView titleTv = new TextView(this);
            String srcLabel = "notification".equals(preset.source) ? "App" : "SMS";
            titleTv.setText(preset.name + " · " + srcLabel);
            titleTv.setTextColor(theme.textPrimary);
            titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            titleTv.setTypeface(Typeface.DEFAULT_BOLD);
            infoCol.addView(titleTv);

            TextView subTv = new TextView(this);
            subTv.setText(preset.sender + " · " + preset.keyword);
            subTv.setTextColor(theme.textMuted);
            subTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            infoCol.addView(subTv);
            row.addView(infoCol);

            final boolean alreadyAdded = PayConfigStore.hasRuleWithName(this, preset.name);
            TextView addBtn = makePillButton(
                    alreadyAdded ? theme.t("Added", "එක් කළා", "مضاف") : theme.t("Add", "එක් කරන්න", "إضافة"),
                    alreadyAdded ? theme.successBg : theme.inputBg,
                    alreadyAdded ? theme.success : theme.accent,
                    alreadyAdded ? Color.TRANSPARENT : theme.cardBorder,
                    false
            );
            addBtn.setPadding(dp(16), dp(8), dp(16), dp(8));
            addBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (!alreadyAdded) {
                        PayConfigStore.addRule(MainActivity.this, new PayConfigStore.RuleItem(
                                "rule-" + UUID.randomUUID().toString().substring(0, 8),
                                preset.name,
                                preset.source,
                                preset.sender,
                                preset.keyword,
                                true
                        ));
                        syncBackgroundService();
                        renderScreen();
                    }
                }
            });
            row.addView(addBtn);
            readyCard.addView(row);
        }
        pageContainer.addView(readyCard);

        // + New rule button
        LinearLayout newRuleWrap = new LinearLayout(this);
        newRuleWrap.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams nrLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nrLp.topMargin = dp(14);
        newRuleWrap.setLayoutParams(nrLp);

        TextView newRuleBtn = makePillButton(
                "+  " + theme.t("New rule", "නව නීතියක්", "قاعدة جديدة"),
                theme.accent, theme.accentBtnText, Color.TRANSPARENT, false);
        newRuleBtn.setPadding(dp(20), dp(12), dp(20), dp(12));
        newRuleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showAddRuleDialog();
            }
        });
        newRuleWrap.addView(newRuleBtn);
        pageContainer.addView(newRuleWrap);

        // Active rules list
        final List<PayConfigStore.RuleItem> rules = PayConfigStore.getRules(this);
        if (rules.isEmpty()) {
            TextView empty = makeBodyText(
                    theme.t("No rules yet.", "තවම නීති එකතු කර නැත.", "لا توجد قواعد بعد."),
                    theme.textMuted);
            empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            elp.topMargin = dp(18);
            empty.setLayoutParams(elp);
            pageContainer.addView(empty);
        } else {
            for (final PayConfigStore.RuleItem rule : rules) {
                LinearLayout rc = makeCard();
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);

                LinearLayout info = new LinearLayout(this);
                info.setOrientation(LinearLayout.VERTICAL);
                info.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                TextView nm = new TextView(this);
                nm.setText(rule.name + " · " + rule.source.toUpperCase(Locale.US));
                nm.setTextColor(theme.textPrimary);
                nm.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                nm.setTypeface(Typeface.DEFAULT_BOLD);
                info.addView(nm);

                TextView flt = new TextView(this);
                flt.setText((rule.senderFilter.isEmpty() ? "Any sender" : rule.senderFilter)
                        + " · " + (rule.keyword.isEmpty() ? "Any amount" : rule.keyword));
                flt.setTextColor(theme.textMuted);
                flt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                info.addView(flt);
                row.addView(info);

                TextView toggleBtn = makePillButton(
                        rule.enabled ? "ON" : "OFF",
                        rule.enabled ? theme.successBg : theme.inputBg,
                        rule.enabled ? theme.success : theme.textMuted,
                        Color.TRANSPARENT, false);
                toggleBtn.setPadding(dp(12), dp(6), dp(12), dp(6));
                toggleBtn.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        PayConfigStore.toggleRule(MainActivity.this, rule.id);
                        renderScreen();
                    }
                });
                row.addView(toggleBtn);

                ImageView delBtn = theme.icon(this, R.drawable.ic_trash, 18, theme.danger);
                LinearLayout.LayoutParams dlp = (LinearLayout.LayoutParams) delBtn.getLayoutParams();
                dlp.leftMargin = dp(10);
                delBtn.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        PayConfigStore.deleteRule(MainActivity.this, rule.id);
                        renderScreen();
                    }
                });
                row.addView(delBtn);

                rc.addView(row);
                pageContainer.addView(rc);
            }
        }
    }

    private void showAddRuleDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(18), dp(12), dp(18), dp(6));

        final EditText nameEt = new EditText(this);
        nameEt.setHint("Rule name (e.g. Seylan Bank)");
        form.addView(nameEt);

        final Spinner sourceSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item,
                new String[]{"SMS", "Notification", "SMS + Notification"});
        sourceSpinner.setAdapter(adapter);
        form.addView(sourceSpinner);

        final EditText senderEt = new EditText(this);
        senderEt.setHint("Sender / App filter (optional, e.g. SEYLAN)");
        form.addView(senderEt);

        final EditText keywordEt = new EditText(this);
        keywordEt.setHint("Keyword to match (e.g. credited)");
        keywordEt.setText("credited");
        form.addView(keywordEt);

        new AlertDialog.Builder(this)
                .setTitle("New rule")
                .setView(form)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String name = nameEt.getText().toString().trim();
                        if (name.isEmpty()) name = "Custom Rule";
                        int pos = sourceSpinner.getSelectedItemPosition();
                        String src = pos == 0 ? "sms" : pos == 1 ? "notification" : "both";
                        PayConfigStore.addRule(MainActivity.this, new PayConfigStore.RuleItem(
                                "rule-" + UUID.randomUUID().toString().substring(0, 8),
                                name,
                                src,
                                senderEt.getText().toString().trim(),
                                keywordEt.getText().toString().trim(),
                                true
                        ));
                        syncBackgroundService();
                        renderScreen();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ==================== TAB 3: PAYMENTS ====================
    private void renderPaymentsTab() {
        addPageHeader(
                theme.t("Payments", "ගෙවීම් (Payments)", "المدفوعات"),
                theme.t(
                        "Caught on this phone. Sent ones are cleared after 7 days.",
                        "මෙම දුරකථනයෙන් හඳුනාගත් ගෙවීම්. යැවූ පණිවිඩ දින 7 කට පසු ඉවත් වේ.",
                        "المبالغ الملتقطة على هذا الهاتف. تُمسح المرسلة بعد 7 أيام."
                )
        );

        LinearLayout summaryCard = makeCard();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout leftCol = new LinearLayout(this);
        leftCol.setOrientation(LinearLayout.VERTICAL);
        leftCol.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView todayLbl = new TextView(this);
        todayLbl.setText(theme.t("Today", "අද දිනය", "اليوم"));
        todayLbl.setTextColor(theme.textSecondary);
        todayLbl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        leftCol.addView(todayLbl);

        boolean hidden = PayConfigStore.isHideBalance(this);
        double todayLkr = PayConfigStore.getTodayTotalLkr(this);
        TextView amountTv = new TextView(this);
        amountTv.setText(hidden ? "LKR ••••••" : String.format(Locale.US, "LKR %,.2f", todayLkr));
        amountTv.setTextColor(theme.textPrimary);
        amountTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        amountTv.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(4);
        amountTv.setLayoutParams(alp);
        leftCol.addView(amountTv);
        row.addView(leftCol);

        ImageView eyeBtn = theme.icon(this, hidden ? R.drawable.ic_eye : R.drawable.ic_eye_off, 22, theme.textSecondary);
        eyeBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        eyeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                PayConfigStore.setHideBalance(MainActivity.this, !PayConfigStore.isHideBalance(MainActivity.this));
                renderScreen();
            }
        });
        row.addView(eyeBtn);
        summaryCard.addView(row);
        pageContainer.addView(summaryCard);

        List<PayConfigStore.PaymentRecord> list = PayConfigStore.getPayments(this);
        if (list.isEmpty()) {
            TextView empty = makeBodyText(
                    theme.t("Nothing caught yet.", "තවම ගෙවීම් කිසිවක් හමුවී නැත.", "لم يتم التقاط أي دفعات بعد."),
                    theme.textMuted);
            empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            elp.topMargin = dp(18);
            empty.setLayoutParams(elp);
            pageContainer.addView(empty);
        } else {
            SimpleDateFormat fmt = new SimpleDateFormat("MMM dd · HH:mm", Locale.US);
            for (final PayConfigStore.PaymentRecord rec : list) {
                LinearLayout pc = makeCard();
                LinearLayout topR = new LinearLayout(this);
                topR.setOrientation(LinearLayout.HORIZONTAL);
                topR.setGravity(Gravity.CENTER_VERTICAL);

                TextView bankTv = new TextView(this);
                bankTv.setText(rec.bank + (rec.matchedOrderId != null && !rec.matchedOrderId.isEmpty()
                        ? " · " + rec.matchedOrderId : ""));
                bankTv.setTextColor(theme.textPrimary);
                bankTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                bankTv.setTypeface(Typeface.DEFAULT_BOLD);
                bankTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                topR.addView(bankTv);

                TextView amtTv = new TextView(this);
                amtTv.setText(String.format(Locale.US, "LKR %,.2f", rec.amountLkr));
                amtTv.setTextColor(theme.accent);
                amtTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                amtTv.setTypeface(Typeface.DEFAULT_BOLD);
                topR.addView(amtTv);
                pc.addView(topR);

                TextView rawTv = new TextView(this);
                rawTv.setText(rec.rawMessage);
                rawTv.setTextColor(theme.textSecondary);
                rawTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                rawTv.setMaxLines(2);
                rawTv.setEllipsize(TextUtils.TruncateAt.END);
                LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rlp.topMargin = dp(4);
                rawTv.setLayoutParams(rlp);
                pc.addView(rawTv);

                LinearLayout footR = makeHorizontalRow(8);
                TextView timeTv = new TextView(this);
                timeTv.setText(fmt.format(new Date(rec.timestampMs)) + " · " + rec.ruleName);
                timeTv.setTextColor(theme.textMuted);
                timeTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                timeTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                footR.addView(timeTv);

                boolean isSent = "sent".equals(rec.status);
                boolean isFailed = "failed".equals(rec.status);
                TextView stTv = new TextView(this);
                stTv.setText(isSent ? "Sent" : isFailed ? "Retry" : "Sending...");
                stTv.setTextColor(isSent ? theme.success : isFailed ? theme.danger : theme.warn);
                stTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                stTv.setTypeface(Typeface.DEFAULT_BOLD);
                if (isFailed) {
                    stTv.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            PayConfigStore.updatePaymentStatus(MainActivity.this, rec.id, "sending", rec.bank, rec.amountLkr, "");
                            PayWebhookClient.sendPaymentAsync(
                                    MainActivity.this, rec.id, rec.source, rec.sender, rec.appPackage, rec.rawMessage, null);
                        }
                    });
                }
                footR.addView(stTv);
                pc.addView(footR);

                pageContainer.addView(pc);
            }
        }
    }

    // ==================== TAB 4: SETTINGS ====================
    private void renderSettingsTab() {
        // Card 1: Theme
        LinearLayout themeCard = makeCard();
        themeCard.addView(makeCardTitleRow(R.drawable.ic_moon, theme.t("Theme", "තේමාව", "المظهر")));
        String curTheme = PayConfigStore.getTheme(this);
        themeCard.addView(makeSegmentedRow(
                new String[]{"auto", "light", "dark"},
                new String[]{
                        theme.t("Auto", "Auto", "تلقائي"),
                        theme.t("Light", "Light", "فاتح"),
                        theme.t("Dark", "Dark", "داكن")
                },
                curTheme,
                new OnOptionSelected() {
                    @Override
                    public void onSelect(String id) {
                        PayConfigStore.setTheme(MainActivity.this, id);
                        renderScreen();
                    }
                }
        ));
        pageContainer.addView(themeCard);

        // Card 2: Palette
        LinearLayout palCard = makeCard();
        palCard.addView(makeCardTitleRow(R.drawable.ic_palette, theme.t("Palette", "වර්ණ මාලාව", "لوحة الألوان")));
        String curPal = PayConfigStore.getPalette(this);
        String[][] palettes = new String[][]{
                {"obsidian", "Obsidian · Gold", "#E2B93B"},
                {"midnight", "Midnight · Blue", "#4B89FF"},
                {"amethyst", "Amethyst · Purple", "#A855F7"},
        };
        for (final String[] p : palettes) {
            boolean selected = curPal.equals(p[0]);
            LinearLayout opt = new LinearLayout(this);
            opt.setOrientation(LinearLayout.HORIZONTAL);
            opt.setGravity(Gravity.CENTER_VERTICAL);
            opt.setBackground(theme.rounded(this,
                    selected ? theme.pillActiveBg : theme.inputBg, Color.TRANSPARENT, 12));
            opt.setPadding(dp(14), dp(13), dp(14), dp(13));
            LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            olp.topMargin = dp(8);
            opt.setLayoutParams(olp);

            View swatch = new View(this);
            swatch.setBackground(theme.rounded(this, Color.parseColor(p[2]), Color.TRANSPARENT, 4));
            LinearLayout.LayoutParams swLp = new LinearLayout.LayoutParams(dp(14), dp(14));
            swLp.rightMargin = dp(12);
            swatch.setLayoutParams(swLp);
            opt.addView(swatch);

            TextView lbl = new TextView(this);
            lbl.setText(p[1]);
            lbl.setTextColor(theme.textPrimary);
            lbl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            lbl.setTypeface(selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            lbl.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            opt.addView(lbl);

            if (selected) {
                opt.addView(theme.icon(this, R.drawable.ic_check, 16, theme.accent));
            }
            opt.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    PayConfigStore.setPalette(MainActivity.this, p[0]);
                    renderScreen();
                }
            });
            palCard.addView(opt);
        }
        pageContainer.addView(palCard);

        // Card 3: Auto-lock
        LinearLayout lockCard = makeCard();
        lockCard.addView(makeCardTitleRow(R.drawable.ic_lock, theme.t("Auto-lock", "ස්වයංක්‍රීය අගුල", "القفل التلقائي")));
        String curLock = PayConfigStore.getAutoLock(this);
        lockCard.addView(makeSegmentedRow(
                new String[]{"immediately", "1min", "5min"},
                new String[]{
                        theme.t("Immediately", "Immediately", "فوراً"),
                        theme.t("After 1 min", "After 1 min", "بعد دقيقة"),
                        theme.t("After 5 min", "After 5 min", "بعد 5 دقائق")
                },
                curLock,
                new OnOptionSelected() {
                    @Override
                    public void onSelect(String id) {
                        PayConfigStore.setAutoLock(MainActivity.this, id);
                        renderScreen();
                    }
                }
        ));
        pageContainer.addView(lockCard);

        // Card 4: Language
        LinearLayout langCard = makeCard();
        langCard.addView(makeCardTitleRow(R.drawable.ic_globe, theme.t("Language", "භාෂාව", "اللغة")));
        String curLang = PayConfigStore.getLanguage(this);
        String[][] langs = new String[][]{
                {"en", "English"},
                {"si", "සිංහල"},
                {"ar", "العربية"},
        };
        for (final String[] l : langs) {
            boolean selected = curLang.equals(l[0]);
            LinearLayout opt = new LinearLayout(this);
            opt.setOrientation(LinearLayout.HORIZONTAL);
            opt.setGravity(Gravity.CENTER_VERTICAL);
            opt.setBackground(theme.rounded(this,
                    selected ? theme.pillActiveBg : theme.inputBg, Color.TRANSPARENT, 12));
            opt.setPadding(dp(14), dp(13), dp(14), dp(13));
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            llp.topMargin = dp(8);
            opt.setLayoutParams(llp);

            TextView lbl = new TextView(this);
            lbl.setText(l[1]);
            lbl.setTextColor(theme.textPrimary);
            lbl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            lbl.setTypeface(selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            lbl.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            opt.addView(lbl);

            if (selected) {
                opt.addView(theme.icon(this, R.drawable.ic_check, 16, theme.accent));
            }
            opt.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    PayConfigStore.setLanguage(MainActivity.this, l[0]);
                    renderScreen();
                }
            });
            langCard.addView(opt);
        }
        pageContainer.addView(langCard);

        // Card 5: Backup & restore
        LinearLayout bakCard = makeCard();
        bakCard.addView(makeCardTitleRow(R.drawable.ic_lock, theme.t("Backup & restore", "Backup සහ Restore", "النسخ الاحتياطي والاستعادة")));
        bakCard.addView(makeBodyText(
                theme.t(
                        "Save your key and rules to an encrypted file. You'll need the password to restore it on another phone.",
                        "ඔබගේ Bot Key සහ Rules ආරක්ෂිත encrypted ගොනුවකට සුරකින්න. වෙනත් දුරකථනයකට Restore කිරීමට මෙම මුරපදය අවශ්‍ය වේ.",
                        "احفظ مفتاحك وقواعدك في ملف مشفر. ستحتاج إلى كلمة المرور لاستعادتها."
                ),
                theme.textSecondary
        ));

        final EditText bakPwdEt = makeInputField(
                theme.t("Backup password", "Backup මුරපදය", "كلمة مرور النسخة الاحتياطية"),
                "", true);
        LinearLayout.LayoutParams bplp = (LinearLayout.LayoutParams) bakPwdEt.getLayoutParams();
        bplp.topMargin = dp(12);
        bakCard.addView(bakPwdEt);

        LinearLayout bakBtns = makeHorizontalRow(12);
        TextView exportBtn = makePillButtonWithIcon(
                R.drawable.ic_cloud,
                theme.t("Export", "Export", "تصدير"),
                theme.accent, theme.accentBtnText, Color.TRANSPARENT);
        exportBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String pwd = bakPwdEt.getText().toString();
                if (pwd.length() < 4) {
                    Toast.makeText(MainActivity.this, "Enter at least 4-character backup password.", Toast.LENGTH_SHORT).show();
                    return;
                }
                pendingBackupPassword = pwd;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/octet-stream");
                intent.putExtra(Intent.EXTRA_TITLE, "YashiHallsPay-backup.ypbak");
                startActivityForResult(intent, REQ_EXPORT_BACKUP);
            }
        });
        bakBtns.addView(exportBtn);

        TextView restoreBtn = makePillButtonWithIcon(
                R.drawable.ic_cloud,
                theme.t("Restore", "Restore", "استعادة"),
                theme.inputBg, theme.accent, theme.cardBorder);
        LinearLayout.LayoutParams rblp = (LinearLayout.LayoutParams) restoreBtn.getLayoutParams();
        rblp.leftMargin = dp(10);
        restoreBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String pwd = bakPwdEt.getText().toString();
                if (pwd.isEmpty()) {
                    Toast.makeText(MainActivity.this, "Enter the backup password first.", Toast.LENGTH_SHORT).show();
                    return;
                }
                pendingBackupPassword = pwd;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                startActivityForResult(intent, REQ_IMPORT_BACKUP);
            }
        });
        bakBtns.addView(restoreBtn);
        bakCard.addView(bakBtns);
        pageContainer.addView(bakCard);

        // Version Footer & Test Ping
        TextView verFooter = makeBodyText("YASHI HALLS Pay · v2.0.0", theme.textMuted);
        verFooter.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams vflp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        vflp.topMargin = dp(16);
        verFooter.setLayoutParams(vflp);
        pageContainer.addView(verFooter);
    }

    private void updateLockOverlay() {
        if (!isLocked) {
            lockOverlay.setVisibility(View.GONE);
            return;
        }
        lockOverlay.setVisibility(View.VISIBLE);
        lockOverlay.setBackgroundColor(theme.bg);
        lockOverlay.removeAllViews();

        lockOverlay.addView(theme.icon(this, R.drawable.ic_lock, 44, theme.accent));

        TextView title = new TextView(this);
        title.setText("YASHI HALLS Pay Locked");
        title.setTextColor(theme.textPrimary);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tlp.topMargin = dp(14);
        title.setLayoutParams(tlp);
        lockOverlay.addView(title);

        TextView unlockBtn = makePillButton(
                theme.t("Unlock", "අගුල හරින්න", "فتح القفل"),
                theme.accent, theme.accentBtnText, Color.TRANSPARENT, false);
        LinearLayout.LayoutParams ulp = (LinearLayout.LayoutParams) unlockBtn.getLayoutParams();
        ulp.topMargin = dp(20);
        unlockBtn.setPadding(dp(28), dp(12), dp(28), dp(12));
        unlockBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                if (km != null && km.isDeviceSecure()) {
                    Intent i = km.createConfirmDeviceCredentialIntent("Unlock YASHI HALLS Pay", "Verify phone lock to continue");
                    if (i != null) {
                        startActivityForResult(i, REQ_DEVICE_UNLOCK);
                        return;
                    }
                }
                isLocked = false;
                updateLockOverlay();
            }
        });
        lockOverlay.addView(unlockBtn);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_DEVICE_UNLOCK) {
            if (resultCode == RESULT_OK) {
                isLocked = false;
                updateLockOverlay();
            }
            return;
        }

        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();

        if (requestCode == REQ_EXPORT_BACKUP) {
            try {
                String encrypted = PayConfigStore.exportEncryptedBackup(this, pendingBackupPassword);
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os != null) os.write(encrypted.getBytes(StandardCharsets.UTF_8));
                }
                Toast.makeText(this, "Encrypted backup saved!", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(this, "Export failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            } finally {
                pendingBackupPassword = "";
            }
        } else if (requestCode == REQ_IMPORT_BACKUP) {
            try {
                StringBuilder sb = new StringBuilder();
                try (InputStream is = getContentResolver().openInputStream(uri);
                     BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line).append("\n");
                }
                PayConfigStore.importEncryptedBackup(this, sb.toString(), pendingBackupPassword);
                syncBackgroundService();
                renderScreen();
                Toast.makeText(this, "Backup restored successfully!", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(this, "Restore failed: Wrong password or file.", Toast.LENGTH_LONG).show();
            } finally {
                pendingBackupPassword = "";
            }
        }
    }

    // ==================== PERMISSIONS & SYSTEM INTENTS ====================
    private boolean hasSmsPermissions() {
        return checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasPostNotificationsPermission() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isNotificationAccessEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (flat == null || flat.isEmpty()) return false;
        ComponentName cn = new ComponentName(this, PaymentNotificationService.class);
        return flat.contains(cn.flattenToString()) || flat.contains(getPackageName());
    }

    private boolean isIgnoringBatteryOptimizations() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private boolean isAllSetupComplete() {
        return PayConfigStore.isBotLinked(this)
                && isNotificationAccessEnabled()
                && hasSmsPermissions()
                && isIgnoringBatteryOptimizations()
                && !PayConfigStore.getRules(this).isEmpty();
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{
                    Manifest.permission.RECEIVE_SMS,
                    Manifest.permission.READ_SMS,
                    Manifest.permission.POST_NOTIFICATIONS
            }, REQ_PERMISSIONS);
        } else {
            requestPermissions(new String[]{
                    Manifest.permission.RECEIVE_SMS,
                    Manifest.permission.READ_SMS
            }, REQ_PERMISSIONS);
        }
    }

    private void openAppInfoSettings() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.parse("package:" + getPackageName()));
        startActivity(i);
    }

    private void openAutoStartSettings() {
        ComponentName[] oemComponents = new ComponentName[]{
                new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                new ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
                new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        };
        for (ComponentName cn : oemComponents) {
            try {
                Intent i = new Intent().setComponent(cn);
                if (getPackageManager().resolveActivity(i, 0) != null) {
                    startActivity(i);
                    return;
                }
            } catch (Throwable ignored) {}
        }
        openAppInfoSettings();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        renderScreen();
    }

    // ==================== UI COMPONENT HELPERS ====================
    private int dp(int val) {
        return theme != null ? theme.dp(this, val)
                : Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, val, getResources().getDisplayMetrics()));
    }

    private void addPageHeader(String titleText, String subtitleText) {
        TextView title = new TextView(this);
        title.setText(titleText);
        title.setTextColor(theme.textPrimary);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tlp.topMargin = dp(4);
        title.setLayoutParams(tlp);
        pageContainer.addView(title);

        TextView sub = makeBodyText(subtitleText, theme.textSecondary);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(4);
        slp.bottomMargin = dp(4);
        sub.setLayoutParams(slp);
        pageContainer.addView(sub);
    }

    private LinearLayout makeCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(theme.rounded(this, theme.card, theme.cardBorder, 18));
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        card.setLayoutParams(lp);
        return card;
    }

    private LinearLayout makeCardTitleRow(int iconRes, String titleText) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rlp.bottomMargin = dp(8);
        row.setLayoutParams(rlp);

        ImageView iv = theme.icon(this, iconRes, 18, theme.accent);
        LinearLayout.LayoutParams ilp = (LinearLayout.LayoutParams) iv.getLayoutParams();
        ilp.rightMargin = dp(10);
        row.addView(iv);

        TextView tv = new TextView(this);
        tv.setText(titleText);
        tv.setTextColor(theme.textPrimary);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(tv);
        return row;
    }

    private TextView makeBodyText(String text, int color) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(color);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tv.setLineSpacing(dp(3), 1.0f);
        return tv;
    }

    private EditText makeInputField(String hint, String value, boolean isPassword) {
        EditText et = new EditText(this);
        et.setHint(hint);
        et.setText(value);
        et.setHintTextColor(theme.textMuted);
        et.setTextColor(theme.textPrimary);
        et.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        et.setSingleLine(true);
        et.setInputType(isPassword
                ? (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD)
                : (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS));
        et.setBackground(theme.rounded(this, theme.inputBg, theme.inputBorder, 12));
        et.setPadding(dp(14), dp(12), dp(14), dp(12));
        et.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return et;
    }

    private LinearLayout makeHorizontalRow(int topMarginDp) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(topMarginDp);
        row.setLayoutParams(lp);
        return row;
    }

    private TextView makePillButton(String text, int fill, int textColor, int stroke, boolean fullWidth) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(textColor);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setGravity(Gravity.CENTER);
        tv.setBackground(theme.rounded(this, fill, stroke, 12));
        tv.setPadding(dp(18), dp(10), dp(18), dp(10));
        tv.setLayoutParams(new LinearLayout.LayoutParams(
                fullWidth ? ViewGroup.LayoutParams.MATCH_PARENT : ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return tv;
    }

    private TextView makePillButtonWithIcon(int iconRes, String text, int fill, int textColor, int stroke) {
        // Rendered cleanly using TextView + compoundDrawable for crisp alignment inside rounded button
        TextView tv = makePillButton(text, fill, textColor, stroke, false);
        android.graphics.drawable.Drawable d = getDrawable(iconRes);
        if (d != null) {
            android.graphics.drawable.Drawable copy = d.mutate();
            copy.setColorFilter(textColor, android.graphics.PorterDuff.Mode.SRC_IN);
            int sz = dp(16);
            copy.setBounds(0, 0, sz, sz);
            tv.setCompoundDrawables(copy, null, null, null);
            tv.setCompoundDrawablePadding(dp(8));
        }
        return tv;
    }

    private LinearLayout makeSetupRow(String label, boolean done, View.OnClickListener fixListener) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));

        FrameLayout badge = new FrameLayout(this);
        badge.setBackground(theme.circle(done ? theme.successBg : theme.warnBg));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(dp(24), dp(24));
        blp.rightMargin = dp(12);
        badge.setLayoutParams(blp);
        ImageView icon = theme.icon(this, done ? R.drawable.ic_check : R.drawable.ic_warn, 14,
                done ? theme.success : theme.warn);
        FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(dp(14), dp(14));
        ilp.gravity = Gravity.CENTER;
        icon.setLayoutParams(ilp);
        badge.addView(icon);
        row.addView(badge);

        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextColor(theme.textPrimary);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(tv);

        if (!done && fixListener != null) {
            TextView fixTv = new TextView(this);
            fixTv.setText(theme.t("Fix", "සකසන්න", "إصلاح"));
            fixTv.setTextColor(theme.accent);
            fixTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            fixTv.setTypeface(Typeface.DEFAULT_BOLD);
            fixTv.setPadding(dp(12), dp(6), dp(4), dp(6));
            fixTv.setOnClickListener(fixListener);
            row.addView(fixTv);
        }
        return row;
    }

    private interface OnOptionSelected {
        void onSelect(String id);
    }

    private LinearLayout makeSegmentedRow(
            final String[] ids, String[] labels, String selectedId, final OnOptionSelected onSelected
    ) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.HORIZONTAL);
        wrap.setBackground(theme.rounded(this, theme.inputBg, theme.cardBorder, 14));
        wrap.setPadding(dp(3), dp(3), dp(3), dp(3));
        LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wlp.topMargin = dp(6);
        wrap.setLayoutParams(wlp);

        for (int i = 0; i < ids.length; i++) {
            final String optId = ids[i];
            boolean sel = optId.equals(selectedId);
            TextView btn = new TextView(this);
            btn.setText(labels[i]);
            btn.setGravity(Gravity.CENTER);
            btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            btn.setTypeface(sel ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            btn.setTextColor(sel ? theme.accentBtnText : theme.textSecondary);
            if (sel) {
                btn.setBackground(theme.rounded(this, theme.accent, Color.TRANSPARENT, 11));
            }
            btn.setPadding(dp(8), dp(11), dp(8), dp(11));
            btn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            btn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    onSelected.onSelect(optId);
                }
            });
            wrap.addView(btn);
        }
        return wrap;
    }
}
