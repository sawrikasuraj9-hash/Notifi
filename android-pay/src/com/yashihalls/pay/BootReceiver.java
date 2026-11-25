package com.yashihalls.pay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (PayConfigStore.isServiceActive(context)) {
            PayConfigStore.appendLog(context, "Boot auto-start triggered");
            KeepAliveService.start(context);
        }
    }
}
