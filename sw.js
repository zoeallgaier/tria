/* Tria push service worker.

   Still caches NOTHING — no offline store, no stale assets. It does two jobs:
   (1) receive Web Push and open the app when a notification is tapped, and
   (2) keep the app SHELL fresh (see the fetch handler below).

   Why the fetch handler exists: GitHub Pages serves index.html with
   Cache-Control: max-age=600, so an iOS home-screen install can cold-launch
   straight from a 10-minute-stale cached shell — and location.reload() re-reads
   that same cached copy, so the ?v= self-updater's reload can loop on the old
   build and never land. The fix is network-FIRST for navigations: always pull a
   fresh index.html from the network, bypassing the HTTP cache. This is the
   opposite of a caching worker — it can never serve stale, it enforces fresh —
   so it reinforces the ?v= model rather than fighting it. Versioned assets
   (?v=N) are already immutable-by-URL and pass straight through untouched. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Freshness: only top-level navigations (the HTML shell) are intercepted, and
// only to force a cache-bypassing network fetch. `cache: 'reload'` skips the
// HTTP cache on the way out and refreshes it on the way back, so every launch
// and every reload gets the current index.html (and therefore the current
// ?v= asset stamps). Offline falls back to a normal fetch so behaviour is no
// worse than before (we still keep nothing cached, so offline = no shell, as
// it already was). Everything that isn't a navigation is left entirely alone.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request, { cache: 'reload' }).catch(() => fetch(event.request))
  );
});

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
