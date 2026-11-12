/*
 * Keuangan Harian - pengenal proyek Firebase untuk login Google dan sinkron.
 *
 * Semua nilai di sini adalah pengenal PUBLIK, bukan kata sandi: memang dirancang
 * untuk ditaruh di kode aplikasi web. Yang menjaga data adalah aturan database di
 * Firebase, yang hanya mengizinkan pemilik akun membaca dan menulis datanya sendiri.
 *
 * Kosongkan apiKey untuk mematikan fitur login dan sinkron; aplikasi tetap jalan
 * seperti biasa dengan data di perangkat.
 */
(function (root) {
  'use strict';

  const konfig = {
    apiKey: 'AIzaSyCxm1uorT72Uf4QSopsngb5lFb3pnBBLMs',
    projectId: 'keuangan-harian-ibrayy-001',
    // Domain bawaan proyek. Dipakai sebagai "requestUri" saat menukar token Google.
    authDomain: 'keuangan-harian-ibrayy-001.firebaseapp.com',
    // Realtime Database (Singapore).
    databaseURL: 'https://keuangan-harian-ibrayy-001-default-rtdb.asia-southeast1.firebasedatabase.app',
    // Klien OAuth "Web client (auto created by Google Service)" di Google Cloud.
    idKlienGoogle: '814411724564-6i7oeb7q1ckck7rktmp8dm2gos3piaui.apps.googleusercontent.com'
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = konfig;
  } else {
    root.KeuanganKonfig = konfig;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
