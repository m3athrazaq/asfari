/* أسفاري — service worker: keeps the web version working fully offline (maps, cities, flags, fonts,
   Excel and PDF engines are all cached on install). Only the app's own files are cached; nothing is
   ever sent anywhere. APPV and ASSETS are written by tools/build.mjs. */
const APPV = '';
const ASSETS = [];
const VERSION = 'asfari-v' + APPV;
const SCOPE = self.registration.scope;
const KNOWN = new Set(ASSETS.map(u => new URL(u, SCOPE).href));

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  // fetch in small batches so a slow phone connection is not flooded
  for (let i = 0; i < ASSETS.length; i += 12) {
    await Promise.all(ASSETS.slice(i, i + 12).map(u => c.add(new Request(u, { cache: 'reload' }))));
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('asfari-') && k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

const cacheable = r => r && r.ok && r.type === 'basic';
const fromCache = req => caches.open(VERSION).then(c => c.match(req, { ignoreSearch: false }));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(SCOPE)) return;
  if (req.mode === 'navigate') {
    // network first so updates arrive; offline, this version's own copy of the page (saved at install
    // together with the files it needs — a newer page is never stored here without them)
    // (a network that hangs — weak signal, hotel Wi-Fi — falls back to it after a few seconds)
    e.respondWith((async () => {
      const net = fetch(req);
      net.catch(() => {}); // a late failure after the cached page was shown is fine
      try {
        return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
      } catch (err) {
        return (await fromCache('./index.html')) || net;
      }
    })());
    return;
  }
  if (!KNOWN.has(url.href)) return;
  e.respondWith(fromCache(req).then(hit => hit || fetch(req).then(r => {
    if (cacheable(r)) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return r;
  })));
});
