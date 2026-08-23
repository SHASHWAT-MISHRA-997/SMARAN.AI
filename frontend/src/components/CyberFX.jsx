import React, { useEffect, useRef } from 'react';

/**
 * The atmosphere behind the voice workspace.
 *
 * One coherent scene rather than a pile of unrelated effects: a receding grid
 * floor, drifting motes, a slow scan sweep, corner brackets and a vignette,
 * all tuned to the same neon palette so they read as one place.
 *
 * Two rules kept it from becoming noise:
 *
 *   - Nothing here competes with the character. Everything sits behind her,
 *     at low opacity, and moves slowly.
 *   - It reacts. The grid brightens and the motes quicken while she speaks, so
 *     the room feels connected to the conversation instead of looping on its
 *     own.
 *
 * The particles are one canvas; everything else is composited CSS, so the
 * whole layer costs almost nothing next to the 3D character already running.
 */

const CyberFX = ({ intensity = 0, active = false, hue = 'red' }) => {
  const canvasRef = useRef(null);
  const intensityRef = useRef(0);

  useEffect(() => { intensityRef.current = intensity; }, [intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const context = canvas.getContext('2d');
    let frame = null;
    let motes = [];

    const palette = hue === 'red'
      ? ['239,68,68', '248,113,113', '255,255,255']
      : ['34,211,238', '167,139,250', '255,255,255'];

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = canvas.parentElement;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      // Density scales with area so a large window is not sparse and a small
      // one is not soup.
      const count = Math.round((w * h) / 26000);
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        drift: 0.06 + Math.random() * 0.22,
        sway: Math.random() * Math.PI * 2,
        tone: palette[Math.floor(Math.random() * palette.length)],
        alpha: 0.15 + Math.random() * 0.45,
      }));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      context.clearRect(0, 0, w, h);

      // Speech makes them rise a little faster and glow a little brighter.
      const lift = 1 + intensityRef.current * 1.8;
      const now = performance.now() / 1000;

      motes.forEach((mote) => {
        mote.y -= mote.drift * lift;
        if (mote.y < -6) {
          mote.y = h + 6;
          mote.x = Math.random() * w;
        }
        const x = mote.x + Math.sin(now * 0.4 + mote.sway) * 9;
        const alpha = mote.alpha * (0.65 + intensityRef.current * 0.5);
        context.beginPath();
        context.arc(x, mote.y, mote.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(${mote.tone},${Math.min(1, alpha)})`;
        context.fill();
      });
    };
    draw();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hue]);

  const glow = hue === 'red' ? 'rgba(239,68,68' : 'rgba(34,211,238';

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Receding grid floor. The perspective transform is what makes a flat
          repeating gradient read as a room. */}
      <div
        className="cyberfx-grid absolute inset-x-[-40%] bottom-0 h-[46%]"
        style={{ '--fx-glow': `${glow},.30)`, opacity: 0.35 + intensity * 0.35 }}
      />

      {/* Drifting motes. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* A slow bar of light crossing the scene. */}
      <div className="cyberfx-scan absolute inset-x-0 h-[38%]" style={{ '--fx-glow': `${glow},.07)` }} />

      {/* Fine horizontal lines, the CRT tell. Very low contrast on purpose. */}
      <div className="cyberfx-lines absolute inset-0" />

      {/* Corner brackets, brighter while the call is live. */}
      <div className="absolute inset-3 sm:inset-5">
        {[
          'left-0 top-0 border-l-2 border-t-2 rounded-tl-xl',
          'right-0 top-0 border-r-2 border-t-2 rounded-tr-xl',
          'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-xl',
          'right-0 bottom-0 border-r-2 border-b-2 rounded-br-xl',
        ].map((corner) => (
          <span
            key={corner}
            className={`absolute h-8 w-8 transition-all duration-700 ${corner}`}
            style={{
              borderColor: `${glow},${active ? 0.45 : 0.18})`,
              boxShadow: active ? `0 0 18px ${glow},.22)` : 'none',
            }}
          />
        ))}
      </div>

      {/* Vignette last, so everything above falls off toward the edges. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,.72)_100%)]" />
    </div>
  );
};

export default CyberFX;
