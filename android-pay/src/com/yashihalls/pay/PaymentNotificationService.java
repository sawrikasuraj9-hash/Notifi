package com.yashihalls.pay;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public class PaymentNotificationService extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;
        if (!PayConfigStore.isBotLinked(this)) return;

        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;

        Bundle extras = n.extras;
        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence bigTextCs = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);

        String title = titleCs != null ? titleCs.toString().trim() : "";
        String body = bigTextCs != null && bigTextCs.length() > 0
                ? bigTextCs.toString().trim()
                : (textCs != null ? textCs.toString().trim() : "");

        String fullText = (title + " " + body).trim();
        PayConfigStore.RuleItem matchedRule = PayConfigStore.matchRule(
                this, "notification", title, pkg, fullText);
        if (matchedRule != null) {
            String senderLabel = title.isEmpty() ? pkg : title;
            PayConfigStore.PaymentRecord rec = PayConfigStore.addPendingPayment(
                    this, matchedRule.name, "notification", senderLabel, pkg, fullText);
            PayWebhookClient.sendPaymentAsync(
                    getApplicationContext(),
                    rec.id,
                    "notification",
                    senderLabel,
                    pkg,
                    fullText,
                    null
            );
        }
    }
}
