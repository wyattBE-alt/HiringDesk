/* ──────────────────────────────────────────────────────────
   HiringDesk — Home page interactions
   Emil principle: specify exact properties, never `all`.
   Gate hover effects behind pointer: fine to avoid mobile
   false-positives. Animate transform directly in JS during
   mouse move — use CSS transition only for reset.
────────────────────────────────────────────────────────── */

const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 3D card tilt + mouse glow ───────────────────────────
   During movement: update transform directly (no transition
   lag). On leave: smooth spring-like reset via transition.
──────────────────────────────────────────────────────── */

function initCardTilt(card) {
  if (!canHover || prefersReducedMotion) return;

  let isHovered = false;
  let rafId = null;
  let targetRx = 0, targetRy = 0;
  let currentRx = 0, currentRy = 0;

  // Lerp factor — higher = more responsive, lower = smoother
  const LERP = 0.12;
  const MAX_TILT = 6; // degrees

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function tick() {
    if (!isHovered) return;

    currentRx = lerp(currentRx, targetRx, LERP);
    currentRy = lerp(currentRy, targetRy, LERP);

    // Combine tilt with lift — all in one transform call
    card.style.transform =
      `perspective(900px) rotateX(${currentRx.toFixed(3)}deg) rotateY(${currentRy.toFixed(3)}deg) translateY(-8px) translateZ(14px)`;

    rafId = requestAnimationFrame(tick);
  }

  card.addEventListener('mouseenter', () => {
    isHovered = true;
    // Remove any reset transition so tilt is immediate
    card.style.transition = 'border-color 200ms, box-shadow 200ms';
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  });

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Tilt targets (invert X for natural feel)
    targetRx = ((y - cy) / cy) * -MAX_TILT;
    targetRy = ((x - cx) / cx) * MAX_TILT;

    // Mouse glow position — CSS custom property update
    // Note: update on the element, not a child, to limit recalc scope
    const gx = (x / rect.width) * 100;
    const gy = (y / rect.height) * 100;
    card.style.setProperty('--gx', `${gx.toFixed(1)}%`);
    card.style.setProperty('--gy', `${gy.toFixed(1)}%`);
  });

  card.addEventListener('mouseleave', () => {
    isHovered = false;
    cancelAnimationFrame(rafId);
    targetRx = 0;
    targetRy = 0;

    // Smooth reset — spring-like ease-out, faster exit than enter
    card.style.transition =
      'transform 600ms cubic-bezier(0.23, 1, 0.32, 1), border-color 200ms, box-shadow 300ms';
    card.style.transform = '';

    // After reset animation, clear inline transition so CSS takes over
    setTimeout(() => {
      card.style.transition = '';
    }, 620);

    // Reset glow to center
    card.style.setProperty('--gx', '50%');
    card.style.setProperty('--gy', '50%');
  });
}

/* ── Page transition — circle expand from card center ────────
   Emil decision framework:
   1. Animate? YES — navigation is occasional, jarring jump is worse.
   2. Purpose? Spatial — user understands where they're going.
   3. Easing? ease-out (strong) — circle starts fast, slows at edges.
      Physically correct: small circle covers relative area quickly.
   4. Duration? 420ms — modal tier, full-viewport transition.

   Implementation: clip-path circle grows from the card's center.
   clip-path is GPU-composited — runs off the main thread.
   Navigate at 390ms so the new page loads under the full overlay.
   Entry animation on destination pages in styles.css.
──────────────────────────────────────────────────────── */

function initCardTransition(card) {
  card.addEventListener('click', (e) => {
    e.preventDefault();
    const href = card.getAttribute('href');

    // System preference — navigate instantly, no animation
    if (prefersReducedMotion) {
      window.location.href = href;
      return;
    }

    // Snapshot the card center BEFORE locking (getBoundingClientRect needs layout)
    const rect = card.getBoundingClientRect();
    const cx   = Math.round(rect.left + rect.width  / 2);
    const cy   = Math.round(rect.top  + rect.height / 2);

    // Lock all interaction immediately
    document.body.style.pointerEvents = 'none';

    // Fade everything on the page — fast, so the circle is the focal point
    // Don't touch the clicked card's transform — the tilt RAF owns that property
    // and fighting it causes flicker. The overlay covers it anyway.
    const otherId   = card.id === 'card-seeker' ? 'card-recruiter' : 'card-seeker';
    const otherCard = document.getElementById(otherId);
    [
      ...document.querySelectorAll('.hero, .stats, .download, .nav, .footer, .cards'),
    ].filter(Boolean).forEach((el) => {
      el.style.transition = 'opacity 200ms ease';
      el.style.opacity    = '0';
    });
    if (otherCard) {
      otherCard.style.transition = 'opacity 200ms ease';
      otherCard.style.opacity    = '0';
    }

    // Build the overlay off-screen first, then mount — avoids a flash
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: #000;
      z-index: 9999;
      pointer-events: none;
      will-change: clip-path;
      clip-path: circle(0% at ${cx}px ${cy}px);
    `;
    document.body.appendChild(overlay);

    // Two rAF calls: first commits the 0% paint, second starts the expand.
    // Single rAF isn't always enough — some browsers batch same-frame style+paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.transition = 'clip-path 480ms cubic-bezier(0.23, 1, 0.32, 1)';
        overlay.style.clipPath   = `circle(150% at ${cx}px ${cy}px)`;

        // Navigate after animation — new page fades in on top of the overlay
        setTimeout(() => { window.location.href = href; }, 460);
      });
    });
  });
}

/* ── Animated stat counters ──────────────────────────────
   Count up from 0 to target. Triggered once when the
   stats section enters the viewport (IntersectionObserver).
   Uses easeOut for a natural deceleration feel.
──────────────────────────────────────────────────────── */

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function animateCount(el, target, duration = 1200) {
  if (prefersReducedMotion) {
    el.textContent = target + (target === 100 ? '' : 's');
    return;
  }

  const start = performance.now();
  const suffix = target === 40 ? 's' : '';

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const value = Math.round(easeOut(progress) * target);
    el.textContent = value + suffix;
    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function initCounters() {
  const els = document.querySelectorAll('[data-count]');
  if (!els.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count, 10);
      animateCount(el, target);
      observer.unobserve(el);
    });
  }, { threshold: 0.5 });

  els.forEach((el) => observer.observe(el));
}

/* ── Cursor spotlight (subtle ambient follow) ────────────
   A very faint spotlight follows the cursor across the
   entire page. Decorative only — barely noticeable.
──────────────────────────────────────────────────────── */

function initCursorSpotlight() {
  if (!canHover || prefersReducedMotion) return;

  const spotlight = document.createElement('div');
  Object.assign(spotlight.style, {
    position: 'fixed',
    width:    '400px',
    height:   '400px',
    borderRadius: '50%',
    background:   'radial-gradient(circle, rgba(37,99,235,0.04) 0%, transparent 60%)',
    pointerEvents: 'none',
    zIndex:   '0',
    transform: 'translate(-50%, -50%)',
    transition: 'opacity 400ms',
    opacity:   '0',
    top: '-200px',
    left: '-200px',
  });
  document.body.appendChild(spotlight);

  let visible = false;

  document.addEventListener('mousemove', (e) => {
    spotlight.style.left = `${e.clientX}px`;
    spotlight.style.top  = `${e.clientY}px`;

    if (!visible) {
      spotlight.style.opacity = '1';
      visible = true;
    }
  });

  document.addEventListener('mouseleave', () => {
    spotlight.style.opacity = '0';
    visible = false;
  });
}

/* ── OS detection — highlight the right download button ─────
   Detects Mac vs Windows vs other. Adds a "Your platform"
   badge and promotes that button to .primary-dl.
   Only runs once on load — no repeated check needed.
──────────────────────────────────────────────────────── */

function initDownloadDetection() {
  const ua = navigator.userAgent;
  const isMac = /Mac|iPhone|iPad|iPod/.test(ua) && !/Windows/.test(ua);
  const isWin = /Windows/.test(ua);

  const btnId = isMac ? 'dlMac' : isWin ? 'dlWin' : null;
  if (!btnId) return;

  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.classList.add('primary-dl');

  const badge = document.createElement('span');
  badge.className = 'dl-btn-badge';
  badge.textContent = 'Your platform';
  btn.appendChild(badge);

  // Move the detected button to first position
  const container = btn.parentElement;
  container.insertBefore(btn, container.firstChild);
}

/* ── Init ────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.choice-card');

  cards.forEach((card) => {
    initCardTilt(card);
    initCardTransition(card);
  });

  initCounters();
  initCursorSpotlight();
  initDownloadDetection();
});
