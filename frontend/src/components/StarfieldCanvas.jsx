import React, { useMemo } from 'react';

const StarfieldCanvas = () => {
  // Generate 45 deterministic twinkling stars with random offsets
  const stars = useMemo(() => {
    return Array.from({ length: 45 }).map((_, i) => ({
      id: i,
      top: `${(i * 17 + 7) % 95}%`,
      left: `${(i * 23 + 13) % 98}%`,
      size: (i % 3) + 1.5,
      delay: `${(i * 0.4) % 3}s`,
      duration: `${2 + (i % 3)}s`,
      color: i % 4 === 0 ? 'bg-amber-400' : i % 4 === 1 ? 'bg-indigo-400' : i % 4 === 2 ? 'bg-cyan-400' : 'bg-purple-400',
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none opacity-20 dark:opacity-100 transition-opacity duration-300">
      {/* Sci-Fi Nebula Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-indigo-600/15 via-purple-600/10 to-transparent blur-[120px] animate-nebula" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-tl from-amber-500/12 via-orange-600/10 to-transparent blur-[140px] animate-nebula" style={{ animationDelay: '-5s' }} />

      {/* Twinkling Starfield Grid */}
      {stars.map((star) => (
        <span
          key={star.id}
          className={`absolute rounded-full ${star.color} animate-twinkle shadow-[0_0_8px_rgba(255,255,255,0.8)]`}
          style={{
            top: star.top,
            left: star.left,
            width: `${star.size}px`,
            height: `${star.size}px`,
            animationDelay: star.delay,
            animationDuration: star.duration,
          }}
        />
      ))}
    </div>
  );
};

export default StarfieldCanvas;
