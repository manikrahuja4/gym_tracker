const CACHE = 'training-log-v2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './training.js',
  './app.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('training-log-') && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const relative = new URL(url.pathname, url.origin).href;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match(new URL('./index.html', self.registration.scope).href, { cacheName:CACHE })
      .then(cached => cached ?? fetch(event.request)));
  } else if (ASSETS.some(asset => new URL(asset, self.registration.scope).href === relative)) {
    event.respondWith(caches.match(relative, { cacheName:CACHE }).then(cached => cached ?? fetch(event.request)));
  }
});
