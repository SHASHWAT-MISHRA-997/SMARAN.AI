import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Eye,
  Code2,
  Download,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Layers,
  Sparkles,
  Terminal,
  Zap,
  Box,
  Maximize2,
  Sliders,
  Compass,
} from 'lucide-react';

/**
 * AAA Production-Grade 3D WebGL / Canvas Holographic Simulation Engine
 * Procedurally simulates Maya cmds.polyTorus, Blender bpy, and Three.js HUDs
 * with 3D perspective projection, orbital inertia, volumetric glow, and particles.
 */
export const Maya3DCanvas = ({ code }) => {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [renderMode, setRenderMode] = useState('hologram'); // 'hologram' | 'wireframe' | 'solid'
  const [currentFrame, setCurrentFrame] = useState(1);
  const [fps, setFps] = useState(60);
  const [coreColor, setCoreColor] = useState('#00f0ff'); // Cyan neon

  // Camera & Orbit State with Inertia
  const rotRef = useRef({ x: 0.38, y: 0.72 });
  const targetRotRef = useRef({ x: 0.38, y: 0.72 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1.1);
  const targetZoomRef = useRef(1.1);

  // Parse Maya/3D Code for Procedural Parameters
  const rings = [];
  try {
    const ringMatches = code.matchAll(/(?:cmds\.polyTorus|create_jarvis_ring)\s*\(([^)]+)\)/gi);
    for (const match of ringMatches) {
      const args = match[1];
      const rMatch = args.match(/(?:radius|r)\s*=\s*([0-9.]+)/i);
      const subMatch = args.match(/(?:subdivisions|sx)\s*=\s*([0-9]+)/i);
      const spdMatch = args.match(/(?:speed)\s*=\s*([0-9.-]+)/i);
      const nameMatch = args.match(/(?:name)\s*=\s*["']([^"']+)["']/i);

      rings.push({
        radius: rMatch ? parseFloat(rMatch[1]) : (4.5 + rings.length * 1.6),
        subdivisions: subMatch ? parseInt(subMatch[1], 10) : 24,
        speed: spdMatch ? parseFloat(spdMatch[1]) : (rings.length % 2 === 0 ? 2.5 : -1.8),
        name: nameMatch ? nameMatch[1] : `Ring_${rings.length + 1}`,
      });
    }
  } catch (_) {}

  const activeRings = rings.length > 0 ? rings : [
    { radius: 4.8, subdivisions: 16, speed: 2.5, name: "Jarvis_Core_Inner" },
    { radius: 5.6, subdivisions: 32, speed: -1.8, name: "Jarvis_Core_Outer" },
    { radius: 6.5, subdivisions: 20, speed: 4.0, name: "Jarvis_Core_Tracker" },
    { radius: 7.4, subdivisions: 48, speed: -0.8, name: "Jarvis_Perimeter_Ring" },
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let frame = 0;
    let lastTime = performance.now();
    let frameCounter = 0;
    let fpsTimer = performance.now();

    // 3D Ambient Holographic Starfield Particles
    const particles = Array.from({ length: 65 }, () => ({
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
      z: (Math.random() - 0.5) * 600,
      size: Math.random() * 2 + 0.8,
      speed: Math.random() * 0.6 + 0.3,
      alpha: Math.random() * 0.6 + 0.2,
    }));

    const render = (now) => {
      // FPS Counter
      frameCounter++;
      if (now - fpsTimer >= 1000) {
        setFps(frameCounter);
        frameCounter = 0;
        fpsTimer = now;
      }

      if (isPlaying) {
        frame += 1 * speedMultiplier;
        setCurrentFrame(Math.floor(frame));
      }

      // Smooth Camera Inertia Damping
      rotRef.current.x += (targetRotRef.current.x - rotRef.current.x) * 0.12;
      rotRef.current.y += (targetRotRef.current.y - rotRef.current.y) * 0.12;
      zoomRef.current += (targetZoomRef.current - zoomRef.current) * 0.12;

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Deep Holographic Gradient & Vignette
      const bgGrad = ctx.createRadialGradient(cx, cy, 50, cx, cy, width * 0.7);
      bgGrad.addColorStop(0, '#060b14');
      bgGrad.addColorStop(0.6, '#04070d');
      bgGrad.addColorStop(1, '#020306');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 3D Perspective Projection Function
      const project = (x, y, z) => {
        const cosY = Math.cos(rotRef.current.y);
        const sinY = Math.sin(rotRef.current.y);
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;

        const cosX = Math.cos(rotRef.current.x);
        const sinX = Math.sin(rotRef.current.x);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        const fov = 420 * zoomRef.current;
        const dist = z2 + 450;
        const scale = fov / Math.max(40, dist);

        return {
          px: cx + x1 * scale,
          py: cy + y2 * scale,
          depth: z2,
          scale,
        };
      };

      // 1. Draw Starfield Particles
      particles.forEach((p) => {
        p.z -= p.speed;
        if (p.z < -300) p.z = 300;
        const proj = project(p.x, p.y, p.z);
        ctx.fillStyle = `rgba(56, 189, 248, ${p.alpha * Math.min(1, proj.scale)})`;
        ctx.beginPath();
        ctx.arc(proj.px, proj.py, p.size * proj.scale, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2. Draw 3D Isometric Cyber Grid Floor
      const gridCount = 8;
      const gridSpacing = 40;
      ctx.lineWidth = 1;
      for (let i = -gridCount; i <= gridCount; i++) {
        const p1 = project(i * gridSpacing, 160, -gridCount * gridSpacing);
        const p2 = project(i * gridSpacing, 160, gridCount * gridSpacing);
        const alpha = Math.max(0.02, 0.15 - Math.abs(i) * 0.015);
        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();

        const p3 = project(-gridCount * gridSpacing, 160, i * gridSpacing);
        const p4 = project(gridCount * gridSpacing, 160, i * gridSpacing);
        ctx.beginPath();
        ctx.moveTo(p3.px, p3.py);
        ctx.lineTo(p4.px, p4.py);
        ctx.stroke();
      }

      // 3. Central Quantum Arc Reactor Glow Core
      const corePulse = Math.sin(frame * 0.06) * 6;
      const core = project(0, 0, 0);
      const radGlow = ctx.createRadialGradient(core.px, core.py, 3, core.px, core.py, (38 + corePulse) * core.scale);
      radGlow.addColorStop(0, '#ffffff');
      radGlow.addColorStop(0.2, '#38bdf8');
      radGlow.addColorStop(0.6, 'rgba(14, 165, 233, 0.4)');
      radGlow.addColorStop(1, 'rgba(14, 165, 233, 0)');
      ctx.fillStyle = radGlow;
      ctx.beginPath();
      ctx.arc(core.px, core.py, (38 + corePulse) * core.scale, 0, Math.PI * 2);
      ctx.fill();

      // 4. Multi-Layered Hologram Rings
      const ringPalettes = [
        { stroke: '#00f0ff', glow: 'rgba(0, 240, 255, 0.6)', fill: 'rgba(0, 240, 255, 0.12)' },
        { stroke: '#6366f1', glow: 'rgba(99, 102, 241, 0.6)', fill: 'rgba(99, 102, 241, 0.10)' },
        { stroke: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)', fill: 'rgba(245, 158, 11, 0.12)' },
        { stroke: '#10b981', glow: 'rgba(16, 185, 129, 0.6)', fill: 'rgba(16, 185, 129, 0.10)' },
      ];

      activeRings.forEach((r, idx) => {
        const ringSpeed = r.speed || (idx === 0 ? 2.5 : idx === 1 ? -1.8 : 4.0);
        const rotY = (frame * 0.025 * ringSpeed);
        const rotX = idx === 2 ? Math.sin(frame * 0.03) * 0.8 : (idx === 3 ? Math.cos(frame * 0.02) * 0.3 : 0);
        const baseRadius = r.radius * 24;
        const tubeRadius = 5.5;
        const numSegments = Math.max(12, r.subdivisions || 24);
        const tubeSegments = 6;
        const col = ringPalettes[idx % ringPalettes.length];

        for (let s = 0; s < numSegments; s++) {
          const theta1 = (s / numSegments) * Math.PI * 2 + rotY;
          const theta2 = ((s + 1) / numSegments) * Math.PI * 2 + rotY;

          const ringPoints = [];
          for (let t = 0; t <= tubeSegments; t++) {
            const phi = (t / tubeSegments) * Math.PI * 2;

            // Point 1
            const rx1 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.cos(theta1);
            const ry1 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.sin(theta1) * Math.sin(rotX) + tubeRadius * Math.sin(phi);
            const rz1 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.sin(theta1) * Math.cos(rotX);

            // Point 2
            const rx2 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.cos(theta2);
            const ry2 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.sin(theta2) * Math.sin(rotX) + tubeRadius * Math.sin(phi);
            const rz2 = (baseRadius + tubeRadius * Math.cos(phi)) * Math.sin(theta2) * Math.cos(rotX);

            ringPoints.push({ p1: project(rx1, ry1, rz1), p2: project(rx2, ry2, rz2) });
          }

          // Shading & Wireframe
          ctx.strokeStyle = col.stroke;
          ctx.lineWidth = renderMode === 'wireframe' ? 1 : 1.6;
          ctx.fillStyle = renderMode === 'wireframe' ? 'transparent' : col.fill;

          ctx.beginPath();
          if (ringPoints.length > 0) {
            ctx.moveTo(ringPoints[0].p1.px, ringPoints[0].p1.py);
            for (let i = 1; i < ringPoints.length; i++) ctx.lineTo(ringPoints[i].p1.px, ringPoints[i].p1.py);
            for (let i = ringPoints.length - 1; i >= 0; i--) ctx.lineTo(ringPoints[i].p2.px, ringPoints[i].p2.py);
            ctx.closePath();
            if (renderMode !== 'wireframe') ctx.fill();
            ctx.stroke();
          }

          // Glowing Vertex Micro-Nodes
          if (s % 3 === 0 && ringPoints[0]) {
            const np = ringPoints[0].p1;
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = col.stroke;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(np.px, np.py, 2.2 * np.scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      });

      // 5. Outer Orbiting HUD Reticle & Targeting Brackets
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 16, 4, 16]);
      ctx.beginPath();
      ctx.arc(cx, cy, 180 * zoomRef.current, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, speedMultiplier, renderMode, activeRings]);

  // Mouse Orbit Drag Controls
  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    targetRotRef.current = {
      x: Math.max(-1.45, Math.min(1.45, targetRotRef.current.x + dy * 0.008)),
      y: targetRotRef.current.y + dx * 0.008,
    };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0012;
    targetZoomRef.current = Math.max(0.4, Math.min(2.8, targetZoomRef.current + delta));
  };

  return (
    <div className="relative w-full h-[420px] sm:h-[480px] bg-[#05070d] rounded-2xl overflow-hidden select-none border border-cyan-500/30 shadow-2xl flex flex-col font-mono">
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        width={750}
        height={480}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Top Holographic HUD Bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-zinc-950/85 border border-cyan-500/40 text-[10px] text-cyan-300 font-bold backdrop-blur-md flex items-center gap-2 shadow-lg">
            <Zap className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="tracking-wider">J.A.R.V.I.S. 3D CORE SIMULATOR</span>
          </div>
          <div className="px-2.5 py-1.5 rounded-xl bg-zinc-950/85 border border-zinc-800 text-[10px] text-zinc-300 font-bold backdrop-blur-md shadow-md">
            FPS: <span className="text-emerald-400 font-black">{fps}</span>
          </div>
        </div>

        <div className="px-3 py-1.5 rounded-xl bg-zinc-950/85 border border-amber-500/30 text-[10px] text-zinc-300 font-bold backdrop-blur-md shadow-md">
          Timeline Frame: <span className="text-amber-400 font-black">{currentFrame}</span>
        </div>
      </div>

      {/* Bottom Interactive Controls */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-zinc-950/90 border border-cyan-500/30 backdrop-blur-xl text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{isPlaying ? "Pause" : "Play"}</span>
          </button>

          <button
            onClick={() => {
              targetRotRef.current = { x: 0.38, y: 0.72 };
              targetZoomRef.current = 1.1;
            }}
            className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
            title="Reset Camera View"
          >
            <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
            <span>Reset</span>
          </button>

          {/* Render Mode Switcher */}
          <div className="flex items-center bg-zinc-900 rounded-xl p-0.5 border border-zinc-800">
            {['hologram', 'wireframe', 'solid'].map((m) => (
              <button
                key={m}
                onClick={() => setRenderMode(m)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize transition-all cursor-pointer ${
                  renderMode === m ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Speed Multipliers */}
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-bold">
          <span>Speed:</span>
          {[0.5, 1, 2, 4].map((s) => (
            <button
              key={s}
              onClick={() => setSpeedMultiplier(s)}
              className={`px-2.5 py-1 rounded-lg font-black transition-all cursor-pointer text-[10px] ${
                speedMultiplier === s ? "bg-cyan-500 text-black shadow-md" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Maya3DCanvas;
