/*
 * Keuangan Harian - tampilan: layar, form, navigasi.
 *
 * Semua aturan data & perhitungan ada di js/data.js (window.KeuanganData).
 * Login Google dan kirim-ambil data ada di js/sinkron.js (window.KeuanganSinkron).
 * File ini mengurus routing lewat hash (#/...), menggambar layar, form Catat,
 * dialog konfirmasi, toast, menyimpan ke localStorage, dan kapan sinkron dijalankan.
 *
 * String di file ini sengaja ASCII; simbol memakai entitas HTML (&rarr; dll).
 */
(function () {
  'use strict';

  const D = window.KeuanganData;
  if (!D) {
    document.body.textContent = 'Gagal memuat js/data.js.';
    return;
  }

  const NAMA_APLIKASI = 'Keuangan Harian';
  const VERSI_APLIKASI = '1.1';
  const LEWAT_WEB = location.protocol === 'http:' || location.protocol === 'https:';
  const TAB = ['beranda', 'riwayat', 'laporan', 'pengaturan'];
  const JUDUL_LAYAR = { beranda: 'Beranda', riwayat: 'Riwayat', laporan: 'Laporan', pengaturan: 'Pengaturan' };
  const TIPE = ['keluar', 'masuk', 'transfer'];
  const DIGIT_MAKS = String(D.JUMLAH_MAKS).length; // 12 digit
  const TITIK = ' ' + String.fromCharCode(0xB7) + ' '; // titik tengah (U+00B7) untuk teks biasa, bukan HTML
  const IKON_KIRI = '<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  const IKON_KANAN = '<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg>';

  // ===========================================================================
  // Bantuan
  // ===========================================================================

  function $(pemilih, akar) {
    return (akar || document).querySelector(pemilih);
  }

  function $$(pemilih, akar) {
    return Array.prototype.slice.call((akar || document).querySelectorAll(pemilih));
  }

  const PETA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(teks) {
    return String(teks == null ? '' : teks).replace(/[&<>"']/g, function (c) { return PETA_ESC[c]; });
  }

  /** +Rp untuk pemasukan, -Rp untuk pengeluaran, tanpa tanda untuk transfer. */
  function teksJumlah(t) {
    if (t.tipe === 'masuk') return D.formatRupiah(t.jumlah, { tanda: true });
    if (t.tipe === 'keluar') return D.formatRupiah(-t.jumlah);
    return D.formatRupiah(t.jumlah);
  }

  function namaAkun(id) {
    const a = D.cariAkun(data, id);
    return a ? a.nama : '(akun tidak ada)';
  }

  function namaKategori(id) {
    const k = D.cariKategori(data, id);
    return k ? k.nama : '(kategori tidak ada)';
  }

  /** Ringkasan satu kalimat (teks biasa) untuk dialog konfirmasi. */
  function ringkasTransaksi(t) {
    const bagian = [D.LABEL_TIPE[t.tipe] + ' ' + D.formatRupiah(t.jumlah)];
    if (t.tipe === 'transfer') bagian.push('dari ' + namaAkun(t.akunId) + ' ke ' + namaAkun(t.akunTujuanId));
    else bagian.push(namaKategori(t.kategoriId), namaAkun(t.akunId));
    bagian.push(D.formatTanggalPanjang(t.tanggal));
    return bagian.join(', ') + '.';
  }

  /**
   * Rapikan isian uang saat mengetik: hanya angka, titik ribuan otomatis,
   * maksimal 12 digit, posisi kursor dipertahankan. Menghapus titik ribuan
   * ikut menghapus angka di sebelahnya.
   */
  function formatIsianUang(input, e) {
    const nilai = input.value;
    const kursor = input.selectionStart == null ? nilai.length : input.selectionStart;
    let sebelumKursor = nilai.slice(0, kursor).replace(/\D/g, '').length;
    let digit = nilai.replace(/,0{1,2}$/, '').replace(/\D/g, '');
    const lama = input.getAttribute('data-digit') || '';
    if (e && digit === lama) {
      if (e.inputType === 'deleteContentBackward' && sebelumKursor > 0) {
        digit = digit.slice(0, sebelumKursor - 1) + digit.slice(sebelumKursor);
        sebelumKursor -= 1;
      } else if (e.inputType === 'deleteContentForward' && sebelumKursor < digit.length) {
        digit = digit.slice(0, sebelumKursor) + digit.slice(sebelumKursor + 1);
      }
    }
    const tanpaNol = digit.replace(/^0+(?=\d)/, '');
    sebelumKursor = Math.max(0, sebelumKursor - (digit.length - tanpaNol.length));
    digit = tanpaNol.slice(0, DIGIT_MAKS);
    input.setAttribute('data-digit', digit);

    const baru = digit ? D.formatAngka(Number(digit)) : '';
    if (baru === nilai) return;
    input.value = baru;
    if (document.activeElement !== input) return;
    const target = Math.min(sebelumKursor, digit.length);
    let posisi = 0;
    let hitung = 0;
    while (posisi < baru.length && hitung < target) {
      if (baru.charAt(posisi) !== '.') hitung += 1;
      posisi += 1;
    }
    input.setSelectionRange(posisi, posisi);
  }

  function unduhFile(namaFile, isi, tipe) {
    const blob = new Blob([isi], { type: tipe });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = namaFile;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function nilaiRadioDi(akar, nama) {
    const r = akar.querySelector('input[name="' + nama + '"]:checked');
    return r ? r.value : null;
  }

  /** 1762571700000 -> 'Minggu, 8 November 2026 pukul 10.15' (waktu lokal) */
  function formatWaktu(ms) {
    const d = new Date(ms);
    return D.formatTanggalPanjang(D.tanggalLokal(d)) + ' pukul ' +
      String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0');
  }

  /** '2026-11-08' -> '8 November 2026' */
  function formatTanggalSingkat(tanggal) {
    const d = D.tanggalKeDate(tanggal);
    return d.getDate() + ' ' + D.NAMA_BULAN[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** Begitu isian yang salah diubah, pesan galatnya disembunyikan. */
  function hapusGalatSaatDiubah(e) {
    const el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('aria-invalid') === 'true') {
      el.removeAttribute('aria-invalid');
      (el.getAttribute('aria-describedby') || '').split(/\s+/).forEach(function (id) {
        const p = id ? document.getElementById(id) : null;
        if (p && p.classList.contains('galat')) { p.hidden = true; p.textContent = ''; }
      });
    }
    const grup = el.type === 'radio' ? el.closest('fieldset') : null;
    const pesan = grup ? grup.querySelector('.galat:not([hidden])') : null;
    if (pesan) { pesan.hidden = true; pesan.textContent = ''; }
  }

  /** 'keuangan-harian:v1:rusak:2026-11-08T01-35-54' -> 'Minggu, 8 November 2026 pukul 01.35' */
  function labelSalinan(kunci) {
    const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(kunci);
    return m && D.tanggalValid(m[1]) ? D.formatTanggalPanjang(m[1]) + ' pukul ' + m[2] + '.' + m[3] : kunci;
  }

  /**
   * Pesan galat di form. peta: { kolom: { pesan: '#id-pesan', isian: 'pemilih isian' } }.
   * Kolom yang tidak dikenal tampil di kotak galat umum (.galat-form) di atas form.
   */
  function pengelolaGalat(form, peta) {
    function bersihkan() {
      $$('.galat, .galat-form', form).forEach(function (p) { p.hidden = true; p.textContent = ''; });
      $$('[aria-invalid]', form).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    }
    function tampilkan(kolom, pesan) {
      const t = kolom ? peta[kolom] : null;
      const p = t ? $(t.pesan, form) : null;
      if (!p) {
        const umum = $('.galat-form', form);
        umum.textContent = pesan;
        umum.hidden = false;
        umum.scrollIntoView({ block: 'nearest' });
        return;
      }
      p.textContent = pesan;
      p.hidden = false;
      const isian = t.isian ? $(t.isian, form) : null;
      if (isian) {
        if (isian.type !== 'radio') isian.setAttribute('aria-invalid', 'true');
        isian.focus();
      }
    }
    return { tampilkan: tampilkan, bersihkan: bersihkan };
  }

  // ===========================================================================
  // Keadaan & penyimpanan
  // ===========================================================================

  const penyimpanan = ambilPenyimpanan();
  let data = null;            // data aktif (bentuknya lihat data.js)
  let infoMuat = null;        // hasil D.muatData saat aplikasi dibuka
  let modeSimpan = 'normal';  // 'normal' | 'memori' (tanpa localStorage) | 'tertahan' (data rusak belum diamankan)
  let pemberitahuan = [];     // kartu pemberitahuan di atas layar
  let layarAktif = null;      // { nama, param }
  let lembarAktif = null;     // { kunci, nama, dariAplikasi, kunciFokusAsal }
  let antreanSetelahTutup = [];
  let sudahMulai = false;

  function ambilPenyimpanan() {
    try {
      return window.localStorage;
    } catch (galat) {
      // Mis. browser memblokir penyimpanan: muatData akan melapor 'tanpa-penyimpanan'.
      return {
        getItem: function () { throw galat; },
        setItem: function () { throw galat; },
        removeItem: function () {},
        key: function () { return null; },
        length: 0
      };
    }
  }

  /**
   * Simpan data baru lalu gambar ulang layar.
   * Kalau gagal disimpan, data di layar TIDAK berubah dan pesannya dikembalikan.
   */
  function simpan(dataBaru) {
    if (modeSimpan === 'tertahan') {
      return { ok: false, pesan: 'Belum bisa menyimpan. Unduh dulu data lama, lalu pilih "Mulai data baru".' };
    }
    if (modeSimpan === 'normal') {
      const hasil = D.simpanData(penyimpanan, dataBaru);
      if (!hasil.ok) return hasil;
    }
    data = dataBaru;
    gambarUlang();
    if (data.transaksi.length) mintaPenyimpananTetap();
    jadwalkanSinkron(JEDA_SETELAH_SIMPAN);
    return { ok: true };
  }

  let sudahMintaTetap = false;

  /**
   * Minta browser tidak menghapus data saat ruang penyimpanan menipis.
   * Diminta setelah ada transaksi (bukan saat halaman dibuka) karena Firefox
   * menampilkan pertanyaan untuk ini.
   */
  function mintaPenyimpananTetap() {
    if (sudahMintaTetap || !LEWAT_WEB || !navigator.storage || !navigator.storage.persist) return;
    sudahMintaTetap = true;
    navigator.storage.persisted()
      .then(function (sudah) { return sudah || navigator.storage.persist(); })
      .catch(function () { /* tidak didukung: abaikan */ });
  }

  /**
   * Manifest (syarat dipasang di HP) hanya lewat http/https. Di file:// Chrome
   * menolak mengambilnya dan mencatat galat di konsol, jadi tidak dipasang.
   */
  function pasangManifest() {
    if (!LEWAT_WEB || document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }

  /** Service worker hanya untuk http/https; file:// tidak mendukungnya (dan memang sudah lokal). */
  function daftarkanServiceWorker() {
    if (!LEWAT_WEB || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (layarAktif && layarAktif.nama === 'pengaturan') gambarUlang();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // Gagal (mis. mode privat): aplikasi tetap jalan, hanya tanpa mode offline.
      });
    });
  }

  function teksStatusOffline() {
    if (!LEWAT_WEB) {
      return 'Dibuka sebagai file di perangkat ini, jadi tidak butuh internet. Untuk dipasang di HP, aplikasi perlu di-hosting lewat https (lihat README).';
    }
    if (!('serviceWorker' in navigator)) return 'Browser ini tidak mendukung mode tanpa internet.';
    if (navigator.serviceWorker.controller) return 'Siap dipakai tanpa internet.';
    return 'Mode tanpa internet sedang disiapkan. Buka ulang aplikasi sebentar lagi.';
  }

  // ===========================================================================
  // Masuk dengan Google & sinkron antar perangkat
  //
  // Login, kirim-ambil, dan penggabungan data ada di js/sinkron.js dan js/data.js.
  // Di sini hanya: kapan sinkron dijalankan, dan bagaimana hasilnya ditampilkan.
  // Aplikasi tetap bekerja penuh tanpa masuk dan tanpa internet; sinkron menyusul.
  // ===========================================================================

  const S = window.KeuanganSinkron || null;
  const DI_KOMPUTER_SENDIRI = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const JEDA_SETELAH_SIMPAN = 1500;      // beberapa perubahan beruntun cukup satu kiriman
  const JEDA_BERKALA = 60000;            // selagi aplikasi terbuka: tanya awan tiap menit (permintaan kecil)
  const JEDA_ANTAR_OTOMATIS = 10000;     // jarak terdekat dua sinkron otomatis
  const JEDA_SETELAH_GAGAL = 5 * 60000;  // sesudah gagal bukan karena jaringan, jangan terus-menerus mencoba
  const HARI_MASUK_ULANG = 150;          // Google menghapus klien login yang 6 bulan tidak dipakai
  const MS_SEHARI = 24 * 60 * 60 * 1000;

  const sinkron = S && window.KeuanganKonfig ? S.buatSinkron({
    konfig: window.KeuanganKonfig,
    ambil: function (url, init) { return window.fetch(url, init); },
    penyimpanan: penyimpanan,
    // Alamat folder aplikasi, persis seperti yang didaftarkan di Google (diakhiri "/").
    alamatKembali: location.origin + location.pathname.replace(/[^/]*$/, ''),
    // Di komputer sendiri (localhost) data disimpan di cabang terpisah, supaya percobaan
    // tidak pernah bercampur dengan data sungguhan.
    cabang: DI_KOMPUTER_SENDIRI ? 'uji' : undefined
  }) : null;

  let sinkronBerjalan = 0;       // jumlah sinkron yang sedang ditunggu
  let galatSinkron = null;       // { jenis, pesan } dari sinkron terakhir yang gagal
  let galatDitampilkan = '';     // supaya kartu galat yang sama tidak muncul berulang-ulang
  let sudahDitanyaSambung = false;
  let pewaktuSinkron = null;
  let sinkronTerakhirDicoba = 0;

  /** Sinkron bisa dipakai: dibuka lewat http(s), konfigurasi ada, dan data bisa disimpan. */
  function sinkronSiap() {
    return !!sinkron && sinkron.tersedia() && modeSimpan === 'normal';
  }

  /** Keadaan login (tanpa token), atau null kalau belum masuk atau sinkron tidak bisa dipakai. */
  function sesiGoogle() {
    return sinkronSiap() ? sinkron.sesi() : null;
  }

  /** Sudah masuk DAN data perangkat ini sudah disamakan dengan data di akun Google. */
  function tersambung() {
    const sesi = sesiGoogle();
    return !!sesi && sesi.terhubung;
  }

  /**
   * Kembali dari halaman login Google: jawabannya ada di bagian # alamat. Diambil
   * sebelum routing berjalan, dan langsung dibuang dari alamat supaya token tidak
   * tertinggal di kolom alamat maupun riwayat browser.
   */
  function ambilJawabanLogin() {
    const hash = location.hash;
    if (!sinkron || !sinkron.adaJawabanLogin(hash)) return null;
    history.replaceState(null, '', location.pathname + location.search + '#/pengaturan');
    return hash;
  }

  /** 'hari ini pukul 10.15', 'kemarin pukul 21.03', atau '8 November 2026 pukul 10.15'. */
  function formatWaktuRingkas(ms) {
    const d = new Date(ms);
    const jam = 'pukul ' + String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0');
    const tanggal = D.tanggalLokal(d);
    const hariIni = D.tanggalLokal();
    if (tanggal === hariIni) return 'hari ini ' + jam;
    if (tanggal === D.geserTanggal(hariIni, -1)) return 'kemarin ' + jam;
    return formatTanggalSingkat(tanggal) + ' ' + jam;
  }

  function teksStatusSinkron(sesi) {
    if (sesi.perluMasukLagi) return 'Sesi login berakhir. Masuk lagi untuk melanjutkan sinkron.';
    if (sinkronBerjalan > 0) return 'Menyinkronkan...';
    if (!sesi.terhubung) return 'Belum disambungkan ke data di akun Google.';
    const terakhir = sesi.sinkronTerakhir ? 'Terakhir tersinkron ' + formatWaktuRingkas(sesi.sinkronTerakhir) + '.' : '';
    if (galatSinkron && galatSinkron.jenis === 'jaringan') {
      return ('Belum tersinkron: server tidak bisa dihubungi. Dicoba lagi otomatis. ' + terakhir).trim();
    }
    if (galatSinkron) return 'Sinkron berhenti: ' + galatSinkron.pesan;
    return sesi.sinkronTerakhir ? 'Tersinkron ' + formatWaktuRingkas(sesi.sinkronTerakhir) + '.' : 'Belum pernah tersinkron.';
  }

  /** Satu baris kecil di Beranda; hanya keadaan terakhir, tanpa "sedang menyinkronkan". */
  function htmlStatusBeranda() {
    const sesi = sesiGoogle();
    if (!sesi) return '';
    let teks;
    if (sesi.perluMasukLagi) teks = 'Sinkron berhenti: perlu masuk lagi';
    else if (!sesi.terhubung) teks = 'Belum disambungkan ke akun Google';
    else if (galatSinkron) teks = 'Belum tersinkron';
    else if (sesi.sinkronTerakhir) teks = 'Tersinkron ' + formatWaktuRingkas(sesi.sinkronTerakhir);
    else teks = 'Belum pernah tersinkron';
    return esc(teks);
  }

  function htmlIsiSinkron() {
    if (!sinkron || !sinkron.tersedia()) {
      return '<p class="petunjuk">Masuk dengan Google untuk menyamakan data antara HP dan laptop hanya bisa dipakai kalau aplikasi dibuka dari alamat https, bukan sebagai file.</p>';
    }
    if (modeSimpan !== 'normal') {
      return '<p class="petunjuk">Sinkron belum bisa dipakai selama data di browser ini belum bisa disimpan.</p>';
    }
    const catatanUji = DI_KOMPUTER_SENDIRI
      ? '<p class="petunjuk">Mode percobaan (localhost): data sinkron di sini disimpan terpisah dari data sungguhan.</p>'
      : '';
    const sesi = sinkron.sesi();
    if (!sesi) {
      return `
        <p class="petunjuk">Masuk dengan akun Google supaya catatan di HP dan laptop selalu sama. Tanpa masuk pun aplikasi tetap bisa dipakai seperti biasa.</p>
        ${catatanUji}
        <button type="button" class="tombol tombol-utama lebar jarak-atas" data-aksi="masuk-google" data-kunci-fokus="masuk-google">Masuk dengan Google</button>`;
    }

    const sudahLama = !sesi.perluMasukLagi && !!sesi.masukPada && Date.now() - sesi.masukPada > HARI_MASUK_ULANG * MS_SEHARI;
    let tombolUtama;
    if (sesi.perluMasukLagi) {
      tombolUtama = '<button type="button" class="tombol tombol-utama lebar" data-aksi="masuk-google" data-kunci-fokus="masuk-google">Masuk lagi</button>';
    } else if (!sesi.terhubung) {
      tombolUtama = '<button type="button" class="tombol tombol-utama lebar" data-aksi="sambungkan" data-kunci-fokus="sambungkan">Sambungkan sekarang</button>';
    } else {
      tombolUtama = '<button type="button" class="tombol tombol-kedua lebar" data-aksi="sinkron-sekarang" data-kunci-fokus="sinkron-sekarang">Sinkronkan sekarang</button>';
    }
    return `
      <dl class="akun-google">
        <dt class="label-kecil">Masuk sebagai</dt>
        <dd>${esc(sesi.email || sesi.nama || 'akun Google')}</dd>
      </dl>
      <p class="status-sinkron" id="status-sinkron">${esc(teksStatusSinkron(sesi))}</p>
      ${catatanUji}
      ${sudahLama ? '<p class="petunjuk">Sudah lebih dari 5 bulan sejak terakhir masuk. Masuk ulang sekali supaya login Google untuk aplikasi ini tetap aktif.</p>' : ''}
      <div class="tumpuk-tombol">
        ${tombolUtama}
        ${sudahLama ? '<button type="button" class="tombol tombol-kedua lebar" data-aksi="masuk-google" data-kunci-fokus="masuk-ulang">Masuk ulang</button>' : ''}
        <button type="button" class="tombol tombol-teks lebar" data-aksi="keluar-google" data-kunci-fokus="keluar-google">Keluar</button>
      </div>`;
  }

  /** Perbarui bagian sinkron yang sedang tampil, tanpa menggambar ulang seluruh layar. */
  function perbaruiTampilanSinkron() {
    const bagian = $('#isi-sinkron');
    if (bagian) {
      const aktif = document.activeElement;
      const kunci = aktif && bagian.contains(aktif) ? aktif.getAttribute('data-kunci-fokus') : null;
      bagian.innerHTML = htmlIsiSinkron();
      if (kunci) {
        const el = bagian.querySelector('[data-kunci-fokus="' + kunci + '"]') || bagian.querySelector('button');
        if (el) el.focus({ preventScroll: true });
      }
    }
    const ringkas = $('#status-beranda');
    if (ringkas) ringkas.innerHTML = htmlStatusBeranda();
  }

  function mulaiMasuk() {
    if (!sinkronSiap()) return;
    if (navigator.onLine === false) {
      tampilkanToast('Tidak ada sambungan internet. Coba lagi saat sudah tersambung.');
      return;
    }
    const alamat = sinkron.urlLogin();
    if (!alamat) {
      tampilkanToast('Browser menolak menyimpan data, jadi login tidak bisa dimulai.');
      return;
    }
    location.assign(alamat); // ke halaman login Google; kembalinya ditangani ambilJawabanLogin
  }

  async function selesaikanMasuk(jawaban) {
    const h = await sinkron.selesaikanLogin(jawaban);
    if (!h.ok) {
      perbaruiTampilanSinkron();
      if (h.jenis === 'batal') tampilkanToast(h.pesan);
      else await pesanDialog('Masuk tidak berhasil', h.pesan + ' Catatan di perangkat ini tidak berubah.');
      return;
    }
    galatSinkron = null;
    galatDitampilkan = '';
    sudahDitanyaSambung = false;
    hapusPemberitahuan('sinkron');
    hapusPemberitahuan('masuk-ulang');
    gambarUlang();
    tampilkanToast('Masuk sebagai ' + (h.sesi.email || 'akun Google') + '.');
    jalankanSinkron({ tanya: true, dariPengguna: true });
  }

  async function keluarGoogle() {
    const sesi = sesiGoogle();
    if (!sesi) return;
    const ya = await konfirmasi({
      judul: 'Keluar dari akun Google?',
      pesan: 'Catatan tetap ada di perangkat ini dan di akun Google, tetapi tidak lagi disamakan sampai Anda masuk lagi.',
      ya: 'Keluar',
      bahaya: false
    });
    if (!ya) return;
    clearTimeout(pewaktuSinkron);
    pewaktuSinkron = null;
    // Kirim dulu perubahan yang belum sampai, supaya perangkat lain tidak ketinggalan.
    if (sesi.terhubung && !sesi.perluMasukLagi && navigator.onLine !== false) await jalankanSinkron();
    sinkron.keluar();
    galatSinkron = null;
    galatDitampilkan = '';
    sudahDitanyaSambung = false;
    hapusPemberitahuan('sinkron');
    hapusPemberitahuan('masuk-ulang');
    gambarUlang();
    tampilkanToast('Sudah keluar. Catatan di perangkat ini tetap ada.');
  }

  /** Dipanggil sinkron.js untuk menyimpan hasil gabungan; tidak menjadwalkan sinkron lagi. */
  function simpanDariSinkron(dataBaru) {
    if (modeSimpan !== 'normal') return { ok: false, pesan: 'Data di browser ini sedang tidak bisa disimpan.' };
    const hasil = D.simpanData(penyimpanan, dataBaru);
    if (!hasil.ok) return hasil;
    data = dataBaru;
    gambarUlang();
    return { ok: true };
  }

  /** Sinkron sebentar lagi; panggilan beruntun digabung jadi satu. */
  function jadwalkanSinkron(jeda) {
    if (!sesiGoogle()) return;
    clearTimeout(pewaktuSinkron);
    pewaktuSinkron = setTimeout(function () {
      pewaktuSinkron = null;
      jalankanSinkron();
    }, jeda);
  }

  /** Aplikasi ditinggalkan: perubahan yang masih menunggu giliran dikirim sekarang juga. */
  function kirimYangMenunggu() {
    if (!pewaktuSinkron) return;
    clearTimeout(pewaktuSinkron);
    pewaktuSinkron = null;
    jalankanSinkron();
  }

  /** Sinkron tanpa diminta: saat aplikasi terbuka, kembali dilihat, atau internet tersambung lagi. */
  function sinkronOtomatis() {
    const sesi = sesiGoogle();
    if (!sesi || sesi.perluMasukLagi || sinkronBerjalan > 0) return;
    if (!sesi.terhubung && sudahDitanyaSambung) return; // menunggu pilihan pengguna
    if (document.hidden || navigator.onLine === false) return;
    const jeda = galatSinkron && galatSinkron.jenis !== 'jaringan' ? JEDA_SETELAH_GAGAL : JEDA_ANTAR_OTOMATIS;
    if (Date.now() - sinkronTerakhirDicoba < jeda) return;
    jalankanSinkron();
  }

  /**
   * Jalankan sinkron dan tampilkan hasilnya.
   * opsi: {
   *   caraPertama   'gabung' | 'pakaiAwan': jawaban pengguna saat pertama disambungkan
   *   tanya         boleh menampilkan dialog pilihan (kalau tidak, cukup kartu pemberitahuan)
   *   dariPengguna  diminta lewat tombol: hasilnya selalu diberitahukan
   * }
   */
  async function jalankanSinkron(opsi) {
    opsi = opsi || {};
    if (!sesiGoogle()) return;
    sinkronTerakhirDicoba = Date.now();
    sinkronBerjalan += 1;
    perbaruiTampilanSinkron();
    const masukan = {
      ambilLokal: function () { return data; },
      simpanLokal: simpanDariSinkron,
      caraPertama: opsi.caraPertama,
      paksa: !!opsi.paksa
    };
    let h = await sinkron.sinkronkan(masukan);
    // Bisa terserobot sinkron lain yang tidak membawa jawaban pengguna: ulangi sekali.
    if (h.ok && h.status === 'perlu-pilihan' && opsi.caraPertama) h = await sinkron.sinkronkan(masukan);
    sinkronBerjalan -= 1;

    if (h.ok && h.status === 'perlu-pilihan') {
      galatSinkron = null;
      perbaruiTampilanSinkron();
      if (opsi.tanya) await tanyaCaraSambung(h);
      else tampilkanKartuBelumSambung();
      return;
    }

    if (!h.ok) {
      galatSinkron = { jenis: h.jenis, pesan: h.pesan };
      if (h.tersimpanLokal || h.cadangan) gambarUlang();
      else perbaruiTampilanSinkron();
      tampilkanGalatSinkron(h, !!opsi.dariPengguna);
      return;
    }

    galatSinkron = null;
    galatDitampilkan = '';
    sudahDitanyaSambung = false;
    hapusPemberitahuan('sinkron');
    if (h.cadangan && layarAktif && layarAktif.nama === 'pengaturan') gambarUlang(); // daftar salinan pengaman bertambah
    else perbaruiTampilanSinkron();

    if (h.pertama === 'gabung') {
      const n = h.ringkas ? h.ringkas.transaksiDitambahkan : 0;
      tampilkanToast('Data digabung: ' + n + ' transaksi dari perangkat ini ditambahkan ke akun Google.');
    } else if (h.pertama === 'pakaiAwan' && h.berubahLokal) {
      tampilkanToast(h.cadangan
        ? 'Data dari akun Google sudah dipakai. Data lama perangkat ini disimpan sebagai salinan pengaman.'
        : 'Data dari akun Google sudah dipakai di perangkat ini.');
    } else if (h.pertama === 'unggah') {
      tampilkanToast('Data perangkat ini sudah tersimpan di akun Google.');
    } else if (h.berubahLokal) {
      // Sinkron otomatis tidak boleh menggusur pesan yang masih punya tombol (mis. "Batalkan").
      if (opsi.dariPengguna || !$('#toast button')) tampilkanToast('Data diperbarui dari perangkat lain.');
    } else if (opsi.dariPengguna) {
      tampilkanToast(h.terkirim > 0 ? 'Perubahan sudah terkirim ke akun Google.' : 'Sudah sama dengan data di akun Google.');
    }
  }

  function tampilkanGalatSinkron(h, dariPengguna) {
    if (h.jenis === 'jaringan') {
      if (dariPengguna) tampilkanToast(h.pesan);
      return;
    }
    const tanda = h.jenis + ':' + h.pesan;
    if (!dariPengguna && tanda === galatDitampilkan) return;
    galatDitampilkan = tanda;
    const tetap = ' Catatan tetap tersimpan di perangkat ini.';
    if (h.jenis === 'sesi') {
      tambahPemberitahuan({
        id: 'sinkron',
        judul: 'Perlu masuk lagi dengan Google',
        isi: 'Sesi login di perangkat ini sudah berakhir, jadi sinkron berhenti.' + tetap,
        aksi: [{ label: 'Masuk lagi', aksi: 'masuk-google' }],
        bisaDitutup: true
      });
    } else if (h.jenis === 'izin') {
      tambahPemberitahuan({
        id: 'sinkron',
        judul: 'Akun Google ini tidak diizinkan',
        isi: h.pesan + tetap,
        aksi: [{ label: 'Keluar', aksi: 'keluar-google' }],
        bisaDitutup: true
      });
    } else {
      tambahPemberitahuan({
        id: 'sinkron',
        judul: 'Sinkron berhenti',
        isi: h.pesan + tetap,
        aksi: [{ label: 'Coba lagi', aksi: 'sinkron-sekarang' }],
        bisaDitutup: true
      });
    }
  }

  function tampilkanKartuBelumSambung() {
    if (sudahDitanyaSambung) return;
    sudahDitanyaSambung = true;
    tambahPemberitahuan({
      id: 'sinkron',
      judul: 'Perangkat ini belum disambungkan',
      isi: 'Anda sudah masuk dengan Google, tetapi catatan di perangkat ini belum disamakan dengan data di akun Google.',
      aksi: [{ label: 'Sambungkan sekarang', aksi: 'sambungkan' }],
      bisaDitutup: true
    });
  }

  /** Perangkat ini dan akun Google sama-sama sudah berisi data: tanyakan mau diapakan. */
  async function tanyaCaraSambung(h) {
    const isi = function (r) { return r.transaksi + ' transaksi dan ' + r.akun + ' akun'; };
    const pilih = await pilihan({
      judul: 'Sambungkan perangkat ini',
      pesan: 'Di akun Google Anda sudah ada ' + isi(h.awan) + '. Di perangkat ini ada ' + isi(h.lokal) +
        '. Apa pun pilihannya, data perangkat ini disalin dulu sebagai salinan pengaman.',
      pilihan: [
        {
          nilai: 'gabung', label: 'Gabungkan keduanya', utama: true,
          ket: 'Catatan di perangkat ini ditambahkan ke data di akun Google. Akun dan kategori yang bernama sama disatukan.'
        },
        {
          nilai: 'pakaiAwan', label: 'Pakai data dari Google saja',
          ket: 'Catatan di perangkat ini tidak dipakai lagi.'
        },
        { nilai: '', label: 'Nanti saja' }
      ]
    });
    if (pilih === 'pakaiAwan') {
      const ya = await konfirmasi({
        judul: 'Ganti data di perangkat ini?',
        pesan: h.lokal.transaksi + ' transaksi di perangkat ini akan diganti dengan data dari akun Google. Salinannya tetap bisa diunduh di Pengaturan.',
        ya: 'Ganti data'
      });
      if (!ya) {
        tampilkanKartuBelumSambung();
        return;
      }
    }
    if (pilih !== 'gabung' && pilih !== 'pakaiAwan') {
      tampilkanKartuBelumSambung();
      return;
    }
    hapusPemberitahuan('sinkron');
    await jalankanSinkron({ caraPertama: pilih, dariPengguna: true });
  }

  /** Dipanggil sekali saat aplikasi dibuka, sesudah layar pertama tampil. */
  function mulaiSinkron(jawabanLogin) {
    if (!sinkron) return;
    setInterval(sinkronOtomatis, JEDA_BERKALA);
    if (jawabanLogin) {
      if (sinkronSiap()) selesaikanMasuk(jawabanLogin);
      else tampilkanToast('Login tidak bisa diselesaikan karena data di browser ini belum bisa disimpan.');
      return;
    }
    const sesi = sesiGoogle();
    if (!sesi) return;
    if (sesi.perluMasukLagi) {
      tampilkanGalatSinkron({ jenis: 'sesi', pesan: '' }, false);
      return;
    }
    if (sesi.masukPada && Date.now() - sesi.masukPada > HARI_MASUK_ULANG * MS_SEHARI) {
      tambahPemberitahuan({
        id: 'masuk-ulang',
        judul: 'Masuk ulang dengan Google',
        isi: 'Sudah lebih dari 5 bulan sejak terakhir masuk. Masuk ulang sekali supaya login Google untuk aplikasi ini tetap aktif.',
        aksi: [{ label: 'Masuk ulang', aksi: 'masuk-google' }],
        bisaDitutup: true
      });
    }
    jadwalkanSinkron(400);
  }

  // ===========================================================================
  // Routing lewat hash: #/, #/riwayat, #/laporan, #/pengaturan,
  // lembar: #/catat, #/ubah/<id>, #/saldo-awal, #/akun/<id|baru>, #/kategori/<id|baru>
  // ===========================================================================

  function bacaRute() {
    const hash = location.hash.replace(/^#/, '');
    const tanya = hash.indexOf('?');
    const jalur = tanya >= 0 ? hash.slice(0, tanya) : hash;
    const param = new URLSearchParams(tanya >= 0 ? hash.slice(tanya + 1) : '');
    const bagian = jalur.split('/').filter(Boolean);
    const kepala = bagian[0] || 'beranda';
    if (kepala === 'catat') return { lembar: 'catat', kunci: '/catat', param: param };
    if (kepala === 'ubah' && bagian[1]) {
      return { lembar: 'ubah', kunci: '/ubah/' + bagian[1], id: decodeURIComponent(bagian[1]), param: param };
    }
    if (kepala === 'saldo-awal') return { lembar: 'saldo-awal', kunci: '/saldo-awal', param: param };
    if ((kepala === 'akun' || kepala === 'kategori') && bagian[1]) {
      return {
        lembar: kepala,
        kunci: '/' + kepala + '/' + bagian[1],
        id: bagian[1] === 'baru' ? null : decodeURIComponent(bagian[1]),
        param: param,
        dasar: 'pengaturan' // layar di belakang lembar kalau dibuka langsung lewat alamat
      };
    }
    if (TAB.indexOf(kepala) >= 0) return { layar: kepala, param: param };
    return { layar: 'beranda', param: param, salah: true };
  }

  /** awal === true hanya saat aplikasi pertama dibuka (bukan dari hashchange). */
  function tanganiRute(awal) {
    const rute = bacaRute();
    if (rute.salah) history.replaceState(null, '', '#/');

    if (rute.lembar) {
      if (!layarAktif) tampilkanLayar(rute.dasar || 'beranda', new URLSearchParams());
      if (lembarAktif && lembarAktif.kunci === rute.kunci) {
        // Sudah dibuka langsung oleh tombol Catat (supaya keyboard HP muncul).
        if (awal !== true) lembarAktif.dariAplikasi = true;
        return;
      }
      if (lembarAktif) tutupDialogLembar();
      bukaLembar(rute, awal !== true);
      return;
    }

    const kunciAsal = lembarAktif ? lembarAktif.kunciFokusAsal : null;
    if (lembarAktif) tutupDialogLembar();
    tampilkanLayar(rute.layar, rute.param);
    if (kunciAsal) kembalikanFokus(kunciAsal);
  }

  function tampilkanLayar(nama, param) {
    const pindah = !layarAktif || layarAktif.nama !== nama;
    layarAktif = { nama: nama, param: param };
    document.title = (nama === 'beranda' ? '' : JUDUL_LAYAR[nama] + ' - ') + NAMA_APLIKASI;
    $$('.nav-bawah [data-tab]').forEach(function (a) {
      if (a.getAttribute('data-tab') === nama) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    gambarLayar();
    if (pindah && sudahMulai) {
      window.scrollTo(0, 0);
      const judul = $('#layar h1');
      if (judul) judul.focus({ preventScroll: true });
    }
  }

  function gambarLayar() {
    const layar = $('#layar');
    const aktif = document.activeElement;
    const fokusDiLayar = !!aktif && aktif !== layar && layar.contains(aktif);
    const kunciFokus = fokusDiLayar ? aktif.getAttribute('data-kunci-fokus') : null;

    const nama = layarAktif.nama;
    if (nama === 'beranda') layar.innerHTML = htmlBeranda();
    else if (nama === 'riwayat') layar.innerHTML = htmlRiwayat(layarAktif.param);
    else if (nama === 'laporan') layar.innerHTML = htmlLaporan(layarAktif.param);
    else layar.innerHTML = htmlPengaturan();

    if (fokusDiLayar) {
      const el = (kunciFokus && layar.querySelector('[data-kunci-fokus="' + kunciFokus + '"]')) || layar.querySelector('h1');
      if (el) el.focus({ preventScroll: true });
    }
  }

  function gambarUlang() {
    if (layarAktif) gambarLayar();
  }

  /** Setelah lembar ditutup: fokus kembali ke baris asal kalau elemennya sudah digambar ulang. */
  function kembalikanFokus(kunci) {
    const aktif = document.activeElement;
    if (aktif && aktif !== document.body && document.contains(aktif)) return;
    const el = $('#layar [data-kunci-fokus="' + kunci + '"]') || $('#layar h1');
    if (el) el.focus({ preventScroll: true });
  }

  // ===========================================================================
  // Layar: Beranda
  // ===========================================================================

  function htmlBeranda() {
    const hariIni = D.tanggalLokal();
    const bulan = hariIni.slice(0, 7);
    const saldo = D.hitungSaldo(data);
    const ringkas = D.ringkasanBulan(data, bulan, hariIni);
    const terakhir = D.transaksiTerakhir(data, 5);

    return `
      <header class="kepala">
        <h1 tabindex="-1">${NAMA_APLIKASI}</h1>
        <p class="sub">${esc(D.formatTanggalPanjang(hariIni))}</p>
        <p class="sub status-beranda" id="status-beranda">${htmlStatusBeranda()}</p>
      </header>

      <section class="kartu-saldo" aria-labelledby="judul-saldo">
        <h2 id="judul-saldo" class="label-kecil">Saldo total</h2>
        <p class="saldo-besar angka${saldo.total < 0 ? ' negatif' : ''}">${esc(D.formatRupiah(saldo.total))}</p>
        <div class="bulan-ini">
          <h3 class="label-kecil">${esc(D.labelBulan(bulan))}</h3>
          <dl class="dua-kolom">
            <div><dt>Pemasukan</dt><dd class="angka masuk">${esc(D.formatRupiah(ringkas.pemasukan, { tanda: true }))}</dd></div>
            <div><dt>Pengeluaran</dt><dd class="angka keluar">${esc(D.formatRupiah(-ringkas.pengeluaran))}</dd></div>
          </dl>
        </div>
      </section>

      ${htmlAjakanSaldoAwal()}
      ${htmlPengingatBackup()}

      <section class="bagian" aria-labelledby="judul-akun">
        <h2 id="judul-akun" class="judul-bagian">Saldo per akun</h2>
        <ul class="buku">
          ${data.akun.map(function (a) { return htmlBarisAkun(a, saldo.perAkun[a.id]); }).join('')}
        </ul>
      </section>

      <section class="bagian" aria-labelledby="judul-terakhir">
        <div class="judul-baris">
          <h2 id="judul-terakhir" class="judul-bagian">Transaksi terakhir</h2>
          ${terakhir.length ? '<a class="tautan-kecil" href="#/riwayat">Lihat semua</a>' : ''}
        </div>
        ${terakhir.length
          ? '<ul class="buku">' + terakhir.map(function (t) { return htmlBarisTransaksi(t, hariIni); }).join('') + '</ul>'
          : '<p class="kosong">Belum ada transaksi. Ketuk <strong>Catat</strong> di bawah untuk mulai.</p>'}
      </section>`;
  }

  function htmlAjakanSaldoAwal() {
    if (!D.perluAjakanSaldoAwal(data)) return '';
    return `
      <section class="kartu-info" aria-labelledby="ajakan-saldo">
        <h2 id="ajakan-saldo">Atur saldo awal</h2>
        <p>Isi saldo tiap akun saat ini supaya saldo total sesuai kenyataan.</p>
        <div class="baris-tombol">
          <a class="tombol tombol-utama" href="#/saldo-awal">Atur saldo awal</a>
          <button type="button" class="tombol tombol-teks" data-aksi="lewati-saldo-awal">Lewati</button>
        </div>
      </section>`;
  }

  function htmlPengingatBackup() {
    const sekarang = Date.now();
    if (!D.perluPengingatBackup(data, sekarang)) return '';
    const hari = D.hariSejakBackup(data, sekarang);
    const judul = hari === null ? 'Belum pernah backup' : 'Backup terakhir ' + hari + ' hari lalu';
    const alasan = tersambung()
      ? 'Sinkron bukan pengganti backup: yang terhapus di satu perangkat ikut terhapus di perangkat lain.'
      : 'Data hanya tersimpan di browser ini.';
    return `
      <section class="kartu-info peringatan" aria-labelledby="pengingat-backup">
        <h2 id="pengingat-backup">${esc(judul)}</h2>
        <p>${alasan} Unduh backup dan simpan filenya di tempat lain.</p>
        <div class="baris-tombol">
          <button type="button" class="tombol tombol-utama" data-aksi="unduh-backup">Unduh backup</button>
        </div>
      </section>`;
  }

  function htmlBarisAkun(akun, saldo) {
    const jenis = D.LABEL_JENIS_AKUN[akun.jenis];
    const tampilJenis = jenis.toLowerCase() !== akun.nama.toLowerCase();
    return `<li><a class="baris" href="#/riwayat?akun=${encodeURIComponent(akun.id)}" data-kunci-fokus="akun-${akun.id}">
        <span class="kolom-margin" aria-hidden="true"></span>
        <span class="kolom-isi">
          <span class="judul-trx">${esc(akun.nama)}</span>
          ${tampilJenis ? `<span class="ket">${esc(jenis)}</span>` : ''}
        </span>
        <span class="kolom-jumlah angka${saldo < 0 ? ' negatif' : ''}">${esc(D.formatRupiah(saldo))}</span>
      </a></li>`;
  }

  /**
   * Satu baris di halaman buku: tanggal di margin, keterangan, jumlah rata kanan.
   * opsi.tanggal === false: margin dikosongkan (tanggal sudah jadi judul kelompok).
   */
  function htmlBarisTransaksi(t, hariIni, opsi) {
    const tampilTanggal = !opsi || opsi.tanggal !== false;
    const d = D.tanggalKeDate(t.tanggal);
    const ket = [];
    let judul;
    if (t.tipe === 'transfer') {
      // Nama akun tidak dipatah di tengah; baris baru (kalau perlu) mulai dari panah.
      judul = `<span class="utuh">${esc(namaAkun(t.akunId))}</span> ` +
        `<span class="utuh"><span aria-hidden="true">&rarr;</span><span class="sr-only">ke</span> ${esc(namaAkun(t.akunTujuanId))}</span>`;
      ket.push('Transfer');
    } else {
      judul = esc(namaKategori(t.kategoriId));
      ket.push(namaAkun(t.akunId));
    }
    if (t.catatan) ket.push(t.catatan);
    return `<li><a class="baris" href="#/ubah/${encodeURIComponent(t.id)}" data-kunci-fokus="trx-${t.id}">
        <span class="kolom-margin" aria-hidden="true">${tampilTanggal
          ? `<b>${d.getDate()}</b><small>${D.NAMA_BULAN_PENDEK[d.getMonth()]}</small>` : ''}</span>
        <span class="kolom-isi">
          ${tampilTanggal ? `<span class="sr-only">${esc(D.labelTanggal(t.tanggal, hariIni))},</span>` : ''}
          <span class="judul-trx">${judul}</span>
          <span class="ket">${ket.map(function (k) { return esc(k); }).join(' &middot; ')}</span>
        </span>
        <span class="kolom-jumlah angka ${t.tipe}">${esc(teksJumlah(t))}</span>
      </a></li>`;
  }

  // ===========================================================================
  // Pindah bulan (dipakai Riwayat & Laporan)
  // ===========================================================================

  function htmlPindahBulan(bulan) {
    return `
      <div class="pindah-bulan">
        <button type="button" class="tombol-ikon" data-aksi="bulan-sebelumnya" data-kunci-fokus="bulan-sebelumnya" aria-label="Bulan sebelumnya">${IKON_KIRI}</button>
        <h2 id="label-bulan" tabindex="-1">${esc(D.labelBulan(bulan))}</h2>
        <button type="button" class="tombol-ikon" data-aksi="bulan-berikutnya" data-kunci-fokus="bulan-berikutnya" aria-label="Bulan berikutnya">${IKON_KANAN}</button>
      </div>`;
  }

  function geserBulanMenurutAksi(bulan, aksi) {
    if (aksi === 'bulan-sebelumnya') return D.geserBulan(bulan, -1);
    if (aksi === 'bulan-berikutnya') return D.geserBulan(bulan, 1);
    if (aksi === 'bulan-ini') return D.bulanLokal();
    return bulan;
  }

  /** Pesan untuk pembaca layar lewat wilayah aria-live yang selalu ada. */
  function umumkan(teks) {
    const el = $('#pengumuman');
    el.textContent = '';
    setTimeout(function () { el.textContent = teks; }, 50);
  }

  // ===========================================================================
  // Layar: Riwayat  (#/riwayat?bulan=YYYY-MM&jenis=keluar&akun=<id>)
  // ===========================================================================

  /** Filter dari parameter alamat; nilai yang tidak sah diganti bawaan. */
  function filterRiwayat(param) {
    const bulan = param && D.bulanValid(param.get('bulan')) ? param.get('bulan') : D.bulanLokal();
    const jenis = param && TIPE.indexOf(param.get('jenis')) >= 0 ? param.get('jenis') : 'semua';
    const akun = param ? param.get('akun') : null;
    return { bulan: bulan, jenis: jenis, akunId: akun && D.cariAkun(data, akun) ? akun : null };
  }

  function hashRiwayat(f) {
    const p = new URLSearchParams();
    p.set('bulan', f.bulan);
    if (f.jenis !== 'semua') p.set('jenis', f.jenis);
    if (f.akunId) p.set('akun', f.akunId);
    return '#/riwayat?' + p.toString();
  }

  /** Judul kelompok: "Hari ini" + "Minggu, 8 November", atau "Kamis, 5 November". */
  function judulHari(tanggal, hariIni) {
    const utama = D.labelTanggal(tanggal, hariIni);
    if (utama !== 'Hari ini' && utama !== 'Kemarin') return { utama: utama, kedua: '' };
    let kedua = D.formatTanggalPanjang(tanggal);
    if (tanggal.slice(0, 4) === hariIni.slice(0, 4)) kedua = kedua.slice(0, kedua.lastIndexOf(' '));
    return { utama: utama, kedua: kedua };
  }

  function isiRiwayat(f) {
    const hariIni = D.tanggalLokal();
    const daftar = D.transaksiBulan(data, f.bulan, { tipe: f.jenis, akunId: f.akunId });
    const adaFilter = f.jenis !== 'semua' || !!f.akunId;
    if (!daftar.length) {
      return {
        jumlah: 0,
        html: `<div class="kosong">
            <p>${adaFilter ? 'Tidak ada transaksi yang cocok di ' : 'Belum ada transaksi di '}${esc(D.labelBulan(f.bulan))}.</p>
            ${adaFilter ? '<button type="button" class="tombol tombol-kedua" data-aksi="hapus-filter">Tampilkan semua</button>' : ''}
          </div>`
      };
    }
    const html = D.kelompokkanPerTanggal(daftar).map(function (g) {
      const judul = judulHari(g.tanggal, hariIni);
      const id = 'hari-' + g.tanggal;
      return `<section aria-labelledby="${id}">
          <h3 class="judul-hari" id="${id}">${esc(judul.utama)}${judul.kedua ? ` <small>${esc(judul.kedua)}</small>` : ''}</h3>
          <ul>${g.transaksi.map(function (t) { return htmlBarisTransaksi(t, hariIni, { tanggal: false }); }).join('')}</ul>
        </section>`;
    }).join('');
    return { jumlah: daftar.length, html: '<div class="buku">' + html + '</div>' };
  }

  function htmlStatusRiwayat(f, jumlah) {
    return `<span class="sr-only">${esc(D.labelBulan(f.bulan))}: </span>${jumlah} transaksi`;
  }

  function htmlRiwayat(param) {
    const f = filterRiwayat(param);
    const isi = isiRiwayat(f);
    const pilihanJenis = [['semua', 'Semua']].concat(TIPE.map(function (t) { return [t, D.LABEL_TIPE[t]]; }));
    return `
      <header class="kepala"><h1 tabindex="-1">Riwayat</h1></header>

      ${htmlPindahBulan(f.bulan)}

      <div class="filter">
        <div class="pilih-jenis empat" role="radiogroup" aria-label="Jenis transaksi">
          ${pilihanJenis.map(function (p) {
            return `<label><input type="radio" name="filter-jenis" value="${p[0]}"${p[0] === f.jenis ? ' checked' : ''} data-kunci-fokus="filter-jenis-${p[0]}"><span>${p[1]}</span></label>`;
          }).join('')}
        </div>
        <div class="filter-akun">
          <label class="label" for="filter-akun">Akun</label>
          <select id="filter-akun" data-kunci-fokus="filter-akun">
            <option value="">Semua akun</option>
            ${data.akun.map(function (a) {
              return `<option value="${esc(a.id)}"${a.id === f.akunId ? ' selected' : ''}>${esc(a.nama)}</option>`;
            }).join('')}
          </select>
        </div>
      </div>

      <div class="status-riwayat">
        <p id="status-riwayat" aria-live="polite">${htmlStatusRiwayat(f, isi.jumlah)}</p>
        <button type="button" id="tombol-bulan-ini" class="tombol tombol-teks kecil" data-aksi="bulan-ini"${f.bulan === D.bulanLokal() ? ' hidden' : ''}>Ke bulan ini</button>
      </div>

      <div id="riwayat-isi">${isi.html}</div>`;
  }

  /**
   * Ganti bulan/filter tanpa menggambar ulang kontrol (fokus tetap di tempatnya).
   * Alamat diganti dengan replaceState: tombol back langsung keluar dari Riwayat.
   */
  function perbaruiRiwayat(f) {
    const hash = hashRiwayat(f);
    history.replaceState(null, '', hash);
    layarAktif.param = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
    const isi = isiRiwayat(f);
    $('#label-bulan').textContent = D.labelBulan(f.bulan);
    $$('#layar input[name="filter-jenis"]').forEach(function (r) { r.checked = r.value === f.jenis; });
    $('#filter-akun').value = f.akunId || '';
    $('#tombol-bulan-ini').hidden = f.bulan === D.bulanLokal();
    $('#riwayat-isi').innerHTML = isi.html;
    $('#status-riwayat').innerHTML = htmlStatusRiwayat(f, isi.jumlah);
  }

  function tanganiAksiRiwayat(aksi) {
    const f = filterRiwayat(layarAktif.param);
    f.bulan = geserBulanMenurutAksi(f.bulan, aksi);
    if (aksi === 'hapus-filter') { f.jenis = 'semua'; f.akunId = null; }
    perbaruiRiwayat(f);
    // Tombol yang diklik bisa hilang dari layar; pindahkan fokus ke tempat yang masuk akal.
    if (aksi === 'bulan-ini') $('#label-bulan').focus();
    if (aksi === 'hapus-filter') $('#layar input[name="filter-jenis"][value="semua"]').focus();
  }

  // ===========================================================================
  // Layar: Laporan  (#/laporan?bulan=YYYY-MM)
  // ===========================================================================

  function bulanLaporan(param) {
    return param && D.bulanValid(param.get('bulan')) ? param.get('bulan') : D.bulanLokal();
  }

  /** Jelaskan dasar rata-rata: bulan berjalan hanya dihitung sampai hari ini. */
  function keteranganRataRata(r, bulan, hariIni) {
    if (r.rataRataHarian === null) return 'Bulan tersebut belum dimulai.';
    const dasar = D.formatRupiah(r.dasarRataRata) + ' dibagi ' + r.hariDihitung + ' hari';
    if (bulan !== hariIni.slice(0, 7)) return dasar + '.';
    return dasar + (r.hariDihitung === 1 ? ' (hari ini).' : ' (tanggal 1 sampai hari ini).');
  }

  function htmlBagianKategori(tipe, r, bulan) {
    const daftar = r.perKategori[tipe];
    const id = 'judul-kategori-' + tipe;
    const judul = tipe === 'keluar' ? 'Pengeluaran per kategori' : 'Pemasukan per kategori';
    const isi = daftar.length
      ? '<ul class="buku">' + daftar.map(function (k) {
        const lebar = k.porsi > 0 ? Math.max(k.porsi * 100, 1) : 0;
        return `<li class="baris-kategori">
            <span class="nama">${esc(k.nama)}</span>
            <span class="jumlah angka">${esc(D.formatRupiah(k.jumlah))}</span>
            <span class="persen angka">${esc(D.formatPersenBulat(k.persen, k.porsi))}</span>
            <span class="batang ${tipe}" aria-hidden="true"><span style="width: ${lebar.toFixed(2)}%"></span></span>
          </li>`;
      }).join('') + '</ul>'
      : `<p class="kosong">Belum ada ${tipe === 'keluar' ? 'pengeluaran' : 'pemasukan'} di ${esc(D.labelBulan(bulan))}.</p>`;
    return `
      <section class="bagian" aria-labelledby="${id}">
        <h2 id="${id}" class="judul-bagian">${judul}</h2>
        ${isi}
      </section>`;
  }

  function htmlIsiLaporan(bulan) {
    const hariIni = D.tanggalLokal();
    const r = D.ringkasanBulan(data, bulan, hariIni);
    const kelasSelisih = r.selisih > 0 ? ' masuk' : (r.selisih < 0 ? ' keluar' : '');
    return `
      <section class="kartu-saldo" aria-labelledby="judul-ringkasan">
        <h2 id="judul-ringkasan" class="sr-only">Ringkasan ${esc(D.labelBulan(bulan))}</h2>
        <dl class="dua-kolom">
          <div><dt>Pemasukan</dt><dd class="angka masuk">${esc(D.formatRupiah(r.pemasukan, { tanda: true }))}</dd></div>
          <div><dt>Pengeluaran</dt><dd class="angka keluar">${esc(D.formatRupiah(-r.pengeluaran))}</dd></div>
        </dl>
        <dl class="blok-laporan">
          <dt>Selisih</dt>
          <dd class="angka selisih${kelasSelisih}">${esc(D.formatRupiah(r.selisih, { tanda: true }))}</dd>
        </dl>
        <dl class="blok-laporan">
          <dt>Rata-rata pengeluaran per hari</dt>
          <dd class="angka rata-rata">${r.rataRataHarian === null ? '&mdash;' : esc(D.formatRupiah(r.rataRataHarian))}</dd>
          <dd class="catatan-kecil">${esc(keteranganRataRata(r, bulan, hariIni))}</dd>
        </dl>
      </section>
      ${htmlBagianKategori('keluar', r, bulan)}
      ${htmlBagianKategori('masuk', r, bulan)}`;
  }

  function htmlLaporan(param) {
    const bulan = bulanLaporan(param);
    return `
      <header class="kepala"><h1 tabindex="-1">Laporan</h1></header>

      ${htmlPindahBulan(bulan)}

      <div class="status-riwayat">
        <p>Transfer antar akun tidak dihitung.</p>
        <button type="button" id="tombol-bulan-ini" class="tombol tombol-teks kecil" data-aksi="bulan-ini"${bulan === D.bulanLokal() ? ' hidden' : ''}>Ke bulan ini</button>
      </div>

      <div id="laporan-isi">${htmlIsiLaporan(bulan)}</div>`;
  }

  /** Ganti bulan laporan tanpa menggambar ulang tombol (fokus tetap); alamat diganti, bukan ditambah. */
  function tanganiAksiLaporan(aksi) {
    const bulan = geserBulanMenurutAksi(bulanLaporan(layarAktif.param), aksi);
    history.replaceState(null, '', '#/laporan?bulan=' + bulan);
    layarAktif.param = new URLSearchParams('bulan=' + bulan);
    $('#label-bulan').textContent = D.labelBulan(bulan);
    $('#tombol-bulan-ini').hidden = bulan === D.bulanLokal();
    $('#laporan-isi').innerHTML = htmlIsiLaporan(bulan);
    umumkan('Laporan ' + D.labelBulan(bulan));
    if (aksi === 'bulan-ini') $('#label-bulan').focus();
  }

  // ===========================================================================
  // Layar: Pengaturan
  // ===========================================================================

  function teksPemakaian(n) {
    return n ? 'dipakai di ' + n + ' transaksi' : 'belum dipakai';
  }

  function htmlBarisAtur(href, kunci, judul, ket) {
    return `<li><a class="baris" href="${href}" data-kunci-fokus="${kunci}">
        <span class="kolom-margin" aria-hidden="true"></span>
        <span class="kolom-isi">
          <span class="judul-trx">${esc(judul)}</span>
          <span class="ket">${esc(ket)}</span>
        </span>
        <span class="kolom-jumlah panah" aria-hidden="true">${IKON_KANAN}</span>
      </a></li>`;
  }

  function htmlSalinanRusak(daftar) {
    if (!daftar.length) return '';
    return `
      <section class="bagian" aria-labelledby="judul-rusak">
        <h2 id="judul-rusak" class="judul-bagian">Data lama yang rusak</h2>
        <p class="petunjuk">Disalin otomatis saat data di browser ini tidak bisa dibaca. Unduh kalau ingin diperiksa, lalu hapus supaya tidak memenuhi penyimpanan.</p>
        <ul class="daftar-salinan">
          ${daftar.map(function (k) {
            const label = labelSalinan(k);
            return `<li>
                <span class="nama-salinan">${esc(label)}</span>
                <span class="baris-tombol rapat">
                  <button type="button" class="tombol tombol-kedua kecil" data-aksi="unduh-salinan" data-kunci="${esc(k)}" aria-label="Unduh data lama ${esc(label)}">Unduh</button>
                  <button type="button" class="tombol tombol-bahaya kecil" data-aksi="hapus-salinan" data-kunci="${esc(k)}" aria-label="Hapus data lama ${esc(label)}">Hapus</button>
                </span>
              </li>`;
          }).join('')}
        </ul>
      </section>`;
  }

  /** Salinan data perangkat yang dibuat otomatis sebelum pertama kali disambungkan ke akun Google. */
  function htmlSalinanPengaman(daftar) {
    if (!daftar.length) return '';
    return `
      <section class="bagian" aria-labelledby="judul-cadangan">
        <h2 id="judul-cadangan" class="judul-bagian">Salinan pengaman</h2>
        <p class="petunjuk">Salinan data perangkat ini, dibuat otomatis sebelum datanya digabung atau diganti dengan data dari akun Google. Unduh kalau masih diperlukan (bisa dipulihkan seperti backup), lalu hapus supaya tidak memenuhi penyimpanan.</p>
        <ul class="daftar-salinan">
          ${daftar.map(function (k) {
            const label = labelSalinan(k);
            return `<li>
                <span class="nama-salinan">${esc(label)}</span>
                <span class="baris-tombol rapat">
                  <button type="button" class="tombol tombol-kedua kecil" data-aksi="unduh-cadangan" data-kunci="${esc(k)}" aria-label="Unduh salinan pengaman ${esc(label)}">Unduh</button>
                  <button type="button" class="tombol tombol-bahaya kecil" data-aksi="hapus-cadangan" data-kunci="${esc(k)}" aria-label="Hapus salinan pengaman ${esc(label)}">Hapus</button>
                </span>
              </li>`;
          }).join('')}
        </ul>
      </section>`;
  }

  function htmlPengaturan() {
    const backup = data.pengaturan.backupTerakhir;
    const ikutAwan = tersambung();
    return `
      <header class="kepala"><h1 tabindex="-1">Pengaturan</h1></header>

      <section aria-labelledby="judul-sinkron">
        <h2 id="judul-sinkron" class="judul-bagian">Sinkron antar perangkat</h2>
        <div id="isi-sinkron">${htmlIsiSinkron()}</div>
      </section>

      <section class="bagian" aria-labelledby="judul-atur-akun">
        <div class="judul-baris">
          <h2 id="judul-atur-akun" class="judul-bagian">Akun</h2>
          <a class="tautan-kecil" href="#/akun/baru" data-kunci-fokus="tambah-akun">+ Tambah akun</a>
        </div>
        <ul class="buku">
          ${data.akun.map(function (a) {
            return htmlBarisAtur('#/akun/' + encodeURIComponent(a.id), 'atur-akun-' + a.id, a.nama,
              D.LABEL_JENIS_AKUN[a.jenis] + TITIK + teksPemakaian(D.hitungPemakaianAkun(data, a.id)));
          }).join('')}
        </ul>
        <a class="tombol tombol-kedua lebar jarak-atas" href="#/saldo-awal" data-kunci-fokus="atur-saldo-awal">Atur saldo awal semua akun</a>
      </section>

      <section class="bagian" aria-labelledby="judul-atur-kategori">
        <h2 id="judul-atur-kategori" class="judul-bagian">Kategori</h2>
        ${['keluar', 'masuk'].map(function (tipe) {
          const label = D.LABEL_TIPE[tipe];
          return `
            <div class="judul-baris sub">
              <h3 class="judul-sub">${label}</h3>
              <a class="tautan-kecil" href="#/kategori/baru?tipe=${tipe}" data-kunci-fokus="tambah-kategori-${tipe}" aria-label="Tambah kategori ${label.toLowerCase()}">+ Tambah</a>
            </div>
            <ul class="buku">
              ${D.kategoriPerTipe(data, tipe).map(function (k) {
                const n = D.hitungPemakaianKategori(data, k.id);
                return htmlBarisAtur('#/kategori/' + encodeURIComponent(k.id), 'atur-kategori-' + k.id, k.nama,
                  teksPemakaian(n).replace(/^./, function (c) { return c.toUpperCase(); }));
              }).join('')}
            </ul>`;
        }).join('')}
      </section>

      <section class="bagian" aria-labelledby="judul-data">
        <h2 id="judul-data" class="judul-bagian">Data &amp; backup</h2>
        <p class="petunjuk">${ikutAwan ? 'Data tersimpan di browser ini dan di akun Google Anda.' : 'Data hanya tersimpan di browser ini.'} Backup terakhir: <strong>${backup ? esc(formatWaktu(backup)) : 'belum pernah'}</strong>.</p>
        <div class="tumpuk-tombol">
          <button type="button" class="tombol tombol-utama lebar" data-aksi="unduh-backup" data-kunci-fokus="unduh-backup">Unduh backup (JSON)</button>
          <button type="button" class="tombol tombol-kedua lebar" data-aksi="pilih-backup" data-kunci-fokus="pilih-backup">Pulihkan dari backup</button>
          <button type="button" class="tombol tombol-kedua lebar" data-aksi="ekspor-csv" data-kunci-fokus="ekspor-csv">Ekspor CSV</button>
        </div>
        <input type="file" id="pilih-backup" accept=".json,application/json" hidden>
      </section>

      ${htmlSalinanPengaman(D.daftarCadangan(penyimpanan))}
      ${htmlSalinanRusak(D.daftarSalinanRusak(penyimpanan))}

      <section class="bagian" aria-labelledby="judul-hapus-semua">
        <h2 id="judul-hapus-semua" class="judul-bagian">Hapus semua data</h2>
        <p class="petunjuk">${ikutAwan
          ? 'Menghapus semua akun, kategori, dan transaksi di perangkat ini, di akun Google, dan di perangkat lain yang tersambung, lalu kembali ke data awal.'
          : 'Menghapus semua akun, kategori, dan transaksi di browser ini, lalu kembali ke data awal.'}</p>
        <button type="button" class="tombol tombol-bahaya lebar jarak-atas" data-aksi="hapus-semua" data-kunci-fokus="hapus-semua">Hapus semua data</button>
      </section>

      <section class="bagian" aria-labelledby="judul-tentang">
        <h2 id="judul-tentang" class="judul-bagian">Tentang</h2>
        <p class="petunjuk">${NAMA_APLIKASI} versi ${VERSI_APLIKASI}.</p>
        <p class="petunjuk" id="status-offline">${esc(teksStatusOffline())}</p>
      </section>`;
  }

  // ===========================================================================
  // Lembar (dialog berisi form)
  // ===========================================================================

  function bukaLembar(rute, dariAplikasi) {
    let isi = null;
    if (rute.lembar === 'catat') {
      isi = formTransaksi(null, rute.param);
    } else if (rute.lembar === 'ubah') {
      const t = D.cariTransaksi(data, rute.id);
      if (!t) {
        history.replaceState(null, '', '#/');
        tanganiRute(true);
        tampilkanToast('Transaksi itu tidak ditemukan. Mungkin sudah dihapus.');
        return;
      }
      isi = formTransaksi(t, rute.param);
    } else if (rute.lembar === 'saldo-awal') {
      isi = formSaldoAwal();
    } else if (rute.lembar === 'akun') {
      const akun = rute.id ? D.cariAkun(data, rute.id) : null;
      if (rute.id && !akun) {
        lembarTidakAda('Akun itu tidak ditemukan. Mungkin sudah dihapus.', rute.dasar);
        return;
      }
      isi = formAkun(akun);
    } else if (rute.lembar === 'kategori') {
      const kat = rute.id ? D.cariKategori(data, rute.id) : null;
      if (rute.id && !kat) {
        lembarTidakAda('Kategori itu tidak ditemukan. Mungkin sudah dihapus.', rute.dasar);
        return;
      }
      isi = formKategori(kat, rute.param.get('tipe'));
    }

    const aktif = document.activeElement;
    lembarAktif = {
      kunci: rute.kunci,
      nama: rute.lembar,
      dasar: rute.dasar || 'beranda',
      dariAplikasi: !!dariAplikasi,
      kunciFokusAsal: aktif && aktif.getAttribute ? aktif.getAttribute('data-kunci-fokus') : null
    };
    const dialog = $('#lembar');
    dialog.replaceChildren(isi.elemen);
    if (!dialog.open) dialog.showModal();
    if (isi.fokus) isi.fokus.focus();
  }

  /** Tutup lembar lewat riwayat browser, supaya tombol back tetap konsisten. */
  function tutupLembar(lalu) {
    if (lalu) antreanSetelahTutup.push(lalu);
    if (!lembarAktif) return;
    if (lembarAktif.dariAplikasi) {
      history.back(); // hashchange -> tanganiRute -> tutupDialogLembar
    } else {
      history.replaceState(null, '', lembarAktif.dasar === 'pengaturan' ? '#/pengaturan' : '#/');
      tanganiRute();
    }
  }

  /** Alamat lembar menunjuk data yang sudah tidak ada: kembali ke layar dasarnya. */
  function lembarTidakAda(pesan, dasar) {
    history.replaceState(null, '', dasar === 'pengaturan' ? '#/pengaturan' : '#/');
    tanganiRute(true);
    tampilkanToast(pesan);
  }

  function tutupDialogLembar() {
    lembarAktif = null;
    const dialog = $('#lembar');
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    const antrean = antreanSetelahTutup;
    antreanSetelahTutup = [];
    antrean.forEach(function (fn) { fn(); });
  }

  // ---------------------------------------------------------------------------
  // Form Catat / Ubah transaksi
  // ---------------------------------------------------------------------------

  function formTransaksi(trx, param) {
    const jenisDiminta = param ? param.get('jenis') : null;
    const keadaan = {
      tipe: trx ? trx.tipe : (TIPE.indexOf(jenisDiminta) >= 0 ? jenisDiminta : 'keluar'),
      akunManual: !!trx
    };
    const awal = trx
      ? { akunId: trx.akunId, akunTujuanId: trx.akunTujuanId, kategoriId: trx.kategoriId }
      : D.pilihanAwalForm(data, keadaan.tipe);
    keadaan.akunId = awal.akunId;
    keadaan.akunTujuanId = awal.akunTujuanId;
    keadaan.kategoriId = awal.kategoriId;

    const form = document.createElement('form');
    form.className = 'form-lembar';
    form.noValidate = true;
    form.innerHTML = `
      <header class="lembar-kepala">
        <button type="button" class="tombol tombol-teks" data-aksi="tutup-lembar">Batal</button>
        <h2 id="lembar-judul">${trx ? 'Ubah transaksi' : 'Catat transaksi'}</h2>
        <button type="submit" class="tombol tombol-teks tebal">Simpan</button>
      </header>
      <div class="lembar-isi">
        <p class="galat-form" role="alert" hidden></p>

        <div class="pilih-jenis" role="radiogroup" aria-label="Jenis transaksi">
          ${TIPE.map(function (tp) {
            return `<label><input type="radio" name="tipe" value="${tp}"${tp === keadaan.tipe ? ' checked' : ''}><span>${D.LABEL_TIPE[tp]}</span></label>`;
          }).join('')}
        </div>

        <label class="isian-jumlah ${keadaan.tipe}" for="f-jumlah">
          <span class="awalan" aria-hidden="true">Rp</span>
          <input id="f-jumlah" name="jumlah" type="text" inputmode="numeric" autocomplete="off"
            enterkeyhint="done" placeholder="0" aria-label="Jumlah dalam rupiah" aria-describedby="g-jumlah"
            value="${trx ? D.formatAngka(trx.jumlah) : ''}" data-digit="${trx ? trx.jumlah : ''}">
        </label>
        <p class="galat" id="g-jumlah" hidden></p>

        <fieldset class="chip-grup" id="grup-kategori" aria-describedby="g-kategoriId">
          <legend>Kategori</legend>
          <div class="chips" data-isi="kategori"></div>
          <p class="galat" id="g-kategoriId" hidden></p>
        </fieldset>

        <fieldset class="chip-grup" aria-describedby="g-akunId">
          <legend data-isi="label-akun">Akun</legend>
          <div class="chips" data-isi="akun"></div>
          <p class="galat" id="g-akunId" hidden></p>
        </fieldset>

        <fieldset class="chip-grup" id="grup-tujuan" aria-describedby="g-akunTujuanId">
          <legend>Ke</legend>
          <div class="chips" data-isi="tujuan"></div>
          <p class="galat" id="g-akunTujuanId" hidden></p>
        </fieldset>

        <div class="kelompok">
          <label class="label" for="f-tanggal">Tanggal</label>
          <div class="baris-tanggal">
            <input id="f-tanggal" name="tanggal" type="date" required
              value="${trx ? trx.tanggal : D.tanggalLokal()}" aria-describedby="g-tanggal">
            <button type="button" class="tombol tombol-kedua kecil" data-tanggal="0" aria-pressed="false">Hari ini</button>
            <button type="button" class="tombol tombol-kedua kecil" data-tanggal="-1" aria-pressed="false">Kemarin</button>
          </div>
          <p class="galat" id="g-tanggal" hidden></p>
        </div>

        <div class="kelompok">
          <label class="label" for="f-catatan">Catatan <span class="opsional">(opsional)</span></label>
          <input id="f-catatan" name="catatan" type="text" class="isian-teks" maxlength="${D.PANJANG_CATATAN_MAKS}"
            autocomplete="off" enterkeyhint="done" value="${esc(trx ? trx.catatan : '')}" aria-describedby="g-catatan">
          <p class="galat" id="g-catatan" hidden></p>
        </div>

        <button type="submit" class="tombol tombol-utama lebar">Simpan</button>
        ${trx ? '<button type="button" class="tombol tombol-bahaya lebar" data-aksi="hapus-transaksi">Hapus transaksi</button>' : ''}
      </div>`;

    const isianJumlah = $('#f-jumlah', form);
    const isianTanggal = $('#f-tanggal', form);
    const isianCatatan = $('#f-catatan', form);

    function chip(nama, nilai, label, terpilih, nonaktif) {
      return `<label class="chip"><input type="radio" name="${nama}" value="${esc(nilai)}"${terpilih ? ' checked' : ''}${nonaktif ? ' disabled' : ''}><span>${esc(label)}</span></label>`;
    }

    function gambarPilihan() {
      const tipe = keadaan.tipe;
      const transfer = tipe === 'transfer';
      $('#grup-kategori', form).hidden = transfer;
      $('#grup-tujuan', form).hidden = !transfer;
      $('[data-isi="label-akun"]', form).textContent = transfer ? 'Dari' : 'Akun';
      $('.isian-jumlah', form).className = 'isian-jumlah ' + tipe;

      if (!transfer) {
        const daftar = D.kategoriPerTipe(data, tipe);
        $('[data-isi="kategori"]', form).innerHTML = daftar.length
          ? daftar.map(function (k) { return chip('kategori', k.id, k.nama, k.id === keadaan.kategoriId); }).join('')
          : '<p class="kosong-kecil">Belum ada kategori. Tambahkan di Pengaturan.</p>';
      }
      $('[data-isi="akun"]', form).innerHTML = data.akun.map(function (a) {
        return chip('akun', a.id, a.nama, a.id === keadaan.akunId);
      }).join('');
      if (transfer) {
        $('[data-isi="tujuan"]', form).innerHTML = data.akun.length < 2
          ? '<p class="kosong-kecil">Transfer butuh minimal 2 akun. Tambahkan akun di Pengaturan.</p>'
          : data.akun.map(function (a) {
            const sama = a.id === keadaan.akunId;
            return chip('tujuan', a.id, a.nama, !sama && a.id === keadaan.akunTujuanId, sama);
          }).join('');
      }
    }

    /** "Ke" tidak boleh sama dengan "Dari": nonaktifkan tanpa menggambar ulang (fokus tetap). */
    function perbaruiTujuan() {
      $$('input[name="tujuan"]', form).forEach(function (r) {
        r.disabled = r.value === keadaan.akunId;
        r.checked = !r.disabled && r.value === keadaan.akunTujuanId;
      });
    }

    function perbaruiTombolTanggal() {
      const hariIni = D.tanggalLokal();
      $$('[data-tanggal]', form).forEach(function (b) {
        const tanggal = D.geserTanggal(hariIni, Number(b.getAttribute('data-tanggal')));
        b.setAttribute('aria-pressed', String(isianTanggal.value === tanggal));
      });
    }

    function nilaiRadio(nama) {
      const r = form.querySelector('input[name="' + nama + '"]:checked');
      return r ? r.value : null;
    }

    function bersihkanGalat() {
      $$('.galat, .galat-form', form).forEach(function (p) { p.hidden = true; p.textContent = ''; });
      $$('[aria-invalid]', form).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    }

    function tampilkanGalat(kolom, pesan) {
      const idGalat = {
        jumlah: 'g-jumlah', kategoriId: 'g-kategoriId', akunId: 'g-akunId',
        akunTujuanId: 'g-akunTujuanId', tanggal: 'g-tanggal', catatan: 'g-catatan'
      }[kolom];
      const p = idGalat ? $('#' + idGalat, form) : null;
      if (!p || p.parentElement.closest('[hidden]')) {
        const umum = $('.galat-form', form);
        umum.textContent = pesan;
        umum.hidden = false;
        umum.scrollIntoView({ block: 'nearest' });
        return;
      }
      p.textContent = pesan;
      p.hidden = false;
      const isian = { jumlah: isianJumlah, tanggal: isianTanggal, catatan: isianCatatan }[kolom];
      if (isian) {
        isian.setAttribute('aria-invalid', 'true');
        isian.focus();
      } else {
        const grup = p.closest('fieldset');
        const radio = grup.querySelector('input:checked:not(:disabled)') || grup.querySelector('input:not(:disabled)');
        if (radio) radio.focus();
        else p.scrollIntoView({ block: 'nearest' });
      }
    }

    async function hapus() {
      const ya = await konfirmasi({ judul: 'Hapus transaksi ini?', pesan: ringkasTransaksi(trx), ya: 'Hapus' });
      if (!ya) return;
      const hasil = D.hapusTransaksi(data, trx.id);
      if (!hasil.ok) { tampilkanGalat(null, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { tampilkanGalat(null, s.pesan); return; }
      tutupLembar(function () {
        tampilkanToast('Transaksi dihapus.', {
          label: 'Batalkan',
          aksi: function () { batalkanHapus(hasil.transaksi, hasil.indeks); }
        });
      });
    }

    form.addEventListener('input', function (e) {
      if (e.target === isianJumlah) formatIsianUang(isianJumlah, e);
      else if (e.target === isianTanggal) perbaruiTombolTanggal();
    });

    form.addEventListener('change', function (e) {
      const el = e.target;
      if (el.name === 'tipe') {
        keadaan.tipe = el.value;
        const pilihan = D.pilihanAwalForm(data, keadaan.tipe);
        const tipeAsli = trx && trx.tipe === keadaan.tipe;
        keadaan.kategoriId = tipeAsli ? trx.kategoriId : pilihan.kategoriId;
        if (!keadaan.akunManual) keadaan.akunId = pilihan.akunId;
        if (keadaan.tipe === 'transfer') {
          keadaan.akunTujuanId = tipeAsli ? trx.akunTujuanId : pilihan.akunTujuanId;
          if (!keadaan.akunTujuanId || keadaan.akunTujuanId === keadaan.akunId) {
            const lain = data.akun.find(function (a) { return a.id !== keadaan.akunId; });
            keadaan.akunTujuanId = lain ? lain.id : null;
          }
        }
        bersihkanGalat();
        gambarPilihan();
      } else if (el.name === 'kategori') {
        keadaan.kategoriId = el.value;
      } else if (el.name === 'akun') {
        if (keadaan.tipe === 'transfer' && el.value === keadaan.akunTujuanId) {
          keadaan.akunTujuanId = keadaan.akunId; // tukar Dari dan Ke
        }
        keadaan.akunId = el.value;
        keadaan.akunManual = true;
        if (keadaan.tipe === 'transfer') perbaruiTujuan();
      } else if (el.name === 'tujuan') {
        keadaan.akunTujuanId = el.value;
      }
    });

    form.addEventListener('click', function (e) {
      const tombolTanggal = e.target.closest('[data-tanggal]');
      if (tombolTanggal) {
        isianTanggal.value = D.geserTanggal(D.tanggalLokal(), Number(tombolTanggal.getAttribute('data-tanggal')));
        isianTanggal.removeAttribute('aria-invalid');
        perbaruiTombolTanggal();
        return;
      }
      if (e.target.closest('[data-aksi="hapus-transaksi"]')) hapus();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      bersihkanGalat();
      const tipe = nilaiRadio('tipe') || 'keluar';
      const input = {
        tipe: tipe,
        jumlah: D.parseJumlah(isianJumlah.value),
        tanggal: isianTanggal.value,
        akunId: nilaiRadio('akun'),
        akunTujuanId: tipe === 'transfer' ? nilaiRadio('tujuan') : null,
        kategoriId: tipe === 'transfer' ? null : nilaiRadio('kategori'),
        catatan: isianCatatan.value
      };
      const hasil = trx ? D.ubahTransaksi(data, trx.id, input) : D.tambahTransaksi(data, input);
      if (!hasil.ok) { tampilkanGalat(hasil.kolom, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { tampilkanGalat(null, s.pesan); return; }
      const t = hasil.transaksi;
      const pesan = trx ? 'Perubahan disimpan.' : D.LABEL_TIPE[t.tipe] + ' ' + D.formatRupiah(t.jumlah) + ' dicatat.';
      tutupLembar(function () { tampilkanToast(pesan); });
    });

    gambarPilihan();
    perbaruiTombolTanggal();
    return { elemen: form, fokus: trx ? null : isianJumlah };
  }

  function batalkanHapus(transaksi, indeks) {
    const hasil = D.kembalikanTransaksi(data, transaksi, indeks);
    if (!hasil.ok) { tampilkanToast(hasil.pesan); return; }
    const s = simpan(hasil.data);
    tampilkanToast(s.ok ? 'Transaksi dikembalikan.' : s.pesan);
  }

  // ---------------------------------------------------------------------------
  // Form Atur saldo awal
  // ---------------------------------------------------------------------------

  function formSaldoAwal() {
    const form = document.createElement('form');
    form.className = 'form-lembar';
    form.noValidate = true;
    form.innerHTML = `
      <header class="lembar-kepala">
        <button type="button" class="tombol tombol-teks" data-aksi="tutup-lembar">Batal</button>
        <h2 id="lembar-judul">Atur saldo awal</h2>
        <button type="submit" class="tombol tombol-teks tebal">Simpan</button>
      </header>
      <div class="lembar-isi">
        <p class="petunjuk">Isi saldo tiap akun saat ini. Untuk utang, misalnya tagihan kartu kredit, centang <strong>Utang</strong>.</p>
        <p class="galat-form" role="alert" hidden></p>
        <ul class="daftar-saldo-awal">
          ${data.akun.map(function (a) {
            const jenis = D.LABEL_JENIS_AKUN[a.jenis];
            const tampilJenis = jenis.toLowerCase() !== a.nama.toLowerCase();
            const utang = a.saldoAwal < 0 || (a.saldoAwal === 0 && a.jenis === 'kartu_kredit');
            return `<li>
              <label class="label" for="sa-${a.id}">${esc(a.nama)}${tampilJenis ? ` <span class="ket">&middot; ${esc(jenis)}</span>` : ''}</label>
              <div class="baris-saldo-awal">
                <div class="isian-uang">
                  <span aria-hidden="true">Rp</span>
                  <input id="sa-${a.id}" data-akun="${a.id}" type="text" inputmode="numeric" autocomplete="off"
                    placeholder="0" value="${a.saldoAwal ? D.formatAngka(a.saldoAwal) : ''}"
                    data-digit="${a.saldoAwal ? Math.abs(a.saldoAwal) : ''}" aria-describedby="sa-g-${a.id}">
                </div>
                <label class="centang"><input type="checkbox" data-utang="${a.id}"${utang ? ' checked' : ''}> Utang<span class="sr-only"> (${esc(a.nama)})</span></label>
              </div>
              <p class="galat" id="sa-g-${a.id}" hidden></p>
            </li>`;
          }).join('')}
        </ul>
        <button type="submit" class="tombol tombol-utama lebar">Simpan</button>
      </div>`;

    form.addEventListener('input', function (e) {
      if (e.target.matches('input[data-akun]')) formatIsianUang(e.target, e);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.galat, .galat-form', form).forEach(function (p) { p.hidden = true; });
      const nilai = {};
      $$('input[data-akun]', form).forEach(function (isian) {
        const id = isian.getAttribute('data-akun');
        const n = D.parseJumlah(isian.value) || 0;
        nilai[id] = $('input[data-utang="' + id + '"]', form).checked ? -n : n;
      });
      const hasil = D.aturSaldoAwal(data, nilai);
      if (!hasil.ok) {
        const p = (hasil.kolom && $('#sa-g-' + hasil.kolom, form)) || $('.galat-form', form);
        p.textContent = hasil.pesan;
        p.hidden = false;
        const isian = hasil.kolom && $('#sa-' + hasil.kolom, form);
        if (isian) isian.focus();
        return;
      }
      const s = simpan(hasil.data);
      if (!s.ok) {
        const umum = $('.galat-form', form);
        umum.textContent = s.pesan;
        umum.hidden = false;
        return;
      }
      tutupLembar(function () { tampilkanToast('Saldo awal disimpan.'); });
    });

    return { elemen: form, fokus: null };
  }

  // ---------------------------------------------------------------------------
  // Form akun (#/akun/baru, #/akun/<id>)
  // ---------------------------------------------------------------------------

  function formAkun(akun) {
    const jenisAwal = akun ? akun.jenis : 'bank';
    const dipakai = akun ? D.hitungPemakaianAkun(data, akun.id) : 0;
    const form = document.createElement('form');
    form.className = 'form-lembar';
    form.noValidate = true;
    form.innerHTML = `
      <header class="lembar-kepala">
        <button type="button" class="tombol tombol-teks" data-aksi="tutup-lembar">Batal</button>
        <h2 id="lembar-judul">${akun ? 'Ubah akun' : 'Tambah akun'}</h2>
        <button type="submit" class="tombol tombol-teks tebal">Simpan</button>
      </header>
      <div class="lembar-isi">
        <p class="galat-form" role="alert" hidden></p>

        <div class="kelompok kelompok-awal">
          <label class="label" for="f-nama">Nama akun</label>
          <input id="f-nama" type="text" class="isian-teks" maxlength="${D.PANJANG_NAMA_MAKS}" autocomplete="off"
            enterkeyhint="done" placeholder="mis. BCA atau GoPay" value="${esc(akun ? akun.nama : '')}" aria-describedby="g-nama">
          <p class="galat" id="g-nama" hidden></p>
        </div>

        <fieldset class="chip-grup" aria-describedby="g-jenis">
          <legend>Jenis</legend>
          <div class="chips">
            ${D.JENIS_AKUN.map(function (j) {
              return `<label class="chip"><input type="radio" name="jenis" value="${j}"${j === jenisAwal ? ' checked' : ''}><span>${esc(D.LABEL_JENIS_AKUN[j])}</span></label>`;
            }).join('')}
          </div>
          <p class="galat" id="g-jenis" hidden></p>
        </fieldset>

        <div class="kelompok">
          <label class="label" for="f-saldo">Saldo awal</label>
          <div class="baris-saldo-awal">
            <div class="isian-uang">
              <span aria-hidden="true">Rp</span>
              <input id="f-saldo" type="text" inputmode="numeric" autocomplete="off" placeholder="0"
                value="${akun && akun.saldoAwal ? D.formatAngka(akun.saldoAwal) : ''}"
                data-digit="${akun && akun.saldoAwal ? Math.abs(akun.saldoAwal) : ''}" aria-describedby="k-saldo g-saldoAwal">
            </div>
            <label class="centang"><input type="checkbox" id="f-utang"${akun && akun.saldoAwal < 0 ? ' checked' : ''}> Utang</label>
          </div>
          <p class="catatan-kecil" id="k-saldo">Saldo saat mulai mencatat di aplikasi ini. Centang Utang kalau saldonya minus, misalnya tagihan kartu kredit.</p>
          <p class="galat" id="g-saldoAwal" hidden></p>
        </div>

        ${akun ? `<p class="catatan-kecil jarak-atas">${dipakai ? 'Dipakai di ' + dipakai + ' transaksi.' : 'Belum dipakai transaksi apa pun.'}</p>` : ''}
        <button type="submit" class="tombol tombol-utama lebar">Simpan</button>
        ${akun ? '<button type="button" class="tombol tombol-bahaya lebar" data-aksi="hapus-akun">Hapus akun</button>' : ''}
      </div>`;

    const galat = pengelolaGalat(form, {
      nama: { pesan: '#g-nama', isian: '#f-nama' },
      jenis: { pesan: '#g-jenis', isian: 'input[name="jenis"]' },
      saldoAwal: { pesan: '#g-saldoAwal', isian: '#f-saldo' }
    });
    const isianSaldo = $('#f-saldo', form);
    const centangUtang = $('#f-utang', form);

    form.addEventListener('input', function (e) {
      if (e.target === isianSaldo) formatIsianUang(isianSaldo, e);
    });
    form.addEventListener('change', function (e) {
      // Kartu kredit biasanya dimulai dengan utang.
      if (e.target.name === 'jenis' && e.target.value === 'kartu_kredit' && !D.parseJumlah(isianSaldo.value)) {
        centangUtang.checked = true;
      }
    });

    async function hapus() {
      galat.bersihkan();
      const cek = D.hapusAkun(data, akun.id);
      if (!cek.ok) { galat.tampilkan(null, cek.pesan); return; }
      const ya = await konfirmasi({
        judul: 'Hapus akun "' + akun.nama + '"?',
        pesan: 'Akun ini belum dipakai transaksi apa pun. Penghapusan tidak bisa dibatalkan.',
        ya: 'Hapus akun'
      });
      if (!ya) return;
      const hasil = D.hapusAkun(data, akun.id);
      if (!hasil.ok) { galat.tampilkan(null, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { galat.tampilkan(null, s.pesan); return; }
      tutupLembar(function () { tampilkanToast('Akun "' + akun.nama + '" dihapus.'); });
    }

    form.addEventListener('click', function (e) {
      if (e.target.closest('[data-aksi="hapus-akun"]')) hapus();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      galat.bersihkan();
      const n = D.parseJumlah(isianSaldo.value) || 0;
      const input = {
        nama: $('#f-nama', form).value,
        jenis: nilaiRadioDi(form, 'jenis'),
        saldoAwal: centangUtang.checked ? -n : n
      };
      const hasil = akun ? D.ubahAkun(data, akun.id, input) : D.tambahAkun(data, input);
      if (!hasil.ok) { galat.tampilkan(hasil.kolom, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { galat.tampilkan(null, s.pesan); return; }
      const nama = hasil.akun.nama;
      tutupLembar(function () { tampilkanToast(akun ? 'Perubahan akun disimpan.' : 'Akun "' + nama + '" ditambahkan.'); });
    });

    return { elemen: form, fokus: akun ? null : $('#f-nama', form) };
  }

  // ---------------------------------------------------------------------------
  // Form kategori (#/kategori/baru?tipe=keluar, #/kategori/<id>)
  // ---------------------------------------------------------------------------

  function formKategori(kat, tipeDiminta) {
    const tipeAwal = kat ? kat.tipe : (tipeDiminta === 'masuk' ? 'masuk' : 'keluar');
    const dipakai = kat ? D.hitungPemakaianKategori(data, kat.id) : 0;
    const form = document.createElement('form');
    form.className = 'form-lembar';
    form.noValidate = true;
    form.innerHTML = `
      <header class="lembar-kepala">
        <button type="button" class="tombol tombol-teks" data-aksi="tutup-lembar">Batal</button>
        <h2 id="lembar-judul">${kat ? 'Ubah kategori' : 'Tambah kategori'}</h2>
        <button type="submit" class="tombol tombol-teks tebal">Simpan</button>
      </header>
      <div class="lembar-isi">
        <p class="galat-form" role="alert" hidden></p>

        <div class="kelompok kelompok-awal">
          <label class="label" for="f-nama">Nama kategori</label>
          <input id="f-nama" type="text" class="isian-teks" maxlength="${D.PANJANG_NAMA_MAKS}" autocomplete="off"
            enterkeyhint="done" placeholder="mis. Parkir" value="${esc(kat ? kat.nama : '')}" aria-describedby="g-nama">
          <p class="galat" id="g-nama" hidden></p>
        </div>

        ${kat
          ? `<p class="catatan-kecil jarak-atas">Kategori ${D.LABEL_TIPE[kat.tipe].toLowerCase()}, ${dipakai ? 'dipakai di ' + dipakai + ' transaksi' : 'belum dipakai'}. Jenis kategori tidak bisa diubah.</p>`
          : `<fieldset class="chip-grup" aria-describedby="g-tipe">
              <legend>Jenis</legend>
              <div class="chips">
                ${['keluar', 'masuk'].map(function (t) {
                  return `<label class="chip"><input type="radio" name="tipe" value="${t}"${t === tipeAwal ? ' checked' : ''}><span>${D.LABEL_TIPE[t]}</span></label>`;
                }).join('')}
              </div>
              <p class="galat" id="g-tipe" hidden></p>
            </fieldset>`}

        <button type="submit" class="tombol tombol-utama lebar">Simpan</button>
        ${kat ? '<button type="button" class="tombol tombol-bahaya lebar" data-aksi="hapus-kategori">Hapus kategori</button>' : ''}
      </div>`;

    const galat = pengelolaGalat(form, {
      nama: { pesan: '#g-nama', isian: '#f-nama' },
      tipe: { pesan: '#g-tipe', isian: 'input[name="tipe"]' }
    });

    async function hapus() {
      galat.bersihkan();
      const cek = D.hapusKategori(data, kat.id);
      if (!cek.ok) { galat.tampilkan(null, cek.pesan); return; }
      const ya = await konfirmasi({
        judul: 'Hapus kategori "' + kat.nama + '"?',
        pesan: 'Kategori ini belum dipakai transaksi apa pun. Penghapusan tidak bisa dibatalkan.',
        ya: 'Hapus kategori'
      });
      if (!ya) return;
      const hasil = D.hapusKategori(data, kat.id);
      if (!hasil.ok) { galat.tampilkan(null, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { galat.tampilkan(null, s.pesan); return; }
      tutupLembar(function () { tampilkanToast('Kategori "' + kat.nama + '" dihapus.'); });
    }

    form.addEventListener('click', function (e) {
      if (e.target.closest('[data-aksi="hapus-kategori"]')) hapus();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      galat.bersihkan();
      const nama = $('#f-nama', form).value;
      const hasil = kat
        ? D.ubahKategori(data, kat.id, { nama: nama })
        : D.tambahKategori(data, { nama: nama, tipe: nilaiRadioDi(form, 'tipe') });
      if (!hasil.ok) { galat.tampilkan(hasil.kolom, hasil.pesan); return; }
      const s = simpan(hasil.data);
      if (!s.ok) { galat.tampilkan(null, s.pesan); return; }
      const namaBaru = hasil.kategori.nama;
      tutupLembar(function () {
        tampilkanToast(kat ? 'Nama kategori disimpan.' : 'Kategori "' + namaBaru + '" ditambahkan.');
      });
    });

    return { elemen: form, fokus: kat ? null : $('#f-nama', form) };
  }

  // ===========================================================================
  // Dialog konfirmasi, toast, pemberitahuan
  // ===========================================================================

  /**
   * Tampilkan dialog konfirmasi. Hasil: Promise<boolean>. Fokus awal di "Batal".
   * opsi.hanyaTutup: dialog pesan biasa dengan satu tombol.
   */
  function konfirmasi(opsi) {
    return new Promise(function (selesai) {
      const dialog = $('#dialog-konfirmasi');
      $('#konfirmasi-judul').textContent = opsi.judul;
      $('#konfirmasi-pesan').textContent = opsi.pesan || '';
      dialog.querySelector('button[value="batal"]').hidden = !!opsi.hanyaTutup;
      const tombolYa = $('#konfirmasi-ya');
      tombolYa.textContent = opsi.ya || 'Ya';
      tombolYa.className = 'tombol ' + (opsi.hanyaTutup || opsi.bahaya === false ? 'tombol-utama' : 'tombol-bahaya penuh');
      dialog.returnValue = '';
      dialog.addEventListener('close', function () { selesai(dialog.returnValue === 'ya'); }, { once: true });
      dialog.showModal();
    });
  }

  function pesanDialog(judul, pesan) {
    return konfirmasi({ judul: judul, pesan: pesan, ya: 'Tutup', hanyaTutup: true });
  }

  /**
   * Dialog dengan beberapa pilihan. opsi.pilihan: [{ nilai, label, ket?, utama? }].
   * Hasil: Promise<nilai yang dipilih>; '' kalau ditutup tanpa memilih (mis. Esc).
   * Fokus awal di pilihan pertama.
   */
  function pilihan(opsi) {
    return new Promise(function (selesai) {
      const dialog = $('#dialog-pilihan');
      $('#pilihan-judul').textContent = opsi.judul;
      $('#pilihan-pesan').textContent = opsi.pesan || '';
      $('#pilihan-daftar').innerHTML = opsi.pilihan.map(function (p) {
        const gaya = p.utama ? 'tombol-utama' : (p.nilai ? 'tombol-kedua' : 'tombol-teks');
        return `<button type="submit" value="${esc(p.nilai)}" class="tombol ${gaya} pilihan">
            <span class="pilihan-label">${esc(p.label)}</span>
            ${p.ket ? `<span class="pilihan-ket">${esc(p.ket)}</span>` : ''}
          </button>`;
      }).join('');
      dialog.returnValue = '';
      dialog.addEventListener('close', function () { selesai(dialog.returnValue || ''); }, { once: true });
      dialog.showModal();
    });
  }

  let pewaktuToast = null;

  /** Pesan singkat di atas navigasi. aksi: { label, aksi } (mis. "Batalkan"). */
  function tampilkanToast(pesan, aksi) {
    const wadah = $('#toast');
    clearTimeout(pewaktuToast);
    const kotak = document.createElement('div');
    kotak.className = 'toast';
    const teks = document.createElement('span');
    teks.textContent = pesan;
    kotak.appendChild(teks);
    if (aksi) {
      const tombol = document.createElement('button');
      tombol.type = 'button';
      tombol.textContent = aksi.label;
      tombol.addEventListener('click', function () {
        tutupToast();
        aksi.aksi();
      });
      kotak.appendChild(tombol);
    }
    wadah.replaceChildren(kotak);

    const lama = aksi ? 8000 : 4000;
    function mulaiPewaktu() {
      clearTimeout(pewaktuToast);
      pewaktuToast = setTimeout(tutupToast, lama);
    }
    // Jangan hilang selagi ditunjuk atau difokus.
    kotak.addEventListener('mouseenter', function () { clearTimeout(pewaktuToast); });
    kotak.addEventListener('mouseleave', mulaiPewaktu);
    kotak.addEventListener('focusin', function () { clearTimeout(pewaktuToast); });
    kotak.addEventListener('focusout', mulaiPewaktu);
    mulaiPewaktu();
  }

  function tutupToast() {
    clearTimeout(pewaktuToast);
    $('#toast').replaceChildren();
  }

  function tambahPemberitahuan(p) {
    pemberitahuan = pemberitahuan.filter(function (x) { return x.id !== p.id; }).concat([p]);
    gambarPemberitahuan();
  }

  function hapusPemberitahuan(id) {
    pemberitahuan = pemberitahuan.filter(function (x) { return x.id !== id; });
    gambarPemberitahuan();
  }

  function gambarPemberitahuan() {
    $('#pemberitahuan').innerHTML = pemberitahuan.map(function (p) {
      return `
        <section class="kartu-info peringatan" aria-labelledby="pb-${p.id}">
          <h2 id="pb-${p.id}">${esc(p.judul)}</h2>
          <p>${esc(p.isi)}</p>
          <div class="baris-tombol">
            ${p.aksi.map(function (a) {
              return `<button type="button" class="tombol tombol-kedua" data-aksi="${a.aksi}">${esc(a.label)}</button>`;
            }).join('')}
            ${p.bisaDitutup ? `<button type="button" class="tombol tombol-teks" data-aksi="tutup-pemberitahuan" data-id="${p.id}">Tutup</button>` : ''}
          </div>
        </section>`;
    }).join('');
  }

  function siapkanPemberitahuanAwal() {
    if (infoMuat.status === 'rusak' && infoMuat.kunciSalinan) {
      tambahPemberitahuan({
        id: 'data-rusak',
        judul: 'Data lama tidak bisa dibaca',
        isi: 'Penyebab: ' + infoMuat.alasan + ' Data lama disalin apa adanya ke "' + infoMuat.kunciSalinan +
          '" di browser ini, lalu aplikasi mulai dengan data baru.',
        aksi: [{ label: 'Unduh data lama', aksi: 'unduh-data-lama' }],
        bisaDitutup: true
      });
    } else if (modeSimpan === 'tertahan') {
      tambahPemberitahuan({
        id: 'data-tertahan',
        judul: 'Data lama belum diamankan',
        isi: 'Data lama tidak bisa dibaca, dan penyimpanan browser terlalu penuh untuk menyalinnya. ' +
          'Unduh dulu data lama, lalu pilih "Mulai data baru". Sampai itu, catatan baru tidak bisa disimpan.',
        aksi: [
          { label: 'Unduh data lama', aksi: 'unduh-data-lama' },
          { label: 'Mulai data baru', aksi: 'mulai-data-baru' }
        ],
        bisaDitutup: false
      });
    }
    if (modeSimpan === 'memori') {
      tambahPemberitahuan({
        id: 'tanpa-penyimpanan',
        judul: 'Data tidak tersimpan',
        isi: infoMuat.pesan + ' Unduh backup sebelum menutup halaman.',
        aksi: [{ label: 'Unduh backup', aksi: 'unduh-backup' }],
        bisaDitutup: false
      });
    } else if (modeSimpan === 'normal' && !infoMuat.tersimpan && infoMuat.pesan) {
      tambahPemberitahuan({ id: 'gagal-simpan', judul: 'Data belum tersimpan', isi: infoMuat.pesan, aksi: [], bisaDitutup: true });
    }
  }

  // ===========================================================================
  // Aksi: backup, data lama
  // ===========================================================================

  function unduhBackup() {
    const hasil = D.buatBackup(data, Date.now());
    unduhFile('keuangan-harian-backup-' + D.tanggalLokal() + '.json', hasil.teks, 'application/json');
    const s = simpan(hasil.data);
    tampilkanToast(s.ok ? 'Backup diunduh. Simpan filenya di tempat yang aman.' : s.pesan);
  }

  function unduhIsiLama(isi) {
    let json = true;
    try { JSON.parse(isi); } catch (galat) { json = false; }
    unduhFile('keuangan-harian-data-lama-' + D.tanggalLokal() + (json ? '.json' : '.txt'), isi,
      json ? 'application/json' : 'text/plain');
    tampilkanToast('Data lama diunduh.');
  }

  function bacaSalinan(kunci) {
    try { return penyimpanan.getItem(kunci); } catch (galat) { return null; }
  }

  function unduhDataLama() {
    let isi = infoMuat.mentah;
    if (isi == null && infoMuat.kunciSalinan) isi = bacaSalinan(infoMuat.kunciSalinan);
    if (isi == null) {
      tampilkanToast('Data lama tidak ditemukan lagi.');
      return;
    }
    unduhIsiLama(isi);
  }

  function unduhSalinan(kunci) {
    const isi = bacaSalinan(kunci);
    if (isi == null) {
      tampilkanToast('Salinan itu sudah tidak ada.');
      gambarUlang();
      return;
    }
    unduhIsiLama(isi);
  }

  async function hapusSalinan(kunci) {
    const ya = await konfirmasi({
      judul: 'Hapus data lama ini?',
      pesan: 'Salinan dari ' + labelSalinan(kunci) + ' akan dihapus dan tidak bisa dikembalikan.',
      ya: 'Hapus'
    });
    if (!ya) return;
    const hasil = D.hapusSalinanRusak(penyimpanan, kunci);
    if (!hasil.ok) {
      tampilkanToast(hasil.pesan);
      return;
    }
    if (infoMuat.kunciSalinan === kunci) {
      infoMuat.kunciSalinan = null;
      hapusPemberitahuan('data-rusak');
    }
    gambarUlang();
    tampilkanToast('Data lama dihapus.');
  }

  function eksporCSV() {
    if (!data.transaksi.length) {
      tampilkanToast('Belum ada transaksi untuk diekspor.');
      return;
    }
    unduhFile('keuangan-harian-' + D.tanggalLokal() + '.csv', D.buatCSV(data), 'text/csv;charset=utf-8');
    tampilkanToast('CSV diunduh (' + data.transaksi.length + ' transaksi).');
  }

  /** Pulihkan dari file: periksa isi dulu, tampilkan ringkasan, baru ganti data setelah dikonfirmasi. */
  async function pulihkanDariFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      await pesanDialog('File terlalu besar', 'File backup Keuangan Harian biasanya jauh di bawah 20 MB. Pastikan file yang dipilih benar. Data Anda tidak diubah.');
      return;
    }
    let teks;
    try {
      teks = await file.text();
    } catch (galat) {
      await pesanDialog('File tidak bisa dibaca', 'Coba pilih file itu lagi. Data Anda tidak diubah.');
      return;
    }
    const hasil = D.bacaBackup(teks);
    if (!hasil.ok) {
      await pesanDialog('Backup tidak bisa dipakai', hasil.pesan + ' Data Anda tidak diubah.');
      return;
    }
    const r = D.ringkasData(hasil.data);
    let isi = 'File "' + file.name + '" berisi ' + r.akun + ' akun, ' + r.kategori + ' kategori, dan ' +
      r.transaksi + ' transaksi';
    if (r.dari) {
      isi += r.dari === r.sampai
        ? ' (tanggal ' + formatTanggalSingkat(r.dari) + ')'
        : ' (' + formatTanggalSingkat(r.dari) + ' sampai ' + formatTanggalSingkat(r.sampai) + ')';
    }
    isi += '.';
    if (r.backupTerakhir) isi += ' Backup dibuat ' + formatWaktu(r.backupTerakhir) + '.';
    isi += ' Data sekarang (' + data.transaksi.length + ' transaksi) akan diganti dan tidak bisa dikembalikan.';
    if (tersambung()) isi += ' Karena perangkat ini tersambung ke akun Google, penggantian ini juga berlaku di perangkat lain.';
    const ya = await konfirmasi({ judul: 'Ganti data dengan backup ini?', pesan: isi, ya: 'Ganti data' });
    if (!ya) return;
    let pengganti = hasil.data;
    if (tersambung()) {
      // Isi backup dicatat sebagai perubahan baru (dan yang tidak ada di backup diberi tanda
      // hapus), supaya perangkat lain ikut menjadi sama dengan backup, bukan sebaliknya.
      const siap = D.siapkanPulihan(data, hasil.data, Date.now());
      if (!siap.ok) {
        await pesanDialog('Backup tidak bisa dipakai', siap.pesan + ' Data Anda tidak diubah.');
        return;
      }
      pengganti = siap.data;
    }
    const s = simpan(pengganti);
    tampilkanToast(s.ok ? 'Data dipulihkan dari backup.' : s.pesan);
  }

  function unduhCadangan(kunci) {
    const isi = bacaSalinan(kunci);
    if (isi == null) {
      tampilkanToast('Salinan itu sudah tidak ada.');
      gambarUlang();
      return;
    }
    const tanggal = (/(\d{4}-\d{2}-\d{2})T/.exec(kunci) || [])[1] || D.tanggalLokal();
    unduhFile('keuangan-harian-salinan-pengaman-' + tanggal + '.json', isi, 'application/json');
    tampilkanToast('Salinan pengaman diunduh. Isinya bisa dipulihkan lewat "Pulihkan dari backup".');
  }

  async function hapusCadangan(kunci) {
    const ya = await konfirmasi({
      judul: 'Hapus salinan pengaman ini?',
      pesan: 'Salinan dari ' + labelSalinan(kunci) + ' akan dihapus dan tidak bisa dikembalikan.',
      ya: 'Hapus'
    });
    if (!ya) return;
    const hasil = D.hapusCadangan(penyimpanan, kunci);
    if (!hasil.ok) {
      tampilkanToast(hasil.pesan);
      return;
    }
    gambarUlang();
    tampilkanToast('Salinan pengaman dihapus.');
  }

  async function hapusSemua() {
    const ya = await konfirmasi({
      judul: 'Hapus semua data?',
      pesan: tersambung()
        ? 'Semua akun, kategori, dan ' + data.transaksi.length + ' transaksi akan dihapus dari perangkat ini, dari akun Google, dan dari perangkat lain yang tersambung, dan tidak bisa dikembalikan. Unduh backup dulu kalau masih diperlukan. Kalau hanya ingin mengosongkan perangkat ini, keluar dulu dari akun Google.'
        : 'Semua akun, kategori, dan ' + data.transaksi.length + ' transaksi di browser ini akan dihapus dan tidak bisa dikembalikan. Unduh backup dulu kalau masih diperlukan.',
      ya: 'Hapus semua'
    });
    if (!ya) return;
    // Tersambung: mulai lagi dari data awal, dengan tanda hapus untuk semua yang lama,
    // supaya penghapusannya ikut sampai ke akun Google dan perangkat lain.
    const ikutAwan = tersambung();
    if (modeSimpan === 'memori') {
      data = D.buatDataAwal();
    } else {
      const hasil = D.hapusSemuaData(penyimpanan, ikutAwan ? D.kosongkanSemua(data, Date.now()).data : undefined);
      if (!hasil.ok) {
        tampilkanToast(hasil.pesan);
        return;
      }
      data = hasil.data;
      modeSimpan = 'normal';
      infoMuat.mentah = null;
      infoMuat.kunciSalinan = null;
      hapusPemberitahuan('data-tertahan');
      hapusPemberitahuan('data-rusak');
    }
    gambarUlang();
    tampilkanToast('Semua data dihapus. Aplikasi kembali ke data awal.');
    if (ikutAwan) jadwalkanSinkron(0);
  }

  async function mulaiDataBaru() {
    const ya = await konfirmasi({
      judul: 'Mulai data baru?',
      pesan: 'Data lama yang rusak akan ditimpa dan tidak bisa dikembalikan. Pastikan sudah diunduh.',
      ya: 'Mulai data baru'
    });
    if (!ya) return;
    const hasil = D.simpanData(penyimpanan, data);
    if (!hasil.ok) {
      tampilkanToast(hasil.pesan);
      return;
    }
    modeSimpan = 'normal';
    infoMuat.mentah = null;
    hapusPemberitahuan('data-tertahan');
    gambarUlang();
    tampilkanToast('Data baru siap dipakai.');
  }

  function tanganiAksi(e) {
    const el = e.target.closest('[data-aksi]');
    if (!el) return;
    const aksi = el.getAttribute('data-aksi');
    if (aksi === 'unduh-backup') {
      unduhBackup();
    } else if (aksi === 'lewati-saldo-awal') {
      const s = simpan(D.tutupAjakanSaldoAwal(data).data);
      tampilkanToast(s.ok ? 'Saldo awal bisa diatur kapan saja di Pengaturan.' : s.pesan);
    } else if (aksi === 'unduh-data-lama') {
      unduhDataLama();
    } else if (aksi === 'mulai-data-baru') {
      mulaiDataBaru();
    } else if (aksi === 'tutup-pemberitahuan') {
      hapusPemberitahuan(el.getAttribute('data-id'));
    } else if (aksi === 'pilih-backup') {
      $('#pilih-backup').click();
    } else if (aksi === 'ekspor-csv') {
      eksporCSV();
    } else if (aksi === 'hapus-semua') {
      hapusSemua();
    } else if (aksi === 'unduh-salinan') {
      unduhSalinan(el.getAttribute('data-kunci'));
    } else if (aksi === 'hapus-salinan') {
      hapusSalinan(el.getAttribute('data-kunci'));
    } else if (aksi === 'unduh-cadangan') {
      unduhCadangan(el.getAttribute('data-kunci'));
    } else if (aksi === 'hapus-cadangan') {
      hapusCadangan(el.getAttribute('data-kunci'));
    } else if (aksi === 'masuk-google') {
      mulaiMasuk();
    } else if (aksi === 'keluar-google') {
      keluarGoogle();
    } else if (aksi === 'sinkron-sekarang') {
      // Diminta langsung: ambil seluruh data awan, jangan hanya menanyakan nomor revisinya.
      jalankanSinkron({ dariPengguna: true, tanya: true, paksa: true });
    } else if (aksi === 'sambungkan') {
      jalankanSinkron({ dariPengguna: true, tanya: true });
    } else if (['bulan-sebelumnya', 'bulan-berikutnya', 'bulan-ini', 'hapus-filter'].indexOf(aksi) >= 0) {
      if (layarAktif && layarAktif.nama === 'riwayat') tanganiAksiRiwayat(aksi);
      else if (layarAktif && layarAktif.nama === 'laporan' && aksi !== 'hapus-filter') tanganiAksiLaporan(aksi);
    }
  }

  function tanganiPerubahan(e) {
    if (e.target.id === 'pilih-backup') {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // supaya file yang sama bisa dipilih lagi
      pulihkanDariFile(file);
      return;
    }
    tanganiUbahFilter(e);
  }

  function tanganiUbahFilter(e) {
    if (!layarAktif || layarAktif.nama !== 'riwayat') return;
    const f = filterRiwayat(layarAktif.param);
    if (e.target.name === 'filter-jenis') {
      f.jenis = e.target.value;
      perbaruiRiwayat(f);
    } else if (e.target.id === 'filter-akun') {
      f.akunId = e.target.value || null;
      perbaruiRiwayat(f);
    }
  }

  // ===========================================================================
  // Mulai
  // ===========================================================================

  function pasangPendengar() {
    window.addEventListener('hashchange', tanganiRute);

    $('#tombol-catat').addEventListener('click', function () {
      if (lembarAktif) return;
      // Dibuka langsung di sini (bukan menunggu hashchange) supaya fokus ke
      // kolom jumlah terjadi dalam ketukan yang sama: syarat keyboard muncul di iPhone.
      bukaLembar({ lembar: 'catat', kunci: '/catat', param: new URLSearchParams() }, true);
      location.hash = '#/catat';
    });

    const dialogLembar = $('#lembar');
    dialogLembar.addEventListener('cancel', function (e) {
      // Esc atau tombol back Android: tutup lewat riwayat supaya hash ikut kembali.
      e.preventDefault();
      tutupLembar();
    });
    dialogLembar.addEventListener('click', function (e) {
      if (e.target.closest('[data-aksi="tutup-lembar"]')) tutupLembar();
    });
    dialogLembar.addEventListener('input', hapusGalatSaatDiubah);

    $('#layar').addEventListener('click', tanganiAksi);
    $('#layar').addEventListener('change', tanganiPerubahan);
    $('#pemberitahuan').addEventListener('click', tanganiAksi);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        kirimYangMenunggu();
        return;
      }
      // Kembali ke aplikasi setelah lewat tengah malam: "hari ini" & "bulan ini" diperbarui.
      gambarUlang();
      sinkronOtomatis();
    });
    window.addEventListener('pagehide', kirimYangMenunggu);
    window.addEventListener('online', function () {
      sinkronTerakhirDicoba = 0; // internet baru tersambung lagi: langsung coba
      sinkronOtomatis();
    });

    // Aplikasi terbuka di dua tab: ikuti perubahan dari tab lain.
    window.addEventListener('storage', function (e) {
      if (S && e.key === S.KUNCI_SESI) {
        gambarUlang(); // masuk atau keluar di tab lain
        return;
      }
      if (e.key !== D.KUNCI_PENYIMPANAN || e.newValue == null || modeSimpan !== 'normal') return;
      let hasil;
      try {
        hasil = D.periksaData(JSON.parse(e.newValue));
      } catch (galat) {
        return;
      }
      if (!hasil.ok) return;
      data = hasil.data;
      gambarUlang();
    });
  }

  function mulai() {
    pasangManifest();
    const jawabanLogin = ambilJawabanLogin(); // sebelum routing: token langsung dibuang dari alamat
    infoMuat = D.muatData(penyimpanan);
    data = infoMuat.data;
    if (infoMuat.status === 'tanpa-penyimpanan') modeSimpan = 'memori';
    else if (infoMuat.status === 'rusak' && !infoMuat.kunciSalinan) modeSimpan = 'tertahan';
    siapkanPemberitahuanAwal();
    pasangPendengar();
    tanganiRute(true);
    sudahMulai = true;
    daftarkanServiceWorker();
    mulaiSinkron(jawabanLogin);
  }

  mulai();
})();
