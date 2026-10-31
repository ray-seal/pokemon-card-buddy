// Bump CACHE_VERSION on every release that changes cached files.
// Only caches created by this app (prefix "kanto151-shell-") are ever deleted;
// the collection lives in localStorage, which the service worker never touches.
const CACHE_VERSION = 'v36';
const CACHE = `kanto151-shell-${CACHE_VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './spin-wheel.css', './manifest.webmanifest',
  './src/main.js', './src/virtual.js', './src/arcade-trades.js', './src/virtual-binder.js', './src/binder.js', './src/storage.js', './src/collection.js', './src/filter.js', './src/cloud.js', './src/friends-cloud.js', './src/friends.js',
  './src/data/pokemon.js', './assets/packs/cardbuddy-starter.svg', './assets/packs/cardbuddy-premium.svg', './assets/packs/cardbuddy-elite.svg', './assets/packs/cardbuddy-legendary.svg',
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

  const url = new URL(req.url);
  const isAppShell = req.mode === 'navigate'
    || /\\.(?:html|js|css|webmanifest)$/.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // App code and HTML are network-first so deployed releases reach installed apps.
    // Cache successful responses for offline launches; bypass the browser HTTP cache.
    if (isAppShell) {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok) await cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
          || Response.error();
      }
    }

    // Keep images and other static assets fast, with a network fallback for new files.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    } catch {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
