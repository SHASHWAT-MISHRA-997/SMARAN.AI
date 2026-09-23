package ai.smaran.app;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AutomaticGainControl;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

import java.io.IOException;

/**
 * Listening for "Hey SMARAN" without disturbing anything.
 *
 * Android's SpeechRecognizer takes audio focus every time it listens, so a
 * song pauses whenever it starts - which rules it out for listening all the
 * time. Vosk recognises offline from the microphone directly and never asks
 * for focus: music plays on, and nothing leaves the phone until the wake
 * phrase has been heard.
 *
 * The microphone is read here rather than through Vosk's SpeechService, so
 * the audio can be worked on first. Tested on the owner's phone in a room
 * with a TV on: an utterance only ended at the five-second silence timeout
 * (so it answered late), and "Hey SMARAN" came out as a different English
 * phrase every time. So: the platform's automatic gain control and an
 * adaptive gain; 100 ms chunks for a quicker answer; words checked while
 * they arrive (WakeWord.matchPartial); and the last three seconds kept for a
 * second look at anything that starts like a greeting (lookAgain).
 *
 * One model for the whole process, loaded once (a few seconds, the first
 * time: StorageService copies it out of the APK). Results are delivered on
 * the main thread.
 */
final class WakeSpotter {
    private static final String TAG = "WakeSpotter";
    private static final int RATE = 16000;
    // 80 ms: the size openWakeWord is fed in; Vosk takes any size.
    private static final int CHUNK = OwwDetector.CHUNK;
    private static final double TARGET_RMS = 3000.0;     // where speech should sit
    private static final double MAX_GAIN = 8.0;

    /* What was heard, in the log - only when a developer asks for it over USB
       (`adb shell setprop log.tag.WakeSpotter DEBUG`). Off on every phone by
       default: transcripts of a room have no business in a system log. It is
       how "Hey SMARAN" was tuned on the owner's own voice. */
    private static boolean verbose() {
        return Log.isLoggable(TAG, Log.DEBUG);
    }

    interface Listener {
        void onWake(WakeWord.Heard heard);
    }

    private static Model model;
    private static Context appContext;
    private static boolean loading;
    private static boolean failed;

    static boolean ready() { return model != null; }
    static boolean failed() { return failed; }

    /** Load the model once. `done` runs on the main thread either way. */
    static void load(Context context, Runnable done) {
        if (model != null || failed) { done.run(); return; }
        if (loading) return;
        loading = true;
        appContext = context.getApplicationContext();
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        StorageService.unpack(context.getApplicationContext(), "vosk-en-in", "vosk-en-in",
            loaded -> { model = loaded; loading = false; done.run(); },
            error -> {
                Log.w(TAG, "wake-word model could not be loaded", error);
                failed = true;
                loading = false;
                done.run();
            });
    }

    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean running;
    private Thread thread;
    private AudioRecord record;
    private AutomaticGainControl agc;
    private Recognizer recognizer;
    /** The same model held to the wake phrases, for the second look at "Hey SMARAN". */
    private Recognizer secondLook;
    /** "Hey Jarvis" by openWakeWord; null if its models could not be loaded. */
    private OwwDetector oww;
    private String lastPartial = "";

    WakeSpotter(Listener listener) {
        this.listener = listener;
    }

    boolean running() { return running; }

    boolean start() {
        if (running) return true;
        if (model == null) return false;
        try {
            recognizer = new Recognizer(model, RATE);
            secondLook = new Recognizer(model, RATE, WakeWord.secondLookGrammar());
            try {
                oww = appContext == null ? null : new OwwDetector(appContext);
            } catch (Exception e) {
                // Vosk still listens for every name; only the stronger Jarvis detector is lost.
                Log.w(TAG, "openWakeWord could not be loaded", e);
                oww = null;
            }
            int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
            record = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minimum, RATE * 2));
            if (record.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("microphone unavailable");
            if (AutomaticGainControl.isAvailable()) {
                agc = AutomaticGainControl.create(record.getAudioSessionId());
                if (agc != null) agc.setEnabled(true);
            }
            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IOException("the microphone is in use");
            }
        } catch (IOException | RuntimeException e) {
            // Held by something else (a call, another recorder), or refused.
            Log.w(TAG, "could not start spotting", e);
            release();
            return false;
        }
        running = true;
        lastPartial = "";
        thread = new Thread(this::listen, "wake-spotter");
        thread.start();
        return true;
    }

    void stop() {
        if (!running && record == null) return;
        running = false;
        Thread t = thread;
        thread = null;
        if (t != null) {
            try {
                t.join(500);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        release();
    }

    private void release() {
        if (record != null) {
            try { record.stop(); } catch (RuntimeException ignored) { }
            record.release();
            record = null;
        }
        if (agc != null) {
            agc.release();
            agc = null;
        }
        if (recognizer != null) {
            recognizer.close();
            recognizer = null;
        }
        if (secondLook != null) {
            secondLook.close();
            secondLook = null;
        }
        if (oww != null) {
            oww.close();
            oww = null;
        }
    }

    /** The recording loop: read, level, recognise, report. Its own thread. */
    private void listen() {
        short[] buffer = new short[CHUNK];
        // The last three seconds, for the second look.
        short[] ring = new short[RATE * 3];
        int ringPos = 0;
        boolean ringFull = false;
        // Words still arriving that have stopped changing: in a noisy room the
        // utterance may never end, so a short greeting-like phrase that holds
        // still for 700 ms gets its second look without waiting for the end.
        String settling = "";
        long settledSince = 0;
        boolean looked = false;
        double level = TARGET_RMS;   // smoothed speech level, for the gain
        while (running) {
            AudioRecord source = record;
            Recognizer decoder = recognizer;
            if (source == null || decoder == null) break;
            int read = source.read(buffer, 0, buffer.length);
            if (read <= 0) {
                if (read < 0) break;
                continue;
            }
            double rms = rms(buffer, read);
            // Follow loud sound fast and quiet sound slowly, so a word lifts
            // the gain's reference at once while silence does not pump it up.
            level = rms > level ? level * 0.6 + rms * 0.4 : level * 0.995 + rms * 0.005;
            double gain = Math.max(1.0, Math.min(MAX_GAIN, TARGET_RMS / Math.max(level, 1.0)));
            if (gain > 1.01) amplify(buffer, read, gain);
            long now = System.currentTimeMillis();
            for (int i = 0; i < read; i++) {
                ring[ringPos++] = buffer[i];
                if (ringPos == ring.length) { ringPos = 0; ringFull = true; }
            }
            // "Hey Jarvis", first, by the detector trained for it.
            OwwDetector detector = oww;
            if (detector != null) {
                float score;
                try {
                    score = detector.feed(buffer, read);
                } catch (Exception e) {
                    score = 0f;
                }
                if (verbose() && score > 0.2f) Log.d(TAG, String.format("hey jarvis score %.2f", score));
                if (score >= OwwDetector.THRESHOLD) {
                    detector.reset();
                    decoder.reset();
                    settling = "";
                    looked = false;
                    main.post(() -> {
                        if (running) listener.onWake(new WakeWord.Heard("jarvis", ""));
                    });
                    continue;
                }
            }
            final boolean done = decoder.acceptWaveForm(buffer, read);
            final String out = done ? decoder.getResult() : decoder.getPartialResult();
            String words = field(out, done ? "text" : "partial");
            if (verbose() && (done || !words.equals(settling)) && !words.isEmpty()) {
                Log.d(TAG, (done ? "final: " : "partial: ") + words + String.format(" (level %.0f, gain %.1f)", rms, gain));
            }
            String named = null;
            if (done) {
                if (WakeWord.match(words) == null && WakeWord.worthSecondLook(words)) {
                    named = lookAgain(ring, ringPos, ringFull, words);
                }
                settling = "";
                looked = false;
            } else if (!words.equals(settling)) {
                settling = words;
                settledSince = now;
                looked = false;
            } else if (!looked && now - settledSince >= 700 && WakeWord.matchPartial(words) == null
                    && WakeWord.worthSecondLook(words)) {
                looked = true;
                named = lookAgain(ring, ringPos, ringFull, words);
            }
            if (named != null) {
                final String name = named;
                main.post(() -> {
                    if (running) listener.onWake(new WakeWord.Heard(name, ""));
                });
                continue;
            }
            main.post(() -> {
                if (done) onResult(out); else onPartialResult(out);
            });
        }
    }

    /** Decode the last three seconds again against the wake phrases alone. */
    private String lookAgain(short[] ring, int pos, boolean full, String firstPass) {
        Recognizer look = secondLook;
        if (look == null) return null;
        int length = full ? ring.length : pos;
        short[] audio = new short[length];
        if (full) {
            System.arraycopy(ring, pos, audio, 0, ring.length - pos);
            System.arraycopy(ring, 0, audio, ring.length - pos, pos);
        } else {
            System.arraycopy(ring, 0, audio, 0, pos);
        }
        look.reset();
        look.acceptWaveForm(audio, audio.length);
        String result = field(look.getFinalResult(), "text");
        if (verbose()) Log.d(TAG, "second look: " + result);
        return WakeWord.secondLookName(result, firstPass);
    }

    private static double rms(short[] samples, int count) {
        double sum = 0;
        for (int i = 0; i < count; i++) sum += (double) samples[i] * samples[i];
        return Math.sqrt(sum / Math.max(count, 1));
    }

    private static void amplify(short[] samples, int count, double gain) {
        for (int i = 0; i < count; i++) {
            double v = samples[i] * gain;
            samples[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, v));
        }
    }

    private void onResult(String hypothesis) {
        if (!running) return;
        String text = field(hypothesis, "text");
        lastPartial = "";
        WakeWord.Heard heard = WakeWord.match(text);
        if (heard != null) listener.onWake(heard);
    }

    /** Words still arriving: a strong greeting and a name wakes at once (WakeWord.matchPartial). */
    private void onPartialResult(String hypothesis) {
        if (!running) return;
        String text = field(hypothesis, "partial");
        if (text.equals(lastPartial)) return;
        lastPartial = text;
        WakeWord.Heard heard = WakeWord.matchPartial(text);
        if (heard != null) {
            lastPartial = "";
            listener.onWake(heard);
        }
    }

    private static String field(String json, String name) {
        try {
            return new JSONObject(json).optString(name, "");
        } catch (Exception e) {
            return "";
        }
    }
}
