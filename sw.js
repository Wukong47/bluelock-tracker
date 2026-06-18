/* ══════════════════════════════════════════════════════════
   EGOIST ENGINE — Service Worker
   Caches all static assets for offline / instant startup.
   Strategy: Cache-First for assets, Network-First for HTML.
══════════════════════════════════════════════════════════ */

const CACHE_NAME   = 'egoist-engine-v1';
const OFFLINE_PAGE = './index.html';

/* Files to pre-cache on install */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './bg.jpg',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

/* ── Install: pre-cache core assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /* Use individual add so one 404 doesn't break everything */
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: delete old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache-First for assets, Network-First for HTML ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Only handle GET requests on same origin + whitelisted CDNs */
  if (event.request.method !== 'GET') return;

  /* Network-First for the HTML document (always fresh) */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(OFFLINE_PAGE))
    );
    return;
  }

  /* Cache-First for everything else (fonts, scripts, images) */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return response;
      });
    })
  );
});
