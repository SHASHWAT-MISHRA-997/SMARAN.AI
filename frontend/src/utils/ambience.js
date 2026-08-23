/**
 * Futuristic background score for the voice workspace.
 *
 * Synthesised in the browser rather than streamed from a file: nothing to
 * ship, nothing to download, and no audible loop point. Each character gets
 * its own key, chord and texture so the room sounds different depending on
 * who is on screen.
 *
 * Signal chain, which is what makes it sound like a place rather than a test
 * tone:
 *
 *   detuned oscillator stack  (3 voices per note, ±cents)
 *        -> lowpass filter with a slow LFO on the cutoff
 *        -> chorus (two LFO-modulated delay lines, hard-panned)
 *        -> feedback delay  (a rhythmless echo tail)
 *        -> convolution reverb  (long, noise-generated impulse)
 *        -> master gain
 *
 * A dry bed with no reverb is what made the first attempt sound flat, so the
 * reverb is generous and mostly wet. Over the top, a slow generative melody
 * picks notes from the character's scale, and the whole chord quietly changes
 * every half minute or so, which is what keeps it from getting boring.
 */

const SEMITONE = 2 ** (1 / 12);
/** MIDI note number to Hz. */
const hz = (midi) => 440 * SEMITONE ** (midi - 69);

const PROFILES = {
  // Warm and hopeful. A soft major-9 pad, high shimmering bells.
  myra: {
    label: 'Aurora',
    gain: 0.22,
    // Chord progression in MIDI notes; the pad drifts between these.
    chords: [
      [45, 52, 57, 64, 71], // A2  E3  A3  E4  B4
      [43, 50, 55, 62, 69], // G2  D3  G3  D4  A4
      [41, 48, 53, 60, 67], // F2  C3  F3  C4  G4
      [40, 47, 52, 59, 66], // E2  B2  E3  B3  F#4
    ],
    wave: 'sawtooth',
    detune: 7,
    filter: { freq: 620, q: 1.1, lfoDepth: 380, lfoRate: 0.035 },
    reverb: { seconds: 6.5, decay: 2.6, wet: 0.85 },
    chorus: { depth: 0.0042, rate: 0.22 },
    delay: { time: 0.62, feedback: 0.38, mix: 0.3 },
    air: { gain: 0.02, freq: 5200, q: 0.7 },
    // Slow melody voice above the pad.
    melody: { scale: [64, 66, 69, 71, 76, 78, 81], every: [5.5, 11], gain: 0.075, decay: 5.5, wave: 'triangle' },
  },

  // Composed and cinematic. Minor, wide, lower — an elegant hall.
  myraa: {
    label: 'Nocturne',
    gain: 0.23,
    chords: [
      [38, 45, 50, 57, 65], // D2  A2  D3  A3  F4
      [36, 43, 48, 55, 63], // C2  G2  C3  G3  D#4
      [34, 41, 46, 53, 60], // A#1 F2  A#2 F3  C4
      [33, 40, 45, 52, 60], // A1  E2  A2  E3  C4
    ],
    wave: 'sawtooth',
    detune: 9,
    filter: { freq: 480, q: 1.4, lfoDepth: 300, lfoRate: 0.024 },
    reverb: { seconds: 8.5, decay: 2.2, wet: 0.9 },
    chorus: { depth: 0.0055, rate: 0.16 },
    delay: { time: 0.86, feedback: 0.42, mix: 0.34 },
    air: { gain: 0.016, freq: 4200, q: 0.8 },
    melody: { scale: [60, 62, 63, 65, 67, 70, 72], every: [7, 15], gain: 0.07, decay: 7, wave: 'sine' },
  },

  // The energy core. Machine-like: a resonant reactor hum with cold pings.
  core: {
    label: 'Reactor',
    gain: 0.2,
    chords: [
      [29, 36, 41, 48, 55], // F1  C2  F2  C3  G3
      [29, 36, 43, 48, 55],
      [27, 34, 39, 46, 53],
      [31, 38, 43, 50, 57],
    ],
    wave: 'sawtooth',
    detune: 12,
    filter: { freq: 340, q: 4.5, lfoDepth: 500, lfoRate: 0.06 },
    reverb: { seconds: 7.5, decay: 1.7, wet: 0.8 },
    chorus: { depth: 0.003, rate: 0.31 },
    delay: { time: 0.44, feedback: 0.52, mix: 0.4 },
    air: { gain: 0.03, freq: 7200, q: 1.6 },
    melody: { scale: [72, 75, 77, 79, 84, 87], every: [4, 9], gain: 0.06, decay: 3.2, wave: 'sine' },
  },
};

const randomBetween = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[Math.floor(Math.random() * items.length)];

/**
 * Reverb impulse: exponentially decaying stereo noise.
 *
 * This is the cheap algorithmic route rather than shipping an impulse-response
 * file, and for a long ambient tail it is indistinguishable.
 */
const buildImpulse = (context, seconds, decay) => {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const progress = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - progress) ** decay;
    }
  }
  return impulse;
};

/** Looping pink noise: the "air" that stops the pad sounding synthetic. */
const buildNoise = (context) => {
  const length = context.sampleRate * 4;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
  }
  return buffer;
};

export const AMBIENCE_PROFILES = Object.keys(PROFILES);
export const ambienceLabel = (name) => (PROFILES[name] || PROFILES.myra).label;

export class Ambience {
  constructor() {
    this.context = null;
    this.master = null;
    this.padBus = null;
    this.wetBus = null;
    this.voices = [];
    this.nodes = [];
    this.timers = [];
    this.profile = null;
    this.profileName = null;
    this.baseGain = 0;
    this.muted = false;
    this.chordIndex = 0;
  }

  static isSupported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  async start(profileName = 'myra') {
    if (!Ambience.isSupported()) return false;
    if (this.profileName === profileName && this.context) return true;

    this.stop();
    const profile = PROFILES[profileName] || PROFILES.myra;
    this.profile = profile;
    this.profileName = profileName;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    this.context = context;
    this._armResume(context);

    const master = context.createGain();
    this.baseGain = profile.gain;
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;

    // ── Reverb, fed by everything ──
    const reverb = context.createConvolver();
    reverb.buffer = buildImpulse(context, profile.reverb.seconds, profile.reverb.decay);
    const wet = context.createGain();
    wet.gain.value = profile.reverb.wet;
    reverb.connect(wet).connect(master);
    this.wetBus = reverb;

    const dry = context.createGain();
    dry.gain.value = 1 - profile.reverb.wet * 0.6;
    dry.connect(master);

    // ── Feedback delay, before the reverb ──
    const delay = context.createDelay(2);
    delay.delayTime.value = profile.delay.time;
    const feedback = context.createGain();
    feedback.gain.value = profile.delay.feedback;
    const delayMix = context.createGain();
    delayMix.gain.value = profile.delay.mix;
    delay.connect(feedback).connect(delay);
    delay.connect(delayMix);
    delayMix.connect(reverb);
    delayMix.connect(dry);

    // ── Chorus: two modulated delay lines, panned apart ──
    const chorusIn = context.createGain();
    [-1, 1].forEach((side, index) => {
      const line = context.createDelay(0.05);
      line.delayTime.value = 0.018 + index * 0.009;
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      lfo.frequency.value = profile.chorus.rate * (index ? 1.31 : 1);
      lfoGain.gain.value = profile.chorus.depth;
      lfo.connect(lfoGain).connect(line.delayTime);
      lfo.start();
      const panner = context.createStereoPanner();
      panner.pan.value = side * 0.7;
      chorusIn.connect(line).connect(panner);
      panner.connect(reverb);
      panner.connect(dry);
      panner.connect(delay);
      this.nodes.push(lfo);
    });

    // ── Pad filter with a slow sweep ──
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.filter.freq;
    filter.Q.value = profile.filter.q;
    filter.connect(chorusIn);

    const sweep = context.createOscillator();
    const sweepDepth = context.createGain();
    sweep.frequency.value = profile.filter.lfoRate;
    sweepDepth.gain.value = profile.filter.lfoDepth;
    sweep.connect(sweepDepth).connect(filter.frequency);
    sweep.start();
    this.nodes.push(sweep);

    const padBus = context.createGain();
    padBus.gain.value = 1;
    padBus.connect(filter);
    this.padBus = padBus;

    // ── Air ──
    const noise = context.createBufferSource();
    noise.buffer = buildNoise(context);
    noise.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = profile.air.freq;
    airFilter.Q.value = profile.air.q;
    const airGain = context.createGain();
    airGain.gain.value = profile.air.gain;
    noise.connect(airFilter).connect(airGain);
    airGain.connect(reverb);
    airGain.connect(master);
    noise.start();
    this.nodes.push(noise);

    this._playChord(profile.chords[0]);
    this._scheduleChordChange();
    this._scheduleMelody();

    master.gain.setTargetAtTime(this.baseGain, context.currentTime, 2.2);
    return true;
  }

  /** Resume now if allowed, otherwise on the next click or key press. */
  _armResume(context) {
    const tryResume = () => {
      if (!this.context || this.context.state !== 'suspended') return;
      this.context.resume().catch(() => { /* still needs a gesture */ });
    };
    tryResume();
    if (context.state !== 'suspended') return;

    const onGesture = () => {
      tryResume();
      if (!this.context || this.context.state === 'running') this._gestureCleanup?.();
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    this._gestureCleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      this._gestureCleanup = null;
    };
  }

  /** Cross-fade the pad onto a new chord. */
  _playChord(notes) {
    const context = this.context;
    if (!context || !this.padBus) return;
    const now = context.currentTime;
    const fade = 6;

    // Retire the voices currently sounding.
    this.voices.forEach(({ gain, oscillators }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, fade / 3);
      oscillators.forEach((oscillator) => {
        try { oscillator.stop(now + fade + 1); } catch { /* already stopped */ }
      });
    });
    this.voices = [];

    const profile = this.profile;
    notes.forEach((midi, index) => {
      const gain = context.createGain();
      // Lower notes carry the weight; upper notes stay quiet so the chord is
      // not a wall of equal-loudness tones.
      const level = (index === 0 ? 0.42 : 0.3 / (index + 1)) ;
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(level, now, fade / 3);
      gain.connect(this.padBus);

      const oscillators = [];
      // Three slightly detuned voices per note: this is what gives a pad its
      // width. A single oscillator per note sounds like a test tone.
      [-1, 0, 1].forEach((offset) => {
        const oscillator = context.createOscillator();
        oscillator.type = profile.wave;
        oscillator.frequency.value = hz(midi);
        oscillator.detune.value = offset * profile.detune;
        oscillator.connect(gain);
        oscillator.start(now + Math.random() * 0.05);
        oscillators.push(oscillator);
      });
      this.voices.push({ gain, oscillators });
    });
  }

  _scheduleChordChange() {
    const run = () => {
      if (!this.context || !this.profile) return;
      this.chordIndex = (this.chordIndex + 1) % this.profile.chords.length;
      this._playChord(this.profile.chords[this.chordIndex]);
      this.timers.push(window.setTimeout(run, randomBetween(24, 40) * 1000));
    };
    this.timers.push(window.setTimeout(run, randomBetween(24, 40) * 1000));
  }

  /** A single slow note above the pad, every so often. */
  _scheduleMelody() {
    const profile = this.profile;
    if (!profile?.melody) return;
    const [minDelay, maxDelay] = profile.melody.every;

    const run = () => {
      const context = this.context;
      if (!context || !this.master || !this.wetBus) return;
      const now = context.currentTime;
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = profile.melody.wave;
      oscillator.frequency.value = hz(pick(profile.melody.scale));
      oscillator.detune.value = randomBetween(-8, 8);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(profile.melody.gain, now + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.melody.decay);
      oscillator.connect(gain);
      // Melody notes go almost entirely to the reverb, so they bloom and fade
      // rather than sitting on top of the mix.
      gain.connect(this.wetBus);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + profile.melody.decay + 0.2);

      this.timers.push(window.setTimeout(run, randomBetween(minDelay, maxDelay) * 1000));
    };
    this.timers.push(window.setTimeout(run, randomBetween(2, 6) * 1000));
  }

  /** Pull the score down while the assistant speaks. */
  duck(active) {
    if (!this.context || !this.master || this.muted) return;
    const target = active ? this.baseGain * 0.3 : this.baseGain;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, active ? 0.15 : 0.8);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : this.baseGain, this.context.currentTime, 0.4);
  }

  stop() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
    this._gestureCleanup?.();

    this.voices.forEach(({ oscillators }) => oscillators.forEach((oscillator) => {
      try { oscillator.stop(); } catch { /* already stopped */ }
    }));
    this.voices = [];

    this.nodes.forEach((node) => {
      try { node.stop(); } catch { /* not a source */ }
      try { node.disconnect(); } catch { /* already detached */ }
    });
    this.nodes = [];

    if (this.context) {
      try { this.context.close(); } catch { /* already closed */ }
    }
    this.context = null;
    this.master = null;
    this.padBus = null;
    this.wetBus = null;
    this.profile = null;
    this.profileName = null;
  }
}
