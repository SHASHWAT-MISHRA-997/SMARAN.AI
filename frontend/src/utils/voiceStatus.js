/**
 * Which of the failure-shaped voice conditions, if any, is actually true.
 *
 * This is the ordering that produced the reported bug, so it is pulled out
 * where it can be asserted on rather than read.
 *
 * What went wrong: the recorded-audio transcriber is a fallback, run whenever
 * the on-device recogniser returns no words. A phone that has never been
 * paired with a desktop has no transcription endpoint, so the fallback failed
 * on every quiet moment - and its failure was folded into the same condition
 * as a denied microphone. The call reported "Voice input unavailable" while
 * the microphone was working, with "I did not catch that" printed underneath
 * it: one line saying try again, the other saying the hardware is broken.
 *
 * The distinctions that matter here:
 *
 *   mic-denied              the user refused, or the platform refuses
 *   voice-unavailable       no input path works at all
 *   no-speech               a turn ended with no words; still listening
 *   transcriber-unavailable the fallback route is missing; recogniser is fine
 *
 * Returns null when nothing is wrong, so the caller falls through to its
 * ordinary listening and speaking states.
 */
export function voiceOutcomeKind({
  micStatus = 'idle',
  voiceState = 'idle',
  uploadStatus = 'idle',
  heardNothing = false,
  nativeRecognizerFailed = false,
} = {}) {
  if (micStatus === 'denied') return 'mic-denied';
  if (micStatus === 'unavailable' || micStatus === 'error'
      || voiceState === 'error' || nativeRecognizerFailed) {
    return 'voice-unavailable';
  }
  // Ahead of the transcriber, because when both are true the useful sentence
  // is the one about this turn.
  if (heardNothing) return 'no-speech';
  if (uploadStatus === 'error' || uploadStatus === 'unavailable') return 'transcriber-unavailable';
  return null;
}

/**
 * How long silence must last before a turn is treated as finished.
 *
 * A single number cannot serve both things people do here. Answering a
 * question is a short burst and a short gap: waiting two seconds after "yes"
 * feels broken. Dictating a paragraph is long, and the gaps between its
 * sentences are longer than the gap that ends a reply - so the same 850 ms
 * that keeps a conversation responsive cuts a dictated sentence in half. That
 * is the reported "it cuts my sentences".
 *
 * So the window grows with how much has already been said, which is the one
 * signal available before the sentence is over. It is not a blanket increase:
 * a short utterance still ends after `base`.
 *
 * @param {{spokenChars?: number, base?: number, max?: number}} input
 * @returns {number} milliseconds of silence that end the turn
 */
export function silenceWindowMs({ spokenChars = 0, base = 850, max = 2200 } = {}) {
  const chars = Math.max(0, Number(spokenChars) || 0);
  // Below this it is a reply; above it, a dictation. Between them it eases.
  const SHORT = 40;
  const LONG = 220;
  if (chars <= SHORT) return base;
  if (chars >= LONG) return max;
  const progress = (chars - SHORT) / (LONG - SHORT);
  return Math.round(base + (max - base) * progress);
}

/**
 * What to do at one tick of the wait for a recogniser's final result.
 *
 * The silence watchdog fires 850 ms after the audio stops, but a recogniser
 * commits its final result later than that. Reading the interim text at the
 * watchdog was sending half a sentence and throwing away the rest when it
 * arrived - the reported "it cuts my sentences".
 *
 * Pure so the ordering can be asserted. The precedence matters: a cancelled
 * call beats everything, resumed speech beats a final that has not arrived,
 * and the deadline is the last resort.
 *
 *   final      the recogniser committed; send that
 *   resumed    audio came back, so the pause was a breath - send nothing
 *   cancelled  muted or closed; there is nobody to answer
 *   timeout    nothing final arrived; the caller falls back to the interim
 *   wait       keep polling
 */
export function pollFinalTranscript({
  finalText = '',
  lastSpeechAt = 0,
  quietSince = 0,
  muted = false,
  open = true,
  expired = false,
} = {}) {
  if (muted || !open) return 'cancelled';
  if (String(finalText).trim()) return 'final';
  if (lastSpeechAt > quietSince) return 'resumed';
  if (expired) return 'timeout';
  return 'wait';
}

/**
 * Why a recorded-audio transcription attempt produced nothing.
 *
 * 'unreachable' means there was nothing listening - the ordinary case for a
 * standalone phone, and not a fault to report as one. 'failed' means a server
 * answered and refused, which is worth surfacing.
 */
export function classifyTranscriptionFailure(error, httpStatus) {
  if (httpStatus === 404 || httpStatus === 501) return 'unreachable';
  if (typeof httpStatus === 'number' && httpStatus > 0) return 'failed';
  const message = String(error?.message || error || '');
  if (error instanceof TypeError) return 'unreachable';
  if (/failed to fetch|networkerror|load failed|network request failed|econnrefused/i.test(message)) {
    return 'unreachable';
  }
  return 'failed';
}
