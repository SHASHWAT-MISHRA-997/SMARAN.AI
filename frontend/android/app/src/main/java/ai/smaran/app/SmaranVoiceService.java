package ai.smaran.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.Manifest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "Hey SMARAN", heard from anywhere on the phone.
 *
 * A foreground service, because that is what Android provides for holding
 * the microphone while the app is not on screen. The price is a notification
 * that cannot be swiped away, and that price is the point: an app that
 * listens while you are elsewhere should be visibly doing so, and stoppable
 * from where it is seen.
 *
 * How it listens:
 *
 *  1. WakeSpotter waits for the wake phrase, offline, reading the microphone
 *     directly. It never takes audio focus, so a song keeps playing.
 *  2. On "Hey SMARAN" (or Amarya, Myra, Jarvis) - if SMARAN is on screen, the
 *     page opens its voice call, which answers anything. Otherwise SMARAN
 *     asks "How may I help you?" and hears one instruction with Android's own
 *     recogniser, which understands Hindi and Hinglish.
 *  3. A phone action (play, pause, open, "which song?") is done here, now.
 *     Anything else - a question - is handed to the app, which opens with it.
 *  4. Back to waiting.
 *
 * While the page itself is listening (a call, dictation) this steps aside
 * entirely: two owners of one microphone is how both end up deaf.
 *
 * If the wake model cannot be loaded, the old behaviour stands in: every
 * sentence is checked for an instruction, as before this existed.
 */
public class SmaranVoiceService extends Service implements WakeSpotter.Listener {
    private static final String TAG = "SmaranVoiceService";
    private static final String CHANNEL_ID = "smaran_listening";
    private static final int NOTIFICATION_ID = 4102;

    public static final String ACTION_START = "ai.smaran.app.LISTEN_START";
    public static final String ACTION_STOP = "ai.smaran.app.LISTEN_STOP";
    /** An extra on MainActivity's intent: something asked out loud for the app to answer. */
    public static final String EXTRA_QUERY = "ai.smaran.app.VOICE_QUERY";
    /** An extra on MainActivity's intent: "Hey SMARAN" was heard; open the voice call. */
    public static final String EXTRA_WAKE = "ai.smaran.app.VOICE_WAKE";

    private static final String WAITING = "Say “Hey SMARAN”";
    private static final String GREETING = "How may I help you?";

    /** Read by the plugin so the page can show whether it is on. */
    static volatile boolean running = false;
    private static boolean uiVisible = false;
    private static boolean pageListening = false;
    private static SmaranVoiceService instance;

    /** Where a wake phrase heard while the app is on screen goes: its voice call. */
    interface PageSink {
        /** True if the page took it. */
        boolean onWake(String rest);
        /** A wake phrase said over SMARAN's own answer: stop talking and listen. */
        boolean onInterrupt(String name);
    }
    static PageSink pageSink;

    // Activity lifecycle callbacks and Service callbacks run on the main thread.
    static void setUiVisible(boolean visible) {
        uiVisible = visible;
        // Off screen (stopped, not merely floating), the page cannot be holding
        // the microphone - and its JavaScript is paused, so the call ending
        // behind Spotify never got to say so, and the wake word stayed deaf
        // until SMARAN was opened again.
        if (!visible) pageListening = false;
        if (instance != null) instance.conditionsChanged();
    }

    /** The page opened or closed its own microphone: a call, or dictation. */
    static void setPageListening(boolean listening) {
        pageListening = listening;
        if (instance != null) instance.conditionsChanged();
    }

    /*
     * The call is speaking its answer. The page stops its own recogniser for
     * that (it would hear the answer), which left nothing listening at all:
     * "Hey SMARAN" said over a long reply was ignored and the reply carried
     * on. While the page speaks, the wake listener runs - trained detectors
     * only - and a wake stops the answer so the call listens again.
     */
    private static boolean pageSpeaking = false;

    static void setPageSpeaking(boolean speaking) {
        if (speaking != pageSpeaking) Log.i(TAG, "page speaking: " + speaking);
        pageSpeaking = speaking;
        if (instance != null) instance.conditionsChanged();
    }

    private final WakeSpotter spotter = new WakeSpotter(this);
    private SpeechRecognizer recognizer;
    /** Between a wake phrase and the end of what followed it. */
    private boolean conversing = false;
    /** A question just asked ("which song?") and when; the next turn answers it. */
    private DeviceActions.Command asked;
    private long askedAt;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private int utterances = 0;
    private final Map<String, Runnable> afterSpeech = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable resumeTask = this::resume;
    /* Never stay deaf. A recogniser that never calls back, a page that never
       takes the microphone, an activity Android would not bring forward -
       each of these left `conversing` set and the wake phrase unheard until
       the app was reopened. Whatever happens, listening resumes. */
    private final Runnable stuckGuard = this::unstick;
    private boolean stopping = false;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // Remembered, so the app does not quietly start it again next time.
            getSharedPreferences(SmaranDevice.PREFS, MODE_PRIVATE).edit()
                .putBoolean(SmaranDevice.STOPPED_BY_USER, true).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        // Every crash this app has had in the field was this one line. Android
        // 14 lets a microphone service start only while the app holds the
        // microphone permission *and* is on screen. Voice mode started the
        // service before the permission had ever been asked for, so opening a
        // call closed the app; and START_STICKY then had Android restart the
        // service from the background - where it can never start - so the
        // app died again every few seconds: six crashes in 25 seconds.
        //
        // So: no permission, no start; a refused start is caught and ends the
        // service quietly; and a failed start is never sticky.
        if (!hasMicrophone()) {
            Log.w(TAG, "not starting: microphone permission not granted");
            return giveUp();
        }
        // Restarted by Android itself (START_STICKY hands back a null intent) -
        // after the process was killed, which this phone does when an app's
        // accessibility permission changes. From the background Android gives
        // a microphone service no microphone, so it ran on deaf and "Hey
        // SMARAN" simply stopped working. Say so, and let one tap bring it back.
        if (intent == null) {
            Log.w(TAG, "restarted in the background, where the microphone is not allowed");
            offerRestart();
            return giveUp();
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(WAITING, null),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification(WAITING, null));
            }
        } catch (RuntimeException refused) {
            // SecurityException for the permission, and on Android 12+
            // ForegroundServiceStartNotAllowedException (an
            // IllegalStateException) for starting from the background.
            Log.w(TAG, "Android refused the listening service", refused);
            return giveUp();
        }
        running = true;
        instance = this;
        stopping = false;
        NotificationManager shown = getSystemService(NotificationManager.class);
        if (shown != null) shown.cancel(RESTART_NOTIFICATION_ID);
        if (tts == null) {
            tts = new TextToSpeech(this, status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) return;
                tts.setLanguage(new Locale("en", "IN"));
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { finished(id); }
                    @Override public void onError(String id) { finished(id); }
                });
                ttsReady = true;
            });
        }
        if (!conversing) {
            main.removeCallbacks(resumeTask);
            main.post(resumeTask);
        }
        // START_STICKY so Android brings it back if it is killed for memory;
        // a listener that quietly stops listening is worse than one that does
        // not start.
        return START_STICKY;
    }

    private static final int RESTART_NOTIFICATION_ID = 4103;

    /** A notification that reopens SMARAN, which starts listening again from the foreground. */
    private void offerRestart() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        buildNotification("", null); // makes sure the channel exists
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 2, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(RESTART_NOTIFICATION_ID, new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SMARAN.AI stopped listening")
            .setContentText("Tap to turn “Hey SMARAN” back on.")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build());
    }

    private boolean hasMicrophone() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** End a start that cannot succeed, without a restart to try it again. */
    private int giveUp() {
        running = false;
        stopping = true;
        if (instance == this) instance = null;
        stopSelf();
        return START_NOT_STICKY;
    }

    // ── who holds the microphone ────────────────────────────────────────────

    private void conditionsChanged() {
        if (stopping) return;
        if (pageListening) {
            if (pageSpeaking && uiVisible && WakeSpotter.ready()) {
                // Over SMARAN's own answer: only the trained detectors. The page
                // releases its recogniser at about the same moment, so the
                // microphone can still be busy; try again shortly until it is
                // free or the answer ends.
                main.removeCallbacks(resumeTask);
                spotter.setTrainedOnly(true);
                if (!spotter.running() && !spotter.start()) {
                    main.postDelayed(this::conditionsChanged, 300);
                } else {
                    Log.i(TAG, "listening over the answer");
                }
                return;
            }
            spotter.setTrainedOnly(false);
            hush();
            return;
        }
        spotter.setTrainedOnly(false);
        if (conversing) return; // it resumes itself when the exchange is over
        main.removeCallbacks(resumeTask);
        main.postDelayed(resumeTask, 600);
    }

    /** Wait for the wake phrase again. */
    private void resume() {
        if (stopping || pageListening) return;
        conversing = false;
        main.removeCallbacks(stuckGuard);
        if (WakeSpotter.ready()) {
            if (spotter.start()) {
                status(WAITING, null);
            } else {
                // The microphone is busy - a phone call, another app recording.
                main.postDelayed(resumeTask, 3000);
            }
            return;
        }
        if (WakeSpotter.failed()) {
            // No wake model: the behaviour from before it existed.
            if (!uiVisible) listen();
            return;
        }
        status("Getting ready…", null);
        WakeSpotter.load(this, resumeTask);
    }

    /** Let go of the microphone and stop talking. */
    private void hush() {
        main.removeCallbacksAndMessages(null);
        afterSpeech.clear();
        spotter.stop();
        destroyRecognizer();
        if (tts != null) tts.stop();
        conversing = false;
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    // ── the wake phrase and what follows it ─────────────────────────────────

    @Override
    public void onWake(WakeWord.Heard heard) {
        if (!stopping && pageListening && pageSpeaking && pageSink != null) {
            spotter.stop();
            spotter.setTrainedOnly(false);
            Log.i(TAG, "interrupted by: " + heard.name);
            buzz();
            pageSink.onInterrupt(heard.name);
            return;
        }
        if (stopping || pageListening || conversing) {
            Log.i(TAG, "wake ignored: stopping=" + stopping + " pageListening=" + pageListening
                + " conversing=" + conversing);
            return;
        }
        spotter.stop();
        conversing = true;
        Log.i(TAG, "woken: " + heard.name);
        // Felt at once, whatever else happens. The spoken greeting is not
        // enough on its own: this phone mutes an app's background playback,
        // so "How may I help you?" was never heard and nothing said it had
        // woken at all.
        buzz();
        main.removeCallbacks(stuckGuard);
        main.postDelayed(stuckGuard, 20000);
        // SMARAN is on screen: its own voice call answers, with the character
        // and the model. If the page does not take the microphone within a few
        // seconds, go back to waiting rather than stay deaf.
        if (uiVisible && pageSink != null && pageSink.onWake(heard.rest)) {
            main.postDelayed(resumeTask, 5000);
            return;
        }
        // "Hey SMARAN, play music on Spotify" in one breath: the offline model
        // caught an instruction after the name, so there is nothing to ask.
        if (!heard.rest.isEmpty() && DeviceActions.detect(heard.rest) != null) {
            answer(heard.rest);
            return;
        }
        // Elsewhere: bring the voice call forward, the way an assistant pops
        // up. On screen, its greeting is heard, Hinglish is understood by the
        // page's recogniser, and a question is answered, not just a command.
        if (openCall(heard.rest)) {
            // Android may decline to bring an app forward from the background.
            // If it has not come up, ask here instead.
            main.postDelayed(() -> {
                if (conversing && !uiVisible && !pageListening) say(GREETING, this::hearInstruction);
            }, 1500);
            return;
        }
        say(GREETING, this::hearInstruction);
    }

    private void unstick() {
        if (conversing && !pageListening && !stopping) {
            Log.i(TAG, "nothing followed the wake phrase; listening again");
            destroyRecognizer();
            resume();
        }
    }

    /** Start the app with its voice call open. False if Android refused outright. */
    private boolean openCall(String rest) {
        SmaranDevice.setPendingWake(rest);
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(EXTRA_WAKE, true);
        try {
            startActivity(open);
            return true;
        } catch (RuntimeException refused) {
            Log.w(TAG, "could not bring the voice call forward", refused);
            SmaranDevice.setPendingWake(null);
            return false;
        }
    }

    /** A short buzz: "I heard you". */
    private void buzz() {
        try {
            android.os.Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager manager = getSystemService(android.os.VibratorManager.class);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else {
                vibrator = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                vibrator.vibrate(android.os.VibrationEffect.createOneShot(70,
                    android.os.VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (RuntimeException ignored) {
            // No vibrator, or not allowed: the notification still says it.
        }
    }

    /* Nothing to act on: silence, a lone filler word, or the wake phrase said
       again ("Hey Amarya" repeated). This used to be handed to the app as a
       question, which opened a call - and stopped the listening - for nothing. */
    private static boolean nothingSaid(String said) {
        String text = said == null ? "" : said.trim();
        if (text.isEmpty()) return true;
        WakeWord.Heard again = WakeWord.match(text);
        if (again != null && again.rest.isEmpty()) return true;
        return !text.contains(" ") && text.length() < 4;
    }

    /** One turn of Android's recogniser, for the instruction itself. */
    private void hearInstruction() {
        if (stopping || pageListening) return;
        main.removeCallbacks(stuckGuard);
        main.postDelayed(stuckGuard, 20000);
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            resume();
            return;
        }
        destroyRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new OneTurn() {
            @Override void heard(String said) {
                destroyRecognizer();
                if (stopping || pageListening) return;
                if (nothingSaid(said)) {
                    resume();
                } else {
                    answer(said);
                }
            }
        });
        try {
            recognizer.startListening(recognitionRequest());
        } catch (Exception e) {
            Log.w(TAG, "could not hear the instruction", e);
            resume();
        }
    }

    /** Do what was said, if the phone can; otherwise give it to the app. */
    private void answer(String said) {
        Outcome outcome = handle(said);
        switch (outcome.kind) {
            case QUESTION:
                say(outcome.spoken, this::hearInstruction);
                break;
            case SPOKEN:
                say(outcome.spoken, this::resume);
                break;
            case PLAYING:
                // Spoken over, the song would pause. The notification says it.
                status(outcome.spoken, null);
                main.postDelayed(resumeTask, 800);
                break;
            default:
                handToApp(said);
                main.postDelayed(resumeTask, 800);
                break;
        }
    }

    /**
     * A question, not a phone action: SMARAN opens with it and answers.
     *
     * Android may refuse to bring an app forward from the background, so the
     * notification carries the same request - one tap asks it.
     */
    private void handToApp(String query) {
        SmaranDevice.setPendingQuery(query);
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_QUERY, query);
        try {
            startActivity(open);
        } catch (RuntimeException refused) {
            Log.w(TAG, "could not bring SMARAN forward", refused);
        }
        status("“" + query + "” — tap to see the answer", open);
    }

    // ── the fallback: every sentence checked, no wake phrase ────────────────

    /**
     * One turn of listening, restarted for the next. Used only when the wake
     * model could not be loaded.
     */
    private void listen() {
        if (stopping || uiVisible || pageListening) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.w(TAG, "no recognition service on this device");
            stopSelf();
            return;
        }
        destroyRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new OneTurn() {
            @Override void heard(String said) {
                if (stopping || uiVisible || pageListening) return;
                if (said.isEmpty()) {
                    main.postDelayed(SmaranVoiceService.this::listen, 250);
                    return;
                }
                Outcome outcome = handle(said);
                if (outcome.kind == Kind.PLAYING) {
                    // Listening on would take audio focus and pause the song.
                    status(outcome.spoken, null);
                    stopping = true;
                    main.removeCallbacksAndMessages(null);
                    main.postDelayed(SmaranVoiceService.this::stopSelf, 400);
                } else if (outcome.kind == Kind.QUESTION || outcome.kind == Kind.SPOKEN) {
                    say(outcome.spoken, SmaranVoiceService.this::listen);
                } else {
                    main.postDelayed(SmaranVoiceService.this::listen, 250);
                }
            }
            @Override void failed(int error) {
                if (stopping || uiVisible || pageListening) return;
                // The microphone was taken away - revoked in Settings.
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    giveUp();
                    return;
                }
                long wait = (error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) ? 250 : 1500;
                main.postDelayed(SmaranVoiceService.this::listen, wait);
            }
        });
        try {
            recognizer.startListening(recognitionRequest());
        } catch (Exception e) {
            Log.w(TAG, "could not start listening", e);
            main.postDelayed(this::listen, 2000);
        }
    }

    private Intent recognitionRequest() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                      RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            // The phone's own language settings decide, and API 34 upward can
            // switch between them mid-sentence. Pinning en-GB here was the
            // original reason Hindi came out as nonsense.
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, recognitionLanguage())
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
    }

    /* The phone's language, except that English means Indian English. This
       phone is set to English (UK), and en-GB heard Hinglish instructions
       as nonsense; en-IN is trained on exactly that mix. */
    private static String recognitionLanguage() {
        Locale locale = Locale.getDefault();
        return "en".equals(locale.getLanguage()) ? "en-IN" : locale.toLanguageTag();
    }

    /** SpeechRecognizer's listener, reduced to "this was said" or "nothing was". */
    private abstract static class OneTurn implements RecognitionListener {
        abstract void heard(String said);
        void failed(int error) { heard(""); }

        @Override public void onReadyForSpeech(android.os.Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rms) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int type, android.os.Bundle params) { }
        @Override public void onPartialResults(android.os.Bundle partial) { }
        @Override public void onError(int error) { failed(error); }
        @Override public void onResults(android.os.Bundle results) {
            ArrayList<String> heard = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            heard(heard == null || heard.isEmpty() || heard.get(0) == null ? "" : heard.get(0).trim());
        }
    }

    // ── carrying it out ──────────────────────────────────────────────────────

    private enum Kind { NONE, QUESTION, SPOKEN, PLAYING }

    private static final class Outcome {
        final Kind kind;
        final String spoken;
        Outcome(Kind kind, String spoken) {
            this.kind = kind;
            this.spoken = spoken == null ? "" : spoken;
        }
    }

    /** Act on what was heard, if it was an instruction. */
    private Outcome handle(String said) {
        DeviceActions.Command command = null;
        if (asked != null && System.currentTimeMillis() - askedAt < 60_000) {
            DeviceActions.Command question = asked;
            asked = null;
            command = DeviceActions.answer(question, said);
            if (command != null && "cancelled".equals(command.action)) {
                return new Outcome(Kind.SPOKEN, "hi".equals(question.lang) ? "ठीक है।"
                    : "hinglish".equals(question.lang) ? "Theek hai." : "Okay.");
            }
        }
        asked = null;
        if (command == null) command = DeviceActions.detect(said);
        if (command == null) return new Outcome(Kind.NONE, "");
        // "Play music on Spotify": ask which song, and hear the answer next.
        if ("ask".equals(command.action)) {
            asked = command;
            askedAt = System.currentTimeMillis();
            return new Outcome(Kind.QUESTION, command.argument);
        }
        String spoken = DeviceActions.perform(this, command);
        // Something just started playing. Speaking over it, or listening with
        // Android's recogniser, takes audio focus and the song pauses itself a
        // few seconds in - measured on a phone. So nothing is said aloud.
        boolean startsPlayback = "music".equals(command.action)
            || "youtube_play".equals(command.action)
            || ("media".equals(command.action) && ("play".equals(command.argument)
                || "next".equals(command.argument) || "previous".equals(command.argument)));
        return new Outcome(startsPlayback ? Kind.PLAYING : Kind.SPOKEN, spoken);
    }

    // ── speaking and the notification ────────────────────────────────────────

    private static final Pattern DEVANAGARI = Pattern.compile("[ऀ-ॿ]");

    /** Say it, then run `after` once it has been said - never while it is being said. */
    private void say(String text, Runnable after) {
        if (tts == null || !ttsReady || text == null || text.isEmpty()) {
            if (after != null) main.postDelayed(after, 200);
            return;
        }
        status(text, null);
        String id = "svc_" + (++utterances);
        if (after != null) afterSpeech.put(id, after);
        tts.setLanguage(DEVANAGARI.matcher(text).find() ? new Locale("hi", "IN") : new Locale("en", "IN"));
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            finished(id);
            return;
        }
        // Some engines never report the end. Listening must not wait for ever,
        // nor start while the words are still coming out.
        main.postDelayed(() -> finished(id), 2500 + 90L * text.length());
    }

    private void finished(String id) {
        main.post(() -> {
            Runnable after = afterSpeech.remove(id);
            if (after != null && !stopping) after.run();
        });
    }

    private void status(String text, Intent tapped) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && running) manager.notify(NOTIFICATION_ID, buildNotification(text, tapped));
    }

    private Notification buildNotification(String text, Intent tapped) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null
                && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Listening", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while SMARAN.AI is listening for “Hey SMARAN”.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = tapped != null ? tapped : new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, SmaranVoiceService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, stop,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SMARAN.AI")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(tap)
            // A way out that does not require finding the app first. A service
            // holding the microphone must be stoppable from where it is seen.
            .addAction(new Notification.Action.Builder(null, "Stop", stopIntent).build())
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        stopping = true;
        running = false;
        if (instance == this) instance = null;
        hush();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.onDestroy();
    }
}
