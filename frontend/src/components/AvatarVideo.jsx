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

  // A character can ask to hold its first frame while nothing is happening.
  // The clip stays loaded, so the first word starts it moving with no pause.
  const holdStill = Boolean(character.stillWhenIdle) && state === 'idle';

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

  // Hold the frame while idle, and let it run the moment there is something
  // to react to.
  const holdStillRef = useRef(false);
  useEffect(() => {
    holdStillRef.current = holdStill;
    [playerA.current, playerB.current].forEach((video) => {
      if (!video || !video.src) return;
      if (holdStill) {
        video.pause();
      } else if (video.paused) {
        const play = video.play();
        if (play?.catch) play.catch(() => {});
      }
    });
  }, [holdStill]);

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
        // Do not restart what was paused on purpose. This watchdog exists
        // for embedded browsers that pause background media; without the
        // guard it undid the hold within a second and a half.
        if (holdStillRef.current) return;
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
      // Filling is right for a tall portrait clip, where letterboxing left
      // large empty bands. It is wrong for a square composition in a wide
      // panel, which is why the character chooses.
      className: `absolute inset-0 w-full h-full ${
        character.fit === 'contain' ? 'object-contain' : 'object-cover object-top'
      } transition-opacity duration-500`,
  };

  // If the video clips cannot be loaded (files missing), render nothing
  // instead of showing a broken native video player with a giant play button.
  if (loadError) {
    return (
      <div className={`relative w-full h-full overflow-hidden flex flex-col items-center justify-center ${className}`}>
        <div className="relative flex items-center justify-center">
          <div className={`w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-gradient-to-tr from-purple-600/30 via-indigo-500/20 to-pink-500/30 border border-purple-400/40 backdrop-blur-xl flex items-center justify-center shadow-[0_0_50px_rgba(168,85,247,0.35)] ${isSpeaking ? 'scale-110 animate-pulse' : isThinking ? 'animate-spin' : ''}`}>
            <span className="text-3xl sm:text-4xl select-none">✨</span>
          </div>
          <div className="absolute -inset-2 rounded-full border border-pink-400/20 animate-ping pointer-events-none" />
        </div>
        <p className="mt-4 text-xs font-black text-zinc-200 font-mono tracking-wider uppercase">
          {character.name || 'AI Assistant'} · Active
        </p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <video ref={playerA} {...sharedVideoProps} style={{ opacity: frontIsA ? 1 : 0 }} />
      <video ref={playerB} {...sharedVideoProps} style={{ opacity: frontIsA ? 0 : 1 }} />

      {/* Soft vignette so the clip sits inside the dark interface. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65)_100%)]" />
    </div>
  );
};

export default AvatarVideo;
