// Offline cache for slow or lost connections (stretch T24).
// Caches only public GET pages, hashed assets and a whitelist of public read-only API endpoints.
// Never touches /api/admin, /api/ussd, /api/telegram or any non-GET request.
const CACHE = 'agrivoice-v1';
const API = ['/api/brief', '/api/prices', '/api/forecast', '/api/alerts', '/api/places', '/api/crops', '/api/markets'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(request, flagCached) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (!hit) throw err;
    if (!flagCached) return hit;
    const headers = new Headers(hit.headers);
    headers.set('x-av-cached', '1');
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/admin') || p.startsWith('/api/admin') || p.startsWith('/api/ussd') || p.startsWith('/api/telegram')) return;
  if (API.some((a) => p === a)) return void event.respondWith(networkFirst(req, true));
  if (p.startsWith('/_astro/')) {
    event.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || networkFirst(req, false)));
    return;
  }
  if (req.mode === 'navigate') event.respondWith(networkFirst(req, false));
});
