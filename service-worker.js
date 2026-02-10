const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './ui-icons.js',
  './icon-prune.js',
  './history.js',
  './seguimiento.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const hashVersion = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const APP_VERSION = hashVersion(PRECACHE_ASSETS.join('|'));
const PRECACHE_NAME = `entreno-precache-${APP_VERSION}`;
const RUNTIME_NAME = `entreno-runtime-${APP_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' })))
        )
      )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE_NAME && key !== RUNTIME_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const respondWithNavigation = async (request) => {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    const cached = await caches.match('./index.html');
    return cached || Response.error();
  }
};

const respondWithStaleWhileRevalidate = async (request) => {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) {
    return networkResponse;
  }

  if (request.destination === 'document') {
    return caches.match('./index.html');
  }

  return Response.error();
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(respondWithNavigation(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(respondWithStaleWhileRevalidate(request));
});
