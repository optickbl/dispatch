/* Dispatch service worker: app shell works offline, news is always fetched fresh when online. */
const VERSION = 'dispatch-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css?v=1',
  'app.js?v=1',
  'manifest.webmanifest',
  'icons/icon-192.png?v=2',
  'icons/icon-512.png?v=2',
  'icons/apple-touch-icon.png?v=2',
  'fonts/newsreader-latin-opsz-normal.woff2',
  'fonts/newsreader-latin-ext-opsz-normal.woff2',
  'fonts/newsreader-latin-opsz-italic.woff2',
  'fonts/inter-latin-standard-normal.woff2',
  'fonts/inter-latin-ext-standard-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // News data: network first, fall back to the last copy we saw.
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(url.pathname, copy));
        }
        return res;
      }).catch(() => caches.match(url.pathname).then((r) => r || Response.error()))
    );
    return;
  }

  // Page loads: network first so app updates arrive, cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('index.html', copy));
        return res;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  // Everything else: cache first.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
