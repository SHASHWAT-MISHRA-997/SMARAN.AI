/**
 * Hearing you, on the phone itself.
 *
 * Dictation on Android went: try the WebView's webkitSpeechRecognition, watch
 * it die, fall back to recording the audio and posting it to the backend for
 * transcription. On a phone with no computer linked there is no backend - the
 * app's own file server answers that POST with the page itself, and what
 * arrived on screen was
 *
 *     Speech recognition could not run: Unexpected token '<',
 *     "<!doctype "... is not valid JSON
 *
 * which is the shape of every "we called an endpoint that is not there" bug in
 * this app. The honest fix is not a better error message: Android has had a
 * speech recogniser since 2010 and the app was reaching past it to ask a
 * desktop. This uses the phone's own.
 *
 * The recogniser is Android's, so it is subject to Android's rules: it needs
 * RECORD_AUDIO, and on most devices it needs Google's speech service, which
 * may itself want a network. When it is not there, `available()` says so and
 * the caller can say something true instead of recording into nothing.
 */

let plugin = null;

/** Loaded on demand: the desktop build has no Capacitor to import from. */
const load = async () => {
  if (plugin) return plugin;
  try {
    const module = await import('@capacitor-community/speech-recognition');
    plugin = module.SpeechRecognition;
  } catch {
    plugin = null;
  }
  return plugin;
};

/** Can this device hear? Answering honestly matters more than answering yes. */
export const available = async () => {
  const speech = await load();
  if (!speech) return false;
  try {
    return Boolean((await speech.available())?.available);
  } catch {
    return false;
  }
};

/**
 * Listen until stopped, calling `onText` with the words heard so far.
 *
 * Partial results rather than one block at the end: dictation that shows
 * nothing until you stop talking feels broken, and on a long sentence you
 * cannot tell whether it is hearing you or not.
 *
 * Returns a stop function, or throws with something worth reading.
 */
export const listen = async ({ language, onText, onEnd }) => {
  const speech = await load();
  if (!speech) throw new Error('This build has no speech recogniser.');

  const permission = await speech.requestPermissions();
  if (permission?.speechRecognition !== 'granted') {
    throw new Error('Microphone permission was refused.');
  }

  const handles = [];
  handles.push(await speech.addListener('partialResults', (data) => {
    const heard = (data?.matches || [])[0];
    if (heard) onText?.(heard);
  }));
  // Android ends a session on its own after a pause. Without this the button
  // stayed lit long after the recogniser had stopped listening.
  handles.push(await speech.addListener('listeningState', (data) => {
    if (data?.status === 'stopped') onEnd?.();
  }));

  await speech.start({
    language: language || 'en-US',
    partialResults: true,
    // The system's own dialog would cover the app and hand back one string.
    // Listening in place is what dictation into a text box means.
    popup: false,
  });

  return async () => {
    for (const handle of handles) {
      try { await handle.remove(); } catch { /* already gone */ }
    }
    try { await speech.stop(); } catch { /* not listening */ }
  };
};
