const CACHE = 'biblio-v15';
const ASSETS = ['./', './index.html', './style.css', './app.js', './i18n.js', './manifest.json', './icons/icon.svg', './vendor/zxing.min.js', './vendor/qrcode.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }).then((wins) => {
        // Signaler la prise de controle de la nouvelle version -> la page se recharge une seule fois
        wins.forEach((w) => w.postMessage({ type: 'SW-RELOADED', version: CACHE }));
      }))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (e.request.method === 'GET')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
