package com.lotusb2b.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Best-effort restart on device boot, if monitoring was enabled. */
public final class RestartOnBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        boolean enabled = context.getSharedPreferences(
            AlarmMonitorService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(AlarmMonitorService.MONITORING, false);
        if (!enabled) return;
        Intent service = new Intent(context, AlarmMonitorService.class)
            .setAction(AlarmMonitorService.START);
        try { context.startForegroundService(service); }
        catch (RuntimeException ignored) {
            // Android may block background launches: open the app after reboot.
        }
    }
}
