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

  let urutanId = 0;
  function buatId(awalan, sudahDipakai) {
    let id;
    do {
      urutanId = (urutanId + 1) % 1296;
      id = awalan + '_' + Date.now().toString(36) + urutanId.toString(36).padStart(2, '0') +
        Math.random().toString(36).slice(2, 8);
    } while (sudahDipakai && sudahDipakai(id));
    return id;
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
    const akun = [];
    AKUN_AWAL.forEach(function (a) {
      akun.push({
        id: buatId('akun', function (id) { return akun.some(function (x) { return x.id === id; }); }),
        nama: a.nama,
        jenis: a.jenis,
        saldoAwal: 0
      });
    });
    const kategori = [];
    TIPE_KATEGORI.forEach(function (tipe) {
      KATEGORI_AWAL[tipe].forEach(function (nama) {
        kategori.push({
          id: buatId('kat', function (id) { return kategori.some(function (x) { return x.id === id; }); }),
          nama: nama,
          tipe: tipe
        });
      });
    });
    return {
      aplikasi: ID_APLIKASI,
      versi: VERSI_DATA,
      akun: akun,
      kategori: kategori,
      transaksi: [],
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

  /** sekarang: waktu 'dibuat' (ms); bawaan Date.now(). */
  function tambahTransaksi(data, input, sekarang) {
    const t = normalisasiTransaksi(input || {});
    const galat = cekTransaksi(data, t);
    if (galat) return galat;
    const baru = Object.assign(
      { id: buatId('trx', function (id) { return data.transaksi.some(function (x) { return x.id === id; }); }) },
      t,
      { dibuat: sekarang == null ? Date.now() : sekarang }
    );
    return {
      ok: true,
      transaksi: baru,
      data: ganti(data, {
        transaksi: data.transaksi.concat([baru]),
        pengaturan: catatPemakaian(data.pengaturan, baru)
      })
    };
  }

  /** Id dan waktu dibuat tetap; isian lain diganti. */
  function ubahTransaksi(data, id, input) {
    const lama = cariTransaksi(data, id);
    if (!lama) return gagal('Transaksi tidak ditemukan.');
    const t = normalisasiTransaksi(input || {});
    const galat = cekTransaksi(data, t);
    if (galat) return galat;
    const baru = Object.assign({ id: lama.id }, t, { dibuat: lama.dibuat });
    return {
      ok: true,
      transaksi: baru,
      data: ganti(data, {
        transaksi: data.transaksi.map(function (x) { return x.id === id ? baru : x; })
      })
    };
  }

  /** Mengembalikan juga transaksi & posisinya, untuk tombol "Batalkan". */
  function hapusTransaksi(data, id) {
    const indeks = data.transaksi.findIndex(function (x) { return x.id === id; });
    if (indeks < 0) return gagal('Transaksi tidak ditemukan.');
    return {
      ok: true,
      transaksi: data.transaksi[indeks],
      indeks: indeks,
      data: ganti(data, {
        transaksi: data.transaksi.filter(function (x) { return x.id !== id; })
      })
    };
  }

  /** Batalkan penghapusan: transaksi kembali dengan id, waktu dibuat, dan posisi yang sama. */
  function kembalikanTransaksi(data, transaksi, indeks) {
    if (!adalahObjek(transaksi) || cariTransaksi(data, transaksi.id)) {
      return gagal('Transaksi tidak bisa dikembalikan.');
    }
    const t = normalisasiTransaksi(transaksi);
    const galat = cekTransaksi(data, t);
    if (galat) return gagal('Transaksi tidak bisa dikembalikan. ' + galat.pesan);
    const kembali = Object.assign({ id: transaksi.id }, t, { dibuat: transaksi.dibuat });
    const daftar = data.transaksi.slice();
    const posisi = (Number.isInteger(indeks) && indeks >= 0 && indeks <= daftar.length) ? indeks : daftar.length;
    daftar.splice(posisi, 0, kembali);
    return { ok: true, transaksi: kembali, data: ganti(data, { transaksi: daftar }) };
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

  function tambahAkun(data, input) {
    const a = {
      nama: rapikanNama(input.nama),
      jenis: input.jenis,
      saldoAwal: input.saldoAwal == null ? 0 : input.saldoAwal
    };
    const galat = cekAkun(data, a, null);
    if (galat) return galat;
    const baru = {
      id: buatId('akun', function (id) { return !!cariAkun(data, id); }),
      nama: a.nama,
      jenis: a.jenis,
      saldoAwal: a.saldoAwal || 0 // -0 -> 0
    };
    return { ok: true, akun: baru, data: ganti(data, { akun: data.akun.concat([baru]) }) };
  }

  /** input boleh sebagian: { nama?, jenis?, saldoAwal? } */
  function ubahAkun(data, id, input) {
    const lama = cariAkun(data, id);
    if (!lama) return gagal('Akun tidak ditemukan.');
    const a = {
      nama: input.nama === undefined ? lama.nama : rapikanNama(input.nama),
      jenis: input.jenis === undefined ? lama.jenis : input.jenis,
      saldoAwal: input.saldoAwal === undefined ? lama.saldoAwal : input.saldoAwal
    };
    const galat = cekAkun(data, a, id);
    if (galat) return galat;
    const baru = { id: id, nama: a.nama, jenis: a.jenis, saldoAwal: a.saldoAwal || 0 };
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

  function hapusAkun(data, id) {
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
        pengaturan: lupakanId(data.pengaturan, id)
      })
    };
  }

  /**
   * Atur saldo awal beberapa akun sekaligus: { [akunId]: angka }.
   * Sekaligus menandai bahwa ajakan "Atur saldo awal" sudah dijawab.
   */
  function aturSaldoAwal(data, saldoPerAkun) {
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
          return Object.prototype.hasOwnProperty.call(saldoPerAkun, a.id)
            ? ganti(a, { saldoAwal: saldoPerAkun[a.id] || 0 })
            : a;
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

  function tambahKategori(data, input) {
    const k = { nama: rapikanNama(input.nama), tipe: input.tipe };
    const galat = cekKategori(data, k, null);
    if (galat) return galat;
    const baru = {
      id: buatId('kat', function (id) { return !!cariKategori(data, id); }),
      nama: k.nama,
      tipe: k.tipe
    };
    return { ok: true, kategori: baru, data: ganti(data, { kategori: data.kategori.concat([baru]) }) };
  }

  /** Hanya ganti nama; tipe kategori tidak bisa diubah. */
  function ubahKategori(data, id, input) {
    const lama = cariKategori(data, id);
    if (!lama) return gagal('Kategori tidak ditemukan.');
    const k = { nama: rapikanNama(input.nama), tipe: lama.tipe };
    const galat = cekKategori(data, k, id);
    if (galat) return galat;
    const baru = { id: id, nama: k.nama, tipe: k.tipe };
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

  function hapusKategori(data, id) {
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
   * Periksa data mentah (hasil JSON.parse) secara menyeluruh.
   * Hasil: { ok: true, data: salinanBersih } atau { ok: false, pesan }.
   * Hanya isian yang dikenal yang disalin.
   */
  function periksaData(mentah) {
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
    if (mentah.akun.length < 1) return gagal('Tidak ada akun sama sekali.');

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
      const bersih = { id: a.id, nama: a.nama, jenis: a.jenis, saldoAwal: a.saldoAwal };
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
      const bersih = { id: k.id, nama: k.nama, tipe: k.tipe };
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
      if (!petaAkun.has(t.akunId)) return gagal(ke + ' memakai akun yang tidak ada.');
      if (t.tipe === 'transfer') {
        if (!petaAkun.has(t.akunTujuanId) || t.akunTujuanId === t.akunId) {
          return gagal(ke + ' punya akun tujuan yang tidak valid.');
        }
        if (t.kategoriId != null) return gagal(ke + ' adalah transfer tetapi punya kategori.');
      } else {
        if (t.akunTujuanId != null) return gagal(ke + ' punya akun tujuan padahal bukan transfer.');
        const kat = petaKategori.get(t.kategoriId);
        if (!kat) return gagal(ke + ' memakai kategori yang tidak ada.');
        if (kat.tipe !== t.tipe) return gagal(ke + ' memakai kategori dengan tipe yang salah.');
      }
      const catatan = t.catatan == null ? '' : t.catatan;
      if (typeof catatan !== 'string') return gagal(ke + ' punya catatan yang tidak valid.');
      if (!Number.isSafeInteger(t.dibuat) || t.dibuat < 0) return gagal(ke + ' punya waktu dicatat yang tidak valid.');
      idTransaksi.add(t.id);
      transaksi.push({
        id: t.id,
        tanggal: t.tanggal,
        tipe: t.tipe,
        jumlah: t.jumlah,
        akunId: t.akunId,
        akunTujuanId: t.tipe === 'transfer' ? t.akunTujuanId : null,
        kategoriId: t.tipe === 'transfer' ? null : t.kategoriId,
        catatan: catatan,
        dibuat: t.dibuat
      });
    }

    return {
      ok: true,
      data: {
        aplikasi: ID_APLIKASI,
        versi: VERSI_DATA,
        akun: akun,
        kategori: kategori,
        transaksi: transaksi,
        pengaturan: bersihkanPengaturan(mentah.pengaturan, petaAkun, petaKategori)
      }
    };
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

  function kunciSalinanBaru(storage, sekarang) {
    const dasar = AWALAN_SALINAN_RUSAK + stempelWaktu(sekarang);
    let kunci = dasar;
    for (let n = 2; storage.getItem(kunci) !== null; n++) kunci = dasar + '-' + n;
    return kunci;
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
    const hasil = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.indexOf(AWALAN_SALINAN_RUSAK) === 0) hasil.push(k);
      }
    } catch (e) {
      // penyimpanan tidak bisa dibaca: anggap tidak ada salinan
    }
    return hasil.sort();
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

  /** Hapus semua data (termasuk salinan rusak) lalu mulai lagi dari data awal. */
  function hapusSemuaData(storage) {
    const data = buatDataAwal();
    const simpan = simpanData(storage, data);
    if (!simpan.ok) return simpan;
    daftarSalinanRusak(storage).forEach(function (k) {
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

    // ekspor, backup, penyimpanan
    buatCSV: buatCSV,
    periksaData: periksaData,
    buatBackup: buatBackup,
    bacaBackup: bacaBackup,
    ringkasData: ringkasData,
    simpanData: simpanData,
    muatData: muatData,
    daftarSalinanRusak: daftarSalinanRusak,
    hapusSalinanRusak: hapusSalinanRusak,
    hapusSemuaData: hapusSemuaData
  };
});
