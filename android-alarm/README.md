# Lotus's B2B Native Android Alarm + Staff + Station Health (prototype 0.11.1)

An Android app for the existing OMS that requires no LINE or staff login.

## Already implemented

- Foreground Android service runs independently of the browser, including when the screen is locked, subject to Android vendor power management.
- Read-only OMS alert feed is checked every ~15 seconds.
- Cleaned recorded **Lotus’s B2B voice alarm**, repeated with **four seconds of silence between calls** on the **alarm volume** stream.
- High-priority **heads-up notification** with one-tap **รับทราบ — หยุดเสียง** and **ดูออเดอร์** actions.
- Incoming-order activity is independent of the settings/home screen, and can display over a locked screen if Android grants **full-screen alarm intent** permission.
- The app includes a Settings shortcut for full-screen permission on Android 14+; without it, the alert is still available as a heads-up notification.
- **Shared acknowledgement** for paired Android stations: any paired phone acknowledges an order globally and all connected phones stop after their next ~15-second poll. No staff login is required for the alarm; devices use their own pairing tokens.\n- Unpaired phones may continue to ring and acknowledge **locally only**. They cannot dismiss alarms on other devices.\n- Global acknowledgement updates only the alert acknowledgement, not the OMS order's workflow/status. The acknowledging station is recorded for audit.
- Device remembers acknowledged orders. Initial launch ignores existing historical alerts.
- Best-effort restart at phone boot.
- Android 13+ notification permission, Android 14+ special-use foreground service declaration and configurable full-screen alarm permission.

## Recorded voice alert (v0.11.1)

- The former synthesized three-beep tone has been replaced with the cleaned Lotus's B2B voice recording.
- The test button plays exactly **three identical voice calls**, with **4.0 seconds of silence** between calls.
- When a real order is pending, the app continues repeating the same voice call with a 4-second pause after each clip until staff acknowledge it.
- Audio playback stays on the Android **Alarm** stream (not media volume).
- Acknowledging locally mutes the voice immediately and cancels any scheduled replay; paired devices use the existing rapid shared acknowledgement logic.
- Quiet hours are still **22:00–07:00 Thailand time**, and no sound is played during that period except a deliberate manual test.
- The recording is packaged inside the APK; no internet request is needed to load the sound itself. The Android project uses a short Opus/WebM clip of the verified three-call preview, to avoid unnecessary APK size; the 4-second silent intervals are scheduled by the app.
- Android MediaPlayer's scheduling and device power management may add slight timing latency, but the programmed delay is exactly 4,000 ms.

## Compatibility update (v0.11.1)

- Rebuilt from the current OMS repository revision after production security and alarm-feed fixes.
- The backend now excludes alerts associated with completed or cancelled orders; the native client continues to use the same JSON feed without a new login or protocol.
- Includes the previously verified cleaned Lotus's B2B recorded voice clip, scheduled with 4-second pauses (three calls in the test action).
- A debug-signed APK can require uninstalling the previous debug build; uninstall clears private pairing, auto-login, locally acknowledged alerts and device settings.
- If a device is already paired, record the station/Staff account mapping before uninstall. After reinstall, have the manager re-enroll or replace/revoke the orphan pairing in device management. Avoid casually using "unpair" for a reinstall: that action also deactivates the current device Staff account.
- Open the Android app once after installation and allow notifications and battery exceptions; alarm monitoring starts automatically.

## Fast shared acknowledgement (v0.10)

- Tapping acknowledgement on a paired phone immediately mutes that phone while its server request is in flight.
- Other ringing phones check the shared OMS feed about every **2 seconds**. They stop when the server records acknowledgement (normally within a couple seconds, plus network delay).
- When no alarm is pending, polling stays at 15 seconds; during quiet hours it stays at 60 seconds.
- Only one order-feed request per device is allowed in flight, avoiding request pile-ups when the connection is slow.
- If server acknowledgement fails, the phone that was temporarily muted resumes any still-pending alarm and shows an error; the order is not falsely marked acknowledged.
- Unpaired phones still acknowledge locally only. To stop every terminal, pair them with the OMS.
- This requires installing v0.10 on each terminal; older APKs still use 15-second polling after shared acknowledgement.

## Automatic quiet hours (Thailand time, v0.9)

- **07:00–21:59:59**: alarms are enabled. A new unacknowledged order rings until acknowledged.
- **22:00–06:59:59**: the OMS feed suppresses audible alerts, without acknowledging or deleting them. The native app also silences its current alarm at 22:00, even without connectivity.
- **07:00**: the native app requests the feed immediately; any overnight orders still awaiting acknowledgement become audible. Other paired terminals follow their normal shared-acknowledgement behavior.
- Overnight Android polling slows to about once a minute to reduce battery/API use; daytime idle polling remains about every 15 seconds and ringing polling is about every 2 seconds (v0.10). Android power management or lack of network can delay morning playback.
- The server-side guard applies to already-installed Android APKs once they poll the OMS. Install v0.9 on each phone for device-side offline muting and more precise boundary handling. The manual **ทดสอบเสียงปลุก** button still deliberately plays a test sound.
- Monitoring stays enabled overnight; there is no need for staff to turn it back on each morning.

## Install prototype APK

Go to GitHub Actions → Build Android Alarm APK → latest successful build.
Download artifact **Lotus-B2B-Alarm-APK** and extract app-debug.apk.
Copy it onto the Android phone and allow Files/Chrome to install unknown apps.\n\n**Upgrading the previous v0.1 prototype:** GitHub build runners may sign debug APKs with different keys. If Android reports `App not installed` or a signature mismatch, uninstall the old `Lotus's B2B Alarm` before installing v0.2. This clears the prototype's locally acknowledged alerts. On the first successful new connection the app intentionally ignores the existing alert backlog; create another test order after monitoring has started.
No Play Store developer account or Firebase project is needed for this prototype.

## Setup

1. Install the APK. **Android does not start freshly installed apps in the background**. Open Lotus's B2B Alarm **once** and allow the Android notification permission if prompted. **The app now starts monitoring automatically**; no need to tap the Start button.
2. Adjust **Alarm** volume, use **ทดสอบเสียงปลุก** to test.
3. Check for **กำลังตรวจสอบออเดอร์** and a recent OMS check time. **เริ่มตรวจสอบออเดอร์** is now only needed if someone deliberately stopped monitoring.
4. Wait until the OMS check time updates. Lock the screen.
5. If the device runs Android 14+, tap **เปิดแจ้งเตือนเต็มหน้าจอ**, and allow the permission in Settings if offered.\n6. Place a new B2B order using your **test customer**; it should ring after the next poll.\n   - Unlocked screen: heads-up alert with **รับทราบ — หยุดเสียง**, and **ดูออเดอร์** opens the dedicated incoming screen.\n   - Locked screen: full-screen incoming alarm if permission is granted, otherwise a heads-up notification.
7. Tap **รับทราบ — หยุดเสียง** in the notification, or the matching button on the incoming screen. No staff sign-in is required.

## Limitations and costs

- Prototype uses ongoing foreground polling, **not FCM**. If Android force-stops the app, monitoring ends.
- Battery saver, Doze, OEM background controls, connectivity and OS permissions can cause delays or stoppages.
- At 15-second intervals this is ~172,800 API calls/month per always-on device. Monitor Vercel usage.
- GitHub Actions APK is **debug-signed**. Fresh runner signatures can differ across builds; for upgrades set up a stable signing key in a secure secret store.
- For widespread deployment replace polling with Firebase Cloud Messaging after creating a Firebase project and configuring a push sender. Google Play services alone do not provide the server credentials.

## Source

Native Java, Android Gradle Plugin 8.7.3, JDK 17, Android SDK 35; app uses no runtime SDK dependencies.

## Optional manager health dashboard (v0.4)

The alarm continues working **without login and without pairing**. Pairing enables **two** features: showing the station's health status in the Manager dashboard **and acknowledging an alert on all Android stations**. Unpaired phones can still ring but can only dismiss locally.

1. Manager opens `https://b2b-oms-web.vercel.app/alarm-stations` and chooses a station name.
2. Click **สร้างรหัสจับคู่เครื่อง**. The 32-character one-time code expires after 15 minutes.
3. On Android app v0.6, select **จับคู่เครื่องกับ Dashboard (ทางเลือก)** and type the code.
4. Keep **เริ่มตรวจสอบออเดอร์** enabled. The app sends health updates around every 45 seconds, while order polling remains every 15 seconds.
5. Dashboard shows the last heartbeat, successful OMS check, pending count, errors and app version. An absent heartbeat for 90 seconds shows **offline**.
6. Managers can revoke health pairing without disabling the local alarm.

Station secret tokens are generated server-side, stored in private Android app preferences, and their SHA-256 hashes are stored in Supabase. A paired station can acknowledge the shared alarm feed through the restricted station API, but cannot change OMS order stages or expose customer data. The heartbeat API cannot list stations. Avoid copying tokens or writing them to logs. No existing staff credentials are required.

**Limits:** Internet outages, airplane mode, a force-stop or OEM battery restrictions may prevent heartbeats. A fresh heartbeat proves communication to OMS, not that the speaker works.

## Shared acknowledgement across multiple Android devices (v0.5)

For example, if a new order #123 is submitted while **Phone A**, **Phone B**, and **Phone C** are monitoring:

1. The public read-only feed includes #123; each online Android phone sees it on its next ~15-second poll and rings.
2. Staff tap **รับทราบทุกเครื่อง** on any **paired** phone (e.g. Phone B).
3. Phone B sends the alert IDs to `POST /api/alarm-station/ack`, authenticated with that station's private token. The server validates that the station is active, and atomically fills `acknowledged_at` and `acknowledged_by_station` for each still-pending alert.
4. The public feed excludes those globally acknowledged alerts. Phones A and C stop on their next successful poll (nominally within ~15 seconds, possibly longer due to connectivity or background restrictions).
5. **This does not mark an order stock-checked, completed, billed or paid.** It only means someone at the store heard the alarm.

**Security:** Anonymous clients and unpaired/revoked stations cannot globally dismiss alarms. Manager creates separate pairing codes for each device (one code per phone). A station's password/login for Staff Mode is unrelated to this health+alert pairing.

**Reliability:** If central acknowledgement fails (network/server offline), a paired station keeps ringing and shows an error. Staff should retry. An unpaired phone can dismiss locally only, so for reliable shared acknowledgement **pair every device**. A freshly installed/reinstalled app suppresses alerts created before monitoring first starts. It **does not** suppress alerts arriving while the first connection is in flight. Submit a fresh test order after the application has been opened once.

**Scaling:** Each continuously monitoring Android device makes ~172,800 feed requests/month at 15-second polling (plus heartbeat requests). A modest fleet works with this architecture, but monitor server usage; larger deployments would benefit from FCM push messaging rather than every phone polling independently.

## Stable signed APK update channel

GitHub Actions now optionally builds `Lotus-B2B-Alarm-Release-Signed` when these four protected repository **Actions secrets** exist:

- `ANDROID_KEYSTORE_BASE64` – Base64 of a permanent Android release keystore (never commit this file).
- `ANDROID_KEYSTORE_PASSWORD` – the keystore password.
- `ANDROID_KEY_ALIAS` – the key alias.
- `ANDROID_KEY_PASSWORD` – the key password.

A manager/developer with trusted admin access can generate the release keystore **once**, on a secure computer with JDK:
```bash
keytool -genkeypair -v -keystore lotus-b2b-release.jks -alias lotus-b2b-alarm \
  -keyalg RSA -keysize 3072 -validity 10000
base64 < lotus-b2b-release.jks | tr -d '\n'
```
Paste the Base64 into GitHub → repository **Settings → Secrets and variables → Actions → New repository secret** (not into a chat or source code). Add the other three secrets. Preserve secure offline backups of the original keystore and passwords: losing them prevents future in-place updates.

After the secrets are configured, a new Actions run will upload a signed release APK, separate from the debug prototype. Install **that release APK** as the long-term channel. The first switch from debug-signed to release-signed APK may require **uninstalling the old debug prototype** (Android does not accept different signing keys for in-place upgrades); later builds signed with the same key can update in place. Uninstalling clears local alarms/acknowledgements and pairing token; re-pair after reinstall. The debug artifact remains available for testing.

No release-signing secrets have been configured by this source change alone. **Do not treat a debug APK as a consistently signed production upgrade.**

## Remote QA checklist

- On 2+ paired phones, create a new test-customer order; all monitoring devices should ring.
- Acknowledge once on Phone B. Verify `acknowledged_at` and `acknowledged_by_station` record that station and all devices stop on the next feed check.
- Verify revoked/unpaired phones cannot globally acknowledge and their local-only action does not stop other phones.
- If internet disconnects during acknowledgement, keep the alarm active on the paired phone; restore connectivity and retry.
- When a second order arrives while the first ACK is in flight, it must keep ringing until separately acknowledged.
- Check manager dashboard heartbeats for every phone and verify no staff task/order status changes from alert acknowledgement.


- Manager staff account can open `/device-accounts` and `/alarm-stations`; non-managers cannot access their protected APIs.
- Alarm station code expires in 15 minutes and cannot be claimed twice.
- Unpaired phones continue to alarm; paired phones also send 45-second heartbeats.
- Revoked health token no longer writes to dashboard; local sound still works.
- Staff Mode credentials remain separate from the optional alarm-health pairing.
- Real-phone testing is needed for battery-saver, lock screen, sound, camera and APK upgrades.


## Readiness audit (v0.6)

**What is automatic**
- User opens the app once following installation; the foreground OMS alarm monitor starts immediately without tapping Start or signing in.
- A successful first poll ignores old alerts but keeps orders created after monitoring began, including orders placed while the first HTTP request was pending.
- Home screen shows the latest successful check and warns if the check becomes over 90 seconds old.
- If notifications are denied or disabled, the app displays a warning and a control to request permission again.
- Boot or APK update attempts to restart an enabled monitor (best-effort under Android manufacturer restrictions).

**What cannot be made automatic without operating-system/manager action**
- An installed app cannot self-launch immediately after APK installation: **open it once**.
- Android 13+ requires the user's runtime approval for notifications; Android 14+ may require full-screen alarm permission. Company-managed launchers and battery settings can also restrict access/background execution.
- Full **cross-device** acknowledgement requires each station to receive a manager-approved pairing token. Skipping this would let anyone with the APK dismiss store alarms for every device. Unpaired devices can still ring and acknowledge *locally*.
- Staff Mode requires a manager-created OMS staff identity and credentials. The alarm does not require staff sign-in.
- Stable APK upgrades need a permanent GitHub release-signing key. Debug builds may need uninstalling before replacing.

**First on-device acceptance test:** install -> open app -> accept notification permission -> verify check timestamp updates -> submit a **test-customer order** -> verify sound and lock-screen alert. After pairing two separate devices, acknowledge from B and verify both stop. Confirm the shared acknowledgement does not change the order workflow status.


## Dedicated one-account-per-device enrollment (v0.7)

**Operational model:** one fixed Android terminal = one native alarm station + one dedicated OMS Staff account. Nobody needs to log in or out between shifts. Terminal actions in OMS are attributed to Android-001 etc., not individual employees.

### Manager: one step

1. Sign into the OMS manager portal, open `/terminals` (**Android Terminals**).
2. Choose a unique name `Android-001` (then `Android-002`, etc.) and check the operational stages the terminal may perform.
3. Press **สร้างบัญชีและรหัสจับคู่เครื่อง**. The server creates the dedicated Supabase Auth identity, an active Staff profile with selected task permissions, and a one-time device enrollment code. No staff password is shown or stored in the APK.
4. The code expires in 15 minutes. If setup takes longer, the manager can **reissue a code for the same account**, without creating duplicate staff entries.
5. To revoke an enrolled terminal, use the manager **ยกเลิกเครื่องและปิดบัญชี OMS** action. It revokes the station pairing and disables its associated Staff identity.

### Android: one code

1. Install v0.7 and open it once. Alarm monitoring starts immediately, independently of OMS sign-in.
2. Press **ลงทะเบียน Android Terminal** and enter the manager-provided one-time code.
3. The phone now has an individual, revocable station token for **health heartbeats and shared alarm acknowledgements**.
4. For fixed-account terminals, successful enrollment also opens the OMS. The native app requests a short-lived, single-use Supabase login OTP from the server using the device's enrolled identity. It passes the OTP only into its own HTTPS OMS WebView, which verifies it and loads the Staff home page.
5. Each time Staff Mode is opened, it can renew its dedicated account session automatically. No routine username/password entry is needed. Alarm monitoring is unaffected by Staff Mode authentication or browser session expiration.
6. The same per-terminal task permissions and Supabase RLS checks that protect normal OMS staff apply here. The terminal is a **Staff** account, never a **Manager**.

The Android phone must be able to reach OMS to retrieve new orders and to authenticate Staff Mode. Existing alarm-only pairings remain compatible but cannot automatically sign in as a staff account.

**Security considerations:** Keep the Android phone under the store's physical control, use a device lock / company kiosk policy, and revoke a lost device promptly. A compromised terminal's pairing token could authorize its fixed staff identity until revoked. Neither pairing nor login changes an order status by itself; OMS task actions still require permissions. Employee-level accountability is intentionally not provided.

**Physical QA required:** test fresh installation and permission prompts; first-open alarm; paired cross-device ACK; one-code Staff auto-login; photo-upload camera; session refresh/reopen; battery restrictions and lockscreen; disable/revoke access; reissue expired code. Do not treat the prototype as fully production certified until this is tested on the exact company-managed hardware.

## Unpair, deactivate and re-enroll store devices (v0.8)

No terminal account is permanently deleted. Each Android device keeps its own
Staff identity and alarm-station record for auditability.

**Change the account on the same Android phone:**

1. Install/open **Lotus's B2B Alarm 0.8**. Keep the device online.
2. Tap **ยกเลิกการจับคู่ / เปลี่ยนบัญชี** and confirm.
   This calls `POST /api/alarm-station/unpair` using the old station token.
   The server revokes that station and disables its Staff account; the app then
   clears the token and OMS WebView cookies/storage. If the server cannot confirm
   revocation, the app keeps the old pairing and asks the user to retry.
3. On the manager page **อุปกรณ์หน้าร้าน** (`/terminals`), either reactivate
   the old named account, or create/select another account.
4. Generate a new single-use code (15-minute expiry) **after** the app is ready.
5. On Android, tap **ลงทะเบียนอุปกรณ์หน้าร้าน** and enter the new code.
   Staff Mode then uses the selected account. Native alarms continue even while
   the device is briefly unpaired, but shared acknowledgements require pairing.

**Lost phone or remote deactivation:**

- A manager may disable a paired or still-pending account from the dashboard.
  This revokes station access and expires unused pairing codes. Historical
  pairing/Staff records are retained.
- A disabled account can be activated again with a *new* enrollment code. The
  old station secret remains revoked and cannot be restored.
- The old phone may still display its former local label until the user taps
  **ยกเลิกการจับคู่**, but it can no longer authenticate a new Staff session or
  acknowledge alarms across devices using the revoked station token.
- This deliberately does not implement permanent deletion, nor an iOS app.

**Safety:** Never overwrite one saved station token with another. Unpair online
first. A revoked historical token is allowed to clear its own local state but
must not deactivate any later replacement session for the same Staff account.

**Acceptance checks:** pair Android-001; unpair it; verify its old token is
rejected by `staff-session` and shared `ack`; activate Android-001 with a
fresh code and pair it again; repeat using a different existing terminal
account; verify staff permissions, shared acknowledgement and OMS WebView
session isolation after account switching.
