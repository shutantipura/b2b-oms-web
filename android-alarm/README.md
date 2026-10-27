# Lotus's B2B Native Android Alarm + Staff + Station Health (prototype 0.4)

An Android app for the existing OMS that requires no LINE or staff login.

## Already implemented

- Foreground Android service runs independently of the browser, including when the screen is locked, subject to Android vendor power management.
- Read-only OMS alert feed is checked every ~15 seconds.
- Repeating three-beep alarm on the **alarm volume** stream.
- High-priority **heads-up notification** with one-tap **รับทราบ — หยุดเสียง** and **ดูออเดอร์** actions.
- Incoming-order activity is independent of the settings/home screen, and can display over a locked screen if Android grants **full-screen alarm intent** permission.
- The app includes a Settings shortcut for full-screen permission on Android 14+; without it, the alert is still available as a heads-up notification.
- Notification action or app button acknowledges alarms on **this device only**, without editing the OMS orders or global alert table.
- Device remembers acknowledged orders. Initial launch ignores existing historical alerts.
- Best-effort restart at phone boot.
- Android 13+ notification permission, Android 14+ special-use foreground service declaration and configurable full-screen alarm permission.

## Install prototype APK

Go to GitHub Actions → Build Android Alarm APK → latest successful build.
Download artifact **Lotus-B2B-Alarm-APK** and extract app-debug.apk.
Copy it onto the Android phone and allow Files/Chrome to install unknown apps.\n\n**Upgrading the previous v0.1 prototype:** GitHub build runners may sign debug APKs with different keys. If Android reports `App not installed` or a signature mismatch, uninstall the old `Lotus's B2B Alarm` before installing v0.2. This clears the prototype's locally acknowledged alerts. On the first successful new connection the app intentionally ignores the existing alert backlog; create another test order after monitoring has started.
No Play Store developer account or Firebase project is needed for this prototype.

## Setup

1. Open Lotus's B2B Alarm and grant notification permission.
2. Adjust **Alarm** volume, use **ทดสอบเสียงปลุก** to test.
3. Tap **เริ่มตรวจสอบออเดอร์**.
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

The alarm continues working **without login and without pairing**. Pairing is only needed to display the station's health status in the Manager dashboard.

1. Manager opens `https://b2b-oms-web.vercel.app/alarm-stations` and chooses a station name.
2. Click **สร้างรหัสจับคู่เครื่อง**. The 32-character one-time code expires after 15 minutes.
3. On Android app v0.4, select **จับคู่เครื่องกับ Dashboard (ทางเลือก)** and type the code.
4. Keep **เริ่มตรวจสอบออเดอร์** enabled. The app sends health updates around every 45 seconds, while order polling remains every 15 seconds.
5. Dashboard shows the last heartbeat, successful OMS check, pending count, errors and app version. An absent heartbeat for 90 seconds shows **offline**.
6. Managers can revoke health pairing without disabling the local alarm.

Station secret tokens are generated server-side, stored in private Android app preferences, and their SHA-256 hashes are stored in Supabase. The public health API cannot list stations or change OMS orders. Avoid copying tokens or writing them to logs. No existing staff credentials are required.

**Limits:** Internet outages, airplane mode, a force-stop or OEM battery restrictions may prevent heartbeats. A fresh heartbeat proves communication to OMS, not that the speaker works.

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
base64 < lotus-b2b-release.jks | tr -d '\\n'
```
Paste the Base64 into GitHub → repository **Settings → Secrets and variables → Actions → New repository secret** (not into a chat or source code). Add the other three secrets. Preserve secure offline backups of the original keystore and passwords: losing them prevents future in-place updates.

After the secrets are configured, a new Actions run will upload a signed release APK, separate from the debug prototype. Install **that release APK** as the long-term channel. The first switch from debug-signed to release-signed APK may require **uninstalling the old debug prototype** (Android does not accept different signing keys for in-place upgrades); later builds signed with the same key can update in place. Uninstalling clears local alarms/acknowledgements and pairing token; re-pair after reinstall. The debug artifact remains available for testing.

No release-signing secrets have been configured by this source change alone. **Do not treat a debug APK as a consistently signed production upgrade.**

## Remote QA checklist

- Manager staff account can open `/device-accounts` and `/alarm-stations`; non-managers cannot access their protected APIs.
- Alarm station code expires in 15 minutes and cannot be claimed twice.
- Unpaired phones continue to alarm; paired phones also send 45-second heartbeats.
- Revoked health token no longer writes to dashboard; local sound still works.
- Staff Mode credentials remain separate from the optional alarm-health pairing.
- Real-phone testing is needed for battery-saver, lock screen, sound, camera and APK upgrades.
