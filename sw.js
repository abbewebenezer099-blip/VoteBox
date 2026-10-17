/* VoteBox service worker.
   Its only job is to let the phone install VoteBox and open the page shell quickly.
   It NEVER stores votes, results or any data from the database: only VoteBox's own page files. */
const CACHE = 'votebox-shell-v2';
const SHELL = ['./', 'index.html', 'app.css', 'core.js', 'auth.js', 'owner.js', 'admin.js', 'voter.js', 'main.js',
               'config.js', 'logo.svg', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // database and library requests go straight to the network
  e.respondWith(
    fetch(req)
      .then(function (res) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res; })
      .catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); })
  );
});
