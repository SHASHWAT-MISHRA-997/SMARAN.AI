package ai.smaran.app;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.Collections;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * "Hey Jarvis" and "Hey SMARAN", each detected by a model trained for exactly
 * that phrase (openWakeWord). Both share one audio front end, so the second
 * phrase costs one small extra model per 80 ms.
 *
 * Vosk is a transcriber: it writes down what it thinks was said, and with a
 * TV on, or from across the room, "Hey Jarvis" came out as "i" or "oh". This
 * model does one thing - score how much the last second or so sounds like
 * "hey jarvis" - and on test audio it scored 1.00 for the phrase, with speech
 * mixed in underneath, and no more than 0.48 for sixteen ordinary sentences
 * ("send the report to Travis" was the closest).
 *
 * The pipeline is openWakeWord's own, fed 80 ms at a time:
 *   audio -> mel spectrogram (32 bins) -> embedding of the last 76 frames
 *   (96 values) -> the wake model over the last 16 embeddings -> a score.
 * "hey smaran" is SMARAN's own model (tools/wakeword/train), loaded when
 * assets/oww/hey_smaran.onnx is present.
 * Not thread-safe; used only from WakeSpotter's recording thread.
 */
final class OwwDetector implements AutoCloseable {
    static final int CHUNK = 1280;                 // 80 ms at 16 kHz
    private static final int CONTEXT = CHUNK + 480; // the mel model needs 3 frames of overlap
    static final float THRESHOLD = 0.6f;          // "hey jarvis"
    static final float SMARAN_THRESHOLD = 0.5f;   // "hey smaran"

    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession mel;
    private final OrtSession embedding;
    private final java.util.List<String> names = new java.util.ArrayList<>();
    private final java.util.List<OrtSession> wakes = new java.util.ArrayList<>();
    private final java.util.List<String> inputs = new java.util.ArrayList<>();
    private final java.util.List<Float> thresholds = new java.util.ArrayList<>();
    /** Each model's score for the latest chunk, for developer logging. */
    final float[] lastScores = new float[2];

    private final float[] audio = new float[CONTEXT];
    private int filled = 0;
    private final float[][] melFrames = new float[76][32];
    private final float[][] embeddings = new float[16][96];
    private int embeddingCount = 0;

    OwwDetector(Context context) throws IOException, OrtException {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        // One thread each: this runs all day beside the rest of the phone.
        options.setIntraOpNumThreads(1);
        options.setInterOpNumThreads(1);
        mel = env.createSession(asset(context, "oww/melspectrogram.onnx"), options);
        embedding = env.createSession(asset(context, "oww/embedding_model.onnx"), options);
        addWake("jarvis", env.createSession(asset(context, "oww/hey_jarvis_v0.1.onnx"), options), THRESHOLD);
        try {
            addWake("smaran", env.createSession(asset(context, "oww/hey_smaran.onnx"), options), SMARAN_THRESHOLD);
        } catch (IOException missing) {
            // Built without the model: "Hey SMARAN" is left to the transcriber.
        }
        for (float[] frame : melFrames) java.util.Arrays.fill(frame, 1f);   // openWakeWord starts from ones
    }

    private void addWake(String name, OrtSession session, float threshold) throws OrtException {
        names.add(name);
        wakes.add(session);
        inputs.add(session.getInputNames().iterator().next());
        thresholds.add(threshold);
    }

    String name(int index) { return names.get(index); }

    int count() { return names.size(); }

    private static byte[] asset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1 << 16];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    /**
     * Feed exactly CHUNK samples. Returns the name of the phrase whose score
     * crossed its threshold by the widest margin ("jarvis", "smaran"), or null.
     */
    String feed(short[] samples, int count) throws OrtException {
        java.util.Arrays.fill(lastScores, 0f);
        if (count != CHUNK) return null;
        System.arraycopy(audio, CHUNK, audio, 0, CONTEXT - CHUNK);
        for (int i = 0; i < CHUNK; i++) audio[CONTEXT - CHUNK + i] = samples[i];
        if (filled < CONTEXT) {
            filled += CHUNK;
            if (filled < CONTEXT) return null;
        }

        // Mel spectrogram of the latest audio, transformed as openWakeWord does.
        float[][] newFrames;
        try (OnnxTensor in = OnnxTensor.createTensor(env, FloatBuffer.wrap(audio), new long[] {1, CONTEXT});
             OrtSession.Result out = mel.run(Collections.singletonMap("input", in))) {
            float[][][][] spec = (float[][][][]) out.get(0).getValue();
            newFrames = spec[0][0];
        }
        int shift = Math.min(newFrames.length, 76);
        System.arraycopy(melFrames, shift, melFrames, 0, 76 - shift);
        for (int i = 0; i < shift; i++) {
            float[] frame = new float[32];
            float[] src = newFrames[newFrames.length - shift + i];
            for (int j = 0; j < 32; j++) frame[j] = src[j] / 10f + 2f;
            melFrames[76 - shift + i] = frame;
        }

        // Embedding of the last 76 frames.
        float[] flat = new float[76 * 32];
        for (int i = 0; i < 76; i++) System.arraycopy(melFrames[i], 0, flat, i * 32, 32);
        float[] vector;
        try (OnnxTensor in = OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), new long[] {1, 76, 32, 1});
             OrtSession.Result out = embedding.run(Collections.singletonMap("input_1", in))) {
            float[][][][] e = (float[][][][]) out.get(0).getValue();
            vector = e[0][0][0].clone();
        }
        System.arraycopy(embeddings, 1, embeddings, 0, 15);
        embeddings[15] = vector;
        if (embeddingCount < 16) {
            embeddingCount++;
            if (embeddingCount < 16) return null;
        }

        // Each wake model over the last 16 embeddings.
        float[] window = new float[16 * 96];
        for (int i = 0; i < 16; i++) System.arraycopy(embeddings[i], 0, window, i * 96, 96);
        String best = null;
        float margin = 0f;
        try (OnnxTensor in = OnnxTensor.createTensor(env, FloatBuffer.wrap(window), new long[] {1, 16, 96})) {
            for (int m = 0; m < wakes.size(); m++) {
                float score;
                try (OrtSession.Result out = wakes.get(m).run(Collections.singletonMap(inputs.get(m), in))) {
                    score = ((float[][]) out.get(0).getValue())[0][0];
                }
                if (m < lastScores.length) lastScores[m] = score;
                float over = score - thresholds.get(m);
                if (over >= 0f && (best == null || over > margin)) {
                    best = names.get(m);
                    margin = over;
                }
            }
        }
        return best;
    }

    /** Forget the audio so far - after a wake, so the same phrase does not wake it twice. */
    void reset() {
        filled = 0;
        embeddingCount = 0;
        for (float[] frame : melFrames) java.util.Arrays.fill(frame, 1f);
    }

    @Override
    public void close() {
        try { mel.close(); } catch (OrtException ignored) { }
        try { embedding.close(); } catch (OrtException ignored) { }
        for (OrtSession wake : wakes) {
            try { wake.close(); } catch (OrtException ignored) { }
        }
    }
}
