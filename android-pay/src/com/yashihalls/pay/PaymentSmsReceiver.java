package com.yashihalls.pay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public class PaymentSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }
        if (!PayConfigStore.isBotLinked(context)) {
            return;
        }

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        String sender = "";
        StringBuilder fullBody = new StringBuilder();
        for (SmsMessage sms : messages) {
            if (sms == null) continue;
            if (sender.isEmpty() && sms.getDisplayOriginatingAddress() != null) {
                sender = sms.getDisplayOriginatingAddress().trim();
            }
            if (sms.getMessageBody() != null) {
                fullBody.append(sms.getMessageBody());
            }
        }

        String rawText = fullBody.toString().trim();
        PayConfigStore.RuleItem matchedRule = PayConfigStore.matchRule(
                context, "sms", sender, "android.telephony.sms", rawText);
        if (matchedRule != null) {
            PayConfigStore.PaymentRecord rec = PayConfigStore.addPendingPayment(
                    context, matchedRule.name, "sms", sender, "android.telephony.sms", rawText);
            final PendingResult pending = goAsync();
            PayWebhookClient.sendPaymentAsync(
                    context.getApplicationContext(),
                    rec.id,
                    "sms",
                    sender,
                    "android.telephony.sms",
                    rawText,
                    new PayWebhookClient.Callback() {
                        @Override
                        public void onComplete(boolean ok, String message) {
                            try { pending.finish(); } catch (Throwable ignored) {}
                        }
                    }
            );
        }
    }
}
