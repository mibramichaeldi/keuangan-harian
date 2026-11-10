'use strict';
/*
 * Server statis kecil untuk menguji aplikasi lewat http://localhost.
 * Tidak perlu di-hosting dan tanpa dependency (hanya modul bawaan Node).
 *
 *   node tools/server.js          -> http://localhost:8080
 *   node tools/server.js 3000     -> http://localhost:3000
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer(function (req, res) {
  let jalur;
  try {
    jalur = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Alamat tidak valid');
    return;
  }
  if (jalur.endsWith('/')) jalur += 'index.html';
  const berkas = path.join(AKAR, path.normalize(jalur));
  // Jangan keluar dari folder aplikasi, dan jangan sajikan folder tersembunyi (.claude, .git).
  if (!berkas.startsWith(AKAR + path.sep) || /[\\/]\./.test(berkas.slice(AKAR.length))) {
    res.writeHead(403).end('Terlarang');
    return;
  }
  fs.readFile(berkas, function (err, isi) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPE[path.extname(berkas).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(isi);
  });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('Keuangan Harian berjalan di http://localhost:' + PORT + '  (Ctrl+C untuk berhenti)');
});
