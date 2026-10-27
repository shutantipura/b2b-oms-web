package com.lotusb2b.alarm;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipData;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowManager;
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
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.IOException;

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
    private TextView title;
    private String pendingStaffTokenHash;
    private boolean activationPageReady=false;

    private interface ValueCallbackFileChooser {
        void finish(Uri[] result);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        buildLayout();
        configureWebView();
        if (state != null) {
            webView.restoreState(state);
        } else if (StationHealth.isDedicated(this)) {
            // One-time terminal enrollment replaces daily OMS credentials.
            // A short-lived OTP is generated server-side; no staff password
            // is ever stored on the Android terminal.
            webView.loadUrl(BASE + "/device-activate");
            StationHealth.getStaffSession(this, (ok, value) -> {
                if (isFinishing() || isDestroyed()) return;
                if (ok) {
                    pendingStaffTokenHash=value;
                    deliverStaffToken();
                } else {
                    Toast.makeText(this,
                        "ไม่สามารถเข้าสู่ Staff Mode: " + value, Toast.LENGTH_LONG).show();
                    webView.loadUrl(BASE + "/device-activate?error=session");
                }
            });
        } else {
            // Legacy alarm-only stations can still log in manually.
            webView.loadUrl(BASE + "/device-login");
        }
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

    private void addNav(LinearLayout row, String name, String route) {
        Button b = navButton(name, Color.rgb(228, 248, 244), TEXT);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            0, dp(44), 1f);
        params.setMargins(dp(2), 0, dp(2), 0);
        row.addView(b, params);
        b.setOnClickListener(v -> webView.loadUrl(BASE + route));
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setPadding(dp(10), dp(9), dp(10), dp(9));
        top.setBackgroundColor(Color.rgb(244, 250, 248));

        Button close = navButton("← Alarm", Color.WHITE, TEXT);
        top.addView(close, new LinearLayout.LayoutParams(dp(94), dp(43)));
        close.setOnClickListener(v -> finish());

        title = new TextView(this);
        title.setText("Staff Mode · Lotus's B2B");
        title.setTextSize(15);
        title.setTextColor(TEAL);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(dp(10), dp(8), 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, dp(43), 1));
        root.addView(top);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(dp(6), dp(3), dp(6), dp(6));
        addNav(buttons, "หน้าหลัก", "/login");
        addNav(buttons, "งาน", "/tasks");
        addNav(buttons, "ออเดอร์", "/orders");
        if (!StationHealth.isDedicated(this))
            addNav(buttons, "ออกจากระบบ", "/device-login?logout=1");
        root.addView(buttons);

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
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
                if (trusted(request.getUrl())) return false;
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
                if (activationPageReady) title.setText("Staff Mode · เชื่อมต่อบัญชี");
                else if (url.contains("/device-login"))
                    title.setText("Staff Mode · เข้าสู่ระบบ");
                else title.setText("Staff Mode · Lotus's B2B");
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

    @Override protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
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
