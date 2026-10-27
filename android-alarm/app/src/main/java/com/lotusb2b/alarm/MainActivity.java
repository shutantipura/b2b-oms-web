package com.lotusb2b.alarm;

import android.Manifest;
import android.app.AlertDialog;
import android.text.InputType;
import android.widget.EditText;
import android.app.NotificationManager;
import android.content.Context;
import android.net.Uri;
import android.provider.Settings;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;

import java.io.IOException;

/** Lightweight Thai-language control panel for the dedicated alarm phone. */
public final class MainActivity extends Activity {
    private static final int TEAL = Color.rgb(2, 176, 175);
    private static final int INK = Color.rgb(23, 69, 63);
    private static final int SECONDARY = Color.rgb(92, 119, 111);
    private static final int WARNING = Color.rgb(182, 65, 44);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private TextView status, pending, orderNumbers, lastCheck, errorMessage;
    private Button toggle;
    private Button acknowledgeButton;
    private Button fullScreenSettings;
    private Button notificationsSettings;
    private TextView setupStatus;
    private TextView stationPairStatus;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            render();
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE);
        buildUi();
        // On first open, immediately start monitoring. Respect an explicit
        // Stop on later launches, but revive monitoring if it was enabled.
        boolean initialized = prefs.getBoolean("station_initialised_v06", false);
        boolean shouldStart = prefs.getBoolean(AlarmMonitorService.MONITORING, false)
            || !initialized;
        prefs.edit().putBoolean("station_initialised_v06", true).apply();
        if (shouldStart) sendAction(AlarmMonitorService.START);
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 44);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        handler.removeCallbacks(refresh);
        handler.post(refresh);
    }

    @Override protected void onPause() {
        handler.removeCallbacks(refresh);
        super.onPause();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(242, 248, 246));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(30), dp(18), dp(24));
        scroll.addView(root);

        root.addView(label("Lotus's B2B", 31, TEAL, true));
        root.addView(label("ORDER ALARM · STORE STATION", 12, SECONDARY, true));

        LinearLayout card = card();
        addTop(root, card, 18);
        card.addView(label("🔔 แจ้งเตือนออเดอร์ใหม่", 23, INK, true));
        addTop(card, label("ไม่ต้องเข้าสู่ระบบ · ทำงานโดยไม่ต้องเปิดเว็บไซต์", 13, SECONDARY, false), 8);
        status = label("○ ยังไม่ได้เริ่มตรวจสอบ", 16, WARNING, true);
        addTop(card, status, 20);
        pending = label("0 ออเดอร์ใหม่", 28, TEAL, true);
        addTop(card, pending, 12);
        orderNumbers = label("", 15, INK, false);
        addTop(card, orderNumbers, 5);
        lastCheck = label("ตรวจสอบล่าสุด: —", 12, SECONDARY, false);
        addTop(card, lastCheck, 12);
        errorMessage = label("", 13, WARNING, true);
        addTop(card, errorMessage, 5);
        setupStatus = label("", 12, WARNING, true);
        addTop(card, setupStatus, 8);

        toggle = button("▶ เริ่มตรวจสอบออเดอร์", TEAL, Color.WHITE);
        addTop(root, toggle, 18);
        toggle.setOnClickListener(v -> {
            boolean running = prefs.getBoolean(AlarmMonitorService.MONITORING, false);
            sendAction(running ? AlarmMonitorService.STOP : AlarmMonitorService.START);
        });

        acknowledgeButton = button("✓ รับทราบทุกเครื่อง", Color.WHITE, INK);
        addTop(root, acknowledgeButton, 10);
        acknowledgeButton.setOnClickListener(v -> {
            if (!prefs.getBoolean(AlarmMonitorService.MONITORING, false)) {
                Toast.makeText(this, "กรุณาเริ่มตรวจสอบก่อน", Toast.LENGTH_SHORT).show();
                return;
            }
            sendAction(AlarmMonitorService.ACK);
        });

        if (Build.VERSION.SDK_INT >= 34) {
            fullScreenSettings = button("🔔 เปิดแจ้งเตือนเต็มหน้าจอ", Color.rgb(255, 245, 216), INK);
            addTop(root, fullScreenSettings, 10);
            fullScreenSettings.setOnClickListener(v -> {
                Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                settingsIntent.setData(Uri.parse("package:" + getPackageName()));
                try {
                    startActivity(settingsIntent);
                } catch (RuntimeException e) {
                    Toast.makeText(this, "เปิด Settings → Apps → Special app access → Full screen alerts",
                        Toast.LENGTH_LONG).show();
                }
            });
        }

        if (Build.VERSION.SDK_INT >= 33) {
            notificationsSettings = button("🔔 เปิดสิทธิ์แจ้งเตือน Android",
                Color.rgb(225, 247, 244), INK);
            addTop(root, notificationsSettings, 10);
            notificationsSettings.setOnClickListener(v -> {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                        PackageManager.PERMISSION_GRANTED) {
                    // Android may stop showing the runtime prompt after
                    // repeated denials. Settings remains the fallback.
                    requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, 44);
                } else {
                    Intent settings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    startActivity(settings);
                }
            });
        }

        Button staffMode = button("👤 เปิด Staff Mode (OMS)", Color.WHITE, INK);
        addTop(root, staffMode, 12);
        staffMode.setOnClickListener(v -> {
            // Deliberately independent: do NOT stop background monitoring.
            startActivity(new Intent(this, StaffPortalActivity.class));
        });

        Button pairing = button("📡 จับคู่เครื่องกับ Dashboard (ทางเลือก)", Color.WHITE, INK);
        addTop(root, pairing, 12);
        pairing.setOnClickListener(v -> showPairingDialog());
        stationPairStatus = label("สถานะการจับคู่: ไม่ได้เชื่อมต่อ", 12, SECONDARY, false);
        addTop(root, stationPairStatus, 8);

        Button test = button("🔊 ทดสอบเสียงปลุก", Color.rgb(225, 247, 244), INK);
        addTop(root, test, 10);
        test.setOnClickListener(v -> {
            try {
                AlarmSound.testOnce(this);
            } catch (IOException e) {
                Toast.makeText(this, "เล่นเสียงไม่สำเร็จ: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        LinearLayout tips = card();
        addTop(root, tips, 19);
        tips.addView(label("ตั้งค่าอุปกรณ์", 17, INK, true));
        addTop(tips, label(
            "1. อนุญาตการแจ้งเตือนของแอป\n" +
            "2. เพิ่มระดับเสียงปลุก (Alarm volume)\n" +
            "3. เปิดแอปครั้งแรกเพื่อเริ่มตรวจสอบออเดอร์อัตโนมัติ\n" +
            "4. เปิดการแจ้งเตือนเต็มหน้าจอ (หากโทรศัพท์รองรับ)\n" +
            "5. ปิดหน้าจอได้ และตรวจว่าการแจ้งเตือนกำลังทำงานยังแสดงอยู่\n\n" +
            "ครั้งแรกระบบจะข้ามออเดอร์ที่เกิดก่อนเปิดแอป แต่รับออเดอร์ใหม่ทันที", 14, SECONDARY, false), 10);
        addTop(tips, label(
            "Staff Mode ใช้บัญชีพนักงานและรหัสผ่านที่ผู้จัดการกำหนดบนเว็บ OMS " +
            "เสียงเตือนยังทำงานต่อเมื่อเปิดหน้า Staff Mode", 13, INK, true), 12);
        addTop(tips, label(
            "ควรเปิด Battery → Unrestricted และต่ออินเทอร์เน็ตไว้ตลอด " +
            "ระบบตรวจทุกประมาณ 15 วินาที Android อาจหยุดบริการเมื่อ Force Stop " +
            "หรือเมื่อมีการจำกัดการใช้แบตเตอรี่\n\n" +
            "หากจับคู่กับ Dashboard แล้ว การกดรับทราบบนเครื่องใดก็ได้จะหยุดเสียงทุกเครื่องที่เชื่อมต่อ " +
            "ภายในการตรวจสอบถัดไป หากไม่จับคู่จะรับทราบเฉพาะเครื่องนี้ " +
            "ระบบรับทราบไม่เปลี่ยนสถานะคำสั่งซื้อใน OMS", 12, SECONDARY, false), 14);
        setContentView(scroll);
    }

    private void showPairingDialog() {
        EditText code = new EditText(this);
        code.setSingleLine(true);
        code.setAllCaps(true);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        code.setHint("รหัสจับคู่ 32 ตัวอักษร");
        LinearLayout container = new LinearLayout(this);
        container.setPadding(dp(18), dp(7), dp(18), 0);
        container.addView(code, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
            .setTitle("จับคู่ Alarm Station")
            .setMessage("ผู้จัดการสร้างรหัสใน OMS → ตรวจสอบเครื่องแจ้งเตือนออเดอร์\\nไม่มีผลต่อสิทธิ์ Staff Mode หรือเสียงเตือน")
            .setView(container)
            .setNegativeButton("ยกเลิก", null)
            .setPositiveButton("จับคู่", (dialog, which) ->
                StationHealth.pair(this, code.getText().toString().trim(), (ok, message) -> {
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                    render();
                }))
            .show();
    }

    private void sendAction(String action) {
        try {
            Intent intent = new Intent(this, AlarmMonitorService.class).setAction(action);
            if (AlarmMonitorService.START.equals(action)) startForegroundService(intent);
            else startService(intent);
            render();
        } catch (RuntimeException e) {
            Toast.makeText(this, "ไม่สามารถเริ่มบริการได้: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void render() {
        if (prefs == null || status == null) return;
        boolean running = prefs.getBoolean(AlarmMonitorService.MONITORING, false);
        status.setText(running ? "● กำลังตรวจสอบออเดอร์" : "○ ยังไม่ได้เปิดระบบเตือน");
        status.setTextColor(running ? TEAL : WARNING);
        toggle.setText(running ? "■ หยุดตรวจสอบออเดอร์" : "▶ เริ่มตรวจสอบออเดอร์");
        String pairedToken = prefs.getString(StationHealth.TOKEN, "");
        acknowledgeButton.setText(pairedToken != null && pairedToken.matches("[a-f0-9]{64}")
            ? "✓ รับทราบทุกเครื่อง — หยุดเสียง"
            : "✓ รับทราบเฉพาะเครื่องนี้");
        if (fullScreenSettings != null) {
            NotificationManager manager = (NotificationManager) getSystemService(
                Context.NOTIFICATION_SERVICE);
            boolean granted = manager != null && manager.canUseFullScreenIntent();
            fullScreenSettings.setText(granted
                ? "✓ อนุญาตแจ้งเตือนเต็มหน้าจอแล้ว"
                : "🔔 เปิดแจ้งเตือนเต็มหน้าจอ");
            fullScreenSettings.setEnabled(!granted);
        }
        int count = 0;
        try { count = new JSONArray(prefs.getString(AlarmMonitorService.PENDING, "[]")).length(); }
        catch (Exception ignored) {}
        pending.setText(count + " ออเดอร์ใหม่");
        pending.setTextColor(count > 0 ? WARNING : TEAL);
        String numbers = prefs.getString(AlarmMonitorService.NUMBERS, "");
        orderNumbers.setText(numbers.isEmpty() ? "พร้อมรับออเดอร์ใหม่" : numbers);
        lastCheck.setText("ตรวจสอบล่าสุด: " + prefs.getString(AlarmMonitorService.LAST_CHECK, "—"));
        if (stationPairStatus != null) {
            String label = prefs.getString(StationHealth.LABEL, "");
            String token = prefs.getString(StationHealth.TOKEN, "");
            String problem = prefs.getString(StationHealth.PAIR_ERROR, "");
            stationPairStatus.setText(token != null && !token.isEmpty()
                ? "📡 เครื่องจับคู่แล้ว: " + label + (problem.isEmpty() ? "" : " · " + problem)
                : "📡 ยังไม่ได้จับคู่ Dashboard (ไม่กระทบการแจ้งเตือน)");
        }
        String err = prefs.getString(AlarmMonitorService.LAST_ERROR, "");
        errorMessage.setText(err);
        errorMessage.setVisibility(err.isEmpty() ? View.GONE : View.VISIBLE);
        long checkedMs = prefs.getLong(AlarmMonitorService.LAST_CHECK_EPOCH, 0L);
        NotificationManager notificationManager = (NotificationManager)
            getSystemService(Context.NOTIFICATION_SERVICE);
        boolean notificationAllowed = (Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED) &&
            notificationManager != null && notificationManager.areNotificationsEnabled();
        if (notificationsSettings != null) {
            notificationsSettings.setVisibility(notificationAllowed ? View.GONE : View.VISIBLE);
        }
        StringBuilder warning = new StringBuilder();
        if (running && checkedMs <= 0L) {
            warning.append("กำลังเชื่อมต่อ OMS ครั้งแรก...");
        } else if (running && System.currentTimeMillis() - checkedMs > 90_000L) {
            warning.append("⚠ ไม่มีการตรวจสอบ OMS สำเร็จภายใน 90 วินาที");
        }
        if (!notificationAllowed) {
            if (warning.length() > 0) warning.append("\n");
            warning.append("⚠ ยังไม่อนุญาตการแจ้งเตือน Android — โปรดอนุญาตเพื่อแสดงแจ้งเตือนออเดอร์");
        }
        setupStatus.setText(warning.toString());
        setupStatus.setVisibility(warning.length() == 0 ? View.GONE : View.VISIBLE);
    }

    private int dp(int p) { return Math.round(p * getResources().getDisplayMetrics().density); }

    private TextView label(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        view.setLineSpacing(dp(2), 1f);
        return view;
    }

    private LinearLayout card() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setPadding(dp(18), dp(19), dp(18), dp(19));
        GradientDrawable style = new GradientDrawable();
        style.setColor(Color.WHITE);
        style.setCornerRadius(dp(20));
        style.setStroke(dp(1), Color.rgb(218, 233, 228));
        view.setBackground(style);
        return view;
    }

    private Button button(String value, int bg, int fg) {
        Button view = new Button(this);
        view.setText(value);
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setTextColor(fg);
        view.setMinimumHeight(dp(57));
        GradientDrawable style = new GradientDrawable();
        style.setColor(bg);
        style.setCornerRadius(dp(15));
        style.setStroke(dp(1), Color.rgb(183, 218, 208));
        view.setBackground(style);
        return view;
    }

    private void addTop(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(top);
        parent.addView(child, params);
    }
}
