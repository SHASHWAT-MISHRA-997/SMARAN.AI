/* =====================================================================
   SMARAN.AI — landing page behaviour
   No framework and no build step, so the whole site is three files that
   any static host will serve for free.
   ===================================================================== */

(() => {
  'use strict';

  /* Reduced motion, in proportion. Windows ships with "show animations" off
     on plenty of machines and browsers report that here, so treating it as
     "render nothing" left those visitors looking at a dead page. The particle
     field stays, drifting more slowly; only the things that chase the cursor
     or retype themselves are dropped. */
  /* Motion is always on, by the owner's decision.
     The system's reduced-motion preference is deliberately not consulted:
     this page is a shop window for software whose whole pitch is that it
     feels alive, and a still version of it misrepresents the product. The
     stylesheet keeps its reduced-motion rules for anyone who loads the page
     without this script. */
  document.documentElement.classList.add('motion-full');
  document.documentElement.classList.remove('motion-calm');
  const full = true;
  const calm = false;
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
      let li = 0, ci = 0, erasing = false, wasErasing = null;
      const tick = () => {
        const line = lines[li];
        ci += erasing ? -1 : 1;
        typer.textContent = line.slice(0, ci);

        let wait = erasing ? 28 : 52;
        if (!erasing && ci === line.length) { erasing = true; wait = 1900; }
        else if (erasing && ci === 0) { erasing = false; li = (li + 1) % lines.length; wait = 320; }
        // Only announce the change, not every keystroke: listeners were being
        // re-triggered twenty times a second and could never move on.
        if (erasing !== wasErasing) {
          wasErasing = erasing;
          window.dispatchEvent(new CustomEvent('smaran:typing', { detail: !erasing }));
        }
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
  if (canvas) {
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
        vx: (Math.random() - 0.5) * (calm ? 0.08 : 0.3),
        vy: (Math.random() - 0.5) * (calm ? 0.08 : 0.3),
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


  /* ---------------------------------------------------- character stage */

  /* She switches to the talking clip while the line above is being typed,
     so the two read as one thing rather than two loops running side by side. */
  const charVideo = $('#charVideo');
  if (charVideo) {
    /* Brave and Safari refuse autoplay by default even for a muted clip, and
       a refused video paints its poster and stops. Ask once on load, then
       again after the first interaction, which browsers do accept. */
    const nudge = () => charVideo.play().catch(() => {});
    nudge();
    ['pointerdown', 'keydown', 'touchstart'].forEach((evt) =>
      window.addEventListener(evt, nudge, { once: true, passive: true }));
  }

  if (charVideo && !calm) {
    let talking = false;
    const setClip = (name) => {
      const next = `assets/character-${name}.mp4`;
      if (charVideo.getAttribute('src') === next) return;
      charVideo.setAttribute('src', next);
      charVideo.play().catch(() => {}); // autoplay can be refused; not fatal
    };
    window.addEventListener('smaran:typing', (e) => {
      const now = Boolean(e.detail);
      if (now === talking) return;
      talking = now;
      setClip(now ? 'talking' : 'idle');
    });
  }

  /* ------------------------------------------------------------ feedback */

  const form = $('#feedbackForm');
  if (form) {
    const note = $('#fbNote');
    const scoreLabel = $('#fbScore');
    const stars = $$('.fb-star', form);
    let rating = 0;

    const paint = (value) => stars.forEach((s) => {
      const on = Number(s.dataset.value) <= value;
      s.classList.toggle('on', on);
      s.setAttribute('aria-checked', String(Number(s.dataset.value) === rating));
    });

    stars.forEach((star) => {
      star.addEventListener('click', () => {
        rating = Number(star.dataset.value);
        paint(rating);
        scoreLabel.textContent = `${rating} of 5`;
      });
      star.addEventListener('mouseenter', () => paint(Number(star.dataset.value)));
    });
    $('#fbStars').addEventListener('mouseleave', () => paint(rating));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const message = String(data.get('message') || '').trim();

      if (message.length < 10) {
        note.className = 'fb-note bad';
        note.textContent = 'A sentence or two, so there is something to act on.';
        return;
      }

      const submit = $('#fbSubmit');
      submit.disabled = true;
      note.className = 'fb-note';
      note.textContent = 'Sending…';

      /* Netlify Forms would need a build-time form definition, and there is no
         build step here. Opening a prefilled email keeps the message going
         straight to a person, with nothing collected in between. */
      const body = [
        `Rating: ${rating ? `${rating}/5` : 'not given'}`,
        `Name: ${String(data.get('name') || '').trim() || '(not given)'}`,
        `Reply to: ${String(data.get('email') || '').trim() || '(anonymous)'}`,
        '',
        message,
        '',
        `— sent from ${location.href}`,
      ].join(String.fromCharCode(10));

      const href = 'mailto:shashwatmishra062@gmail.com'
        + '?subject=' + encodeURIComponent(`SMARAN.AI feedback${rating ? ` (${rating}/5)` : ''}`)
        + '&body=' + encodeURIComponent(body);

      window.location.href = href;

      setTimeout(() => {
        submit.disabled = false;
        note.className = 'fb-note ok';
        note.textContent = 'Your mail app should have opened with it ready to send.';
      }, 900);
    });
  }


  /* ------------------------------------------------- living mock screens */

  /* The mock screens were pictures of an interface. They now behave like one:
     the hub cycles its filters and re-sorts, the chat answers and waits, the
     call rings. Each loop only runs while its screen is actually on the
     viewport, so nothing burns a phone battery below the fold. */
  let liveStarted = false;
  const liveScreens = () => {
    if (liveStarted) return;
    liveStarted = true;

    const whileVisible = (el, start) => {
      if (!el || !('IntersectionObserver' in window)) return;
      let stop = null;
      const io = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !stop) stop = start();
        else if (!entry.isIntersecting && stop) { stop(); stop = null; }
      }, { threshold: 0.25 });
      io.observe(el);
    };

    /* Model Hub: the filter moves along, and the rows answer it. */
    const hub = $('.hubui');
    whileVisible(hub, () => {
      const tabs = $$('.hub-tabs span', hub);
      const rows = $$('.hub-row', hub);
      let i = 0;
      const tick = () => {
        i = (i + 1) % tabs.length;
        tabs.forEach((t, n) => t.classList.toggle('on', n === i));
        // Re-light a different pair of rows, so the list reads as filtered.
        rows.forEach((r, n) => {
          const dot = r.querySelector('.hub-dot');
          if (dot) dot.classList.toggle('on', (n + i) % 2 === 0);
        });
      };
      const id = setInterval(tick, 1700);
      return () => clearInterval(id);
    });

    /* Workspace: the assistant finishes a reply, then thinks about the next. */
    const chat = $('.ui-chat');
    whileVisible(chat, () => {
      const typing = chat.querySelector('.bub.typing');
      const answer = chat.querySelector('.bub.ai:not(.typing)');
      if (!typing || !answer) return () => {};
      let showing = true;
      const tick = () => {
        showing = !showing;
        typing.style.opacity = showing ? '1' : '0.25';
        answer.style.opacity = showing ? '1' : '0.65';
      };
      const id = setInterval(tick, 1400);
      return () => clearInterval(id);
    });

    /* Speak: the status cycles the way a real call does. */
    const call = $('.callui');
    whileVisible(call, () => {
      const status = call.querySelector('.call-status');
      if (!status) return () => {};
      const states = ['listening', 'thinking', 'speaking', 'listening'];
      let i = 0;
      const tick = () => {
        i = (i + 1) % states.length;
        status.firstChild.textContent = states[i];
      };
      const id = setInterval(tick, 2200);
      return () => clearInterval(id);
    });
  };
  liveScreens();

  /* --------------------------------------------------- scroll parallax */

  /* Section art drifts a little slower than the page. Small numbers on
     purpose: enough to feel like depth, not enough to notice as an effect. */
  if (!calm && window.matchMedia('(pointer: fine)').matches) {
    const layers = [
      { el: $('.orb'), rate: 0.06 },
      { el: $('.meet-stage'), rate: 0.05 },
    ].filter((l) => l.el);

    if (layers.length) {
      let ticking = false;
      const onMove = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          layers.forEach(({ el, rate }) => {
            const r = el.getBoundingClientRect();
            const fromCentre = (r.top + r.height / 2) - window.innerHeight / 2;
            el.style.setProperty('--drift', `${(-fromCentre * rate).toFixed(1)}px`);
          });
          ticking = false;
        });
      };
      onMove();
      window.addEventListener('scroll', onMove, { passive: true });
      window.addEventListener('resize', onMove);
    }
  }


  /* ----------------------------------------------------------- code rain */

  /* Columns of falling glyphs. Characters are drawn from the alphabet the app
     is actually written in - braces, arrows, hex - rather than the katakana
     of the film, because this is a programming tool and not a homage.

     Each column keeps its own head position and speed, and the canvas is
     painted with a translucent black each frame so older glyphs fade instead
     of being cleared, which is what gives the trail. */
  const rainCanvas = $('#codeRain');
  if (rainCanvas) {
    const ctx = rainCanvas.getContext('2d', { alpha: true });
    const GLYPHS = '01{}[]()<>/\|=+-*&^%$#@!?;:.,_~abcdefABCDEF0123456789';
    const FONT_SIZE = 15;
    let columns = [];
    let raf = 0;
    let running = false;

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      rainCanvas.width = innerWidth * dpr;
      rainCanvas.height = innerHeight * dpr;
      rainCanvas.style.width = innerWidth + 'px';
      rainCanvas.style.height = innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'top';

      const count = Math.ceil(innerWidth / (FONT_SIZE + 6));
      columns = Array.from({ length: count }, () => ({
        y: Math.random() * -innerHeight,
        speed: 0.9 + Math.random() * 2.2,
        // A few columns run bright, so the field has some depth to it.
        hot: Math.random() < 0.16,
      }));
    };

    const frame = () => {
      // Fade rather than clear: this is what leaves the tail behind each head.
      ctx.fillStyle = 'rgba(7, 7, 10, 0.09)';
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      const step = FONT_SIZE + 6;
      columns.forEach((col, i) => {
        const x = i * step;
        const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];

        // The head is brightest; everything it has already passed is dimmer.
        ctx.fillStyle = col.hot ? 'rgba(255, 150, 120, .95)' : 'rgba(239, 68, 68, .72)';
        ctx.fillText(glyph, x, col.y);

        col.y += col.speed * (FONT_SIZE * 0.22);
        if (col.y > innerHeight + 40) {
          col.y = -Math.random() * 300;
          col.speed = 0.9 + Math.random() * 2.2;
          col.hot = Math.random() < 0.16;
        }
      });

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      build();
      frame();
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    };

    start();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (running) build(); }, 180);
    });

    // A hidden tab should not keep drawing.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && running) { cancelAnimationFrame(raf); raf = 0; }
      else if (!document.hidden && running && !raf) frame();
    });
  }


  /* ------------------------------------------------------- mascot moods */

  /* She cycles through expressions, lingers on calm, and reacts to the page:
     thinking while the hero line types itself, delighted when someone hovers
     a download. A face that only loops looks like a screensaver; one that
     answers what you are doing looks like it is paying attention. */
  const face = $('.mascot-face');
  if (face) {
    const MOODS = ['calm', 'happy', 'calm', 'think', 'calm', 'wow'];
    let i = 0;
    let hold = 0;

    const show = (mood) => face.setAttribute('data-face', mood);

    const drift = setInterval(() => {
      if (hold > 0) { hold -= 1; return; }
      i = (i + 1) % MOODS.length;
      show(MOODS[i]);
    }, 2600);

    // Reacting beats looping, so these override the cycle for a few beats.
    window.addEventListener('smaran:typing', (e) => {
      if (!e.detail) return;
      show('think');
      hold = 1;
    });

    $$('.btn.no-lift').forEach((btn) => {
      btn.addEventListener('pointerenter', () => { show('happy'); hold = 2; });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearInterval(drift);
    });
  }

})();
