// ── RC Toolkit Service Worker ──────────────────────────────────────
// Version bump this string to force cache refresh on updates
const CACHE_NAME = 'rc-toolkit-v1';

// Core assets to pre-cache so the app works fully offline
const PRECACHE_URLS = [
  './rc_toolkit.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Google Fonts are cached on first load (see fetch handler below)
];

// ── INSTALL: pre-cache core assets ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Use individual adds so one missing file won't break the install
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(() => {
          console.warn('[SW] Pre-cache miss (non-fatal):', url);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for same-origin, stale-while-revalidate for fonts ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Google Fonts: stale-while-revalidate (serve cached, update in background)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin assets: cache-first with network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: network only (don't cache 3rd-party CDN resources)
  // They'll still work online; offline they'll just fail gracefully.
});

// ── Cache-first strategy ─────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — return a minimal offline page for navigation
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./rc_toolkit.html');
      if (fallback) return fallback;
    }
    return new Response('Offline — please reconnect to load this resource.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ── Stale-while-revalidate strategy ─────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchPromise;
}
