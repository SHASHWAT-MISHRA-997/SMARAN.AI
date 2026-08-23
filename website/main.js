/* =====================================================================
   SMARAN.AI — landing page behaviour
   No framework and no build step, so the whole site is three files that
   any static host will serve for free.
   ===================================================================== */

(() => {
  'use strict';

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------------------------------------------------------- nav */

  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('stuck', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = $('#navToggle');
  const menu = $('#mobileMenu');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    menu.hidden = open;
  });
  // Tapping a link should close the sheet, not leave it covering the target.
  $$('a', menu).forEach((a) => a.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
  }));

  /* Highlight whichever section is on screen. */
  const sections = $$('section[id]');
  const navLinks = $$('.nav-links a');
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  /* ------------------------------------------------------------ reveals */

  const reveals = $$('.reveal');
  if (calm || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        obs.unobserve(entry.target); // reveal once, not on every pass
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------- spotlight */

  const spotlight = $('#spotlight');
  if (!calm && window.matchMedia('(pointer: fine)').matches) {
    let raf = 0, mx = 0, my = 0;
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        spotlight.style.setProperty('--mx', `${mx}px`);
        spotlight.style.setProperty('--my', `${my}px`);
        raf = 0;
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------- card effects */

  if (!calm && window.matchMedia('(pointer: fine)').matches) {
    $$('.card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        card.style.setProperty('--cx', `${x}px`);
        card.style.setProperty('--cy', `${y}px`);

        if (!card.classList.contains('tilt')) return;
        // Small angles on purpose: enough to read as a surface, not enough
        // to make the text hard to read.
        const rx = ((y / r.height) - 0.5) * -6;
        const ry = ((x / r.width) - 0.5) * 6;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });

    /* Buttons lean towards the cursor as it approaches. */
    $$('.magnetic').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.16;
        const y = (e.clientY - r.top - r.height / 2) * 0.28;
        btn.style.transform = `translate(${x}px, ${y - 2}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* ------------------------------------------------------------- typer */

  const typer = $('#typer');
  if (typer) {
    const lines = [
      'summarise this 40-page PDF',
      'what is on my screen right now?',
      'write the migration and explain it',
      'read my notes and find the contradiction',
      'switch to Hindi and keep going',
    ];
    if (calm) {
      typer.textContent = lines[0];
    } else {
      let li = 0, ci = 0, erasing = false;
      const tick = () => {
        const line = lines[li];
        ci += erasing ? -1 : 1;
        typer.textContent = line.slice(0, ci);

        let wait = erasing ? 28 : 52;
        if (!erasing && ci === line.length) { erasing = true; wait = 1900; }
        else if (erasing && ci === 0) { erasing = false; li = (li + 1) % lines.length; wait = 320; }
        setTimeout(tick, wait);
      };
      setTimeout(tick, 700);
    }
  }

  /* ---------------------------------------------------------- counters */

  const countTo = (el, target, suffix = '') => {
    if (calm) { el.textContent = target + suffix; return; }
    const dur = 1500;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      // Ease out, so the number lands rather than stopping dead.
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* Stat band counters, each starting when its own row scrolls in. */
  const stats = $$('.stat b[data-count]');
  if (stats.length && 'IntersectionObserver' in window) {
    const so = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countTo(entry.target, Number(entry.target.dataset.count));
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    stats.forEach((el) => so.observe(el));
  }

  const readout = $('.orb-readout');
  if (readout && 'IntersectionObserver' in window) {
    const once = new IntersectionObserver((entries, obs) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      countTo($('#statModels'), 63);
      countTo($('#statLocal'), 100);
      countTo($('#statCost'), 0);
    }, { threshold: 0.4 });
    once.observe(readout);
  }

  /* ------------------------------------------------- particle backdrop */

  const canvas = $('#field');
  if (canvas && !calm) {
    const ctx = canvas.getContext('2d', { alpha: true });
    let w = 0, h = 0, dots = [], raf = 0;
    const pointer = { x: -9999, y: -9999 };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      ctx.scale(dpr, dpr);

      // Scale the count to the viewport, so a phone is not asked to draw a
      // desktop's worth of particles.
      const count = Math.min(Math.round((innerWidth * innerHeight) / 11000), 160);
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.9 + 0.7,
      }));
    };

    const frame = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);

      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > innerWidth) d.vx *= -1;
        if (d.y < 0 || d.y > innerHeight) d.vy *= -1;

        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 92, 71, .85)';
        ctx.shadowColor = 'rgba(239, 68, 68, .9)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Join near neighbours, and brighten anything close to the cursor.
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i], b = dots[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > 20000) continue;
          const alpha = (1 - dist2 / 20000) * 0.4;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        const pdx = dots[i].x - pointer.x, pdy = dots[i].y - pointer.y;
        const pd2 = pdx * pdx + pdy * pdy;
        if (pd2 < 26000) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.strokeStyle = `rgba(255, 138, 92, ${(1 - pd2 / 26000) * 0.4})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(frame);
    };

    build();
    frame();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 180);
    });

    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY;
    }, { passive: true });
    window.addEventListener('pointerleave', () => {
      pointer.x = pointer.y = -9999;
    });

    // A hidden tab should not keep a render loop alive on someone's battery.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) frame();
    });
  }

  /* -------------------------------------------------- platform default */

  /* Lead with the download that matches the visitor's device, rather than
     making an Android user hunt past a Windows installer. */
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    document.body.classList.add('is-android');
    const win = $('#dlWin'), apk = $('#dlApk');
    if (win && apk) {
      apk.classList.remove('btn-ghost'); apk.classList.add('btn-primary');
      win.classList.remove('btn-primary'); win.classList.add('btn-ghost');
    }
  }

  /* ------------------------------------------------------------- misc */

  $('#year').textContent = String(new Date().getFullYear());

  /* Only one FAQ answer open at a time — otherwise the section becomes a
     wall of text and the questions scroll off. */
  const faqs = $$('.faq details');
  faqs.forEach((d) => d.addEventListener('toggle', () => {
    if (!d.open) return;
    faqs.forEach((other) => { if (other !== d) other.open = false; });
  }));

})();
