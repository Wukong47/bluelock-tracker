/* ══════════════════════════════════════════════════════════
   EGOIST ENGINE — Service Worker v4
══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'egoist-engine-v4';
const PRECACHE_URLS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

/* ── INSTALL ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
  startPeriodicCheck();
});

/* ── FETCH ── */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200 && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

/* ══════════════════════════════════════════════════════════
   NOTIFICATION SCHEDULING
══════════════════════════════════════════════════════════ */

const NOTIF_CACHE = 'egoist-notif-v1';

async function saveSchedule(slots) {
  const cache = await caches.open(NOTIF_CACHE);
  await cache.put('schedule', new Response(JSON.stringify(slots), { headers: { 'Content-Type': 'application/json' } }));
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

async function checkAndFireAlarms() {
  const slots = await loadSchedule();
  if (!slots.length) return;
  const now = new Date();
  const todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
  for (const slot of slots) {
    const fireKey = slot.hour + '-' + slot.minute + '-' + todayKey;
    const lastFired = await loadLastFired(fireKey);
    const slotMinutes = slot.hour * 60 + slot.minute;
    const nowMinutes  = now.getHours() * 60 + now.getMinutes();
    const isMatch     = slotMinutes === nowMinutes && now.getSeconds() < 90;
    const notFiredYet = (Date.now() - lastFired) > 60 * 60 * 1000;
    if (isMatch && notFiredYet) {
      await saveLastFired(fireKey, Date.now());
      await self.registration.showNotification('🔥 Журнал тренировок', {
        body: slot.label || 'Время выполнить привычки!',
        icon: './icon-192.png',
        vibrate: [200, 100, 200],
        tag: fireKey,
        data: { url: self.registration.scope }
      });
    }
  }
}

/* ── MESSAGES FROM PAGE ── */
self.addEventListener('message', async (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (event.data.type === 'SET_SCHEDULE') { await saveSchedule(event.data.slots || []); await checkAndFireAlarms(); }
  if (event.data.type === 'CHECK_NOW')    { await checkAndFireAlarms(); }
});

/* ── NOTIFICATION CLICK ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url === url && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ── PERIODIC CHECK every 30 sec ── */
let _checkInterval = null;
function startPeriodicCheck() {
  if (_checkInterval) return;
  _checkInterval = setInterval(() => checkAndFireAlarms(), 30000);
}
startPeriodicCheck();
