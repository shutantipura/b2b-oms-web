package com.lotusb2b.alarm;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;

/**
 * Cleaned Lotus's B2B voice recording. One 3.5-second voice call is stored
 * in res/raw; each repeat is separated by exactly 4 seconds of silence.
 * The foreground service owns this player so acknowledgement can stop it
 * immediately, even during the pause. Never use a continuous 18-second
 * player loop: that leaves a gapless jump from call 3 to call 1.
 */
final class AlarmSound {
    private static final long PAUSE_MS = 4000L;
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    private MediaPlayer player;
    private Runnable scheduledReplay;
    private boolean repeating;

    AlarmSound(Context context) {
        this.context = context.getApplicationContext();
    }

    void startRepeating() throws IOException {
        if (repeating || AlarmHours.isQuiet()) return;
        repeating = true;
        try {
            playCall();
        } catch (IOException e) {
            stop();
            throw e;
        }
    }

    /** Must stay true during the 4-second pause: the feed polls every 2 s. */
    boolean isActive() {
        return repeating;
    }

    /** Immediate local silence on ACK, remote ACK, quiet hours or stop. */
    void stop() {
        repeating = false;
        if (scheduledReplay != null) {
            main.removeCallbacks(scheduledReplay);
            scheduledReplay = null;
        }
        if (player != null) {
            MediaPlayer old = player;
            player = null;
            old.setOnCompletionListener(null);
            try { if (old.isPlaying()) old.stop(); }
            catch (IllegalStateException ignored) {}
            old.release();
        }
    }

    private void playCall() throws IOException {
        if (!repeating || AlarmHours.isQuiet()) {
            stop();
            return;
        }
        player = createPlayer(context);
        player.setOnCompletionListener(mp -> {
            if (mp != player) return;
            mp.release();
            player = null;
            if (!repeating || AlarmHours.isQuiet()) {
                stop();
                return;
            }
            scheduledReplay = () -> {
                scheduledReplay = null;
                if (!repeating || AlarmHours.isQuiet()) {
                    stop();
                    return;
                }
                try {
                    playCall();
                } catch (IOException e) {
                    stop();
                }
            };
            main.postDelayed(scheduledReplay, PAUSE_MS);
        });
        player.start();
    }

    /** Test button plays exactly three identical calls, with two 4-s pauses. */
    static void testOnce(Context context) throws IOException {
        new ThreeCallTest(context.getApplicationContext()).start();
    }

    private static final class ThreeCallTest {
        private final Context context;
        private final Handler main = new Handler(Looper.getMainLooper());
        private int callsLeft = 3;

        ThreeCallTest(Context context) {
            this.context = context;
        }

        void start() throws IOException {
            next();
        }

        private void next() throws IOException {
            MediaPlayer sample = createPlayer(context);
            sample.setOnCompletionListener(mp -> {
                mp.release();
                callsLeft--;
                if (callsLeft > 0) {
                    main.postDelayed(() -> {
                        try { next(); }
                        catch (IOException ignored) {}
                    }, PAUSE_MS);
                }
            });
            sample.start();
        }
    }

    private static MediaPlayer createPlayer(Context context) throws IOException {
        MediaPlayer mp = new MediaPlayer();
        try (AssetFileDescriptor asset = context.getResources()
                .openRawResourceFd(R.raw.lotus_b2b_voice_call)) {
            if (asset == null) throw new IOException("Voice alarm resource missing");
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            mp.setDataSource(asset.getFileDescriptor(), asset.getStartOffset(),
                    asset.getLength());
            mp.prepare();
            return mp;
        } catch (Exception e) {
            mp.release();
            throw new IOException("Unable to prepare the recorded voice alarm", e);
        }
    }
}
