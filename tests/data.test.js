'use strict';
/*
 * Tes untuk js/data.js. Jalankan dari folder proyek:
 *   node --test
 * Butuh Node 18 atau lebih baru, tanpa dependency.
 */

// Semua tes memakai zona WIB supaya kasus "lewat tengah malam" bermakna.
// Harus diatur sebelum objek Date pertama dibuat.
process.env.TZ = 'Asia/Jakarta';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const D = require(path.join(__dirname, '..', 'js', 'data.js'));

const MINUS = String.fromCharCode(0x2212);
const BOM = String.fromCharCode(0xFEFF);
const HARI_INI = '2026-11-20'; // "hari ini" yang tetap untuk tes laporan
const SEHARI = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------------

function pasti(hasil) {
  assert.equal(hasil.ok, true, 'seharusnya berhasil, tetapi: ' + hasil.pesan);
  return hasil.data;
}

function akun(data, nama) {
  const a = data.akun.find((x) => x.nama === nama);
  assert.ok(a, 'akun "' + nama + '" tidak ada');
  return a;
}

function kategori(data, nama, tipe) {
  const k = data.kategori.find((x) => x.nama === nama && x.tipe === tipe);
  assert.ok(k, 'kategori "' + nama + '" (' + tipe + ') tidak ada');
  return k;
}

function saldo(data, namaAkun) {
  return D.hitungSaldo(data).perAkun[akun(data, namaAkun).id];
}

/** Tiruan localStorage. `kuota` = batas total karakter (kunci + isi). */
class PenyimpananPalsu {
  constructor(kuota = Infinity) {
    this.isi = new Map();
    this.kuota = kuota;
  }

  get length() {
    return this.isi.size;
  }

  key(i) {
    const k = Array.from(this.isi.keys())[i];
    return k === undefined ? null : k;
  }

  getItem(k) {
    return this.isi.has(k) ? this.isi.get(k) : null;
  }

  setItem(k, v) {
    v = String(v);
    let total = k.length + v.length;
    for (const [kk, vv] of this.isi) {
      if (kk !== k) total += kk.length + vv.length;
    }
    if (total > this.kuota) {
      const e = new Error('Kuota penuh');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.isi.set(k, v);
  }

  removeItem(k) {
    this.isi.delete(k);
  }
}

/**
 * Skenario wajib dari spesifikasi, semuanya di November 2026:
 * saldo awal Tunai 500.000, Rekening bank 2.000.000, E-wallet 0, lalu 5 transaksi.
 */
function siapkanSkenario() {
  let data = D.buatDataAwal();
  const tunai = akun(data, 'Tunai').id;
  const bank = akun(data, 'Rekening bank').id;
  const ewallet = akun(data, 'E-wallet').id;
  data = pasti(D.aturSaldoAwal(data, { [tunai]: 500000, [bank]: 2000000, [ewallet]: 0 }));

  const id = {};
  const mulai = Date.UTC(2026, 10, 1, 1, 0, 0);
  let urutan = 0;
  function catat(nama, input) {
    urutan += 1;
    const hasil = D.tambahTransaksi(data, input, mulai + urutan * 1000);
    data = pasti(hasil);
    id[nama] = hasil.transaksi.id;
  }

  catat('gaji', {
    tanggal: '2026-11-01', tipe: 'masuk', jumlah: 5000000, akunId: bank,
    kategoriId: kategori(data, 'Gaji', 'masuk').id, catatan: 'Gaji November'
  });
  catat('makan', {
    tanggal: '2026-11-02', tipe: 'keluar', jumlah: 25000, akunId: tunai,
    kategoriId: kategori(data, 'Makan & minum', 'keluar').id
  });
  catat('tarikTunai', {
    tanggal: '2026-11-03', tipe: 'transfer', jumlah: 300000, akunId: bank, akunTujuanId: tunai
  });
  catat('isiEwallet', {
    tanggal: '2026-11-03', tipe: 'transfer', jumlah: 100000, akunId: bank, akunTujuanId: ewallet
  });
  catat('belanja', {
    tanggal: '2026-11-04', tipe: 'keluar', jumlah: 75000, akunId: ewallet,
    kategoriId: kategori(data, 'Belanja harian', 'keluar').id
  });

  return { data, id, tunai, bank, ewallet };
}

// ---------------------------------------------------------------------------
// Cara memuat
// ---------------------------------------------------------------------------

test('data.js juga bisa dimuat sebagai script biasa di browser (tanpa module/require)', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const kode = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
  const jendela = {};
  jendela.window = jendela;
  vm.createContext(jendela);
  vm.runInContext(kode, jendela);
  assert.equal(typeof jendela.KeuanganData, 'object');
  assert.equal(typeof jendela.KeuanganData.hitungSaldo, 'function');
  assert.equal(jendela.KeuanganData.formatRupiah(1250000), 'Rp 1.250.000');
});

// ---------------------------------------------------------------------------
// Skenario wajib
// ---------------------------------------------------------------------------

describe('Skenario wajib dari spesifikasi', () => {
  test('saldo per akun dan total setelah 5 transaksi', () => {
    const { data } = siapkanSkenario();
    assert.equal(saldo(data, 'Tunai'), 775000);
    assert.equal(saldo(data, 'Rekening bank'), 6600000);
    assert.equal(saldo(data, 'E-wallet'), 25000);
    assert.equal(D.hitungSaldo(data).total, 7400000);
  });

  test('laporan bulan itu: pemasukan, pengeluaran, selisih (transfer tidak dihitung)', () => {
    const { data } = siapkanSkenario();
    const r = D.ringkasanBulan(data, '2026-11', HARI_INI);
    assert.equal(r.pemasukan, 5000000);
    assert.equal(r.pengeluaran, 100000);
    assert.equal(r.selisih, 4900000);
    assert.equal(r.jumlahTransaksi, 3);
  });

  test('ubah Makan & minum jadi 30.000, lalu hapus Belanja harian', () => {
    const { data: awal, id } = siapkanSkenario();
    const lama = D.cariTransaksi(awal, id.makan);

    const hasilUbah = D.ubahTransaksi(awal, id.makan, { ...lama, jumlah: 30000 });
    let data = pasti(hasilUbah);
    assert.equal(hasilUbah.transaksi.id, lama.id, 'id tetap');
    assert.equal(hasilUbah.transaksi.dibuat, lama.dibuat, 'waktu dicatat tetap');
    assert.equal(saldo(data, 'Tunai'), 770000);
    assert.equal(D.hitungSaldo(data).total, 7395000);

    data = pasti(D.hapusTransaksi(data, id.belanja));
    assert.equal(saldo(data, 'E-wallet'), 100000);
    assert.equal(D.hitungSaldo(data).total, 7470000);
    const r = D.ringkasanBulan(data, '2026-11', HARI_INI);
    assert.equal(r.pengeluaran, 30000);
    assert.equal(r.pemasukan, 5000000);
    assert.equal(r.selisih, 4970000);
  });

  test('transaksi bertanggal hari terakhir bulan sebelumnya tidak masuk laporan bulan itu', () => {
    const { data: awal, tunai } = siapkanSkenario();
    const data = pasti(D.tambahTransaksi(awal, {
      tanggal: '2026-10-31', tipe: 'keluar', jumlah: 50000, akunId: tunai,
      kategoriId: kategori(awal, 'Hiburan', 'keluar').id
    }));
    assert.equal(D.ringkasanBulan(data, '2026-11', HARI_INI).pengeluaran, 100000);
    assert.equal(D.ringkasanBulan(data, '2026-10', HARI_INI).pengeluaran, 50000);
    assert.equal(saldo(data, 'Tunai'), 725000, 'saldo tetap terpengaruh');
  });
});

// ---------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------

describe('Transaksi yang ditolak', () => {
  test('jumlah 0, negatif, desimal, bukan angka, atau di atas batas', () => {
    const { data, tunai } = siapkanSkenario();
    const salinan = structuredClone(data);
    const dasar = {
      tanggal: '2026-11-05', tipe: 'keluar', akunId: tunai,
      kategoriId: kategori(data, 'Transportasi', 'keluar').id
    };
    for (const jumlah of [0, -5000, 1500.5, 0.5, -0.5, NaN, Infinity, '25000', null, undefined, D.JUMLAH_MAKS + 1]) {
      const hasil = D.tambahTransaksi(data, { ...dasar, jumlah });
      assert.equal(hasil.ok, false, 'jumlah ' + String(jumlah) + ' seharusnya ditolak');
      assert.equal(hasil.kolom, 'jumlah');
      assert.equal(typeof hasil.pesan, 'string');
    }
    assert.match(D.tambahTransaksi(data, { ...dasar, jumlah: 0 }).pesan, /lebih dari 0/);
    assert.match(D.tambahTransaksi(data, { ...dasar, jumlah: -5000 }).pesan, /lebih dari 0/);
    assert.match(D.tambahTransaksi(data, { ...dasar, jumlah: 1500.5 }).pesan, /desimal/);
    assert.deepStrictEqual(data, salinan, 'data tidak boleh berubah');

    assert.equal(D.tambahTransaksi(data, { ...dasar, jumlah: 1 }).ok, true);
    assert.equal(D.tambahTransaksi(data, { ...dasar, jumlah: D.JUMLAH_MAKS }).ok, true, 'batas maksimal diterima');
  });

  test('transfer ke akun yang sama', () => {
    const { data, bank } = siapkanSkenario();
    const hasil = D.tambahTransaksi(data, {
      tanggal: '2026-11-05', tipe: 'transfer', jumlah: 10000, akunId: bank, akunTujuanId: bank
    });
    assert.equal(hasil.ok, false);
    assert.equal(hasil.kolom, 'akunTujuanId');
    assert.match(hasil.pesan, /tidak boleh sama/);
  });

  test('kategori pemasukan dipakai untuk pengeluaran, dan sebaliknya', () => {
    const { data, tunai } = siapkanSkenario();
    const dasar = { tanggal: '2026-11-05', jumlah: 10000, akunId: tunai };

    const hasil = D.tambahTransaksi(data, { ...dasar, tipe: 'keluar', kategoriId: kategori(data, 'Gaji', 'masuk').id });
    assert.equal(hasil.ok, false);
    assert.equal(hasil.kolom, 'kategoriId');
    assert.match(hasil.pesan, /Gaji/);

    const sebaliknya = D.tambahTransaksi(data, {
      ...dasar, tipe: 'masuk', kategoriId: kategori(data, 'Makan & minum', 'keluar').id
    });
    assert.equal(sebaliknya.ok, false);
    assert.equal(sebaliknya.kolom, 'kategoriId');
  });

  test('tanggal, akun, atau kategori yang tidak sah', () => {
    const { data, tunai } = siapkanSkenario();
    const dasar = {
      tanggal: '2026-11-05', tipe: 'keluar', jumlah: 10000, akunId: tunai,
      kategoriId: kategori(data, 'Transportasi', 'keluar').id
    };
    for (const tanggal of ['2026-02-29', '2026-11-31', '2026-13-01', '05-11-2026', '', undefined]) {
      assert.equal(D.tambahTransaksi(data, { ...dasar, tanggal }).kolom, 'tanggal', 'tanggal ' + tanggal);
    }
    assert.equal(D.tambahTransaksi(data, { ...dasar, akunId: 'akun_tidak_ada' }).kolom, 'akunId');
    assert.equal(D.tambahTransaksi(data, { ...dasar, akunId: null }).kolom, 'akunId');
    assert.equal(D.tambahTransaksi(data, { ...dasar, kategoriId: null }).kolom, 'kategoriId');
    assert.equal(D.tambahTransaksi(data, { ...dasar, tipe: 'hutang' }).kolom, 'tipe');
    assert.equal(D.tambahTransaksi(data, { ...dasar, catatan: 'x'.repeat(201) }).kolom, 'catatan');
    assert.equal(D.tambahTransaksi(data, { ...dasar, catatan: 'x'.repeat(200) }).ok, true);
  });

  test('ubah transaksi juga divalidasi dan tidak mengubah data bila ditolak', () => {
    const { data, id } = siapkanSkenario();
    const salinan = structuredClone(data);
    const lama = D.cariTransaksi(data, id.makan);
    assert.equal(D.ubahTransaksi(data, id.makan, { ...lama, jumlah: 0 }).ok, false);
    assert.equal(D.ubahTransaksi(data, 'trx_tidak_ada', lama).ok, false);
    assert.deepStrictEqual(data, salinan);
  });

  test('fungsi pengubah tidak pernah mengubah data lama', () => {
    const { data, id, tunai } = siapkanSkenario();
    const salinan = structuredClone(data);
    D.tambahTransaksi(data, {
      tanggal: '2026-11-06', tipe: 'keluar', jumlah: 5000, akunId: tunai,
      kategoriId: kategori(data, 'Transportasi', 'keluar').id
    });
    D.ubahTransaksi(data, id.makan, { ...D.cariTransaksi(data, id.makan), jumlah: 1 });
    D.hapusTransaksi(data, id.gaji);
    D.tambahAkun(data, { nama: 'Dompet', jenis: 'tunai' });
    D.ubahAkun(data, tunai, { nama: 'Uang tunai' });
    D.aturSaldoAwal(data, { [tunai]: 1 });
    D.buatBackup(data, 123);
    assert.deepStrictEqual(data, salinan);
  });
});

// ---------------------------------------------------------------------------
// Backup & pulihkan
// ---------------------------------------------------------------------------

describe('Backup & pulihkan', () => {
  test('backup lalu pulihkan menghasilkan data yang sama persis', () => {
    const { data } = siapkanSkenario();
    const waktu = Date.UTC(2026, 10, 20, 5, 0, 0);
    const backup = D.buatBackup(data, waktu);
    assert.equal(backup.data.pengaturan.backupTerakhir, waktu);

    const hasil = D.bacaBackup(backup.teks);
    assert.equal(hasil.ok, true, hasil.pesan);
    assert.deepStrictEqual(hasil.data, backup.data);

    // Lewat penyimpanan juga: simpan hasil pulihan, muat ulang, tetap sama.
    const storage = new PenyimpananPalsu();
    assert.equal(D.simpanData(storage, hasil.data).ok, true);
    const dimuat = D.muatData(storage);
    assert.equal(dimuat.status, 'ok');
    assert.deepStrictEqual(dimuat.data, backup.data);
  });

  test('backup yang diawali BOM tetap terbaca', () => {
    const { data } = siapkanSkenario();
    const backup = D.buatBackup(data, 1);
    assert.deepStrictEqual(D.bacaBackup(BOM + backup.teks).data, backup.data);
  });

  test('file backup rusak ditolak tanpa mengubah data', () => {
    const { data } = siapkanSkenario();
    const storage = new PenyimpananPalsu();
    D.simpanData(storage, data);
    const isiSebelum = storage.getItem(D.KUNCI_PENYIMPANAN);
    const salinan = structuredClone(data);

    const teksBaik = D.buatBackup(data, 1).teks;
    function rusakkan(ubah) {
      const o = JSON.parse(teksBaik);
      ubah(o);
      return JSON.stringify(o);
    }
    // urutan transaksi: 0 gaji, 1 makan, 2 tarik tunai, 3 isi e-wallet, 4 belanja
    const kasus = {
      'kosong': '',
      'bukan JSON': '{"aplikasi": "keuangan-harian", "versi": 1, ',
      'terpotong di tengah': teksBaik.slice(0, Math.floor(teksBaik.length / 2)),
      'aplikasi lain': JSON.stringify({ aplikasi: 'catatan-lain', versi: 1 }),
      'array': '[]',
      'versi lebih baru': rusakkan((o) => { o.versi = 2; }),
      'tanpa akun': rusakkan((o) => { o.akun = []; }),
      'tanpa daftar transaksi': rusakkan((o) => { delete o.transaksi; }),
      'jumlah desimal': rusakkan((o) => { o.transaksi[0].jumlah = 1500.5; }),
      'jumlah negatif': rusakkan((o) => { o.transaksi[0].jumlah = -1; }),
      'jumlah berupa teks': rusakkan((o) => { o.transaksi[0].jumlah = '5000000'; }),
      'akun tidak ada': rusakkan((o) => { o.transaksi[1].akunId = 'akun_hilang'; }),
      'kategori tidak ada': rusakkan((o) => { o.transaksi[1].kategoriId = 'kat_hilang'; }),
      'kategori tipe salah': rusakkan((o) => { o.transaksi[1].kategoriId = o.transaksi[0].kategoriId; }),
      'transfer ke akun sama': rusakkan((o) => { o.transaksi[2].akunTujuanId = o.transaksi[2].akunId; }),
      'transfer berkategori': rusakkan((o) => { o.transaksi[2].kategoriId = o.transaksi[1].kategoriId; }),
      'id transaksi ganda': rusakkan((o) => { o.transaksi[1].id = o.transaksi[0].id; }),
      'tanggal mustahil': rusakkan((o) => { o.transaksi[0].tanggal = '2026-02-30'; }),
      'saldo awal desimal': rusakkan((o) => { o.akun[0].saldoAwal = 0.5; }),
      'jenis akun asing': rusakkan((o) => { o.akun[0].jenis = 'koperasi'; })
    };
    for (const [nama, teks] of Object.entries(kasus)) {
      const hasil = D.bacaBackup(teks);
      assert.equal(hasil.ok, false, '"' + nama + '" seharusnya ditolak');
      assert.equal(typeof hasil.pesan, 'string');
      assert.equal(hasil.data, undefined);
    }
    assert.equal(storage.getItem(D.KUNCI_PENYIMPANAN), isiSebelum, 'data tersimpan tidak berubah');
    assert.deepStrictEqual(data, salinan, 'data di memori tidak berubah');
  });

  test('ringkasan isi backup untuk konfirmasi', () => {
    const { data } = siapkanSkenario();
    assert.deepStrictEqual(D.ringkasData(data), {
      akun: 3, kategori: 15, transaksi: 5, dari: '2026-11-01', sampai: '2026-11-04', backupTerakhir: null
    });
  });
});

// ---------------------------------------------------------------------------
// Penyimpanan
// ---------------------------------------------------------------------------

describe('Penyimpanan (localStorage)', () => {
  test('memakai satu kunci berversi', () => {
    assert.equal(D.KUNCI_PENYIMPANAN, 'keuangan-harian:v1');
  });

  test('pertama kali dibuka: data awal dibuat dan disimpan', () => {
    const storage = new PenyimpananPalsu();
    const hasil = D.muatData(storage);
    assert.equal(hasil.status, 'baru');
    assert.equal(hasil.tersimpan, true);
    assert.deepStrictEqual(JSON.parse(storage.getItem(D.KUNCI_PENYIMPANAN)), hasil.data);
    assert.equal(D.muatData(storage).status, 'ok');
  });

  test('data rusak disalin ke kunci lain dulu, baru mulai data baru', () => {
    const storage = new PenyimpananPalsu();
    const rusak = '{"aplikasi":"keuangan-harian","versi":1,"akun":[{"id":';
    storage.setItem(D.KUNCI_PENYIMPANAN, rusak);

    const hasil = D.muatData(storage, new Date(2026, 10, 8, 0, 30, 5).getTime());
    assert.equal(hasil.status, 'rusak');
    assert.equal(hasil.kunciSalinan, 'keuangan-harian:v1:rusak:2026-11-08T00-30-05');
    assert.equal(storage.getItem(hasil.kunciSalinan), rusak, 'salinan harus sama persis');
    assert.equal(typeof hasil.alasan, 'string');
    assert.equal(hasil.tersimpan, true);
    assert.deepStrictEqual(JSON.parse(storage.getItem(D.KUNCI_PENYIMPANAN)), hasil.data);
    assert.equal(hasil.data.akun.length, 3);
    assert.deepStrictEqual(D.daftarSalinanRusak(storage), [hasil.kunciSalinan]);
  });

  test('JSON yang terbaca tetapi isinya tidak sah juga dianggap rusak', () => {
    const { data } = siapkanSkenario();
    const o = structuredClone(data);
    o.transaksi[0].jumlah = 1.5;
    const mentah = JSON.stringify(o);
    const storage = new PenyimpananPalsu();
    storage.setItem(D.KUNCI_PENYIMPANAN, mentah);

    const hasil = D.muatData(storage);
    assert.equal(hasil.status, 'rusak');
    assert.match(hasil.alasan, /jumlah/);
    assert.equal(storage.getItem(hasil.kunciSalinan), mentah);
  });

  test('dua kali rusak di detik yang sama tidak menimpa salinan pertama', () => {
    const storage = new PenyimpananPalsu();
    const waktu = new Date(2026, 10, 8, 7, 0, 0).getTime();
    storage.setItem(D.KUNCI_PENYIMPANAN, 'rusak-1');
    const pertama = D.muatData(storage, waktu);
    storage.setItem(D.KUNCI_PENYIMPANAN, 'rusak-2');
    const kedua = D.muatData(storage, waktu);
    assert.notEqual(pertama.kunciSalinan, kedua.kunciSalinan);
    assert.equal(storage.getItem(pertama.kunciSalinan), 'rusak-1');
    assert.equal(storage.getItem(kedua.kunciSalinan), 'rusak-2');
  });

  test('kalau salinan gagal disimpan (penyimpanan penuh), data lama tidak ditimpa', () => {
    const rusak = 'x'.repeat(1000);
    const storage = new PenyimpananPalsu(D.KUNCI_PENYIMPANAN.length + 1500); // tidak muat dua salinan
    storage.setItem(D.KUNCI_PENYIMPANAN, rusak);

    const hasil = D.muatData(storage);
    assert.equal(hasil.status, 'rusak');
    assert.equal(hasil.kunciSalinan, null);
    assert.equal(hasil.tersimpan, false);
    assert.equal(hasil.mentah, rusak, 'isi lama dikembalikan supaya bisa diunduh');
    assert.equal(storage.getItem(D.KUNCI_PENYIMPANAN), rusak, 'data lama harus tetap utuh');
  });

  test('penyimpanan penuh saat menyimpan memberi pesan yang jelas', () => {
    const hasil = D.simpanData(new PenyimpananPalsu(100), D.buatDataAwal());
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /penuh/);
  });

  test('browser yang menolak akses penyimpanan tetap bisa dipakai sementara', () => {
    const storage = { getItem() { throw new Error('SecurityError'); } };
    const hasil = D.muatData(storage);
    assert.equal(hasil.status, 'tanpa-penyimpanan');
    assert.equal(hasil.tersimpan, false);
    assert.equal(hasil.data.akun.length, 3);
  });

  test('hapus satu salinan rusak; data utama tidak bisa dihapus lewat jalan ini', () => {
    const storage = new PenyimpananPalsu();
    storage.setItem(D.KUNCI_PENYIMPANAN, 'rusak');
    const muat = D.muatData(storage);
    assert.equal(D.daftarSalinanRusak(storage).length, 1);

    assert.equal(D.hapusSalinanRusak(storage, D.KUNCI_PENYIMPANAN).ok, false);
    assert.equal(D.hapusSalinanRusak(storage, 'kunci-lain').ok, false);
    assert.notEqual(storage.getItem(D.KUNCI_PENYIMPANAN), null, 'data utama tetap ada');

    assert.equal(D.hapusSalinanRusak(storage, muat.kunciSalinan).ok, true);
    assert.deepStrictEqual(D.daftarSalinanRusak(storage), []);
  });

  test('hapus semua data kembali ke data awal dan membuang salinan rusak', () => {
    const storage = new PenyimpananPalsu();
    storage.setItem(D.KUNCI_PENYIMPANAN, 'rusak');
    D.muatData(storage);
    const { data } = siapkanSkenario();
    D.simpanData(storage, data);
    storage.setItem('kunci-aplikasi-lain', 'jangan disentuh');

    const hasil = D.hapusSemuaData(storage);
    assert.equal(hasil.ok, true);
    assert.equal(hasil.data.transaksi.length, 0);
    assert.equal(hasil.data.akun.length, 3);
    assert.deepStrictEqual(JSON.parse(storage.getItem(D.KUNCI_PENYIMPANAN)), hasil.data);
    assert.deepStrictEqual(D.daftarSalinanRusak(storage), []);
    assert.equal(storage.getItem('kunci-aplikasi-lain'), 'jangan disentuh');
  });
});

// ---------------------------------------------------------------------------
// Akun & kategori
// ---------------------------------------------------------------------------

describe('Akun & kategori', () => {
  test('data awal sesuai spesifikasi', () => {
    const data = D.buatDataAwal();
    assert.deepStrictEqual(
      data.akun.map((a) => [a.nama, a.saldoAwal]),
      [['Tunai', 0], ['Rekening bank', 0], ['E-wallet', 0]]
    );
    assert.deepStrictEqual(D.kategoriPerTipe(data, 'keluar').map((k) => k.nama), [
      'Makan & minum', 'Transportasi', 'Belanja harian', 'Tagihan & listrik', 'Pulsa & internet',
      'Kesehatan', 'Hiburan', 'Pendidikan', 'Sedekah & donasi', 'Lainnya'
    ]);
    assert.deepStrictEqual(D.kategoriPerTipe(data, 'masuk').map((k) => k.nama), [
      'Gaji', 'Bonus', 'Usaha sampingan', 'Hadiah', 'Lainnya'
    ]);
    assert.equal(data.transaksi.length, 0);
    const semuaId = [...data.akun, ...data.kategori].map((x) => x.id);
    assert.equal(new Set(semuaId).size, semuaId.length, 'id harus unik');
  });

  test('akun yang dipakai transaksi tidak bisa dihapus; pesan menyebut jumlah transaksinya', () => {
    const { data, bank, tunai } = siapkanSkenario();
    const hasil = D.hapusAkun(data, bank);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /3 transaksi/); // gaji + dua transfer keluar
    assert.match(D.hapusAkun(data, tunai).pesan, /2 transaksi/); // makan + transfer masuk
    assert.equal(D.hitungPemakaianAkun(data, tunai), 2);
  });

  test('kategori yang dipakai transaksi tidak bisa dihapus', () => {
    const { data } = siapkanSkenario();
    const hasil = D.hapusKategori(data, kategori(data, 'Makan & minum', 'keluar').id);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /1 transaksi/);

    const hiburan = kategori(data, 'Hiburan', 'keluar');
    const sesudah = pasti(D.hapusKategori(data, hiburan.id));
    assert.equal(D.cariKategori(sesudah, hiburan.id), null);
  });

  test('akun yang belum dipakai boleh dihapus, tetapi minimal harus ada 1 akun', () => {
    let data = D.buatDataAwal();
    data = pasti(D.hapusAkun(data, akun(data, 'Tunai').id));
    data = pasti(D.hapusAkun(data, akun(data, 'Rekening bank').id));
    const hasil = D.hapusAkun(data, akun(data, 'E-wallet').id);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /Minimal harus ada 1 akun/);
  });

  test('minimal 1 kategori untuk tiap jenis', () => {
    let data = D.buatDataAwal();
    const masuk = D.kategoriPerTipe(data, 'masuk');
    for (const k of masuk.slice(1)) data = pasti(D.hapusKategori(data, k.id));
    const hasil = D.hapusKategori(data, masuk[0].id);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /1 kategori pemasukan/);
  });

  test('akun yang dihapus dilupakan dari pilihan "terakhir dipakai"', () => {
    let data = D.buatDataAwal();
    const baru = D.tambahAkun(data, { nama: 'Dompet cadangan', jenis: 'tunai' });
    data = pasti(baru);
    const catat = D.tambahTransaksi(data, {
      tanggal: '2026-11-05', tipe: 'keluar', jumlah: 1000, akunId: baru.akun.id,
      kategoriId: kategori(data, 'Lainnya', 'keluar').id
    });
    data = pasti(catat);
    assert.equal(D.pilihanAwalForm(data, 'keluar').akunId, baru.akun.id);
    data = pasti(D.hapusTransaksi(data, catat.transaksi.id));
    data = pasti(D.hapusAkun(data, baru.akun.id));
    assert.equal(data.pengaturan.terakhir.keluar.akunId, null);
    assert.equal(D.pilihanAwalForm(data, 'keluar').akunId, akun(data, 'Tunai').id);
  });

  test('nama akun & kategori tidak boleh kembar (huruf besar/kecil dianggap sama)', () => {
    const data = D.buatDataAwal();
    assert.equal(D.tambahAkun(data, { nama: '  tunai ', jenis: 'tunai' }).ok, false);
    assert.equal(D.tambahKategori(data, { nama: 'LAINNYA', tipe: 'keluar' }).ok, false);
    assert.equal(D.tambahKategori(data, { nama: 'Parkir', tipe: 'keluar' }).ok, true);
    assert.equal(D.ubahAkun(data, akun(data, 'Tunai').id, { nama: 'TUNAI' }).ok, true, 'ganti huruf nama sendiri boleh');
    assert.equal(D.ubahKategori(data, kategori(data, 'Bonus', 'masuk').id, { nama: 'Gaji' }).ok, false);
    assert.equal(D.ubahAkun(data, akun(data, 'Tunai').id, { nama: '  Uang   tunai ' }).akun.nama, 'Uang tunai');
  });

  test('saldo awal boleh negatif (utang) tetapi harus bilangan bulat', () => {
    const data = D.buatDataAwal();
    const kartu = pasti(D.tambahAkun(data, { nama: 'Kartu kredit', jenis: 'kartu_kredit', saldoAwal: -1250000 }));
    assert.equal(D.hitungSaldo(kartu).total, -1250000);
    assert.equal(D.tambahAkun(data, { nama: 'X', jenis: 'bank', saldoAwal: 10.5 }).kolom, 'saldoAwal');
    assert.equal(D.tambahAkun(data, { nama: 'X', jenis: 'bank', saldoAwal: -(D.JUMLAH_MAKS + 1) }).kolom, 'saldoAwal');
    assert.equal(D.tambahAkun(data, { nama: 'X', jenis: 'koperasi' }).kolom, 'jenis');
    assert.equal(D.tambahAkun(data, { nama: '   ', jenis: 'bank' }).kolom, 'nama');
    assert.equal(D.tambahAkun(data, { nama: 'x'.repeat(41), jenis: 'bank' }).kolom, 'nama');
  });
});

// ---------------------------------------------------------------------------
// Tanggal & format
// ---------------------------------------------------------------------------

describe('Tanggal & format', () => {
  test('"hari ini" memakai waktu lokal: pukul 00.30 WIB tetap tanggal hari itu', () => {
    const lewatTengahMalam = new Date(2026, 10, 8, 0, 30); // 8 November 2026, 00.30 WIB
    assert.equal(lewatTengahMalam.getTimezoneOffset(), -420, 'tes harus berjalan di zona WIB (UTC+7)');
    assert.equal(lewatTengahMalam.toISOString().slice(0, 10), '2026-11-07', 'toISOString memberi hari yang salah');
    assert.equal(D.tanggalLokal(lewatTengahMalam), '2026-11-08');
    assert.equal(D.bulanLokal(new Date(2026, 11, 1, 0, 5)), '2026-12');
  });

  test('validasi tanggal & pindah bulan', () => {
    assert.equal(D.tanggalValid('2028-02-29'), true);
    assert.equal(D.tanggalValid('2026-02-29'), false);
    assert.equal(D.tanggalValid('2026-11-31'), false);
    assert.equal(D.tanggalValid('2026-13-01'), false);
    assert.equal(D.geserBulan('2026-01', -1), '2025-12');
    assert.equal(D.geserBulan('2026-12', 1), '2027-01');
    assert.equal(D.geserBulan('2026-11', -13), '2025-10');
    assert.equal(D.labelBulan('2026-11'), 'November 2026');
  });

  test('label tanggal', () => {
    assert.equal(D.labelTanggal('2026-11-20', HARI_INI), 'Hari ini');
    assert.equal(D.labelTanggal('2026-11-19', HARI_INI), 'Kemarin');
    assert.equal(D.labelTanggal('2026-10-31', '2026-11-01'), 'Kemarin');
    assert.equal(D.labelTanggal('2026-11-05', HARI_INI), 'Kamis, 5 November');
    assert.equal(D.labelTanggal('2025-12-31', HARI_INI), 'Rabu, 31 Desember 2025');
    assert.equal(D.labelTanggalPendek('2026-11-05', HARI_INI), '5 Nov');
    assert.equal(D.formatTanggalPanjang('2026-11-08'), 'Minggu, 8 November 2026');
  });

  test('format Rupiah', () => {
    assert.equal(D.formatRupiah(1250000), 'Rp 1.250.000');
    assert.equal(D.formatRupiah(0), 'Rp 0');
    assert.equal(D.formatRupiah(999), 'Rp 999');
    assert.equal(D.formatRupiah(1000), 'Rp 1.000');
    assert.equal(D.formatRupiah(D.JUMLAH_MAKS), 'Rp 999.999.999.999');
    assert.equal(D.formatRupiah(-1250000), MINUS + 'Rp 1.250.000');
    assert.equal(D.formatRupiah(5000000, { tanda: true }), '+Rp 5.000.000');
    assert.equal(D.formatRupiah(0, { tanda: true }), 'Rp 0');
  });

  test('membaca isian jumlah', () => {
    assert.equal(D.parseJumlah('1.250.000'), 1250000);
    assert.equal(D.parseJumlah('Rp 25.000'), 25000);
    assert.equal(D.parseJumlah('25.000,00'), 25000);
    assert.equal(D.parseJumlah(''), null);
    assert.equal(D.parseJumlah('abc'), null);
  });

  test('format persen', () => {
    assert.equal(D.formatPersen(0.75), '75%');
    assert.equal(D.formatPersen(0.004), '<1%');
    assert.equal(D.formatPersen(0.996), '>99%');
    assert.equal(D.formatPersen(1), '100%');
    assert.equal(D.formatPersen(0), '0%');
  });

  test('persen per kategori selalu berjumlah 100', () => {
    assert.deepStrictEqual(D.persenBulat([0.625, 0.25, 0.125]), [63, 25, 12]); // bukan 63 + 25 + 13
    assert.deepStrictEqual(D.persenBulat([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
    assert.deepStrictEqual(D.persenBulat([0.75, 0.25]), [75, 25]);
    assert.deepStrictEqual(D.persenBulat([0.996, 0.004]), [100, 0]);
    assert.deepStrictEqual(D.persenBulat([]), []);
    for (const daftar of [[0.4839, 0.2581, 0.1613, 0.0967], [0.1, 0.2, 0.3, 0.4], [0.17, 0.17, 0.17, 0.17, 0.16, 0.16]]) {
      assert.equal(D.persenBulat(daftar).reduce((a, b) => a + b, 0), 100, JSON.stringify(daftar));
    }
    assert.equal(D.formatPersenBulat(100, 0.996), '>99%');
    assert.equal(D.formatPersenBulat(0, 0.004), '<1%');
    assert.equal(D.formatPersenBulat(63, 0.625), '63%');

    // lewat ringkasan bulan: 62.500 + 25.000 + 12.500
    let data = D.buatDataAwal();
    const tunai = akun(data, 'Tunai').id;
    for (const [nama, jumlah] of [['Makan & minum', 62500], ['Transportasi', 25000], ['Hiburan', 12500]]) {
      data = pasti(D.tambahTransaksi(data, {
        tanggal: '2026-11-05', tipe: 'keluar', jumlah, akunId: tunai, kategoriId: kategori(data, nama, 'keluar').id
      }));
    }
    const r = D.ringkasanBulan(data, '2026-11', HARI_INI);
    assert.deepStrictEqual(r.perKategori.keluar.map((k) => k.persen), [63, 25, 12]);
  });
});

// ---------------------------------------------------------------------------
// Laporan & riwayat
// ---------------------------------------------------------------------------

describe('Laporan & riwayat', () => {
  test('pengeluaran & pemasukan per kategori, urut dari terbesar', () => {
    const { data } = siapkanSkenario();
    const r = D.ringkasanBulan(data, '2026-11', HARI_INI);
    assert.deepStrictEqual(
      r.perKategori.keluar.map((k) => [k.nama, k.jumlah, k.porsi]),
      [['Belanja harian', 75000, 0.75], ['Makan & minum', 25000, 0.25]]
    );
    assert.deepStrictEqual(r.perKategori.masuk.map((k) => [k.nama, k.jumlah, k.porsi]), [['Gaji', 5000000, 1]]);
  });

  test('rata-rata pengeluaran per hari', () => {
    const { data: awal, tunai } = siapkanSkenario();
    const lainnya = kategori(awal, 'Lainnya', 'keluar').id;
    let data = pasti(D.tambahTransaksi(awal, {
      tanggal: '2026-10-31', tipe: 'keluar', jumlah: 62000, akunId: tunai, kategoriId: lainnya
    }));
    data = pasti(D.tambahTransaksi(data, { // bertanggal setelah "hari ini"
      tanggal: '2026-11-25', tipe: 'keluar', jumlah: 40000, akunId: tunai, kategoriId: lainnya
    }));

    const oktober = D.ringkasanBulan(data, '2026-10', HARI_INI);
    assert.equal(oktober.hariDihitung, 31);
    assert.equal(oktober.dasarRataRata, 62000);
    assert.equal(oktober.rataRataHarian, 2000); // 62.000 / 31

    const november = D.ringkasanBulan(data, '2026-11', HARI_INI);
    assert.equal(november.pengeluaran, 140000);
    assert.equal(november.hariDihitung, 20);
    assert.equal(november.dasarRataRata, 100000, 'pengeluaran bertanggal setelah hari ini tidak ikut');
    assert.equal(november.rataRataHarian, 5000); // 100.000 s.d. 20 Nov / 20 hari

    const desember = D.ringkasanBulan(data, '2026-12', HARI_INI);
    assert.equal(desember.rataRataHarian, null);
    assert.equal(desember.dasarRataRata, 0);

    // pembulatan ke rupiah terdekat
    assert.equal(D.ringkasanBulan(data, '2026-11', '2026-11-03').rataRataHarian, 8333); // 25.000 / 3
  });

  test('riwayat: filter jenis & akun, urut terbaru, dikelompokkan per tanggal', () => {
    const { data, tunai, id } = siapkanSkenario();
    const semua = D.transaksiBulan(data, '2026-11');
    assert.deepStrictEqual(semua.map((t) => t.id), [id.belanja, id.isiEwallet, id.tarikTunai, id.makan, id.gaji]);
    assert.equal(D.transaksiBulan(data, '2026-11', { tipe: 'transfer' }).length, 2);
    assert.equal(D.transaksiBulan(data, '2026-11', { tipe: 'keluar' }).length, 2);
    assert.equal(D.transaksiBulan(data, '2026-11', { tipe: 'semua' }).length, 5);
    assert.deepStrictEqual(
      D.transaksiBulan(data, '2026-11', { akunId: tunai }).map((t) => t.id),
      [id.tarikTunai, id.makan],
      'filter akun ikut menampilkan transfer yang masuk ke akun itu'
    );
    assert.equal(D.transaksiBulan(data, '2026-10').length, 0);
    assert.deepStrictEqual(
      D.kelompokkanPerTanggal(semua).map((g) => [g.tanggal, g.transaksi.length]),
      [['2026-11-04', 1], ['2026-11-03', 2], ['2026-11-02', 1], ['2026-11-01', 1]]
    );
  });

  test('5 transaksi terakhir: urut waktu dicatat, termasuk yang bertanggal mundur', () => {
    const { data: awal, tunai, id } = siapkanSkenario();
    const mundur = D.tambahTransaksi(awal, {
      tanggal: '2026-10-15', tipe: 'keluar', jumlah: 10000, akunId: tunai,
      kategoriId: kategori(awal, 'Lainnya', 'keluar').id
    }, Date.UTC(2026, 10, 20));
    const data = pasti(mundur);
    assert.deepStrictEqual(
      D.transaksiTerakhir(data, 5).map((t) => t.id),
      [mundur.transaksi.id, id.belanja, id.isiEwallet, id.tarikTunai, id.makan]
    );
  });

  test('hapus lalu "Batalkan" mengembalikan data persis seperti semula', () => {
    const { data, id } = siapkanSkenario();
    const hapus = D.hapusTransaksi(data, id.makan);
    const tanpa = pasti(hapus);
    assert.equal(saldo(tanpa, 'Tunai'), 800000);
    assert.deepStrictEqual(pasti(D.kembalikanTransaksi(tanpa, hapus.transaksi, hapus.indeks)), data);
    assert.equal(D.kembalikanTransaksi(data, hapus.transaksi, hapus.indeks).ok, false, 'tidak bisa dikembalikan dua kali');
  });
});

// ---------------------------------------------------------------------------
// Ekspor CSV
// ---------------------------------------------------------------------------

describe('Ekspor CSV', () => {
  test('BOM, pemisah titik koma, kolom, jumlah tanpa titik ribuan', () => {
    const { data } = siapkanSkenario();
    const csv = D.buatCSV(data);
    assert.ok(csv.startsWith(BOM), 'harus diawali BOM');
    assert.deepStrictEqual(csv.slice(1).split('\r\n'), [
      'Tanggal;Jenis;Jumlah;Akun;Akun tujuan;Kategori;Catatan',
      '2026-11-01;Pemasukan;5000000;Rekening bank;;Gaji;Gaji November',
      '2026-11-02;Pengeluaran;25000;Tunai;;Makan & minum;',
      '2026-11-03;Transfer;300000;Rekening bank;Tunai;;',
      '2026-11-03;Transfer;100000;Rekening bank;E-wallet;;',
      '2026-11-04;Pengeluaran;75000;E-wallet;;Belanja harian;',
      ''
    ]);
  });

  test('teks berawalan = + - @ diberi awalan petik; titik koma & kutip dibungkus', () => {
    let data = D.buatDataAwal();
    const kartu = D.tambahAkun(data, { nama: '+Kartu', jenis: 'kartu_kredit' });
    data = pasti(kartu);
    const makan = kategori(data, 'Makan & minum', 'keluar').id;
    const catatan = ['=SUM(A1:A9)', '+62 812', '-diskon', '@halo', 'nasi; teh', 'kata "kutip"', '=1;2', 'biasa'];
    catatan.forEach((c, i) => {
      data = pasti(D.tambahTransaksi(data, {
        tanggal: '2026-11-0' + (i + 1), tipe: 'keluar', jumlah: 1000, akunId: kartu.akun.id,
        kategoriId: makan, catatan: c
      }, i));
    });
    const awal = (i) => '2026-11-0' + i + ";Pengeluaran;1000;'+Kartu;;Makan & minum;";
    assert.deepStrictEqual(D.buatCSV(data).slice(1).split('\r\n').slice(1, -1), [
      awal(1) + "'=SUM(A1:A9)",
      awal(2) + "'+62 812",
      awal(3) + "'-diskon",
      awal(4) + "'@halo",
      awal(5) + '"nasi; teh"',
      awal(6) + '"kata ""kutip"""',
      awal(7) + '"\'=1;2"',
      awal(8) + 'biasa'
    ]);
  });
});

// ---------------------------------------------------------------------------
// Form Catat & pengingat
// ---------------------------------------------------------------------------

describe('Form Catat & pengingat', () => {
  test('pilihan awal: akun & kategori pertama kalau belum ada riwayat', () => {
    const data = D.buatDataAwal();
    const tunai = akun(data, 'Tunai').id;
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'keluar'), {
      akunId: tunai, akunTujuanId: null, kategoriId: kategori(data, 'Makan & minum', 'keluar').id
    });
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'masuk'), {
      akunId: tunai, akunTujuanId: null, kategoriId: kategori(data, 'Gaji', 'masuk').id
    });
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'transfer'), {
      akunId: tunai, akunTujuanId: akun(data, 'Rekening bank').id, kategoriId: null
    });
  });

  test('pilihan awal mengikuti yang terakhir dipakai, per jenis', () => {
    const { data, bank, ewallet } = siapkanSkenario();
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'keluar'), {
      akunId: ewallet, akunTujuanId: null, kategoriId: kategori(data, 'Belanja harian', 'keluar').id
    });
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'masuk'), {
      akunId: bank, akunTujuanId: null, kategoriId: kategori(data, 'Gaji', 'masuk').id
    });
    assert.deepStrictEqual(D.pilihanAwalForm(data, 'transfer'), {
      akunId: bank, akunTujuanId: ewallet, kategoriId: null
    });
  });

  test('pengingat backup: ada transaksi dan backup terakhir lebih dari 7 hari lalu (atau belum pernah)', () => {
    assert.equal(D.perluPengingatBackup(D.buatDataAwal(), Date.now()), false, 'belum ada transaksi');
    const { data } = siapkanSkenario();
    assert.equal(D.perluPengingatBackup(data, Date.now()), true, 'belum pernah backup');

    const T = Date.UTC(2026, 10, 10);
    const sudah = D.buatBackup(data, T).data;
    assert.equal(D.perluPengingatBackup(sudah, T + 3 * SEHARI), false);
    assert.equal(D.perluPengingatBackup(sudah, T + 7 * SEHARI), false, 'tepat 7 hari belum lewat');
    assert.equal(D.perluPengingatBackup(sudah, T + 7 * SEHARI + 1), true);
    assert.equal(D.hariSejakBackup(sudah, T + 8.5 * SEHARI), 8);
  });

  test('ajakan "Atur saldo awal"', () => {
    const data = D.buatDataAwal();
    assert.equal(D.perluAjakanSaldoAwal(data), true);

    const semuaNol = Object.fromEntries(data.akun.map((a) => [a.id, 0]));
    assert.equal(D.perluAjakanSaldoAwal(pasti(D.aturSaldoAwal(data, semuaNol))), false, 'disimpan walau semua 0');
    assert.equal(D.perluAjakanSaldoAwal(pasti(D.tutupAjakanSaldoAwal(data))), false, 'ditutup');
    assert.equal(
      D.perluAjakanSaldoAwal(pasti(D.ubahAkun(data, data.akun[0].id, { saldoAwal: 100000 }))),
      false,
      'diatur lewat ubah akun'
    );

    const salah = D.aturSaldoAwal(data, { [data.akun[0].id]: 10.5 });
    assert.equal(salah.ok, false);
    assert.equal(salah.kolom, data.akun[0].id);
    assert.match(salah.pesan, /Tunai/);
  });
});
