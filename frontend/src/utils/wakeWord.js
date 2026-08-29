/**
 * Always-listening wake phrase.
 *
 * Runs the browser's speech recognition in the background, listening for
 * activation keywords ('hey smaran', 'smaran', 'jarvis', 'myraa', etc.).
 * Synthesizes a futuristic chime upon trigger and activates voice mode.
 */

const DEFAULT_PHRASE = 'hey smaran';

/** Play a gentle futuristic audio chime using Web Audio API (no external file needed) */
export const playWakeChime = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.14); // D6

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);

    setTimeout(() => {
      try { ctx.close(); } catch (_) {}
    }, 450);
  } catch (_) {}
};

/** Loose & robust phrase matcher with extensive Hindi / Hinglish / English aliases */
const buildMatcher = (phrase) => {
  const customWords = phrase ? phrase.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];
  
  // Standard built-in wake phrases
  const globalAliases = [
    'hey smaran', 'smaran', 'smaran ai', 'samaran', 'smarn', 'smaraan',
    'hey myra', 'myra', 'myraa', 'meera', 'hey meera',
    'jarvis', 'hey jarvis', 'alexa', 'wake up', 'namaste smaran',
    'suno smaran', 'bhai smaran', 'hello smaran', 'start listening'
  ];

  return (heard) => {
    if (!heard || typeof heard !== 'string') return false;
    const text = heard.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').trim();
    if (!text) return false;

    // Check custom phrase match
    if (customWords.length > 0) {
      const customStr = customWords.join(' ');
      if (text.includes(customStr)) return true;
      const lastWord = customWords[customWords.length - 1];
      if (lastWord.length > 3 && text.includes(lastWord)) return true;
    }

    // Check against global wake aliases
    return globalAliases.some((alias) => text.includes(alias));
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
    this.retryCount = 0;
  }

  static isSupported() {
    return typeof window !== 'undefined'
      && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  setPhrase(phrase) {
    this.phrase = phrase || DEFAULT_PHRASE;
    this.matches = buildMatcher(this.phrase);
  }

  _createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          for (let j = 0; j < event.results[i].length; j += 1) {
            const transcript = event.results[i][j]?.transcript || '';
            if (this.matches(transcript)) {
              playWakeChime();
              this.onWake?.(transcript.trim());
              return;
            }
          }
        }
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.running = false;
          this.onError?.('Microphone permission is needed for the wake phrase.');
        }
      };

      recognition.onend = () => {
        if (!this.running) return;
        // In Chromium, we MUST create a fresh SpeechRecognition instance on restart
        if (this.restartTimer) window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => {
          if (!this.running) return;
          this._startInstance();
        }, 350);
      };

      return recognition;
    } catch (e) {
      return null;
    }
  }

  _startInstance() {
    if (!this.running) return;
    try {
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) {}
        this.recognition = null;
      }
      this.recognition = this._createRecognition();
      if (this.recognition) {
        this.recognition.start();
        this.retryCount = 0;
      }
    } catch (err) {
      this.retryCount += 1;
      if (this.retryCount < 5 && this.running) {
        this.restartTimer = window.setTimeout(() => this._startInstance(), 600);
      } else {
        this.onError?.(`Wake listener error: ${err?.message || 'cannot start mic'}`);
      }
    }
  }

  start() {
    if (this.running || !WakeWordListener.isSupported()) return false;
    this.running = true;
    this.retryCount = 0;
    this._startInstance();
    return true;
  }

  stop() {
    this.running = false;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try { this.recognition.abort(); } catch (_) {}
      this.recognition = null;
    }
  }
}

export const WAKE_PHRASE_DEFAULT = DEFAULT_PHRASE;
