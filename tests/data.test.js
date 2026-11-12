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

  test('hapus lalu "Batalkan" mengembalikan data seperti semula', () => {
    const { data, id } = siapkanSkenario();
    const hapus = D.hapusTransaksi(data, id.makan);
    const tanpa = pasti(hapus);
    assert.equal(saldo(tanpa, 'Tunai'), 800000);
    const kembali = pasti(D.kembalikanTransaksi(tanpa, hapus.transaksi, hapus.indeks));
    // Sama persis dengan semula (isi, posisi, tanpa tanda hapus), kecuali waktu ubah
    // transaksi itu yang sengaja maju: lihat tes "Batalkan" di bagian sinkron.
    const semula = D.cariTransaksi(data, id.makan);
    assert.ok(D.cariTransaksi(kembali, id.makan).diubah > semula.diubah);
    assert.deepStrictEqual(
      {
        ...kembali,
        transaksi: kembali.transaksi.map((t) => (t.id === id.makan ? { ...t, diubah: semula.diubah } : t))
      },
      data
    );
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

// ---------------------------------------------------------------------------
// Sinkron antar perangkat
// ---------------------------------------------------------------------------

const NANTI = 2000000000000; // waktu yang pasti lebih besar dari semua waktu di data uji

function gabung(a, b) {
  const hasil = D.gabungData(a, b);
  assert.equal(hasil.ok, true, 'gabung seharusnya berhasil, tetapi: ' + hasil.pesan);
  return hasil.data;
}

/** Data harus sah dan tidak berubah saat disimpan lalu dimuat lagi (lewat JSON). */
function harusSah(data) {
  const periksa = D.periksaData(JSON.parse(JSON.stringify(data)));
  assert.equal(periksa.ok, true, periksa.pesan);
  assert.deepStrictEqual(periksa.data, data);
}

/** Dua perangkat yang sudah tersambung: berangkat dari data yang sama. */
function duaPerangkat() {
  const s = siapkanSkenario();
  return { ...s, a: structuredClone(s.data), b: structuredClone(s.data) };
}

describe('Sinkron: waktu ubah & tanda hapus', () => {
  test('rekaman baru mencatat waktu ubah; data bawaan belum pernah diubah', () => {
    const data = D.buatDataAwal();
    assert.ok(data.akun.every((a) => a.diubah === 0));
    assert.ok(data.kategori.every((k) => k.diubah === 0));
    assert.deepStrictEqual(data.terhapus, { akun: {}, kategori: {}, transaksi: {} });

    const t = D.tambahTransaksi(data, {
      tanggal: '2026-11-05', tipe: 'keluar', jumlah: 1000, akunId: akun(data, 'Tunai').id,
      kategoriId: kategori(data, 'Lainnya', 'keluar').id
    }, 5000);
    assert.equal(t.transaksi.dibuat, 5000);
    assert.equal(t.transaksi.diubah, 5000);
    assert.equal(D.tambahAkun(data, { nama: 'BCA', jenis: 'bank' }, 6000).akun.diubah, 6000);
    assert.equal(D.tambahKategori(data, { nama: 'Parkir', tipe: 'keluar' }, 7000).kategori.diubah, 7000);
  });

  test('mengubah memajukan waktu ubah, juga saat jam perangkat tertinggal', () => {
    const { data, id, tunai } = siapkanSkenario();
    const lama = D.cariTransaksi(data, id.makan);
    const u1 = D.ubahTransaksi(data, id.makan, { ...lama, jumlah: 30000 }, NANTI);
    assert.equal(u1.transaksi.diubah, NANTI);
    assert.equal(u1.transaksi.dibuat, lama.dibuat);
    const u2 = D.ubahTransaksi(u1.data, id.makan, { ...lama, jumlah: 35000 }, 1000); // jam mundur jauh
    assert.equal(u2.transaksi.diubah, NANTI + 1);

    const a1 = D.ubahAkun(data, tunai, { nama: 'Dompet' }, NANTI);
    assert.equal(a1.akun.diubah, NANTI);
    assert.equal(D.ubahAkun(a1.data, tunai, { jenis: 'lainnya' }, 5).akun.diubah, NANTI + 1);

    const hiburan = kategori(data, 'Hiburan', 'keluar');
    const k1 = D.ubahKategori(data, hiburan.id, { nama: 'Rekreasi' }, NANTI);
    assert.equal(k1.kategori.diubah, NANTI);
    assert.equal(D.ubahKategori(k1.data, hiburan.id, { nama: 'Liburan' }, 5).kategori.diubah, NANTI + 1);
  });

  test('menyimpan tanpa perubahan isi tidak menyentuh data', () => {
    const { data, id, tunai, bank, ewallet } = siapkanSkenario();
    const lama = D.cariTransaksi(data, id.makan);
    const h = D.ubahTransaksi(data, id.makan, { ...lama }, NANTI);
    assert.equal(h.ok, true);
    assert.equal(h.data, data);
    assert.equal(h.transaksi, lama);
    assert.equal(D.ubahAkun(data, tunai, { nama: 'Tunai' }, NANTI).data, data);
    assert.equal(D.ubahKategori(data, kategori(data, 'Gaji', 'masuk').id, { nama: 'Gaji' }, NANTI).data, data);

    const s = pasti(D.aturSaldoAwal(data, { [tunai]: 500000, [bank]: 2500000, [ewallet]: 0 }, NANTI));
    assert.equal(D.cariAkun(s, tunai), D.cariAkun(data, tunai), 'saldo sama: rekaman tidak disentuh');
    assert.equal(D.cariAkun(s, ewallet), D.cariAkun(data, ewallet));
    assert.equal(D.cariAkun(s, bank).diubah, NANTI, 'hanya yang saldonya berubah yang waktu ubahnya maju');
  });

  test('menghapus meninggalkan tanda hapus', () => {
    const { data, id } = siapkanSkenario();
    const lama = D.cariTransaksi(data, id.belanja);
    const h = D.hapusTransaksi(data, id.belanja, NANTI);
    assert.equal(D.tandaHapus(h.data, 'transaksi', id.belanja), NANTI);
    assert.equal(D.tandaHapus(data, 'transaksi', id.belanja), null, 'data lama tidak berubah');
    assert.equal(
      D.tandaHapus(D.hapusTransaksi(data, id.belanja, 5).data, 'transaksi', id.belanja),
      lama.diubah + 1,
      'jam tertinggal: tanda tetap lebih baru dari rekamannya'
    );

    const dompet = D.tambahAkun(data, { nama: 'Dompet', jenis: 'tunai' }, NANTI);
    const tanpaDompet = pasti(D.hapusAkun(dompet.data, dompet.akun.id, NANTI + 10));
    assert.equal(D.tandaHapus(tanpaDompet, 'akun', dompet.akun.id), NANTI + 10);
    harusSah(tanpaDompet);

    const hiburan = kategori(data, 'Hiburan', 'keluar');
    assert.equal(D.tandaHapus(pasti(D.hapusKategori(data, hiburan.id, NANTI)), 'kategori', hiburan.id), NANTI);
  });

  test('"Batalkan" membuang tanda hapus dan menang atas tanda yang sudah sampai ke perangkat lain', () => {
    const { data, id } = siapkanSkenario();
    const hapus = D.hapusTransaksi(data, id.makan, NANTI);
    const kembali = pasti(D.kembalikanTransaksi(hapus.data, hapus.transaksi, hapus.indeks, NANTI + 5));
    assert.equal(D.tandaHapus(kembali, 'transaksi', id.makan), null);
    assert.equal(D.cariTransaksi(kembali, id.makan).diubah, NANTI + 5);
    assert.equal(
      D.cariTransaksi(pasti(D.kembalikanTransaksi(hapus.data, hapus.transaksi, hapus.indeks, 5)), id.makan).diubah,
      NANTI + 1,
      'jam tertinggal saat membatalkan'
    );

    // Perangkat lain (atau awan) sudah telanjur menerima tanda hapusnya.
    const gabungan = gabung(kembali, hapus.data);
    assert.ok(D.cariTransaksi(gabungan, id.makan), 'transaksi tetap ada');
    assert.equal(D.tandaHapus(gabungan, 'transaksi', id.makan), null);
    assert.equal(saldo(gabungan, 'Tunai'), 775000);
  });

  test('data lama tanpa waktu ubah dan tanda hapus tetap terbaca', () => {
    const { data } = siapkanSkenario();
    const lama = JSON.parse(JSON.stringify(data));
    delete lama.terhapus;
    [...lama.akun, ...lama.kategori, ...lama.transaksi].forEach((r) => { delete r.diubah; });

    const periksa = D.periksaData(lama);
    assert.equal(periksa.ok, true, periksa.pesan);
    assert.ok(periksa.data.akun.every((a) => a.diubah === 0));
    assert.ok(periksa.data.kategori.every((k) => k.diubah === 0));
    assert.ok(periksa.data.transaksi.every((t) => t.diubah === t.dibuat));
    assert.deepStrictEqual(periksa.data.terhapus, { akun: {}, kategori: {}, transaksi: {} });
    assert.equal(D.hitungSaldo(periksa.data).total, 7400000);

    // Lewat penyimpanan, seperti data yang sudah ada di HP sebelum pembaruan aplikasi.
    const storage = new PenyimpananPalsu();
    storage.setItem(D.KUNCI_PENYIMPANAN, JSON.stringify(lama));
    const dimuat = D.muatData(storage);
    assert.equal(dimuat.status, 'ok');
    assert.equal(D.hitungSaldo(dimuat.data).total, 7400000);
    assert.deepStrictEqual(D.daftarSalinanRusak(storage), [], 'tidak dianggap rusak');

    assert.equal(D.bacaBackup(JSON.stringify(lama)).ok, true, 'backup lama tetap bisa dipulihkan');
  });

  test('tanda hapus yang tidak sah dibuang saat memuat', () => {
    const { data, id } = siapkanSkenario();
    const mentah = JSON.parse(JSON.stringify(data));
    mentah.terhapus = {
      akun: 'bukan objek',
      transaksi: { trx_lama: 123, [id.makan]: 999, 'id tidak sah!': 5, trx_desimal: 1.5, trx_teks: 'x', trx_minus: -1 }
    };
    const periksa = D.periksaData(mentah);
    assert.equal(periksa.ok, true, periksa.pesan);
    assert.deepStrictEqual(periksa.data.terhapus, { akun: {}, kategori: {}, transaksi: { trx_lama: 123 } });
    assert.ok(D.cariTransaksi(periksa.data, id.makan), 'rekaman yang masih ada tidak hilang oleh tanda nyasar');
  });

  test('id baru selalu urut menurut waktu dibuat', () => {
    const ids = [];
    for (let i = 0; i < 200; i++) { // 3.600 id beruntun: melewati batas nomor urut dua digit
      const d = D.buatDataAwal();
      d.akun.concat(d.kategori).forEach((r) => { ids.push(r.id.slice(r.id.indexOf('_') + 1, r.id.indexOf('_') + 11)); });
    }
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], 'id ke-' + (i + 1) + ' tidak lebih besar dari sebelumnya: ' + ids[i - 1] + ' lalu ' + ids[i]);
    }
  });
});

describe('Sinkron: menggabungkan data dua perangkat', () => {
  test('catatan baru dari dua perangkat sama-sama dipertahankan', () => {
    const { a, b, tunai, bank } = duaPerangkat();
    const a2 = pasti(D.tambahTransaksi(a, {
      tanggal: '2026-11-06', tipe: 'keluar', jumlah: 20000, akunId: tunai,
      kategoriId: kategori(a, 'Makan & minum', 'keluar').id
    }, NANTI));
    const b2 = pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-07', tipe: 'masuk', jumlah: 150000, akunId: bank,
      kategoriId: kategori(b, 'Bonus', 'masuk').id
    }, NANTI + 1));

    const g = gabung(a2, b2);
    assert.equal(g.transaksi.length, 7);
    assert.equal(D.hitungSaldo(g).total, 7400000 - 20000 + 150000);
    assert.equal(D.sidikData(gabung(b2, a2)), D.sidikData(g), 'urutan penggabungan tidak berpengaruh');
    harusSah(g);
  });

  test('catatan yang sama diubah di dua perangkat: perubahan terakhir menang', () => {
    const { a, b, id } = duaPerangkat();
    const lama = D.cariTransaksi(a, id.makan);
    const a2 = pasti(D.ubahTransaksi(a, id.makan, { ...lama, jumlah: 30000 }, NANTI));
    const b2 = pasti(D.ubahTransaksi(b, id.makan, { ...lama, jumlah: 45000, catatan: 'traktir' }, NANTI + 60000));
    for (const g of [gabung(a2, b2), gabung(b2, a2)]) {
      assert.equal(D.cariTransaksi(g, id.makan).jumlah, 45000);
      assert.equal(D.cariTransaksi(g, id.makan).catatan, 'traktir');
      assert.equal(saldo(g, 'Tunai'), 775000 + 25000 - 45000);
    }
  });

  test('yang dihapus di satu perangkat ikut terhapus di perangkat lain', () => {
    const { a, b, id } = duaPerangkat();
    const a2 = pasti(D.hapusTransaksi(a, id.belanja, NANTI));
    const g = gabung(b, a2); // perangkat b menerima perubahan a
    assert.equal(D.cariTransaksi(g, id.belanja), null);
    assert.equal(D.tandaHapus(g, 'transaksi', id.belanja), NANTI);
    assert.equal(D.hitungSaldo(g).total, 7475000);
    harusSah(g);
  });

  test('diubah setelah dihapus hidup lagi; dihapus setelah diubah tetap terhapus', () => {
    const { a, b, id } = duaPerangkat();
    const lama = D.cariTransaksi(a, id.makan);

    let a2 = pasti(D.hapusTransaksi(a, id.makan, NANTI));
    let b2 = pasti(D.ubahTransaksi(b, id.makan, { ...lama, jumlah: 40000 }, NANTI + 1000));
    let g = gabung(a2, b2);
    assert.equal(D.cariTransaksi(g, id.makan).jumlah, 40000);
    assert.equal(D.tandaHapus(g, 'transaksi', id.makan), null);
    assert.equal(D.sidikData(gabung(b2, a2)), D.sidikData(g));

    a2 = pasti(D.ubahTransaksi(a, id.makan, { ...lama, jumlah: 40000 }, NANTI));
    b2 = pasti(D.hapusTransaksi(b, id.makan, NANTI + 1000));
    g = gabung(a2, b2);
    assert.equal(D.cariTransaksi(g, id.makan), null);
    assert.equal(D.tandaHapus(g, 'transaksi', id.makan), NANTI + 1000);
    assert.equal(D.sidikData(gabung(b2, a2)), D.sidikData(g));
  });

  test('waktu ubah sama persis tetapi isi berbeda: semua perangkat memilih versi yang sama', () => {
    const { a, b, id } = duaPerangkat();
    const lama = D.cariTransaksi(a, id.makan);
    const a2 = pasti(D.ubahTransaksi(a, id.makan, { ...lama, jumlah: 30000 }, NANTI));
    const b2 = pasti(D.ubahTransaksi(b, id.makan, { ...lama, jumlah: 31000 }, NANTI));
    const g1 = gabung(a2, b2);
    const g2 = gabung(b2, a2);
    assert.equal(D.cariTransaksi(g1, id.makan).jumlah, D.cariTransaksi(g2, id.makan).jumlah);
    assert.equal(D.sidikData(g1), D.sidikData(g2));
  });

  test('jam perangkat tertinggal: perubahan yang dibuat setelah menerima data tetap menang', () => {
    const { a, b, id } = duaPerangkat();
    const lama = D.cariTransaksi(a, id.makan);
    const a2 = pasti(D.ubahTransaksi(a, id.makan, { ...lama, jumlah: 30000 }, NANTI));
    let b2 = gabung(b, a2); // b menerima perubahan a
    b2 = pasti(D.ubahTransaksi(b2, id.makan, { ...lama, jumlah: 50000 }, NANTI - 3600000)); // jam b tertinggal 1 jam
    assert.equal(D.cariTransaksi(gabung(a2, b2), id.makan).jumlah, 50000);
  });

  test('akun yang dihapus di satu perangkat tetapi dipakai transaksi baru di perangkat lain tidak hilang', () => {
    const s = siapkanSkenario();
    const denganDompet = D.tambahAkun(s.data, { nama: 'Dompet', jenis: 'tunai' }, NANTI);
    const dompet = denganDompet.akun.id;
    const a = structuredClone(denganDompet.data);
    const b = structuredClone(denganDompet.data);
    const lainnya = kategori(b, 'Lainnya', 'keluar').id;

    const a2 = pasti(D.hapusAkun(a, dompet, NANTI + 1000)); // di a akun itu belum dipakai
    const b2 = pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-08', tipe: 'keluar', jumlah: 5000, akunId: dompet, kategoriId: lainnya
    }, NANTI + 500));

    const g = gabung(a2, b2);
    assert.equal(D.cariAkun(g, dompet).nama, 'Dompet');
    assert.equal(D.tandaHapus(g, 'akun', dompet), null);
    assert.ok(D.cariAkun(g, dompet).diubah > NANTI + 1000, 'lebih baru dari tanda hapusnya');
    harusSah(g);
    assert.equal(D.sidikData(gabung(b2, a2)), D.sidikData(g));
    assert.equal(D.sidikData(gabung(a2, g)), D.sidikData(g), 'perangkat yang masih memegang tanda hapus ikut menghidupkan');

    // Sama halnya kalau akun itu jadi tujuan transfer.
    const b3 = pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-08', tipe: 'transfer', jumlah: 5000, akunId: s.tunai, akunTujuanId: dompet
    }, NANTI + 500));
    const g3 = gabung(a2, b3);
    assert.ok(D.cariAkun(g3, dompet));
    harusSah(g3);
  });

  test('kategori yang dihapus tetapi dipakai transaksi di perangkat lain tidak hilang', () => {
    const { a, b, tunai } = duaPerangkat();
    const hiburan = kategori(a, 'Hiburan', 'keluar').id;
    const a2 = pasti(D.hapusKategori(a, hiburan, NANTI + 1000));
    const b2 = pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-08', tipe: 'keluar', jumlah: 35000, akunId: tunai, kategoriId: hiburan
    }, NANTI));
    const g = gabung(a2, b2);
    assert.equal(D.cariKategori(g, hiburan).nama, 'Hiburan');
    assert.equal(g.kategori.length, 15);
    harusSah(g);
    assert.equal(D.sidikData(gabung(b2, a2)), D.sidikData(g));
  });

  test('selalu tersisa minimal 1 akun dan 1 kategori per jenis', () => {
    let dasar = D.buatDataAwal();
    dasar = pasti(D.hapusAkun(dasar, akun(dasar, 'E-wallet').id, NANTI));
    const a = pasti(D.hapusAkun(structuredClone(dasar), akun(dasar, 'Tunai').id, NANTI + 10));         // a menyisakan Rekening bank
    const b = pasti(D.hapusAkun(structuredClone(dasar), akun(dasar, 'Rekening bank').id, NANTI + 20)); // b menyisakan Tunai
    const g = gabung(a, b);
    assert.deepStrictEqual(g.akun.map((x) => x.nama), ['Rekening bank'], 'yang paling akhir dihapus dihidupkan lagi');
    assert.equal(D.sidikData(gabung(b, a)), D.sidikData(g));
    harusSah(g);

    const awal = D.buatDataAwal();
    const masuk = D.kategoriPerTipe(awal, 'masuk'); // Gaji, Bonus, Usaha sampingan, Hadiah, Lainnya
    let x = structuredClone(awal);
    let y = structuredClone(awal);
    masuk.slice(1).forEach((k, i) => { x = pasti(D.hapusKategori(x, k.id, NANTI + i)); });          // x menyisakan Gaji
    masuk.slice(0, 4).forEach((k, i) => { y = pasti(D.hapusKategori(y, k.id, NANTI + 100 + i)); }); // y menyisakan Lainnya
    const g2 = gabung(x, y);
    // Bonus, Usaha sampingan, dan Hadiah dihapus di KEDUA perangkat, jadi isinya sudah tidak ada.
    // Yang masih bisa dihidupkan hanya Gaji (dihapus y, NANTI+100) dan Lainnya (dihapus x, NANTI+3):
    // dipilih yang paling akhir dihapus.
    assert.deepStrictEqual(D.kategoriPerTipe(g2, 'masuk').map((k) => k.nama), ['Gaji']);
    assert.equal(D.kategoriPerTipe(g2, 'keluar').length, 10);
    assert.equal(D.sidikData(gabung(y, x)), D.sidikData(g2));
    harusSah(g2);
  });

  test('menggabung ulang tidak mengubah apa pun', () => {
    const { a, b, id, tunai } = duaPerangkat();
    const lama = D.cariTransaksi(a, id.makan);
    let a2 = pasti(D.ubahTransaksi(a, id.makan, { ...lama, jumlah: 30000 }, NANTI));
    a2 = pasti(D.hapusTransaksi(a2, id.belanja, NANTI + 1));
    a2 = pasti(D.tambahAkun(a2, { nama: 'BCA', jenis: 'bank', saldoAwal: 100000 }, NANTI + 2));
    let b2 = pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 12000, akunId: tunai,
      kategoriId: kategori(b, 'Transportasi', 'keluar').id
    }, NANTI + 3));
    b2 = pasti(D.ubahKategori(b2, kategori(b2, 'Hiburan', 'keluar').id, { nama: 'Rekreasi' }, NANTI + 4));

    const g = gabung(a2, b2);
    assert.deepStrictEqual(gabung(g, g), g);
    for (const asal of [a2, b2]) {
      assert.equal(D.sidikData(gabung(asal, g)), D.sidikData(g));
      assert.equal(D.sidikData(gabung(g, asal)), D.sidikData(g));
    }
    harusSah(g);
  });

  test('urutan akun, kategori, dan transaksi tidak berubah oleh penggabungan', () => {
    const { data } = siapkanSkenario();
    const g = gabung(data, structuredClone(data));
    assert.deepStrictEqual(g.akun.map((x) => x.nama), data.akun.map((x) => x.nama));
    assert.deepStrictEqual(g.kategori.map((x) => x.nama), data.kategori.map((x) => x.nama));
    assert.deepStrictEqual(g.transaksi.map((x) => x.id), data.transaksi.map((x) => x.id));
    assert.equal(D.sidikData(g), D.sidikData(data));
  });

  test('pengaturan: "terakhir dipakai" milik perangkat ini; waktu backup yang terbaru; saldo awal cukup diatur sekali', () => {
    const { a, b, tunai } = duaPerangkat();
    const a2 = D.buatBackup(a, 1000).data;
    const b2 = D.buatBackup(pasti(D.tambahTransaksi(b, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 12000, akunId: tunai,
      kategoriId: kategori(b, 'Transportasi', 'keluar').id
    }, NANTI)), 9000).data;

    assert.deepStrictEqual(gabung(a2, b2).pengaturan.terakhir, a2.pengaturan.terakhir);
    assert.deepStrictEqual(gabung(b2, a2).pengaturan.terakhir, b2.pengaturan.terakhir);
    assert.equal(gabung(a2, b2).pengaturan.backupTerakhir, 9000);
    assert.equal(gabung(b2, a2).pengaturan.backupTerakhir, 9000);

    const baru = D.buatDataAwal();
    const diatur = pasti(D.tutupAjakanSaldoAwal(structuredClone(baru)));
    assert.equal(gabung(baru, diatur).pengaturan.saldoAwalDiatur, true);
    assert.equal(gabung(diatur, baru).pengaturan.saldoAwalDiatur, true);
    assert.equal(gabung(baru, structuredClone(baru)).pengaturan.saldoAwalDiatur, false);
  });

  test('"terakhir dipakai" yang menunjuk akun yang sudah dihapus perangkat lain dikosongkan', () => {
    const s = siapkanSkenario();
    const denganDompet = D.tambahAkun(s.data, { nama: 'Dompet', jenis: 'tunai' }, NANTI);
    const dompet = denganDompet.akun.id;
    let a = structuredClone(denganDompet.data);
    const b = structuredClone(denganDompet.data);
    // a sempat memakai Dompet lalu menghapus transaksinya; "terakhir dipakai" di a masih Dompet.
    const pakai = D.tambahTransaksi(a, {
      tanggal: '2026-11-08', tipe: 'keluar', jumlah: 5000, akunId: dompet,
      kategoriId: kategori(a, 'Lainnya', 'keluar').id
    }, NANTI + 1);
    a = pasti(D.hapusTransaksi(pakai.data, pakai.transaksi.id, NANTI + 2));
    assert.equal(a.pengaturan.terakhir.keluar.akunId, dompet);
    const b2 = pasti(D.hapusAkun(b, dompet, NANTI + 3));

    const g = gabung(a, b2);
    assert.equal(D.cariAkun(g, dompet), null);
    assert.equal(g.pengaturan.terakhir.keluar.akunId, null);
    harusSah(g);
  });

  test('gabungan yang tidak sah ditolak, bukan disimpan', () => {
    const { a, id } = duaPerangkat();
    const rusak = structuredClone(a);
    const t = rusak.transaksi.find((x) => x.id === id.makan);
    t.jumlah = -5;
    t.diubah = NANTI; // versi rusak ini yang "terbaru"
    const hasil = D.gabungData(a, rusak);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /tidak bisa digabung/);
    assert.equal(hasil.data, undefined);
  });
});

describe('Sinkron: isi awan yang tanggung', () => {
  // Awan ditulis per jalur oleh tiap perangkat. Kalau dua perangkat menulis pada waktu
  // yang hampir bersamaan, isinya bisa sesaat tidak lengkap. periksaDataAwan menerima
  // keadaan itu (tiap rekaman tetap diperiksa) dan gabungData yang membereskannya.

  const KOSONG = {
    aplikasi: 'keuangan-harian', versi: 1, akun: [], kategori: [], transaksi: [],
    terhapus: { akun: {}, kategori: {}, transaksi: {} },
    pengaturan: { terakhir: null, backupTerakhir: null, saldoAwalDiatur: false }
  };

  function longgar(mentah) {
    const periksa = D.periksaDataAwan(structuredClone(mentah));
    assert.equal(periksa.ok, true, periksa.pesan);
    return periksa.data;
  }

  test('hubungan antar rekaman yang belum lengkap diterima; pemeriksaan biasa tetap menolaknya', () => {
    const { data, id, tunai } = siapkanSkenario();

    const tanpaTunai = structuredClone(data);
    tanpaTunai.akun = tanpaTunai.akun.filter((a) => a.id !== tunai);
    assert.equal(D.periksaData(tanpaTunai).ok, false);
    assert.equal(longgar(tanpaTunai).transaksi.length, 5);

    const tanpaAkun = structuredClone(data);
    tanpaAkun.akun = [];
    tanpaAkun.kategori = [];
    assert.equal(D.periksaData(tanpaAkun).ok, false);
    assert.equal(longgar(tanpaAkun).transaksi.length, 5);

    // Rekaman bersama tanda hapusnya: pemeriksaan biasa membuang tandanya, yang longgar membawa keduanya.
    const ganda = structuredClone(data);
    ganda.terhapus.transaksi[id.makan] = NANTI;
    ganda.terhapus.akun[tunai] = NANTI;
    assert.deepStrictEqual(pasti(D.periksaData(ganda)).terhapus, { akun: {}, kategori: {}, transaksi: {} });
    const l = longgar(ganda);
    assert.deepStrictEqual(l.terhapus, { akun: { [tunai]: NANTI }, kategori: {}, transaksi: { [id.makan]: NANTI } });
    assert.ok(l.transaksi.some((t) => t.id === id.makan));
    assert.ok(l.akun.some((a) => a.id === tunai));
  });

  test('tiap rekaman tetap diperiksa dengan ketat', () => {
    const { data, id, bank } = siapkanSkenario();
    const periksa = (ubah) => {
      const d = structuredClone(data);
      ubah(d, (nama) => d.transaksi.find((t) => t.id === id[nama]));
      return D.periksaDataAwan(d);
    };
    const kasus = {
      'jumlah negatif': (d, t) => { t('makan').jumlah = -5; },
      'jumlah desimal': (d, t) => { t('makan').jumlah = 0.5; },
      'tanggal yang tidak ada': (d, t) => { t('makan').tanggal = '2026-02-30'; },
      'jenis tidak dikenal': (d, t) => { t('makan').tipe = 'hadiah'; },
      'akun bukan id': (d, t) => { t('makan').akunId = 'bukan id!'; },
      'akun kosong': (d, t) => { t('makan').akunId = null; },
      'kategori bukan id': (d, t) => { t('makan').kategoriId = { x: 1 }; },
      'kategori kosong': (d, t) => { t('makan').kategoriId = null; },
      'kategori dengan tipe yang salah': (d, t) => { t('makan').kategoriId = kategori(d, 'Gaji', 'masuk').id; },
      'transfer ke akun yang sama': (d, t) => { t('tarikTunai').akunTujuanId = bank; },
      'transfer tanpa tujuan': (d, t) => { t('tarikTunai').akunTujuanId = null; },
      'transfer berkategori': (d, t) => { t('tarikTunai').kategoriId = kategori(d, 'Lainnya', 'keluar').id; },
      'pengeluaran dengan akun tujuan': (d, t) => { t('makan').akunTujuanId = bank; },
      'id transaksi ganda': (d, t) => { t('makan').id = id.gaji; },
      'waktu dicatat tidak sah': (d, t) => { t('makan').dibuat = -1; },
      'catatan bukan teks': (d, t) => { t('makan').catatan = 7; },
      'akun tanpa nama': (d) => { d.akun[0].nama = '  '; },
      'saldo awal bukan bilangan bulat': (d) => { d.akun[0].saldoAwal = 1.5; },
      'kategori dengan tipe tak dikenal': (d) => { d.kategori[0].tipe = 'lain'; },
      'bukan data aplikasi ini': (d) => { d.aplikasi = 'lain'; },
      'versi yang lebih baru': (d) => { d.versi = 2; }
    };
    for (const [nama, ubah] of Object.entries(kasus)) {
      assert.equal(periksa(ubah).ok, false, nama + ' seharusnya ditolak');
    }
    assert.equal(periksa(() => {}).ok, true);
  });

  test('akun yang kalah oleh tanda hapus tetapi masih dipakai hidup lagi dengan isi aslinya, di perangkat mana pun', () => {
    // Laptop menghapus akun Dompet tepat saat HP mengirim transaksi yang memakainya.
    // Di awan lalu ada: isi Dompet, tanda hapusnya, dan transaksi itu.
    const s = siapkanSkenario();
    const denganDompet = D.tambahAkun(s.data, { nama: 'Dompet', jenis: 'tunai', saldoAwal: 150000 }, NANTI);
    const dompet = denganDompet.akun.id;
    const hp = pasti(D.tambahTransaksi(structuredClone(denganDompet.data), {
      tanggal: '2026-11-08', tipe: 'keluar', jumlah: 5000, akunId: dompet,
      kategoriId: kategori(denganDompet.data, 'Lainnya', 'keluar').id
    }, NANTI + 500));
    const laptop = pasti(D.hapusAkun(structuredClone(denganDompet.data), dompet, NANTI + 1000));
    assert.equal(D.cariAkun(laptop, dompet), null, 'laptop sudah tidak menyimpan isi Dompet');

    const diAwan = structuredClone(hp);
    diAwan.terhapus.akun[dompet] = NANTI + 1000;
    const awan = longgar(diAwan);

    const hasil = [gabung(laptop, awan), gabung(hp, awan), gabung(KOSONG, awan)];
    for (const g of hasil) {
      assert.deepStrictEqual(D.cariAkun(g, dompet), {
        id: dompet, nama: 'Dompet', jenis: 'tunai', saldoAwal: 150000, diubah: NANTI + 1001
      });
      assert.equal(D.tandaHapus(g, 'akun', dompet), null);
      assert.equal(g.transaksi.length, 6);
      assert.equal(D.sidikData(g), D.sidikData(hasil[0]), 'semua perangkat sampai pada data yang sama');
      harusSah(g);
    }
  });

  test('kategori yang kalah oleh tanda hapus tetapi masih dipakai hidup lagi dengan nama aslinya', () => {
    const { data, tunai } = siapkanSkenario();
    const hiburan = kategori(data, 'Hiburan', 'keluar').id;
    const hp = pasti(D.tambahTransaksi(structuredClone(data), {
      tanggal: '2026-11-08', tipe: 'keluar', jumlah: 35000, akunId: tunai, kategoriId: hiburan
    }, NANTI));
    const laptop = pasti(D.hapusKategori(structuredClone(data), hiburan, NANTI + 1000));
    const diAwan = structuredClone(hp);
    diAwan.terhapus.kategori[hiburan] = NANTI + 1000;
    const g = gabung(laptop, longgar(diAwan));
    assert.deepStrictEqual(D.cariKategori(g, hiburan), { id: hiburan, nama: 'Hiburan', tipe: 'keluar', diubah: NANTI + 1001 });
    assert.equal(g.kategori.length, 15);
    harusSah(g);
  });

  test('transaksi yang isinya ada bersama tanda hapusnya: yang lebih baru yang berlaku', () => {
    const { data, id } = siapkanSkenario();

    const dihapusBelakangan = structuredClone(data);
    dihapusBelakangan.terhapus.transaksi[id.makan] = NANTI;
    const g1 = gabung(KOSONG, longgar(dihapusBelakangan));
    assert.equal(D.cariTransaksi(g1, id.makan), null);
    assert.equal(D.tandaHapus(g1, 'transaksi', id.makan), NANTI);
    assert.equal(D.hitungSaldo(g1).total, 7400000 + 25000);
    harusSah(g1);

    const diubahBelakangan = structuredClone(data);
    diubahBelakangan.transaksi.find((t) => t.id === id.makan).diubah = NANTI + 1;
    diubahBelakangan.terhapus.transaksi[id.makan] = NANTI;
    const g2 = gabung(KOSONG, longgar(diubahBelakangan));
    assert.ok(D.cariTransaksi(g2, id.makan));
    assert.equal(D.tandaHapus(g2, 'transaksi', id.makan), null);
    assert.equal(D.hitungSaldo(g2).total, 7400000);
    harusSah(g2);
  });

  test('isi akun yang sudah tidak ada di mana pun diganti akun pengganti, yang kalah begitu isi aslinya datang', () => {
    const { data, tunai } = siapkanSkenario();
    const tanpaTunai = structuredClone(data);
    tanpaTunai.akun = tanpaTunai.akun.filter((a) => a.id !== tunai);

    const perangkatBaru = gabung(KOSONG, longgar(tanpaTunai));
    assert.equal(D.cariAkun(perangkatBaru, tunai).nama, 'Akun terhapus');
    assert.equal(perangkatBaru.transaksi.length, 5, 'tidak ada transaksi yang dibuang');
    harusSah(perangkatBaru);

    // Perangkat yang masih menyimpan isi aslinya menang, dari arah mana pun digabung.
    assert.equal(D.cariAkun(gabung(data, perangkatBaru), tunai).nama, 'Tunai');
    assert.equal(D.sidikData(gabung(data, perangkatBaru)), D.sidikData(data));
    assert.equal(D.sidikData(gabung(perangkatBaru, data)), D.sidikData(data));
  });

  test('awan tanpa satu akun pun tidak bisa berdiri sendiri, tetapi tetap bisa digabung dengan data perangkat', () => {
    const { data, id } = siapkanSkenario();
    const hanyaTanda = structuredClone(KOSONG);
    hanyaTanda.terhapus.transaksi[id.belanja] = NANTI;
    const awan = longgar(hanyaTanda);
    assert.equal(D.gabungData(KOSONG, awan).ok, false);
    const g = gabung(data, awan);
    assert.equal(D.cariTransaksi(g, id.belanja), null);
    assert.equal(g.akun.length, 3);
    harusSah(g);
  });
});

describe('Sinkron: perangkat yang baru pertama kali terhubung', () => {
  /** Laptop dengan data yang dibuat terpisah dari HP: semua id-nya berbeda. */
  function siapkanLaptop() {
    let laptop = D.buatDataAwal();
    const tunai = akun(laptop, 'Tunai').id;
    const bca = D.tambahAkun(laptop, { nama: 'BCA', jenis: 'bank', saldoAwal: 1000000 }, NANTI);
    laptop = bca.data;
    const parkir = D.tambahKategori(laptop, { nama: 'Parkir', tipe: 'keluar' }, NANTI);
    laptop = parkir.data;
    const makan = kategori(laptop, 'Makan & minum', 'keluar').id;
    const t1 = D.tambahTransaksi(laptop, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 10000, akunId: tunai, kategoriId: makan
    }, NANTI + 1);
    laptop = t1.data;
    const t2 = D.tambahTransaksi(laptop, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 3000, akunId: bca.akun.id, kategoriId: parkir.kategori.id
    }, NANTI + 2);
    laptop = t2.data;
    const t3 = D.tambahTransaksi(laptop, {
      tanggal: '2026-11-10', tipe: 'transfer', jumlah: 50000, akunId: bca.akun.id, akunTujuanId: tunai
    }, NANTI + 3);
    laptop = t3.data;
    return { laptop, tunai, makan, bca: bca.akun.id, parkir: parkir.kategori.id, t1: t1.transaksi.id, t2: t2.transaksi.id, t3: t3.transaksi.id };
  }

  test('mengenali data yang masih bawaan', () => {
    const baru = D.buatDataAwal();
    const tunai = akun(baru, 'Tunai').id;
    assert.equal(D.dataMasihBawaan(baru), true);
    assert.equal(D.dataMasihBawaan(JSON.parse(JSON.stringify(baru))), true);
    assert.equal(D.dataMasihBawaan(pasti(D.ubahAkun(baru, tunai, { saldoAwal: 1000 }))), false);
    assert.equal(D.dataMasihBawaan(pasti(D.ubahAkun(baru, tunai, { nama: 'Dompet' }))), false);
    assert.equal(D.dataMasihBawaan(pasti(D.tambahKategori(baru, { nama: 'Parkir', tipe: 'keluar' }))), false);
    assert.equal(D.dataMasihBawaan(pasti(D.hapusKategori(baru, kategori(baru, 'Hiburan', 'keluar').id))), false);
    assert.equal(D.dataMasihBawaan(pasti(D.tutupAjakanSaldoAwal(baru))), false);
    assert.equal(D.dataMasihBawaan(siapkanSkenario().data), false);
  });

  test('akun & kategori bernama sama disatukan; transaksi perangkat ini diarahkan ke akun di awan', () => {
    const awan = siapkanSkenario(); // data dari HP
    const l = siapkanLaptop();

    const hasil = D.gabungPertama(l.laptop, awan.data, NANTI + 10);
    assert.equal(hasil.ok, true, hasil.pesan);
    const g = hasil.data;
    assert.deepStrictEqual(hasil.ringkas, { akunDisatukan: 3, kategoriDisatukan: 15, transaksiDitambahkan: 3 });
    assert.deepStrictEqual(g.akun.map((x) => x.nama).sort(), ['BCA', 'E-wallet', 'Rekening bank', 'Tunai']);
    assert.equal(g.kategori.length, 16);
    assert.equal(g.transaksi.length, 8);

    assert.equal(D.cariTransaksi(g, l.t1).akunId, awan.tunai);
    assert.equal(D.cariTransaksi(g, l.t1).kategoriId, kategori(awan.data, 'Makan & minum', 'keluar').id);
    assert.equal(D.cariTransaksi(g, l.t3).akunTujuanId, awan.tunai);
    assert.equal(D.cariTransaksi(g, l.t2).akunId, l.bca, 'akun yang hanya ada di laptop tetap dipakai');
    assert.equal(D.cariTransaksi(g, l.t2).kategoriId, l.parkir);
    assert.equal(D.cariAkun(g, l.tunai), null, 'akun kembaran dari laptop tidak tersisa');

    assert.equal(saldo(g, 'Tunai'), 775000 - 10000 + 50000);
    assert.equal(saldo(g, 'BCA'), 1000000 - 3000 - 50000);
    assert.equal(D.hitungSaldo(g).total, 7400000 + 1000000 - 10000 - 3000);
    harusSah(g);

    // Sesudah itu kedua sisi memakai id yang sama: gabung biasa tidak mengubah apa pun.
    assert.equal(D.sidikData(gabung(awan.data, g)), D.sidikData(g));
    assert.equal(D.sidikData(gabung(g, awan.data)), D.sidikData(g));
  });

  test('"terakhir dipakai" ikut diarahkan ke id di awan', () => {
    const awan = siapkanSkenario();
    const l = siapkanLaptop();
    const g = pasti(D.gabungPertama(l.laptop, awan.data, NANTI + 10));
    assert.deepStrictEqual(g.pengaturan.terakhir.keluar, { akunId: l.bca, kategoriId: l.parkir });
    assert.deepStrictEqual(g.pengaturan.terakhir.transfer, { akunId: l.bca, akunTujuanId: awan.tunai });
  });

  test('saldo awal: yang di awan dipakai, kecuali di awan masih 0 dan di perangkat ini sudah diisi', () => {
    const awan = siapkanSkenario(); // Tunai 500.000, Rekening bank 2.000.000, E-wallet 0
    let laptop = D.buatDataAwal();
    laptop = pasti(D.aturSaldoAwal(laptop, {
      [akun(laptop, 'Tunai').id]: 999, [akun(laptop, 'E-wallet').id]: 40000
    }, NANTI));
    const g = pasti(D.gabungPertama(laptop, awan.data, NANTI + 5));
    assert.equal(g.akun.length, 3);
    assert.equal(D.cariAkun(g, awan.tunai).saldoAwal, 500000, 'keduanya terisi: pakai yang di awan');
    assert.equal(D.cariAkun(g, awan.ewallet).saldoAwal, 40000, 'di awan 0: pakai yang diisi di perangkat ini');
    assert.equal(D.cariAkun(g, awan.bank).saldoAwal, 2000000);
    harusSah(g);
  });

  test('huruf besar/kecil diabaikan; kategori disatukan hanya dalam jenis yang sama', () => {
    const awan = siapkanSkenario();
    let laptop = D.buatDataAwal();
    const tunaiL = akun(laptop, 'Tunai').id;
    laptop = pasti(D.ubahAkun(laptop, tunaiL, { nama: 'TUNAI' }, NANTI));
    const tK = D.tambahTransaksi(laptop, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 1000, akunId: tunaiL,
      kategoriId: kategori(laptop, 'Lainnya', 'keluar').id
    }, NANTI + 1);
    const tM = D.tambahTransaksi(tK.data, {
      tanggal: '2026-11-09', tipe: 'masuk', jumlah: 2000, akunId: tunaiL,
      kategoriId: kategori(laptop, 'Lainnya', 'masuk').id
    }, NANTI + 2);

    const g = pasti(D.gabungPertama(tM.data, awan.data, NANTI + 5));
    assert.equal(g.akun.length, 3);
    assert.equal(g.kategori.length, 15);
    assert.equal(D.cariAkun(g, awan.tunai).nama, 'Tunai', 'nama yang di awan yang dipakai');
    assert.equal(D.cariTransaksi(g, tK.transaksi.id).kategoriId, kategori(awan.data, 'Lainnya', 'keluar').id);
    assert.equal(D.cariTransaksi(g, tM.transaksi.id).kategoriId, kategori(awan.data, 'Lainnya', 'masuk').id);
    harusSah(g);
  });

  test('perangkat yang datanya salinan perangkat lain (id sama) digabung menurut id, tanpa kembaran', () => {
    const awan = siapkanSkenario();
    let laptop = structuredClone(awan.data); // mis. dulu dipulihkan dari backup HP
    laptop = pasti(D.ubahAkun(laptop, awan.tunai, { nama: 'Dompet' }, NANTI));
    laptop = pasti(D.tambahTransaksi(laptop, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 1000, akunId: awan.tunai,
      kategoriId: kategori(laptop, 'Lainnya', 'keluar').id
    }, NANTI + 1));

    const hasil = D.gabungPertama(laptop, awan.data, NANTI + 5);
    assert.equal(hasil.ok, true, hasil.pesan);
    assert.deepStrictEqual(hasil.ringkas, { akunDisatukan: 0, kategoriDisatukan: 0, transaksiDitambahkan: 1 });
    assert.equal(hasil.data.akun.length, 3);
    assert.equal(D.cariAkun(hasil.data, awan.tunai).nama, 'Dompet');
    assert.equal(hasil.data.transaksi.length, 6);
  });

  test('akun di awan yang id-nya sudah ada di perangkat ini tidak dipasangkan lewat nama', () => {
    const awan = siapkanSkenario();
    let laptop = structuredClone(awan.data);
    laptop = pasti(D.ubahAkun(laptop, awan.tunai, { nama: 'Dompet' }, NANTI)); // id sama dengan "Tunai" di awan
    const tunaiBaru = D.tambahAkun(laptop, { nama: 'Tunai', jenis: 'tunai' }, NANTI + 1); // nama sama, id baru
    const pindah = D.tambahTransaksi(tunaiBaru.data, {
      tanggal: '2026-11-09', tipe: 'transfer', jumlah: 1000, akunId: awan.tunai, akunTujuanId: tunaiBaru.akun.id
    }, NANTI + 2);

    const hasil = D.gabungPertama(pindah.data, awan.data, NANTI + 5);
    assert.equal(hasil.ok, true, hasil.pesan);
    const t = D.cariTransaksi(hasil.data, pindah.transaksi.id);
    assert.notEqual(t.akunId, t.akunTujuanId, 'tidak boleh jadi transfer ke akun sendiri');
    assert.equal(hasil.data.akun.length, 4);
    harusSah(hasil.data);
  });
});

describe('Sinkron: pulihkan dan hapus semua', () => {
  test('pulihkan saat tersinkron: isi menjadi sama dengan backup, dan perangkat lain ikut', () => {
    const { data: backup, id, tunai } = siapkanSkenario();
    let sekarangIni = structuredClone(backup);
    const makan = D.cariTransaksi(sekarangIni, id.makan);
    sekarangIni = pasti(D.ubahTransaksi(sekarangIni, id.makan, { ...makan, jumlah: 99000 }, NANTI));
    sekarangIni = pasti(D.hapusTransaksi(sekarangIni, id.belanja, NANTI + 1));
    const baru = D.tambahTransaksi(sekarangIni, {
      tanggal: '2026-11-09', tipe: 'keluar', jumlah: 1234, akunId: tunai,
      kategoriId: kategori(sekarangIni, 'Lainnya', 'keluar').id
    }, NANTI + 2);
    sekarangIni = baru.data;
    const perangkatLain = structuredClone(sekarangIni); // sudah memegang keadaan terbaru

    const pulih = pasti(D.siapkanPulihan(sekarangIni, backup, NANTI + 100));
    assert.equal(D.hitungSaldo(pulih).total, 7400000);
    assert.deepStrictEqual(
      pulih.transaksi.map((t) => t.id + ':' + t.jumlah).sort(),
      backup.transaksi.map((t) => t.id + ':' + t.jumlah).sort()
    );
    assert.ok(D.cariTransaksi(pulih, id.makan).diubah > NANTI + 2, 'rekaman yang berbeda diberi waktu ubah baru');
    assert.equal(D.cariTransaksi(pulih, id.gaji).diubah, D.cariTransaksi(backup, id.gaji).diubah, 'rekaman yang sama tidak disentuh');
    assert.ok(D.tandaHapus(pulih, 'transaksi', baru.transaksi.id) > NANTI + 2, 'yang tidak ada di backup diberi tanda hapus');
    assert.equal(D.tandaHapus(pulih, 'transaksi', id.belanja), null, 'yang dipulihkan tidak lagi bertanda hapus');
    harusSah(pulih);

    const g = gabung(perangkatLain, pulih);
    assert.equal(D.hitungSaldo(g).total, 7400000);
    assert.equal(D.cariTransaksi(g, id.makan).jumlah, 25000);
    assert.ok(D.cariTransaksi(g, id.belanja));
    assert.equal(D.cariTransaksi(g, baru.transaksi.id), null);
    assert.equal(D.sidikData(gabung(pulih, perangkatLain)), D.sidikData(g));
  });

  test('hapus semua saat tersinkron: kembali ke data awal dan yang lama terhapus di perangkat lain', () => {
    const { data, tunai } = siapkanSkenario();
    const perangkatLain = structuredClone(data);

    const kosong = pasti(D.kosongkanSemua(data, NANTI));
    assert.equal(kosong.transaksi.length, 0);
    assert.deepStrictEqual(kosong.akun.map((a) => [a.nama, a.saldoAwal]), [['Tunai', 0], ['Rekening bank', 0], ['E-wallet', 0]]);
    assert.equal(kosong.kategori.length, 15);
    assert.ok(data.transaksi.every((t) => D.tandaHapus(kosong, 'transaksi', t.id) >= NANTI));
    assert.ok(data.akun.every((a) => D.tandaHapus(kosong, 'akun', a.id) >= NANTI));
    assert.ok(data.kategori.every((k) => D.tandaHapus(kosong, 'kategori', k.id) >= NANTI));
    harusSah(kosong);

    const g = gabung(perangkatLain, kosong);
    assert.equal(g.transaksi.length, 0);
    assert.equal(D.hitungSaldo(g).total, 0);
    assert.deepStrictEqual(g.akun.map((a) => a.nama), ['Tunai', 'Rekening bank', 'E-wallet']);
    assert.equal(g.kategori.length, 15);
    assert.deepStrictEqual(
      [g.akun, g.kategori, g.transaksi, g.terhapus],
      [kosong.akun, kosong.kategori, kosong.transaksi, kosong.terhapus]
    );
    // Penanda "saldo awal sudah diatur" tidak pernah mundur lewat sinkron: cukup satu
    // perangkat pernah mengaturnya. Akibatnya ajakan "Atur saldo awal" tidak muncul lagi
    // di perangkat lain setelah hapus semua; saldo awal tetap bisa diatur di Pengaturan.
    assert.equal(kosong.pengaturan.saldoAwalDiatur, false);
    assert.equal(g.pengaturan.saldoAwalDiatur, true);

    // Transaksi yang dicatat di perangkat lain SETELAH itu tidak ikut terhapus, akunnya ikut kembali.
    const telat = D.tambahTransaksi(perangkatLain, {
      tanggal: '2026-11-12', tipe: 'keluar', jumlah: 7000, akunId: tunai,
      kategoriId: kategori(perangkatLain, 'Lainnya', 'keluar').id
    }, NANTI + 50);
    const g2 = gabung(telat.data, kosong);
    assert.deepStrictEqual(g2.transaksi.map((t) => t.id), [telat.transaksi.id]);
    assert.ok(D.cariAkun(g2, tunai));
    harusSah(g2);
  });
});

describe('Sinkron: salinan pengaman', () => {
  test('salinan pengaman disimpan apa adanya di kunci tersendiri', () => {
    const { data } = siapkanSkenario();
    const storage = new PenyimpananPalsu();
    D.simpanData(storage, data);
    const waktu = new Date(2026, 10, 12, 9, 5, 7).getTime();

    const pertama = D.simpanCadangan(storage, data, waktu);
    assert.equal(pertama.ok, true);
    assert.equal(pertama.kunci, 'keuangan-harian:v1:cadangan:2026-11-12T09-05-07');
    assert.deepStrictEqual(JSON.parse(storage.getItem(pertama.kunci)), data);
    assert.equal(D.bacaBackup(storage.getItem(pertama.kunci)).ok, true, 'bisa dipulihkan seperti file backup');

    const kedua = D.simpanCadangan(storage, D.buatDataAwal(), waktu); // detik yang sama
    assert.notEqual(kedua.kunci, pertama.kunci);
    assert.deepStrictEqual(D.daftarCadangan(storage), [pertama.kunci, kedua.kunci]);
    assert.deepStrictEqual(JSON.parse(storage.getItem(pertama.kunci)), data, 'salinan pertama tidak tertimpa');
    assert.deepStrictEqual(D.daftarSalinanRusak(storage), [], 'bukan salinan data rusak');
  });

  test('hapus salinan pengaman hanya untuk kuncinya sendiri', () => {
    const { data } = siapkanSkenario();
    const storage = new PenyimpananPalsu();
    D.simpanData(storage, data);
    const c = D.simpanCadangan(storage, data, 1000);
    assert.equal(D.hapusCadangan(storage, D.KUNCI_PENYIMPANAN).ok, false);
    assert.equal(D.hapusCadangan(storage, 'keuangan-harian:v1:rusak:x').ok, false);
    assert.notEqual(storage.getItem(D.KUNCI_PENYIMPANAN), null, 'data utama tetap ada');
    assert.equal(D.hapusCadangan(storage, c.kunci).ok, true);
    assert.deepStrictEqual(D.daftarCadangan(storage), []);
  });

  test('penyimpanan penuh: salinan gagal dibuat dengan pesan jelas, data utama tidak tersentuh', () => {
    const { data } = siapkanSkenario();
    const teks = JSON.stringify(data);
    const storage = new PenyimpananPalsu(D.KUNCI_PENYIMPANAN.length + teks.length + 200); // tidak muat dua salinan
    assert.equal(D.simpanData(storage, data).ok, true);
    const hasil = D.simpanCadangan(storage, data, 1000);
    assert.equal(hasil.ok, false);
    assert.match(hasil.pesan, /penuh/);
    assert.equal(storage.getItem(D.KUNCI_PENYIMPANAN), teks);
    assert.deepStrictEqual(D.daftarCadangan(storage), []);
  });

  test('hapus semua data dengan data pengganti: salinan dibuang, pengganti itulah yang disimpan', () => {
    const penyimpanan = new PenyimpananPalsu();
    const { data } = siapkanSkenario();
    D.simpanData(penyimpanan, data);
    assert.equal(D.simpanCadangan(penyimpanan, data, NANTI).ok, true);

    // Di perangkat yang tersinkron: mulai dari data awal, tetapi dengan tanda hapus
    // untuk semua yang lama, supaya penghapusannya ikut sampai ke perangkat lain.
    const pengganti = D.kosongkanSemua(data, NANTI).data;
    const hasil = D.hapusSemuaData(penyimpanan, pengganti);
    assert.equal(hasil.ok, true);
    assert.equal(hasil.data, pengganti);
    assert.deepStrictEqual(D.daftarCadangan(penyimpanan), []);
    const dimuat = D.muatData(penyimpanan).data;
    assert.equal(D.sidikData(dimuat), D.sidikData(pengganti));
    assert.equal(Object.keys(dimuat.terhapus.transaksi).length, 5, 'tanda hapus ikut tersimpan');
    assert.equal(dimuat.transaksi.length, 0);
  });

  test('hapus semua data ikut membuang salinan pengaman', () => {
    const { data } = siapkanSkenario();
    const storage = new PenyimpananPalsu();
    D.simpanData(storage, data);
    D.simpanCadangan(storage, data, 1000);
    storage.setItem('kunci-aplikasi-lain', 'jangan disentuh');
    assert.equal(D.hapusSemuaData(storage).ok, true);
    assert.deepStrictEqual(D.daftarCadangan(storage), []);
    assert.equal(storage.getItem('kunci-aplikasi-lain'), 'jangan disentuh');
  });
});

describe('Sinkron: simulasi acak', () => {
  function pembangkitAcak(benih) {
    let a = benih >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Tiga perangkat yang sudah tersambung mengerjakan perubahan acak (tambah, ubah,
   * hapus, batalkan, kelola akun & kategori) dan sesekali sinkron lewat awan.
   * Jam tiap perangkat sengaja tidak sama.
   */
  function jalankan(benih, langkah) {
    const r = pembangkitAcak(benih);
    const pilih = (daftar) => daftar[Math.floor(r() * daftar.length)];
    const selisihJam = [0, -300000, 90000]; // perangkat 2 tertinggal 5 menit, perangkat 3 lebih cepat 1,5 menit
    const dasar = D.buatDataAwal();
    const perangkat = [0, 1, 2].map(() => ({ data: structuredClone(dasar), hapusTerakhir: null }));
    let awan = structuredClone(dasar);
    let jam = NANTI;
    let nomor = 0;
    const dibuat = new Set();
    const pernahDihapus = new Set();

    function sinkron(p) {
      const hasil = D.gabungData(p.data, awan);
      assert.equal(hasil.ok, true, 'benih ' + benih + ': ' + hasil.pesan);
      p.data = hasil.data;
      awan = structuredClone(hasil.data);
    }

    for (let i = 0; i < langkah; i++) {
      jam += 1 + Math.floor(r() * 60000);
      const nomorPerangkat = Math.floor(r() * 3);
      const p = perangkat[nomorPerangkat];
      const w = jam + selisihJam[nomorPerangkat];
      const x = r();
      let hasil = null;

      if (x < 0.30) {
        const tipe = pilih(['keluar', 'keluar', 'masuk', 'transfer']);
        const input = {
          tanggal: '2026-11-' + String(1 + Math.floor(r() * 28)).padStart(2, '0'),
          tipe: tipe, jumlah: 1000 * (1 + Math.floor(r() * 500)), akunId: pilih(p.data.akun).id
        };
        if (tipe === 'transfer') {
          const lain = p.data.akun.filter((a) => a.id !== input.akunId);
          if (!lain.length) continue;
          input.akunTujuanId = pilih(lain).id;
        } else {
          input.kategoriId = pilih(D.kategoriPerTipe(p.data, tipe)).id;
        }
        hasil = D.tambahTransaksi(p.data, input, w);
        assert.equal(hasil.ok, true, hasil.pesan);
        dibuat.add(hasil.transaksi.id);
      } else if (x < 0.42) {
        if (!p.data.transaksi.length) continue;
        const t = pilih(p.data.transaksi);
        hasil = D.ubahTransaksi(p.data, t.id, { ...t, jumlah: 1000 * (1 + Math.floor(r() * 500)) }, w);
      } else if (x < 0.52) {
        if (!p.data.transaksi.length) continue;
        const t = pilih(p.data.transaksi);
        hasil = D.hapusTransaksi(p.data, t.id, w);
        pernahDihapus.add(t.id);
        p.hapusTerakhir = { transaksi: hasil.transaksi, indeks: hasil.indeks };
      } else if (x < 0.56) {
        if (!p.hapusTerakhir) continue;
        hasil = D.kembalikanTransaksi(p.data, p.hapusTerakhir.transaksi, p.hapusTerakhir.indeks, w);
        p.hapusTerakhir = null;
      } else if (x < 0.62) {
        hasil = D.tambahAkun(p.data, { nama: 'Akun ' + (++nomor), jenis: pilih(D.JENIS_AKUN), saldoAwal: 1000 * Math.floor(r() * 100) }, w);
      } else if (x < 0.67) {
        const a = pilih(p.data.akun);
        hasil = D.ubahAkun(p.data, a.id, r() < 0.5 ? { nama: 'Akun ' + (++nomor) } : { saldoAwal: -1000 * Math.floor(r() * 100) }, w);
      } else if (x < 0.71) {
        hasil = D.hapusAkun(p.data, pilih(p.data.akun).id, w);
      } else if (x < 0.76) {
        hasil = D.tambahKategori(p.data, { nama: 'Kategori ' + (++nomor), tipe: pilih(['keluar', 'masuk']) }, w);
      } else if (x < 0.80) {
        hasil = D.ubahKategori(p.data, pilih(p.data.kategori).id, { nama: 'Kategori ' + (++nomor) }, w);
      } else if (x < 0.84) {
        hasil = D.hapusKategori(p.data, pilih(p.data.kategori).id, w);
      } else if (x < 0.86) {
        hasil = D.aturSaldoAwal(p.data, { [pilih(p.data.akun).id]: 1000 * Math.floor(r() * 1000) }, w);
      } else {
        sinkron(p);
        continue;
      }
      if (hasil && hasil.ok) p.data = hasil.data; // yang ditolak (mis. akun masih dipakai) dilewati
    }

    for (let putaran = 0; putaran < 2; putaran++) perangkat.forEach(sinkron);
    return { perangkat, awan, dibuat, pernahDihapus };
  }

  test('30 rangkaian acak: tiga perangkat selalu berakhir dengan data yang sama dan sah', () => {
    for (let benih = 1; benih <= 30; benih++) {
      const s = jalankan(benih, 250);
      const sidikAwan = D.sidikData(s.awan);
      s.perangkat.forEach((p, i) => {
        assert.equal(D.sidikData(p.data), sidikAwan, 'benih ' + benih + ': perangkat ' + (i + 1) + ' berbeda dari awan');
        harusSah(p.data);
        assert.ok(p.data.akun.length >= 1);
        assert.ok(D.kategoriPerTipe(p.data, 'keluar').length >= 1 && D.kategoriPerTipe(p.data, 'masuk').length >= 1);
      });
      const adaDiAkhir = new Set(s.awan.transaksi.map((t) => t.id));
      s.dibuat.forEach((id) => {
        if (!s.pernahDihapus.has(id)) assert.ok(adaDiAkhir.has(id), 'benih ' + benih + ': transaksi ' + id + ' hilang tanpa pernah dihapus');
      });
      // Sinkron sekali lagi tidak mengubah apa pun.
      s.perangkat.forEach((p) => {
        assert.equal(D.sidikData(gabung(p.data, s.awan)), sidikAwan);
      });
    }
  });
});
