/* Service worker — Absensi Omah Kebon
 * Cache app shell supaya app terbuka cepat & bisa dipasang ke homescreen.
 * Panggilan API (script.google.com) TIDAK pernah di-cache.
 * Naikkan angka VERSI setiap kali ada perubahan file frontend.
 */

var VERSI = 'absensi-ok-v4';

var APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(VERSI)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== VERSI;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // API & semua request lintas-origin: langsung ke jaringan, tanpa cache
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // App shell: network-first supaya update frontend cepat terambil,
  // fallback ke cache kalau offline.
  // cache: 'no-cache' → selalu revalidasi ke server (ETag), jangan pakai
  // cache HTTP browser — CDN GitHub Pages set max-age=600 yang bisa
  // menyajikan file lama sampai 10 menit setelah deploy.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(function (res) {
        var salinan = res.clone();
        caches.open(VERSI).then(function (cache) {
          cache.put(event.request, salinan);
        });
        return res;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
