// Bump CACHE_VERSION on every release that changes cached files.
// Only caches created by this app (prefix "kanto151-shell-") are ever deleted;
// the collection lives in localStorage, which the service worker never touches.
const CACHE_VERSION = 'v15';
const CACHE = `kanto151-shell-${CACHE_VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/main.js', './src/binder.js', './src/storage.js', './src/collection.js', './src/filter.js', './src/cloud.js',
  './src/data/pokemon.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // Precache all files into one versioned cache so old/new files never mix.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kanto151-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit; // cache-first from the single versioned cache
      try {
        return await fetch(req);
      } catch {
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
      }
    })
  );
});
