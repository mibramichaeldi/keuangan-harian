/*
 * Keuangan Harian — logika data & perhitungan.
 *
 * File ini tidak menyentuh DOM, jadi bisa dimuat dua cara:
 *   - di browser sebagai <script> biasa  -> window.KeuanganData
 *   - di Node lewat require()            -> module.exports (untuk tes)
 *
 * Aturan yang dijaga di sini:
 *   - Uang selalu bilangan bulat Rupiah. Jumlah transaksi: 1 s.d. 999.999.999.999.
 *   - Saldo tidak pernah disimpan; selalu dihitung dari saldo awal + transaksi.
 *   - Transfer bukan pemasukan/pengeluaran dan tidak masuk laporan.
 *   - "Hari ini" memakai waktu lokal, bukan toISOString() (UTC).
 *
 * Semua fungsi pengubah bersifat murni: data lama tidak pernah diubah.
 * Hasilnya { ok: true, data: dataBaru, ... } atau { ok: false, pesan, kolom }.
 * `kolom` menunjuk isian form yang bermasalah (mis. 'jumlah').
 *
 * Untuk sinkron antar perangkat, tiap akun, kategori, dan transaksi membawa
 * `diubah` (waktu terakhir diubah, ms), dan tiap penghapusan meninggalkan tanda
 * di `terhapus`. Keduanya isian tambahan: data lama yang belum memilikinya tetap
 * terbaca. Aturan penggabungannya ada di bagian "Sinkron antar perangkat".
 */
(function (root, buat) {
  'use strict';
  var api = buat();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KeuanganData = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Konstanta
  // ---------------------------------------------------------------------------

  const ID_APLIKASI = 'keuangan-harian';
  const VERSI_DATA = 1;
  const KUNCI_PENYIMPANAN = 'keuangan-harian:v1';
  const AWALAN_SALINAN_RUSAK = 'keuangan-harian:v1:rusak:';
  const AWALAN_CADANGAN = 'keuangan-harian:v1:cadangan:';
  const JUMLAH_MAKS = 999999999999;
  const PANJANG_NAMA_MAKS = 40;
  const PANJANG_CATATAN_MAKS = 200;
  const HARI_PENGINGAT_BACKUP = 7;
  const MS_PER_HARI = 24 * 60 * 60 * 1000;
  // Ditulis lewat kode karakter supaya file ini tetap ASCII murni di bagian kode.
  const TANDA_MINUS = String.fromCharCode(0x2212); // minus sungguhan, selebar "+" pada angka tabular
  const BOM = String.fromCharCode(0xFEFF);

  const JENIS_AKUN = ['tunai', 'bank', 'ewallet', 'kartu_kredit', 'lainnya'];
  const LABEL_JENIS_AKUN = {
    tunai: 'Tunai',
    bank: 'Bank',
    ewallet: 'E-wallet',
    kartu_kredit: 'Kartu kredit',
    lainnya: 'Lainnya'
  };
  const TIPE_TRANSAKSI = ['keluar', 'masuk', 'transfer'];
  const TIPE_KATEGORI = ['keluar', 'masuk'];
  const LABEL_TIPE = { keluar: 'Pengeluaran', masuk: 'Pemasukan', transfer: 'Transfer' };

  const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const NAMA_BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu',
    'Sep', 'Okt', 'Nov', 'Des'];
  const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  const AKUN_AWAL = [
    { nama: 'Tunai', jenis: 'tunai' },
    { nama: 'Rekening bank', jenis: 'bank' },
    { nama: 'E-wallet', jenis: 'ewallet' }
  ];
  const KATEGORI_AWAL = {
    keluar: ['Makan & minum', 'Transportasi', 'Belanja harian', 'Tagihan & listrik',
      'Pulsa & internet', 'Kesehatan', 'Hiburan', 'Pendidikan', 'Sedekah & donasi', 'Lainnya'],
    masuk: ['Gaji', 'Bonus', 'Usaha sampingan', 'Hadiah', 'Lainnya']
  };

  // Id hanya boleh huruf, angka, _ dan - supaya aman dipakai di atribut HTML.
  const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;

  // Koleksi yang disinkronkan, dan isian tiap rekaman dalam urutan baku.
  const KOLEKSI = ['akun', 'kategori', 'transaksi'];
  const ISIAN = {
    akun: ['id', 'nama', 'jenis', 'saldoAwal', 'diubah'],
    kategori: ['id', 'nama', 'tipe', 'diubah'],
    transaksi: ['id', 'tanggal', 'tipe', 'jumlah', 'akunId', 'akunTujuanId', 'kategoriId', 'catatan', 'dibuat', 'diubah']
  };

  // ---------------------------------------------------------------------------
  // Bantuan umum
  // ---------------------------------------------------------------------------

  function gagal(pesan, kolom) {
    return kolom ? { ok: false, pesan: pesan, kolom: kolom } : { ok: false, pesan: pesan };
  }

  function adalahObjek(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function ganti(objek, perubahan) {
    return Object.assign({}, objek, perubahan);
  }

  /**
   * Id baru: awalan + waktu (basis 36) + nomor urut + acak. Bagian waktu dan nomor
   * urutnya selalu naik, jadi mengurutkan menurut id sama dengan mengurutkan
   * menurut waktu dibuat. Urutan baku hasil penggabungan bergantung pada ini.
   */
  let waktuIdTerakhir = 0;
  let urutanId = 0;
  function buatId(awalan, sudahDipakai) {
    let id;
    do {
      let w = Date.now();
      if (w > waktuIdTerakhir) {
        urutanId = 0;
      } else {
        w = waktuIdTerakhir;
        urutanId += 1;
        if (urutanId >= 1296) { // nomor urut dua digit basis 36 habis: maju satu milidetik
          urutanId = 0;
          w += 1;
        }
      }
      waktuIdTerakhir = w;
      id = awalan + '_' + w.toString(36) + urutanId.toString(36).padStart(2, '0') +
        Math.random().toString(36).slice(2, 8);
    } while (sudahDipakai && sudahDipakai(id));
    return id;
  }

  function kini(sekarang) {
    return sekarang == null ? Date.now() : sekarang;
  }

  function waktuSah(n) {
    return Number.isSafeInteger(n) && n >= 0;
  }

  /**
   * Waktu untuk perubahan baru atas rekaman yang sudah ada. Selalu lebih besar
   * dari waktu sebelumnya, walau jam perangkat mundur atau tertinggal dari
   * perangkat lain; dengan begitu perubahan yang dibuat belakangan tetap menang.
   */
  function waktuSesudah(sekarang, sebelumnya) {
    return Math.max(kini(sekarang), (sebelumnya || 0) + 1);
  }

  // Rekaman selalu dibuat lewat tiga fungsi ini supaya urutan isiannya seragam.
  function rekamAkun(id, nama, jenis, saldoAwal, diubah) {
    return { id: id, nama: nama, jenis: jenis, saldoAwal: saldoAwal || 0, diubah: diubah || 0 }; // -0 -> 0
  }

  function rekamKategori(id, nama, tipe, diubah) {
    return { id: id, nama: nama, tipe: tipe, diubah: diubah || 0 };
  }

  function rekamTransaksi(id, t, dibuat, diubah) {
    return {
      id: id,
      tanggal: t.tanggal,
      tipe: t.tipe,
      jumlah: t.jumlah,
      akunId: t.akunId,
      akunTujuanId: t.akunTujuanId,
      kategoriId: t.kategoriId,
      catatan: t.catatan,
      dibuat: dibuat,
      diubah: diubah
    };
  }

  /** Sama isinya, tanpa memandang waktu ubah. */
  function samaIsi(koleksi, a, b) {
    return ISIAN[koleksi].every(function (k) { return k === 'diubah' || a[k] === b[k]; });
  }

  function terhapusKosong() {
    return { akun: {}, kategori: {}, transaksi: {} };
  }

  /** Waktu tanda hapus untuk id itu, atau null kalau tidak ada. */
  function tandaHapus(data, koleksi, id) {
    const peta = data.terhapus && data.terhapus[koleksi];
    return peta && Object.prototype.hasOwnProperty.call(peta, id) ? peta[id] : null;
  }

  /** Salinan `terhapus` dengan satu tanda dipasang (waktu) atau dibuang (waktu null). */
  function aturTanda(terhapus, koleksi, id, waktu) {
    const dasar = terhapus || terhapusKosong();
    const hasil = { akun: dasar.akun || {}, kategori: dasar.kategori || {}, transaksi: dasar.transaksi || {} };
    const peta = Object.assign({}, hasil[koleksi]);
    if (waktu == null) delete peta[id];
    else peta[id] = waktu;
    hasil[koleksi] = peta;
    return hasil;
  }

  function rapikanNama(nama) {
    return typeof nama === 'string' ? nama.trim().replace(/\s+/g, ' ') : nama;
  }

  function samaNama(a, b) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Tanggal (selalu waktu lokal)
  // ---------------------------------------------------------------------------

  /** 'YYYY-MM-DD' menurut jam lokal perangkat. Jangan ganti dengan toISOString(). */
  function tanggalLokal(waktu) {
    const d = waktu instanceof Date ? waktu : (waktu == null ? new Date() : new Date(waktu));
    return String(d.getFullYear()).padStart(4, '0') + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 'YYYY-MM' menurut jam lokal. */
  function bulanLokal(waktu) {
    return tanggalLokal(waktu).slice(0, 7);
  }

  /** bulan: 1–12 */
  function jumlahHariDalamBulan(tahun, bulan) {
    return new Date(tahun, bulan, 0).getDate();
  }

  function tanggalValid(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const th = Number(s.slice(0, 4));
    const bl = Number(s.slice(5, 7));
    const tg = Number(s.slice(8, 10));
    return th >= 1900 && bl >= 1 && bl <= 12 && tg >= 1 && tg <= jumlahHariDalamBulan(th, bl);
  }

  function bulanValid(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
    const th = Number(s.slice(0, 4));
    const bl = Number(s.slice(5, 7));
    return th >= 1900 && bl >= 1 && bl <= 12;
  }

  /** '2026-01' + (-1) -> '2025-12' */
  function geserBulan(bulan, langkah) {
    const total = Number(bulan.slice(0, 4)) * 12 + (Number(bulan.slice(5, 7)) - 1) + langkah;
    return String(Math.floor(total / 12)).padStart(4, '0') + '-' + pad2((total % 12) + 1);
  }

  /** Date lokal pukul 00.00. Jangan pakai new Date('YYYY-MM-DD') karena itu dibaca sebagai UTC. */
  function tanggalKeDate(tanggal) {
    return new Date(Number(tanggal.slice(0, 4)), Number(tanggal.slice(5, 7)) - 1, Number(tanggal.slice(8, 10)));
  }

  function geserTanggal(tanggal, hari) {
    const d = tanggalKeDate(tanggal);
    d.setDate(d.getDate() + hari);
    return tanggalLokal(d);
  }

  /** '2026-11' -> 'November 2026' */
  function labelBulan(bulan) {
    return NAMA_BULAN[Number(bulan.slice(5, 7)) - 1] + ' ' + Number(bulan.slice(0, 4));
  }

  /** 'Hari ini', 'Kemarin', 'Kamis, 5 November' (+ tahun bila beda tahun) */
  function labelTanggal(tanggal, hariIni) {
    hariIni = hariIni || tanggalLokal();
    if (tanggal === hariIni) return 'Hari ini';
    if (tanggal === geserTanggal(hariIni, -1)) return 'Kemarin';
    const d = tanggalKeDate(tanggal);
    let teks = NAMA_HARI[d.getDay()] + ', ' + d.getDate() + ' ' + NAMA_BULAN[d.getMonth()];
    if (tanggal.slice(0, 4) !== hariIni.slice(0, 4)) teks += ' ' + d.getFullYear();
    return teks;
  }

  /** '2026-11-08' -> 'Minggu, 8 November 2026' */
  function formatTanggalPanjang(tanggal) {
    const d = tanggalKeDate(tanggal);
    return NAMA_HARI[d.getDay()] + ', ' + d.getDate() + ' ' + NAMA_BULAN[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** 'Hari ini', 'Kemarin', '5 Nov' (+ tahun bila beda tahun) */
  function labelTanggalPendek(tanggal, hariIni) {
    hariIni = hariIni || tanggalLokal();
    if (tanggal === hariIni) return 'Hari ini';
    if (tanggal === geserTanggal(hariIni, -1)) return 'Kemarin';
    const d = tanggalKeDate(tanggal);
    let teks = d.getDate() + ' ' + NAMA_BULAN_PENDEK[d.getMonth()];
    if (tanggal.slice(0, 4) !== hariIni.slice(0, 4)) teks += ' ' + d.getFullYear();
    return teks;
  }

  // ---------------------------------------------------------------------------
  // Uang
  // ---------------------------------------------------------------------------

  /** Jumlah transaksi sah: bilangan bulat, > 0, <= 999.999.999.999. */
  function jumlahValid(n) {
    return Number.isSafeInteger(n) && n > 0 && n <= JUMLAH_MAKS;
  }

  /** Saldo awal boleh 0 atau negatif (utang), tetap bilangan bulat. */
  function saldoAwalValid(n) {
    return Number.isSafeInteger(n) && Math.abs(n) <= JUMLAH_MAKS;
  }

  function pesanJumlah(n) {
    if (n === null || n === undefined || n === '') return 'Isi jumlahnya dulu.';
    if (typeof n !== 'number' || !Number.isFinite(n)) return 'Jumlah harus berupa angka.';
    if (!Number.isInteger(n)) return 'Jumlah harus bilangan bulat, tanpa desimal.';
    if (n <= 0) return 'Jumlah harus lebih dari 0.';
    if (n > JUMLAH_MAKS) return 'Jumlah maksimal ' + formatRupiah(JUMLAH_MAKS) + '.';
    return null;
  }

  /** 1250000 -> '1.250.000' (tanpa tanda) */
  function formatAngka(n) {
    return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /**
   * 1250000 -> 'Rp 1.250.000', -1250000 -> '−Rp 1.250.000'.
   * opsi.tanda = true menambahkan '+' untuk angka positif.
   */
  function formatRupiah(n, opsi) {
    const tanda = n < 0 ? TANDA_MINUS : (opsi && opsi.tanda && n > 0 ? '+' : '');
    return tanda + 'Rp ' + formatAngka(n);
  }

  /**
   * Teks isian -> bilangan bulat. Semua selain angka dibuang ('Rp 1.250.000' -> 1250000).
   * Akhiran ',00' ala Indonesia diabaikan. Kosong -> null.
   */
  function parseJumlah(teks) {
    if (typeof teks === 'number') return teks;
    const s = String(teks == null ? '' : teks).trim().replace(/,0{1,2}$/, '');
    const digit = s.replace(/\D/g, '');
    return digit ? Number(digit) : null;
  }

  /** 0.3456 -> '35%'. Porsi kecil tetap terlihat: '<1%', '>99%'. */
  function formatPersen(porsi) {
    const p = porsi * 100;
    if (!(p > 0)) return '0%';
    if (p < 1) return '<1%';
    if (p > 99 && p < 100) return '>99%';
    return Math.round(p) + '%';
  }

  /**
   * Bulatkan daftar porsi (0..1) menjadi persen bulat yang jumlahnya tepat 100
   * (metode sisa terbesar). Contoh: [0.625, 0.25, 0.125] -> [63, 25, 12], bukan 63+25+13.
   */
  function persenBulat(daftarPorsi) {
    const mentah = daftarPorsi.map(function (p) { return p * 100; });
    const hasil = mentah.map(function (m) { return Math.floor(m + 1e-9); });
    const total = mentah.reduce(function (a, b) { return a + b; }, 0);
    if (!(total > 0)) return hasil.map(function () { return 0; });
    let sisa = Math.round(total) - hasil.reduce(function (a, b) { return a + b; }, 0);
    const urutan = mentah
      .map(function (m, i) { return { i: i, pecahan: m - hasil[i] }; })
      .sort(function (a, b) { return (b.pecahan - a.pecahan) || (a.i - b.i); });
    for (let k = 0; k < urutan.length && sisa > 0; k++, sisa--) hasil[urutan[k].i] += 1;
    return hasil;
  }

  /** Teks untuk persen hasil persenBulat; porsi kecil tetap terlihat ('<1%', '>99%'). */
  function formatPersenBulat(persen, porsi) {
    if (porsi > 0 && persen === 0) return '<1%';
    if (porsi < 1 && persen === 100) return '>99%';
    return persen + '%';
  }

  // ---------------------------------------------------------------------------
  // Data awal & pencarian
  // ---------------------------------------------------------------------------

  function pengaturanAwal() {
    return {
      terakhir: {
        keluar: { akunId: null, kategoriId: null },
        masuk: { akunId: null, kategoriId: null },
        transfer: { akunId: null, akunTujuanId: null }
      },
      backupTerakhir: null,
      saldoAwalDiatur: false
    };
  }

  function buatDataAwal() {
    // Rekaman bawaan ber-`diubah` 0: belum pernah diubah siapa pun.
    const akun = [];
    AKUN_AWAL.forEach(function (a) {
      akun.push(rekamAkun(
        buatId('akun', function (id) { return akun.some(function (x) { return x.id === id; }); }),
        a.nama, a.jenis, 0, 0
      ));
    });
    const kategori = [];
    TIPE_KATEGORI.forEach(function (tipe) {
      KATEGORI_AWAL[tipe].forEach(function (nama) {
        kategori.push(rekamKategori(
          buatId('kat', function (id) { return kategori.some(function (x) { return x.id === id; }); }),
          nama, tipe, 0
        ));
      });
    });
    return {
      aplikasi: ID_APLIKASI,
      versi: VERSI_DATA,
      akun: akun,
      kategori: kategori,
      transaksi: [],
      terhapus: terhapusKosong(),
      pengaturan: pengaturanAwal()
    };
  }

  function cariAkun(data, id) {
    return data.akun.find(function (a) { return a.id === id; }) || null;
  }

  function cariKategori(data, id) {
    return data.kategori.find(function (k) { return k.id === id; }) || null;
  }

  function cariTransaksi(data, id) {
    return data.transaksi.find(function (t) { return t.id === id; }) || null;
  }

  function kategoriPerTipe(data, tipe) {
    return data.kategori.filter(function (k) { return k.tipe === tipe; });
  }

  // ---------------------------------------------------------------------------
  // Transaksi
  // ---------------------------------------------------------------------------

  /** Ambil hanya isian yang dikenal; transfer tanpa kategori, selain transfer tanpa akun tujuan. */
  function normalisasiTransaksi(input) {
    const tipe = input.tipe;
    let catatan = input.catatan;
    if (catatan == null) catatan = '';
    if (typeof catatan === 'string') catatan = catatan.trim();
    return {
      tanggal: input.tanggal,
      tipe: tipe,
      jumlah: input.jumlah,
      akunId: input.akunId || null,
      akunTujuanId: tipe === 'transfer' ? (input.akunTujuanId || null) : null,
      kategoriId: tipe === 'transfer' ? null : (input.kategoriId || null),
      catatan: catatan
    };
  }

  function cekTransaksi(data, t) {
    if (TIPE_TRANSAKSI.indexOf(t.tipe) < 0) return gagal('Jenis transaksi tidak dikenal.', 'tipe');
    const pesan = pesanJumlah(t.jumlah);
    if (pesan) return gagal(pesan, 'jumlah');
    if (!tanggalValid(t.tanggal)) return gagal('Tanggal tidak valid.', 'tanggal');
    if (!t.akunId) return gagal(t.tipe === 'transfer' ? 'Pilih akun asal.' : 'Pilih akun.', 'akunId');
    if (!cariAkun(data, t.akunId)) return gagal('Akun tidak ditemukan.', 'akunId');
    if (t.tipe === 'transfer') {
      if (!t.akunTujuanId) return gagal('Pilih akun tujuan.', 'akunTujuanId');
      if (!cariAkun(data, t.akunTujuanId)) return gagal('Akun tujuan tidak ditemukan.', 'akunTujuanId');
      if (t.akunTujuanId === t.akunId) return gagal('Akun asal dan tujuan tidak boleh sama.', 'akunTujuanId');
    } else {
      if (!t.kategoriId) return gagal('Pilih kategori.', 'kategoriId');
      const kat = cariKategori(data, t.kategoriId);
      if (!kat) return gagal('Kategori tidak ditemukan.', 'kategoriId');
      if (kat.tipe !== t.tipe) {
        return gagal('Kategori "' + kat.nama + '" khusus ' + LABEL_TIPE[kat.tipe].toLowerCase() +
          ', tidak bisa dipakai untuk ' + LABEL_TIPE[t.tipe].toLowerCase() + '.', 'kategoriId');
      }
    }
    if (typeof t.catatan !== 'string') return gagal('Catatan harus berupa teks.', 'catatan');
    if (t.catatan.length > PANJANG_CATATAN_MAKS) {
      return gagal('Catatan maksimal ' + PANJANG_CATATAN_MAKS + ' karakter.', 'catatan');
    }
    return null;
  }

  /** Periksa isian form tanpa menyimpan. null = sah. */
  function validasiTransaksi(data, input) {
    return cekTransaksi(data, normalisasiTransaksi(input || {}));
  }

  function catatPemakaian(pengaturan, t) {
    const terakhir = ganti(pengaturan.terakhir, {});
    if (t.tipe === 'transfer') {
      terakhir.transfer = { akunId: t.akunId, akunTujuanId: t.akunTujuanId };
    } else {
      terakhir[t.tipe] = { akunId: t.akunId, kategoriId: t.kategoriId };
    }
    return ganti(pengaturan, { terakhir: terakhir });
  }

  /** sekarang: waktu dicatat (ms); bawaan Date.now(). */
  function tambahTransaksi(data, input, sekarang) {
    const t = normalisasiTransaksi(input || {});
    const galat = cekTransaksi(data, t);
    if (galat) return galat;
    const w = kini(sekarang);
    const idBaru = buatId('trx', function (id) {
      return data.transaksi.some(function (x) { return x.id === id; }) || tandaHapus(data, 'transaksi', id) !== null;
    });
    const baru = rekamTransaksi(idBaru, t, w, w);
    return {
      ok: true,
      transaksi: baru,
      data: ganti(data, {
        transaksi: data.transaksi.concat([baru]),
        pengaturan: catatPemakaian(data.pengaturan, baru)
      })
    };
  }

  /**
   * Id dan waktu dibuat tetap; isian lain diganti dan waktu ubahnya maju.
   * Kalau isinya tidak berubah, data dikembalikan apa adanya.
   */
  function ubahTransaksi(data, id, input, sekarang) {
    const lama = cariTransaksi(data, id);
    if (!lama) return gagal('Transaksi tidak ditemukan.');
    const t = normalisasiTransaksi(input || {});
    const galat = cekTransaksi(data, t);
    if (galat) return galat;
    const baru = rekamTransaksi(lama.id, t, lama.dibuat, waktuSesudah(sekarang, lama.diubah));
    if (samaIsi('transaksi', lama, baru)) return { ok: true, transaksi: lama, data: data };
    return {
      ok: true,
      transaksi: baru,
      data: ganti(data, {
        transaksi: data.transaksi.map(function (x) { return x.id === id ? baru : x; })
      })
    };
  }

  /**
   * Menghapus transaksi dan meninggalkan tanda hapus (supaya ikut terhapus di
   * perangkat lain). Mengembalikan juga transaksi & posisinya, untuk "Batalkan".
   */
  function hapusTransaksi(data, id, sekarang) {
    const indeks = data.transaksi.findIndex(function (x) { return x.id === id; });
    if (indeks < 0) return gagal('Transaksi tidak ditemukan.');
    const lama = data.transaksi[indeks];
    return {
      ok: true,
      transaksi: lama,
      indeks: indeks,
      data: ganti(data, {
        transaksi: data.transaksi.filter(function (x) { return x.id !== id; }),
        terhapus: aturTanda(data.terhapus, 'transaksi', id, waktuSesudah(sekarang, lama.diubah))
      })
    };
  }

  /**
   * Batalkan penghapusan: transaksi kembali dengan id, waktu dibuat, dan posisi
   * yang sama. Waktu ubahnya dimajukan melewati tanda hapusnya, supaya tanda yang
   * mungkin sudah sampai ke perangkat lain kalah oleh pembatalan ini.
   */
  function kembalikanTransaksi(data, transaksi, indeks, sekarang) {
    if (!adalahObjek(transaksi) || cariTransaksi(data, transaksi.id)) {
      return gagal('Transaksi tidak bisa dikembalikan.');
    }
    const t = normalisasiTransaksi(transaksi);
    const galat = cekTransaksi(data, t);
    if (galat) return gagal('Transaksi tidak bisa dikembalikan. ' + galat.pesan);
    const tanda = tandaHapus(data, 'transaksi', transaksi.id);
    const kembali = rekamTransaksi(transaksi.id, t, transaksi.dibuat,
      waktuSesudah(sekarang, Math.max(transaksi.diubah || 0, tanda || 0)));
    const daftar = data.transaksi.slice();
    const posisi = (Number.isInteger(indeks) && indeks >= 0 && indeks <= daftar.length) ? indeks : daftar.length;
    daftar.splice(posisi, 0, kembali);
    return {
      ok: true,
      transaksi: kembali,
      data: ganti(data, {
        transaksi: daftar,
        terhapus: aturTanda(data.terhapus, 'transaksi', transaksi.id, null)
      })
    };
  }

  // ---------------------------------------------------------------------------
  // Akun
  // ---------------------------------------------------------------------------

  function cekNama(nama, label) {
    if (typeof nama !== 'string' || !nama) return 'Nama ' + label + ' wajib diisi.';
    if (nama.length > PANJANG_NAMA_MAKS) return 'Nama ' + label + ' maksimal ' + PANJANG_NAMA_MAKS + ' karakter.';
    return null;
  }

  function cekSaldoAwal(n, kolom) {
    if (!Number.isSafeInteger(n)) return gagal('Saldo awal harus bilangan bulat, tanpa desimal.', kolom);
    if (Math.abs(n) > JUMLAH_MAKS) return gagal('Saldo awal maksimal ' + formatRupiah(JUMLAH_MAKS) + '.', kolom);
    return null;
  }

  function cekAkun(data, a, idSendiri) {
    const pesanNama = cekNama(a.nama, 'akun');
    if (pesanNama) return gagal(pesanNama, 'nama');
    const kembar = data.akun.some(function (x) { return x.id !== idSendiri && samaNama(x.nama, a.nama); });
    if (kembar) return gagal('Sudah ada akun bernama "' + a.nama + '".', 'nama');
    if (JENIS_AKUN.indexOf(a.jenis) < 0) return gagal('Pilih jenis akun.', 'jenis');
    return cekSaldoAwal(a.saldoAwal, 'saldoAwal');
  }

  function tambahAkun(data, input, sekarang) {
    const a = {
      nama: rapikanNama(input.nama),
      jenis: input.jenis,
      saldoAwal: input.saldoAwal == null ? 0 : input.saldoAwal
    };
    const galat = cekAkun(data, a, null);
    if (galat) return galat;
    const idBaru = buatId('akun', function (id) {
      return !!cariAkun(data, id) || tandaHapus(data, 'akun', id) !== null;
    });
    const baru = rekamAkun(idBaru, a.nama, a.jenis, a.saldoAwal, kini(sekarang));
    return { ok: true, akun: baru, data: ganti(data, { akun: data.akun.concat([baru]) }) };
  }

  /** input boleh sebagian: { nama?, jenis?, saldoAwal? }. Tanpa perubahan isi, data tidak disentuh. */
  function ubahAkun(data, id, input, sekarang) {
    const lama = cariAkun(data, id);
    if (!lama) return gagal('Akun tidak ditemukan.');
    const a = {
      nama: input.nama === undefined ? lama.nama : rapikanNama(input.nama),
      jenis: input.jenis === undefined ? lama.jenis : input.jenis,
      saldoAwal: input.saldoAwal === undefined ? lama.saldoAwal : input.saldoAwal
    };
    const galat = cekAkun(data, a, id);
    if (galat) return galat;
    const baru = rekamAkun(id, a.nama, a.jenis, a.saldoAwal, waktuSesudah(sekarang, lama.diubah));
    if (samaIsi('akun', lama, baru)) return { ok: true, akun: lama, data: data };
    return {
      ok: true,
      akun: baru,
      data: ganti(data, { akun: data.akun.map(function (x) { return x.id === id ? baru : x; }) })
    };
  }

  /** Banyaknya transaksi yang memakai akun ini (sebagai asal atau tujuan transfer). */
  function hitungPemakaianAkun(data, id) {
    let n = 0;
    data.transaksi.forEach(function (t) {
      if (t.akunId === id || t.akunTujuanId === id) n += 1;
    });
    return n;
  }

  /** Lupakan id yang dihapus dari "terakhir dipakai". */
  function lupakanId(pengaturan, id) {
    function bersih(o) {
      const hasil = {};
      Object.keys(o).forEach(function (k) { hasil[k] = o[k] === id ? null : o[k]; });
      return hasil;
    }
    const t = pengaturan.terakhir;
    return ganti(pengaturan, {
      terakhir: { keluar: bersih(t.keluar), masuk: bersih(t.masuk), transfer: bersih(t.transfer) }
    });
  }

  function hapusAkun(data, id, sekarang) {
    const akun = cariAkun(data, id);
    if (!akun) return gagal('Akun tidak ditemukan.');
    const dipakai = hitungPemakaianAkun(data, id);
    if (dipakai > 0) {
      return gagal('Akun "' + akun.nama + '" dipakai di ' + formatAngka(dipakai) +
        ' transaksi, jadi tidak bisa dihapus.');
    }
    if (data.akun.length <= 1) return gagal('Minimal harus ada 1 akun.');
    return {
      ok: true,
      data: ganti(data, {
        akun: data.akun.filter(function (x) { return x.id !== id; }),
        terhapus: aturTanda(data.terhapus, 'akun', id, waktuSesudah(sekarang, akun.diubah)),
        pengaturan: lupakanId(data.pengaturan, id)
      })
    };
  }

  /**
   * Atur saldo awal beberapa akun sekaligus: { [akunId]: angka }.
   * Sekaligus menandai bahwa ajakan "Atur saldo awal" sudah dijawab.
   * Hanya akun yang saldonya benar-benar berubah yang waktu ubahnya maju.
   */
  function aturSaldoAwal(data, saldoPerAkun, sekarang) {
    const ids = Object.keys(saldoPerAkun || {});
    for (let i = 0; i < ids.length; i++) {
      const akun = cariAkun(data, ids[i]);
      if (!akun) return gagal('Akun tidak ditemukan.');
      const galat = cekSaldoAwal(saldoPerAkun[ids[i]], ids[i]);
      if (galat) return gagal(galat.pesan.replace('Saldo awal', 'Saldo awal ' + akun.nama), ids[i]);
    }
    return {
      ok: true,
      data: ganti(data, {
        akun: data.akun.map(function (a) {
          if (!Object.prototype.hasOwnProperty.call(saldoPerAkun, a.id)) return a;
          const saldo = saldoPerAkun[a.id] || 0;
          return saldo === a.saldoAwal
            ? a
            : rekamAkun(a.id, a.nama, a.jenis, saldo, waktuSesudah(sekarang, a.diubah));
        }),
        pengaturan: ganti(data.pengaturan, { saldoAwalDiatur: true })
      })
    };
  }

  /** Pengguna menutup ajakan tanpa mengisi. */
  function tutupAjakanSaldoAwal(data) {
    return { ok: true, data: ganti(data, { pengaturan: ganti(data.pengaturan, { saldoAwalDiatur: true }) }) };
  }

  function perluAjakanSaldoAwal(data) {
    return !data.pengaturan.saldoAwalDiatur && data.akun.every(function (a) { return a.saldoAwal === 0; });
  }

  // ---------------------------------------------------------------------------
  // Kategori
  // ---------------------------------------------------------------------------

  function cekKategori(data, k, idSendiri) {
    const pesanNama = cekNama(k.nama, 'kategori');
    if (pesanNama) return gagal(pesanNama, 'nama');
    if (TIPE_KATEGORI.indexOf(k.tipe) < 0) return gagal('Pilih tipe kategori.', 'tipe');
    const kembar = data.kategori.some(function (x) {
      return x.id !== idSendiri && x.tipe === k.tipe && samaNama(x.nama, k.nama);
    });
    if (kembar) {
      return gagal('Sudah ada kategori ' + LABEL_TIPE[k.tipe].toLowerCase() + ' bernama "' + k.nama + '".', 'nama');
    }
    return null;
  }

  function tambahKategori(data, input, sekarang) {
    const k = { nama: rapikanNama(input.nama), tipe: input.tipe };
    const galat = cekKategori(data, k, null);
    if (galat) return galat;
    const idBaru = buatId('kat', function (id) {
      return !!cariKategori(data, id) || tandaHapus(data, 'kategori', id) !== null;
    });
    const baru = rekamKategori(idBaru, k.nama, k.tipe, kini(sekarang));
    return { ok: true, kategori: baru, data: ganti(data, { kategori: data.kategori.concat([baru]) }) };
  }

  /** Hanya ganti nama; tipe kategori tidak bisa diubah. Tanpa perubahan isi, data tidak disentuh. */
  function ubahKategori(data, id, input, sekarang) {
    const lama = cariKategori(data, id);
    if (!lama) return gagal('Kategori tidak ditemukan.');
    const k = { nama: rapikanNama(input.nama), tipe: lama.tipe };
    const galat = cekKategori(data, k, id);
    if (galat) return galat;
    const baru = rekamKategori(id, k.nama, k.tipe, waktuSesudah(sekarang, lama.diubah));
    if (samaIsi('kategori', lama, baru)) return { ok: true, kategori: lama, data: data };
    return {
      ok: true,
      kategori: baru,
      data: ganti(data, { kategori: data.kategori.map(function (x) { return x.id === id ? baru : x; }) })
    };
  }

  function hitungPemakaianKategori(data, id) {
    let n = 0;
    data.transaksi.forEach(function (t) {
      if (t.kategoriId === id) n += 1;
    });
    return n;
  }

  function hapusKategori(data, id, sekarang) {
    const kat = cariKategori(data, id);
    if (!kat) return gagal('Kategori tidak ditemukan.');
    const dipakai = hitungPemakaianKategori(data, id);
    if (dipakai > 0) {
      return gagal('Kategori "' + kat.nama + '" dipakai di ' + formatAngka(dipakai) +
        ' transaksi, jadi tidak bisa dihapus.');
    }
    if (kategoriPerTipe(data, kat.tipe).length <= 1) {
      return gagal('Minimal harus ada 1 kategori ' + LABEL_TIPE[kat.tipe].toLowerCase() + '.');
    }
    return {
      ok: true,
      data: ganti(data, {
        kategori: data.kategori.filter(function (x) { return x.id !== id; }),
        terhapus: aturTanda(data.terhapus, 'kategori', id, waktuSesudah(sekarang, kat.diubah)),
        pengaturan: lupakanId(data.pengaturan, id)
      })
    };
  }

  // ---------------------------------------------------------------------------
  // Pilihan awal form Catat
  // ---------------------------------------------------------------------------

  /**
   * Akun & kategori yang otomatis terpilih saat form dibuka, sesuai yang terakhir
   * dipakai untuk jenis itu. Kalau belum ada, ambil yang pertama.
   */
  function pilihanAwalForm(data, tipe) {
    const terakhir = data.pengaturan.terakhir;
    const pertama = data.akun.length ? data.akun[0].id : null;
    function akunAda(id) { return id && cariAkun(data, id) ? id : null; }

    if (tipe === 'transfer') {
      const dari = akunAda(terakhir.transfer.akunId) || pertama;
      let ke = akunAda(terakhir.transfer.akunTujuanId);
      if (!ke || ke === dari) {
        const lain = data.akun.find(function (a) { return a.id !== dari; });
        ke = lain ? lain.id : null;
      }
      return { akunId: dari, akunTujuanId: ke, kategoriId: null };
    }

    const t = terakhir[tipe] || {};
    const daftarKategori = kategoriPerTipe(data, tipe);
    const kategoriAda = daftarKategori.some(function (k) { return k.id === t.kategoriId; });
    return {
      akunId: akunAda(t.akunId) || pertama,
      akunTujuanId: null,
      kategoriId: kategoriAda ? t.kategoriId : (daftarKategori.length ? daftarKategori[0].id : null)
    };
  }

  // ---------------------------------------------------------------------------
  // Perhitungan: saldo, laporan, riwayat
  // ---------------------------------------------------------------------------

  /**
   * Saldo = saldoAwal + pemasukan - pengeluaran - transfer keluar + transfer masuk.
   * Hasil: { perAkun: { [akunId]: saldo }, total }
   */
  function hitungSaldo(data) {
    const perAkun = Object.create(null);
    data.akun.forEach(function (a) { perAkun[a.id] = a.saldoAwal; });
    data.transaksi.forEach(function (t) {
      if (!(t.akunId in perAkun)) return;
      if (t.tipe === 'masuk') {
        perAkun[t.akunId] += t.jumlah;
      } else if (t.tipe === 'keluar') {
        perAkun[t.akunId] -= t.jumlah;
      } else if (t.tipe === 'transfer' && t.akunTujuanId in perAkun) {
        perAkun[t.akunId] -= t.jumlah;
        perAkun[t.akunTujuanId] += t.jumlah;
      }
    });
    let total = 0;
    data.akun.forEach(function (a) { total += perAkun[a.id]; });
    return { perAkun: perAkun, total: total };
  }

  /** [{ akun, saldo }] sesuai urutan akun. */
  function daftarSaldoAkun(data) {
    const saldo = hitungSaldo(data).perAkun;
    return data.akun.map(function (a) { return { akun: a, saldo: saldo[a.id] }; });
  }

  /**
   * Ringkasan satu bulan ('YYYY-MM'). Transfer tidak dihitung.
   * Rata-rata pengeluaran per hari:
   *   - bulan yang sudah lewat: total ÷ jumlah hari di bulan itu
   *   - bulan berjalan: pengeluaran bertanggal s.d. hari ini ÷ tanggal hari ini
   *   - bulan yang belum datang: null
   */
  function ringkasanBulan(data, bulan, hariIni) {
    hariIni = hariIni || tanggalLokal();
    const bulanSekarang = hariIni.slice(0, 7);
    const namaKategori = new Map(data.kategori.map(function (k) { return [k.id, k.nama]; }));
    const perKategori = { keluar: new Map(), masuk: new Map() };
    let pemasukan = 0;
    let pengeluaran = 0;
    let pengeluaranSampaiHariIni = 0;
    let jumlahTransaksi = 0;

    data.transaksi.forEach(function (t) {
      if (t.tipe === 'transfer' || t.tanggal.slice(0, 7) !== bulan) return;
      jumlahTransaksi += 1;
      if (t.tipe === 'masuk') {
        pemasukan += t.jumlah;
      } else {
        pengeluaran += t.jumlah;
        if (t.tanggal <= hariIni) pengeluaranSampaiHariIni += t.jumlah;
      }
      const peta = perKategori[t.tipe];
      peta.set(t.kategoriId, (peta.get(t.kategoriId) || 0) + t.jumlah);
    });

    let hariDihitung = 0;
    let dasarRataRata = 0;
    let rataRataHarian = null;
    if (bulan < bulanSekarang) {
      hariDihitung = jumlahHariDalamBulan(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)));
      dasarRataRata = pengeluaran;
    } else if (bulan === bulanSekarang) {
      hariDihitung = Number(hariIni.slice(8, 10));
      dasarRataRata = pengeluaranSampaiHariIni;
    }
    if (hariDihitung > 0) rataRataHarian = Math.round(dasarRataRata / hariDihitung);

    function urutkan(peta, total) {
      const daftar = Array.from(peta, function (pasangan) {
        return {
          kategoriId: pasangan[0],
          nama: namaKategori.get(pasangan[0]) || '(tanpa kategori)',
          jumlah: pasangan[1],
          porsi: total > 0 ? pasangan[1] / total : 0
        };
      }).sort(function (a, b) { return b.jumlah - a.jumlah || a.nama.localeCompare(b.nama, 'id'); });
      const persen = persenBulat(daftar.map(function (k) { return k.porsi; }));
      daftar.forEach(function (k, i) { k.persen = persen[i]; });
      return daftar;
    }

    return {
      bulan: bulan,
      pemasukan: pemasukan,
      pengeluaran: pengeluaran,
      selisih: pemasukan - pengeluaran,
      rataRataHarian: rataRataHarian,
      hariDihitung: hariDihitung,
      dasarRataRata: dasarRataRata, // pengeluaran yang dibagi (bulan berjalan: s.d. hari ini)
      jumlahTransaksi: jumlahTransaksi, // tanpa transfer
      perKategori: {
        keluar: urutkan(perKategori.keluar, pengeluaran),
        masuk: urutkan(perKategori.masuk, pemasukan)
      }
    };
  }

  /** Terbaru dulu: tanggal, lalu waktu dicatat. */
  function urutTerbaru(a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    if (a.dibuat !== b.dibuat) return b.dibuat - a.dibuat;
    return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
  }

  /**
   * Transaksi dalam satu bulan, terbaru dulu.
   * filter.tipe: 'semua' | 'keluar' | 'masuk' | 'transfer'
   * filter.akunId: akun asal ATAU tujuan transfer
   */
  function transaksiBulan(data, bulan, filter) {
    filter = filter || {};
    const tipe = filter.tipe && filter.tipe !== 'semua' ? filter.tipe : null;
    const akunId = filter.akunId || null;
    return data.transaksi.filter(function (t) {
      return t.tanggal.slice(0, 7) === bulan &&
        (!tipe || t.tipe === tipe) &&
        (!akunId || t.akunId === akunId || t.akunTujuanId === akunId);
    }).sort(urutTerbaru);
  }

  /** Daftar yang sudah urut -> [{ tanggal, transaksi: [...] }] */
  function kelompokkanPerTanggal(daftar) {
    const grup = [];
    daftar.forEach(function (t) {
      const akhir = grup[grup.length - 1];
      if (akhir && akhir.tanggal === t.tanggal) akhir.transaksi.push(t);
      else grup.push({ tanggal: t.tanggal, transaksi: [t] });
    });
    return grup;
  }

  /** n transaksi yang paling akhir dicatat (termasuk yang bertanggal mundur). */
  function transaksiTerakhir(data, n) {
    return data.transaksi.slice()
      .sort(function (a, b) { return (b.dibuat - a.dibuat) || urutTerbaru(a, b); })
      .slice(0, n == null ? 5 : n);
  }

  // ---------------------------------------------------------------------------
  // Pengingat
  // ---------------------------------------------------------------------------

  /** Ada transaksi dan backup terakhir lebih dari 7 hari lalu (atau belum pernah). */
  function perluPengingatBackup(data, sekarang) {
    if (!data.transaksi.length) return false;
    const terakhir = data.pengaturan.backupTerakhir;
    if (terakhir == null) return true;
    return (sekarang == null ? Date.now() : sekarang) - terakhir > HARI_PENGINGAT_BACKUP * MS_PER_HARI;
  }

  function hariSejakBackup(data, sekarang) {
    const terakhir = data.pengaturan.backupTerakhir;
    if (terakhir == null) return null;
    return Math.max(0, Math.floor(((sekarang == null ? Date.now() : sekarang) - terakhir) / MS_PER_HARI));
  }

  // ---------------------------------------------------------------------------
  // Ekspor CSV
  // ---------------------------------------------------------------------------

  /** Satu sel CSV. Teks berawalan = + - @ (juga tab/CR) diberi awalan ' agar tidak jadi rumus. */
  function selCSV(nilai, adalahTeks) {
    let s = nilai == null ? '' : String(nilai);
    if (adalahTeks && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** CSV semua transaksi, urut tanggal. Pemisah ';', UTF-8 dengan BOM, baris CRLF. */
  function buatCSV(data) {
    const namaAkun = new Map(data.akun.map(function (a) { return [a.id, a.nama]; }));
    const namaKategori = new Map(data.kategori.map(function (k) { return [k.id, k.nama]; }));
    const baris = ['Tanggal;Jenis;Jumlah;Akun;Akun tujuan;Kategori;Catatan'];
    data.transaksi.slice()
      .sort(function (a, b) {
        if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? -1 : 1;
        return a.dibuat - b.dibuat;
      })
      .forEach(function (t) {
        baris.push([
          selCSV(t.tanggal, false),
          selCSV(LABEL_TIPE[t.tipe], false),
          selCSV(String(t.jumlah), false),
          selCSV(namaAkun.get(t.akunId), true),
          selCSV(t.akunTujuanId ? namaAkun.get(t.akunTujuanId) : '', true),
          selCSV(t.kategoriId ? namaKategori.get(t.kategoriId) : '', true),
          selCSV(t.catatan, true)
        ].join(';'));
      });
    return BOM + baris.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // Pemeriksaan data utuh (dipakai saat memuat & memulihkan backup)
  // ---------------------------------------------------------------------------

  function bersihkanPengaturan(p, petaAkun, petaKategori) {
    if (!adalahObjek(p)) return pengaturanAwal();
    function akunAda(id) { return typeof id === 'string' && petaAkun.has(id) ? id : null; }
    function kategoriAda(id, tipe) {
      return typeof id === 'string' && petaKategori.has(id) && petaKategori.get(id).tipe === tipe ? id : null;
    }
    function objek(o) { return adalahObjek(o) ? o : {}; }
    const tr = objek(p.terakhir);
    return {
      terakhir: {
        keluar: { akunId: akunAda(objek(tr.keluar).akunId), kategoriId: kategoriAda(objek(tr.keluar).kategoriId, 'keluar') },
        masuk: { akunId: akunAda(objek(tr.masuk).akunId), kategoriId: kategoriAda(objek(tr.masuk).kategoriId, 'masuk') },
        transfer: { akunId: akunAda(objek(tr.transfer).akunId), akunTujuanId: akunAda(objek(tr.transfer).akunTujuanId) }
      },
      backupTerakhir: Number.isSafeInteger(p.backupTerakhir) && p.backupTerakhir >= 0 ? p.backupTerakhir : null,
      saldoAwalDiatur: p.saldoAwalDiatur === true
    };
  }

  /**
   * Tanda hapus yang sah saja: id wajar, waktu bilangan bulat, dan bukan untuk
   * rekaman yang masih ada (rekaman yang ada tidak boleh hilang gara-gara tanda nyasar).
   * `hidup`: { akun, kategori, transaksi } berisi Map/Set id yang masih ada.
   */
  function bersihkanTerhapus(mentah, hidup) {
    const hasil = terhapusKosong();
    if (!adalahObjek(mentah)) return hasil;
    KOLEKSI.forEach(function (k) {
      const peta = mentah[k];
      if (!adalahObjek(peta)) return;
      Object.keys(peta).forEach(function (id) {
        if (id !== '__proto__' && POLA_ID.test(id) && waktuSah(peta[id]) && !hidup[k].has(id)) {
          hasil[k][id] = peta[id];
        }
      });
    });
    return hasil;
  }

  /**
   * Periksa data mentah (hasil JSON.parse) secara menyeluruh.
   * Hasil: { ok: true, data: salinanBersih } atau { ok: false, pesan }.
   * Hanya isian yang dikenal yang disalin.
   */
  function periksaData(mentah) {
    return periksa(mentah, false);
  }

  /**
   * Seperti periksaData, tetapi untuk data yang dibaca dari awan. Tiap rekaman
   * tetap diperiksa sendiri-sendiri dengan ketat; yang TIDAK diperiksa adalah
   * hubungan antar rekaman: transaksi boleh memakai akun atau kategori yang
   * rekamannya sedang tidak ada, boleh tidak ada akun sama sekali, dan sebuah
   * rekaman boleh ada bersama tanda hapusnya. Keadaan seperti itu bisa muncul
   * sesaat ketika dua perangkat menulis ke awan pada waktu yang hampir bersamaan,
   * dan gabungData yang membereskannya.
   *
   * Hasilnya hanya untuk dioper ke gabungData sebagai `jauh`; jangan disimpan
   * atau ditampilkan apa adanya.
   */
  function periksaDataAwan(mentah) {
    return periksa(mentah, true);
  }

  function periksa(mentah, longgar) {
    function idSah(id) {
      return typeof id === 'string' && POLA_ID.test(id);
    }
    if (!adalahObjek(mentah) || mentah.aplikasi !== ID_APLIKASI) {
      return gagal('Ini bukan data Keuangan Harian.');
    }
    if (mentah.versi !== VERSI_DATA) {
      return gagal(typeof mentah.versi === 'number' && mentah.versi > VERSI_DATA
        ? 'Data ini dibuat oleh versi aplikasi yang lebih baru.'
        : 'Versi data tidak dikenali.');
    }
    if (!Array.isArray(mentah.akun) || !Array.isArray(mentah.kategori) || !Array.isArray(mentah.transaksi)) {
      return gagal('Daftar akun, kategori, atau transaksi tidak ada.');
    }
    if (!longgar && mentah.akun.length < 1) return gagal('Tidak ada akun sama sekali.');

    const petaAkun = new Map();
    const akun = [];
    for (let i = 0; i < mentah.akun.length; i++) {
      const a = mentah.akun[i];
      const ke = 'Akun ke-' + (i + 1);
      if (!adalahObjek(a)) return gagal(ke + ' tidak valid.');
      if (typeof a.id !== 'string' || !POLA_ID.test(a.id) || petaAkun.has(a.id)) {
        return gagal(ke + ' punya id yang tidak valid atau ganda.');
      }
      if (typeof a.nama !== 'string' || !a.nama.trim()) return gagal(ke + ' tidak punya nama.');
      if (JENIS_AKUN.indexOf(a.jenis) < 0) return gagal(ke + ' punya jenis yang tidak dikenal.');
      if (!saldoAwalValid(a.saldoAwal)) return gagal(ke + ' punya saldo awal yang tidak valid.');
      // Data lama belum punya waktu ubah: dianggap 0 (belum pernah diubah).
      const bersih = rekamAkun(a.id, a.nama, a.jenis, a.saldoAwal, waktuSah(a.diubah) ? a.diubah : 0);
      petaAkun.set(a.id, bersih);
      akun.push(bersih);
    }

    const petaKategori = new Map();
    const kategori = [];
    for (let i = 0; i < mentah.kategori.length; i++) {
      const k = mentah.kategori[i];
      const ke = 'Kategori ke-' + (i + 1);
      if (!adalahObjek(k)) return gagal(ke + ' tidak valid.');
      if (typeof k.id !== 'string' || !POLA_ID.test(k.id) || petaKategori.has(k.id)) {
        return gagal(ke + ' punya id yang tidak valid atau ganda.');
      }
      if (typeof k.nama !== 'string' || !k.nama.trim()) return gagal(ke + ' tidak punya nama.');
      if (TIPE_KATEGORI.indexOf(k.tipe) < 0) return gagal(ke + ' punya tipe yang tidak dikenal.');
      const bersih = rekamKategori(k.id, k.nama, k.tipe, waktuSah(k.diubah) ? k.diubah : 0);
      petaKategori.set(k.id, bersih);
      kategori.push(bersih);
    }

    const idTransaksi = new Set();
    const transaksi = [];
    for (let i = 0; i < mentah.transaksi.length; i++) {
      const t = mentah.transaksi[i];
      const ke = 'Transaksi ke-' + (i + 1);
      if (!adalahObjek(t)) return gagal(ke + ' tidak valid.');
      if (typeof t.id !== 'string' || !POLA_ID.test(t.id) || idTransaksi.has(t.id)) {
        return gagal(ke + ' punya id yang tidak valid atau ganda.');
      }
      if (!tanggalValid(t.tanggal)) return gagal(ke + ' punya tanggal yang tidak valid.');
      if (TIPE_TRANSAKSI.indexOf(t.tipe) < 0) return gagal(ke + ' punya jenis yang tidak dikenal.');
      if (!jumlahValid(t.jumlah)) return gagal(ke + ' punya jumlah yang tidak valid.');
      // Mode longgar: cukup id yang wajar; ada-tidaknya rekaman yang ditunjuk urusan gabungData.
      if (longgar ? !idSah(t.akunId) : !petaAkun.has(t.akunId)) return gagal(ke + ' memakai akun yang tidak ada.');
      if (t.tipe === 'transfer') {
        if ((longgar ? !idSah(t.akunTujuanId) : !petaAkun.has(t.akunTujuanId)) || t.akunTujuanId === t.akunId) {
          return gagal(ke + ' punya akun tujuan yang tidak valid.');
        }
        if (t.kategoriId != null) return gagal(ke + ' adalah transfer tetapi punya kategori.');
      } else {
        if (t.akunTujuanId != null) return gagal(ke + ' punya akun tujuan padahal bukan transfer.');
        const kat = petaKategori.get(t.kategoriId);
        if (longgar ? !idSah(t.kategoriId) : !kat) return gagal(ke + ' memakai kategori yang tidak ada.');
        if (kat && kat.tipe !== t.tipe) return gagal(ke + ' memakai kategori dengan tipe yang salah.');
      }
      const catatan = t.catatan == null ? '' : t.catatan;
      if (typeof catatan !== 'string') return gagal(ke + ' punya catatan yang tidak valid.');
      if (!Number.isSafeInteger(t.dibuat) || t.dibuat < 0) return gagal(ke + ' punya waktu dicatat yang tidak valid.');
      idTransaksi.add(t.id);
      transaksi.push(rekamTransaksi(t.id, {
        tanggal: t.tanggal,
        tipe: t.tipe,
        jumlah: t.jumlah,
        akunId: t.akunId,
        akunTujuanId: t.tipe === 'transfer' ? t.akunTujuanId : null,
        kategoriId: t.tipe === 'transfer' ? null : t.kategoriId,
        catatan: catatan
      }, t.dibuat, waktuSah(t.diubah) ? t.diubah : t.dibuat)); // data lama: terakhir diubah = saat dicatat
    }

    return {
      ok: true,
      data: {
        aplikasi: ID_APLIKASI,
        versi: VERSI_DATA,
        akun: akun,
        kategori: kategori,
        transaksi: transaksi,
        // Mode longgar: tanda hapus tetap dibawa walau rekamannya ada; gabungData yang
        // memutuskan mana yang berlaku menurut waktunya.
        terhapus: bersihkanTerhapus(mentah.terhapus, longgar
          ? { akun: new Set(), kategori: new Set(), transaksi: new Set() }
          : { akun: petaAkun, kategori: petaKategori, transaksi: idTransaksi }),
        pengaturan: bersihkanPengaturan(mentah.pengaturan, petaAkun, petaKategori)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Sinkron antar perangkat: menggabungkan dua salinan data
  // ---------------------------------------------------------------------------
  //
  // Aturan gabung, dihitung per id:
  //   1. Rekaman dengan `diubah` terbesar yang dipakai (perubahan terakhir menang).
  //   2. Tanda hapus mengalahkan rekaman yang tidak lebih baru darinya; rekaman
  //      yang diubah SETELAH dihapus di perangkat lain hidup lagi.
  //   3. Akun/kategori yang masih dipakai transaksi tidak pernah ikut terhapus,
  //      dan selalu tersisa minimal 1 akun serta 1 kategori per jenis.
  // Hasilnya tidak bergantung pada perangkat mana yang menghitung, dan menggabung
  // ulang hasil itu dengan salah satu asalnya tidak mengubah apa pun. Itulah yang
  // membuat semua perangkat akhirnya memegang data yang sama.

  function sidikRekaman(koleksi, r) {
    return JSON.stringify(ISIAN[koleksi].map(function (k) { return r[k]; }));
  }

  /** Pilih versi terbaru; kalau waktunya sama, pilihan tetap sama di semua perangkat. */
  function pilihRekaman(koleksi, a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.diubah !== b.diubah) return a.diubah > b.diubah ? a : b;
    return sidikRekaman(koleksi, a) >= sidikRekaman(koleksi, b) ? a : b;
  }

  function urutId(a, b) {
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  function petaTanda(data, koleksi) {
    return (data.terhapus && data.terhapus[koleksi]) || {};
  }

  function maksWaktu(a, b) {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.max(a, b);
  }

  /**
   * Gabungkan data perangkat ini (`lokal`) dengan data dari awan (`jauh`).
   * Hasil: { ok: true, data } dalam urutan baku (akun & kategori menurut id,
   * transaksi menurut waktu dicatat), atau { ok: false, pesan } kalau hasilnya
   * ternyata bukan data yang sah; dalam hal itu jangan simpan apa pun.
   * "Terakhir dipakai" di form tetap milik perangkat ini.
   */
  function gabungData(lokal, jauh) {
    const rekaman = {}; // koleksi -> Map id -> versi terbaru dari kedua sisi
    const tanda = {};   // koleksi -> Map id -> waktu tanda hapus terbaru
    const hidup = {};   // koleksi -> Map id -> rekaman yang dipertahankan
    KOLEKSI.forEach(function (k) {
      const r = new Map();
      lokal[k].forEach(function (x) { r.set(x.id, x); });
      jauh[k].forEach(function (x) { r.set(x.id, pilihRekaman(k, r.get(x.id), x)); });
      const t = new Map();
      [lokal, jauh].forEach(function (d) {
        const peta = petaTanda(d, k);
        Object.keys(peta).forEach(function (id) {
          if (!t.has(id) || peta[id] > t.get(id)) t.set(id, peta[id]);
        });
      });
      const h = new Map();
      r.forEach(function (x, id) {
        if (!t.has(id) || x.diubah > t.get(id)) h.set(id, x);
      });
      rekaman[k] = r;
      tanda[k] = t;
      hidup[k] = h;
    });

    // Hidupkan lagi rekaman yang kalah oleh tanda hapus. Waktu ubahnya dimajukan
    // melewati tanda itu, supaya perangkat yang masih memegang tandanya ikut menghidupkan.
    function hidupkan(k, id, pengganti) {
      if (hidup[k].has(id)) return;
      const w = tanda[k].has(id) ? tanda[k].get(id) : -1;
      let x = rekaman[k].get(id) || pengganti;
      if (x.diubah <= w) x = ganti(x, { diubah: w + 1 });
      hidup[k].set(id, x);
    }

    // Aturan 3a: yang dipakai transaksi harus ada. `pengganti` hanya terpakai kalau
    // rekamannya sudah tidak ada di kedua sisi, supaya transaksi tidak ikut hilang.
    hidup.transaksi.forEach(function (t) {
      hidupkan('akun', t.akunId, rekamAkun(t.akunId, 'Akun terhapus', 'lainnya', 0, 0));
      if (t.tipe === 'transfer') {
        hidupkan('akun', t.akunTujuanId, rekamAkun(t.akunTujuanId, 'Akun terhapus', 'lainnya', 0, 0));
      } else {
        hidupkan('kategori', t.kategoriId, rekamKategori(t.kategoriId, 'Kategori terhapus', t.tipe, 0));
      }
    });

    // Aturan 3b: kalau tiap perangkat menghapus yang berbeda sampai habis, yang
    // paling akhir dihapus dihidupkan lagi.
    function hidupkanYangTerakhirDihapus(k, cocok) {
      let pilihan = null;
      rekaman[k].forEach(function (x, id) {
        if (cocok && !cocok(x)) return;
        const w = tanda[k].has(id) ? tanda[k].get(id) : -1;
        if (!pilihan || w > pilihan.w || (w === pilihan.w && id > pilihan.id)) pilihan = { id: id, w: w };
      });
      if (pilihan) hidupkan(k, pilihan.id);
    }
    if (hidup.akun.size === 0) hidupkanYangTerakhirDihapus('akun', null);
    TIPE_KATEGORI.forEach(function (tipe) {
      let ada = false;
      hidup.kategori.forEach(function (x) { if (x.tipe === tipe) ada = true; });
      if (!ada) hidupkanYangTerakhirDihapus('kategori', function (x) { return x.tipe === tipe; });
    });

    const terhapus = terhapusKosong();
    KOLEKSI.forEach(function (k) {
      Array.from(tanda[k].keys()).sort().forEach(function (id) {
        if (!hidup[k].has(id)) terhapus[k][id] = tanda[k].get(id);
      });
    });

    // Diperiksa penuh sebelum dikembalikan: gabungan yang tidak sah tidak boleh tersimpan.
    const periksa = periksaData({
      aplikasi: ID_APLIKASI,
      versi: VERSI_DATA,
      akun: Array.from(hidup.akun.values()).sort(urutId),
      kategori: Array.from(hidup.kategori.values()).sort(urutId),
      transaksi: Array.from(hidup.transaksi.values()).sort(function (a, b) {
        return (a.dibuat - b.dibuat) || urutId(a, b);
      }),
      terhapus: terhapus,
      pengaturan: {
        terakhir: lokal.pengaturan.terakhir,
        backupTerakhir: maksWaktu(lokal.pengaturan.backupTerakhir, jauh.pengaturan.backupTerakhir),
        saldoAwalDiatur: !!(lokal.pengaturan.saldoAwalDiatur || jauh.pengaturan.saldoAwalDiatur)
      }
    });
    if (!periksa.ok) return gagal('Data dari dua perangkat tidak bisa digabung. ' + periksa.pesan);
    return periksa;
  }

  /**
   * Sidik bagian data yang disinkronkan (semuanya kecuali "terakhir dipakai").
   * Dua data bersidik sama berarti isinya sama, apa pun urutan penyimpanannya.
   */
  function sidikData(data) {
    const bagian = [];
    KOLEKSI.forEach(function (k) {
      bagian.push(data[k].slice().sort(urutId).map(function (r) {
        return ISIAN[k].map(function (f) { return r[f]; });
      }));
    });
    KOLEKSI.forEach(function (k) {
      const peta = petaTanda(data, k);
      bagian.push(Object.keys(peta).sort().map(function (id) { return [id, peta[id]]; }));
    });
    bagian.push(data.pengaturan.backupTerakhir, data.pengaturan.saldoAwalDiatur);
    return JSON.stringify(bagian);
  }

  /**
   * Data ini masih persis data awal: belum ada transaksi, akun dan kategori
   * masih bawaan, saldo awal 0, belum ada yang dihapus. Perangkat seperti ini
   * boleh langsung memakai data dari awan tanpa bertanya.
   */
  function dataMasihBawaan(data) {
    if (data.transaksi.length || data.pengaturan.saldoAwalDiatur) return false;
    if (KOLEKSI.some(function (k) { return Object.keys(petaTanda(data, k)).length > 0; })) return false;
    if (data.akun.length !== AKUN_AWAL.length) return false;
    for (let i = 0; i < AKUN_AWAL.length; i++) {
      const a = data.akun[i];
      if (a.nama !== AKUN_AWAL[i].nama || a.jenis !== AKUN_AWAL[i].jenis || a.saldoAwal !== 0) return false;
    }
    const bawaan = [];
    TIPE_KATEGORI.forEach(function (tipe) {
      KATEGORI_AWAL[tipe].forEach(function (nama) { bawaan.push(tipe + ':' + nama); });
    });
    if (data.kategori.length !== bawaan.length) return false;
    return data.kategori.every(function (k, i) { return k.tipe + ':' + k.nama === bawaan[i]; });
  }

  /**
   * Gabung untuk perangkat yang BARU PERTAMA KALI terhubung ke data di awan.
   * Kedua data dibuat terpisah, jadi id akun dan kategorinya berbeda walau
   * namanya sama. Karena itu akun (dan kategori sejenis) yang bernama sama
   * dianggap satu: id lokal diganti id awan dan transaksi lokal ikut diarahkan.
   * Sisanya ditambahkan; tidak ada transaksi yang dibuang.
   *
   * Saldo awal akun yang disatukan memakai yang di awan, kecuali di awan masih 0
   * dan di perangkat ini sudah diisi.
   * Hasil: { ok: true, data, ringkas: { akunDisatukan, kategoriDisatukan, transaksiDitambahkan } }.
   */
  function gabungPertama(lokal, jauh, sekarang) {
    function kunci(k, x) {
      return (k === 'kategori' ? x.tipe + ':' : '') + x.nama.trim().toLowerCase();
    }

    const pasangan = { akun: new Map(), kategori: new Map() }; // id lokal -> rekaman awan
    ['akun', 'kategori'].forEach(function (k) {
      const idLokal = new Set(lokal[k].map(function (x) { return x.id; }));
      const dikenalAwan = new Set(jauh[k].map(function (x) { return x.id; }).concat(Object.keys(petaTanda(jauh, k))));
      // Calon pasangan: rekaman awan yang id-nya belum ada di perangkat ini.
      const menurutNama = new Map();
      jauh[k].slice().sort(urutId).forEach(function (x) {
        if (!idLokal.has(x.id) && !menurutNama.has(kunci(k, x))) menurutNama.set(kunci(k, x), x);
      });
      lokal[k].forEach(function (x) {
        if (dikenalAwan.has(x.id)) return; // id yang sama digabung menurut id, bukan nama
        const kn = kunci(k, x);
        if (menurutNama.has(kn)) {
          pasangan[k].set(x.id, menurutNama.get(kn));
          menurutNama.delete(kn);
        }
      });
    });

    function idAkun(id) {
      return id != null && pasangan.akun.has(id) ? pasangan.akun.get(id).id : id;
    }
    function idKategori(id) {
      return id != null && pasangan.kategori.has(id) ? pasangan.kategori.get(id).id : id;
    }

    const w = kini(sekarang);
    const akun = [];
    lokal.akun.forEach(function (a) {
      const p = pasangan.akun.get(a.id);
      if (!p) {
        akun.push(a);
      } else if (p.saldoAwal === 0 && a.saldoAwal !== 0) {
        akun.push(rekamAkun(p.id, p.nama, p.jenis, a.saldoAwal, waktuSesudah(w, p.diubah)));
      }
    });
    const tr = lokal.pengaturan.terakhir;
    const diselaraskan = {
      akun: akun,
      kategori: lokal.kategori.filter(function (x) { return !pasangan.kategori.has(x.id); }),
      transaksi: lokal.transaksi.map(function (t) {
        return rekamTransaksi(t.id, {
          tanggal: t.tanggal,
          tipe: t.tipe,
          jumlah: t.jumlah,
          akunId: idAkun(t.akunId),
          akunTujuanId: idAkun(t.akunTujuanId),
          kategoriId: idKategori(t.kategoriId),
          catatan: t.catatan
        }, t.dibuat, t.diubah);
      }),
      terhapus: lokal.terhapus,
      pengaturan: {
        terakhir: {
          keluar: { akunId: idAkun(tr.keluar.akunId), kategoriId: idKategori(tr.keluar.kategoriId) },
          masuk: { akunId: idAkun(tr.masuk.akunId), kategoriId: idKategori(tr.masuk.kategoriId) },
          transfer: { akunId: idAkun(tr.transfer.akunId), akunTujuanId: idAkun(tr.transfer.akunTujuanId) }
        },
        backupTerakhir: lokal.pengaturan.backupTerakhir,
        saldoAwalDiatur: lokal.pengaturan.saldoAwalDiatur
      }
    };

    const hasil = gabungData(diselaraskan, jauh);
    if (!hasil.ok) return hasil;
    const idTransaksiAwan = new Set(jauh.transaksi.map(function (t) { return t.id; }));
    return {
      ok: true,
      data: hasil.data,
      ringkas: {
        akunDisatukan: pasangan.akun.size,
        kategoriDisatukan: pasangan.kategori.size,
        transaksiDitambahkan: lokal.transaksi.filter(function (t) { return !idTransaksiAwan.has(t.id); }).length
      }
    };
  }

  /** Waktu terbesar yang tercatat di data: waktu ubah maupun tanda hapus. */
  function waktuTertinggi(data) {
    let w = 0;
    KOLEKSI.forEach(function (k) {
      data[k].forEach(function (x) { if (x.diubah > w) w = x.diubah; });
      const peta = petaTanda(data, k);
      Object.keys(peta).forEach(function (id) { if (peta[id] > w) w = peta[id]; });
    });
    return w;
  }

  /**
   * Memulihkan backup di perangkat yang tersinkron. Isi backup dicatat sebagai
   * perubahan BARU: rekaman yang berbeda dari yang sekarang diberi waktu ubah
   * baru, dan rekaman yang tidak ada di backup diberi tanda hapus. Dengan begitu
   * perangkat lain ikut menjadi sama dengan isi backup, bukan sebaliknya.
   * (Tanpa sinkron, cukup pakai hasil bacaBackup apa adanya.)
   */
  function siapkanPulihan(sekarangIni, pulihan, sekarang) {
    const w = Math.max(kini(sekarang), waktuTertinggi(sekarangIni) + 1, waktuTertinggi(pulihan) + 1);
    const hasil = { aplikasi: ID_APLIKASI, versi: VERSI_DATA };
    const terhapus = terhapusKosong();
    KOLEKSI.forEach(function (k) {
      const lama = new Map(sekarangIni[k].map(function (x) { return [x.id, x]; }));
      const dipulihkan = new Set();
      hasil[k] = pulihan[k].map(function (x) {
        dipulihkan.add(x.id);
        const l = lama.get(x.id);
        return l && samaIsi(k, l, x) ? l : ganti(x, { diubah: w });
      });
      [sekarangIni, pulihan].forEach(function (d) {
        const peta = petaTanda(d, k);
        Object.keys(peta).forEach(function (id) {
          if (dipulihkan.has(id)) return;
          if (!Object.prototype.hasOwnProperty.call(terhapus[k], id) || peta[id] > terhapus[k][id]) {
            terhapus[k][id] = peta[id];
          }
        });
      });
      lama.forEach(function (x, id) {
        if (!dipulihkan.has(id)) terhapus[k][id] = w;
      });
    });
    hasil.terhapus = terhapus;
    hasil.pengaturan = pulihan.pengaturan;
    const periksa = periksaData(hasil);
    return periksa.ok ? periksa : gagal('Backup tidak bisa dipakai. ' + periksa.pesan);
  }

  /**
   * "Hapus semua data" di perangkat yang tersinkron: mulai lagi dari data awal
   * dan beri tanda hapus pada semua yang ada sekarang, supaya ikut terhapus di
   * awan dan di perangkat lain. (Tanpa sinkron, cukup buatDataAwal.)
   */
  function kosongkanSemua(data, sekarang) {
    const w = Math.max(kini(sekarang), waktuTertinggi(data) + 1);
    const baru = buatDataAwal();
    const terhapus = terhapusKosong();
    KOLEKSI.forEach(function (k) {
      const peta = petaTanda(data, k);
      Object.keys(peta).forEach(function (id) { terhapus[k][id] = peta[id]; });
      data[k].forEach(function (x) { terhapus[k][x.id] = w; });
      baru[k] = baru[k].map(function (x) { return ganti(x, { diubah: w }); });
    });
    baru.terhapus = terhapus;
    return { ok: true, data: baru };
  }

  // ---------------------------------------------------------------------------
  // Backup & pulihkan
  // ---------------------------------------------------------------------------

  /**
   * Catat waktu backup lalu ubah data jadi teks JSON.
   * Hasil: { teks, data } — `data` (dengan backupTerakhir baru) perlu disimpan pemanggil.
   */
  function buatBackup(data, waktu) {
    const dataBaru = ganti(data, {
      pengaturan: ganti(data.pengaturan, { backupTerakhir: waktu == null ? Date.now() : waktu })
    });
    return { data: dataBaru, teks: JSON.stringify(dataBaru, null, 2) };
  }

  /** Baca & periksa isi file backup. Tidak mengubah apa pun. */
  function bacaBackup(teks) {
    if (typeof teks !== 'string' || !teks.trim()) return gagal('File backup kosong.');
    let mentah;
    try {
      mentah = JSON.parse(teks.charCodeAt(0) === 0xFEFF ? teks.slice(1) : teks);
    } catch (e) {
      return gagal('File ini bukan backup yang valid (isinya bukan JSON).');
    }
    const hasil = periksaData(mentah);
    if (!hasil.ok) return gagal('Backup tidak bisa dipakai. ' + hasil.pesan);
    return hasil;
  }

  /** Ringkasan untuk konfirmasi sebelum memulihkan. */
  function ringkasData(data) {
    let dari = null;
    let sampai = null;
    data.transaksi.forEach(function (t) {
      if (dari === null || t.tanggal < dari) dari = t.tanggal;
      if (sampai === null || t.tanggal > sampai) sampai = t.tanggal;
    });
    return {
      akun: data.akun.length,
      kategori: data.kategori.length,
      transaksi: data.transaksi.length,
      dari: dari,
      sampai: sampai,
      backupTerakhir: data.pengaturan.backupTerakhir
    };
  }

  // ---------------------------------------------------------------------------
  // Penyimpanan (localStorage atau tiruannya untuk tes)
  // ---------------------------------------------------------------------------

  function adalahGalatKuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014);
  }

  function simpanData(storage, data) {
    try {
      storage.setItem(KUNCI_PENYIMPANAN, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return gagal(adalahGalatKuota(e)
        ? 'Penyimpanan browser penuh, jadi perubahan tidak tersimpan.'
        : 'Browser menolak menyimpan data, jadi perubahan tidak tersimpan.');
    }
  }

  function stempelWaktu(waktu) {
    const d = new Date(waktu);
    return tanggalLokal(d) + 'T' + pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
  }

  /** Kunci baru berawalan `awalan` + waktu; diberi nomor kalau di detik itu sudah ada. */
  function kunciBerstempel(storage, awalan, sekarang) {
    const dasar = awalan + stempelWaktu(sekarang);
    let kunci = dasar;
    for (let n = 2; storage.getItem(kunci) !== null; n++) kunci = dasar + '-' + n;
    return kunci;
  }

  function kunciSalinanBaru(storage, sekarang) {
    return kunciBerstempel(storage, AWALAN_SALINAN_RUSAK, sekarang);
  }

  /** Kunci di penyimpanan yang berawalan `awalan`, urut waktu. */
  function daftarKunci(storage, awalan) {
    const hasil = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.indexOf(awalan) === 0) hasil.push(k);
      }
    } catch (e) {
      // penyimpanan tidak bisa dibaca: anggap tidak ada
    }
    return hasil.sort();
  }

  /**
   * Muat data dari penyimpanan.
   * Hasil: {
   *   status: 'baru' | 'ok' | 'rusak' | 'tanpa-penyimpanan',
   *   data,
   *   tersimpan,     // false = data yang dipakai belum ada di penyimpanan
   *   kunciSalinan,  // status 'rusak': kunci tempat data lama disalin (null jika gagal disalin)
   *   alasan,        // status 'rusak': kenapa data lama dianggap rusak
   *   mentah,        // status 'rusak' & salinan gagal: isi lama, untuk diunduh pengguna
   *   pesan          // masalah penyimpanan, kalau ada
   * }
   * Data rusak TIDAK pernah ditimpa sebelum salinannya tersimpan di kunci lain.
   * Kalau salinan gagal, data lama dibiarkan dan `tersimpan` false: aplikasi
   * jangan menyimpan apa pun sebelum pengguna mengunduh isi lama itu.
   */
  function muatData(storage, sekarang) {
    sekarang = sekarang == null ? Date.now() : sekarang;
    const hasilDasar = { status: 'ok', data: null, tersimpan: true, kunciSalinan: null, alasan: null, mentah: null, pesan: null };

    let mentah;
    try {
      mentah = storage.getItem(KUNCI_PENYIMPANAN);
    } catch (e) {
      return ganti(hasilDasar, {
        status: 'tanpa-penyimpanan',
        data: buatDataAwal(),
        tersimpan: false,
        pesan: 'Browser ini tidak mengizinkan aplikasi menyimpan data. Catatan akan hilang saat halaman ditutup.'
      });
    }

    if (mentah === null) {
      const data = buatDataAwal();
      const simpan = simpanData(storage, data);
      return ganti(hasilDasar, { status: 'baru', data: data, tersimpan: simpan.ok, pesan: simpan.ok ? null : simpan.pesan });
    }

    let periksa;
    try {
      periksa = periksaData(JSON.parse(mentah));
    } catch (e) {
      periksa = gagal('Isinya bukan JSON yang valid.');
    }
    if (periksa.ok) return ganti(hasilDasar, { data: periksa.data });

    // Data rusak: salin apa adanya ke kunci lain dulu, baru mulai data baru.
    let kunciSalinan;
    try {
      kunciSalinan = kunciSalinanBaru(storage, sekarang);
      storage.setItem(kunciSalinan, mentah);
    } catch (e) {
      return ganti(hasilDasar, {
        status: 'rusak',
        data: buatDataAwal(),
        tersimpan: false,
        alasan: periksa.pesan,
        mentah: mentah,
        pesan: 'Data lama tidak bisa disalin, jadi belum ditimpa.'
      });
    }
    const data = buatDataAwal();
    const simpan = simpanData(storage, data);
    return ganti(hasilDasar, {
      status: 'rusak',
      data: data,
      tersimpan: simpan.ok,
      kunciSalinan: kunciSalinan,
      alasan: periksa.pesan,
      pesan: simpan.ok ? null : simpan.pesan
    });
  }

  /** Kunci salinan data rusak yang masih ada, urut waktu. */
  function daftarSalinanRusak(storage) {
    return daftarKunci(storage, AWALAN_SALINAN_RUSAK);
  }

  /** Hapus satu salinan data rusak. Kunci lain (termasuk data utama) ditolak. */
  function hapusSalinanRusak(storage, kunci) {
    if (typeof kunci !== 'string' || kunci.indexOf(AWALAN_SALINAN_RUSAK) !== 0) {
      return gagal('Itu bukan salinan data rusak.');
    }
    try {
      storage.removeItem(kunci);
      return { ok: true };
    } catch (e) {
      return gagal('Salinan tidak bisa dihapus.');
    }
  }

  /**
   * Salinan pengaman data perangkat. Dibuat sebelum data itu diganti atau digabung
   * saat perangkat pertama kali tersambung ke akun Google, supaya selalu bisa
   * diunduh lagi. Disimpan apa adanya di kunci tersendiri.
   */
  function simpanCadangan(storage, data, sekarang) {
    try {
      const kunci = kunciBerstempel(storage, AWALAN_CADANGAN, kini(sekarang));
      storage.setItem(kunci, JSON.stringify(data));
      return { ok: true, kunci: kunci };
    } catch (e) {
      return gagal(adalahGalatKuota(e)
        ? 'Penyimpanan browser penuh, jadi salinan pengaman tidak bisa dibuat.'
        : 'Browser menolak menyimpan salinan pengaman.');
    }
  }

  /** Kunci salinan pengaman yang masih ada, urut waktu. */
  function daftarCadangan(storage) {
    return daftarKunci(storage, AWALAN_CADANGAN);
  }

  /** Hapus satu salinan pengaman. Kunci lain (termasuk data utama) ditolak. */
  function hapusCadangan(storage, kunci) {
    if (typeof kunci !== 'string' || kunci.indexOf(AWALAN_CADANGAN) !== 0) {
      return gagal('Itu bukan salinan pengaman.');
    }
    try {
      storage.removeItem(kunci);
      return { ok: true };
    } catch (e) {
      return gagal('Salinan tidak bisa dihapus.');
    }
  }

  /**
   * Hapus semua data (termasuk salinan rusak dan salinan pengaman) lalu mulai lagi
   * dari data awal, atau dari `pengganti` kalau diberikan: di perangkat yang
   * tersinkron itu hasil kosongkanSemua, supaya penghapusannya ikut sampai ke
   * awan dan perangkat lain.
   */
  function hapusSemuaData(storage, pengganti) {
    const data = pengganti || buatDataAwal();
    const simpan = simpanData(storage, data);
    if (!simpan.ok) return simpan;
    daftarSalinanRusak(storage).concat(daftarCadangan(storage)).forEach(function (k) {
      try { storage.removeItem(k); } catch (e) { /* biarkan */ }
    });
    return { ok: true, data: data };
  }

  // ---------------------------------------------------------------------------

  return {
    // konstanta
    KUNCI_PENYIMPANAN: KUNCI_PENYIMPANAN,
    AWALAN_SALINAN_RUSAK: AWALAN_SALINAN_RUSAK,
    JUMLAH_MAKS: JUMLAH_MAKS,
    PANJANG_NAMA_MAKS: PANJANG_NAMA_MAKS,
    PANJANG_CATATAN_MAKS: PANJANG_CATATAN_MAKS,
    JENIS_AKUN: JENIS_AKUN,
    LABEL_JENIS_AKUN: LABEL_JENIS_AKUN,
    LABEL_TIPE: LABEL_TIPE,
    NAMA_BULAN: NAMA_BULAN,
    NAMA_BULAN_PENDEK: NAMA_BULAN_PENDEK,

    // tanggal
    tanggalLokal: tanggalLokal,
    bulanLokal: bulanLokal,
    tanggalValid: tanggalValid,
    bulanValid: bulanValid,
    jumlahHariDalamBulan: jumlahHariDalamBulan,
    geserBulan: geserBulan,
    geserTanggal: geserTanggal,
    tanggalKeDate: tanggalKeDate,
    labelBulan: labelBulan,
    labelTanggal: labelTanggal,
    labelTanggalPendek: labelTanggalPendek,
    formatTanggalPanjang: formatTanggalPanjang,

    // uang
    jumlahValid: jumlahValid,
    saldoAwalValid: saldoAwalValid,
    formatAngka: formatAngka,
    formatRupiah: formatRupiah,
    parseJumlah: parseJumlah,
    formatPersen: formatPersen,
    persenBulat: persenBulat,
    formatPersenBulat: formatPersenBulat,

    // data
    buatDataAwal: buatDataAwal,
    cariAkun: cariAkun,
    cariKategori: cariKategori,
    cariTransaksi: cariTransaksi,
    kategoriPerTipe: kategoriPerTipe,
    validasiTransaksi: validasiTransaksi,
    tambahTransaksi: tambahTransaksi,
    ubahTransaksi: ubahTransaksi,
    hapusTransaksi: hapusTransaksi,
    kembalikanTransaksi: kembalikanTransaksi,
    tambahAkun: tambahAkun,
    ubahAkun: ubahAkun,
    hapusAkun: hapusAkun,
    hitungPemakaianAkun: hitungPemakaianAkun,
    aturSaldoAwal: aturSaldoAwal,
    tutupAjakanSaldoAwal: tutupAjakanSaldoAwal,
    perluAjakanSaldoAwal: perluAjakanSaldoAwal,
    tambahKategori: tambahKategori,
    ubahKategori: ubahKategori,
    hapusKategori: hapusKategori,
    hitungPemakaianKategori: hitungPemakaianKategori,
    pilihanAwalForm: pilihanAwalForm,

    // perhitungan
    hitungSaldo: hitungSaldo,
    daftarSaldoAkun: daftarSaldoAkun,
    ringkasanBulan: ringkasanBulan,
    transaksiBulan: transaksiBulan,
    kelompokkanPerTanggal: kelompokkanPerTanggal,
    transaksiTerakhir: transaksiTerakhir,
    perluPengingatBackup: perluPengingatBackup,
    hariSejakBackup: hariSejakBackup,

    // sinkron antar perangkat
    KOLEKSI: KOLEKSI,
    ISIAN: ISIAN,
    tandaHapus: tandaHapus,
    gabungData: gabungData,
    gabungPertama: gabungPertama,
    dataMasihBawaan: dataMasihBawaan,
    siapkanPulihan: siapkanPulihan,
    kosongkanSemua: kosongkanSemua,
    sidikData: sidikData,

    // ekspor, backup, penyimpanan
    buatCSV: buatCSV,
    periksaData: periksaData,
    periksaDataAwan: periksaDataAwan,
    buatBackup: buatBackup,
    bacaBackup: bacaBackup,
    ringkasData: ringkasData,
    simpanData: simpanData,
    muatData: muatData,
    daftarSalinanRusak: daftarSalinanRusak,
    hapusSalinanRusak: hapusSalinanRusak,
    AWALAN_CADANGAN: AWALAN_CADANGAN,
    simpanCadangan: simpanCadangan,
    daftarCadangan: daftarCadangan,
    hapusCadangan: hapusCadangan,
    hapusSemuaData: hapusSemuaData
  };
});
