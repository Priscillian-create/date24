const CACHE_NAME = 'pa-gerrys-mart-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const fails = [];
      for (const url of urlsToCache) {
        try {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (res && res.ok) {
            await cache.put(url, res);
          } else {
            fails.push(url);
          }
        } catch (_) {
          fails.push(url);
        }
      }
      if (fails.length) {
        console.warn('[SW] Some assets failed to cache:', fails);
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim()).then(async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => {
        c.postMessage({ type: 'SW_ACTIVATED', cache: CACHE_NAME });
      });
    })
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (url.includes('livereload')) {
    event.respondWith(new Response('', { status: 204, statusText: 'No Content' }));
    return;
  }
  if (url.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).catch(() => caches.match('/'));
    })
  );
});
