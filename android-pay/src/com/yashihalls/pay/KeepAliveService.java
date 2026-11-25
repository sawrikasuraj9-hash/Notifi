package com.yashihalls.pay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public class KeepAliveService extends Service {
    private static final String CHANNEL_ID = "yashi_pay_watcher";
    private static final int NOTIF_ID = 7041;
    private static final long HEARTBEAT_MS = 5 * 60 * 1000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeatTask = new Runnable() {
        @Override
        public void run() {
            if (PayConfigStore.isServiceActive(KeepAliveService.this)) {
                PayWebhookClient.pingAsync(getApplicationContext(), null);
                handler.postDelayed(this, HEARTBEAT_MS);
            }
        }
    };

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String storeName = PayConfigStore.getStoreName(this);
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("YASHI HALLS Pay Active")
                .setContentText("Listening for SMS & Bank alerts • " + storeName)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        handler.removeCallbacks(heartbeatTask);
        handler.postDelayed(heartbeatTask, 4000L);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(heartbeatTask);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "YASHI HALLS Pay Listener",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps Business Bot payment monitoring active 24/7.");
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}
