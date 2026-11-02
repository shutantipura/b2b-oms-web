package com.lotusb2b.alarm;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import org.json.JSONObject;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.IOException;
import org.json.JSONArray;

/**
 * Full staff OMS inside native Android, using the existing responsive
 * Next.js staff portal rather than duplicating operations/business logic.
 *
 * Authentication remains Supabase email/password within HTTPS WebView.
 * No credentials are stored by Java code and no JavaScript bridge is exposed.
 * OMS RLS and task permissions are unchanged.
 */
public final class StaffPortalActivity extends Activity {
    private static final String BASE = "https://b2b-oms-web.vercel.app";
    private static final String HOST = "b2b-oms-web.vercel.app";
    private static final int PICK_FILE = 801;
    private static final int TEAL = Color.rgb(2, 176, 175);
    private static final int TEXT = Color.rgb(24, 70, 64);
    private WebView webView;
    private ValueCallbackFileChooser chooser;
    private Uri cameraOutput;
    private File cameraFile;
    private TextView monitorHealth;
    private Button monitorAction;
    private boolean healthNeedsSettings;
    private Button retrySession;
    private FrameLayout orderBlocker;
    private TextView alertCount;
    private TextView alertNumbers;
    private TextView alertError;
    private final Handler alarmUi = new Handler(Looper.getMainLooper());
    private final Runnable refreshAlarm = new Runnable() {
        @Override public void run() {
            renderOrderBlocker();
            alarmUi.postDelayed(this, 500);
        }
    };
    private String pendingStaffTokenHash;
    private boolean activationFailed;
    private int activationRequestId;
    private boolean activationPageReady=false;
    private String tokenAtOpen="";

    private interface ValueCallbackFileChooser {
        void finish(Uri[] result);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        tokenAtOpen=getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE)
            .getString(StationHealth.TOKEN, "");
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        buildLayout();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        configureWebView();
        if (state != null) {
            webView.restoreState(state);
        } else if (StationHealth.isDedicated(this)) {
            startStaffActivation();
        } else {
            // Legacy alarm-only stations can still log in manually.
            webView.loadUrl(BASE + "/device-login");
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 44);
        }
    }

    /** Retry uses a new one-time Supabase session without re-pairing. */
    private void startStaffActivation() {
        final int requestId = ++activationRequestId;
        activationFailed = false;
        pendingStaffTokenHash = null;
        activationPageReady = false;
        retrySession.setVisibility(View.GONE);
        webView.loadUrl(BASE + "/device-activate");
        StationHealth.getStaffSession(this, (ok, value) -> {
            if (isFinishing() || isDestroyed() || requestId != activationRequestId) return;
            if (ok) {
                pendingStaffTokenHash = value;
                deliverStaffToken();
            } else {
                activationFailed = true;
                retrySession.setVisibility(View.VISIBLE);
                Toast.makeText(this,
                    "ไม่สามารถเข้าสู่ OMS: " + value, Toast.LENGTH_LONG).show();
                webView.loadUrl(BASE + "/device-activate?error=session");
            }
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (activationFailed && StationHealth.isDedicated(this)) startStaffActivation();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private Button navButton(String title, int background, int foreground) {
        Button b = new Button(this);
        b.setText(title);
        b.setAllCaps(false);
        b.setTextSize(12);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setTextColor(foreground);
        b.setPadding(dp(7), dp(8), dp(7), dp(8));
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(background);
        drawable.setCornerRadius(dp(12));
        b.setBackground(drawable);
        return b;
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        // OMS owns its navigation. Keep only native alarm health above the
        // WebView; the fourth bottom tab opens the native Alarm controls.

        LinearLayout healthRow = new LinearLayout(this);
        healthRow.setOrientation(LinearLayout.HORIZONTAL);
        healthRow.setGravity(Gravity.CENTER_VERTICAL);
        healthRow.setPadding(dp(13), dp(6), dp(13), dp(6));
        monitorHealth = new TextView(this);
        monitorHealth.setTextSize(12);
        monitorHealth.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        healthRow.addView(monitorHealth, new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        monitorHealth.setGravity(Gravity.CENTER_VERTICAL);
        monitorHealth.setMinHeight(dp(38));
        monitorAction = navButton("ลองใหม่", Color.WHITE, TEXT);
        healthRow.addView(monitorAction, new LinearLayout.LayoutParams(dp(76), dp(38)));
        monitorAction.setOnClickListener(v -> {
            if (healthNeedsSettings) {
                startActivity(new Intent(this, MainActivity.class));
                return;
            }
            SharedPreferences prefs = getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE);
            boolean running = prefs.getBoolean(AlarmMonitorService.MONITORING, false);
            String action = running ? AlarmMonitorService.REFRESH : AlarmMonitorService.START;
            try {
                startForegroundService(new Intent(this, AlarmMonitorService.class).setAction(action));
                monitorHealth.setText("กำลังเชื่อมต่อ OMS...");
            } catch (RuntimeException e) {
                prefs.edit().putBoolean(AlarmMonitorService.MONITORING, false)
                    .putString(AlarmMonitorService.LAST_ERROR,
                        "เริ่มระบบแจ้งเตือนไม่สำเร็จ: " + e.getMessage()).apply();
            }
        });
        root.addView(healthRow);

        retrySession = navButton("↻ เชื่อมต่อบัญชี OMS อีกครั้ง", Color.rgb(255, 244, 212), TEXT);
        retrySession.setVisibility(View.GONE);
        root.addView(retrySession, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48)));
        retrySession.setOnClickListener(v -> startStaffActivation());

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        FrameLayout screen = new FrameLayout(this);
        screen.addView(root, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // An in-app alert covers, but NEVER replaces or reloads, the WebView.
        // Inputs, photo selections, uploads and scroll position stay underneath.
        orderBlocker = createOrderBlocker();
        screen.addView(orderBlocker, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        orderBlocker.setVisibility(View.GONE);
        setContentView(screen);
    }

    private FrameLayout createOrderBlocker() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.rgb(242, 249, 247));
        overlay.setClickable(true);
        overlay.setFocusable(true);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(23), dp(30), dp(23), dp(30));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(24));
        background.setStroke(dp(2), Color.rgb(173, 225, 216));
        card.setBackground(background);

        TextView bell = overlayText("🔔", 57, TEAL, true);
        card.addView(bell);
        TextView heading = overlayText("มีออเดอร์ B2B ใหม่!", 26, TEXT, true);
        addAlertChild(card, heading, 12);
        alertCount = overlayText("กำลังตรวจสอบออเดอร์", 24, TEAL, true);
        addAlertChild(card, alertCount, 18);
        alertNumbers = overlayText("", 16, TEXT, true);
        addAlertChild(card, alertNumbers, 10);

        Button ack = navButton("✓ รับทราบออเดอร์ — หยุดเสียง", TEAL, Color.WHITE);
        ack.setTextSize(20);
        ack.setMinimumHeight(dp(82));
        LinearLayout.LayoutParams ackParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(82));
        ackParams.topMargin = dp(25);
        card.addView(ack, ackParams);
        ack.setOnClickListener(v -> {
            try {
                startService(new Intent(this, AlarmMonitorService.class)
                    .setAction(AlarmMonitorService.ACK));
            } catch (RuntimeException e) {
                alertError.setText("รับทราบไม่สำเร็จ กรุณาลองอีกครั้ง");
                alertError.setVisibility(View.VISIBLE);
            }
        });
        alertError = overlayText("", 13, Color.rgb(179, 64, 48), true);
        addAlertChild(card, alertError, 13);
        TextView note = overlayText(
            "ต้องกดรับทราบก่อนกลับไปทำงาน · งานที่ทำค้างไว้จะยังอยู่", 13,
            Color.rgb(94, 123, 113), false);
        addAlertChild(card, note, 15);

        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER);
        cardParams.setMargins(dp(18), dp(18), dp(18), dp(18));
        overlay.addView(card, cardParams);
        return overlay;
    }

    private TextView overlayText(String value, int size, int color, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        text.setGravity(Gravity.CENTER);
        return text;
    }

    private void addAlertChild(LinearLayout card, View child, int margin) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        layout.topMargin = dp(margin);
        card.addView(child, layout);
    }

    private void renderOrderBlocker() {
        if (orderBlocker == null) return;
        SharedPreferences prefs = getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE);
        renderMonitorHealth(prefs);
        int count = 0;
        try { count = new JSONArray(prefs.getString(AlarmMonitorService.PENDING, "[]")).length(); }
        catch (Exception ignored) {}
        if (count == 0) {
            orderBlocker.setVisibility(View.GONE);
            return;
        }
        // Android notification dismissal never changes PENDING: only ACK can
        // remove this blocker, even if staff press Back or switch OMS pages.
        orderBlocker.setVisibility(View.VISIBLE);
        alertCount.setText(count + " ออเดอร์รอรับทราบ");
        alertNumbers.setText(prefs.getString(AlarmMonitorService.NUMBERS, ""));
        String error = prefs.getString(AlarmMonitorService.LAST_ERROR, "");
        alertError.setText(error);
        alertError.setVisibility(error.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /** This status is visible above every OMS page, not hidden in Alarm. */
    private void renderMonitorHealth(SharedPreferences prefs) {
        if (monitorHealth == null) return;
        boolean running = prefs.getBoolean(AlarmMonitorService.MONITORING, false);
        long lastSuccess = prefs.getLong(AlarmMonitorService.LAST_CHECK_EPOCH, 0L);
        String lastError = prefs.getString(AlarmMonitorService.LAST_ERROR, "");
        boolean stale = lastSuccess <= 0 ||
            System.currentTimeMillis() - lastSuccess > 90_000L;
        boolean notificationsAllowed = Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED;
        NotificationManager manager = (NotificationManager)
            getSystemService(NOTIFICATION_SERVICE);
        notificationsAllowed = notificationsAllowed && manager != null &&
            manager.areNotificationsEnabled();

        if (!running) {
            healthNeedsSettings = false;
            monitorHealth.setText("⚠ Alarm ปิดอยู่ — เครื่องนี้ไม่รับแจ้งเตือน");
            monitorHealth.setTextColor(Color.rgb(170, 49, 39));
            monitorAction.setText("เริ่ม");
            monitorAction.setVisibility(View.VISIBLE);
        } else if (stale) {
            healthNeedsSettings = false;
            monitorHealth.setText(lastSuccess <= 0 ?
                "● กำลังเชื่อมต่อ OMS ครั้งแรก..." :
                "⚠ ไม่มีการตรวจออเดอร์สำเร็จเกิน 90 วินาที");
            monitorHealth.setTextColor(lastSuccess <= 0 ?
                Color.rgb(154, 103, 22) : Color.rgb(170, 49, 39));
            monitorAction.setText("ลองใหม่");
            monitorAction.setVisibility(View.VISIBLE);
        } else if (!notificationsAllowed) {
            healthNeedsSettings = true;
            monitorHealth.setText("⚠ Android ยังไม่อนุญาตการแจ้งเตือน");
            monitorHealth.setTextColor(Color.rgb(170, 49, 39));
            monitorAction.setText("ตั้งค่า");
            monitorAction.setVisibility(View.VISIBLE);
        } else if (lastError != null && !lastError.isEmpty()) {
            healthNeedsSettings = false;
            monitorHealth.setText("⚠ Alarm: " + lastError);
            monitorHealth.setTextColor(Color.rgb(170, 49, 39));
            monitorAction.setText("ลองใหม่");
            monitorAction.setVisibility(View.VISIBLE);
        } else {
            healthNeedsSettings = false;
            String checkedAt = prefs.getString(AlarmMonitorService.LAST_CHECK, "—");
            monitorHealth.setText(AlarmHours.isQuiet() ?
                "🌙 Alarm พักเสียงตามเวลาที่ตั้งไว้" :
                "● รับออเดอร์อยู่ · ตรวจล่าสุด " + checkedAt);
            monitorHealth.setTextColor(TEAL);
            monitorAction.setVisibility(View.GONE);
        }
    }

    private boolean trusted(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && HOST.equalsIgnoreCase(uri.getHost());
    }

    private void external(Uri uri) {
        if (uri == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "ไม่สามารถเปิดลิงก์ภายนอกได้", Toast.LENGTH_LONG).show();
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) {
                    if (request.isForMainFrame() &&
                        "/device-activate".equals(request.getUrl().getPath()) &&
                        "1".equals(request.getUrl().getQueryParameter("native-retry"))) {
                        startStaffActivation();
                        return true;
                    }
                    if (request.isForMainFrame() &&
                        "/terminal-alarm".equals(request.getUrl().getPath())) {
                        // The dashboard's Alarm tile opens the native control
                        // screen without changing the in-progress OMS page.
                        startActivity(new Intent(StaffPortalActivity.this, MainActivity.class));
                        return true;
                    }
                    return false;
                }
                if (request.isForMainFrame()) external(request.getUrl());
                return true;
            }

            @Override public void onReceivedSslError(
                WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // Never permit insecure credentials/session.
                Toast.makeText(StaffPortalActivity.this,
                    "HTTPS ไม่ปลอดภัย ไม่สามารถเปิด OMS ได้", Toast.LENGTH_LONG).show();
            }

            @Override public void onPageFinished(WebView view, String url) {
                activationPageReady = url.startsWith(BASE + "/device-activate");
                deliverStaffToken();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view,
                android.webkit.ValueCallback<Uri[]> callback,
                FileChooserParams params) {

                if (chooser != null) chooser.finish(null);
                chooser = callback::onReceiveValue;
                Intent content = new Intent(Intent.ACTION_GET_CONTENT);
                content.addCategory(Intent.CATEGORY_OPENABLE);
                content.setType("*/*");
                String[] accept = params.getAcceptTypes();
                boolean imagesOnly = false;
                if (accept != null && accept.length > 0) {
                    imagesOnly = true;
                    for (String mime : accept) {
                        if (mime == null || !mime.startsWith("image/")) imagesOnly = false;
                    }
                }
                if (imagesOnly) content.setType("image/*");
                else if (accept != null && accept.length == 1 && accept[0] != null
                    && !accept[0].isEmpty()) content.setType(accept[0]);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                    content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

                Intent dialog = Intent.createChooser(content,
                    "เลือกรูปภาพหรือไฟล์สำหรับ OMS");
                cameraOutput = null;
                cameraFile = null;
                if (imagesOnly) {
                    try {
                        File directory = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                        if (directory != null) {
                            directory.mkdirs();
                            cameraFile = File.createTempFile("oms_camera_", ".jpg", directory);
                            cameraOutput = FileProvider.getUriForFile(
                                StaffPortalActivity.this,
                                getPackageName() + ".fileprovider", cameraFile);
                            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
                            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            camera.setClipData(ClipData.newUri(
                                getContentResolver(), "OMS photo", cameraOutput));
                            if (camera.resolveActivity(getPackageManager()) != null) {
                                dialog.putExtra(Intent.EXTRA_INITIAL_INTENTS,
                                    new Intent[]{camera});
                            }
                        }
                    } catch (IOException | IllegalArgumentException e) {
                        cameraOutput = null;
                    }
                }
                try {
                    startActivityForResult(dialog, PICK_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    chooser.finish(null);
                    chooser = null;
                    return false;
                }
            }
        });

        // Browser handles downloaded reports safely; URLs stay HTTPS-only.
        webView.setDownloadListener((url, userAgent, disposition, mime, len) -> {
            Uri uri = Uri.parse(url);
            if ("https".equalsIgnoreCase(uri.getScheme())) external(uri);
        });
    }

    private void deliverStaffToken() {
        if (!activationPageReady || pendingStaffTokenHash == null || webView == null)
            return;
        String code=pendingStaffTokenHash;
        pendingStaffTokenHash=null;  // One use. Never saved in SharedPreferences.
        webView.evaluateJavascript(
            "window.__terminalAuthTokenHash=" + JSONObject.quote(code)
            + ";window.dispatchEvent(new Event('terminal-auth-token'));", null);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || chooser == null) return;
        Uri[] selected = null;
        if (resultCode == RESULT_OK) {
            selected = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if ((selected == null || selected.length == 0) && cameraOutput != null &&
                cameraFile != null && cameraFile.length() > 0) {
                selected = new Uri[]{ cameraOutput };
            }
        }
        chooser.finish(selected);
        chooser = null;
        cameraOutput = null;
        cameraFile = null;
    }

    @Override protected void onResume() {
        super.onResume();
        // If this device switched its terminal identity, discard any old Staff view.
        String current=getSharedPreferences(AlarmMonitorService.PREFS, MODE_PRIVATE)
            .getString(StationHealth.TOKEN, "");
        if (tokenAtOpen==null ? current!=null : !tokenAtOpen.equals(current)) {
            if (webView!=null) webView.loadUrl("about:blank");
            finish();
            return;
        }
        alarmUi.removeCallbacks(refreshAlarm);
        alarmUi.post(refreshAlarm);
    }

    @Override protected void onPause() {
        alarmUi.removeCallbacks(refreshAlarm);
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    private void handleBack() {
        if (orderBlocker != null && orderBlocker.getVisibility() == View.VISIBLE) return;
        if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override public void onBackPressed() {
        handleBack();
    }

    @Override protected void onDestroy() {
        alarmUi.removeCallbacks(refreshAlarm);
        if (chooser != null) {
            chooser.finish(null);
            chooser = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
