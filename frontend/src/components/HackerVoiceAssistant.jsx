import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  Sparkles,
  Zap,
  Globe,
  Radio,
  Bot,
  User,
  Send,
  Square,
  RefreshCw,
  Cpu,
  Shield,
  Activity,
  Maximize2,
  Terminal,
  Upload,
  FolderPlus,
  BookOpen,
  Brain,
  Trash2,
  UserRound,
  Monitor,
  Camera,
  Hand,
  Phone as PhoneIcon,
  Music2,
} from 'lucide-react';
import { LiveVoiceSession } from '../utils/liveVoice';
import { Ambience } from '../utils/ambience';
import EnergyCore from './EnergyCore';
import GestureHUD from './GestureHUD';
import CyberFX from './CyberFX';
import { GESTURES } from '../utils/gestureControl';
import AvatarVideo, { AVATAR_CHARACTERS } from './AvatarVideo';
import AvatarMMD, { MMD_CHARACTERS } from './AvatarMMD';

/* Prebuilt Gemini Live voices, grouped so a user can simply pick male or
   female. The service decides the exact timbre; these are its own voices. */
/**
 * One round control in the call bar.
 *
 * Circular with the label underneath, the way a phone shows mute and
 * speaker: the shape carries the meaning, so seven of them read as a set
 * rather than as seven competing buttons.
 */
const CallToggle = ({ icon: Icon, label, active = false, disabled = false, danger = false, muted = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    className="group flex w-[52px] flex-col items-center gap-1.5 disabled:opacity-25 sm:w-[58px]"
  >
    <span
      className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all
        group-active:scale-90 group-hover:shadow-[0_0_18px_rgba(239,68,68,.35)] sm:h-12 sm:w-12 ${
        danger
          ? 'border-rose-400/50 bg-rose-500/20 text-rose-300'
          : active
            ? 'border-red-300/80 bg-white text-zinc-900 shadow-[0_0_22px_rgba(248,113,113,.55)]'
            : muted
              ? 'border-white/10 bg-white/[.04] text-zinc-500 group-hover:text-zinc-300'
              : 'border-white/12 bg-white/[.07] text-zinc-200 group-hover:bg-white/[.13]'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
    <span className={`text-[10px] font-medium leading-none ${active ? 'text-white' : 'text-zinc-500'}`}>
      {label}
    </span>
  </button>
);

const LIVE_VOICES = [
  { id: 'Aoede', label: 'Aoede — warm', gender: 'female' },
  { id: 'Kore', label: 'Kore — clear', gender: 'female' },
  { id: 'Leda', label: 'Leda — bright', gender: 'female' },
  { id: 'Puck', label: 'Puck — lively', gender: 'male' },
  { id: 'Charon', label: 'Charon — deep', gender: 'male' },
  { id: 'Fenrir', label: 'Fenrir — strong', gender: 'male' },
  { id: 'Orus', label: 'Orus — steady', gender: 'male' },
];

/**
 * 3D Holographic Iron Man Mark-LXXXV & JARVIS Cyber Arc Reactor Canvas
 * Features:
 * - 180-degree smooth orbital oscillating rotation with 3D perspective projection
 * - Glowing neon visor HUD eyes (reactive to audio frequency & AI thinking/speaking state)
 * - Holographic HUD rings, reticles, particle starfield, and laser audio equalizer
 */
/**
 * IRIS-style AI Core — a particle sphere with orbital rings.
 *
 * Points are distributed over a sphere with the Fibonacci lattice, projected in
 * 3D and rendered with additive blending. The shell breathes with the user's
 * microphone level and pulses while the assistant speaks, shifting from the
 * idle neon green to cyan as it becomes active.
 */
const AICoreSphere = ({ voiceState, micVolume }) => {
  const canvasRef = useRef(null);
  const voiceStateRef = useRef(voiceState);
  const micVolumeRef = useRef(micVolume);

  // Keep the animation loop reading fresh values without restarting it.
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { micVolumeRef.current = micVolume; }, [micVolume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let animationId;
    let time = 0;
    let volume = 0;

    const COUNT = 900;
    const RADIUS = 1.3;
    // Fibonacci sphere: even coverage without clustering at the poles.
    const points = Array.from({ length: COUNT }, (_, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      return {
        x: RADIUS * Math.sin(phi) * Math.cos(theta),
        y: RADIUS * Math.sin(phi) * Math.sin(theta),
        z: RADIUS * Math.cos(phi),
        phase: Math.random() * Math.PI * 2,
        weight: 0.5 + Math.random() * 0.8,
      };
    });

    const lerp = (a, b, t) => a + (b - a) * t;
    const IDLE_RGB = [57, 255, 20];   // #39ff14
    const ACTIVE_RGB = [0, 255, 255]; // #00ffff

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const state = voiceStateRef.current;
      const mic = micVolumeRef.current || 0;
      const speaking = state === 'speaking';
      const thinking = state === 'thinking';
      const connected = state !== 'idle' && state !== 'error' && state !== 'muted';

      time += 0.016;
      ctx.clearRect(0, 0, width, height);

      // Target "volume" drives colour, scale and the surface wave.
      let targetVolume = 0;
      if (speaking) {
        targetVolume = Math.abs(Math.sin(time * 9) * 0.6 + Math.sin(time * 4.3) * 0.4) * 0.6;
      } else if (thinking) {
        targetVolume = 0.25 + Math.abs(Math.sin(time * 3)) * 0.15;
      } else if (connected) {
        targetVolume = Math.min(0.5, mic / 160) + Math.abs(Math.sin(time * 1.6)) * 0.035;
      }
      volume = lerp(volume, targetVolume, speaking ? 0.14 : 0.09);

      const blend = Math.min(volume * 2, 1);
      const r = Math.round(lerp(IDLE_RGB[0], ACTIVE_RGB[0], blend));
      const g = Math.round(lerp(IDLE_RGB[1], ACTIVE_RGB[1], blend));
      const b = Math.round(lerp(IDLE_RGB[2], ACTIVE_RGB[2], blend));
      const core = `${r}, ${g}, ${b}`;

      const scale = Math.min(width, height) * (connected ? (speaking ? 0.30 : 0.26) : 0.19);
      const rotY = time * 0.28;
      const rotZ = time * 0.12;

      const project = (p) => {
        // Surface wave: displace along the normal while active.
        const wave = volume > 0.002
          ? Math.sin(time * 7 + p.phase) * volume * p.weight * 0.2
          : 0;
        const f = 1 + wave;
        let x = p.x * f;
        let y = p.y * f;
        let z = p.z * f;

        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        [x, z] = [x * cosY - z * sinY, x * sinY + z * cosY];

        const cosZ = Math.cos(rotZ);
        const sinZ = Math.sin(rotZ);
        [x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ];

        const depth = 4.2;
        const persp = depth / (depth + z);
        return { x: cx + x * scale * persp, y: cy + y * scale * persp, persp, z };
      };

      ctx.globalCompositeOperation = 'lighter';

      // Inner glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 1.5);
      glow.addColorStop(0, `rgba(${core}, ${0.10 + volume * 0.22})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Orbital rings
      const drawRing = (ringRadius, tilt, speed, alpha) => {
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const rx = Math.cos(a) * ringRadius;
          const rz = Math.sin(a) * ringRadius;
          const ry = rz * Math.sin(tilt);
          const p = project({ x: rx, y: ry, z: rz * Math.cos(tilt), phase: 0, weight: 0 });
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(${core}, ${alpha})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        void speed;
      };
      const ringAlpha = connected ? 0.12 + volume * 0.5 : 0.05;
      drawRing(1.5, Math.PI * 0.1, 0.16, ringAlpha);
      drawRing(1.72, Math.PI * 0.42, -0.1, ringAlpha * 0.75);

      // Particle shell — far points first so near points read as brighter.
      const projected = points.map(project).sort((a, b) => b.z - a.z);
      const baseAlpha = connected ? 0.65 + volume * 0.3 : 0.2;
      for (const p of projected) {
        const size = Math.max(0.4, 1.5 * p.persp);
        ctx.fillStyle = `rgba(${core}, ${baseAlpha * p.persp * 0.8})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={400}
      className="w-full max-w-[340px] sm:max-w-[400px] h-[300px] sm:h-[360px] mx-auto select-none pointer-events-none"
    />
  );
};

const IronManHologramCanvas = ({ voiceState, micVolume, theme = 'jarvis' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let time = 0;

    // Generate holographic ambient stars/particles
    const particles = Array.from({ length: 45 }, () => ({
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: Math.random() * 400 - 200,
      speed: Math.random() * 0.8 + 0.4,
      size: Math.random() * 1.8 + 0.8,
    }));

    const render = () => {
      time += 0.025;
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Color themes
      let primaryGlow = 'rgba(56, 189, 248, '; // Cyan
      let eyeColor = '#38bdf8';
      let arcColor = '#0284c7';
      let ringColor = 'rgba(99, 102, 241, ';

      if (voiceState === 'speaking') {
        primaryGlow = 'rgba(239, 68, 68, '; // Hot Iron Man Crimson & Gold
        eyeColor = '#f59e0b';
        arcColor = '#dc2626';
        ringColor = 'rgba(245, 158, 11, ';
      } else if (voiceState === 'thinking') {
        primaryGlow = 'rgba(245, 158, 11, '; // Amber Matrix
        eyeColor = '#fbbf24';
        arcColor = '#d97706';
        ringColor = 'rgba(217, 119, 6, ';
      }

      // Smooth 180-degree oscillating rotation
      const rotY = Math.sin(time * 0.8) * 0.85; // ~100 deg sweep left-to-right
      const rotX = Math.sin(time * 0.4) * 0.12;

      // 1. Draw Starfield & Cyber Matrix Nodes
      particles.forEach((p) => {
        p.z -= p.speed;
        if (p.z < -200) p.z = 200;
        const scale = 250 / (250 + p.z);
        const px = cx + p.x * scale;
        const py = cy + p.y * scale;
        const alpha = Math.max(0.1, (1 - p.z / 200) * 0.4);

        ctx.fillStyle = `${primaryGlow}${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size * scale, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2. Draw Orbiting Holographic HUD Radar Rings & Arc Equalizer
      ctx.save();
      ctx.translate(cx, cy);

      const pulseVol = Math.min(45, (micVolume || 0) * 0.6);
      const outerRadius = 130 + pulseVol;

      // Outer targeting reticle ring
      ctx.strokeStyle = `${ringColor}0.35)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Dashed HUD Ring
      ctx.save();
      ctx.rotate(time * 0.4);
      ctx.strokeStyle = `${primaryGlow}0.6)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 18, 4, 18]);
      ctx.beginPath();
      ctx.arc(0, 0, outerRadius - 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Equalizer Waveform Arcs around helmet
      const bars = 36;
      for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2 + time * 0.3;
        const barHeight = Math.sin(time * 4 + i * 0.8) * 12 + (voiceState === 'speaking' ? 22 : pulseVol * 0.8);
        const r1 = outerRadius + 8;
        const r2 = r1 + Math.max(3, barHeight);

        const x1 = Math.cos(angle) * r1;
        const y1 = Math.sin(angle) * r1;
        const x2 = Math.cos(angle) * r2;
        const y2 = Math.sin(angle) * r2;

        ctx.strokeStyle = i % 2 === 0 ? `${primaryGlow}0.8)` : `${ringColor}0.6)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.restore();

      // 3. 3D Iron Man Mark-LXXXV Holographic Helmet Points & Polygons
      const project = (x, y, z) => {
        // Rotate Y
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;

        // Rotate X
        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        const depth = 280;
        const fov = depth / (depth + z2 + 80);
        return {
          x: cx + x1 * fov * 1.35,
          y: cy + y2 * fov * 1.35,
          z: z2,
          fov,
        };
      };

      // Helmet Structural Landmarks
      const headNodes = [
        // Crown & Forehead
        { id: 'crown_t', p: project(0, -95, 10) },
        { id: 'forehead_l', p: project(-42, -75, 45) },
        { id: 'forehead_r', p: project(42, -75, 45) },
        { id: 'temple_l', p: project(-58, -45, 30) },
        { id: 'temple_r', p: project(58, -45, 30) },

        // Faceplate & Brow
        { id: 'brow_mid', p: project(0, -45, 62) },
        { id: 'brow_l', p: project(-32, -45, 58) },
        { id: 'brow_r', p: project(32, -45, 58) },

        // Visor Eyes Left
        { id: 'eye_l_in', p: project(-10, -28, 62) },
        { id: 'eye_l_out', p: project(-40, -32, 54) },
        { id: 'eye_l_bot', p: project(-26, -23, 60) },

        // Visor Eyes Right
        { id: 'eye_r_in', p: project(10, -28, 62) },
        { id: 'eye_r_out', p: project(40, -32, 54) },
        { id: 'eye_r_bot', p: project(26, -23, 60) },

        // Cheekbones & Gold Insets
        { id: 'cheek_l', p: project(-48, -5, 45) },
        { id: 'cheek_r', p: project(48, -5, 45) },
        { id: 'nose_bridge', p: project(0, -18, 66) },
        { id: 'nose_tip', p: project(0, 5, 64) },

        // Jawline & Chin
        { id: 'jaw_l', p: project(-36, 48, 40) },
        { id: 'jaw_r', p: project(36, 48, 40) },
        { id: 'chin_l', p: project(-18, 72, 50) },
        { id: 'chin_r', p: project(18, 72, 50) },
        { id: 'chin_mid', p: project(0, 75, 54) },

        // Arc Reactor Core (Below Chin)
        { id: 'arc_core', p: project(0, 115, 20) },
      ];

      // Draw Wireframe Mesh
      const drawLine = (p1, p2, alpha = 0.55, width = 1.5, strokeStyle) => {
        ctx.strokeStyle = strokeStyle || `${primaryGlow}${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      };

      const getNode = (id) => headNodes.find((n) => n.id === id)?.p;

      // Outer Helmet Contours
      drawLine(getNode('crown_t'), getNode('forehead_l'), 0.5);
      drawLine(getNode('crown_t'), getNode('forehead_r'), 0.5);
      drawLine(getNode('forehead_l'), getNode('temple_l'), 0.6);
      drawLine(getNode('forehead_r'), getNode('temple_r'), 0.6);
      drawLine(getNode('temple_l'), getNode('cheek_l'), 0.6);
      drawLine(getNode('temple_r'), getNode('cheek_r'), 0.6);
      drawLine(getNode('cheek_l'), getNode('jaw_l'), 0.7);
      drawLine(getNode('cheek_r'), getNode('jaw_r'), 0.7);
      drawLine(getNode('jaw_l'), getNode('chin_l'), 0.75);
      drawLine(getNode('jaw_r'), getNode('chin_r'), 0.75);
      drawLine(getNode('chin_l'), getNode('chin_mid'), 0.85);
      drawLine(getNode('chin_r'), getNode('chin_mid'), 0.85);

      // Forehead & Brow Plate
      drawLine(getNode('brow_mid'), getNode('brow_l'), 0.8);
      drawLine(getNode('brow_mid'), getNode('brow_r'), 0.8);
      drawLine(getNode('brow_mid'), getNode('crown_t'), 0.4);
      drawLine(getNode('brow_l'), getNode('forehead_l'), 0.45);
      drawLine(getNode('brow_r'), getNode('forehead_r'), 0.45);

      // Nose & Faceplate Center Ridge
      drawLine(getNode('brow_mid'), getNode('nose_bridge'), 0.85);
      drawLine(getNode('nose_bridge'), getNode('nose_tip'), 0.85);
      drawLine(getNode('nose_tip'), getNode('chin_mid'), 0.6);
      drawLine(getNode('nose_tip'), getNode('cheek_l'), 0.5);
      drawLine(getNode('nose_tip'), getNode('cheek_r'), 0.5);

      // 4. Glowing Iron Man Visor Eyes (High Glow)
      const el_in = getNode('eye_l_in');
      const el_out = getNode('eye_l_out');
      const el_bot = getNode('eye_l_bot');

      const er_in = getNode('eye_r_in');
      const er_out = getNode('eye_r_out');
      const er_bot = getNode('eye_r_bot');

      const renderEye = (pIn, pOut, pBot) => {
        ctx.save();
        ctx.shadowColor = eyeColor;
        ctx.shadowBlur = voiceState === 'speaking' ? 24 : 16;
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.moveTo(pIn.x, pIn.y);
        ctx.lineTo(pOut.x, pOut.y);
        ctx.lineTo(pBot.x, pBot.y);
        ctx.closePath();
        ctx.fill();

        // Inner bright core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(pIn.x * 0.8 + pBot.x * 0.2, pIn.y * 0.8 + pBot.y * 0.2);
        ctx.lineTo(pOut.x * 0.8 + pBot.x * 0.2, pOut.y * 0.8 + pBot.y * 0.2);
        ctx.lineTo(pBot.x, pBot.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };

      renderEye(el_in, el_out, el_bot);
      renderEye(er_in, er_out, er_bot);

      // 5. Arc Reactor Quantum Chest Core
      const arc = getNode('arc_core');
      if (arc) {
        ctx.save();
        ctx.shadowColor = arcColor;
        ctx.shadowBlur = 20 + pulseVol;

        // Outer Arc Ring
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(arc.x, arc.y, 22 + pulseVol * 0.3, 0, Math.PI * 2);
        ctx.stroke();

        // Inner Triangle Reactor
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const rTri = 12 + pulseVol * 0.15;
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3 - Math.PI / 2 + time * 0.8;
          const tx = arc.x + Math.cos(a) * rTri;
          const ty = arc.y + Math.sin(a) * rTri;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [voiceState, micVolume, theme]);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={400}
      className="w-full max-w-[340px] sm:max-w-[400px] h-[300px] sm:h-[360px] mx-auto filter drop-shadow-[0_0_25px_rgba(56,189,248,0.25)] select-none pointer-events-none"
    />
  );
};

/* ==========================================================================
   IRIS-style dashboard pieces
   Neon-on-black glass panels that report live host telemetry. Every number
   comes from the telemetry feed; anything the host does not report is shown as
   unavailable rather than invented.
   ========================================================================== */

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Green through amber to red as a load approaches its limit. */
const loadColor = (percent) => {
  if (!finiteNumber(percent)) return '#52525b';
  const clamped = Math.min(100, Math.max(0, percent));
  const hue = 120 * (1 - clamped / 100);
  return `hsl(${hue}, 85%, 55%)`;
};

const GlassPanel = ({ title, icon: Icon, children }) => (
  <div className="rounded-2xl border border-emerald-500/15 bg-black/50 backdrop-blur-xl p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
    <div className="flex items-center gap-1.5 mb-2.5">
      {Icon ? <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : null}
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-300/80">{title}</span>
    </div>
    {children}
  </div>
);

/** A labelled bar whose colour tracks the load it is showing. */
const NeonBar = ({ label, percent, readout }) => {
  const known = finiteNumber(percent);
  const width = known ? Math.min(100, Math.max(0, percent)) : 0;
  const color = loadColor(percent);
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-white/45 truncate">{label}</span>
        <span className="font-mono text-[9px] font-bold shrink-0" style={{ color: known ? color : undefined }}>
          {readout ?? (known ? `${Math.round(width)}%` : 'Unavailable')}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${width}%`, background: color, boxShadow: known ? `0 0 8px ${color}` : 'none' }}
        />
      </div>
    </div>
  );
};

/** A short boot log, so the panel has something to say before data arrives. */
const BootSequence = ({ lines }) => (
  <div className="space-y-0.5">
    {lines.map((line, index) => (
      <div
        key={line}
        className="font-mono text-[8px] leading-relaxed text-emerald-400/70 animate-in fade-in slide-in-from-left-1"
        style={{ animationDelay: `${index * 90}ms`, animationFillMode: 'backwards' }}
      >
        <span className="text-emerald-500/50">›</span> {line}
      </div>
    ))}
  </div>
);

export const HackerVoiceAssistant = ({
  isOpen,
  onClose,
  onSendQuery,
  isSpeakingAudio,
  stopSpeaking,
  speakText,
  selectedLanguage = 'hi',
  setSelectedLanguage,
  languages = [],
  voiceAiResponse = '',
  activeModelDisplay = 'Auto Model',
  telemetry,
  API_BASE,
  token,
  audioEnabled,
  autoSpeakEnabled,
  setAudioEnabled,
  setAutoSpeakEnabled,
  onAttachFiles,
  onUploadFolder,
  isRagEnabled,
  setIsRagEnabled,
  isWebSearchEnabled,
  setIsWebSearchEnabled,
  onClearChat,
  wakeWordSupported = false,
  wakeWordEnabled = false,
  wakePhrase = 'hey smaran',
  onToggleWakeWord,
}) => {
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [micVolume, setMicVolume] = useState(0);
  const [theme, setTheme] = useState('jarvis'); // 'jarvis' | 'cyberpunk' | 'quantum'
  const [micStatus, setMicStatus] = useState('idle');
  const [recognizerStatus, setRecognizerStatus] = useState('idle');
  const [recorderStatus, setRecorderStatus] = useState('idle');
  const [vadStatus, setVadStatus] = useState('idle');
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [voiceIssue, setVoiceIssue] = useState('');

  // Real-time streaming voice (Gemini Live). When active it replaces the
  // record-then-transcribe path with a continuous two-way audio stream, which
  // also works in the packaged desktop window where SpeechRecognition does not.
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const liveActiveRef = useRef(false);
  useEffect(() => { liveActiveRef.current = liveActive; }, [liveActive]);
  const [liveState, setLiveState] = useState('idle');
  const liveSessionRef = useRef(null);
  const [speechBus, setSpeechBus] = useState(null);
  const [visionMode, setVisionMode] = useState('off');

  // Character and speaking voice are the user's choice and are remembered.
  const [avatarId, setAvatarId] = useState(() => {
    const saved = localStorage.getItem('sm_avatar_id');
    // A character that no longer exists leaves the picker showing a blank and
    // the panel rendering nothing. Riyo was removed, so anyone who had it
    // selected is moved back to a character that is still here.
    const known = saved === 'core'
      || MMD_CHARACTERS.some((c) => c.id === saved)
      || AVATAR_CHARACTERS.some((c) => c.id === saved);
    return known ? saved : 'anime-girl';
  });
  // Background ambience. Each character has its own synthesised room tone,
  // and it ducks while the assistant speaks so it never sits over words.
  const [ambienceOn, setAmbienceOn] = useState(
    () => localStorage.getItem('sm_ambience') !== 'off',
  );
  const ambienceRef = useRef(null);

  // Gesture Mode: hand control, tracked on this device only.
  const [gestureMode, setGestureMode] = useState(false);


  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('sm_voice_name') || 'Aoede');
  const [showAvatar, setShowAvatar] = useState(() => localStorage.getItem('sm_show_avatar') !== 'false');

  // Start and switch the bed with the workspace and the chosen character.
  useEffect(() => {
    localStorage.setItem('sm_ambience', ambienceOn ? 'on' : 'off');
    if (!isOpen || !ambienceOn) {
      ambienceRef.current?.stop();
      ambienceRef.current = null;
      return undefined;
    }
    if (!Ambience.isSupported()) return undefined;
    const profile = showAvatar ? (avatarId === 'evelyn' ? 'myraa' : 'myra') : 'core';
    const ambience = ambienceRef.current || new Ambience();
    ambienceRef.current = ambience;
    ambience.start(profile);
    return undefined;
  }, [isOpen, ambienceOn, showAvatar, avatarId]);

  // Tear the bed down when the workspace closes for good.
  useEffect(() => () => {
    ambienceRef.current?.stop();
    ambienceRef.current = null;
  }, []);

  // Duck under the assistant's own voice.
  useEffect(() => {
    ambienceRef.current?.duck(Boolean(isSpeakingAudio));
  }, [isSpeakingAudio]);
  useEffect(() => {
    localStorage.setItem('sm_avatar_id', avatarId);
    // The offline speech engine has no idea who is on screen; record the
    // character's gender so it does not answer in the wrong voice.
    // The drawn characters carry their own gender; the abstract core is given
    // the male voice so both options are available without a second picker.
    const character =
      MMD_CHARACTERS.find((c) => c.id === avatarId) ||
      AVATAR_CHARACTERS.find((c) => c.id === avatarId);
    const gender = showAvatar && character?.gender ? character.gender : 'male';
    localStorage.setItem('sm_voice_gender', gender);

    // Reconcile the speaking voice with the character every time, not only when
    // the picker is touched: a saved pairing could otherwise leave a male
    // character answering in a woman's voice.
    setVoiceName((current) => {
      const currentVoice = LIVE_VOICES.find((v) => v.id === current);
      if (currentVoice && currentVoice.gender === gender) return current;
      return (LIVE_VOICES.find((v) => v.gender === gender) || {}).id || current;
    });
  }, [avatarId, showAvatar]);
  useEffect(() => { localStorage.setItem('sm_voice_name', voiceName); }, [voiceName]);
  useEffect(() => { localStorage.setItem('sm_show_avatar', String(showAvatar)); }, [showAvatar]);
  const [recognizerIssue, setRecognizerIssue] = useState('');

  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const transcriptionInFlightRef = useRef(false);
  const autoSendInFlightRef = useRef(false);
  const soundStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(Date.now());
  const hasSpokenRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceStateRef = useRef('idle');
  const isMutedRef = useRef(false);
  const transcriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const lastSentQueryRef = useRef({ text: '', at: 0 });
  const resumeListeningRef = useRef(() => {});
  const chatScrollRef = useRef(null);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, voiceAiResponse, interimTranscript, transcript]);

  // Sync latest AI response into conversation bubble stream
  useEffect(() => {
    if (voiceAiResponse) {
      setChatHistory((prev) => {
        if (prev.length === 0) {
          return [{ role: 'assistant', text: voiceAiResponse }];
        }
        const last = prev[prev.length - 1];
        if (last.role === 'assistant') {
          return [...prev.slice(0, -1), { role: 'assistant', text: voiceAiResponse }];
        }
        return [...prev, { role: 'assistant', text: voiceAiResponse }];
      });
      // The response text can arrive before audio generation starts. Let the
      // real audio onplay event move the HUD to `speaking`; otherwise a failed
      // autoplay/TTS request would leave the assistant stuck forever.
      if (voiceStateRef.current === 'thinking' && (!autoSpeakEnabled || !audioEnabled)) {
        setVoiceState('idle');
        voiceStateRef.current = 'idle';
        hasSpokenRef.current = false;
        resumeListeningRef.current();
      }
    }
    if (!voiceAiResponse || !autoSpeakEnabled || !audioEnabled) return undefined;
    const recoveryTimer = window.setTimeout(() => {
      if (voiceStateRef.current === 'thinking' && !isSpeakingRef.current && isOpen && !isMutedRef.current) {
        setVoiceState('idle');
        voiceStateRef.current = 'idle';
        resumeListeningRef.current();
      }
    }, 8000);
    return () => window.clearTimeout(recoveryTimer);
  }, [audioEnabled, autoSpeakEnabled, isOpen, voiceAiResponse]);

  // =========================================================================
  // CONTINUOUS HANDS-FREE VOICE RECOGNITION LOOP (Genspark / Speakly Style)
  // =========================================================================
  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
  }, []);

  const getRecognitionLang = (langCode) => {
    const map = {
      en: 'en-US',
      hi: 'hi-IN',
      gu: 'gu-IN',
      pa: 'pa-IN',
      mr: 'mr-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      ml: 'ml-IN',
      kn: 'kn-IN',
      bn: 'bn-IN',
    };
    return map[langCode] || 'en-US';
  };

  const startFreshRecorder = useCallback(() => {
    const stream = micStreamRef.current;
    if (!isOpen || isMutedRef.current || !stream) return null;
    if (!window.MediaRecorder) {
      setRecorderStatus('unavailable');
      return null;
    }
    if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      setRecorderStatus('error');
      setVoiceIssue('The granted microphone stream is no longer active.');
      return null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      setRecorderStatus('recording');
      return mediaRecorderRef.current;
    }

    try {
      setRecorderStatus('starting');
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) audioChunksRef.current.push(event.data);
      };
      // Do not use a timeslice here. Stopping the recorder finalizes a complete,
      // decodable container for the local Whisper fallback.
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecorderStatus('recording');
      return recorder;
    } catch (error) {
      console.warn('Local voice recorder could not start:', error);
      setRecorderStatus('error');
      setVoiceIssue(`Audio recorder could not start: ${error?.message || 'unsupported recorder'}`);
      return null;
    }
  }, [isOpen]);

  const finalizeRecordedAudio = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;

    if (recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        recorder.addEventListener('stop', finish, { once: true });
        try {
          recorder.stop();
        } catch (_) {
          finish();
        }
        window.setTimeout(finish, 2000);
      });
    }

    if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
    setRecorderStatus('stopped');
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];
    if (!chunks.length) return null;
    const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
    return new Blob(chunks, { type: mimeType });
  }, []);

  const startRecognition = useCallback(() => {
    if (!isOpen || isMutedRef.current) return;
    stopRecognition();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognizerStatus('unavailable');
      setRecognizerIssue('Live recognition is unavailable; recorded audio will be transcribed locally instead.');
      return;
    }

    try {
      setRecognizerStatus('starting');
      setRecognizerIssue('');
      const recognition = new SpeechRecognition();
      recognition.lang = getRecognitionLang(selectedLanguage);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setRecognizerStatus('active');
        setRecognizerIssue('');
        setVoiceIssue('');
        setVoiceState('listening');
        voiceStateRef.current = 'listening';
      };

      recognition.onresult = (event) => {
        if (voiceStateRef.current !== 'listening') return;

        let newFinalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            newFinalText += result[0].transcript + ' ';
          } else {
            interimText += result[0].transcript;
          }
        }
        if (newFinalText.trim()) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${newFinalText}`.trim();
        }
        const finalText = finalTranscriptRef.current;
        interimText = interimText.trim();

        if (finalText || interimText) {
          setVadStatus('speech-detected');
          hasSpokenRef.current = true;
          lastSpeechTimeRef.current = Date.now();
        }

        setTranscript(finalText);
        transcriptRef.current = finalText;
        setInterimTranscript(interimText);
        interimTranscriptRef.current = interimText;
      };

      recognition.onerror = (e) => {
        if (e.error === 'aborted') {
          setRecognizerStatus('stopped');
          return;
        }
        if (e.error === 'no-speech') {
          setRecognizerStatus('idle');
          setRecognizerIssue('No speech was detected; restarting the recognizer.');
          return;
        }
        const permissionError = e.error === 'not-allowed' || e.error === 'service-not-allowed';
        setRecognizerStatus(permissionError ? 'denied' : 'error');
        setRecognizerIssue(permissionError
          ? 'Speech recognition permission or service access was denied.'
          : `Speech recognition error: ${e.error || 'unknown error'}.`);
        if (permissionError && mediaRecorderRef.current?.state !== 'recording') {
          setVoiceState('error');
          voiceStateRef.current = 'error';
        }
        if (isOpen && !isMutedRef.current && voiceStateRef.current === 'listening') {
          setTimeout(() => {
            if (isOpen && !isMutedRef.current && voiceStateRef.current === 'listening') {
              startRecognition();
            }
          }, 300);
        }
      };

      recognition.onend = () => {
        setRecognizerStatus((current) => current === 'denied' || current === 'error' ? current : 'stopped');
        if (isOpen && !isMutedRef.current && voiceStateRef.current === 'listening') {
          setTimeout(() => {
            if (isOpen && !isMutedRef.current && voiceStateRef.current === 'listening') {
              startRecognition();
            }
          }, 50);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      setRecognizerStatus('error');
      setRecognizerIssue(`Speech recognition could not start: ${error?.message || 'unknown error'}.`);
      setTimeout(() => {
        if (isOpen && !isMutedRef.current) startRecognition();
      }, 500);
    }
  }, [isOpen, selectedLanguage, stopRecognition]);

  resumeListeningRef.current = () => {
    setUploadStatus('idle');
    const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
    setVadStatus(vadReady ? 'ready' : 'unavailable');
    setVoiceState(vadReady ? 'vad-ready' : 'idle');
    voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
    startFreshRecorder();
    startRecognition();
  };

  // When AI finishes speaking -> automatically restart listening loop for perpetual conversation
  useEffect(() => {
    isSpeakingRef.current = isSpeakingAudio;
    if (isSpeakingAudio) {
      setVoiceState('speaking');
      voiceStateRef.current = 'speaking';
      stopRecognition();
      finalizeRecordedAudio().catch(() => {});
    } else if (voiceStateRef.current === 'speaking' || voiceStateRef.current === 'thinking') {
      setVoiceState('idle');
      voiceStateRef.current = 'idle';
      hasSpokenRef.current = false;
      setTranscript('');
      setInterimTranscript('');
      transcriptRef.current = '';
      interimTranscriptRef.current = '';
      setTimeout(() => {
        if (isOpen && !isMutedRef.current) {
          startFreshRecorder();
          startRecognition();
        }
      }, 100);
    }
  }, [isSpeakingAudio, isOpen, finalizeRecordedAudio, startFreshRecorder, startRecognition, stopRecognition]);

  // Backend Audio Transcription Fallback (Whisper)
  const transcribeBackendAudio = useCallback(async () => {
    if (transcriptionInFlightRef.current) return '';
    transcriptionInFlightRef.current = true;
    try {
      const audioBlob = await finalizeRecordedAudio();
      if (!audioBlob) return '';
      if (audioBlob.size < 400) return '';

      setUploadStatus('uploading');
      setVoiceState('uploading');
      voiceStateRef.current = 'uploading';
      setVoiceIssue('');

      const formData = new FormData();
      const extension = audioBlob.type.includes('mp4') ? 'm4a' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      formData.append('file', audioBlob, `voice_query.${extension}`);
      formData.append('language', selectedLanguage || 'auto');
      formData.append('request_id', window.crypto?.randomUUID?.() || `${Date.now()}`);
      const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        const backendTranscript = (data?.transcript || '').trim();
        setUploadStatus(backendTranscript ? 'complete' : 'empty');
        if (!backendTranscript) setVoiceIssue('Local transcription completed without recognized speech.');
        return backendTranscript;
      }
      throw new Error(`Local transcription returned HTTP ${res.status}`);
    } catch (error) {
      console.warn('Local voice transcription failed:', error);
      setUploadStatus('error');
      setVoiceIssue(`Recorded-audio transcription failed: ${error?.message || 'backend unavailable'}`);
      setVoiceState('error');
      voiceStateRef.current = 'error';
    } finally {
      transcriptionInFlightRef.current = false;
    }
    return '';
  }, [API_BASE, finalizeRecordedAudio, selectedLanguage, token]);

  // Trigger send when user stops talking (0.85s silence detected)
  const triggerAutoSend = useCallback(async () => {
    // The live session owns the conversation when it is running. Without
    // this the old record-transcribe-send path fired as well, so one spoken
    // sentence went down two routes at once: the slow one answered second
    // and overwrote the live reply, and consecutive sentences ran together.
    if (liveActiveRef.current) return;
    if (autoSendInFlightRef.current || voiceStateRef.current === 'thinking' || voiceStateRef.current === 'speaking' || isMutedRef.current) return;
    autoSendInFlightRef.current = true;

    try {
      let finalQuery = (transcriptRef.current || interimTranscriptRef.current || '').trim();
      if (!finalQuery) {
        const backendText = await transcribeBackendAudio();
        if (backendText) finalQuery = backendText.trim();
      } else {
        // Native SpeechRecognition already supplied the text. Discard its parallel
        // recording so a later fallback cannot repeat an older utterance.
        await finalizeRecordedAudio();
      }

      if (!finalQuery || finalQuery.length < 2) {
        hasSpokenRef.current = false;
        if (voiceStateRef.current !== 'error') {
          const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
          setVoiceState(vadReady ? 'vad-ready' : 'idle');
          voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
          setVadStatus(vadReady ? 'ready' : 'unavailable');
        }
        startFreshRecorder();
        return;
      }

      const normalizedQuery = finalQuery.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
      const now = Date.now();
      if (lastSentQueryRef.current.text === normalizedQuery && now - lastSentQueryRef.current.at < 12000) {
        hasSpokenRef.current = false;
        finalTranscriptRef.current = '';
        startFreshRecorder();
        return;
      }
      lastSentQueryRef.current = { text: normalizedQuery, at: now };

      // Add user message to conversation list
      setChatHistory((prev) => [...prev, { role: 'user', text: finalQuery }]);
      setUploadStatus('idle');
      setVoiceState('thinking');
      voiceStateRef.current = 'thinking';
      hasSpokenRef.current = false;

      setTranscript('');
      setInterimTranscript('');
      transcriptRef.current = '';
      interimTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      stopRecognition();

      if (onSendQuery) {
        await onSendQuery(finalQuery);
      }
    } catch (error) {
      console.warn('Voice query failed:', error);
      setVoiceIssue(`Voice query failed: ${error?.message || 'model request unavailable'}`);
      setVoiceState('error');
      voiceStateRef.current = 'error';
      startFreshRecorder();
      startRecognition();
    } finally {
      autoSendInFlightRef.current = false;
    }
  }, [finalizeRecordedAudio, onSendQuery, startFreshRecorder, startRecognition, stopRecognition, transcribeBackendAudio]);

  // VAD / Silence watchdog timer: 850ms
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      if (['listening', 'capturing', 'vad-ready'].includes(voiceStateRef.current) && hasSpokenRef.current && !isMutedRef.current) {
        const elapsed = Date.now() - lastSpeechTimeRef.current;
        if (elapsed > 850) {
          triggerAutoSend();
        }
      }
    }, 120);

    return () => clearInterval(interval);
  }, [isOpen, triggerAutoSend]);

  // Setup Microphone & AudioContext metering
  useEffect(() => {
    if (!isOpen) return;
    // The live stream owns the microphone when it is running. Letting the
    // turn-based recorder start as well made both compete for the device, and
    // the slow upload-and-transcribe path answered instead of the live one.
    if (liveActive || liveAvailable) {
      // Clear any half-finished request from a previous pass. Without this the
      // status stayed on 'requesting' forever: the first run asked for the
      // microphone, liveAvailable resolved while that prompt was open, and the
      // re-run bailed out here leaving the old status stranded on screen even
      // though permission had in fact been granted.
      setMicStatus((current) => (current === 'requesting' ? 'idle' : current));
      setVoiceState((current) => (current === 'permission' ? 'idle' : current));
      if (voiceStateRef.current === 'permission') voiceStateRef.current = 'idle';
      return;
    }
    let isMounted = true;

    const initMicrophone = async () => {
      try {
        setMicStatus('requesting');
        setRecognizerStatus('idle');
        setRecorderStatus('idle');
        setVadStatus('idle');
        setUploadStatus('idle');
        setVoiceIssue('');
        setRecognizerIssue('');
        setVoiceState('permission');
        voiceStateRef.current = 'permission';

        if (!navigator.mediaDevices?.getUserMedia) {
          setMicStatus('unavailable');
          setVoiceIssue('This browser does not expose microphone capture to the application.');
          setVoiceState('error');
          voiceStateRef.current = 'error';
          return;
        }

        if (micStreamRef.current) {
          try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (_) {}
        }
        if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch (_) {}
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          // Permission was granted; do not leave the label claiming otherwise.
          setMicStatus((current) => (current === 'requesting' ? 'idle' : current));
          return;
        }
        micStreamRef.current = stream;
        setMicStatus('granted');

        startFreshRecorder();

        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          source.connect(analyser);
          analyserRef.current = analyser;
          setVadStatus('ready');
          setVoiceState('vad-ready');
          voiceStateRef.current = 'vad-ready';

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateVolume = () => {
            if (!isMounted) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            setMicVolume(Math.min(100, Math.round(avg * 1.6)));
            // Always run local volume/silence detection. Chromium-derived
            // browsers may expose SpeechRecognition while its hosted service is
            // unavailable; in that case this path still sends recorded audio to
            // the bundled local faster-whisper endpoint.
            if (['listening', 'capturing', 'vad-ready'].includes(voiceStateRef.current) && !isMutedRef.current) {
              if (avg >= 14) {
                if (!soundStartTimeRef.current) soundStartTimeRef.current = Date.now();
                if (Date.now() - soundStartTimeRef.current >= 250) {
                  if (!hasSpokenRef.current) {
                    setVadStatus('speech-detected');
                    if (voiceStateRef.current !== 'listening') {
                      setVoiceState('capturing');
                      voiceStateRef.current = 'capturing';
                    }
                  }
                  hasSpokenRef.current = true;
                  lastSpeechTimeRef.current = Date.now();
                }
              } else if (avg < 7) {
                soundStartTimeRef.current = 0;
              }
            }
            requestAnimationFrame(updateVolume);
          };
          updateVolume();
        } catch (error) {
          setVadStatus('unavailable');
          setVoiceIssue(`Audio level detection is unavailable: ${error?.message || 'AudioContext could not start'}`);
        }

        startRecognition();
      } catch (error) {
        if (!isMounted) return;
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setMicStatus(denied ? 'denied' : 'error');
        setRecorderStatus('idle');
        setVadStatus('idle');
        setRecognizerStatus('idle');
        setVoiceIssue(denied
          ? 'Microphone permission was denied. Allow microphone access to use voice input.'
          : `Microphone initialization failed: ${error?.message || 'no input device available'}`);
        setVoiceState('error');
        voiceStateRef.current = 'error';
      }
    };

    initMicrophone();

    return () => {
      isMounted = false;
      stopRecognition();
      if (micStreamRef.current) {
        try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (_) {}
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch (_) {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (_) {}
      }
      setRecorderStatus('stopped');
      setRecognizerStatus('stopped');
      setVadStatus('idle');
    };
  }, [isOpen, liveActive, liveAvailable, startFreshRecorder, startRecognition, stopRecognition]);

  const handleManualTextSubmit = async (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const query = textInput.trim();
    setTextInput('');
    setChatHistory((prev) => [...prev, { role: 'user', text: query }]);
    setVoiceState('thinking');
    voiceStateRef.current = 'thinking';
    stopSpeaking();
    stopRecognition();

    try {
      if (onSendQuery) {
        await onSendQuery(query);
      }
    } catch (error) {
      setVoiceIssue(`Typed voice-session request failed: ${error?.message || 'model request unavailable'}`);
      setVoiceState('error');
      voiceStateRef.current = 'error';
    }
  };

  // Is a real-time voice key configured on this install?
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/voice/live/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLiveAvailable(Boolean(data?.available));
      } catch (_) {
        /* leave real-time voice switched off */
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, API_BASE, token]);

  // Set when the person hangs up, cleared when the panel is opened again.
   // Without it there is no way to tell "no session yet" from "deliberately
   // ended", and the auto-start effect cannot respect the difference.
  const endedByUserRef = useRef(false);

  const stopLiveSession = useCallback(async () => {
    const session = liveSessionRef.current;
    liveSessionRef.current = null;
    endedByUserRef.current = true;
    setLiveActive(false);
    setLiveState('idle');
    // Clear what was being said as well as the flags. Without this the
    // last utterance stayed on screen after the session ended, and was
    // still sitting there when the next one started.
    setTranscript('');
    setInterimTranscript('');
    transcriptRef.current = '';
    interimTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    if (session) await session.stop();
  }, []);

  const startLiveSession = useCallback(async () => {
    // The turn-based recogniser and the live stream must not hold the
    // microphone at the same time.
    stopRecognition();
    try { await finalizeRecordedAudio(); } catch (_) { /* nothing recorded */ }
    if (micStreamRef.current) {
      try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (_) {}
      micStreamRef.current = null;
    }

    setRecognizerStatus('idle');
    setRecorderStatus('idle');
    setVadStatus('idle');
    setUploadStatus('idle');

    const session = new LiveVoiceSession({
      onStateChange: (state) => {
        setLiveState(state);
        if (state === 'speaking') {
          setVoiceState('speaking');
        } else if (state === 'listening') {
          setVoiceState('listening');
        }
      },
      onLevel: (level) => setMicVolume(level),
      onText: (text) => {
        setChatHistory((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + text }];
          }
          return [...prev, { role: 'assistant', text, streaming: true }];
        });
      },
      onError: (message) => {
        setVoiceIssue(message);
        setLiveState('error');
      },
      onSpeechBus: (busNode, busContext) => setSpeechBus({ node: busNode, context: busContext }),
      onVisionChange: (mode) => setVisionMode(mode),
    });

    liveSessionRef.current = session;
    setLiveActive(true);
    setVoiceIssue('');
    const started = await session.start({
      apiBase: API_BASE,
      // No language is forced: the model answers in whatever the user speaks.
      language: 'auto',
      voice: voiceName,
      // Which character is on screen decides how the voice is directed:
      // pitch, pacing and manner differ per persona, not just the timbre.
      persona: showAvatar ? (avatarId === 'evelyn' ? 'myraa' : 'myra') : 'core',
    });
    if (!started) await stopLiveSession();
  }, [API_BASE, selectedLanguage, voiceName, finalizeRecordedAudio, stopRecognition, stopLiveSession, showAvatar, avatarId]);

  // Always release the microphone and socket when the panel closes.
  useEffect(() => {
    if (!isOpen && liveSessionRef.current) stopLiveSession();
    // Reopening is a fresh intent to talk, so the hang-up is forgotten.
    if (isOpen) endedByUserRef.current = false;
  }, [isOpen, stopLiveSession]);

  // Opening the panel starts the conversation. Requiring a second click on
  // "Go Live" before the assistant would listen made it feel switched off.
  useEffect(() => {
    if (!isOpen || !liveAvailable || liveSessionRef.current) return;
    // Only until the person hangs up. This effect re-runs whenever
    // startLiveSession is rebuilt - which happens on a character, language or
    // voice change - so ending a call and then changing any of those started
    // it again on its own, and the red button appeared to do nothing.
    if (endedByUserRef.current) return;
    startLiveSession();
  }, [isOpen, liveAvailable, startLiveSession]);

  // The speaking voice is fixed when a session opens, so switching character
  // mid-call left a male character still answering in the previous voice.
  // Reconnect when the voice changes so the two always agree.
  const activeVoiceRef = useRef(voiceName);
  useEffect(() => {
    if (activeVoiceRef.current === voiceName) return;
    activeVoiceRef.current = voiceName;
    if (!isOpen || !liveSessionRef.current) return;
    (async () => {
      await stopLiveSession();
      await startLiveSession();
    })();
  }, [voiceName, isOpen, startLiveSession, stopLiveSession]);

  // Every character that can be on screen, in picker order, so a swipe
  // steps through the same list the dropdown shows.
  const characterCycle = useMemo(
    () => [...MMD_CHARACTERS.map((c) => c.id), ...AVATAR_CHARACTERS.map((c) => c.id), 'core'],
    [],
  );

  const stepCharacter = useCallback((delta) => {
    const current = showAvatar ? avatarId : 'core';
    const index = characterCycle.indexOf(current);
    const next = characterCycle[(index + delta + characterCycle.length) % characterCycle.length];
    if (next === 'core') { setShowAvatar(false); return; }
    setShowAvatar(true);
    setAvatarId(next);
  }, [characterCycle, showAvatar, avatarId]);

  // A gesture stands in for the control it names; nothing here does
  // anything the on-screen buttons cannot already do.
  const handleGestureAction = useCallback((gesture) => {
    switch (gesture) {
      case GESTURES.OPEN_PALM:
        stopSpeaking?.();
        break;
      case GESTURES.FIST:
        setGestureMode(false);
        onClose?.();
        break;
      case GESTURES.POINT:
        if (!liveActive) startLiveSession();
        break;
      case GESTURES.VICTORY: {
        const session = liveSessionRef.current;
        if (!session) break;
        if (visionMode === 'camera') session.stopVision();
        else session.startVision('camera');
        break;
      }
      case GESTURES.THUMB_UP:
        onSendQuery?.('yes');
        break;
      case GESTURES.THUMB_DOWN:
        onSendQuery?.('no, cancel that');
        break;
      case GESTURES.PINCH:
        setAmbienceOn((value) => !value);
        break;
      case GESTURES.SWIPE_LEFT:
        stepCharacter(-1);
        break;
      case GESTURES.SWIPE_RIGHT:
        stepCharacter(1);
        break;
      default:
        break;
    }
  }, [stopSpeaking, onClose, liveActive, startLiveSession, visionMode, onSendQuery, stepCharacter]);
  const toggleMute = () => {
    if (isMuted) {
      isMutedRef.current = false;
      setIsMuted(false);
      setVoiceIssue('');
      const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
      setVadStatus(vadReady ? 'ready' : 'unavailable');
      setVoiceState(vadReady ? 'vad-ready' : 'idle');
      voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
      startFreshRecorder();
      startRecognition();
    } else {
      isMutedRef.current = true;
      setIsMuted(true);
      stopRecognition();
      finalizeRecordedAudio().catch(() => {});
      setVoiceState('muted');
      voiceStateRef.current = 'muted';
      setVadStatus('idle');
    }
  };

  const liveVoiceStatus = (() => {
    if (isSpeakingAudio || voiceState === 'speaking') {
      return {
        label: 'Playing response audio',
        detail: 'Assistant audio playback is active.',
        tone: 'amber',
        icon: 'speaking',
      };
    }
    if (voiceState === 'thinking') {
      return {
        label: 'Waiting for model response',
        detail: 'The captured prompt was sent; no response timing is assumed.',
        tone: 'cyan',
        icon: 'loading',
      };
    }
    if (uploadStatus === 'uploading' || voiceState === 'uploading') {
      return {
        label: 'Uploading recorded audio',
        detail: 'Recorded audio is being sent to the configured transcription endpoint.',
        tone: 'cyan',
        icon: 'loading',
      };
    }
    if (isMuted || voiceState === 'muted') {
      return {
        label: 'Microphone muted',
        detail: 'Voice capture is paused by the user.',
        tone: 'zinc',
        icon: 'muted',
      };
    }
    if (micStatus === 'requesting' || voiceState === 'permission') {
      return {
        label: 'Waiting for microphone permission',
        detail: 'The browser has not granted microphone access yet.',
        tone: 'amber',
        icon: 'loading',
      };
    }
    if (micStatus === 'denied' || micStatus === 'unavailable' || micStatus === 'error' || uploadStatus === 'error' || voiceState === 'error') {
      return {
        label: micStatus === 'denied' ? 'Microphone permission denied' : 'Voice input unavailable',
        detail: voiceIssue || recognizerIssue || 'No working voice-input path is currently reported.',
        tone: 'rose',
        icon: 'error',
      };
    }
    if (vadStatus === 'speech-detected' || voiceState === 'capturing') {
      return {
        label: 'Speech detected',
        detail: recognizerStatus === 'active'
          ? 'Listening — waiting for you to finish speaking.'
          : 'Local audio capture detected speech and is waiting for silence before transcription.',
        tone: 'emerald',
        icon: 'listening',
      };
    }
    if (recognizerStatus === 'active' && voiceState === 'listening') {
      return {
        label: 'Listening',
        detail: `Microphone granted; recognition locale ${getRecognitionLang(selectedLanguage)} is active.`,
        tone: 'emerald',
        icon: 'listening',
      };
    }
    if (recorderStatus === 'recording') {
      const vadReady = vadStatus === 'ready';
      return {
        label: vadReady ? 'Local recorder and VAD ready' : 'Local audio recorder active',
        detail: vadReady
          ? (recognizerStatus === 'unavailable' || recognizerStatus === 'error' || recognizerStatus === 'denied'
              ? (recognizerIssue || 'Live recognition is unavailable; recorded audio is transcribed locally instead.')
              : 'Microphone capture and local speech detection are active.')
          : (voiceIssue || 'Audio is recording, but automatic speech/silence detection is unavailable.'),
        tone: vadReady ? 'emerald' : 'amber',
        icon: vadReady ? 'listening' : 'error',
      };
    }
    if (micStatus === 'granted') {
      return {
        label: 'Microphone access granted',
        detail: voiceIssue || recognizerIssue || 'Voice capture components are initializing.',
        tone: voiceIssue || recognizerIssue ? 'amber' : 'cyan',
        icon: voiceIssue || recognizerIssue ? 'error' : 'loading',
      };
    }
    return {
      label: 'Voice session idle',
      detail: 'No active microphone capture or recognition has been reported.',
      tone: 'zinc',
      icon: 'idle',
    };
  })();

  // Capture state changes many times a second, so the label is held briefly
  // before it switches. Without this the status text visibly flickers
  // between "Listening" and "Speech detected" while the user is talking.
  const [shownVoiceStatus, setShownVoiceStatus] = useState(liveVoiceStatus);
  useEffect(() => {
    if (liveVoiceStatus.label === shownVoiceStatus.label) return undefined;
    // Problems and playback are shown at once; everything else settles first.
    const immediate = liveVoiceStatus.icon === 'error' || liveVoiceStatus.icon === 'speaking';
    if (immediate) {
      setShownVoiceStatus(liveVoiceStatus);
      return undefined;
    }
    const timer = window.setTimeout(() => setShownVoiceStatus(liveVoiceStatus), 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVoiceStatus.label]);

  const currentVoiceStatus = shownVoiceStatus;

  if (!isOpen) return null;

  const currentSpeakingText = transcript || interimTranscript;

  // The line shown large over the character: what the assistant last said, or
  // the words being picked up while the user is talking.
  const lastAssistantLine = [...chatHistory].reverse().find((m) => m.role === 'assistant')?.text || '';
  // Only while a conversation is actually running. Once it ends the line
  // is history, and leaving it up made an ended session look live.
  // Listing the resting states rather than the busy ones: 'capturing' and
  // 'uploading' are also mid-conversation, and a whitelist would have
  // silently dropped the caption during them.
  const RESTING = ['idle', 'error', 'muted', 'permission'];
  const conversing = liveActive || !RESTING.includes(voiceState);
  const latestSpokenLine = conversing
    ? (currentSpeakingText || voiceAiResponse || lastAssistantLine)
    : '';

  const statusToneClasses = {
    amber: 'text-amber-400',
    cyan: 'text-emerald-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    zinc: 'text-zinc-400',
  };
  const statusDotClasses = {
    amber: 'bg-amber-400',
    cyan: 'bg-emerald-400',
    emerald: 'bg-emerald-400',
    rose: 'bg-rose-400',
    zinc: 'bg-zinc-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-zinc-100 animate-in fade-in duration-200 overflow-hidden font-sans">
      
      {/* The room the character stands in: grid floor, motes, scan sweep,
          brackets and vignette. It reacts to her voice, so the space feels
          part of the conversation rather than a looping wallpaper. */}
      <CyberFX
        intensity={liveState === 'speaking' || voiceState === 'speaking' ? 1 : liveActive ? 0.55 : 0.3}
        active={liveActive}
        hue="red"
      />

      {/* Top Cyberpunk JARVIS HUD Header */}
      <div className="relative z-10 flex items-center justify-between px-3 sm:px-8 py-2.5 sm:py-3.5 border-b border-emerald-500/20 bg-zinc-950/80 backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-0.5 shadow-[0_0_18px_rgba(0,255,65,0.2)]">
            <div className="w-full h-full bg-black rounded-[10px] flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 animate-pulse" />
            </div>
          </div>
          <div>
            <h2 className="text-xs sm:text-base font-black text-white tracking-widest flex items-center gap-1.5 sm:gap-2 uppercase">
              <span className="text-emerald-400 drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]">
                SMARAN VOICE
              </span>
              <span className="text-[8px] sm:text-[9px] font-black px-1.5 sm:px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 uppercase tracking-widest font-mono">
                Neural Assistant
              </span>
            </h2>
            <p className="text-[9px] sm:text-[10px] text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDotClasses[currentVoiceStatus.tone]} ${currentVoiceStatus.icon === 'loading' || currentVoiceStatus.icon === 'listening' ? 'animate-pulse' : ''}`} />
              <span>{currentVoiceStatus.label}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Active Model */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px] font-bold text-zinc-300 font-mono shadow-inner">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>{activeModelDisplay}</span>
          </div>

          {/* Character picker */}
          <div className="hidden sm:flex items-center gap-1 bg-zinc-900/90 border border-emerald-500/30 rounded-xl px-2 py-1 shadow-sm" title="Choose who you are speaking with">
            <UserRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={showAvatar ? avatarId : 'core'}
              onChange={(e) => {
                if (e.target.value === 'core') { setShowAvatar(false); return; }
                setShowAvatar(true);
                setAvatarId(e.target.value);
              }}
              className="bg-transparent text-[11px] font-black text-zinc-200 outline-none cursor-pointer"
            >
              {MMD_CHARACTERS.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-white font-bold">
                  🌸 {c.name}
                </option>
              ))}
              {AVATAR_CHARACTERS.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-white font-bold">
                  ✨ {c.name}
                </option>
              ))}
              <option value="core" className="bg-zinc-900 text-white font-bold">✦ Energy core</option>
            </select>
          </div>

          {/* Close / End Session */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 transition-colors cursor-pointer"
            title="Close Voice Assistant"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Character-first stage. The assistant fills the view and everything
          else sits over it, so the conversation feels like looking at someone
          rather than reading a dashboard. */}
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">

        {/* The character */}
        <div className="absolute inset-0">
          {!showAvatar ? (
            <div className="w-full h-full flex items-center justify-center">
              <EnergyCore voiceState={voiceState} micVolume={micVolume} />
            </div>
          ) : MMD_CHARACTERS.some((c) => c.id === avatarId) ? (
            <AvatarMMD
              characterId={avatarId}
              speechSource={speechBus?.node || null}
              speechContext={speechBus?.context || null}
              isSpeaking={voiceState === 'speaking' || liveState === 'speaking'}
              isListening={voiceState === 'listening' || liveState === 'listening'}
              isThinking={voiceState === 'thinking' || liveState === 'connecting'}
            />
          ) : (
            <AvatarVideo
              characterId={avatarId}
              isSpeaking={voiceState === 'speaking' || liveState === 'speaking'}
              isThinking={voiceState === 'thinking' || liveState === 'connecting'}
            />
          )}
        </div>

        {/* What the assistant just said, large enough to read across the room. */}
        <div className="absolute inset-x-0 top-[18%] px-6 sm:px-12 flex justify-center pointer-events-none">
          <p className="max-w-3xl text-center text-lg sm:text-2xl md:text-3xl leading-relaxed font-medium text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.9)]">
            {latestSpokenLine}
          </p>
        </div>

        {/* Live status, kept small and out of the way. */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-emerald-500/25 backdrop-blur-md text-[10px] font-mono font-bold pointer-events-none">
          <span className={`${statusToneClasses[currentVoiceStatus.tone]} flex items-center gap-1.5`}>
            {currentVoiceStatus.icon === 'loading' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : currentVoiceStatus.icon === 'muted' ? (
              <MicOff className="w-3 h-3" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${statusDotClasses[currentVoiceStatus.tone]} ${currentVoiceStatus.icon === 'listening' ? 'animate-pulse' : ''}`} />
            )}
            {currentVoiceStatus.label.toUpperCase()}
          </span>
        </div>

        {/* Message box, centred under the character. */}
        <div className="absolute inset-x-0 bottom-14 sm:bottom-16 px-4 flex justify-center">
          <form onSubmit={handleManualTextSubmit} className="w-full max-w-2xl flex items-center gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 min-w-0 bg-black/55 backdrop-blur-xl border border-white/12 rounded-2xl px-5 py-3.5 text-sm sm:text-base text-white placeholder-white/40 focus:outline-none focus:border-emerald-400/60 transition-colors"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="p-3.5 rounded-2xl bg-black/55 backdrop-blur-xl border border-white/12 text-emerald-300 hover:text-white hover:border-emerald-400/60 disabled:opacity-30 transition-colors cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>


      {/* Call bar.

          Modelled on a phone call rather than a toolbar: one large primary
          action in the middle that starts or ends the conversation, and the
          rest as small round toggles around it. The previous row of seven
          identical pills gave no sense of which control mattered. */}
      <div className="relative z-10 border-t border-white/8 bg-zinc-950/95 px-4 pb-4 pt-3 backdrop-blur-xl sm:px-8">

        {/* One line of status, centred above the controls. */}
        <div className="mb-3 flex justify-center">
          <span className={`flex items-center gap-2 text-[11px] font-medium ${statusToneClasses[currentVoiceStatus.tone]}`}>
            {currentVoiceStatus.icon === 'loading' ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${liveActive ? 'animate-pulse' : ''}`} />
            )}
            <span className="max-w-[70vw] truncate" title={currentVoiceStatus.detail}>
              {currentVoiceStatus.label}
            </span>
          </span>
        </div>

        <div className="flex items-end justify-center gap-3 sm:gap-5">
          <CallToggle
            icon={isMuted ? MicOff : Mic}
            label={isMuted ? 'Unmute' : 'Mute'}
            active={!isMuted}
            danger={isMuted}
            onClick={toggleMute}
          />
          <CallToggle
            icon={Monitor}
            label="Screen"
            active={visionMode === 'screen'}
            disabled={!liveActive}
            onClick={() => {
              const session = liveSessionRef.current;
              if (!session) return;
              if (visionMode === 'screen') session.stopVision();
              else session.startVision('screen');
            }}
          />
          <CallToggle
            icon={Camera}
            label="Camera"
            active={visionMode === 'camera'}
            disabled={!liveActive}
            onClick={() => {
              const session = liveSessionRef.current;
              if (!session) return;
              if (visionMode === 'camera') session.stopVision();
              else session.startVision('camera');
            }}
          />

          {/* The one control that is not a toggle: answer or hang up. */}
          <button
            type="button"
            onClick={() => (liveActive ? stopLiveSession() : startLiveSession())}
            className={`group relative -mb-1 flex h-16 w-16 items-center justify-center rounded-full
              transition-all duration-300 active:scale-95 sm:h-[72px] sm:w-[72px] ${
              liveActive
                ? 'bg-rose-600 shadow-[0_0_28px_rgba(225,29,72,.55)] hover:bg-rose-500'
                : 'bg-emerald-500 shadow-[0_0_28px_rgba(16,185,129,.5)] hover:bg-emerald-400'
            }`}
            title={liveActive ? 'End the conversation' : 'Start talking'}
          >
            {/* A ring that breathes while the call is live. */}
            {liveActive && (
              <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" aria-hidden="true" />
            )}
            <PhoneIcon className={`relative h-7 w-7 text-white transition-transform duration-300 ${
              liveActive ? 'rotate-[135deg]' : 'group-hover:scale-110'
            }`} />
          </button>

          <CallToggle icon={Hand} label="Gesture" active={gestureMode} onClick={() => setGestureMode((v) => !v)} />
          {Ambience.isSupported() && (
            <CallToggle icon={Music2} label="Ambience" active={ambienceOn} onClick={() => setAmbienceOn((v) => !v)} />
          )}
        </div>
      </div>

      {/* Stark-workshop gesture layer, above everything but click-through. */}
      <GestureHUD
        isOpen={gestureMode}
        onClose={() => setGestureMode(false)}
        onAction={handleGestureAction}
      />
    </div>
  );
};

export default HackerVoiceAssistant;
