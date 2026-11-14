const CACHE = 'biblio-v169';
const ASSETS = ['./', './index.html', './style.css', './app.js', './i18n.js', './manifest.json', './icons/icon.svg', './vendor/zxing.min.js', './vendor/qrcode.js'];

self.addEventListener('install', (e) => {
  // addAll() consulte AUSSI le cache HTTP du navigateur (GitHub Pages max-age=600) —
  // un install pouvait donc piéger des fichiers périmés DANS le cache SW (bug réel: index.html
  // vieux dans le SW malgré la mise à jour). On fetch chaque asset en no-cache et on put() manuellement.
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await Promise.all(ASSETS.map(async (a) => {
      try { const r = await fetch(a, { cache: 'no-cache' }); if (r.ok) await c.put(a, r); } catch (eA) {}
    }));
  }).then(() => self.skipWaiting()));
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
    // cache:'no-cache' — outrepasse le cache HTTP du navigateur (GitHub Pages sert max-age=600:
    // sans ça, un fetch « réseau » pouvait rendre un index.html périmé pendant 10 min
    // alors que app.js était frais — bug réel: en-têtes UX invisibles malgré la bonne version)
    fetch(e.request, { cache: 'no-cache' })
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
