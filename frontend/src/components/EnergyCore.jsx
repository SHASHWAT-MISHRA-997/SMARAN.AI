import { useEffect, useRef } from 'react';

/**
 * SMARAN.AI — Energy Core.
 *
 * A procedural cyber-intelligence: plasma core, orbital rings, a neural
 * network that routes, data streams that converge while it thinks, terminal
 * activity, and a glitch layer that fires rarely. Everything is drawn from
 * code, so there is no asset to load and nothing pre-rendered — which also
 * means it reacts to state instead of playing a clip that happens to match.
 *
 * The layers are deliberately not all on at once. Idle is quiet: breathing
 * core, drifting particles, a slow ring. Thinking brings the network and the
 * streams. Speaking drives the core from the voice. Everything at full is
 * noise, and noise reads as decoration rather than as a system doing work.
 *
 * The one honest limitation worth stating: the voice split below is derived
 * from an amplitude number, not an FFT. Real bands would need the analyser
 * node, and inventing three from one would be three views of the same number
 * dressed up as frequency content.
 */

const STATE_TINT = {
  idle:      [0, 229, 255],
  listening: [0, 255, 200],
  thinking:  [120, 160, 255],
  speaking:  [0, 229, 255],
  error:     [255, 176, 32],
  critical:  [220, 38, 38],
  success:   [57, 255, 120],
};

const BOOT_LINES = [
  '> INITIALIZING SMARAN.AI',
  '> loading neural architecture...',
  '> mounting memory core...',
  '> establishing encrypted channel...',
  '> initializing voice engine...',
  'ENERGY CORE: ONLINE',
];

const TERMINAL_LINES = [
  'SYSTEM_CORE::INITIALIZE',
  'neural_router.active = true',
  'await analyze_stream()',
  'memory.sync()',
  'NETWORK_STATUS: SECURE',
  'VOICE_CORE: ONLINE',
  'MODEL_ROUTER: READY',
  '> analyzing input stream...',
  '> secure channel established',
  '> neural interface ready',
];

const EnergyCore = ({ voiceState = 'idle', micVolume = 0, booted = false }) => {
  const canvasRef = useRef(null);
  const stateRef = useRef(voiceState);
  const volumeRef = useRef(micVolume);
  const bootRef = useRef(booted ? 1 : 0);

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { volumeRef.current = micVolume; }, [micVolume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf;
    let t = 0;
    let smoothVolume = 0;
    let glitchUntil = 0;
    let lastState = 'idle';

    // ---------------------------------------------------------- systems

    // 1. Ambient particles. Slow, sparse, always present, so the frame is
    //    never completely still even at rest.
    const ambient = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00018,
      vy: (Math.random() - 0.5) * 0.00018,
      r: 0.4 + Math.random() * 1.1,
      a: 0.15 + Math.random() * 0.35,
    }));

    // 2. Neural network. Nodes with a few nearest links; a route lights up
    //    and travels while it is thinking.
    const NODES = 34;
    const nodes = Array.from({ length: NODES }, (_, i) => {
      const angle = (i / NODES) * Math.PI * 2 + Math.random() * 0.4;
      const spread = 0.24 + Math.random() * 0.2;
      return {
        bx: Math.cos(angle) * spread,
        by: Math.sin(angle) * spread * 0.62,
        drift: Math.random() * Math.PI * 2,
        charge: 0,
      };
    });
    const links = [];
    for (let i = 0; i < NODES; i += 1) {
      for (let j = i + 1; j < NODES; j += 1) {
        const d = Math.hypot(nodes[i].bx - nodes[j].bx, nodes[i].by - nodes[j].by);
        if (d < 0.17) links.push({ a: i, b: j, pulse: -1 });
      }
    }

    // 3. Data streams: points that run inward and are consumed by the core.
    const streams = [];

    // 4. Terminal activity, drawn at the edges so it never covers the core.
    const terminal = [];

    const spawnTerminal = () => {
      terminal.push({
        text: TERMINAL_LINES[(Math.random() * TERMINAL_LINES.length) | 0],
        side: Math.random() < 0.5 ? -1 : 1,
        y: 0.12 + Math.random() * 0.76,
        life: 1,
      });
      if (terminal.length > 14) terminal.shift();
    };

    const lerp = (a, b, k) => a + (b - a) * k;
    const tint = { c: [...STATE_TINT.idle] };

    // ----------------------------------------------------------- render

    const render = () => {
      const { width: w, height: h } = canvas;
      const cx = w / 2;
      const cy = h / 2;
      const unit = Math.min(w, h);

      const state = stateRef.current;
      const listening = state === 'listening';
      const thinking = state === 'thinking';
      const speaking = state === 'speaking';
      const failing = state === 'error';

      // A state change is the one moment a glitch is earned.
      if (state !== lastState) {
        glitchUntil = t + 9;
        lastState = state;
        if (thinking || speaking) spawnTerminal();
      }

      // Amplitude, smoothed. Sudden jumps read as flicker rather than speech.
      const raw = Math.min(1, (volumeRef.current || 0) * 1.6);
      smoothVolume = lerp(smoothVolume, speaking || listening ? raw : 0, 0.14);

      // Bands derived from one amplitude with different response curves. Not
      // an FFT, and not presented as one.
      const low = smoothVolume;
      const mid = Math.pow(smoothVolume, 0.7);
      const high = Math.pow(smoothVolume, 1.9);

      const target = STATE_TINT[state] || STATE_TINT.idle;
      tint.c = tint.c.map((v, i) => lerp(v, target[i], 0.06));
      const [R, G, B] = tint.c.map((v) => Math.round(v));
      const rgba = (a) => `rgba(${R},${G},${B},${a})`;

      const boot = bootRef.current;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // --- layer 1: ambient particles ---------------------------------
      ambient.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r * (1 + high * 1.6), 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.a * (0.4 + boot * 0.6));
        ctx.fill();
      });

      // --- layer 2: neural network ------------------------------------
      // Only while there is something to think about. A network that is
      // always firing says nothing about what the assistant is doing.
      const netAlpha = thinking ? 1 : listening ? 0.45 : 0.18;
      if (boot > 0.35) {
        nodes.forEach((n, i) => {
          n.drift += 0.004;
          n.charge *= 0.94;
          if (thinking && Math.random() < 0.02) n.charge = 1;
          const x = cx + (n.bx + Math.sin(n.drift) * 0.012) * unit;
          const y = cy + (n.by + Math.cos(n.drift * 0.8) * 0.012) * unit;
          n.sx = x; n.sy = y;
          const size = 1.1 + n.charge * 2.4;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = rgba((0.25 + n.charge * 0.6) * netAlpha * boot);
          ctx.fill();
        });

        links.forEach((l) => {
          const a = nodes[l.a];
          const b = nodes[l.b];
          if (a.sx === undefined) return;
          if (thinking && l.pulse < 0 && Math.random() < 0.004) l.pulse = 0;
          if (l.pulse >= 0) l.pulse += 0.045;
          if (l.pulse > 1) l.pulse = -1;

          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = rgba(0.07 * netAlpha * boot);
          ctx.lineWidth = 0.6;
          ctx.stroke();

          if (l.pulse >= 0) {
            const px = lerp(a.sx, b.sx, l.pulse);
            const py = lerp(a.sy, b.sy, l.pulse);
            ctx.beginPath();
            ctx.arc(px, py, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = rgba(0.85);
            ctx.fill();
          }
        });
      }

      // --- layer 3: data streams --------------------------------------
      if (thinking && Math.random() < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        streams.push({ angle, d: 0.46, speed: 0.006 + Math.random() * 0.008 });
      }
      for (let i = streams.length - 1; i >= 0; i -= 1) {
        const s = streams[i];
        s.d -= s.speed;
        if (s.d <= 0.05) { streams.splice(i, 1); continue; }
        const x = cx + Math.cos(s.angle) * s.d * unit;
        const y = cy + Math.sin(s.angle) * s.d * unit * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = rgba(0.7);
        ctx.fill();
      }

      // --- layer 4: orbital rings -------------------------------------
      // Rotation carries the state: idle turns slowly, thinking spins up.
      const spin = thinking ? 0.028 : speaking ? 0.014 : 0.006;
      const ringCount = thinking ? 5 : 3;
      for (let i = 0; i < ringCount; i += 1) {
        const k = i / ringCount;
        const radius = unit * (0.13 + k * 0.13) * (1 + mid * 0.12) * boot;
        const tilt = Math.sin(t * spin + i) * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * spin * (i % 2 ? -1 : 1) + i);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * (0.28 + Math.abs(tilt) * 0.5), 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(0.3 - k * 0.16 + mid * 0.2);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      }

      // --- layer 5: the core ------------------------------------------
      // Breathing at rest, driven by the voice while speaking.
      const breathe = 1 + Math.sin(t * 0.03) * 0.05;
      const coreR = unit * 0.055 * breathe * (1 + low * 0.5) * boot;

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 6);
      glow.addColorStop(0, rgba(0.85));
      glow.addColorStop(0.25, rgba(0.22 + low * 0.25));
      glow.addColorStop(1, rgba(0));
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 6, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.75 + low * 0.25})`;
      ctx.fill();

      // Micro-arcs: brief, and only when there is energy to justify them.
      if ((speaking && Math.random() < 0.3) || (thinking && Math.random() < 0.2)) {
        const a0 = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a0) * coreR, cy + Math.sin(a0) * coreR);
        for (let s = 0; s < 3; s += 1) {
          const aa = a0 + (Math.random() - 0.5) * 1.2;
          const rr = coreR * (1.4 + s * 0.5);
          ctx.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
        }
        ctx.strokeStyle = rgba(0.5);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // --- layer 6: scanning plane ------------------------------------
      if (thinking || boot < 1) {
        const sweep = ((t * 0.006) % 1);
        const y = h * sweep;
        const grad = ctx.createLinearGradient(0, y - 14, 0, y + 14);
        grad.addColorStop(0, rgba(0));
        grad.addColorStop(0.5, rgba(0.16));
        grad.addColorStop(1, rgba(0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 14, w, 28);
      }

      // --- layer 7: terminal activity ---------------------------------
      ctx.globalCompositeOperation = 'source-over';
      if (boot < 1) {
        // Boot text, centred, one line at a time.
        const shown = Math.min(BOOT_LINES.length, Math.floor(boot * BOOT_LINES.length * 1.25));
        ctx.font = `${Math.max(10, unit * 0.022)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        for (let i = 0; i < shown; i += 1) {
          ctx.fillStyle = rgba(0.35 + (i === shown - 1 ? 0.5 : 0));
          ctx.fillText(BOOT_LINES[i], cx, cy + unit * 0.24 + i * unit * 0.03);
        }
      } else {
        if ((thinking || speaking) && Math.random() < 0.04) spawnTerminal();
        ctx.font = `${Math.max(9, unit * 0.018)}px ui-monospace, monospace`;
        for (let i = terminal.length - 1; i >= 0; i -= 1) {
          const line = terminal[i];
          line.life -= 0.004;
          if (line.life <= 0) { terminal.splice(i, 1); continue; }
          ctx.textAlign = line.side < 0 ? 'left' : 'right';
          const x = line.side < 0 ? w * 0.04 : w * 0.96;
          ctx.fillStyle = rgba(0.28 * line.life);
          ctx.fillText(line.text, x, line.y * h);
        }
      }

      // --- layer 8: glitch --------------------------------------------
      // A frame or two after a state change, and on error. Constant glitching
      // reads as a broken screen, not as a system under load.
      if (t < glitchUntil || (failing && Math.random() < 0.03)) {
        const band = 6 + Math.random() * 22;
        const y = Math.random() * h;
        const shift = (Math.random() - 0.5) * 18;
        try {
          const slice = ctx.getImageData(0, y, w, band);
          ctx.putImageData(slice, shift, y);
        } catch (_) { /* tainted canvas: skip rather than fail the frame */ }
      }

      t += 1;
      if (bootRef.current < 1) bootRef.current = Math.min(1, bootRef.current + 0.006);
      raf = requestAnimationFrame(render);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      aria-label="SMARAN.AI energy core"
    />
  );
};

export default EnergyCore;
