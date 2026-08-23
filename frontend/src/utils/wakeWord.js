/**
 * Always-listening wake phrase.
 *
 * Runs the browser's own speech recogniser in the background, looking only for
 * an activation phrase. Nothing is sent anywhere: the audio never leaves the
 * recogniser, and the callback fires only when the phrase is heard.
 *
 * This deliberately does not hold the microphone while a live voice session is
 * running — the two cannot share the device reliably.
 */

const DEFAULT_PHRASE = 'hey smaran';

/** Loose match: recognisers routinely mis-split or mis-spell short phrases. */
const buildMatcher = (phrase) => {
  const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return () => false;
  const last = words[words.length - 1];
  // Common mishearings of the assistant's name.
  const alternates = {
    smaran: ['smaran', 'smarn', 'smaraan', 'samaran', 'smarter', 'smoran'],
    myraa: ['myraa', 'myra', 'mira', 'meera'],
  };
  const tail = alternates[last] || [last];
  const head = words.slice(0, -1).join(' ');

  return (heard) => {
    const text = heard.toLowerCase();
    return tail.some((variant) => (head ? text.includes(`${head} ${variant}`) : text.includes(variant)));
  };
};

export class WakeWordListener {
  constructor({ phrase = DEFAULT_PHRASE, onWake, onError } = {}) {
    this.phrase = phrase;
    this.onWake = onWake;
    this.onError = onError;
    this.recognition = null;
    this.running = false;
    this.matches = buildMatcher(phrase);
    this.restartTimer = null;
  }

  static isSupported() {
    return typeof window !== 'undefined'
      && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  setPhrase(phrase) {
    this.phrase = phrase || DEFAULT_PHRASE;
    this.matches = buildMatcher(this.phrase);
  }

  start() {
    if (this.running || !WakeWordListener.isSupported()) return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const heard = event.results[i][0]?.transcript || '';
          if (this.matches(heard)) {
            this.onWake?.(heard.trim());
            return;
          }
        }
      };

      recognition.onerror = (event) => {
        // "no-speech" and "aborted" are routine while idling; only real
        // failures are worth reporting.
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.running = false;
          this.onError?.('Microphone permission is needed for the wake phrase.');
        }
      };

      recognition.onend = () => {
        // Recognisers stop themselves periodically; restart while enabled.
        if (!this.running) return;
        this.restartTimer = window.setTimeout(() => {
          try { recognition.start(); } catch { /* already starting */ }
        }, 400);
      };

      recognition.start();
      this.recognition = recognition;
      this.running = true;
      return true;
    } catch (error) {
      this.onError?.(`The wake phrase listener could not start: ${error?.message || 'unknown error'}`);
      return false;
    }
  }

  stop() {
    this.running = false;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    try { this.recognition?.abort(); } catch { /* already stopped */ }
    this.recognition = null;
  }
}

export const WAKE_PHRASE_DEFAULT = DEFAULT_PHRASE;
