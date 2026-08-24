const CACHE_NAME = 'geosnap-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './screenshot-narrow.jpg',
  './screenshot-wide.webp'
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('SW: failed to cache', asset, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
// ---- Web Push: fires even when the app is closed/backgrounded ----
// This is what actually delivers the lunch/break/end-of-shift reminders
// sent by the Cloudflare Worker cron job. The old setTimeout-based
// reminders in index.html only worked while the app was open in memory.
//
// The vibrate pattern and silent flag now come from the server (based on
// the user's chosen vibration preference: Gentle / Standard / Strong /
// Silent), instead of always using one hardcoded pattern.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'GeoSnap';
  const body = data.body || '';
  const vibratePattern = Array.isArray(data.vibrate) ? data.vibrate : [80, 40, 80];
  const silent = !!data.silent;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'geosnap-schedule',
      vibrate: vibratePattern,
      silent
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});
// If the browser rotates the push subscription under the hood, re-register
// it with the Worker so reminders keep working.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((newSub) => {
        return self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
          clientsArr.forEach((c) => c.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: newSub.toJSON() }));
        });
      })
  );
});
