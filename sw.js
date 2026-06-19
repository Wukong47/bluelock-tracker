/* ══════════════════════════════════════════════════════════
   EGOIST ENGINE — Service Worker
   Minimal, Chrome-PWA-installability-compliant version.
   Chrome's installability check requires:
     1. A 'fetch' event listener that calls respondWith()
     2. The SW must successfully install + activate
══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'egoist-engine-v2';

/* Core files to pre-cache. Paths are relative to sw.js location. */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ── INSTALL: pre-cache core shell ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Never let a single failed asset block install
        console.warn('[SW] precache warning:', err);
        return self.skipWaiting();
      })
  );
});

/* ── ACTIVATE: clean old caches, take control immediately ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── FETCH: REQUIRED for Chrome's installability check ──
   Strategy: Cache-First, fallback to Network, fallback to
   cached index.html for navigation requests (offline support). */
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Cache successful same-origin responses for next time
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            event.request.url.startsWith(self.location.origin)
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback: serve the app shell for page navigations
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // For other failed requests, return a basic error response
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});
