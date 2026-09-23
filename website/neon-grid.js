/* The neon floor: a perspective grid rushing toward the viewer, with light
 * pulses running along it and a horizon that breathes. Drawn on any
 * <canvas data-neon-grid>, behind the hero and the page headers.
 *
 * Motion is the point, so it runs whatever the system's reduced-motion
 * setting says - the page opts into full motion in main.js (html.motion-full),
 * the same decision the rest of the site's movement follows. Without that
 * class and with reduced motion asked for, it draws one still frame.
 * It stops drawing whenever it is off screen or the tab is hidden.
 */
(() => {
  const canvases = document.querySelectorAll('canvas[data-neon-grid]');
  if (!canvases.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = reduce && !document.documentElement.classList.contains('motion-full');

  canvases.forEach((canvas) => {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const host = canvas.parentElement || document.body;
    const small = window.matchMedia('(max-width: 760px)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75);
    const HUE_A = [255, 59, 59];    // SMARAN red
    const HUE_B = [255, 138, 61];   // ember orange
    const COLS = small ? 16 : 26;
    const ROWS = small ? 14 : 22;
    let width = 0, height = 0, horizon = 0;
    let mouseX = 0, mouseY = 0, camX = 0, camY = 0;
    let visible = true, raf = 0, start = performance.now();
    const pulses = [];

    const resize = () => {
      const r = host.getBoundingClientRect();
      width = Math.max(1, r.width);
      height = Math.max(1, r.height);
      horizon = height * (small ? 0.48 : 0.44);
      canvas.width = Math.round(width * DPR);
      canvas.height = Math.round(height * DPR);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };

    const mix = (t, a = 1) => {
      const c = HUE_A.map((v, i) => Math.round(v + (HUE_B[i] - v) * t));
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    };

    // One line drawn twice: a wide faint halo and a thin bright core - a glow
    // without canvas shadowBlur, which is far too slow to redraw every frame.
    const glowLine = (x1, y1, x2, y2, t, alpha) => {
      ctx.strokeStyle = mix(t, alpha * 0.22);
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = mix(t, alpha);
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };

    const frame = (now) => {
      const t = (now - start) / 1000;
      // Camera: a slow sway plus a little of the pointer, eased.
      camX += ((Math.sin(t * 0.23) * 0.035 + mouseX * 0.05) - camX) * 0.05;
      camY += ((Math.sin(t * 0.17) * 0.012 + mouseY * 0.025) - camY) * 0.05;
      const vx = width * (0.5 + camX);
      const hy = horizon * (1 + camY);
      ctx.clearRect(0, 0, width, height);

      // Horizon glow, breathing.
      const breathe = 0.55 + Math.sin(t * 1.3) * 0.12;
      const sky = ctx.createRadialGradient(vx, hy, 0, vx, hy, width * 0.6);
      sky.addColorStop(0, mix(0.4, 0.34 * breathe));
      sky.addColorStop(0.35, mix(0.2, 0.10 * breathe));
      sky.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      glowLine(0, hy, width, hy, 0.6, 0.55 * breathe);

      // Floor lines receding to the vanishing point.
      const spread = width * 2.4;
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS - 0.5;
        const xb = vx + u * spread;
        const edge = 1 - Math.abs(u) * 1.6;
        if (edge <= 0) continue;
        glowLine(vx + u * width * 0.02, hy, xb, height, 0.3 + Math.abs(u), 0.42 * edge);
      }
      // Cross lines rushing toward the viewer: depth loops, spacing by perspective.
      const speed = 0.32;
      for (let j = 0; j < ROWS; j++) {
        const z = ((j + t * speed * ROWS) % ROWS) / ROWS;     // 0 far .. 1 near
        const depth = Math.pow(z, 2.6);
        const y = hy + (height - hy) * depth;
        const alpha = Math.min(1, depth * 3) * 0.6;
        if (alpha < 0.02) continue;
        glowLine(0, y, width, y, 0.7 - depth * 0.5, alpha);
      }

      // Pulses: sparks running down a floor line toward the viewer.
      if (pulses.length < (small ? 5 : 9) && Math.random() < 0.06) {
        pulses.push({ u: (Math.floor(Math.random() * COLS) / COLS) - 0.5, p: 0, v: 0.25 + Math.random() * 0.35 });
      }
      for (let k = pulses.length - 1; k >= 0; k--) {
        const s = pulses[k];
        s.p += s.v * 0.016;
        if (s.p >= 1) { pulses.splice(k, 1); continue; }
        const d = Math.pow(s.p, 2.2);
        const x = vx + s.u * width * 0.02 + (s.u * spread - s.u * width * 0.02) * d;
        const y = hy + (height - hy) * d;
        const r = 1.5 + d * 5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
        g.addColorStop(0, 'rgba(255,240,220,0.95)');
        g.addColorStop(0.25, mix(0.8, 0.55));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 6, 0, Math.PI * 2); ctx.fill();
      }

      // Fade the floor into the page at the bottom.
      const fade = ctx.createLinearGradient(0, height * 0.72, 0, height);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(5,5,7,0.95)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, height * 0.72, width, height * 0.28);

      if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
      else raf = 0;
    };

    const kick = () => {
      if (!still && !raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener('resize', () => { resize(); if (still) frame(performance.now()); });
    host.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      mouseX = (e.clientX - r.left) / r.width - 0.5;
      mouseY = (e.clientY - r.top) / r.height - 0.5;
    });
    document.addEventListener('visibilitychange', kick);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }).observe(canvas);
    }
    frame(performance.now());
  });
})();
