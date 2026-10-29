package com.lotusb2b.alarm;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Three-beep alarm repeated on the Android alarm audio stream. */
final class AlarmSound {
    private static final int SAMPLE_RATE = 22050;
    private final Context context;
    private MediaPlayer player;

    AlarmSound(Context context) { this.context = context.getApplicationContext(); }

    void startRepeating() throws IOException {
        if (player != null || AlarmHours.isQuiet()) return;
        // Play short clips instead of using MediaPlayer's infinite loop.
        // Each replay checks the Thailand clock, so even a delayed service
        // poll cannot leave the sound running through the night.
        player = createPlayer(context, false);
        player.setOnCompletionListener(mp -> {
            if (mp != player) return;
            if (AlarmHours.isQuiet()) {
                stop();
                return;
            }
            try { mp.start(); }
            catch (IllegalStateException ignored) { stop(); }
        });
        player.start();
    }

    boolean isActive() {
        return player != null;
    }

    void stop() {
        if (player == null) return;
        try { if (player.isPlaying()) player.stop(); }
        catch (IllegalStateException ignored) {}
        player.release();
        player = null;
    }

    static void testOnce(Context context) throws IOException {
        final MediaPlayer sample = createPlayer(context, false);
        sample.setOnCompletionListener(mp -> { mp.release(); });
        sample.start();
    }

    private static MediaPlayer createPlayer(Context context, boolean loop) throws IOException {
        File file = createSound(context);
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            mp.setDataSource(file.getAbsolutePath());
            mp.setLooping(loop);
            mp.prepare();
            return mp;
        } catch (Exception e) {
            mp.release();
            throw new IOException("Unable to prepare alarm sound", e);
        }
    }

    private static File createSound(Context context) throws IOException {
        File file = new File(context.getCacheDir(), "oms_alarm_v1.wav");
        if (file.exists() && file.length() > 10000) return file;
        final int samples = 22050 * 2;
        final int length = samples * 2;
        byte[] header = new byte[44];
        ascii(header, 0, "RIFF"); int32(header, 4, 36 + length);
        ascii(header, 8, "WAVE"); ascii(header, 12, "fmt ");
        int32(header, 16, 16); int16(header, 20, 1); int16(header, 22, 1);
        int32(header, 24, SAMPLE_RATE); int32(header, 28, SAMPLE_RATE * 2);
        int16(header, 32, 2); int16(header, 34, 16);
        ascii(header, 36, "data"); int32(header, 40, length);
        double[] begins = {0.07, 0.46, 0.85};
        double[] freqs = {880, 1050, 880};
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(header);
            byte[] chunk = new byte[2048];
            int used = 0;
            for (int i = 0; i < samples; i++) {
                double time = i / (double) SAMPLE_RATE;
                double amplitude = 0;
                for (int j = 0; j < begins.length; j++) {
                    double t = time - begins[j];
                    if (t >= 0 && t < 0.26) {
                        double envelope = Math.min(1, t / 0.02) *
                            Math.min(1, (0.26 - t) / 0.03);
                        amplitude += 0.67 * envelope *
                            Math.sin(2 * Math.PI * freqs[j] * t);
                    }
                }
                short value = (short)(Math.max(-1, Math.min(1, amplitude)) * 32767);
                chunk[used++] = (byte)value;
                chunk[used++] = (byte)(value >>> 8);
                if (used == chunk.length) {
                    output.write(chunk);
                    used = 0;
                }
            }
            if (used > 0) output.write(chunk, 0, used);
        }
        return file;
    }

    private static void ascii(byte[] b, int offset, String value) {
        for (int i = 0; i < value.length(); i++) b[offset+i] = (byte)value.charAt(i);
    }
    private static void int32(byte[] b, int offset, int value) {
        for (int i = 0; i < 4; i++) b[offset+i] = (byte)(value >>> (i*8));
    }
    private static void int16(byte[] b, int offset, int value) {
        b[offset] = (byte)value;
        b[offset+1] = (byte)(value >>> 8);
    }
}
