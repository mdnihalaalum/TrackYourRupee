/**
 * TrackYourRupee Service Worker (Offline-First App Shell Cache)
 * Rule 13 (Caching Layer) & Feature 1 (Installable Offline PWA)
 */
const CACHE_NAME = 'trackyourrupee-shell-v4-1';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './sounds/added.mp3',
  './sounds/deducted.mp3',
  './sounds/orange.mp3',
  './sounds/red.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => null)
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

  // Never intercept Google OAuth or Google Drive API calls
  if (
    url.origin === 'https://accounts.google.com' ||
    url.origin === 'https://www.googleapis.com'
  ) {
    return;
  }

  // Same-origin App Shell: Cache-first with background network refresh
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached || caches.match('./index.html'));

        return cached || networkFetch;
      })
    );
  }
});
