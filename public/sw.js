const CACHE_NAME = 'stagesync-pwa-v3';
const APP_SHELL = ['/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses or sw.js itself
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') {
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(
        fetch(request).catch(
          () =>
            new Response(
              JSON.stringify({ ok: false, error: '⚠️ 目前離線中，請檢查網路連線後再試。' }),
              { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
            )
        )
      );
    }
    return;
  }

  // Network-first for HTML navigation (always fetch latest SSR page when online)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((m) => m || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate for static assets (/_astro/* has content hashes)
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
