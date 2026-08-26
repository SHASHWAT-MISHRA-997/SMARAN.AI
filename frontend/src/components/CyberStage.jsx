import React, { useEffect, useRef } from 'react';

/**
 * The stage the character stands on.
 *
 * A flat gradient behind a character reads as a placeholder, so this draws a
 * room for her to be in: a neon floor running to a horizon, data falling in
 * the depth behind it, a scan sweep, and lightning that cracks across the
 * top now and then.
 *
 * Everything is one 2D canvas rather than stacked DOM layers with CSS
 * animations. Twenty-odd blurred, animated elements composite on every frame
 * and cost more than drawing the same thing once, and a canvas can share a
 * single clock so the floor, the rain and the bolts stay in step.
 *
 * It reacts to what the assistant is doing. Idle is dim and slow; listening
 * brightens and quickens; speaking drives the horizon glow from her actual
 * volume, so the room pulses on her voice rather than on a timer.
 */

// Palette. Cyan is the primary and magenta the accent, matching the rest of
// the interface, with violet between them for depth.
const CYAN = [34, 226, 255];
const MAGENTA = [255, 64, 160];
const VIOLET = [130, 80, 255];

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

/** Per-state look. Intensity scales brightness; speed scales every motion. */
const MOODS = {
  idle: { intensity: 0.9, speed: 0.6, accent: VIOLET },
  listening: { intensity: 1.25, speed: 1.0, accent: CYAN },
  thinking: { intensity: 1.1, speed: 1.5, accent: VIOLET },
  speaking: { intensity: 1.5, speed: 1.2, accent: MAGENTA },
};

// Glyphs for the falling columns: half-width katakana and hex, which is what
// makes it read as data rather than as text someone could try to read.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF';

/** Horizon sits above centre so the floor has room to run toward the viewer. */
const HORIZON = 0.42;

const CyberStage = ({ voiceState = 'idle', micVolume = 0, className = '' }) => {
  const canvasRef = useRef(null);
  // The render loop reads these every frame, so they are refs rather than
  // props closed over at mount.
  const stateRef = useRef(voiceState);
  const volumeRef = useRef(0);

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { volumeRef.current = micVolume; }, [micVolume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // Someone who has asked their system for less motion gets the room and
    // the colour without anything that moves.
    const stillness = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let still = Boolean(stillness?.matches);
    const onStillnessChange = (e) => { still = e.matches; };
    stillness?.addEventListener?.('change', onStillnessChange);

    let width = 0;
    let height = 0;
    let ratio = 1;

    /** Falling data columns, rebuilt whenever the canvas changes width. */
    let columns = [];
    /** Currently visible lightning, if any. */
    let bolt = null;
    let boltAt = 0.8 + Math.random() * 1.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Half resolution is enough for a soft, glowing backdrop and costs a
      // quarter of the fill. Detail here would be wasted behind a character.
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const spacing = 22;
      columns = Array.from({ length: Math.ceil(width / spacing) }, (_, i) => ({
        x: i * spacing + spacing * 0.5,
        y: Math.random() * height,
        // Slower columns are drawn dimmer, which reads as further away.
        speed: 26 + Math.random() * 70,
        length: 6 + Math.floor(Math.random() * 14),
        glyph: () => GLYPHS[(Math.random() * GLYPHS.length) | 0],
      }));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    /** One branching bolt, generated as a jagged polyline with offshoots. */
    const makeBolt = () => {
      const fromLeft = Math.random() < 0.5;
      const y0 = height * (0.06 + Math.random() * 0.22);
      const points = [{ x: fromLeft ? -20 : width + 20, y: y0 }];
      const steps = 9 + Math.floor(Math.random() * 6);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        points.push({
          x: fromLeft ? t * (width + 40) - 20 : width + 20 - t * (width + 40),
          y: y0 + (Math.random() - 0.5) * height * 0.16 * (1 - Math.abs(t - 0.5)),
        });
      }
      const branches = [];
      for (let i = 0; i < 2; i += 1) {
        const from = points[2 + Math.floor(Math.random() * (points.length - 4))];
        if (!from) continue;
        const b = [from];
        for (let j = 1; j <= 4; j += 1) {
          b.push({
            x: b[j - 1].x + (Math.random() - 0.5) * 90,
            y: b[j - 1].y + Math.random() * 70,
          });
        }
        branches.push(b);
      }
      return { points, branches, life: 0, duration: 0.28 + Math.random() * 0.22 };
    };

    const stroke = (points, colour, alpha, lineWidth, blur) => {
      ctx.save();
      ctx.strokeStyle = rgba(colour, alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = rgba(colour, Math.min(1, alpha * 1.4));
      ctx.shadowBlur = blur;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    };

    let frame = null;
    let last = performance.now();
    let clock = 0;
    // Volume is eased rather than used raw: the analyser jumps frame to frame
    // and an unsmoothed value makes the whole room strobe.
    let level = 0;

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!width || !height) return;

      const mood = MOODS[stateRef.current] || MOODS.idle;
      const speed = still ? 0 : mood.speed;
      clock += dt * speed;
      level += (Math.min(1, volumeRef.current || 0) - level) * Math.min(1, dt * 8);

      const horizon = height * HORIZON;
      // Speaking lifts the whole scene on her own volume.
      const lift = mood.intensity * (1 + level * 0.5);

      ctx.clearRect(0, 0, width, height);

      // ── Sky ──────────────────────────────────────────────────────────
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#04050f');
      sky.addColorStop(0.55, '#080a1e');
      sky.addColorStop(1, `rgba(${VIOLET[0]},${VIOLET[1]},${VIOLET[2]},${0.16 * lift})`);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, horizon);

      const ground = ctx.createLinearGradient(0, horizon, 0, height);
      ground.addColorStop(0, '#070920');
      ground.addColorStop(1, '#02030a');
      ctx.fillStyle = ground;
      ctx.fillRect(0, horizon, width, height - horizon);

      // ── Data rain, behind the floor so it reads as distance ──────────
      ctx.font = '13px "Courier New", monospace';
      ctx.textBaseline = 'top';
      columns.forEach((col) => {
        if (!still) {
          col.y += col.speed * speed * dt;
          if (col.y - col.length * 15 > horizon) col.y = -Math.random() * height * 0.5;
        }
        const depth = col.speed / 96;
        for (let i = 0; i < col.length; i += 1) {
          const y = col.y - i * 15;
          if (y < -15 || y > horizon) continue;
          // Fade toward the tail, and fade everything as it nears the horizon.
          const tail = 1 - i / col.length;
          const near = 1 - Math.max(0, y / horizon) * 0.75;
          const alpha = tail * near * depth * 1.1 * lift;
          if (alpha < 0.02) continue;
          ctx.fillStyle = i === 0
            ? rgba([210, 255, 255], Math.min(0.9, alpha * 2.2))
            : rgba(CYAN, alpha);
          ctx.fillText(col.glyph(), col.x, y);
        }
      });

      // ── Horizon glow ─────────────────────────────────────────────────
      const glowHeight = 150 + level * 90;
      const glow = ctx.createLinearGradient(0, horizon - glowHeight, 0, horizon + 30);
      glow.addColorStop(0, rgba(mood.accent, 0));
      glow.addColorStop(0.72, rgba(mood.accent, 0.2 * lift));
      glow.addColorStop(1, rgba(mood.accent, 0.75 * lift));
      ctx.fillStyle = glow;
      ctx.fillRect(0, horizon - glowHeight, width, glowHeight + 30);

      ctx.save();
      ctx.strokeStyle = rgba(mood.accent, 0.95 * lift);
      ctx.lineWidth = 2.5;
      ctx.shadowColor = rgba(mood.accent, 1);
      ctx.shadowBlur = 40;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(width, horizon);
      ctx.stroke();
      ctx.restore();

      // ── Floor ────────────────────────────────────────────────────────
      // Lines converge on a vanishing point at the centre of the horizon.
      // Spacing that grows with distance from it is what gives perspective;
      // evenly spaced lines look like a flat fan.
      const vanishX = width / 2;
      ctx.save();
      ctx.strokeStyle = rgba(CYAN, 0.8 * lift);
      ctx.lineWidth = 1;
      ctx.shadowColor = rgba(CYAN, 0.5);
      ctx.shadowBlur = 14;
      for (let i = -14; i <= 14; i += 1) {
        const spread = Math.sign(i) * (i * i) * (width / 260);
        ctx.beginPath();
        ctx.moveTo(vanishX, horizon);
        ctx.lineTo(vanishX + spread, height);
        ctx.stroke();
      }
      // Cross lines scroll toward the viewer. Their spacing follows 1/z, so
      // they bunch at the horizon and stretch as they arrive.
      const scroll = (clock * 0.32) % 1;
      for (let i = 0; i < 16; i += 1) {
        const z = (i + scroll) / 16;
        const y = horizon + (height - horizon) * (z * z);
        if (y > height) continue;
        ctx.globalAlpha = (1 - z) * 0.55;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();

      // ── Uprights ─────────────────────────────────────────────────────
      // Placed by distance from the centre so they never cross her, and
      // pulsing out of phase so the pair does not blink as one.
      ctx.save();
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 3; i += 1) {
          const x = vanishX + side * width * (0.3 + i * 0.11);
          if (x < -20 || x > width + 20) continue;
          const pulse = 0.55 + 0.45 * Math.sin(clock * 1.3 + i * 1.7 + (side + 1));
          const top = horizon - height * (0.34 - i * 0.07);
          const colour = i % 2 ? mood.accent : CYAN;
          const beam = ctx.createLinearGradient(0, top, 0, horizon);
          beam.addColorStop(0, rgba(colour, 0));
          beam.addColorStop(1, rgba(colour, 0.5 * lift * pulse));
          ctx.strokeStyle = beam;
          ctx.lineWidth = 2 + i;
          ctx.shadowColor = rgba(colour, 0.8);
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, horizon);
          ctx.stroke();
        }
      }
      ctx.restore();

      // ── Bloom behind the character ───────────────────────────────────
      const bloomR = Math.min(width, height) * (0.34 + level * 0.06);
      const bloom = ctx.createRadialGradient(
        vanishX, horizon - bloomR * 0.15, 0,
        vanishX, horizon - bloomR * 0.15, bloomR,
      );
      bloom.addColorStop(0, rgba(mood.accent, 0.3 * lift));
      bloom.addColorStop(0.5, rgba(VIOLET, 0.1 * lift));
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);

      // ── Lightning ────────────────────────────────────────────────────
      if (!still) {
        boltAt -= dt * speed;
        if (boltAt <= 0) {
          bolt = makeBolt();
          // Rarely while idle, often while she is speaking.
          boltAt = (stateRef.current === 'speaking' ? 1.2 : 2.8) + Math.random() * 3.5;
        }
      }
      if (bolt) {
        bolt.life += dt;
        const t = bolt.life / bolt.duration;
        if (t >= 1) {
          bolt = null;
        } else {
          // Flash hard, then decay: a bolt that fades linearly looks like a
          // drawn line rather than a discharge.
          const a = (1 - t) ** 2.2;
          stroke(bolt.points, [235, 250, 255], a * 0.95, 2.2, 30);
          stroke(bolt.points, mood.accent, a * 0.7, 5.5, 44);
          bolt.branches.forEach((b) => stroke(b, mood.accent, a * 0.4, 1.6, 18));
          // The room lights up with it.
          ctx.fillStyle = rgba(mood.accent, a * 0.06);
          ctx.fillRect(0, 0, width, height);
        }
      }

      // ── Scan sweep ───────────────────────────────────────────────────
      const sweepY = ((clock * 0.14) % 1) * height;
      const sweep = ctx.createLinearGradient(0, sweepY - 70, 0, sweepY + 70);
      sweep.addColorStop(0, rgba(CYAN, 0));
      sweep.addColorStop(0.5, rgba(CYAN, 0.09 * lift));
      sweep.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = sweep;
      ctx.fillRect(0, sweepY - 70, width, 140);

      // Fine scanlines over everything, which is most of the CRT feel.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);

      // ── Vignette ─────────────────────────────────────────────────────
      const vig = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.28,
        width / 2, height / 2, Math.max(width, height) * 0.75,
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    };

    frame = requestAnimationFrame(draw);

    // A backdrop in a hidden tab is worth nothing and still costs a frame.
    const onVisibility = () => {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = null;
      } else if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stillness?.removeEventListener?.('change', onStillnessChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full pointer-events-none ${className}`}
    />
  );
};

export default CyberStage;
