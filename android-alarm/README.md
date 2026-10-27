# Lotus's B2B Native Android Alarm (prototype 0.1)

An Android app for the existing OMS that requires no LINE or staff login.

## Already implemented

- Foreground Android service runs independently of the browser, including when the screen is locked, subject to Android vendor power management.
- Read-only OMS alert feed is checked every ~15 seconds.
- Repeating three-beep alarm on the **alarm volume** stream.
- Notification action or app button acknowledges alarms on **this device only**, without editing the OMS orders or global alert table.
- Device remembers acknowledged orders. Initial launch ignores existing historical alerts.
- Best-effort restart at phone boot.
- Android 13+ notification permission, Android 14+ special-use foreground service declaration.

## Install prototype APK

Go to GitHub Actions → Build Android Alarm APK → latest successful build.
Download artifact **Lotus-B2B-Alarm-APK** and extract app-debug.apk.
Copy it onto the Android phone and allow Files/Chrome to install unknown apps.
No Play Store developer account or Firebase project is needed for this prototype.

## Setup

1. Open Lotus's B2B Alarm and grant notification permission.
2. Adjust **Alarm** volume, use **ทดสอบเสียงปลุก** to test.
3. Tap **เริ่มตรวจสอบออเดอร์**.
4. Wait until the OMS check time updates. Lock the screen.
5. Place a new B2B order with a non-test customer; it should ring after the next poll.
6. Tap **รับทราบทั้งหมดบนเครื่องนี้** to stop the local alarm.

## Limitations and costs

- Prototype uses ongoing foreground polling, **not FCM**. If Android force-stops the app, monitoring ends.
- Battery saver, Doze, OEM background controls, connectivity and OS permissions can cause delays or stoppages.
- At 15-second intervals this is ~172,800 API calls/month per always-on device. Monitor Vercel usage.
- GitHub Actions APK is **debug-signed**. Fresh runner signatures can differ across builds; for upgrades set up a stable signing key in a secure secret store.
- For widespread deployment replace polling with Firebase Cloud Messaging after creating a Firebase project and configuring a push sender. Google Play services alone do not provide the server credentials.

## Source

Native Java, Android Gradle Plugin 8.7.3, JDK 17, Android SDK 35; app uses no runtime SDK dependencies.
