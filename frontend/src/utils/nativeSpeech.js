import { registerPlugin } from '@capacitor/core';

const speech = registerPlugin('SmaranSpeech');
let activeListening = null;
let activeSpeechCleanup = null;
const errorMessage = (code) => ({
  1: 'Speech recognition timed out. Check the phone’s connection and try again.',
  2: 'Speech recognition could not reach its service. Check the phone’s connection.',
  3: 'The microphone could not record audio.',
  4: 'The phone’s speech service reported a server error.',
  5: 'The phone’s speech service stopped unexpectedly. Try again.',
  9: 'Microphone permission was refused.',
  8: 'The phone’s speech recognizer is busy. Stop other voice input and try again.',
  12: 'This language is not supported by the phone’s speech service.',
  13: 'Download this language in the phone’s speech settings, then try again.',
  background: 'Dictation stopped because the app moved to the background.',
}[code] || 'The phone’s speech service could not finish recognition. Try again.');

export const available = async () => {
  try { return Boolean((await speech.available())?.available); } catch { return false; }
};

export const speak = async ({ text, language = 'en-IN', gender = 'male', rate = 0.95, pitch = 1.0, onStart, onEnd, onError }) => {
  await stopSpeaking();
  const handles = [];
  const cleanup = async () => {
    await Promise.allSettled(handles.splice(0).map(h => h.remove()));
    if (activeSpeechCleanup === cleanup) activeSpeechCleanup = null;
  };
  activeSpeechCleanup = cleanup;
  try {
    const utteranceId = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    handles.push(await speech.addListener('ttsStart', (data) => {
      if (data.utteranceId === utteranceId) onStart?.();
    }));
    handles.push(await speech.addListener('ttsEnd', async (data) => {
      if (data.utteranceId === utteranceId) {
        await cleanup();
        onEnd?.();
      }
    }));
    handles.push(await speech.addListener('ttsError', async (data) => {
      if (data.utteranceId === utteranceId) {
        await cleanup();
        onError?.(data);
      }
    }));

    await speech.speak({ text, language, gender, rate, pitch, utteranceId });
    return {
      stop: async () => {
        await cleanup();
        await speech.stopSpeaking();
      }
    };
  } catch (err) {
    await cleanup();
    console.warn('nativeSpeech.speak error:', err);
    throw err;
  }
};

export const stopSpeaking = async () => {
  if (activeSpeechCleanup) await activeSpeechCleanup();
  try {
    await speech.stopSpeaking();
  } catch (err) {
    console.warn('nativeSpeech.stopSpeaking error:', err);
  }
};

export const listen = async ({ language, onText, onEnd, continuous = false }) => {
  if (activeListening) await activeListening.cancel();
  const permission = await speech.requestPermissions();
  if (permission?.speechRecognition !== 'granted') throw new Error('Microphone permission was refused.');

  const handles = [];
  let finished = false;
  let stopping = false;
  let waitingToRestart = false;
  let completedText = '';
  let partialText = '';
  let restartTimer;
  let resultTimer;

  const text = () => [completedText, partialText].filter(Boolean).join(' ').trim();
  const clearTimers = () => {
    clearTimeout(restartTimer);
    clearTimeout(resultTimer);
  };
  const finish = async (reason, message) => {
    if (finished) return;
    finished = true;
    clearTimers();
    await Promise.allSettled(handles.map(handle => handle.remove()));
    try { await speech.cancel(); } catch {}
    if (activeListening === stopListening) activeListening = null;
    onEnd?.({ reason, message });
  };
  const startTurn = async () => {
    if (finished || stopping) return;
    waitingToRestart = false;
    partialText = '';
    await speech.start({ language });
  };
  const completeTurn = (reason) => {
    clearTimeout(resultTimer);
    completedText = text();
    partialText = '';
    if (continuous && !stopping) {
      waitingToRestart = true;
      restartTimer = setTimeout(() => {
        void startTurn().catch(error => finish('error', error.message));
      }, reason === 'no-speech' ? 250 : 120);
    } else {
      void finish(stopping ? 'manual' : reason);
    }
  };
  const stopListening = async () => {
    if (finished || stopping) return;
    stopping = true;
    clearTimeout(restartTimer);
    if (waitingToRestart) {
      await finish('manual');
      return;
    }
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      void finish('timeout', 'The phone did not return a final transcript. Text already heard has been kept.');
    }, 10_000);
    try { await speech.stop(); } catch (error) { await finish('error', error.message); }
  };
  stopListening.cancel = () => finish('cancelled');
  Object.defineProperty(stopListening, 'ended', { get: () => finished });
  activeListening = stopListening;

  try {
    handles.push(await speech.addListener('recognitionResults', data => {
      if (finished) return;
      const heard = data.matches?.[0]?.trim();
      if (heard) {
        if (data.isFinal) {
          completedText = completedText ? `${completedText} ${heard}` : heard;
          partialText = '';
        } else {
          partialText = heard;
        }
        onText?.(text());
      }
      if (data.isFinal) completeTurn(heard ? 'final' : 'no-speech');
    }));
    handles.push(await speech.addListener('listeningState', data => {
      if (finished || data.status !== 'processing') return;
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => {
        void finish('timeout', 'The phone did not return a final transcript. Text already heard has been kept.');
      }, 15_000);
    }));
    handles.push(await speech.addListener('recognitionError', data => {
      if (finished) return;
      if (data.noSpeech) completeTurn('no-speech');
      else void finish('error', errorMessage(data.code));
    }));
    await startTurn();
    return stopListening;
  } catch (error) {
    await finish('error', error.message);
    throw error;
  }
};
