package ai.smaran.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;

/**
 * Listening for "Hey SMARAN" without disturbing anything.
 *
 * Android's SpeechRecognizer takes audio focus every time it listens, so a
 * song pauses whenever it starts - which rules it out for listening all the
 * time. Vosk reads the microphone itself, recognises offline, and never asks
 * for focus: music plays on, and nothing leaves the phone until the wake
 * phrase has been heard.
 *
 * One model for the whole process, loaded once (a few seconds, the first
 * time: StorageService copies it out of the APK). Callbacks arrive on the
 * main thread.
 */
final class WakeSpotter implements RecognitionListener {
    private static final String TAG = "WakeSpotter";
    private static final float RATE = 16000.0f;

    interface Listener {
        void onWake(WakeWord.Heard heard);
    }

    private static Model model;
    private static boolean loading;
    private static boolean failed;

    static boolean ready() { return model != null; }
    static boolean failed() { return failed; }

    /** Load the model once. `done` runs on the main thread either way. */
    static void load(Context context, Runnable done) {
        if (model != null || failed) { done.run(); return; }
        if (loading) return;
        loading = true;
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
    private SpeechService speech;

    WakeSpotter(Listener listener) {
        this.listener = listener;
    }

    boolean running() { return speech != null; }

    boolean start() {
        if (speech != null) return true;
        if (model == null) return false;
        try {
            speech = new SpeechService(new Recognizer(model, RATE), RATE);
            speech.startListening(this);
            return true;
        } catch (IOException | RuntimeException e) {
            // The microphone is held by something else, or was refused.
            Log.w(TAG, "could not start spotting", e);
            stop();
            return false;
        }
    }

    void stop() {
        if (speech == null) return;
        try {
            speech.stop();
            speech.shutdown();
        } catch (RuntimeException ignored) {
            // Already released.
        }
        speech = null;
    }

    @Override
    public void onResult(String hypothesis) {
        WakeWord.Heard heard = WakeWord.match(textOf(hypothesis));
        if (heard != null && speech != null) listener.onWake(heard);
    }

    @Override public void onPartialResult(String hypothesis) { }
    @Override public void onFinalResult(String hypothesis) { onResult(hypothesis); }

    @Override
    public void onError(Exception e) {
        Log.w(TAG, "spotting stopped", e);
        stop();
    }

    @Override public void onTimeout() { }

    private static String textOf(String hypothesis) {
        try {
            return new JSONObject(hypothesis).optString("text", "");
        } catch (Exception e) {
            return "";
        }
    }
}
