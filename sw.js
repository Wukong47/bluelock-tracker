/* ══════════════════════════════════════════════════════════
   EGOIST ENGINE — Service Worker v5
══════════════════════════════════════════════════════════ */

const CACHE_NAME  = 'egoist-engine-v5';
const NOTIF_CACHE = 'egoist-notif-v2';
const PRECACHE    = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

/* ── INSTALL ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== NOTIF_CACHE)
        .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
  startPeriodicCheck();
  // Register periodic background sync if supported
  self.registration.periodicSync && self.registration.periodicSync
    .register('habit-check', { minInterval: 60 * 1000 })
    .catch(() => {});
});

/* ── FETCH ── */
self.addEventListener('fetch', event => {
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

/* ── PERIODIC SYNC (Android background wake-up) ── */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'habit-check') {
    event.waitUntil(checkAndFireAlarms());
  }
});

/* ══════════════════════════════════════════════════════════
   SCHEDULE STORAGE
══════════════════════════════════════════════════════════ */
async function saveSchedule(slots) {
  const c = await caches.open(NOTIF_CACHE);
  await c.put('schedule', new Response(JSON.stringify(slots), {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function loadSchedule() {
  try {
    const c = await caches.open(NOTIF_CACHE);
    const r = await c.match('schedule');
    return r ? await r.json() : [];
  } catch(e) { return []; }
}

async function getFiredKey(key) {
  try {
    const c = await caches.open(NOTIF_CACHE);
    const r = await c.match('fired-' + key);
    return r ? parseInt(await r.text()) || 0 : 0;
  } catch(e) { return 0; }
}

async function setFiredKey(key) {
  const c = await caches.open(NOTIF_CACHE);
  await c.put('fired-' + key, new Response(String(Date.now())));
}

/* ══════════════════════════════════════════════════════════
   ALARM CHECK — отдельное уведомление на каждую привычку
══════════════════════════════════════════════════════════ */
async function checkAndFireAlarms() {
  const slots = await loadSchedule();
  if (!slots.length) return;

  const now      = new Date();
  const todayStr = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
  const nowMin   = now.getHours() * 60 + now.getMinutes();

  for (const slot of slots) {
    const slotMin = slot.hour * 60 + slot.minute;
    const diff    = Math.abs(slotMin - nowMin);
    if (diff > 1) continue; // срабатываем в окне ±1 минута

    const firedKey  = slot.hour + ':' + slot.minute + ':' + todayStr;
    const lastFired = await getFiredKey(firedKey);
    const cooldown  = 55 * 60 * 1000; // не повторять чаще 55 минут
    if (lastFired && (Date.now() - lastFired) < cooldown) continue;

    await setFiredKey(firedKey);

    const habits = slot.habits || [];

    if (!habits.length) {
      // нет привычек — одно общее уведомление
      await self.registration.showNotification('🔥 Журнал тренировок', {
        body: 'Время выполнить привычки!',
        icon: './icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'habits-' + firedKey,
        data: { url: self.registration.scope }
      });
      continue;
    }

    // Отдельное уведомление на каждую привычку с задержкой 400мс
    for (let i = 0; i < habits.length; i++) {
      const h = habits[i];
      await new Promise(res => setTimeout(res, i * 400));
      await self.registration.showNotification(h.icon + ' ' + h.name, {
        body: 'Не забудь выполнить привычку сегодня!',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [150, 80, 150],
        tag: 'habit-' + h.id + '-' + firedKey,
        data: { url: self.registration.scope }
      });
    }
  }
}

/* ── MESSAGES ── */
self.addEventListener('message', async event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING')  { self.skipWaiting(); return; }
  if (event.data.type === 'SET_SCHEDULE')  { await saveSchedule(event.data.slots || []); }
  if (event.data.type === 'CHECK_NOW')     { await checkAndFireAlarms(); }
});

/* ── NOTIFICATION CLICK ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ── PERIODIC CHECK every 30 sec (while SW alive) ── */
let _interval = null;
function startPeriodicCheck() {
  if (_interval) return;
  _interval = setInterval(() => checkAndFireAlarms(), 30 * 1000);
}
startPeriodicCheck();
