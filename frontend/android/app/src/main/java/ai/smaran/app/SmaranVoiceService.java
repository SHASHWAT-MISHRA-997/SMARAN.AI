package ai.smaran.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Listening while the app is not on screen.
 *
 * Without this, a second command never worked. Saying "open WhatsApp" opened
 * WhatsApp, and from that moment the activity was *stopped* - and a stopped
 * activity is not listening, cannot run the page's JavaScript, and cannot even
 * put itself into a floating window. Every one of those was reported as a
 * separate fault; they are one fault.
 *
 * A foreground service is the thing Android provides for this. It survives the
 * activity going away, it is allowed to hold the microphone, and it is allowed
 * to start an activity - which is what carrying out "open YouTube" needs. The
 * price is a notification the user cannot dismiss, and that price is the point:
 * an app that listens while you are elsewhere should be visibly doing so.
 *
 * The command rules live in DeviceActions rather than here, and rather than in
 * the page, because the page's copy cannot run when this service is the only
 * thing awake.
 */
public class SmaranVoiceService extends Service {
    private static final String TAG = "SmaranVoiceService";
    private static final String CHANNEL_ID = "smaran_listening";
    private static final int NOTIFICATION_ID = 4102;

    public static final String ACTION_START = "ai.smaran.app.LISTEN_START";
    public static final String ACTION_STOP = "ai.smaran.app.LISTEN_STOP";

    /** Read by the plugin so the page can show whether it is on. */
    static volatile boolean running = false;

    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean stopping = false;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification("Listening"));
        running = true;
        stopping = false;
        if (tts == null) {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS) tts.setLanguage(new Locale("en", "IN"));
            });
        }
        main.post(this::listen);
        // START_STICKY so Android brings it back if it is killed for memory;
        // a listener that quietly stops listening is worse than one that does
        // not start.
        return START_STICKY;
    }

    private Notification buildNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null
                && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Listening", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while SMARAN.AI is listening for commands.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class)
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

    private void say(String text) {
        if (tts == null || text == null || text.isEmpty()) return;
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "svc_" + System.currentTimeMillis());
    }

    /**
     * One turn of listening, restarted for the next.
     *
     * SpeechRecognizer is single-shot: it ends on silence, on a result, or on
     * an error, and has to be asked again. Restarting is therefore the normal
     * path and not error handling - the guard below is only about not doing it
     * after the service has been told to stop.
     */
    private void listen() {
        if (stopping) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.w(TAG, "no recognition service on this device");
            stopSelf();
            return;
        }
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(android.os.Bundle params) { }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rms) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onEvent(int type, android.os.Bundle params) { }
            @Override public void onPartialResults(android.os.Bundle partial) { }

            @Override
            public void onError(int error) {
                // Silence and no-match are ordinary: nobody spoke. Anything
                // else is worth a breath before trying again, so a persistent
                // fault does not become a tight loop holding the microphone.
                long wait = (error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) ? 250 : 1500;
                main.postDelayed(SmaranVoiceService.this::listen, wait);
            }

            @Override
            public void onResults(android.os.Bundle results) {
                ArrayList<String> heard =
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String said = (heard == null || heard.isEmpty()) ? "" : heard.get(0);
                handle(said);
                main.postDelayed(SmaranVoiceService.this::listen, 250);
            }
        });

        Intent request = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                      RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            // The phone's own language settings decide, and API 34 upward can
            // switch between them mid-sentence. Pinning en-GB here was the
            // original reason Hindi came out as nonsense.
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
        try {
            recognizer.startListening(request);
        } catch (Exception e) {
            Log.w(TAG, "could not start listening", e);
            main.postDelayed(this::listen, 2000);
        }
    }

    /** Act on what was heard, if it was an instruction. */
    private void handle(String said) {
        DeviceActions.Command command = DeviceActions.detect(said);
        if (command == null) return;
        String spoken = DeviceActions.perform(this, command);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && !spoken.isEmpty()) {
            manager.notify(NOTIFICATION_ID, buildNotification(spoken));
        }
        say(spoken);
    }

    @Override
    public void onDestroy() {
        stopping = true;
        running = false;
        main.removeCallbacksAndMessages(null);
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.onDestroy();
    }
}
