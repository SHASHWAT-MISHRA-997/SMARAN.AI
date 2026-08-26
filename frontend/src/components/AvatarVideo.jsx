import React, { useEffect, useRef, useState } from 'react';

/**
 * Animated character driven by conversation state.
 *
 * Rather than posing a 3D rig, this plays short looping clips of a hand-drawn
 * character — one per state — and cross-fades between them. Drawn animation
 * reads as far more alive than a real-time mesh, which is why the reference
 * design uses video here.
 *
 * States map to what the assistant is doing:
 *   idle      — waiting, small natural movement
 *   thinking  — a reply is being produced
 *   talking   — audio is playing
 */
export const AVATAR_CHARACTERS = [
  {
    // Cut from one eight-second source that already moved through the three
    // states: a calm portrait, the network expanding, then the result. Each
    // clip plays forward and then backward so its last frame is its first -
    // a straight cut from a continuous shot snaps visibly on every loop.
    id: 'energy-core',
    name: 'Energy Core',
    gender: 'male',
    clips: {
      idle: '/avatar-video/core-idle.mp4',
      thinking: '/avatar-video/core-thinking.mp4',
      talking: '/avatar-video/core-talking.mp4',
    },
  },
  {
    id: 'anime-girl',
    name: 'Myra',
    gender: 'female',
    clips: {
      idle: '/avatar-video/idle.mp4',
      thinking: '/avatar-video/thinking.mp4',
      talking: '/avatar-video/talking.mp4',
    },
  },
];

const AvatarVideo = ({
  characterId = 'anime-girl',
  isSpeaking = false,
  isThinking = false,
  className = '',
}) => {
  const character =
    AVATAR_CHARACTERS.find((c) => c.id === characterId) || AVATAR_CHARACTERS[0];

  const state = isSpeaking ? 'talking' : isThinking ? 'thinking' : 'idle';

  // Two stacked players let one clip fade in while the other fades out, so a
  // state change never shows a blank frame.
  const playerA = useRef(null);
  const playerB = useRef(null);
  const [frontIsA, setFrontIsA] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const currentStateRef = useRef(null);

  // Which player is visible is tracked in a ref as well as state: reading it
  // from state inside the effect used a stale value when two state changes
  // landed in quick succession (idle -> thinking -> talking), which loaded the
  // new clip into the player that was already on screen.
  const frontIsARef = useRef(true);

  useEffect(() => {
    if (currentStateRef.current === state) return;
    const source = character.clips[state];
    if (!source) return;
    currentStateRef.current = state;

    const incoming = frontIsARef.current ? playerB.current : playerA.current;
    if (!incoming) return;

    incoming.src = source;
    incoming.load();
    const play = incoming.play();
    if (play?.catch) play.catch(() => { /* autoplay of a muted clip rarely fails */ });

    frontIsARef.current = !frontIsARef.current;
    setFrontIsA(frontIsARef.current);
  }, [state, character]);

  // Prime the first clip.
  useEffect(() => {
    const first = playerA.current;
    if (!first) return;
    first.src = character.clips.idle;
    first.load();
    const play = first.play();
    if (play?.catch) play.catch(() => {});
    currentStateRef.current = 'idle';
    frontIsARef.current = true;
    setFrontIsA(true);
  }, [character]);

  // Keep the clips running: several embedded browsers pause media that is not
  // in a foreground tab, which left the character frozen.
  useEffect(() => {
    const keepPlaying = () => {
      [playerA.current, playerB.current].forEach((video) => {
        if (video && video.src && video.paused) {
          const play = video.play();
          if (play?.catch) play.catch(() => {});
        }
      });
    };
    const timer = window.setInterval(keepPlaying, 1500);
    document.addEventListener('visibilitychange', keepPlaying);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', keepPlaying);
    };
  }, []);

  const sharedVideoProps = {
    muted: true,
    loop: true,
    playsInline: true,
    preload: 'auto',
    onError: () => setLoadError(true),
    // Fill the panel rather than letterboxing it. `object-contain` left
    // large empty bands above and below the character.
    className: 'absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500',
  };

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <video ref={playerA} {...sharedVideoProps} style={{ opacity: frontIsA ? 1 : 0 }} />
      <video ref={playerB} {...sharedVideoProps} style={{ opacity: frontIsA ? 0 : 1 }} />

      {/* Soft vignette so the clip sits inside the dark interface. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65)_100%)]" />

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
          <span className="font-mono text-[10px] text-rose-400/90">
            Character animation could not be loaded.
          </span>
        </div>
      )}
    </div>
  );
};

export default AvatarVideo;
