/* Neon light trails behind the hero.
 *
 * Ribbons of light stream out of a vanishing point above the headline and
 * sweep down past the viewer, each carrying a bright pulse along its length -
 * the "hyperspace road" look. Drawn with the 2D canvas in additive ("lighter")
 * mode, so overlapping ribbons glow where they cross.
 *
 * Kept cheap on purpose: fewer ribbons and a lower pixel ratio on small
 * screens, nothing drawn while the hero is scrolled away or the tab is hidden,
 * and a single still frame for anyone who has asked for reduced motion.
 */
(() => {
  const canvas = document.getElementById('trails');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const hero = canvas.closest('.hero') || document.body;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 760px)').matches;

  const COLORS = ['#ff4fd8', '#c026d3', '#8b5cf6', '#3b82f6', '#22d3ee', '#2dd4bf', '#6366f1'];
  const COUNT = small ? 9 : 15;
  const SEGMENTS = small ? 26 : 42;
  const DPR = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75);

  let width = 0;
  let height = 0;
  let ribbons = [];
  let running = false;
  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let easedX = 0;
  let easedY = 0;

  // A seeded random, so the layout is the same on every visit and resize.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const build = () => {
    seed = 7;
    ribbons = Array.from({ length: COUNT }, (_, i) => {
      const side = i / (COUNT - 1) - 0.5; // -0.5 left .. 0.5 right
      return {
        color: COLORS[i % COLORS.length],
        // Where it leaves the bottom edge, fanned wider than the screen.
        endX: 0.5 + side * (1.9 + rand() * 0.5),
        // How far it bows sideways on the way down.
        bow: (rand() - 0.5) * 0.55 + side * 0.35,
        // The swirl near the vanishing point, left or right.
        curl: (rand() < 0.5 ? -1 : 1) * (0.08 + rand() * 0.12),
        width: 1.2 + rand() * 2.4,
        speed: 0.12 + rand() * 0.18,
        phase: rand(),
        alpha: 0.35 + rand() * 0.45,
      };
    });
  };

  const resize = () => {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * DPR);
    canvas.height = Math.round(height * DPR);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
    if (!running) draw(0);
  };

  // A point along one ribbon: a cubic from the vanishing point to its end.
  const point = (r, t, vx, vy) => {
    const x0 = vx;
    const y0 = vy;
    const x3 = r.endX * width;
    const y3 = height * 1.08;
    const x1 = x0 + r.curl * width;
    const y1 = y0 + height * 0.06;
    const x2 = x0 + (r.endX - 0.5 + r.bow) * width * 0.9;
    const y2 = y0 + height * 0.55;
    const u = 1 - t;
    return [
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ];
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    easedX += (pointerX - easedX) * 0.04;
    easedY += (pointerY - easedY) * 0.04;
    // The vanishing point sits behind the logo art, not over the headline, so
    // the ribbons fan out from the right and leave the copy readable. On a
    // narrow screen the layout stacks, and the middle is the right place.
    const vx = width * (small ? 0.5 : 0.68) + easedX * width * 0.04;
    const vy = height * (small ? 0.22 : 0.34) + easedY * height * 0.03;
    const seconds = time / 1000;

    for (const r of ribbons) {
      const pulse = (seconds * r.speed + r.phase) % 1;
      let [px, py] = point(r, 0, vx, vy);
      for (let s = 1; s <= SEGMENTS; s += 1) {
        const t = s / SEGMENTS;
        const [x, y] = point(r, t, vx, vy);
        // Wider as it comes towards the viewer; brightest around the pulse.
        const near = Math.pow(t, 1.6);
        const glow = Math.exp(-Math.pow((t - pulse) * 7, 2));
        const base = r.alpha * (0.18 + 0.5 * near);
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = Math.min(1, base * 0.35 + glow * 0.25);
        ctx.lineWidth = r.width * (0.4 + near * 7);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, base + glow * 0.8);
        ctx.lineWidth = r.width * (0.25 + near * 2.2);
        ctx.stroke();
        px = x;
        py = y;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const loop = (time) => {
    if (!running) return;
    draw(time);
    frame = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || still) return;
    running = true;
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', (event) => {
    pointerX = event.clientX / window.innerWidth - 0.5;
    pointerY = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()))
      .observe(hero);
  }

  resize();
  if (still) draw(2400);
  else start();
})();
