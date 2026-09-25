/* Settings -> Voice & Speech, as the rest of the app reads it.
 *
 * The tab saved a microphone, a reading voice, a persona gender and a
 * dictation mode into keys nothing read: every microphone was opened as the
 * system default, replies were read in whatever voice matched the language,
 * the persona switch did not change the voice's gender (that key was
 * sm_voice_gender), and dictation ignored its switch. These are the readers.
 */

export const MIC_KEY = 'sm_voice_mic';
export const TTS_VOICE_KEY = 'sm_tts_voice';
export const GENDER_KEY = 'sm_voice_gender';
export const CONTINUOUS_KEY = 'sm_continuous_dictation';

const read = (key, storage) => {
  try { return (storage || globalThis.localStorage)?.getItem(key) || ''; } catch { return ''; }
};

/** The audio constraint for getUserMedia: the chosen microphone, or the default. */
export function micConstraint(extra = {}, storage) {
  const id = read(MIC_KEY, storage);
  return id && id !== 'default' ? { ...extra, deviceId: { exact: id } } : (Object.keys(extra).length ? extra : true);
}

/**
 * Open the microphone the owner chose. A chosen device that has been unplugged
 * fails with OverconstrainedError; then the default is used rather than
 * leaving voice broken until someone finds the setting.
 */
export async function openMicrophone(extra = {}, media = globalThis.navigator?.mediaDevices) {
  const audio = micConstraint(extra);
  try {
    return await media.getUserMedia({ audio });
  } catch (err) {
    if (audio !== true && audio?.deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
      return media.getUserMedia({ audio: Object.keys(extra).length ? extra : true });
    }
    throw err;
  }
}

/** The reading voice the owner picked, if the system still has it. */
export function chosenVoice(voices, storage) {
  const name = read(TTS_VOICE_KEY, storage);
  return name ? (voices || []).find((v) => v.name === name) || null : null;
}

export function continuousDictation(storage) {
  return read(CONTINUOUS_KEY, storage) !== 'false';
}
