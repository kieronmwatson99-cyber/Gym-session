// Sessions — service worker
// IMPORTANT: CACHE_NAME must stay 'sessions-' + APP_VERSION (see index.html). A deploy must
// change these bytes, otherwise the browser sees no update and the in-app "update available"
// banner never fires. Bump both together every release.
const CACHE_NAME = 'sessions-v1.24.0';

// S1: app shell precached at install so the app opens offline even on the FIRST launch after
// install. The previous SW cached nothing at install and relied on an earlier online fetch,
// so a fresh install with no network could show a blank page.
const PRECACHE_URLS = ['./', './index.html', './sw.js'];

self.addEventListener('install', event => {
  // Activate the new SW as soon as it's installed — don't wait for all tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(() => {})   // best-effort — a failed precache must never block activation
  );
});

self.addEventListener('activate', event => {
  // Take control of any open pages immediately, and clean up old cache versions.
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Listen for messages from the page — used by the in-app "Update available" banner to force a
// waiting SW to take over without the user closing+reopening. Also handles rest-end
// notification requests; SW-issued notifications survive backgrounding and reach paired watches
// more reliably on Android Chrome than page-issued ones.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'SHOW_REST_NOTIFICATION') {
    const { exerciseName } = event.data;
    const body = exerciseName ? ('Next set: ' + exerciseName) : 'Time for the next set.';
    event.waitUntil(
      self.registration.showNotification('Rest done', {
        body,
        tag: 'rest-end',
        renotify: true,
        vibrate: [160, 80, 160],
        silent: false,
        requireInteraction: false,
        // Icon helps Android render the notification at all — some versions silently drop
        // notifications that lack an icon. Use a relative path resolved against the SW scope.
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iMjAiIGZpbGw9IiMxMDFhMmIiLz48Y2lyY2xlIGN4PSI0OCIgY3k9IjQ4IiByPSIyOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOWJjYmY5IiBzdHJva2Utd2lkdGg9IjUiLz48L3N2Zz4='
      })
    );
  }
});

// Notification click — focus an existing tab if open, or open a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) return client.focus();
    }
    // Q4: open the app at its own scope — NOT '/', which lands on the domain root and 404s/misses
    // when the app is hosted on a GitHub Pages project subpath (e.g. /Gym-session/).
    if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope || './');
  })());
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension, data:, blob: etc — can't cache those
  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

  if (isNavigation) {
    // S2: network-FIRST for the app document, so a fresh deploy is picked up on the next open.
    // (The old stale-while-revalidate served the PREVIOUS version for one launch after deploy.)
    // Falls back to the cached document — then the precached shell — when offline.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(event.request);
        if (fresh && fresh.ok) cache.put(event.request, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await cache.match(event.request);
        return cached || (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Static assets (fonts, CDN libs, etc): stale-while-revalidate — serve cached immediately,
  // refresh in the background, fall back to network then cache.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const fetching = fetch(event.request).then(response => {
      if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => cached);
    return cached || fetching;
  })());
});
