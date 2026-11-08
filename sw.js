// Service worker: makes the app work offline and keeps it up to date.
//
// Strategy: stale-while-revalidate for the app's own files and Google Fonts.
// The cached copy is served instantly (so it works offline and starts fast),
// and a fresh copy is fetched in the background for next time. Code changes
// therefore show up on the next launch without needing to bump CACHE_NAME.
// Everything else (USDA lookups, image generation, Supabase import) goes
// straight to the network and is never cached.

const CACHE_NAME = 'recipe-book-v14';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './localdb.js',
  './nutrition.js',
  './nutrition-data.js',
  './icon-192.png',
  './icon-512.png',
];
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // network only

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: sameOrigin });
    const network = fetch(request)
      .then((response) => {
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network); // refresh in the background
      return cached;
    }
    const fresh = await network;
    if (fresh) return fresh;
    // Offline and not cached: fall back to the app shell for page loads
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
