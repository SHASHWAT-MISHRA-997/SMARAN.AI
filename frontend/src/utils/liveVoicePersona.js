/**
 * Voice identity used by Gemini Live.
 *
 * The supplied MYRAA release selected Gemini's prebuilt Aoede voice. There
 * was no recorded voice asset to copy, so keeping this mapping stable is the
 * only way to prevent a saved device preference from changing the character's
 * timbre between calls.
 */
export const REFERENCE_LIVE_VOICES = Object.freeze({
  myra: 'Aoede',
  myraa: 'Aoede',
  amarya: 'Aoede',
  evelyn: 'Aoede',
  core: 'Orus',
});

export const liveVoiceForPersona = (persona = 'myra') => (
  REFERENCE_LIVE_VOICES[String(persona).trim().toLowerCase()] || 'Aoede'
);

