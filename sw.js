/* ===========================================================
   webZa-sys — Service Worker (fonctionnement 100% hors-ligne)
=========================================================== */

const CACHE_NAME = 'webza-sys-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/env.js',
  './js/config.js',
  './js/data.js',
  './js/sync.js',
  './js/repository.js',
  './js/app.js',
  './assets/logo.jpg',
  './assets/warehouse-bg.jpg',
  './assets/splash-bg.png',
  './assets/img-reception.jpg',
  './assets/img-sortie.jpg',
  './assets/img-retour.jpg',
  './assets/img-inventaire.jpg',
  './assets/app-icon.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept calls to the local WMS sync server — always go to network
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
