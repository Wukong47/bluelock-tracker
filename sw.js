/* ══════════════════════════════════════════════════════════
   EGOIST ENGINE — Service Worker
   Minimal, Chrome-PWA-installability-compliant version.
   Chrome's installability check requires:
     1. A 'fetch' event listener that calls respondWith()
     2. The SW must successfully install + activate
══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'egoist-engine-v3';

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
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
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
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});

/* ══════════════════════════════════════════════════════════
   NOTIFICATION ALARM SYSTEM
   - Страница передаёт расписание через postMessage
   - SW хранит его в IndexedDB и проверяет каждую минуту
   - Работает даже когда вкладка закрыта (на Android PWA)
══════════════════════════════════════════════════════════ */

/* Simple key-value store inside SW using Cache API (no IndexedDB needed) */
const NOTIF_CACHE = 'egoist-notif-schedule-v1';

async function saveSchedule(slots) {
  const cache = await caches.open(NOTIF_CACHE);
  const body = JSON.stringify(slots);
  await cache.put('schedule', new Response(body, {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function loadSchedule() {
  try {
    const cache = await caches.open(NOTIF_CACHE);
    const res = await cache.match('schedule');
    if (!res) return [];
    return await res.json();
  } catch(e) { return []; }
}

async function saveLastFired(key, ts) {
  const cache = await caches.open(NOTIF_CACHE);
  await cache.put('lastfired-' + key, new Response(String(ts)));
}

async function loadLastFired(key) {
  try {
    const cache = await caches.open(NOTIF_CACHE);
    const res = await cache.match('lastfired-' + key);
    if (!res) return 0;
    return parseInt(await res.text()) || 0;
  } catch(e) { return 0; }
}

/* Receive schedule from the page */
self.addEventListener('message', async (event) => {
  if (!event.data) return;

  // Force activate new SW immediately when page asks
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'SET_SCHEDULE') {
    await saveSchedule(event.data.slots || []);
    // Immediately check if anything needs to fire right now
    await checkAndFireAlarms();
  }

  if (event.data.type === 'CHECK_NOW') {
    await checkAndFireAlarms();
  }
});

/* Check alarms and fire if due */
async function checkAndFireAlarms() {
  const slots = await loadSchedule();
  if (!slots.length) return;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  for (const slot of slots) {
    const fireKey = `${slot.hour}-${slot.minute}-${todayKey}`;
    const lastFired = await loadLastFired(fireKey);

    // Check if this slot is due: current time matches within a 90-second window
    const slotMinutes = slot.hour * 60 + slot.minute;
    const nowMinutes  = now.getHours() * 60 + now.getMinutes();
    const secondsIntoMinute = now.getSeconds();

    const isMatch = slotMinutes === nowMinutes && secondsIntoMinute < 90;
    const alreadyFired = lastFired > 0 && (Date.now() - lastFired) < 60 * 60 * 1000; // 1h guard

    if (isMatch && !alreadyFired) {
      await saveLastFired(fireKey, Date.now());
      await self.registration.showNotification('🔥 Журнал тренировок', {
        body: slot.label || 'Время выполнить привычки!',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [200, 100, 200],
        requireInteraction: false,
        tag: fireKey,
        data: { url: self.registration.scope }
      });
    }
  }
}

/* Open app when notification is tapped */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ── Periodic check every minute using setInterval in SW ──
   Note: SW may be killed by the OS on low-end Android.
   For guaranteed delivery the user should install as PWA.    */
let _checkInterval = null;

function startPeriodicCheck() {
  if (_checkInterval) return;
  _checkInterval = setInterval(async () => {
    const slots = await loadSchedule();
    if (slots.length > 0) {
      await checkAndFireAlarms();
    }
  }, 30 * 1000); // check every 30 seconds
}

/* Start checking as soon as SW activates */
self.addEventListener('activate', () => {
  startPeriodicCheck();
});

startPeriodicCheck();


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
