package com.lotusb2b.alarm;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** First-run enrollment gate. A paired terminal always launches the OMS. */
public final class LauncherActivity extends Activity {
    private static final int INK = Color.rgb(23, 69, 63);
    private static final int TEAL = Color.rgb(2, 176, 175);
    private SharedPreferences prefs;
    private Button pairButton;
    private TextView error;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE);
        if (isPaired()) {
            openOms();
        } else {
            showPairing();
        }
    }

    private boolean isPaired() {
        String token = prefs.getString(StationHealth.TOKEN, "");
        return token != null && token.matches("[a-f0-9]{64}");
    }

    private void openOms() {
        // Preserve an explicit Stop from the Alarm menu on later launches.
        boolean initialized = prefs.getBoolean("station_initialised_v06", false);
        boolean start = prefs.getBoolean(AlarmMonitorService.MONITORING, false) || !initialized;
        prefs.edit().putBoolean("station_initialised_v06", true).apply();
        if (start) {
            try {
                startForegroundService(new Intent(this, AlarmMonitorService.class)
                    .setAction(AlarmMonitorService.START));
            } catch (RuntimeException ignored) {
                // Alarm menu displays the service error and a manual Start action.
            }
        }
        Intent portal = new Intent(this, StaffPortalActivity.class);
        // Reuse the existing OMS WebView if the launcher icon is tapped again;
        // never reload a form and discard photos or unsaved input.
        portal.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(portal);
        finish();
    }

    private void showPairing() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp(25), dp(36), dp(25), dp(36));
        root.setBackgroundColor(Color.rgb(242, 249, 247));

        TextView brand = text("Lotus’s B2B", 33, TEAL, true);
        root.addView(brand);
        TextView title = text("จับคู่อุปกรณ์หน้าร้าน", 25, INK, true);
        add(root, title, 22);
        TextView help = text("กรอกรหัส 6 หลักจาก Manager → อุปกรณ์หน้าร้าน", 15,
            Color.rgb(89, 116, 109), false);
        add(root, help, 10);

        EditText code = new EditText(this);
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setSingleLine(true);
        code.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        code.setHint("รหัสจับคู่ 6 หลัก");
        code.setTextSize(23);
        code.setGravity(Gravity.CENTER);
        code.setContentDescription("รหัสจับคู่อุปกรณ์ 6 หลัก");
        add(root, code, 32);

        pairButton = new Button(this);
        pairButton.setText("จับคู่และเข้าใช้งาน OMS");
        pairButton.setAllCaps(false);
        pairButton.setTextSize(19);
        pairButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        pairButton.setTextColor(Color.WHITE);
        pairButton.setMinimumHeight(dp(76));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(TEAL);
        shape.setCornerRadius(dp(18));
        pairButton.setBackground(shape);
        pairButton.setEnabled(false);
        add(root, pairButton, 18);

        error = text("", 14, Color.rgb(178, 65, 44), true);
        error.setVisibility(android.view.View.GONE);
        add(root, error, 12);
        code.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                pairButton.setEnabled(s.length() == 6);
                error.setVisibility(android.view.View.GONE);
            }
            @Override public void afterTextChanged(Editable s) {}
        });
        pairButton.setOnClickListener(v -> {
            String value = code.getText().toString();
            if (!value.matches("[0-9]{6}")) return;
            pairButton.setEnabled(false);
            pairButton.setText("กำลังจับคู่อุปกรณ์...");
            StationHealth.pair(this, value, (success, message) -> {
                if (isFinishing() || isDestroyed()) return;
                if (success) {
                    openOms();
                } else {
                    pairButton.setText("จับคู่และเข้าใช้งาน OMS");
                    pairButton.setEnabled(true);
                    error.setText(message);
                    error.setVisibility(android.view.View.VISIBLE);
                }
            });
        });
        setContentView(root);
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return view;
    }

    private void add(LinearLayout parent, android.view.View child, int margin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(margin);
        parent.addView(child, params);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
