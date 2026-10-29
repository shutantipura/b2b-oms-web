package com.lotusb2b.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** User-initiated, visibly running native background order alarm station. */
public final class AlarmMonitorService extends Service {
    static final String PREFS = "lotus_b2b_alarm";
    static final String MONITORING = "monitoring";
    static final String PENDING = "pending";
    static final String NUMBERS = "pending_numbers";
    static final String LAST_CHECK = "last_check";
    static final String LAST_CHECK_EPOCH = "last_check_epoch";
    static final String LAST_ERROR = "last_error";
    static final String START = "com.lotusb2b.alarm.START";
    static final String STOP = "com.lotusb2b.alarm.STOP";
    static final String ACK = "com.lotusb2b.alarm.ACK";
    private static final String FEED = "https://b2b-oms-web.vercel.app/api/order-alarm/feed";
    private static final String SEEN = "seen_alert_ids";
    private static final String BASELINED = "initial_backlog_suppressed";
    private static final String FIRST_ACTIVATED = "first_monitor_activation_ms";
    private static final String MONITOR_CHANNEL = "oms_monitor_v1";
    private static final String ALERT_CHANNEL = "oms_alert_popup_v2";
    private static final int MONITOR_NOTICE = 1001, ALERT_NOTICE = 1002;
    private static final long POLL_MS = 15000;
    private static final long QUIET_POLL_MS = 60000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final Set<String> seen = new LinkedHashSet<>();
    private final List<Entry> pending = new ArrayList<>();
    private SharedPreferences prefs;
    private NotificationManager notices;
    private AlarmSound alarm;
    private Runnable pollingTask;
    private Runnable quietHoursTransition;
    private volatile boolean running;
    private boolean ringing;
    private String lastNotifiedAlertIds = "";
    private long lastStationHeartbeat = 0;
    private boolean acknowledgementInProgress = false;
    private final List<Entry> lastReceived = new ArrayList<>();

    private static final class Entry {
        final String id;
        final long number;
        final long createdAtMs;
        Entry(String id, long number, long createdAtMs) {
            this.id = id;
            this.number = number;
            this.createdAtMs = createdAtMs;
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        notices = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        alarm = new AlarmSound(this);
        try {
            JSONArray stored = new JSONArray(prefs.getString(SEEN, "[]"));
            for (int i = 0; i < stored.length(); i++) seen.add(stored.getString(i));
        } catch (Exception ignored) {}
        NotificationChannel monitoring = new NotificationChannel(MONITOR_CHANNEL,
            "B2B monitoring", NotificationManager.IMPORTANCE_LOW);
        notices.createNotificationChannel(monitoring);
        NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL,
            "Urgent B2B order alarms", NotificationManager.IMPORTANCE_HIGH);
        alerts.setSound(null, null); // Looping audio is managed by the foreground service.
        alerts.enableVibration(true);
        notices.createNotificationChannel(alerts);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? START : intent.getAction();
        if (STOP.equals(action)) {
            stopMonitoring();
            return START_NOT_STICKY;
        }
        if (ACK.equals(action)) {
            acknowledge();
            return START_STICKY;
        }
        startMonitoring();
        return START_STICKY;
    }

    private void startMonitoring() {
        if (running) return;
        running = true;
        SharedPreferences.Editor starting = prefs.edit().putBoolean(MONITORING, true);
        // Do this at service activation, not the first successful network
        // response: orders arriving while the first request is in flight
        // must still ring.
        if (!prefs.getBoolean(BASELINED, false) &&
            !prefs.contains(FIRST_ACTIVATED))
            starting.putLong(FIRST_ACTIVATED, System.currentTimeMillis());
        starting.apply();
        try {
            Notification notice = monitorNotification("กำลังเชื่อมต่อกับ OMS");
            if (Build.VERSION.SDK_INT >= 34)
                startForeground(MONITOR_NOTICE, notice,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else
                startForeground(MONITOR_NOTICE, notice);
        } catch (RuntimeException e) {
            running = false;
            prefs.edit().putBoolean(MONITORING, false)
                .putString(LAST_ERROR, "ไม่สามารถเปิดบริการ Android: " + e.getMessage()).apply();
            stopSelf();
            return;
        }

        pollingTask = new Runnable() {
            @Override public void run() {
                if (!running) return;
                // This check silences even if the OMS is temporarily unreachable.
                if (AlarmHours.isQuiet()) silenceUrgentAlarm();
                pollOrders();
                main.postDelayed(this, AlarmHours.isQuiet() ? QUIET_POLL_MS : POLL_MS);
            }
        };
        main.post(pollingTask);
        scheduleQuietHoursTransition();
    }

    private void scheduleQuietHoursTransition() {
        if (quietHoursTransition != null) main.removeCallbacks(quietHoursTransition);
        quietHoursTransition = () -> {
            if (!running) return;
            if (AlarmHours.isQuiet()) silenceUrgentAlarm();
            updateMonitor();
            // At 07:00 fetch the overnight queue immediately; at 22:00
            // refresh the feed but never play audible alerts.
            pollOrders();
            scheduleQuietHoursTransition();
        };
        main.postDelayed(quietHoursTransition, AlarmHours.millisUntilTransition());
    }

    private void silenceUrgentAlarm() {
        alarm.stop();
        ringing = false;
        lastNotifiedAlertIds = "";
        notices.cancel(ALERT_NOTICE);
    }

    private void pollOrders() {
        work.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection)new URL(FEED).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(7000);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Cache-Control", "no-cache");
                int status = conn.getResponseCode();
                if (status != 200) throw new Exception("OMS HTTP " + status);
                StringBuilder json = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                        conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) json.append(line);
                }
                JSONArray alerts = new JSONObject(json.toString()).getJSONArray("alerts");
                List<Entry> received = new ArrayList<>();
                for (int i = 0; i < alerts.length(); i++) {
                    JSONObject item = alerts.getJSONObject(i);
                    String id = item.getString("alert_id");
                    long number = item.getLong("order_number");
                    long createdAtMs = 0L;
                    try {
                        createdAtMs = OffsetDateTime.parse(
                            item.getString("created_at")).toInstant().toEpochMilli();
                    } catch (Exception invalidTimestamp) {
                        // Invalid timestamps cannot safely bypass initial
                        // backlog suppression.
                    }
                    if (id.matches("[0-9a-fA-F-]{36}") && number > 0)
                        received.add(new Entry(id, number, createdAtMs));
                }
                main.post(() -> applyAlerts(received));
            } catch (Exception e) {
                main.post(() -> {
                    if (!running) return;
                    String errorMessage = "เชื่อมต่อ OMS ไม่สำเร็จ กำลังลองใหม่: " + e.getMessage();
                    prefs.edit().putString(LAST_ERROR, errorMessage).apply();
                    reportStationHealth(false, errorMessage);
                    updateMonitor();
                });
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void applyAlerts(List<Entry> received) {
        if (!running) return;
        lastReceived.clear();
        lastReceived.addAll(received);
        // Skip only alerts created BEFORE this app first began monitoring,
        // without losing orders that arrived during its first network check.
        if (!prefs.getBoolean(BASELINED, false)) {
            long activatedAt = prefs.getLong(FIRST_ACTIVATED,
                System.currentTimeMillis());
            for (Entry e : received) {
                if (e.createdAtMs <= 0 || e.createdAtMs < activatedAt)
                    seen.add(e.id);
            }
            storeSeen();
            prefs.edit().putBoolean(BASELINED, true).apply();
        }

        pending.clear();
        for (Entry e : received) if (!seen.contains(e.id)) pending.add(e);
        JSONArray ids = new JSONArray();
        StringBuilder numbers = new StringBuilder();
        for (Entry e : pending) {
            ids.put(e.id);
            if (numbers.length() > 0) numbers.append(", ");
            numbers.append("#").append(e.number);
        }
        String at = new SimpleDateFormat("HH:mm:ss", new Locale("th", "TH"))
            .format(new Date());
        prefs.edit()
            .putString(PENDING, ids.toString())
            .putString(NUMBERS, numbers.toString())
            .putString(LAST_CHECK, at)
            .putLong(LAST_CHECK_EPOCH, System.currentTimeMillis())
            .putString(LAST_ERROR, "")
            .apply();

        if (pending.isEmpty() || AlarmHours.isQuiet()) {
            silenceUrgentAlarm();
        } else {
            if (!ringing || !alarm.isActive()) {
                try {
                    alarm.startRepeating();
                    ringing = alarm.isActive();
                } catch (Exception e) {
                    prefs.edit().putString(LAST_ERROR,
                        "เปิดเสียงไม่ได้: " + e.getMessage()).apply();
                }
            }
            // Avoid redisplaying the full-screen alarm at every 15s poll.
            // Only new/changed incoming alerts update the urgent notification.
            String currentIds = ids.toString();
            if (!currentIds.equals(lastNotifiedAlertIds)) {
                lastNotifiedAlertIds = currentIds;
                notices.notify(ALERT_NOTICE, newAlertNotification());
            }
        }
        reportStationHealth(true, prefs.getString(LAST_ERROR, ""));
        updateMonitor();
    }

    private void reportStationHealth(boolean pollOk, String lastError) {
        long now = android.os.SystemClock.elapsedRealtime();
        if (lastStationHeartbeat != 0 && now - lastStationHeartbeat < 45_000) return;
        lastStationHeartbeat = now;
        StationHealth.report(this, true, pollOk, pending.size(), lastError);
    }

    private void acknowledge() {
        if (acknowledgementInProgress || pending.isEmpty()) return;
        // Without pairing, preserve the older local-only acknowledgement behavior.
        // Every station must be paired for its button to stop other stations.
        String pairedToken = prefs.getString(StationHealth.TOKEN, "");
        if (pairedToken == null || !pairedToken.matches("[a-f0-9]{64}")) {
            List<Entry> onlyHere = new ArrayList<>(pending);
            markSeenLocally(onlyHere);
            prefs.edit().putString(LAST_ERROR,
                "รับทราบเฉพาะเครื่องนี้ · จับคู่เครื่องเพื่อรับทราบทุกเครื่อง").apply();
            return;
        }

        acknowledgementInProgress = true;
        List<Entry> requested = new ArrayList<>(pending);
        List<String> ids = new ArrayList<>();
        for (Entry e : requested) ids.add(e.id);
        StationHealth.acknowledge(this, ids, (success, message) -> {
            acknowledgementInProgress = false;
            if (!running) return;
            if (success) {
                // Mark only the alerts that were actually sent to the server,
                // leaving newly arrived orders ringing and visible.
                markSeenLocally(requested);
                pollOrders(); // Promptly refresh the shared feed.
            } else {
                prefs.edit().putString(LAST_ERROR,
                    "รับทราบทุกเครื่องไม่สำเร็จ: " + message +
                    " · เสียงเตือนยังทำงานอยู่").apply();
                updateMonitor();
            }
        });
    }

    private void markSeenLocally(List<Entry> dismissed) {
        for (Entry e : dismissed) seen.add(e.id);
        storeSeen();
        // Rebuild without clearing alerts received while ACK was in flight.
        applyAlerts(new ArrayList<>(lastReceived));
    }

    private void storeSeen() {
        JSONArray ids = new JSONArray();
        int skip = Math.max(0, seen.size() - 1500), i = 0;
        for (String id : seen) if (i++ >= skip) ids.put(id);
        prefs.edit().putString(SEEN, ids.toString()).apply();
        if (skip > 0) {
            seen.clear();
            for (int j = 0; j < ids.length(); j++) seen.add(ids.optString(j));
        }
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        return PendingIntent.getActivity(this, 100, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Open the incoming-order screen directly, not the configuration/home activity. */
    private PendingIntent openIncomingOrder() {
        Intent intent = new Intent(this, IncomingOrderActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 102, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent acknowledgeAction() {
        Intent intent = new Intent(this, AlarmMonitorService.class).setAction(ACK);
        return PendingIntent.getService(this, 101, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification monitorNotification(String text) {
        return new Notification.Builder(this, MONITOR_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Lotus's B2B Alarm — กำลังทำงาน")
            .setContentText(text)
            .setContentIntent(openApp())
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build();
    }

    private Notification newAlertNotification() {
        PendingIntent incoming = openIncomingOrder();
        String pairingToken = prefs.getString(StationHealth.TOKEN, "");
        boolean paired = pairingToken != null && pairingToken.matches("[a-f0-9]{64}");
        String numbers = prefs.getString(NUMBERS, "");
        if (numbers.length() > 125) numbers = numbers.substring(0, 125) + "…";
        Notification.Builder builder = new Notification.Builder(this, ALERT_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("🔔 มีออเดอร์ B2B ใหม่!")
            .setContentText(pending.size() + " ออเดอร์รอรับทราบ • แตะเพื่อดู")
            .setStyle(new Notification.BigTextStyle().bigText(
                pending.size() + " ออเดอร์รอรับทราบ: " + numbers))
            .setContentIntent(incoming)
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_view, "ดูออเดอร์", incoming).build())
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel,
                paired ? "✓ รับทราบทุกเครื่อง" : "✓ รับทราบเครื่องนี้",
                acknowledgeAction()).build())
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(true);

        // Android 14+ controls whether a full-screen alarm may appear over
        // the lockscreen. Without permission the user gets a heads-up
        // notification with the same direct acknowledgement action.
        if (Build.VERSION.SDK_INT < 34 || notices.canUseFullScreenIntent()) {
            builder.setFullScreenIntent(incoming, true);
        }
        return builder.build();
    }

    private void updateMonitor() {
        if (!running) return;
        String text = AlarmHours.isQuiet() ? "พักเสียง 22:00–07:00 (เวลาไทย)" :
            pending.isEmpty() ? "พร้อมรับออเดอร์ใหม่" :
            pending.size() + " ออเดอร์ยังไม่ได้รับทราบ";
        notices.notify(MONITOR_NOTICE, monitorNotification(text));
    }

    private void stopMonitoring() {
        running = false;
        prefs.edit().putBoolean(MONITORING, false)
            .putString(PENDING, "[]").putString(NUMBERS, "").apply();
        if (pollingTask != null) main.removeCallbacks(pollingTask);
        if (quietHoursTransition != null) main.removeCallbacks(quietHoursTransition);
        StationHealth.report(this, false, false, 0, "");
        alarm.stop();
        ringing = false;
        lastNotifiedAlertIds = "";
        acknowledgementInProgress = false;
        notices.cancel(ALERT_NOTICE);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        running = false;
        if (pollingTask != null) main.removeCallbacks(pollingTask);
        if (quietHoursTransition != null) main.removeCallbacks(quietHoursTransition);
        alarm.stop();
        work.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
