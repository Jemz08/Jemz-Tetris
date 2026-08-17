// sw.js — app-shell caching so Jemz Tetris installs as a PWA and works offline.
// Bump CACHE_NAME whenever a shipped file changes so clients pick up the update.
const CACHE_NAME = 'jemz-tetris-v2';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/style.css',
  './src/audio.js',
  './src/auth.js',
  './src/board.js',
  './src/leaderboard.js',
  './src/main.js',
  './src/multiplayer.js',
  './src/online.js',
  './src/pieces.js',
  './src/player.js',
  './src/rank.js',
  './src/scoring.js',
  './src/storage.js',
  './src/ui.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase/Firestore/PeerJS calls: always go to the network — this is live
  // multiplayer/leaderboard traffic, never serve it from cache.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Same-origin app shell files: cache-first, falling back to network,
  // and refreshing the cache in the background (stale-while-revalidate).
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
