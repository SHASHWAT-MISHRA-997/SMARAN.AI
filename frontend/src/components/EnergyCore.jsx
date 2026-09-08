import { useEffect, useRef } from 'react';
import { analyseTone, normalizeLevel } from '../utils/coreSignal';
import { STATE_TINT, coreStateLabel } from '../utils/coreStates';

/**
 * SMARAN.AI — Energy Core.
 *
 * A reactor drawn in code: a plasma nucleus inside orbital rings that are
 * genuinely three-dimensional, with dust at three depths, electric arcs, and a
 * spectrum ring built from the assistant's own voice. Nothing is pre-rendered,
 * so it reacts to state rather than playing a clip that happens to match.
 *
 * Three things it deliberately does not do.
 *
 * It does not claim a system state it has not been told about. The previous
 * version printed "secure channel established" and "NETWORK_STATUS: SECURE"
 * beside the core. Nothing checked a channel or a network - the lines were
 * picked from an array at random. Text that asserts a security property the
 * component cannot observe is a lie with a monospace font on it, so it is gone
 * rather than reworded.
 *
 * It does not show the microphone while the assistant is talking. Speaking is
 * driven by an analyser on the assistant's own output when one is available;
 * when it is not, the core breathes on an internal envelope. Feeding the
 * user's microphone level into "speaking" made the core react to the room
 * instead of to the voice.
 *
 * It does not present invented frequency content. The spectrum ring appears
 * only when there is a real AnalyserNode behind it. With an amplitude number
 * alone the core still moves, but the bars stay away, because three curves
 * derived from one number are one number wearing a costume.
 */

// The tints live in ../utils/coreStates alongside the labels, so that a state
// added in one place cannot be missing from the other - which is how `offline`
// came to draw a healthy cyan core.

// Rotate a point about X then Y, and project it. A real projection is what
// makes a ring read as a ring seen at an angle rather than as a flat ellipse:
// the near half is larger and brighter than the far half.
const FOCAL = 2.6;
function project(x, y, z, tiltX, spinY) {
  const cy = Math.cos(spinY);
  const sy = Math.sin(spinY);
  const x1 = x * cy + z * sy;
  const z1 = z * cy - x * sy;
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const y1 = y * cx - z1 * sx;
  const z2 = z1 * cx + y * sx;
  const scale = FOCAL / (FOCAL + z2);
  return { x: x1 * scale, y: y1 * scale, depth: z2, scale };
}

const EnergyCore = ({
  voiceState = 'idle',
  micVolume = 0,
  speechSource = null,
  speechContext = null,
  toneText = '',
}) => {
  const canvasRef = useRef(null);
  const stateRef = useRef(voiceState);
  const volumeRef = useRef(micVolume);
  const toneRef = useRef({ hue: 0, energy: 0, label: 'neutral' });
  const analyserRef = useRef(null);
  const specRef = useRef(null);

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { volumeRef.current = micVolume; }, [micVolume]);
  useEffect(() => { toneRef.current = analyseTone(toneText); }, [toneText]);

  // The assistant's own voice, when the live session exposes it. Same shape as
  // the avatar's listener, so both read the identical signal.
  useEffect(() => {
    if (!speechSource || !speechContext) return undefined;
    let analyser;
    try {
      analyser = speechContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      speechSource.connect(analyser);
    } catch {
      return undefined;    // a closed or foreign context is not worth a crash
    }
    analyserRef.current = analyser;
    specRef.current = new Uint8Array(analyser.frequencyBinCount);
    return () => {
      try { speechSource.disconnect(analyser); } catch { /* already gone */ }
      analyserRef.current = null;
      specRef.current = null;
    };
  }, [speechSource, speechContext]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    // Coarse pointers are phones and tablets. They get fewer pixels and fewer
    // particles, because a core that drops frames looks worse than a simpler
    // one that does not.
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;

    let raf = 0;
    let disposed = false;
    let width = 0;
    let height = 0;
    let unit = 0;

    let time = 0;             // seconds, not frames
    let last = performance.now();
    let level = 0;            // smoothed drive, 0..1
    let ringPhase = 0;
    let spinPhase = 0;
    let flash = 0;            // brief lift on a state change
    let lastState = voiceState;
    let hue = 0;              // smoothed tone nudge
    const tint = [...(STATE_TINT[voiceState] || STATE_TINT.idle)];

    // ---------------------------------------------------------------- dust
    // Three depth bands. The far band barely moves, the near band drifts
    // noticeably, and that difference alone reads as space.
    let dust = [];
    const buildDust = () => {
      const area = (width * height) / (1080 * 720);
      const count = Math.round((coarse ? 70 : 130) * Math.max(0.35, Math.min(1.6, area)));
      dust = Array.from({ length: count }, () => {
        const band = Math.random();
        const depth = band < 0.5 ? 0.25 : band < 0.82 ? 0.6 : 1;
        return {
          x: Math.random(),
          y: Math.random(),
          depth,
          r: 0.35 + depth * 1.35,
          a: 0.08 + depth * 0.3,
          drift: (Math.random() - 0.5) * 0.012 * depth,
          rise: (Math.random() - 0.5) * 0.012 * depth,
          twinkle: Math.random() * Math.PI * 2,
        };
      });
    };

    // ---------------------------------------------------------------- arcs
    // Branching bolts, spawned by energy rather than on a timer, so a silent
    // core is a calm core.
    const arcs = [];
    const spawnArc = (reach, spread) => {
      const a0 = Math.random() * Math.PI * 2;
      const points = [];
      const steps = 5 + ((Math.random() * 3) | 0);
      let angle = a0;
      let radius = 0.055;
      for (let i = 0; i <= steps; i += 1) {
        angle += (Math.random() - 0.5) * spread;
        radius += reach / steps;
        points.push({ angle, radius });
      }
      arcs.push({ points, life: 1, decay: 3.4 + Math.random() * 2.6, width: 0.7 + Math.random() * 1.2 });
      if (arcs.length > 14) arcs.shift();
    };

    // ------------------------------------------------------------- helpers
    const lerp = (a, b, k) => a + (b - a) * k;
    // Frame-rate independent approach: the same k means the same speed at
    // 60 Hz and at 120 Hz. The old code lerped by a constant per frame, so a
    // 120 Hz screen animated everything at double speed.
    const approach = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

    const shiftHue = ([r, g, b], degrees) => {
      if (!degrees) return [r, g, b];
      // Small rotation in a cheap YIQ-style space: enough for a tint nudge,
      // and far cheaper per frame than a full HSL round trip.
      const rad = (degrees * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const m0 = 0.299 + 0.701 * cosA + 0.168 * sinA;
      const m1 = 0.587 - 0.587 * cosA + 0.330 * sinA;
      const m2 = 0.114 - 0.114 * cosA - 0.497 * sinA;
      const m3 = 0.299 - 0.299 * cosA - 0.328 * sinA;
      const m4 = 0.587 + 0.413 * cosA + 0.035 * sinA;
      const m5 = 0.114 - 0.114 * cosA + 0.292 * sinA;
      const m6 = 0.299 - 0.3 * cosA + 1.25 * sinA;
      const m7 = 0.587 - 0.588 * cosA - 1.05 * sinA;
      const m8 = 0.114 + 0.886 * cosA - 0.203 * sinA;
      return [
        Math.max(0, Math.min(255, r * m0 + g * m1 + b * m2)),
        Math.max(0, Math.min(255, r * m3 + g * m4 + b * m5)),
        Math.max(0, Math.min(255, r * m6 + g * m7 + b * m8)),
      ];
    };

    // Real playback amplitude, or null when there is no analyser to ask.
    const readVoice = () => {
      const analyser = analyserRef.current;
      const bins = specRef.current;
      if (!analyser || !bins) return null;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i += 1) sum += bins[i];
      return { amplitude: Math.min(1, sum / bins.length / 140), bins };
    };

    // ------------------------------------------------------------- drawing
    const drawFrame = (dt) => {
      const cx = width / 2;
      const cy = height / 2;
      const state = stateRef.current;
      const listening = state === 'listening' || state === 'capturing';
      const thinking = state === 'thinking' || state === 'uploading';
      const speaking = state === 'speaking';
      const failing = state === 'error' || state === 'critical' || state === 'permission';

      if (state !== lastState) { flash = 1; lastState = state; }
      flash = Math.max(0, flash - dt * 2.4);

      // Drive. Listening is the microphone, which is the honest source while
      // the user is the one talking. Speaking is the assistant's own output
      // when an analyser exists, and an internal envelope when it does not.
      const voice = speaking ? readVoice() : null;
      let target = 0;
      if (listening) target = normalizeLevel(volumeRef.current);
      else if (speaking) {
        target = voice ? voice.amplitude
          : 0.42 + Math.sin(time * 7.3) * 0.16 + Math.sin(time * 11.7) * 0.1;
      } else if (thinking) target = 0.24 + Math.sin(time * 2.1) * 0.08;
      level = approach(level, Math.max(0, Math.min(1, target)), 9, dt);

      const tone = toneRef.current;
      hue = approach(hue, tone.hue, 2.2, dt);
      const base = STATE_TINT[state] || STATE_TINT.idle;
      for (let i = 0; i < 3; i += 1) tint[i] = approach(tint[i], base[i], 3.2, dt);
      const [R, G, B] = shiftHue(tint, hue).map((v) => Math.round(v));
      const rgba = (a) => `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;

      const energy = Math.max(0, Math.min(1.25,
        level + flash * 0.35 + tone.energy * 0.5 + (thinking ? 0.18 : 0)));

      ctx.clearRect(0, 0, width, height);

      // --- haze -------------------------------------------------------
      // Drawn normally so it can darken the corners; every layer after it is
      // additive, which is what makes the core feel like it emits light.
      const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 0.72);
      haze.addColorStop(0, rgba(0.1 + energy * 0.09));
      haze.addColorStop(0.55, rgba(0.03));
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';

      // --- dust -------------------------------------------------------
      // Listening pulls it inward: the core is receiving, and the motion says
      // so without a caption.
      const pull = listening ? 0.16 : 0;
      for (let i = 0; i < dust.length; i += 1) {
        const p = dust[i];
        p.x += p.drift * dt;
        p.y += p.rise * dt;
        if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
        if (p.y < -0.05) p.y = 1.05; else if (p.y > 1.05) p.y = -0.05;
        p.twinkle += dt * (0.6 + p.depth);
        const px = lerp(p.x * width, cx, pull * p.depth);
        const py = lerp(p.y * height, cy, pull * p.depth);
        const shimmer = 0.72 + Math.sin(p.twinkle) * 0.28;
        ctx.beginPath();
        ctx.arc(px, py, p.r * (1 + energy * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.a * shimmer * (0.5 + energy * 0.5));
        ctx.fill();
      }

      // --- orbital rings ---------------------------------------------
      // Each ring is a real circle in 3D. The halves are drawn either side of
      // the nucleus so the near arc crosses in front of it and the far arc
      // passes behind, which is where the depth comes from.
      ringPhase += dt * (thinking ? 1.15 : speaking ? 0.62 : failing ? 0.2 : 0.28);
      spinPhase += dt * (thinking ? 0.85 : 0.34);
      const ringCount = coarse ? 3 : thinking ? 5 : 4;
      const segments = coarse ? 44 : 72;
      const wobble = failing ? 0.3 : 0;

      const drawRingHalf = (near) => {
        for (let i = 0; i < ringCount; i += 1) {
          const k = i / Math.max(1, ringCount - 1);
          const radius = (0.2 + k * 0.19) * (1 + level * 0.1);
          const tiltX = 0.55 + Math.sin(ringPhase * 0.6 + i * 1.7) * (0.42 + wobble);
          const spinY = spinPhase * (i % 2 ? -1 : 1) + i * 0.9;
          ctx.beginPath();
          let started = false;
          for (let s = 0; s <= segments; s += 1) {
            const a = (s / segments) * Math.PI * 2;
            const jitter = failing ? Math.sin(a * 7 + time * 9 + i) * 0.012 : 0;
            const rr = radius + jitter;
            const p = project(Math.cos(a) * rr, Math.sin(a) * rr, 0, tiltX, spinY);
            if ((p.depth <= 0) !== near) { started = false; continue; }
            const x = cx + p.x * unit;
            const y = cy + p.y * unit;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          }
          const bright = near ? 0.5 : 0.16;
          ctx.strokeStyle = rgba((bright - k * 0.06) * (0.55 + energy * 0.6));
          ctx.lineWidth = (near ? 1.5 : 0.9) * (1 + level * 0.5);
          ctx.stroke();
        }
      };

      drawRingHalf(false);

      // --- spectrum ring ----------------------------------------------
      // Only with a real analyser behind it. Bars stand off the nucleus and
      // are the assistant's actual output spectrum, not a derived curve.
      if (voice) {
        const bins = voice.bins;
        const bars = coarse ? 36 : 56;
        const inner = unit * 0.115;
        for (let i = 0; i < bars; i += 1) {
          const bin = bins[Math.floor((i / bars) * bins.length * 0.7)] / 255;
          const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const len = unit * (0.012 + bin * 0.085);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
          ctx.strokeStyle = rgba(0.2 + bin * 0.72);
          ctx.lineWidth = 1.9;
          ctx.stroke();
        }
      }

      // --- nucleus ----------------------------------------------------
      const breathe = 1 + Math.sin(time * 1.6) * 0.045;
      const coreR = unit * 0.058 * breathe * (1 + level * 0.42);

      const corona = ctx.createRadialGradient(cx, cy, coreR * 0.2, cx, cy, coreR * 7);
      corona.addColorStop(0, rgba(0.9));
      corona.addColorStop(0.18, rgba(0.34 + level * 0.3));
      corona.addColorStop(0.55, rgba(0.08 + level * 0.1));
      corona.addColorStop(1, rgba(0));
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 7, 0, Math.PI * 2);
      ctx.fill();

      // Chromatic fringe: three offset copies rather than a pixel readback.
      // The old glitch used getImageData every frame it fired, which stalls
      // the pipeline on a phone for a effect that can be composited instead.
      const fringe = (0.9 + energy * 2.6) * (failing ? 2.4 : 1);
      const shells = [
        [`rgba(255,${G},${B},0.5)`, -fringe],
        [`rgba(${R},${G},255,0.5)`, fringe],
        ['rgba(255,255,255,0.92)', 0],
      ];
      for (const [colour, dx] of shells) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }

      // --- electric arcs ----------------------------------------------
      const arcChance = failing ? 5.5 : speaking ? level * 9 : thinking ? 3.2 : listening ? level * 4 : 0.25;
      if (Math.random() < arcChance * dt) spawnArc(0.14 + Math.random() * 0.16, failing ? 1.4 : 0.8);
      for (let i = arcs.length - 1; i >= 0; i -= 1) {
        const arc = arcs[i];
        arc.life -= dt * arc.decay;
        if (arc.life <= 0) { arcs.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (const point of arc.points) {
          ctx.lineTo(cx + Math.cos(point.angle) * point.radius * unit,
                     cy + Math.sin(point.angle) * point.radius * unit);
        }
        ctx.strokeStyle = rgba(arc.life * 0.85);
        ctx.lineWidth = arc.width * arc.life;
        ctx.stroke();
      }

      drawRingHalf(true);

      ctx.globalCompositeOperation = 'source-over';
    };

    // ------------------------------------------------------------ lifecycle
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      // Bounded resolution: a desktop at 3x on a large stage is millions of
      // pixels of additive blending per frame for no visible gain.
      const cap = coarse ? 1.5 : 2;
      let dpr = Math.min(window.devicePixelRatio || 1, cap);
      const budget = coarse ? 1_300_000 : 2_600_000;
      const pixels = rect.width * rect.height * dpr * dpr;
      if (pixels > budget) dpr *= Math.sqrt(budget / pixels);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (w === width && h === height) return true;
      canvas.width = w;
      canvas.height = h;
      width = w;
      height = h;
      unit = Math.min(w, h);
      buildDust();
      return true;
    };

    const loop = (now) => {
      if (disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt;
      if (width > 0) drawFrame(dt);
      raf = requestAnimationFrame(loop);
    };

    // Reduced motion: one composed frame, redrawn only when the size or the
    // state changes. Still a core, still coloured by state - it simply does
    // not move, which is what the preference asks for.
    let still = null;
    const startStill = () => {
      const paint = () => { if (measure()) drawFrame(0.016); };
      paint();
      still = window.setInterval(paint, 1000);
    };

    const start = () => {
      measure();
      if (reduceQuery?.matches) startStill();
      else { last = performance.now(); raf = requestAnimationFrame(loop); }
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (still) { window.clearInterval(still); still = null; }
    };

    const onMotionChange = () => { stop(); start(); };
    reduceQuery?.addEventListener?.('change', onMotionChange);

    // Nothing is drawn while the page is not being looked at. Browsers throttle
    // requestAnimationFrame for a hidden document, but throttled is not
    // stopped, and on a phone this loop is the most expensive thing on the
    // screen: a call left open in the background should cost nothing at all.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!raf && !still) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { measure(); })
      : null;
    observer?.observe(canvas);
    if (!observer) window.addEventListener('resize', measure);

    start();

    return () => {
      disposed = true;
      stop();
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      reduceQuery?.removeEventListener?.('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      // Also in a style, and not only in the utility classes. A canvas with no
      // CSS size falls back to its width/height attributes, and this component
      // sets those from the measured CSS size - so the two chase each other and
      // the element grows every frame. It happened the moment the core was
      // mounted on a page that had not loaded the utility stylesheet. display
      // block additionally removes the inline-layout descender gap.
      style={{ display: 'block', width: '100%', height: '100%' }}
      role="img"
      // What it is showing, not merely that it exists. The core is the only
      // indication of several of these conditions on the call screen, and
      // "energy core visualisation" told a screen reader none of them.
      aria-label={`SMARAN.AI energy core. ${coreStateLabel(voiceState)}.`}
    />
  );
};

export default EnergyCore;
