/**
 * TrackYourRupee Service Worker (Hardened Bounded App Shell Cache)
 * Fixes L9: Caches strictly known versioned app shell assets without unbounded cache growth.
 */
const CACHE_NAME = 'trackyourrupee-shell-v4-4-2';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './sounds/added.mp3',
  './sounds/deducted.mp3',
  './sounds/orange.mp3',
  './sounds/red.mp3'
];

const ALLOWED_SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/sounds/added.mp3',
  '/sounds/deducted.mp3',
  '/sounds/orange.mp3',
  '/sounds/red.mp3'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept Google OAuth, Google Drive API, or external font requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only cache known app shell paths (ignores arbitrary query-string cache bloat)
  const normalizedPath = url.pathname.endsWith('/') ? '/' : url.pathname;
  if (!ALLOWED_SHELL_PATHS.has(normalizedPath)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(normalizedPath).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              cache.put(normalizedPath, response.clone());
            }
            return response;
          })
          .catch(() => cached || cache.match('/index.html') || cache.match('./index.html'));

        return cached || networkFetch;
      })
    )
  );
});
