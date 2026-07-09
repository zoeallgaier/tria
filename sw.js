/* Tria push service worker.

   Deliberately caches NOTHING. Tria's freshness model is the ?v= self-updater
   in app.js (it refetches index.html on launch/foreground and reloads on a stamp
   change) — an asset-caching worker would fight that and strand friends on stale
   home-screen installs. So this worker exists for ONE job: receive Web Push and
   open the app when a notification is tapped. No fetch handler, no cache. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A push arrived (works even when Tria is fully closed). The Edge Function sends
// a small JSON payload; we surface it as a system notification.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* non-JSON payload */ }

  const title = data.title || 'Tria';
  const options = {
    body: data.body || '',
    icon: data.icon || 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || undefined,          // same tag collapses duplicates (e.g. one post)
    data: { url: data.url || './#/updates' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an open Tria window (routing it to the target)
// or opens a fresh one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './#/updates';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch (_) { /* cross-doc guard */ } }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
