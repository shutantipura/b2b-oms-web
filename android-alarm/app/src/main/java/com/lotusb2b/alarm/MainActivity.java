package com.lotusb2b.alarm;

import android.Manifest;
import android.app.AlertDialog;
import android.text.InputFilter;
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
    private Button startMonitoringButton;
    private Button stopMonitoringButton;
    private Button acknowledgeButton;
    private Button pairingButton;
    private Button unpairButton;
    private Button toolsToggle;
    private LinearLayout toolsPanel;
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

        root.addView(label("Lotus’s B2B", 31, TEAL, true));
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

        // Only show acknowledgement when it is actionable. Keep this large
        // and directly beneath the incoming-order count during an alert.
        acknowledgeButton = prominentButton("✓ รับทราบออเดอร์", Color.rgb(255, 192, 37), INK);
        addTop(root, acknowledgeButton, 14);
        acknowledgeButton.setOnClickListener(v -> {
            if (!prefs.getBoolean(AlarmMonitorService.MONITORING, false)) {
                Toast.makeText(this, "กรุณาเริ่มตรวจสอบก่อน", Toast.LENGTH_SHORT).show();
                return;
            }
            sendAction(AlarmMonitorService.ACK);
        });

        // Staff Mode is the everyday action. Alarm monitoring continues in the
        // foreground service when this portal is opened.
        Button staffMode = prominentButton("👤 เปิด Staff Mode (OMS)", TEAL, Color.WHITE);
        addTop(root, staffMode, 14);
        staffMode.setOnClickListener(v ->
            startActivity(new Intent(this, StaffPortalActivity.class)));

        // Auto-monitoring should almost never be stopped. If it has been
        // stopped, however, the recovery action must be immediately visible.
        startMonitoringButton = prominentButton("▶ เริ่มการแจ้งเตือนออเดอร์", TEAL, Color.WHITE);
        addTop(root, startMonitoringButton, 10);
        startMonitoringButton.setOnClickListener(v -> sendAction(AlarmMonitorService.START));

        stationPairStatus = label("สถานะการจับคู่: ไม่ได้เชื่อมต่อ", 12, SECONDARY, false);
        addTop(root, stationPairStatus, 16);
        pairingButton = compactButton("📱 ลงทะเบียนอุปกรณ์หน้าร้าน", Color.WHITE, INK);
        addTop(root, pairingButton, 8);
        pairingButton.setOnClickListener(v -> showPairingDialog());

        if (Build.VERSION.SDK_INT >= 34) {
            fullScreenSettings = compactButton("🔔 เปิดแจ้งเตือนเต็มหน้าจอ", Color.rgb(255, 245, 216), INK);
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
            notificationsSettings = compactButton("🔔 เปิดสิทธิ์แจ้งเตือน Android",
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

        toolsToggle = compactButton("⚙ ตั้งค่าและทดสอบ ▾", Color.WHITE, SECONDARY);
        addTop(root, toolsToggle, 16);
        toolsPanel = card();
        toolsPanel.setVisibility(View.GONE);
        addTop(root, toolsPanel, 8);
        toolsToggle.setOnClickListener(v -> {
            boolean opening = toolsPanel.getVisibility() != View.VISIBLE;
            toolsPanel.setVisibility(opening ? View.VISIBLE : View.GONE);
            toolsToggle.setText(opening ? "⚙ ซ่อนการตั้งค่า ▴" : "⚙ ตั้งค่าและทดสอบ ▾");
        });

        toolsPanel.addView(label("การจัดการอุปกรณ์", 16, INK, true));
        stopMonitoringButton = compactButton("■ หยุดแจ้งเตือนออเดอร์ชั่วคราว",
            Color.rgb(250, 247, 241), SECONDARY);
        addTop(toolsPanel, stopMonitoringButton, 10);
        stopMonitoringButton.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("หยุดการแจ้งเตือนออเดอร์?")
            .setMessage("เครื่องนี้จะไม่ส่งเสียงเมื่อมีออเดอร์ใหม่จนกว่าจะเปิดการแจ้งเตือนอีกครั้ง")
            .setNegativeButton("ยกเลิก", null)
            .setPositiveButton("หยุดชั่วคราว", (dialog, which) ->
                sendAction(AlarmMonitorService.STOP))
            .show());

        unpairButton = compactButton("↪ ยกเลิกการจับคู่ / เปลี่ยนบัญชี",
            Color.rgb(250, 247, 241), SECONDARY);
        addTop(toolsPanel, unpairButton, 10);
        unpairButton.setOnClickListener(v -> showUnpairDialog());

        Button test = compactButton("🔊 ทดสอบเสียง (2 ครั้ง)", Color.rgb(225, 247, 244), INK);
        addTop(toolsPanel, test, 10);
        test.setOnClickListener(v -> {
            try {
                AlarmSound.testOnce(this);
            } catch (IOException e) {
                Toast.makeText(this, "เล่นเสียงไม่สำเร็จ: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        LinearLayout tips = toolsPanel;
        addTop(tips, label("วิธีตั้งค่าอุปกรณ์", 16, INK, true), 20);
        addTop(tips, label(
            "1. อนุญาตการแจ้งเตือนของแอป\n" +
            "2. เพิ่มระดับเสียงปลุก (Alarm volume)\n" +
            "3. เปิดแอปครั้งแรกเพื่อเริ่มตรวจสอบออเดอร์อัตโนมัติ\n" +
            "4. เปิดการแจ้งเตือนเต็มหน้าจอ (หากโทรศัพท์รองรับ)\n" +
            "5. ปิดหน้าจอได้ และตรวจว่าการแจ้งเตือนกำลังทำงานยังแสดงอยู่\n\n" +
            "ครั้งแรกระบบจะข้ามออเดอร์ที่เกิดก่อนเปิดแอป แต่รับออเดอร์ใหม่ทันที", 14, SECONDARY, false), 10);
        addTop(tips, label(
            "อุปกรณ์หน้าร้านใช้รหัสลงทะเบียนจาก Manager ครั้งเดียว " +
            "และ Staff Mode จะเข้าสู่บัญชีประจำเครื่องอัตโนมัติ โดยเสียงเตือนยังทำงานต่อ", 13, INK, true), 12);
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
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        code.setHint("รหัสจับคู่ตัวเลข 6 หลัก");
        LinearLayout container = new LinearLayout(this);
        container.setPadding(dp(18), dp(7), dp(18), 0);
        container.addView(code, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
            .setTitle("ลงทะเบียนอุปกรณ์หน้าร้าน")
            .setMessage("Manager สร้างบัญชีและรหัสจับคู่ที่หน้า อุปกรณ์หน้าร้าน\nStaff Mode จะเชื่อมบัญชีประจำเครื่อง")
            .setView(container)
            .setNegativeButton("ยกเลิก", null)
            .setPositiveButton("จับคู่", (dialog, which) ->
                StationHealth.pair(this, code.getText().toString().trim(), (ok, message) -> {
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                    render();
                    if (ok && StationHealth.isDedicated(this)) {
                        startActivity(new Intent(this, StaffPortalActivity.class));
                    }
                }))
            .show();
    }

    private void showUnpairDialog() {
        String label = prefs.getString(StationHealth.LABEL, "บัญชีเดิม");
        new AlertDialog.Builder(this)
            .setTitle("ยกเลิกการจับคู่เครื่อง")
            .setMessage("ยกเลิกการจับคู่ " + label +
                " และปิดบัญชี Staff เดิม?\n\nข้อมูลคำสั่งซื้อจะไม่ถูกลบ " +
                "แต่ต้องให้ Manager ออกรหัสใหม่ก่อนใช้บัญชีอื่น " +
                "ระบบแจ้งเตือนยังทำงาน แต่การรับทราบข้ามเครื่องจะหยุดจนกว่าจะจับคู่ใหม่")
            .setNegativeButton("กลับ", null)
            .setPositiveButton("ยกเลิกการจับคู่", (dialog, which) -> {
                unpairButton.setEnabled(false);
                StationHealth.unpair(this, (ok, message) -> {
                    unpairButton.setEnabled(true);
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                    render();
                });
            }).show();
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
        boolean quiet = running && AlarmHours.isQuiet();
        status.setText(!running ? "○ ยังไม่ได้เปิดระบบเตือน" :
            quiet ? "🌙 พักเสียง 22:00–07:00 (เวลาไทย)" : "● กำลังตรวจสอบออเดอร์");
        status.setTextColor(!running ? WARNING : quiet ? SECONDARY : TEAL);
        startMonitoringButton.setVisibility(running ? View.GONE : View.VISIBLE);
        stopMonitoringButton.setVisibility(running ? View.VISIBLE : View.GONE);
        String pairedToken = prefs.getString(StationHealth.TOKEN, "");
        boolean paired = pairedToken != null && pairedToken.matches("[a-f0-9]{64}");
        if (pairingButton != null) pairingButton.setVisibility(paired ? View.GONE : View.VISIBLE);
        if (unpairButton != null) unpairButton.setVisibility(paired ? View.VISIBLE : View.GONE);
        acknowledgeButton.setText(pairedToken != null && pairedToken.matches("[a-f0-9]{64}")
            ? "✓ รับทราบทุกเครื่อง — หยุดเสียง"
            : "✓ รับทราบเฉพาะเครื่องนี้");
        if (fullScreenSettings != null) {
            NotificationManager manager = (NotificationManager) getSystemService(
                Context.NOTIFICATION_SERVICE);
            boolean granted = manager != null && manager.canUseFullScreenIntent();
            fullScreenSettings.setVisibility(granted ? View.GONE : View.VISIBLE);
            fullScreenSettings.setEnabled(!granted);
        }
        int count = 0;
        try { count = new JSONArray(prefs.getString(AlarmMonitorService.PENDING, "[]")).length(); }
        catch (Exception ignored) {}
        acknowledgeButton.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
        acknowledgeButton.setEnabled(running);
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
                ? (StationHealth.isDedicated(this) ? "📱 บัญชีประจำเครื่อง: " : "📡 เครื่องจับคู่แล้ว: ")
                    + label + (problem.isEmpty() ? "" : " · " + problem)
                : "📱 ยังไม่ได้ลงทะเบียน (Alarm ใช้งานได้โดยไม่ลงทะเบียน)");
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

    private Button prominentButton(String value, int bg, int fg) {
        Button view = button(value, bg, fg);
        view.setTextSize(19);
        view.setMinimumHeight(dp(76));
        view.setPadding(dp(16), dp(14), dp(16), dp(14));
        return view;
    }

    private Button compactButton(String value, int bg, int fg) {
        Button view = button(value, bg, fg);
        view.setTextSize(13);
        view.setMinimumHeight(dp(46));
        view.setPadding(dp(12), dp(8), dp(12), dp(8));
        return view;
    }

    private void addTop(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(top);
        parent.addView(child, params);
    }
}
