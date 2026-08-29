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
  constructor({ phrase = DEFAULT_PHRASE, onWake, onError, apiBase = '' } = {}) {
    this.phrase = phrase;
    this.onWake = onWake;
    this.onError = onError;
    this.apiBase = apiBase;
    this.recognition = null;
    this.running = false;
    this.matches = buildMatcher(phrase);
    this.restartTimer = null;
    this.retryCount = 0;
    // The local path, used when Web Speech is absent or refuses.
    this.localRunning = false;
    this.stream = null;
    this.audioCtx = null;
    this.levelTimer = null;
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
        // Web Speech is a cloud service wearing a browser API. In the desktop
        // WebView2 and in an Android WebView the object exists, so
        // isSupported() said yes, and then every attempt failed here with
        // 'network' or 'service-not-allowed'. Nothing handled those: the
        // listener just restarted itself every 350ms, for ever, listening to
        // a service that was never going to answer. Switch to the local
        // recogniser instead, which needs nobody's cloud.
        if (event.error === 'network' || event.error === 'service-not-allowed'
            || event.error === 'language-not-supported') {
          this._startLocal();
          return;
        }
        if (event.error === 'not-allowed') {
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

  /** Listen for the phrase without any cloud service.
   *
   * Transcribing continuously would keep a GPU busy for nothing, so the
   * microphone is only listened to; a short clip is sent for transcription
   * when the level rises above the room, and only then. Quiet rooms cost
   * nothing.
   */
  async _startLocal() {
    if (this.localRunning || !this.running) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.onError?.('This build cannot listen for the wake phrase without a speech service.');
      return;
    }
    this.localRunning = true;
    try { this.recognition?.abort(); } catch (_) {}
    this.recognition = null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.localRunning = false;
      this.running = false;
      this.onError?.(err?.name === 'NotAllowedError'
        ? 'Microphone permission is needed for the wake phrase.'
        : 'The microphone could not be opened for the wake phrase.');
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioCtx();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);

    let capturing = false;
    const listen = () => {
      if (!this.running || !this.localRunning) return;
      analyser.getByteFrequencyData(buffer);
      const level = buffer.reduce((a, b) => a + b, 0) / buffer.length;
      // Above the noise floor of a normal room. Speech sits well above this;
      // a fan or a fridge does not.
      if (level > 18 && !capturing) {
        capturing = true;
        this._captureClip().finally(() => { capturing = false; });
      }
      this.levelTimer = window.setTimeout(listen, 200);
    };
    listen();
  }

  /** Record a short clip and ask this app's own transcription about it. */
  async _captureClip() {
    if (!this.stream) return;
    return new Promise((resolve) => {
      let recorder;
      try {
        recorder = new MediaRecorder(this.stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm',
        });
      } catch (_) { resolve(); return; }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (blob.size < 1200) { resolve(); return; }
        try {
          const form = new FormData();
          form.append('file', blob, 'wake.webm');
          form.append('language', 'auto');
          const res = await fetch(`${this.apiBase}/api/voice/transcribe`, {
            method: 'POST', credentials: 'include', body: form,
          });
          const heard = res.ok ? ((await res.json())?.text || '') : '';
          if (heard && this.matches(heard)) {
            playWakeChime();
            this.onWake?.(heard.trim());
          }
        } catch (_) { /* a missed wake is not worth reporting */ }
        resolve();
      };

      recorder.start();
      // Long enough for "hey smaran", short enough not to lag behind.
      window.setTimeout(() => { try { recorder.stop(); } catch (_) { resolve(); } }, 2200);
    });
  }

  start() {
    if (this.running) return false;
    this.running = true;
    this.retryCount = 0;
    if (WakeWordListener.isSupported()) {
      this._startInstance();
    } else {
      // No Web Speech at all - go straight to the local path rather than
      // refusing, which is what start() used to do.
      this._startLocal();
    }
    return true;
  }

  stop() {
    this.running = false;
    this.localRunning = false;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.levelTimer) {
      window.clearTimeout(this.levelTimer);
      this.levelTimer = null;
    }
    if (this.recognition) {
      try { this.recognition.abort(); } catch (_) {}
      this.recognition = null;
    }
    // Release the microphone. Leaving the tracks live keeps the recording
    // indicator on and holds the device against everything else.
    if (this.stream) {
      this.stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
      this.stream = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
  }
}

export const WAKE_PHRASE_DEFAULT = DEFAULT_PHRASE;
