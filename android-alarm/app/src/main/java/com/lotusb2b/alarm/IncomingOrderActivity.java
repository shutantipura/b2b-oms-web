package com.lotusb2b.alarm;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;

/**
 * Incoming-order screen, deliberately separate from the settings/home screen.
 * Can appear over the keyguard if Android grants full-screen notification access.
 * Shows order numbers only (the public station has no staff credentials).
 */
public final class IncomingOrderActivity extends Activity {
    private static final int TEAL = Color.rgb(2, 176, 175);
    private static final int INK = Color.rgb(23, 69, 63);
    private static final int BG = Color.rgb(242, 249, 247);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private TextView count;
    private TextView orders;
    private TextView ackError;
    private Button ack;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            update();
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(22), dp(30), dp(22), dp(30));
        page.setBackgroundColor(BG);

        TextView symbol = text("🔔", 72, INK, true);
        symbol.setGravity(Gravity.CENTER);
        page.addView(symbol);
        TextView title = text("มีออเดอร์ B2B ใหม่!", 27, INK, true);
        title.setGravity(Gravity.CENTER);
        add(page, title, 12);
        count = text("กำลังโหลดออเดอร์...", 24, TEAL, true);
        count.setGravity(Gravity.CENTER);
        add(page, count, 20);
        orders = text("", 18, INK, true);
        orders.setGravity(Gravity.CENTER);
        add(page, orders, 12);

        ack = button("✓ รับทราบทุกเครื่อง", TEAL, Color.WHITE);
        add(page, ack, 32);
        ack.setOnClickListener(v -> {
            Intent intent = new Intent(this, AlarmMonitorService.class);
            intent.setAction(AlarmMonitorService.ACK);
            startService(intent);
            // Wait until the service reports success and clears the pending
            // alerts; if the server is offline, keep the alarm page visible.
        });

        ackError = text("", 14, Color.rgb(180, 64, 48), true);
        ackError.setGravity(Gravity.CENTER);
        add(page, ackError, 12);

        Button back = button("กลับ (เสียงยังดังต่อ)", Color.WHITE, INK);
        add(page, back, 12);
        back.setOnClickListener(v -> finish());

        TextView foot = text(
            "การรับทราบจะหยุดเสียงทุกเครื่องที่เชื่อมต่อ (ถ้าจับคู่แล้ว)",
            13, Color.rgb(97, 124, 114), false);
        foot.setGravity(Gravity.CENTER);
        add(page, foot, 25);
        setContentView(page);
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

    private void update() {
        String numbers = prefs.getString(AlarmMonitorService.NUMBERS, "");
        int total = 0;
        try {
            total = new JSONArray(prefs.getString(AlarmMonitorService.PENDING, "[]")).length();
        } catch (Exception ignored) {}
        if (total == 0) {
            finish();
            return;
        }
        count.setText(total + " คำสั่งซื้อรอรับทราบ");
        orders.setText(numbers);
        String paired = prefs.getString(StationHealth.TOKEN, "");
        ack.setText(paired != null && paired.matches("[a-f0-9]{64}")
            ? "✓ รับทราบทุกเครื่อง — หยุดเสียง"
            : "✓ รับทราบเฉพาะเครื่องนี้");
        String error = prefs.getString(AlarmMonitorService.LAST_ERROR, "");
        ackError.setText(error);
        ackError.setVisibility(error.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private int dp(int x) {
        return Math.round(x * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(sp);
        t.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return t;
    }

    private Button button(String value, int bg, int fg) {
        Button b = new Button(this);
        b.setText(value);
        b.setAllCaps(false);
        b.setTextSize(17);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setTextColor(fg);
        b.setMinimumHeight(dp(64));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(bg);
        shape.setCornerRadius(dp(18));
        b.setBackground(shape);
        return b;
    }

    private void add(LinearLayout root, View view, int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(top);
        root.addView(view, lp);
    }
}
