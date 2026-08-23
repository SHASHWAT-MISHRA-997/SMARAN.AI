import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, X } from 'lucide-react';
import { GestureController, GESTURE_LEGEND, GESTURES } from '../utils/gestureControl';

/**
 * Gesture Mode — the Stark-workshop layer.
 *
 * A transparent glass overlay that draws the tracked hand as a constellation
 * of nodes and struts, with a reticle that follows the fingertip. Nothing here
 * blocks the app underneath: the canvas is pointer-transparent, so the UI keeps
 * working normally while the camera watches for a gesture.
 *
 * Frames are processed on this device and are never uploaded or stored.
 */

/** Bones, as pairs of MediaPipe landmark indices. */
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],            // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],            // index
  [5, 9], [9, 10], [10, 11], [11, 12],       // middle
  [9, 13], [13, 14], [14, 15], [15, 16],     // ring
  [13, 17], [17, 18], [18, 19], [19, 20],    // pinky
  [0, 17],                                    // palm edge
];

const ACCENT = '#38e8ff';
const ACCENT_SOFT = 'rgba(56, 232, 255, 0.55)';

const GestureHUD = ({ isOpen, onClose, onAction }) => {
  const canvasRef = useRef(null);
  const controllerRef = useRef(null);
  const handsRef = useRef([]);
  const frameRef = useRef(null);

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [lastGesture, setLastGesture] = useState(null);
  const [handCount, setHandCount] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);

  const handleGesture = useCallback((gesture) => {
    setLastGesture({ id: gesture, at: Date.now() });
    onAction?.(gesture);
  }, [onAction]);

  // Camera + recogniser lifecycle.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    const controller = new GestureController({
      onGesture: handleGesture,
      onHands: (hands) => {
        handsRef.current = hands;
        setHandCount(hands.length);
      },
      onStatus: (value) => { if (!cancelled) setStatus(value); },
      onError: (message) => { if (!cancelled) setError(message); },
    });
    controllerRef.current = controller;
    setError('');
    controller.start();

    return () => {
      cancelled = true;
      controller.stop();
      controllerRef.current = null;
      handsRef.current = [];
    };
  }, [isOpen, handleGesture]);

  // Drawing loop, separate from detection so the overlay stays smooth even
  // when a frame takes longer to process.
  useEffect(() => {
    if (!isOpen) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw);
      const width = window.innerWidth;
      const height = window.innerHeight;
      context.clearRect(0, 0, width, height);

      const hands = handsRef.current;
      if (!hands.length) return;

      const pulse = 0.6 + Math.sin(performance.now() / 320) * 0.4;

      hands.forEach((landmarks) => {
        // The camera is mirrored, so the overlay is mirrored to match what the
        // person sees themselves doing.
        const toScreen = (point) => ({
          x: (1 - point.x) * width,
          y: point.y * height,
        });
        const points = landmarks.map(toScreen);

        context.lineCap = 'round';
        context.strokeStyle = ACCENT_SOFT;
        context.lineWidth = 2;
        context.shadowColor = ACCENT;
        context.shadowBlur = 14;
        CONNECTIONS.forEach(([from, to]) => {
          context.beginPath();
          context.moveTo(points[from].x, points[from].y);
          context.lineTo(points[to].x, points[to].y);
          context.stroke();
        });

        context.shadowBlur = 10;
        points.forEach((point, index) => {
          const isTip = [4, 8, 12, 16, 20].includes(index);
          context.beginPath();
          context.arc(point.x, point.y, isTip ? 5 : 3, 0, Math.PI * 2);
          context.fillStyle = isTip ? ACCENT : 'rgba(160, 240, 255, 0.75)';
          context.fill();
        });

        // Reticle on the index fingertip: the Stark-workshop cursor.
        const tip = points[8];
        context.shadowBlur = 18;
        context.strokeStyle = ACCENT;
        context.lineWidth = 1.6;
        context.beginPath();
        context.arc(tip.x, tip.y, 22 + pulse * 6, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(tip.x, tip.y, 34 + pulse * 10, 0.4, 1.4);
        context.stroke();
        context.beginPath();
        context.arc(tip.x, tip.y, 34 + pulse * 10, 3.6, 4.6);
        context.stroke();
      });

      context.shadowBlur = 0;
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const activeLegend = GESTURE_LEGEND.find((item) => item.id === lastGesture?.id);
  const recent = lastGesture && Date.now() - lastGesture.at < 2200;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {/* Tracking canvas. Transparent and click-through by design. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Corner brackets, to frame the workspace like a heads-up display. */}
      <div className="absolute inset-x-4 top-[60px] bottom-[96px] sm:inset-x-6">
        {[
          'left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl',
          'right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl',
          'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-2xl',
          'right-0 bottom-0 border-r-2 border-b-2 rounded-br-2xl',
        ].map((position) => (
          <span
            key={position}
            className={`absolute h-10 w-10 border-cyan-300/45 ${position}`}
            style={{ boxShadow: '0 0 22px rgba(56,232,255,.22)' }}
          />
        ))}
      </div>

      {/* Status rail */}
      <div className="pointer-events-auto absolute left-1/2 top-[68px] w-[min(94vw,760px)] -translate-x-1/2 sm:top-[76px]">
        <div
          className="flex items-center gap-3 rounded-2xl border border-cyan-300/25 px-4 py-2.5 backdrop-blur-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(8,20,32,.55), rgba(6,12,22,.35))',
            boxShadow: '0 0 40px rgba(56,232,255,.14), inset 0 1px 0 rgba(255,255,255,.07)',
          }}
        >
          <Hand className={`h-4 w-4 shrink-0 text-cyan-300 ${status === 'running' ? 'animate-pulse' : ''}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200">
              Gesture Mode
            </p>
            <p className="truncate text-[10px] text-slate-400">
              {status === 'loading' && 'Loading the hand model…'}
              {status === 'loading-cpu' && 'Loading the hand model (CPU mode)…'}
              {status === 'camera' && 'Opening the camera…'}
              {status === 'running' && (handCount
                ? `${handCount} hand${handCount > 1 ? 's' : ''} tracked`
                : 'Hold a hand up to the camera')}
              {status === 'error' && (error || 'Gesture tracking is unavailable')}
              {status === 'idle' && 'Starting the camera…'}
            </p>
          </div>

          {recent && activeLegend && (
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-3 py-1">
              <span className="text-base leading-none">{activeLegend.glyph}</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-cyan-100 sm:inline">
                {activeLegend.action}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300"
            title="Leave gesture mode"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Legend. On a phone the full nine-item grid took four rows and covered
          the character, so there it collapses to the glyphs alone and opens on
          a tap. */}
      <div className="pointer-events-auto absolute bottom-[104px] left-1/2 w-[min(94vw,860px)] -translate-x-1/2 sm:bottom-[112px]">
        <div
          className="rounded-2xl border border-cyan-300/18 px-3 py-2.5 backdrop-blur-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(8,20,32,.5), rgba(6,12,22,.3))',
            boxShadow: '0 0 34px rgba(56,232,255,.1), inset 0 1px 0 rgba(255,255,255,.06)',
          }}
        >
          <div className="flex flex-wrap justify-center gap-1.5">
            {GESTURE_LEGEND.map((item) => {
              const isActive = recent && lastGesture.id === item.id;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-1.5 rounded-xl border px-2 py-1 transition-all ${
                    isActive
                      ? 'border-cyan-300/60 bg-cyan-400/15 scale-105'
                      : 'border-white/8 bg-white/[.03]'
                  }`}
                  title={item.action}
                >
                  <span className="text-sm leading-none">{item.glyph}</span>
                  <span
                    className={`text-[9px] font-medium ${isActive ? 'text-cyan-100' : 'text-slate-400'} ${
                      legendOpen ? '' : 'hidden sm:inline'
                    }`}
                  >
                    {item.action}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setLegendOpen((open) => !open)}
            className="mt-1.5 w-full text-center font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/70 transition hover:text-cyan-200 sm:hidden"
          >
            {legendOpen ? 'Hide names' : 'What do these do?'}
          </button>
        </div>
      </div>

      {error && status === 'error' && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 w-[min(90vw,420px)] -translate-x-1/2 -translate-y-1/2">
          <div
            className="rounded-2xl border border-amber-400/30 p-5 text-center backdrop-blur-2xl"
            style={{ background: 'rgba(30,20,6,.55)' }}
          >
            <p className="text-xs leading-relaxed text-amber-200">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export { GESTURES };
export default GestureHUD;
