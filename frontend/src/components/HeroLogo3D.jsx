import React, { useEffect, useRef, useState } from 'react';

/**
 * The 3D hero: an animated logo mark and a dimensional wordmark.
 *
 * Built with CSS 3D transforms rather than a WebGL canvas. That is a
 * deliberate choice: this sits on the empty-chat screen of an app that also
 * runs a 3D character, an audio graph and hand tracking, so the opening screen
 * should not claim a GPU context of its own. Transforms and filters are
 * composited on the GPU anyway, they stay crisp at any resolution, the text
 * remains real selectable text, and it costs nothing on a phone.
 *
 * Layers, front to back:
 *   - orbiting rings on separate 3D planes
 *   - a glass core that tumbles slowly
 *   - energy arcs that strike at irregular intervals
 *   - a bloom that breathes underneath everything
 */

/** Letters are animated individually so the wordmark can assemble itself. */
const WORD = [
  ...'SMARAN'.split('').map((char) => ({ char, tone: 'warm' })),
  { char: ' ', tone: 'space' },
  ...'.AI'.split('').map((char) => ({ char, tone: 'cool' })),
];

const TAGLINE = 'Meet SMARAN.AI, your personal AI assistant.';

const HeroLogo3D = () => {
  const rootRef = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [struck, setStruck] = useState(false);

  // The whole assembly leans toward the pointer, which is what sells the
  // depth: without parallax a CSS 3D scene reads as a flat picture.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    if (window.matchMedia('(pointer: coarse)').matches) return undefined;

    const onMove = (event) => {
      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      setTilt({ x: Math.max(-1, Math.min(1, py)) * -14, y: Math.max(-1, Math.min(1, px)) * 18 });
    };
    const onLeave = () => setTilt({ x: 0, y: 0 });

    window.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Lightning at uneven intervals; a fixed rhythm looks mechanical.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let timer;
    const strike = () => {
      setStruck(true);
      window.setTimeout(() => setStruck(false), 260);
      timer = window.setTimeout(strike, 3200 + Math.random() * 5200);
    };
    timer = window.setTimeout(strike, 1800 + Math.random() * 2600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      ref={rootRef}
      className="hero3d flex w-full flex-col items-center gap-4 sm:gap-6"
      style={{ perspective: '1100px' }}
    >
      {/* ── Logo mark ── */}
      <div
        className="hero3d-stage relative h-24 w-24 sm:h-32 sm:w-32"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        }}
      >
        {/* Bloom */}
        <div className="hero3d-bloom absolute inset-[-40%] rounded-full" aria-hidden="true" />

        {/* Orbiting rings, each on its own plane */}
        <div className="hero3d-ring hero3d-ring-a absolute inset-0 rounded-full" aria-hidden="true" />
        <div className="hero3d-ring hero3d-ring-b absolute inset-[8%] rounded-full" aria-hidden="true" />
        <div className="hero3d-ring hero3d-ring-c absolute inset-[16%] rounded-full" aria-hidden="true" />

        {/* Glass core */}
        <div className="hero3d-core absolute inset-[14%] rounded-[26%]" style={{ transformStyle: 'preserve-3d' }}>
          <div className="hero3d-core-face absolute inset-0 rounded-[26%] backdrop-blur-sm">
            {/* An angular S monogram, drawn as vector so it stays razor sharp
                at any size. The bitmap logo went muddy once it was scaled into
                this tile, which is what made the mark look cheap. */}
            <svg viewBox="0 0 100 100" className="hero3d-mark h-full w-full p-[16%]" aria-hidden="true">
              <defs>
                <linearGradient id="smaranRed" x1="0" y1="0" x2="0.65" y2="1">
                  <stop offset="0%" stopColor="#ff6b6b" />
                  <stop offset="35%" stopColor="#ef4444" />
                  <stop offset="70%" stopColor="#b91c1c" />
                  <stop offset="100%" stopColor="#7f1d1d" />
                </linearGradient>
                <linearGradient id="smaranEdge" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fecaca" stopOpacity="0.95" />
                  <stop offset="50%" stopColor="#ef4444" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#450a0a" stopOpacity="0.9" />
                </linearGradient>
              </defs>

              {/* Extruded depth: the same silhouette offset behind the face. */}
              <g transform="translate(3.5,4)">
                <path
                  d="M72 26c-5-7-13-11-23-11-12 0-20 6-20 15 0 8 6 12 19 15l8 2c16 4 24 11 24 24 0
                     16-14 26-33 26-12 0-23-4-30-12l9-11c6 7 14 10 22 10 11 0 18-5 18-13 0-7-5-11-18-14l-9-2
                     C24 51 16 44 16 31 16 15 29 5 48 5c12 0 22 4 29 12z"
                  fill="#450a0a"
                  opacity="0.85"
                />
              </g>

              {/* Face */}
              <path
                d="M72 26c-5-7-13-11-23-11-12 0-20 6-20 15 0 8 6 12 19 15l8 2c16 4 24 11 24 24 0
                   16-14 26-33 26-12 0-23-4-30-12l9-11c6 7 14 10 22 10 11 0 18-5 18-13 0-7-5-11-18-14l-9-2
                   C24 51 16 44 16 31 16 15 29 5 48 5c12 0 22 4 29 12z"
                fill="url(#smaranRed)"
                stroke="url(#smaranEdge)"
                strokeWidth="1.6"
              />

              {/* A single travelling highlight, so the metal reads as curved. */}
              <path
                d="M72 26c-5-7-13-11-23-11-12 0-20 6-20 15 0 8 6 12 19 15"
                fill="none"
                stroke="#fee2e2"
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity="0.55"
                className="hero3d-mark-spec"
              />
            </svg>
          </div>
          {/* A second face behind, so the tumble shows real thickness. */}
          <div className="hero3d-core-back absolute inset-0 rounded-[26%]" aria-hidden="true" />
        </div>

        {/* Energy arcs */}
        <div className={`hero3d-arcs absolute inset-[-18%] ${struck ? 'is-struck' : ''}`} aria-hidden="true">
          <span className="hero3d-arc hero3d-arc-1" />
          <span className="hero3d-arc hero3d-arc-2" />
          <span className="hero3d-arc hero3d-arc-3" />
        </div>
      </div>

      {/* ── Wordmark ── */}
      <div className="hero3d-wordwrap relative space-y-2 sm:space-y-3" style={{ perspective: '800px' }}>
        {/* A soft aura rather than a panel: the light should look like it
            comes off the letters, not like a card behind them. */}
        <span className="hero3d-aura" aria-hidden="true" />
        {/* Electric arcs that cross the wordmark when the mark is struck. */}
        <span className={`hero3d-bolts ${struck ? 'is-struck' : ''}`} aria-hidden="true">
          <i className="hero3d-bolt hero3d-bolt-1" />
          <i className="hero3d-bolt hero3d-bolt-2" />
        </span>
        <h1
          className="hero3d-word relative text-3xl font-black tracking-tight sm:text-4xl md:text-5xl"
          style={{ transformStyle: 'preserve-3d', transform: `rotateX(${tilt.x * 0.35}deg) rotateY(${tilt.y * 0.35}deg)` }}
        >
          {/* The visible text is per-letter for the animation; the accessible
              name is set once so a screen reader hears one word, not ten. */}
          <span className="sr-only">SMARAN.AI</span>
          <span aria-hidden="true" className="inline-flex">
            {WORD.map((item, index) => (
              <span
                key={`${item.char}-${index}`}
                className={`hero3d-letter hero3d-letter-${item.tone}`}
                // The blurred glow behind each glyph is drawn from this
                // attribute, so the visible letter itself stays sharp.
                data-char={item.char}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                {item.char === ' ' ? ' ' : item.char}
              </span>
            ))}
          </span>
          <span className="hero3d-sheen" aria-hidden="true" />
        </h1>

        <p className="hero3d-tagline mx-auto max-w-md text-sm font-semibold leading-relaxed text-zinc-600 dark:text-zinc-400">
          <span className="sr-only">{TAGLINE}</span>
          <span aria-hidden="true">
            {TAGLINE.split(' ').map((word, index) => (
              <span
                key={`${word}-${index}`}
                className="hero3d-tagword"
                style={{ animationDelay: `${700 + index * 55}ms` }}
              >
                {word}
                {' '}
              </span>
            ))}
          </span>
        </p>
      </div>
    </div>
  );
};

export default HeroLogo3D;
