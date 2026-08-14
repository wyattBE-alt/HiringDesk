// PathAscent Service Worker
// Caches static assets for fast loads; always fetches API calls fresh.

const CACHE_NAME = 'pathascent-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/recruiter.html',
  '/styles.css',
  '/app.js',
  '/recruiter.js',
  '/manifest.json',
];

// ── Install: pre-cache static shell ──────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for everything (cache is an offline fallback) ────────
// Network-first guarantees users always get the latest deployed code. Cache-first
// previously served stale HTML/JS/CSS after deploys, which broke the UI.

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API calls: always network, never cached.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Everything else: try the network first (fresh code), cache the result,
  // and fall back to cache only when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
