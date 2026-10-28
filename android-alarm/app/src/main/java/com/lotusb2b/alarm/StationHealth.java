package com.lotusb2b.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.List;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Optional pairing: the public alarm keeps ringing without any credentials. */
final class StationHealth {
    static final String TOKEN = "station_health_token";
    static final String LABEL = "station_health_label";
    static final String PAIR_ERROR = "station_health_error";
    static final String DEDICATED = "station_dedicated_terminal";
    private static final String ROOT = "https://b2b-oms-web.vercel.app/api/alarm-station/";
    private static final ExecutorService network = Executors.newSingleThreadExecutor();
    private static final Handler ui = new Handler(Looper.getMainLooper());

    interface Callback { void onComplete(boolean success, String message); }

    private StationHealth() {}

    static void pair(Context context, String code, Callback callback) {
        Context app = context.getApplicationContext();
        if (!code.matches("[A-Fa-f0-9]{32}")) {
            callback.onComplete(false, "รหัสจับคู่ต้องมี 32 ตัวอักษร (A–F และ 0–9)");
            return;
        }
        SharedPreferences existing = app.getSharedPreferences(
            AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String currentToken = existing.getString(TOKEN, "");
        if (currentToken != null && currentToken.matches("[a-f0-9]{64}")) {
            callback.onComplete(false, "กรุณายกเลิกการจับคู่บัญชีเดิมก่อนเปลี่ยนเครื่อง");
            return;
        }
        network.execute(() -> {
            try {
                JSONObject payload = new JSONObject().put("code", code.toUpperCase());
                JSONObject response = post("pair", null, payload);
                if (!response.optBoolean("success")) {
                    throw new Exception(response.optString("error", "จับคู่ไม่สำเร็จ"));
                }
                String token = response.getString("token");
                String label = response.optString("label", "Alarm Station");
                if (!token.matches("[a-f0-9]{64}")) throw new Exception("Invalid station token");
                SharedPreferences pref = app.getSharedPreferences(AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
                pref.edit().putString(TOKEN, token).putString(LABEL, label)
                    .putBoolean(DEDICATED, response.optBoolean("dedicatedTerminal", false))
                    .remove(PAIR_ERROR).apply();
                ui.post(() -> callback.onComplete(true, "จับคู่สำเร็จ: " + label));
            } catch (Exception e) {
                ui.post(() -> callback.onComplete(false, e.getMessage()));
            }
        });
    }

    /** Server-side revocation must succeed before clearing local identity.
     * A device cannot silently discard its token while leaving access active.
     * OMS WebView storage is cleared so the next account cannot inherit a
     * previous terminal's Staff session.
     */
    static void unpair(Context context, Callback callback) {
        Context app = context.getApplicationContext();
        SharedPreferences pref = app.getSharedPreferences(AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String token = pref.getString(TOKEN, "");
        if (token == null || !token.matches("[a-f0-9]{64}")) {
            clearLocalEnrollment(app);
            clearWebSession(() -> callback.onComplete(true, "เครื่องยังไม่ได้จับคู่"));
            return;
        }
        network.execute(() -> {
            try {
                JSONObject response = post("unpair", token, new JSONObject());
                if (!response.optBoolean("success"))
                    throw new Exception(response.optString("error", "ยกเลิกการจับคู่ไม่สำเร็จ"));
                clearLocalEnrollment(app);
                ui.post(() -> clearWebSession(() -> callback.onComplete(true,
                    "ยกเลิกการจับคู่สำเร็จ สามารถลงทะเบียนบัญชีอื่นได้")));
            } catch (Exception e) {
                ui.post(() -> callback.onComplete(false,
                    "ไม่สามารถยกเลิกการจับคู่ผ่าน OMS ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่"));
            }
        });
    }

    private static void clearLocalEnrollment(Context app) {
        app.getSharedPreferences(AlarmMonitorService.PREFS, Context.MODE_PRIVATE).edit()
            .remove(TOKEN).remove(LABEL).remove(DEDICATED).remove(PAIR_ERROR).commit();
    }

    private static void clearWebSession(Runnable completed) {
        // Always called on the UI thread.
        CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            WebStorage.getInstance().deleteAllData();
            completed.run();
        });
    }

    static boolean isDedicated(Context context) {
        SharedPreferences prefs=context.getApplicationContext().getSharedPreferences(
            AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String token=prefs.getString(TOKEN, "");
        return token!=null && token.matches("[a-f0-9]{64}")
            && prefs.getBoolean(DEDICATED,false);
    }

    /** Manager-bound terminal retrieves a one-time login code in memory.
     * A revoked station or inactive staff profile cannot mint new sessions.
     */
    static void getStaffSession(Context context, Callback callback) {
        SharedPreferences prefs=context.getApplicationContext().getSharedPreferences(
            AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String token=prefs.getString(TOKEN, "");
        if (!isDedicated(context)||token==null) {
            callback.onComplete(false,"กรุณาลงทะเบียนเครื่องเป็น Android Terminal");
            return;
        }
        network.execute(() -> {
            try {
                JSONObject result=post("staff-session",token,new JSONObject());
                String oneTime=result.optString("tokenHash","");
                if (!oneTime.matches("[a-zA-Z0-9_-]{30,500}"))
                    throw new Exception("ไม่สามารถสร้างเซสชัน OMS ของเครื่องได้");
                ui.post(()->callback.onComplete(true,oneTime));
            } catch(Exception e) {
                ui.post(()->callback.onComplete(false,
                    e.getMessage()==null?"OMS ไม่พร้อมใช้งาน":e.getMessage()));
            }
        });
    }

    static void report(Context context, boolean monitoring, boolean pollOk,
                       int pendingCount, String lastError) {
        Context app = context.getApplicationContext();
        SharedPreferences pref = app.getSharedPreferences(AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String token = pref.getString(TOKEN, "");
        if (token == null || !token.matches("[a-f0-9]{64}")) return;
        network.execute(() -> {
            try {
                String version = app.getPackageManager()
                    .getPackageInfo(app.getPackageName(), 0).versionName;
                JSONObject payload = new JSONObject()
                    .put("monitoring", monitoring)
                    .put("pollOk", pollOk)
                    .put("pendingCount", pendingCount)
                    .put("lastError", lastError == null ? "" : lastError)
                    .put("version", version);
                post("heartbeat", token, payload);
                pref.edit().remove(PAIR_ERROR).apply();
            } catch (Exception e) {
                // Never interfere with the audio alarm due to a dashboard error.
                pref.edit().putString(PAIR_ERROR, "ส่งสถานะอุปกรณ์ไม่สำเร็จ").apply();
            }
        });
    }

    /** Shared order acknowledgement is authorized by the device pairing token.
     * A failed request MUST NOT clear the local alarm.
     */
    static void acknowledge(Context context, List<String> alertIds, Callback callback) {
        Context app = context.getApplicationContext();
        SharedPreferences pref = app.getSharedPreferences(AlarmMonitorService.PREFS, Context.MODE_PRIVATE);
        String token = pref.getString(TOKEN, "");
        if (token == null || !token.matches("[a-f0-9]{64}")) {
            callback.onComplete(false, "ยังไม่ได้จับคู่เครื่อง กรุณาจับคู่ก่อนรับทราบทุกเครื่อง");
            return;
        }
        if (alertIds == null || alertIds.isEmpty() || alertIds.size() > 200) {
            callback.onComplete(false, "ไม่มีรายการใหม่สำหรับรับทราบ");
            return;
        }
        network.execute(() -> {
            try {
                JSONArray ids = new JSONArray();
                for (String id : alertIds) ids.put(id);
                JSONObject response = post("ack", token,
                    new JSONObject().put("alertIds", ids));
                if (!response.optBoolean("success")) {
                    throw new Exception(response.optString("error",
                        "ไม่สามารถรับทราบทุกเครื่องได้"));
                }
                ui.post(() -> callback.onComplete(true,
                    "รับทราบทุกเครื่องแล้ว"));
            } catch (Exception e) {
                String message = e.getMessage() == null ?
                    "ส่งคำสั่งรับทราบไม่สำเร็จ" : e.getMessage();
                ui.post(() -> callback.onComplete(false, message));
            }
        });
    }

    private static JSONObject post(String route, String token, JSONObject payload) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection)new URL(ROOT + route).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream stream = conn.getOutputStream()) { stream.write(bytes); }
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) {
                if (status == 401) throw new Exception("ไม่รู้จักอุปกรณ์หรือถูกยกเลิกการจับคู่");
                throw new Exception("OMS HTTP " + status);
            }
            StringBuilder result = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) result.append(line);
            }
            return new JSONObject(result.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
