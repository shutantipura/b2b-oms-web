package com.lotusb2b.alarm;

import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** Store alarm hours are fixed to Thailand time, regardless of phone timezone. */
final class AlarmHours {
    private static final ZoneId THAILAND = ZoneId.of("Asia/Bangkok");

    private AlarmHours() {}

    static boolean isQuiet() {
        return isQuiet(ZonedDateTime.now(THAILAND));
    }

    static boolean isQuiet(ZonedDateTime now) {
        int hour = now.withZoneSameInstant(THAILAND).getHour();
        return hour >= 22 || hour < 7;
    }

    static long millisUntilTransition() {
        ZonedDateTime now = ZonedDateTime.now(THAILAND);
        int nextHour = isQuiet(now) ? 7 : 22;
        ZonedDateTime next = now.withHour(nextHour)
            .withMinute(0).withSecond(0).withNano(0);
        if (!next.isAfter(now)) next = next.plusDays(1);
        return Math.max(1000L, Duration.between(now, next).toMillis());
    }
}
