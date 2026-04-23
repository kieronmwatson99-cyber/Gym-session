// Sessions — service worker
// Cache-first strategy for the main HTML page and its static assets (Google Fonts, CDN libs).
// Version bump invalidates old caches and forces a refresh on next open.
const CACHE_NAME = 'sessions-v8';

self.addEventListener('install', event => {
  // Activate the new SW as soon as it's installed — don't wait for all tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Take control of any open pages immediately, and clean up old cache versions
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension, data:, blob: etc — can't cache those
  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Stale-while-revalidate: serve cached version immediately, update in background.
    // Falls back to network only, and then cache-only if offline.
    const cached = await cache.match(event.request);

    const fetching = fetch(event.request).then(response => {
      // Only cache successful same-origin or opaquely-cacheable responses
      if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
        // Clone before caching — body can only be consumed once
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => cached);

    // Return cached if we have it, else the network response
    return cached || fetching;
  })());
});
