package com.lotusb2b.alarm;

import android.Manifest;
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

        toggle = button("▶ เริ่มตรวจสอบออเดอร์", TEAL, Color.WHITE);
        addTop(root, toggle, 18);
        toggle.setOnClickListener(v -> {
            boolean running = prefs.getBoolean(AlarmMonitorService.MONITORING, false);
            sendAction(running ? AlarmMonitorService.STOP : AlarmMonitorService.START);
        });

        Button acknowledge = button("✓ รับทราบทั้งหมดบนเครื่องนี้", Color.WHITE, INK);
        addTop(root, acknowledge, 10);
        acknowledge.setOnClickListener(v -> {
            if (!prefs.getBoolean(AlarmMonitorService.MONITORING, false)) {
                Toast.makeText(this, "กรุณาเริ่มตรวจสอบก่อน", Toast.LENGTH_SHORT).show();
                return;
            }
            sendAction(AlarmMonitorService.ACK);
        });

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
            "3. กด เริ่มตรวจสอบออเดอร์\n" +
            "4. ปิดหน้าจอได้ และตรวจว่าการแจ้งเตือนกำลังทำงานยังแสดงอยู่\n\n" +
            "ครั้งแรกระบบจะข้ามออเดอร์เก่าที่ค้างแจ้งเตือน และเริ่มรับออเดอร์ใหม่", 14, SECONDARY, false), 10);
        addTop(tips, label(
            "ควรเปิด Battery → Unrestricted และต่ออินเทอร์เน็ตไว้ตลอด " +
            "ระบบตรวจทุกประมาณ 15 วินาที Android อาจหยุดบริการเมื่อ Force Stop " +
            "หรือเมื่อมีการจำกัดการใช้แบตเตอรี่\n\n" +
            "การรับทราบมีผลเฉพาะเครื่องนี้ ไม่เปลี่ยนสถานะ OMS", 12, SECONDARY, false), 14);
        setContentView(scroll);
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
        int count = 0;
        try { count = new JSONArray(prefs.getString(AlarmMonitorService.PENDING, "[]")).length(); }
        catch (Exception ignored) {}
        pending.setText(count + " ออเดอร์ใหม่");
        pending.setTextColor(count > 0 ? WARNING : TEAL);
        String numbers = prefs.getString(AlarmMonitorService.NUMBERS, "");
        orderNumbers.setText(numbers.isEmpty() ? "พร้อมรับออเดอร์ใหม่" : numbers);
        lastCheck.setText("ตรวจสอบล่าสุด: " + prefs.getString(AlarmMonitorService.LAST_CHECK, "—"));
        String err = prefs.getString(AlarmMonitorService.LAST_ERROR, "");
        errorMessage.setText(err);
        errorMessage.setVisibility(err.isEmpty() ? View.GONE : View.VISIBLE);
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
