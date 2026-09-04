import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, MessageCircle, X, ChevronRight } from 'lucide-react';

const STATES = {
  idle: { row: 0, frames: 6, speed: 420 },
  'running-right': { row: 1, frames: 8, speed: 100 },
  'running-left': { row: 2, frames: 8, speed: 100 },
  waving: { row: 3, frames: 4, speed: 170 },
  jumping: { row: 4, frames: 5, speed: 150 },
  failed: { row: 5, frames: 8, speed: 180 },
  waiting: { row: 6, frames: 6, speed: 350 },
  running: { row: 7, frames: 6, speed: 180 },
  typing: { row: 7, frames: 6, speed: 115 },
  review: { row: 8, frames: 6, speed: 260 },
};

export const PET_FORMS = {
  smaru: { name: 'Smaru', description: 'The cute cyber companion with glowing eyes and lively reactions.', kind: 'cyber' },
  fennec: { name: 'Fennec', description: 'A playful cheerful fox with twitching ears & glowing eyes.', kind: 'fox' },
  hoots: { name: 'Hoots', description: 'A friendly owl that blinks and winks cheerfully.', kind: 'owl' },
  dewey: { name: 'Dewey', description: 'A happy floating cloud that glows and sparkles.', kind: 'cloud' },
  sprout: { name: 'Sprout', description: 'A cheerful dancing cactus with blooming flowers.', kind: 'cactus' },
  bloop: { name: 'Bloop', description: 'A cute joyful jelly creature that bobs and smiles.', kind: 'jelly' },
  pixel: { name: 'Pixel', description: 'A retro friendly robot with glowing neon expressive visor.', kind: 'bot' },
  comet: { name: 'Comet', description: 'A shining star buddy with twinkling cosmic eyes.', kind: 'star' },
  nori: { name: 'Nori', description: 'A fluffy cheerful cat that winks and purrs happily.', kind: 'cat' },
  buzz: { name: 'Buzz', description: 'A friendly little honeybee with fluttering wings.', kind: 'bee' },
  pebble: { name: 'Pebble', description: 'A cute gentle stone friend with sparkling gemstone eyes.', kind: 'rock' },
};

/**
 * Highly expressive animated SVG avatar with natural blinking, talking mouth,
 * blushing cheeks, and lively emotional facial expressions.
 */
export const PetAvatar = ({ pet = 'smaru', size = 56, activity = 'idle', className = '' }) => {
  const kind = PET_FORMS[pet]?.kind || 'cyber';
  const isTalking = activity === 'typing' || activity === 'running' || activity === 'review';
  const isJoyful = activity === 'waving' || activity === 'jumping';
  const isThinking = activity === 'waiting';

  /* The face, decided in one place from what the app is doing.
   *
   * Before this there were three booleans and two of them only changed the
   * mouth, so the companion had one expression: eyes that blinked, and a
   * line that wobbled while text arrived. Thinking looked like idling, and
   * a failed run looked like a good one.
   *
   * The states are real ones the app already dispatches - running, typing,
   * waiting, waving, failed, review - so each of these is a face for a thing
   * that is actually happening, not decoration on a timer. */
  const FACES = {
    idle:    { eyes: 'round',  brow: 'none',  mouth: 'smile',  blush: false },
    typing:  { eyes: 'focus',  brow: 'flat',  mouth: 'talk',   blush: false },
    running: { eyes: 'focus',  brow: 'flat',  mouth: 'talk',   blush: false },
    review:  { eyes: 'curious',brow: 'one',   mouth: 'small',  blush: false },
    waiting: { eyes: 'up',     brow: 'raise', mouth: 'small',  blush: false },
    waving:  { eyes: 'happy',  brow: 'none',  mouth: 'open',   blush: true  },
    jumping: { eyes: 'happy',  brow: 'none',  mouth: 'open',   blush: true  },
    failed:  { eyes: 'sad',    brow: 'worry', mouth: 'frown',  blush: false },
  };
  const face = FACES[activity] || FACES.idle;

  const common = {
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    className: `block shrink-0 drop-shadow-md select-none ${className}`,
    'aria-hidden': true,
  };

  /* Eyes that change shape, not only blink.
   *
   * Blinking alone reads as alive but never as feeling anything. The shape is
   * what carries the expression: an arc for pleased, a narrowed lid for
   * concentrating, a lowered one for a failure. The blink still runs
   * underneath every shape that has a lid to close. */
  const Eyes = ({ cx1 = 24, cx2 = 40, cy = 30, r = 3.5, color = '#0f172a', shape = 'round' }) => {
    const blink = (
      <animate attributeName="ry" values={`${r};${r};${r};0.3;${r}`}
        keyTimes="0;0.85;0.9;0.95;1" dur="3.2s" repeatCount="indefinite" />
    );

    // Pleased: a closed upward arc, the way a smile reaches the eyes.
    if (shape === 'happy') {
      return (
        <g className="pet-eyes" stroke={color} strokeWidth="1.9" fill="none" strokeLinecap="round">
          <path d={`M ${cx1 - r} ${cy + 1} Q ${cx1} ${cy - r} ${cx1 + r} ${cy + 1}`} />
          <path d={`M ${cx2 - r} ${cy + 1} Q ${cx2} ${cy - r} ${cx2 + r} ${cy + 1}`} />
        </g>
      );
    }

    // Downcast: the lid low and the eye small. Nothing else says "that did not
    // work" without a word.
    if (shape === 'sad') {
      return (
        <g className="pet-eyes">
          <ellipse cx={cx1} cy={cy + 1} rx={r * 0.85} ry={r * 0.55} fill={color} />
          <ellipse cx={cx2} cy={cy + 1} rx={r * 0.85} ry={r * 0.55} fill={color} />
        </g>
      );
    }

    const ry = shape === 'focus' ? r * 0.62 : r;      // concentrating: narrowed
    const shiftX = shape === 'up' ? 1.4 : 0;          // thinking: looking away
    const shiftY = shape === 'up' ? -1.2 : 0;
    const wide = shape === 'curious' ? 1.15 : 1;      // curious: one eye wider

    return (
      <g className="pet-eyes">
        <ellipse cx={cx1} cy={cy} rx={r} ry={ry} fill={color}>{blink}</ellipse>
        <circle cx={cx1 + 1 + shiftX} cy={cy - 1 + shiftY} r={r * 0.4} fill="#ffffff" />
        <ellipse cx={cx2} cy={cy} rx={r * wide} ry={ry * wide} fill={color}>{blink}</ellipse>
        <circle cx={cx2 + 1 + shiftX} cy={cy - 1 + shiftY} r={r * 0.4} fill="#ffffff" />
      </g>
    );
  };

  /* Brows. Small marks, and most of what a face means.
   * "one" raises a single brow, which is the whole of looking sceptical. */
  const Brows = ({ cx1 = 24, cx2 = 40, cy = 24, color = '#0f172a', shape = 'none' }) => {
    if (shape === 'none') return null;
    const line = (x, dy, tilt) => (
      <path d={`M ${x - 3.4} ${cy + dy + tilt} L ${x + 3.4} ${cy + dy - tilt}`}
        stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" />
    );
    if (shape === 'raise') return <g>{line(cx1, -1.6, 0)}{line(cx2, -1.6, 0)}</g>;
    if (shape === 'one') return <g>{line(cx1, 0, 0)}{line(cx2, -2.2, 0.6)}</g>;
    if (shape === 'worry') return <g>{line(cx1, 0, -1.5)}{line(cx2, 0, 1.5)}</g>;
    return <g>{line(cx1, 0, 0)}{line(cx2, 0, 0)}</g>;
  };

  // Reusable Rosy Blushing Cheeks
  const Cheeks = ({ cx1 = 18, cx2 = 46, cy = 34, r = 3, fill = '#fb7185' }) => (
    <g opacity="0.65">
      <circle cx={cx1} cy={cy} r={r} fill={fill} />
      <circle cx={cx2} cy={cy} r={r} fill={fill} />
    </g>
  );

  /* The mouth, one shape per expression.
   *
   * It had three: a talking wobble, a joyful open one, and a smile. Which
   * meant thinking and failing and reviewing all wore the same smile. */
  const Mouth = ({ cx = 32, cy = 38, stroke = '#0f172a', shape = 'smile' }) => {
    if (shape === 'open') {
      return <path d={`M ${cx - 4} ${cy - 1} Q ${cx} ${cy + 5} ${cx + 4} ${cy - 1} Z`}
        fill="#ef4444" stroke={stroke} strokeWidth="1.2" />;
    }
    if (shape === 'talk') {
      return (
        <ellipse cx={cx} cy={cy + 1} rx="3" ry="2.5" fill="#e11d48">
          <animate attributeName="ry" values="1;3.5;1.5;3;1" dur="0.32s" repeatCount="indefinite" />
        </ellipse>
      );
    }
    // Frowning: the same arc as the smile, turned over.
    if (shape === 'frown') {
      return <path d={`M ${cx - 4} ${cy + 2} Q ${cx} ${cy - 2} ${cx + 4} ${cy + 2}`}
        stroke={stroke} strokeWidth="1.8" fill="none" strokeLinecap="round" />;
    }
    // Small and closed - listening, or waiting on somebody.
    if (shape === 'small') {
      return <ellipse cx={cx} cy={cy} rx="1.8" ry="1.6" fill="none"
        stroke={stroke} strokeWidth="1.5" />;
    }
    return <path d={`M ${cx - 4} ${cy} Q ${cx} ${cy + 3.5} ${cx + 4} ${cy}`}
      stroke={stroke} strokeWidth="1.8" fill="none" strokeLinecap="round" />;
  };

  const wrapFrame = (children) => (
    <svg {...common}>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={isTalking ? '0 1.5; 0 -1.5; 0 1.5' : isJoyful ? '0 -3; 0 1; 0 -3' : '0 1; 0 -1; 0 1'}
          dur={isTalking ? '0.35s' : isJoyful ? '0.6s' : '2.4s'}
          repeatCount="indefinite"
        />
        {children}
      </g>
    </svg>
  );

  // Cyber Smaru Robot
  if (kind === 'cyber' || pet === 'smaru') {
    return wrapFrame(
      <>
        {/* Antenna */}
        <line x1="32" y1="12" x2="32" y2="18" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="11" r="3" fill="#a855f7">
          <animate attributeName="fill" values="#a855f7;#38bdf8;#a855f7" dur="1.5s" repeatCount="indefinite" />
        </circle>
        {/* Head */}
        <rect x="15" y="18" width="34" height="28" rx="10" fill="#1e1b4b" stroke="#818cf8" strokeWidth="2" />
        {/* Visor Screen */}
        <rect x="19" y="23" width="26" height="18" rx="6" fill="#030712" />
        {/* The visor is this one's face, so the expression is drawn on it.
            It had two glowing dots that blinked and a line that wobbled while
            text arrived - alive, but never anything in particular. */}
        <Eyes cx1={26} cx2={38} cy={30} r={3.5} color="#38bdf8" shape={face.eyes} />
        <Brows cx1={26} cx2={38} cy={24} color="#38bdf8" shape={face.brow} />
        <Mouth cx={32} cy={36} stroke="#38bdf8" shape={face.mouth} />
        {face.blush && <Cheeks cx1="22" cx2="42" cy={33} r={2} fill="#38bdf8" />}
        {/* Body & Arms */}
        <rect x="22" y="47" width="20" height="9" rx="4" fill="#312e81" />
        <circle cx="32" cy="51" r="2" fill="#22d3ee" />
      </>
    );
  }

  // Fennec Fox
  if (kind === 'fox') {
    return wrapFrame(
      <>
        {/* Big Ears */}
        <polygon points="12,28 17,9 28,21" fill="#f97316" />
        <polygon points="16,25 19,13 25,21" fill="#fed7aa" />
        <polygon points="52,28 47,9 36,21" fill="#f97316" />
        <polygon points="48,25 45,13 39,21" fill="#fed7aa" />
        {/* Head */}
        <path d="M15 28 Q32 18 49 28 Q53 45 32 50 Q11 45 15 28 Z" fill="#ea580c" />
        {/* White Muzzle */}
        <path d="M22 36 Q32 48 42 36 Q38 49 32 50 Q26 49 22 36 Z" fill="#fff7ed" />
        <Eyes cx1={24} cx2={40} cy={31} r={3.2} color="#1c1917" shape={face.eyes} />
        <Cheeks cx1={19} cx2={45} cy={35} r={2.8} fill="#f43f5e" />
        {/* Nose & Mouth */}
        <circle cx="32" cy="40" r="2" fill="#1c1917" />
        <Mouth cx={32} cy={44} shape={face.mouth} stroke="#1c1917" />
      </>
    );
  }

  // Hoots Owl
  if (kind === 'owl') {
    return wrapFrame(
      <>
        {/* Body */}
        <ellipse cx="32" cy="35" rx="20" ry="22" fill="#d97706" />
        {/* Feather Tufts */}
        <polygon points="14,22 18,9 27,20" fill="#b45309" />
        <polygon points="50,22 46,9 37,20" fill="#b45309" />
        {/* Big Owl Eye Rings */}
        <circle cx="23" cy="30" r="9" fill="#ffffff" stroke="#fde68a" strokeWidth="1.5" />
        <circle cx="41" cy="30" r="9" fill="#ffffff" stroke="#fde68a" strokeWidth="1.5" />
        <Eyes cx1={23} cx2={41} cy={30} r={4} color="#1e1b4b" shape={face.eyes} />
        <Cheeks cx1={16} cx2={48} cy={37} r={2.5} fill="#f43f5e" />
        {/* Beak */}
        <polygon points="29,36 35,36 32,41" fill="#f59e0b" />
        {/* Tummy spots */}
        <path d="M 28 46 Q 32 49 36 46" stroke="#92400e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </>
    );
  }

  // Dewey Cloud
  if (kind === 'cloud') {
    return wrapFrame(
      <>
        <path d="M16 42 C10 42 7 34 12 28 C10 20 20 14 26 19 C31 11 44 12 47 21 C54 20 58 27 55 35 C58 41 53 47 46 47 L19 47 C14 47 12 44 16 42 Z" fill="#bae6fd" stroke="#38bdf8" strokeWidth="1.5" />
        <Eyes cx1={24} cx2={40} cy={30} r={3.2} color="#0369a1" shape={face.eyes} />
        <Cheeks cx1={18} cx2={46} cy={34} r={3} fill="#f472b6" />
        <Mouth cx={32} cy={36} shape={face.mouth} stroke="#0369a1" />
      </>
    );
  }

  // Sprout Cactus
  if (kind === 'cactus') {
    return wrapFrame(
      <>
        {/* Pot */}
        <polygon points="22,46 42,46 39,57 25,57" fill="#ea580c" />
        <rect x="20" y="44" width="24" height="4" rx="2" fill="#c2410c" />
        {/* Cactus Body */}
        <rect x="23" y="16" width="18" height="30" rx="9" fill="#22c55e" stroke="#15803d" strokeWidth="1.5" />
        {/* Arms */}
        <path d="M 23 28 L 15 28 L 15 22" stroke="#22c55e" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 41 32 L 49 32 L 49 26" stroke="#22c55e" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Blossom */}
        <circle cx="32" cy="14" r="3.5" fill="#f43f5e" />
        <Eyes cx1={28} cx2={36} cy={27} r={2.5} color="#064e3b" shape={face.eyes} />
        <Cheeks cx1={25} cx2={39} cy={31} r={1.8} fill="#fda4af" />
        <Mouth cx={32} cy={33} shape={face.mouth} stroke="#064e3b" />
      </>
    );
  }

  // Bloop Jelly
  if (kind === 'jelly') {
    return wrapFrame(
      <>
        {/* Bell Body */}
        <path d="M 14 36 C 14 18 50 18 50 36 C 50 42 45 44 41 40 C 37 44 33 44 32 40 C 31 44 27 44 23 40 C 19 44 14 42 14 36 Z" fill="#c084fc" stroke="#9333ea" strokeWidth="1.5" />
        <Eyes cx1={25} cx2={39} cy={29} r={3.2} color="#3b0764" shape={face.eyes} />
        <Cheeks cx1={19} cx2={45} cy={33} r={2.8} fill="#f472b6" />
        <Mouth cx={32} cy={34} shape={face.mouth} stroke="#3b0764" />
        {/* Floating Sparkles */}
        <circle cx="21" cy="22" r="1.5" fill="#ffffff" opacity="0.8" />
        <circle cx="43" cy="23" r="1" fill="#ffffff" opacity="0.8" />
      </>
    );
  }

  // Pixel Bot
  if (kind === 'bot') {
    return wrapFrame(
      <>
        <rect x="14" y="16" width="36" height="30" rx="8" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
        <circle cx="32" cy="11" r="3" fill="#06b6d4" />
        <line x1="32" y1="11" x2="32" y2="16" stroke="#94a3b8" strokeWidth="2" />
        <rect x="19" y="22" width="26" height="18" rx="4" fill="#0f172a" />
        <Eyes cx1={25} cx2={39} cy={30} r={3.5} color="#22d3ee" shape={face.eyes} />
        <Mouth cx={32} cy={36} shape={face.mouth} stroke="#22d3ee" />
      </>
    );
  }

  // Comet Star
  if (kind === 'star') {
    return wrapFrame(
      <>
        <polygon points="32,8 38,23 54,23 41,33 46,48 32,38 18,48 23,33 10,23 26,23" fill="#facc15" stroke="#eab308" strokeWidth="1.5" strokeLinejoin="round" />
        <Eyes cx1={26} cx2={38} cy={28} r={2.8} color="#713f12" shape={face.eyes} />
        <Cheeks cx1={21} cx2={43} cy={32} r={2.2} fill="#fb923c" />
        <Mouth cx={32} cy={33} shape={face.mouth} stroke="#713f12" />
      </>
    );
  }

  // Nori Cat
  if (kind === 'cat') {
    return wrapFrame(
      <>
        {/* Ears */}
        <polygon points="15,26 19,10 29,20" fill="#f472b6" />
        <polygon points="18,24 20,14 26,20" fill="#fdf2f8" />
        <polygon points="49,26 45,10 35,20" fill="#f472b6" />
        <polygon points="46,24 44,14 38,20" fill="#fdf2f8" />
        {/* Head */}
        <ellipse cx="32" cy="34" rx="18" ry="16" fill="#f472b6" />
        <Eyes cx1={24} cx2={40} cy={31} r={3.2} color="#831843" shape={face.eyes} />
        <Cheeks cx1={18} cx2={46} cy={36} r={2.8} fill="#fda4af" />
        {/* Nose & Whiskers */}
        <polygon points="30,36 34,36 32,38" fill="#be185d" />
        <line x1="12" y1="35" x2="22" y2="36" stroke="#db2777" strokeWidth="1.2" />
        <line x1="12" y1="39" x2="22" y2="38" stroke="#db2777" strokeWidth="1.2" />
        <line x1="52" y1="35" x2="42" y2="36" stroke="#db2777" strokeWidth="1.2" />
        <line x1="52" y1="39" x2="42" y2="38" stroke="#db2777" strokeWidth="1.2" />
        <Mouth cx={32} cy={40} shape={face.mouth} stroke="#831843" />
      </>
    );
  }

  // Default fallback
  return wrapFrame(
    <>
      <circle cx="32" cy="32" r="20" fill="#818cf8" />
      <Eyes cx1={25} cx2={39} cy={29} r={3.5} color="#1e1b4b" shape={face.eyes} />
      <Cheeks cx1={19} cx2={45} cy={34} r={3} fill="#f472b6" />
      <Mouth cx={32} cy={36} shape={face.mouth} stroke="#1e1b4b" />
    </>
  );
};

const labelFor = (state) => ({
  idle: 'SMARAN AI is ready!',
  typing: 'Listening to your idea…',
  running: 'Crafting response…',
  review: 'Ready with insights!',
  waiting: 'Awaiting your direction',
  waving: 'Glad to assist you!',
  jumping: 'Super excited!',
  failed: 'Let me try that again'
}[state] || 'SMARAN AI Companion');

const DesktopPet = () => {
  const [visible, setVisible] = useState(() => localStorage.getItem('sm_pet_visible') !== 'false');
  const [pet, setPet] = useState(() => {
    const saved = localStorage.getItem('sm_pet_type');
    return PET_FORMS[saved] ? saved : 'smaru';
  });
  const [size, setSize] = useState(() => Number(localStorage.getItem('sm_pet_size') || 76));
  const [state, setState] = useState('idle');
  const [showMessage, setShowMessage] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const update = (event) => {
      if (typeof event.detail?.visible === 'boolean') setVisible(event.detail.visible);
      if (event.detail?.pet && PET_FORMS[event.detail.pet]) setPet(event.detail.pet);
      if (Number.isFinite(event.detail?.size)) setSize(event.detail.size);
    };
    const react = (event) => {
      const next = STATES[event.detail?.state] ? event.detail.state : 'idle';
      setState(next);
      setShowMessage(Boolean(event.detail?.message));
      if (next !== 'idle' && next !== 'typing' && next !== 'running' && next !== 'review' && next !== 'waiting') {
        window.setTimeout(() => setState('idle'), 2400);
      }
    };
    window.addEventListener('smaran:pet-change', update);
    window.addEventListener('smaran:pet-state', react);
    return () => {
      window.removeEventListener('smaran:pet-change', update);
      window.removeEventListener('smaran:pet-state', react);
    };
  }, []);

  if (!visible || !PET_FORMS[pet]) return null;

  return (
    <aside
      aria-label="Desktop AI Companion"
      className="sm-pet fixed z-30 flex flex-col items-end pointer-events-none transition-all duration-300"
    >
      {/* Interactive Floating speech bubble */}
      {showMessage && !minimized && (
        <div className="pointer-events-auto mb-2 max-w-[240px] animate-bounce rounded-2xl border border-indigo-500/40 bg-zinc-900/95 backdrop-blur-md px-3.5 py-2 text-center text-[11px] font-bold text-zinc-100 shadow-[0_8px_30px_rgba(99,102,241,0.25)] flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
          <span className="flex-1 leading-snug">{labelFor(state)}</span>
          <button
            type="button"
            onClick={() => setShowMessage(false)}
            className="text-zinc-400 hover:text-white p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Companion Quick Switcher Dropdown */}
      {showPicker && (
        <div className="pointer-events-auto mb-2 p-2 rounded-2xl border border-zinc-700/80 bg-zinc-950/95 backdrop-blur-xl shadow-2xl w-56 flex flex-col gap-1 z-50">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-black text-indigo-400 uppercase tracking-wider">
            <span>Choose Companion</span>
            <button onClick={() => setShowPicker(false)} className="text-zinc-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-1 pr-1">
            {Object.entries(PET_FORMS).map(([id, info]) => (
              <button
                key={id}
                onClick={() => {
                  setPet(id);
                  localStorage.setItem('sm_pet_type', id);
                  setShowPicker(false);
                  setState('waving');
                  setShowMessage(true);
                }}
                className={`flex items-center gap-1.5 p-1.5 rounded-xl text-left text-xs font-semibold transition ${
                  pet === id ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/50' : 'hover:bg-zinc-800/80 text-zinc-300'
                }`}
              >
                <PetAvatar pet={id} size={22} />
                <span className="truncate">{info.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Companion Button Capsule */}
      <div className="pointer-events-auto relative group flex items-center">
        {/* Companion Avatar */}
        <button
          type="button"
          aria-label={`${PET_FORMS[pet]?.name || 'Smaru'}, your animated SMARAN companion`}
          title={`Click to wave! Double click to switch companion (${PET_FORMS[pet]?.name})`}
          onClick={() => {
            setState((prev) => (prev === 'waving' ? 'idle' : 'waving'));
            setShowMessage(true);
          }}
          /* The tooltip promised this and nothing implemented it.
             There was no onDoubleClick at all, so the sentence under the
             companion described a feature that did not exist. */
          onDoubleClick={(event) => {
            event.preventDefault();
            const ids = Object.keys(PET_FORMS);
            const next = ids[(ids.indexOf(pet) + 1) % ids.length];
            setPet(next);
            // Remembered, the same way the picker remembers it - otherwise the
            // companion would change and then change back on the next start.
            localStorage.setItem('sm_pet_type', next);
            setState('jumping');
            setShowMessage(true);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setShowPicker((v) => !v);
          }}
          className="group relative border-0 bg-transparent p-0 cursor-pointer transform hover:scale-110 active:scale-95 transition-all duration-200 focus:outline-none"
        >
          <PetAvatar pet={pet} size={minimized ? 36 : size} activity={state} />
        </button>

        {/* Hover mini menu */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute -top-8 right-0 flex items-center gap-1 bg-zinc-900/90 border border-zinc-700/60 rounded-full px-2 py-0.5 text-[10px] text-zinc-300 shadow-lg pointer-events-auto">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            className="hover:text-indigo-300 font-bold px-1"
            title="Switch companion"
          >
            {PET_FORMS[pet]?.name}
          </button>
          <span className="text-zinc-600">·</span>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="hover:text-white px-1"
            title={minimized ? 'Expand' : 'Compact'}
          >
            {minimized ? '+' : '–'}
          </button>
        </div>
      </div>

      {/* Ground Shadow */}
      <span className="pointer-events-none mt-1 h-1.5 w-12 rounded-full bg-black/40 blur-[3px]" />
    </aside>
  );
};

export default DesktopPet;

