package ai.smaran.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(name = "SmaranSpeech", permissions = {
    @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "speechRecognition")
})
public class SmaranSpeech extends Plugin {
    private static final String TAG = "SmaranSpeech";
    private SpeechRecognizer recognizer;
    private int generation;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void load() {
        super.load();
        initTts();
    }

    private void initTts() {
        getActivity().runOnUiThread(() -> {
            try {
                tts = new TextToSpeech(getContext(), status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        ttsReady = true;
                        Log.i(TAG, "Native TextToSpeech initialized successfully.");
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String utteranceId) {
                                notifyListeners("ttsStart", new JSObject().put("utteranceId", utteranceId));
                            }
                            @Override
                            public void onDone(String utteranceId) {
                                notifyListeners("ttsEnd", new JSObject().put("utteranceId", utteranceId));
                            }
                            /**
                             * Which word is being said, so the caption can follow the voice.
                             *
                             * Added in API 26 and only delivered by engines that support it;
                             * minSdk here is 24. On an older device, or an engine that does not
                             * report ranges, this simply never fires and the caption stays
                             * unhighlighted - which is why the page treats a missing range as
                             * "not speaking" rather than waiting for one.
                             *
                             * `start` is an offset into the text handed to speak(), which is the
                             * stripped spoken form rather than the text on screen. The page maps
                             * it across; see utils/spokenProgress.js.
                             */
                            @Override
                            public void onRangeStart(String utteranceId, int start, int end, int frame) {
                                notifyListeners("ttsRange", new JSObject()
                                    .put("utteranceId", utteranceId)
                                    .put("start", start)
                                    .put("end", end));
                            }
                            @Override
                            public void onError(String utteranceId) {
                                notifyListeners("ttsError", new JSObject().put("utteranceId", utteranceId));
                            }
                        });
                    } else {
                        Log.w(TAG, "Native TextToSpeech init returned status: " + status);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "Failed to initialize TextToSpeech", e);
            }
        });
    }

    @PluginMethod
    public void available(PluginCall call) {
        boolean avail = SpeechRecognizer.isRecognitionAvailable(getContext());
        Log.i(TAG, "SpeechRecognizer isRecognitionAvailable: " + avail);
        call.resolve(new JSObject().put("available", avail));
    }

    private void release() {
        generation++;
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("speechRecognition") != PermissionState.GRANTED) {
            call.reject("Microphone permission was refused.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            release();
            final int session = generation;
            try {
                // An available on-device engine does not imply that the user's
                // spoken language is installed. Forcing it selected an English
                // offline model even for Hindi/Hinglish. Use the configured
                // system speech service, which can resolve the requested locale.
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());

                recognizer.setRecognitionListener(new RecognitionListener() {
                    private void state(String status) {
                        if (session == generation) {
                            notifyListeners("listeningState", new JSObject().put("status", status));
                        }
                    }

                    private void results(Bundle bundle, boolean isFinal) {
                        if (session != generation) return;
                        ArrayList<String> matches = bundle == null ? null
                            : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        // Transcripts may contain credentials or personal content.
                        // Keep lifecycle diagnostics without writing speech to logcat.
                        Log.i(TAG, "Speech results received (final=" + isFinal + ")");
                        notifyListeners("recognitionResults", new JSObject()
                            .put("matches", matches == null ? new JSArray() : new JSArray(matches))
                            .put("isFinal", isFinal));
                        if (isFinal) release();
                    }

                    @Override public void onReadyForSpeech(Bundle params) { 
                        Log.i(TAG, "onReadyForSpeech");
                        state("ready"); 
                    }
                    @Override public void onBeginningOfSpeech() { 
                        Log.i(TAG, "onBeginningOfSpeech");
                        state("started"); 
                    }
                    @Override public void onEndOfSpeech() { 
                        Log.i(TAG, "onEndOfSpeech");
                        state("processing"); 
                    }
                    @Override public void onRmsChanged(float level) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                    @Override public void onPartialResults(Bundle bundle) { results(bundle, false); }
                    @Override public void onResults(Bundle bundle) { results(bundle, true); }

                    @Override public void onError(int code) {
                        if (session != generation) return;
                        Log.w(TAG, "SpeechRecognizer error code: " + code);
                        boolean noSpeech = code == SpeechRecognizer.ERROR_NO_MATCH
                            || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
                        notifyListeners("recognitionError", new JSObject()
                            .put("code", code).put("noSpeech", noSpeech));
                        release();
                    }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);

                String lang = call.getString("language", Locale.getDefault().toLanguageTag());
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                // LANGUAGE_PREFERENCE is a response field, and the former
                // EXTRA_ADDITIONAL_LANGUAGES string was not a recognition API.
                if (Build.VERSION.SDK_INT >= 34) {
                    // Do not restrict detection to the reply language or a
                    // two-language allowlist: a user may switch languages.
                    intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true);
                    intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH,
                        RecognizerIntent.LANGUAGE_SWITCH_BALANCED);
                }

                recognizer.startListening(intent);
                Log.i(TAG, "recognizer.startListening called with language: " + lang);
                call.resolve();
            } catch (Exception error) {
                Log.e(TAG, "recognizer startListening failed", error);
                release();
                call.reject("The phone could not start speech recognition: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) {
                try { recognizer.stopListening(); } catch (Exception ignored) {}
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            release();
            call.resolve();
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        String langTag = call.getString("language", "en-IN");
        String gender = call.getString("gender", "male");
        Double rateVal = call.getDouble("rate", 1.0);
        float rate = rateVal != null ? rateVal.floatValue() : 1.0f;
        Double pitchVal = call.getDouble("pitch", 1.0);
        float pitch = pitchVal != null ? pitchVal.floatValue() : 1.0f;
        String utteranceId = call.getString("utteranceId", String.valueOf(System.currentTimeMillis()));

        getActivity().runOnUiThread(() -> {
            if (tts == null) {
                initTts();
            }
            if (tts == null || !ttsReady) {
                call.reject("TextToSpeech not available");
                return;
            }
            try {
                Locale loc;
                if (langTag.startsWith("hi")) {
                    loc = new Locale("hi", "IN");
                } else if (langTag.startsWith("gu")) {
                    loc = new Locale("gu", "IN");
                } else if (langTag.startsWith("ta")) {
                    loc = new Locale("ta", "IN");
                } else if (langTag.startsWith("te")) {
                    loc = new Locale("te", "IN");
                } else if (langTag.startsWith("mr")) {
                    loc = new Locale("mr", "IN");
                } else if (langTag.startsWith("bn")) {
                    loc = new Locale("bn", "IN");
                } else {
                    loc = Locale.forLanguageTag(langTag);
                }
                int res = tts.setLanguage(loc);
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    call.reject("Download the " + loc.getDisplayLanguage() + " voice in the phone's text-to-speech settings.");
                    return;
                }
                Voice selected = null;
                int best = Integer.MIN_VALUE;
                if (tts.getVoices() != null) for (Voice voice : tts.getVoices()) {
                    if (!voice.getLocale().getLanguage().equals(loc.getLanguage())) continue;
                    if (voice.getFeatures() != null && voice.getFeatures().contains("notInstalled")) continue;
                    String name = voice.getName().toLowerCase(Locale.ROOT);
                    boolean female = name.matches(".*(female|woman|neerja|swara|heera|kalpana).*");
                    boolean male = !female && name.matches(".*(male|prabhat|madhur|hemant|ravi).*");
                    int score = voice.getQuality();
                    if (voice.getLocale().getCountry().equals(loc.getCountry())) score += 10000;
                    if (("male".equals(gender) && male) || ("female".equals(gender) && female)) score += 100000;
                    if (("male".equals(gender) && female) || ("female".equals(gender) && male)) score -= 100000;
                    if (selected == null || score > best || (score == best && voice.getName().compareTo(selected.getName()) < 0)) {
                        selected = voice;
                        best = score;
                    }
                }
                if (selected != null) tts.setVoice(selected);
                tts.setSpeechRate(rate);
                tts.setPitch(pitch);
                Bundle params = new Bundle();
                params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
                if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId) == TextToSpeech.ERROR) {
                    call.reject("The phone's speech engine could not play this utterance.");
                    return;
                }
                Log.i(TAG, "Native TTS speaking utterance: " + utteranceId + " in " + loc);
                call.resolve(new JSObject().put("status", "speaking").put("utteranceId", utteranceId));
            } catch (Exception e) {
                Log.e(TAG, "Native TTS speak error", e);
                call.reject("TTS speak failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (tts != null) {
                tts.stop();
            }
            call.resolve();
        });
    }

    @Override protected void handleOnPause() {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) {
                release();
                notifyListeners("recognitionError", new JSObject().put("code", "background"));
            }
            if (tts != null) {
                tts.stop();
            }
        });
    }

    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> {
            release();
            if (tts != null) {
                try {
                    tts.stop();
                    tts.shutdown();
                } catch (Exception ignored) {}
                tts = null;
                ttsReady = false;
            }
        });
    }
}
