/*
 * Keuangan Harian - service worker.
 *
 * Hanya didaftarkan saat aplikasi dibuka lewat http/https (lihat app.js).
 * Strategi stale-while-revalidate: file aplikasi langsung dijawab dari cache
 * (cepat dan bisa offline), sambil versi terbaru diambil di latar untuk dipakai
 * saat aplikasi dibuka berikutnya. Data keuangan tidak lewat sini; data ada di
 * localStorage browser. Permintaan ke alamat lain (login Google dan sinkron ke
 * Firebase) juga tidak disentuh: itu selalu langsung ke jaringan.
 *
 * Ganti VERSI kalau daftar file berubah, supaya cache lama dibersihkan.
 */
'use strict';

const VERSI = 'keuangan-harian-v2';
const FILE_APLIKASI = [
  './',
  './css/style.css',
  './js/data.js',
  './js/konfig.js',
  './js/sinkron.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Halaman aplikasi disimpan di satu kunci: folder akarnya ("./").
// Sebagian hosting mengalihkan /index.html ke /, dan Safari menolak
// respons hasil pengalihan untuk navigasi, jadi kunci akar lebih aman.
const URL_AKAR = new URL('./', self.location).href;
const JALUR_AKAR = new URL('./', self.location).pathname;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSI)
      .then(function (cache) {
        // cache: 'reload' supaya tidak mengambil salinan lama dari cache HTTP.
        return cache.addAll(FILE_APLIKASI.map(function (f) { return new Request(f, { cache: 'reload' }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (semua) {
        return Promise.all(semua
          .filter(function (nama) { return nama.indexOf('keuangan-harian-') === 0 && nama !== VERSI; })
          .map(function (nama) { return caches.delete(nama); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(staleWhileRevalidate(event, req, url));
});

function kunciCache(req, url) {
  if (req.mode === 'navigate' && (url.pathname === JALUR_AKAR || url.pathname === JALUR_AKAR + 'index.html')) {
    return URL_AKAR;
  }
  return url.origin + url.pathname; // ?query diabaikan
}

async function salinUntukCache(res) {
  if (!res.redirected) return res.clone();
  const isi = await res.clone().blob();
  return new Response(isi, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function staleWhileRevalidate(event, req, url) {
  const cache = await caches.open(VERSI);
  const kunci = kunciCache(req, url);
  const tersimpan = await cache.match(kunci);

  // cache: 'no-cache' = selalu tanya server lewat permintaan bersyarat (jawaban 304
  // yang kecil kalau file belum berubah). Tanpa ini, cache HTTP browser menjawab
  // sendiri selama max-age dari hosting (GitHub Pages: 10 menit), sehingga server
  // tidak ditanya dan versi baru terlambat terlihat.
  const ambilBaru = fetch(req, { cache: 'no-cache' })
    .then(async function (res) {
      if (res && res.ok && res.type === 'basic') await cache.put(kunci, await salinUntukCache(res));
      return res;
    })
    .catch(function () { return null; }); // offline: tidak apa-apa

  if (tersimpan) {
    event.waitUntil(ambilBaru); // perbarui di latar untuk pembukaan berikutnya
    return tersimpan;
  }
  const baru = await ambilBaru;
  if (baru) return baru;
  if (req.mode === 'navigate') {
    const akar = await cache.match(URL_AKAR);
    if (akar) return akar;
  }
  return Response.error();
}
