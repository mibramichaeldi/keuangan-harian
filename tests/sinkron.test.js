'use strict';
/*
 * Tes untuk js/sinkron.js. Jalankan dari folder proyek:
 *   node --test
 * Tidak ada jaringan sungguhan: Google, Firebase Auth, dan Realtime Database
 * ditiru oleh tests/server-tiruan.js, termasuk aturan "hanya pemilik akun".
 */
process.env.TZ = 'Asia/Jakarta';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const D = require(path.join(__dirname, '..', 'js', 'data.js'));
const S = require(path.join(__dirname, '..', 'js', 'sinkron.js'));
const { ServerTiruan, tokenGoogle: buatTokenGoogle, salin, SEJAM } = require('./server-tiruan.js');

const KONFIG = {
  apiKey: 'KUNCI-UJI',
  authDomain: 'proyek-uji.firebaseapp.com',
  databaseURL: 'https://proyek-uji-default-rtdb.example.app',
  idKlienGoogle: 'klien-uji.apps.googleusercontent.com'
};
const ALAMAT = 'https://contoh.github.io/keuangan-harian/';
const AKUN_SAYA = { sub: '123', email: 'pemilik@contoh.test', nama: 'Saya Sendiri' };
const UID_SAYA = 'uid-123';
const T0 = 1800000000000; // lebih besar dari semua waktu sungguhan saat tes dijalankan

// ---------------------------------------------------------------------------
// Tiruan
// ---------------------------------------------------------------------------

class PenyimpananPalsu {
  constructor() { this.isi = new Map(); this.penuh = false; this.tolak = null; }
  get length() { return this.isi.size; }
  key(i) { const k = Array.from(this.isi.keys())[i]; return k === undefined ? null : k; }
  getItem(k) { return this.isi.has(k) ? this.isi.get(k) : null; }
  /** `penuh`: semua penulisan gagal. `tolak(kunci)`: hanya kunci tertentu yang gagal (hampir penuh). */
  setItem(k, v) {
    if (this.penuh || (this.tolak && this.tolak(k))) { const e = new Error('penuh'); e.name = 'QuotaExceededError'; throw e; }
    this.isi.set(k, String(v));
  }
  removeItem(k) { this.isi.delete(k); }
}

/** Server tiruan dengan konfigurasi dan jam untuk tes ini. */
class ServerUji extends ServerTiruan {
  constructor() {
    super({ konfig: KONFIG, emailDiizinkan: AKUN_SAYA.email, jam: T0 + 24 * SEJAM });
  }
}

const tokenGoogle = (akun, nonce, aud) => buatTokenGoogle(akun, nonce, aud || KONFIG.idKlienGoogle);

function pasti(hasil) {
  assert.equal(hasil.ok, true, 'seharusnya berhasil, tetapi: ' + hasil.pesan);
  return hasil.data;
}

/** Skenario wajib dari spesifikasi: saldo total 7.400.000 dengan 5 transaksi. */
function skenario() {
  let data = D.buatDataAwal();
  const id = {};
  const akun = (n) => data.akun.find((a) => a.nama === n).id;
  const kat = (n, t) => data.kategori.find((k) => k.nama === n && k.tipe === t).id;
  id.tunai = akun('Tunai');
  id.bank = akun('Rekening bank');
  id.ewallet = akun('E-wallet');
  let jam = T0;
  data = pasti(D.aturSaldoAwal(data, { [id.tunai]: 500000, [id.bank]: 2000000 }, jam));
  const catat = (nama, input) => {
    jam += 1000;
    const h = D.tambahTransaksi(data, { catatan: '', ...input }, jam);
    data = pasti(h);
    id[nama] = h.transaksi.id;
  };
  catat('gaji', { tanggal: '2026-11-01', tipe: 'masuk', jumlah: 5000000, akunId: id.bank, kategoriId: kat('Gaji', 'masuk'), catatan: 'Gaji November' });
  catat('makan', { tanggal: '2026-11-02', tipe: 'keluar', jumlah: 25000, akunId: id.tunai, kategoriId: kat('Makan & minum', 'keluar') });
  catat('tarik', { tanggal: '2026-11-03', tipe: 'transfer', jumlah: 300000, akunId: id.bank, akunTujuanId: id.tunai });
  catat('isi', { tanggal: '2026-11-03', tipe: 'transfer', jumlah: 100000, akunId: id.bank, akunTujuanId: id.ewallet });
  catat('belanja', { tanggal: '2026-11-04', tipe: 'keluar', jumlah: 75000, akunId: id.ewallet, kategoriId: kat('Belanja harian', 'keluar') });
  return { data, id };
}

/** Sebuah perangkat: penyimpanan sendiri, data sendiri, jam sendiri, tersambung ke server tiruan. */
function buatPerangkat(server, opsi = {}) {
  const penyimpanan = opsi.penyimpanan || new PenyimpananPalsu();
  let data = opsi.data || D.buatDataAwal();
  D.simpanData(penyimpanan, data);
  let nomorAcak = 0;
  const p = {
    penyimpanan,
    selisihJam: opsi.selisihJam || 0,
    jam: () => server.jam + p.selisihJam,
    get data() { return data; },
    ambilLokal: () => data,
    simpanLokal: (baru) => {
      const s = D.simpanData(penyimpanan, baru);
      if (s.ok) data = baru;
      return s;
    },
    /** Terapkan hasil fungsi data.js (tambah/ubah/hapus) seperti yang dilakukan aplikasi. */
    ubah(hasil) {
      assert.equal(hasil.ok, true, hasil.pesan);
      data = hasil.data;
      D.simpanData(penyimpanan, data);
      return hasil;
    },
    /** Meniru perjalanan ke Google dan kembali membawa #id_token=... */
    jawabanGoogle(akun = AKUN_SAYA, ubahan = {}) {
      const tujuan = new URL(p.sinkron.urlLogin());
      const isi = new URLSearchParams({
        state: tujuan.searchParams.get('state'),
        id_token: tokenGoogle(akun, tujuan.searchParams.get('nonce')),
        authuser: '0',
        prompt: 'consent'
      });
      Object.entries(ubahan).forEach(([k, v]) => { if (v === null) isi.delete(k); else isi.set(k, v); });
      return '#' + isi.toString();
    },
    masuk(akun) { return p.sinkron.selesaikanLogin(p.jawabanGoogle(akun)); },
    sinkronkan(tambahan) {
      return p.sinkron.sinkronkan({ ambilLokal: p.ambilLokal, simpanLokal: p.simpanLokal, ...tambahan });
    }
  };
  p.sinkron = S.buatSinkron({
    konfig: opsi.konfig || KONFIG,
    ambil: opsi.ambil || ((url, init) => server.fetch(url, init)),
    penyimpanan,
    alamatKembali: opsi.alamatKembali || ALAMAT,
    batasWaktu: opsi.batasWaktu,
    cabang: opsi.cabang,
    kini: p.jam,
    acak: () => 'acak-' + (opsi.nama || 'perangkat') + '-' + (++nomorAcak)
  });
  return p;
}

function transaksiBaru(perangkat, jumlah, nama) {
  const d = perangkat.data;
  return D.tambahTransaksi(d, {
    tanggal: '2026-11-10', tipe: 'keluar', jumlah, akunId: d.akun[0].id,
    kategoriId: D.kategoriPerTipe(d, 'keluar')[0].id, catatan: nama || ''
  }, perangkat.jam());
}

/** HP berisi skenario wajib dan laptop kosong, keduanya sudah masuk dan tersambung. */
async function duaPerangkatTersambung() {
  const server = new ServerUji();
  const s = skenario();
  const hp = buatPerangkat(server, { nama: 'hp', data: s.data });
  const laptop = buatPerangkat(server, { nama: 'laptop' });
  assert.equal((await hp.masuk()).ok, true);
  assert.equal((await hp.sinkronkan()).status, 'selesai');
  assert.equal((await laptop.masuk()).ok, true);
  assert.equal((await laptop.sinkronkan()).status, 'selesai');
  server.jam += 60000;
  return { server, hp, laptop, id: s.id };
}

/** Isi awan sebagai data utuh, seperti yang akan dilihat perangkat yang baru tersambung. */
const dataAwan = (server) => {
  const baca = S.bacaAwan(server.dataPengguna(UID_SAYA));
  assert.equal(baca.ok, true, baca.pesan);
  assert.ok(baca.data, 'isi awan harus bisa berdiri sendiri');
  return baca.data;
};

/**
 * Sinkronkan `p`, dengan sinkron penuh perangkat `lain` disisipkan tepat di antara
 * "p mengambil data awan" dan "kiriman p sampai di awan". `sesudahSela` (opsional)
 * dijalankan begitu sinkron sisipan itu selesai, sebelum kiriman p diproses.
 */
async function sinkronDisela(server, p, lain, sesudahSela) {
  let hLain = null;
  server.saat('PATCH', /\/v1\.json$/, async () => {
    hLain = await lain.sinkronkan();
    if (sesudahSela) sesudahSela();
  });
  const h = await p.sinkronkan();
  server.kait.length = 0;
  assert.ok(hLain, 'sinkron ini seharusnya mengirim sesuatu sehingga sempat disela');
  assert.equal(hLain.ok, true, 'sinkron sisipan gagal: ' + hLain.pesan);
  return h;
}

/** Awan harus persis memuat data perangkat ini: tidak ada lagi yang perlu dikirim. */
function awanHarusSama(server, perangkat, keterangan) {
  const baca = S.bacaAwan(server.dataPengguna(UID_SAYA));
  assert.equal(baca.ok, true, baca.pesan);
  assert.deepStrictEqual(S.selisih(baca.mentah, perangkat.data), {}, keterangan);
  assert.equal(D.sidikData(baca.data), D.sidikData(perangkat.data), keterangan);
}

// ---------------------------------------------------------------------------
// Cara memuat
// ---------------------------------------------------------------------------

test('konfig.js dan sinkron.js juga bisa dimuat sebagai script biasa di browser (tanpa module/require)', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const baca = (nama) => fs.readFileSync(path.join(__dirname, '..', 'js', nama), 'utf8');
  // Yang disediakan browser di luar bahasa JavaScript itu sendiri.
  const jendela = {
    URLSearchParams, TextDecoder, AbortController, atob, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto
  };
  jendela.window = jendela;
  vm.createContext(jendela);
  for (const nama of ['data.js', 'konfig.js', 'sinkron.js']) vm.runInContext(baca(nama), jendela);

  assert.equal(typeof jendela.KeuanganSinkron.buatSinkron, 'function');
  for (const isian of ['apiKey', 'authDomain', 'databaseURL', 'idKlienGoogle']) {
    assert.ok(jendela.KeuanganKonfig[isian], 'konfig.' + isian + ' terisi');
  }
  assert.equal(new URL(jendela.KeuanganKonfig.databaseURL).protocol, 'https:');
  assert.equal(JSON.stringify(jendela.KeuanganKonfig).includes('@'), false, 'tidak ada alamat email di konfigurasi');

  // Dengan konfigurasi sungguhan dan pembuat teks acak bawaan (crypto milik browser).
  const s = jendela.KeuanganSinkron.buatSinkron({
    konfig: jendela.KeuanganKonfig, ambil: () => {}, penyimpanan: new PenyimpananPalsu(),
    alamatKembali: 'https://contoh.github.io/keuangan-harian/'
  });
  assert.equal(s.tersedia(), true);
  const u = new URL(s.urlLogin());
  assert.match(u.searchParams.get('state'), /^[0-9a-f]{32}$/);
  assert.match(u.searchParams.get('nonce'), /^[0-9a-f]{32}$/);
  assert.notEqual(u.searchParams.get('state'), u.searchParams.get('nonce'));
  assert.equal(u.searchParams.get('client_id'), jendela.KeuanganKonfig.idKlienGoogle);

  // Isi token terbaca, termasuk nama dengan huruf di luar ASCII.
  const token = tokenGoogle({ sub: '1', email: 'a@contoh.test', nama: 'Séñor Ibra – 日本' }, 'n');
  assert.equal(jendela.KeuanganSinkron.isiToken(token).name, 'Séñor Ibra – 日本');
  assert.equal(S.isiToken(token).name, 'Séñor Ibra – 日本');
  assert.equal(S.isiToken('bukan token'), null);
  assert.equal(S.isiToken('a.b.c'), null);
});

// ---------------------------------------------------------------------------
// Bentuk data di awan
// ---------------------------------------------------------------------------

describe('Bentuk data di awan', () => {
  test('ke awan lalu kembali menghasilkan data yang sama', () => {
    const { data: awal, id } = skenario();
    let data = pasti(D.hapusTransaksi(awal, id.belanja, T0 + SEJAM));
    data = D.buatBackup(data, T0 + 2 * SEJAM).data;

    const pohon = S.keAwan(data);
    assert.deepStrictEqual(pohon.akun[id.tunai], { nama: 'Tunai', jenis: 'tunai', saldoAwal: 500000, diubah: T0 });
    assert.equal('kategoriId' in pohon.transaksi[id.tarik], false, 'isian null tidak dikirim');
    assert.equal('akunTujuanId' in pohon.transaksi[id.makan], false);
    assert.equal(pohon.transaksi[id.makan].catatan, '');
    assert.equal(pohon.terhapus.transaksi[id.belanja], T0 + SEJAM);
    assert.deepStrictEqual(pohon.info, { saldoAwalDiatur: true, backupTerakhir: T0 + 2 * SEJAM });
    assert.equal(JSON.stringify(pohon).includes('terakhir'), false, '"terakhir dipakai" tidak ikut ke awan');

    const kembali = D.periksaData(S.dariAwan(salin(pohon)));
    assert.equal(kembali.ok, true, kembali.pesan);
    assert.equal(D.sidikData(kembali.data), D.sidikData(data));
    assert.equal(D.hitungSaldo(kembali.data).total, 7475000);
  });

  test('awan kosong atau berisi sampah tidak membuat galat', () => {
    for (const pohon of [null, undefined, 'teks', 5, [], { akun: 'x', terhapus: 7, info: [] }]) {
      const d = S.dariAwan(pohon);
      assert.deepStrictEqual([d.akun, d.kategori, d.transaksi], [[], [], []]);
      assert.deepStrictEqual(d.terhapus, { akun: {}, kategori: {}, transaksi: {} });
      assert.equal(d.pengaturan.saldoAwalDiatur, false);
    }
  });

  test('selisih hanya memuat yang berbeda, dan null untuk yang dihapus', () => {
    const { data, id } = skenario();
    const awan = D.periksaData(S.dariAwan(salin(S.keAwan(data)))).data;
    assert.deepStrictEqual(S.selisih(awan, data), {}, 'sama persis: tidak ada yang dikirim');

    const makan = D.cariTransaksi(data, id.makan);
    let baru = pasti(D.ubahTransaksi(data, id.makan, { ...makan, jumlah: 30000 }, T0 + SEJAM));
    baru = pasti(D.hapusTransaksi(baru, id.belanja, T0 + SEJAM));
    const bca = D.tambahAkun(baru, { nama: 'BCA', jenis: 'bank' }, T0 + SEJAM);
    baru = D.buatBackup(bca.data, T0 + SEJAM).data;

    const ubah = S.selisih(awan, baru);
    assert.deepStrictEqual(Object.keys(ubah).sort(), [
      'akun/' + bca.akun.id, 'info/backupTerakhir', 'terhapus/transaksi/' + id.belanja,
      'transaksi/' + id.belanja, 'transaksi/' + id.makan
    ].sort());
    assert.equal(ubah['transaksi/' + id.belanja], null);
    assert.equal(ubah['transaksi/' + id.makan].jumlah, 30000);
    assert.equal(ubah['terhapus/transaksi/' + id.belanja], T0 + SEJAM);

    // "Batalkan" setelah tanda hapusnya sudah sampai di awan: tandanya ikut dibuang.
    const awan2 = D.periksaData(S.dariAwan(salin(S.keAwan(baru)))).data;
    const hapus = D.hapusTransaksi(data, id.belanja, T0 + SEJAM);
    const kembali = pasti(D.kembalikanTransaksi(hapus.data, hapus.transaksi, hapus.indeks, T0 + 2 * SEJAM));
    const ubah2 = S.selisih(awan2, pasti(D.gabungData(kembali, awan2)));
    assert.equal(ubah2['terhapus/transaksi/' + id.belanja], null);
    assert.equal(ubah2['transaksi/' + id.belanja].jumlah, 75000);
  });

  test('akun dan kategori yang dihapus: hanya tanda hapusnya yang dikirim, isinya tetap di awan', () => {
    const { data } = skenario();
    const bca = D.tambahAkun(data, { nama: 'BCA', jenis: 'bank', saldoAwal: 250000 }, T0 + SEJAM);
    const awan = S.bacaAwan(salin(S.keAwan(bca.data)));
    const hiburan = bca.data.kategori.find((k) => k.nama === 'Hiburan').id;

    let baru = pasti(D.hapusAkun(bca.data, bca.akun.id, T0 + 2 * SEJAM));
    baru = pasti(D.hapusKategori(baru, hiburan, T0 + 2 * SEJAM));
    const ubah = S.selisih(awan.mentah, baru);
    assert.deepStrictEqual(ubah, {
      ['terhapus/akun/' + bca.akun.id]: T0 + 2 * SEJAM,
      ['terhapus/kategori/' + hiburan]: T0 + 2 * SEJAM
    });

    // Sesudah tanda itu sampai, awan dibaca sebagai "sudah dihapus" dan tidak ada lagi yang perlu dikirim.
    const pohon = S.keAwan(bca.data);
    pohon.terhapus = { akun: { [bca.akun.id]: T0 + 2 * SEJAM }, kategori: { [hiburan]: T0 + 2 * SEJAM } };
    const sesudah = S.bacaAwan(salin(pohon));
    assert.equal(sesudah.mentah.akun.some((a) => a.id === bca.akun.id), true, 'isinya masih tersimpan');
    assert.equal(D.cariAkun(sesudah.data, bca.akun.id), null, 'tetapi sudah tidak berlaku');
    assert.equal(D.cariKategori(sesudah.data, hiburan), null);
    assert.equal(D.sidikData(sesudah.data), D.sidikData(baru));
    assert.deepStrictEqual(S.selisih(sesudah.mentah, baru), {});
  });

  test('bacaAwan: kosong, sah, tanggung, dan rusak dibedakan', () => {
    const { data, id } = skenario();
    for (const pohon of [null, {}, { info: { revisi: 4 } }]) {
      assert.deepStrictEqual(S.bacaAwan(pohon), { ok: true, kosong: true, mentah: null, data: null });
    }

    const sah = S.bacaAwan(salin(S.keAwan(data)));
    assert.deepStrictEqual([sah.ok, sah.kosong], [true, false]);
    assert.equal(D.sidikData(sah.data), D.sidikData(data));
    assert.equal(D.periksaData(sah.data).ok, true);

    // Tanggung: akun Tunai (masih dipakai) tidak ada isinya. Tetap terbaca; sebagai data
    // utuh akunnya diganti akun pengganti dan tidak ada transaksi yang dibuang.
    const tanggung = S.keAwan(data);
    delete tanggung.akun[id.tunai];
    const t = S.bacaAwan(salin(tanggung));
    assert.deepStrictEqual([t.ok, t.kosong], [true, false]);
    assert.equal(t.mentah.akun.length, 2);
    assert.equal(D.cariAkun(t.data, id.tunai).nama, 'Akun terhapus');
    assert.equal(t.data.transaksi.length, 5);

    // Hanya tanda hapus, tanpa satu akun pun: terbaca, tetapi tidak bisa berdiri sendiri.
    const hanyaTanda = S.bacaAwan({ terhapus: { transaksi: { [id.makan]: T0 } } });
    assert.deepStrictEqual([hanyaTanda.ok, hanyaTanda.kosong, hanyaTanda.data], [true, false, null]);

    // Rusak: isi sebuah rekaman tidak sah.
    const rusak = S.keAwan(data);
    rusak.transaksi[id.makan].jumlah = -5;
    const r = S.bacaAwan(salin(rusak));
    assert.equal(r.ok, false);
    assert.match(r.pesan, /jumlah/);
  });

  test('sidik pendek: sama untuk teks yang sama, beda untuk teks yang beda', () => {
    const { data, id } = skenario();
    const a = S.hashTeks(D.sidikData(data));
    assert.equal(a, S.hashTeks(D.sidikData(salin(data))));
    const makan = D.cariTransaksi(data, id.makan);
    const b = S.hashTeks(D.sidikData(pasti(D.ubahTransaksi(data, id.makan, { ...makan, jumlah: 25001 }, T0 + SEJAM))));
    assert.notEqual(a, b);
    assert.ok(a.length < 40);
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('Masuk dengan Google', () => {
  test('alamat login memuat semua yang diminta Google, dan menyimpan pencocoknya', () => {
    const hp = buatPerangkat(new ServerUji(), { nama: 'hp' });
    assert.equal(hp.sinkron.tersedia(), true);
    assert.equal(hp.sinkron.sesi(), null);

    const u = new URL(hp.sinkron.urlLogin());
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('client_id'), KONFIG.idKlienGoogle);
    assert.equal(u.searchParams.get('redirect_uri'), ALAMAT);
    assert.equal(u.searchParams.get('response_type'), 'id_token');
    assert.equal(u.searchParams.get('scope'), 'openid email profile');
    assert.equal(u.searchParams.get('prompt'), 'select_account');
    assert.ok(u.searchParams.get('state') && u.searchParams.get('nonce'));
    assert.notEqual(u.searchParams.get('state'), u.searchParams.get('nonce'));

    const tersimpan = JSON.parse(hp.penyimpanan.getItem(S.KUNCI_LOGIN));
    assert.equal(tersimpan.state, u.searchParams.get('state'));
    assert.equal(tersimpan.nonce, u.searchParams.get('nonce'));
  });

  test('mengenali jawaban Google di alamat, tanpa tertukar dengan rute aplikasi', () => {
    const hp = buatPerangkat(new ServerUji());
    for (const hash of ['#state=x&id_token=a.b.c', '#id_token=a.b.c&state=x&authuser=0', '#error=access_denied&state=x']) {
      assert.equal(hp.sinkron.adaJawabanLogin(hash), true, hash);
    }
    for (const hash of ['', '#', '#/', '#/riwayat', '#/riwayat?bulan=2026-11', '#/catat', '#/ubah/trx_1', '#id_token=a.b.c', '#state=x', '#/x?id_token=a&state=b', '#/x&id_token=a&state=b', null, undefined]) {
      assert.equal(hp.sinkron.adaJawabanLogin(hash), false, String(hash));
    }
  });

  test('masuk berhasil: sesi tersimpan, token tidak pernah ikut ditampilkan', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp' });
    const hasil = await hp.masuk();
    assert.equal(hasil.ok, true, hasil.pesan);
    assert.deepStrictEqual(hasil.sesi, {
      uid: UID_SAYA, email: 'pemilik@contoh.test', nama: 'Saya Sendiri', masukPada: server.jam,
      sinkronTerakhir: null, terhubung: false, perluMasukLagi: false
    });
    assert.deepStrictEqual(hp.sinkron.sesi(), hasil.sesi);
    assert.equal(/token/i.test(JSON.stringify(hp.sinkron.sesi())), false);
    assert.equal(hp.penyimpanan.getItem(S.KUNCI_LOGIN), null, 'pencocok sekali pakai sudah dibuang');
    assert.equal(hp.penyimpanan.getItem(D.KUNCI_PENYIMPANAN).includes('fb-'), false, 'sesi tidak bercampur dengan data keuangan');
    assert.equal(D.buatBackup(hp.data, 1).teks.includes('segar-'), false, 'sesi tidak ikut ke backup');
  });

  test('jawaban yang tidak cocok dengan permintaan ditolak', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp' });

    let hasil = await hp.sinkron.selesaikanLogin(hp.jawabanGoogle(AKUN_SAYA, { state: 'state-orang-lain' }));
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'login']);

    // nonce di dalam token bukan yang kita minta (token hasil curian atau ulangan)
    const tujuan = new URL(hp.sinkron.urlLogin());
    hasil = await hp.sinkron.selesaikanLogin('#' + new URLSearchParams({
      state: tujuan.searchParams.get('state'), id_token: tokenGoogle(AKUN_SAYA, 'nonce-lain')
    }));
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'login']);

    // tanpa permintaan sama sekali (mis. alamat lama dibuka lagi)
    hasil = await hp.sinkron.selesaikanLogin('#state=x&id_token=' + tokenGoogle(AKUN_SAYA, 'n'));
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'login']);

    // jawaban datang terlalu lama
    const telat = hp.jawabanGoogle();
    server.jam += 31 * 60 * 1000;
    hasil = await hp.sinkron.selesaikanLogin(telat);
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'login']);

    assert.equal(hp.sinkron.sesi(), null);
    assert.equal(server.catatan.filter((c) => c.host === 'identitytoolkit.googleapis.com').length, 0, 'yang tidak cocok tidak pernah dikirim ke Firebase');

    // jawaban yang sama tidak bisa dipakai dua kali
    const sekali = hp.jawabanGoogle();
    assert.equal((await hp.sinkron.selesaikanLogin(sekali)).ok, true);
    const ulang = await hp.sinkron.selesaikanLogin(sekali);
    assert.deepStrictEqual([ulang.ok, ulang.jenis], [false, 'login']);
    assert.equal(hp.sinkron.sesi().uid, UID_SAYA, 'sesi yang sah tidak terganggu oleh ulangan itu');
    assert.equal(server.catatan.filter((c) => c.host === 'identitytoolkit.googleapis.com').length, 1);

    // jawaban yang datang 25 menit kemudian (mis. verifikasi 2 langkah yang lama) masih diterima
    hp.sinkron.keluar();
    const lambat = hp.jawabanGoogle();
    server.jam += 25 * 60 * 1000;
    hasil = await hp.sinkron.selesaikanLogin(lambat);
    assert.equal(hasil.ok, true, hasil.pesan);
  });

  test('browser menolak menyimpan: login tidak dimulai, atau gagal dengan pesan jelas', async () => {
    const hp = buatPerangkat(new ServerUji(), { nama: 'hp' });
    hp.penyimpanan.penuh = true;
    assert.equal(hp.sinkron.urlLogin(), null);

    // Penyimpanan baru penuh ketika jawaban Google sudah di tangan: sesi tidak bisa disimpan.
    hp.penyimpanan.penuh = false;
    const jawaban = hp.jawabanGoogle();
    hp.penyimpanan.penuh = true;
    const hasil = await hp.sinkron.selesaikanLogin(jawaban);
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'simpan']);
    assert.equal(hp.sinkron.sesi(), null);
  });

  test('masuk dengan akun Google lain: perangkat dianggap belum tersambung ke akun itu', async () => {
    const { hp } = await duaPerangkatTersambung();
    assert.equal(hp.sinkron.sesi().terhubung, true);
    const hasil = await hp.masuk({ sub: '999', email: 'orang-lain@contoh.test', nama: 'Orang Lain' });
    assert.equal(hasil.ok, true, hasil.pesan);
    assert.deepStrictEqual(
      [hasil.sesi.uid, hasil.sesi.email, hasil.sesi.terhubung, hasil.sesi.sinkronTerakhir],
      ['uid-999', 'orang-lain@contoh.test', false, null]);
  });

  test('batal di halaman Google, ditolak Firebase, atau jaringan putus: pesannya jelas dan tidak ada sesi', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp' });

    let hasil = await hp.sinkron.selesaikanLogin(hp.jawabanGoogle(AKUN_SAYA, { id_token: null, error: 'access_denied' }));
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'batal']);
    assert.match(hasil.pesan, /dibatalkan/);

    // token untuk aplikasi lain (aud berbeda): Firebase menolak
    const tujuan = new URL(hp.sinkron.urlLogin());
    hasil = await hp.sinkron.selesaikanLogin('#' + new URLSearchParams({
      state: tujuan.searchParams.get('state'),
      id_token: tokenGoogle(AKUN_SAYA, tujuan.searchParams.get('nonce'), 'klien-lain.apps.googleusercontent.com')
    }));
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'login']);
    assert.match(hasil.pesan, /INVALID_IDP_RESPONSE/);

    const jawaban = hp.jawabanGoogle();
    server.putus = true;
    hasil = await hp.sinkron.selesaikanLogin(jawaban);
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'jaringan']);
    assert.equal(hp.sinkron.sesi(), null);
  });

  test('fitur mati kalau konfigurasi kosong atau aplikasi dibuka sebagai file', async () => {
    const server = new ServerUji();
    assert.equal(buatPerangkat(server, { konfig: { ...KONFIG, apiKey: '' } }).sinkron.tersedia(), false);
    assert.equal(buatPerangkat(server, { konfig: {} }).sinkron.tersedia(), false);
    const berkas = buatPerangkat(server, { alamatKembali: 'file:///F:/aplikasi/' });
    assert.equal(berkas.sinkron.tersedia(), false);
    assert.equal((await berkas.sinkronkan()).ok, false);
    assert.equal(server.catatan.length, 0);
  });

  test('keluar: sesi dihapus, data di perangkat dan di awan tetap', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    const sebelum = D.sidikData(hp.data);
    const awan = JSON.stringify(server.pohon);
    hp.sinkron.keluar();
    assert.equal(hp.sinkron.sesi(), null);
    assert.equal(hp.penyimpanan.getItem(S.KUNCI_SESI), null);
    assert.equal(D.sidikData(D.muatData(hp.penyimpanan).data), sebelum);
    assert.equal(JSON.stringify(server.pohon), awan);
    const hasil = await hp.sinkronkan();
    assert.deepStrictEqual([hasil.ok, hasil.jenis], [false, 'sesi']);
  });
});

// ---------------------------------------------------------------------------
// Sinkron
// ---------------------------------------------------------------------------

describe('Sinkron pertama kali', () => {
  test('perangkat pertama mengunggah datanya; perangkat kedua yang masih kosong langsung memakainya', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    assert.equal((await hp.masuk()).ok, true);
    const h1 = await hp.sinkronkan();
    assert.deepStrictEqual([h1.ok, h1.status, h1.pertama, h1.berubahLokal, h1.cadangan], [true, 'selesai', 'unggah', false, null]);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
    assert.equal(server.dataPengguna(UID_SAYA).info.revisi, 1);
    assert.equal(hp.sinkron.sesi().terhubung, true);
    assert.equal(hp.sinkron.sesi().sinkronTerakhir, server.jam);

    const laptop = buatPerangkat(server, { nama: 'laptop' });
    await laptop.masuk();
    const h2 = await laptop.sinkronkan();
    assert.deepStrictEqual([h2.status, h2.pertama, h2.berubahLokal, h2.terkirim, h2.cadangan], ['selesai', 'pakaiAwan', true, 0, null]);
    assert.equal(D.sidikData(laptop.data), D.sidikData(hp.data));
    assert.equal(D.hitungSaldo(laptop.data).total, 7400000);
    assert.equal(D.sidikData(D.muatData(laptop.penyimpanan).data), D.sidikData(hp.data), 'tersimpan di perangkat');
    assert.deepStrictEqual(D.daftarCadangan(laptop.penyimpanan), [], 'data bawaan tidak perlu salinan pengaman');
    assert.equal(server.dataPengguna(UID_SAYA).info.revisi, 1, 'awan tidak ditulis ulang');
  });

  test('perangkat kedua yang sudah punya data: ditanya dulu, lalu digabung dan salinan pengaman disimpan', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    await hp.masuk();
    await hp.sinkronkan();

    const laptop = buatPerangkat(server, { nama: 'laptop' });
    const bca = laptop.ubah(D.tambahAkun(laptop.data, { nama: 'BCA', jenis: 'bank', saldoAwal: 1000000 }, laptop.jam())).akun;
    laptop.ubah(transaksiBaru(laptop, 10000, 'makan di laptop')); // memakai "Tunai" & "Makan & minum" milik laptop
    laptop.ubah(D.tambahTransaksi(laptop.data, {
      tanggal: '2026-11-10', tipe: 'transfer', jumlah: 50000, akunId: bca.id, akunTujuanId: laptop.data.akun[0].id
    }, laptop.jam()));
    const sidikLaptop = D.sidikData(laptop.data);
    const awanSebelum = JSON.stringify(server.pohon);
    await laptop.masuk();

    const tanya = await laptop.sinkronkan();
    assert.deepStrictEqual([tanya.ok, tanya.status], [true, 'perlu-pilihan']);
    assert.deepStrictEqual([tanya.lokal.transaksi, tanya.awan.transaksi, tanya.awan.akun], [2, 5, 3]);
    assert.equal(D.sidikData(laptop.data), sidikLaptop, 'belum ada yang diubah di perangkat');
    assert.equal(JSON.stringify(server.pohon), awanSebelum, 'belum ada yang diubah di awan');
    assert.equal(laptop.sinkron.sesi().terhubung, false);

    const h = await laptop.sinkronkan({ caraPertama: 'gabung' });
    assert.deepStrictEqual([h.ok, h.status, h.pertama, h.berubahLokal], [true, 'selesai', 'gabung', true]);
    assert.deepStrictEqual(h.ringkas, { akunDisatukan: 3, kategoriDisatukan: 15, transaksiDitambahkan: 2 });
    assert.deepStrictEqual(D.daftarCadangan(laptop.penyimpanan), [h.cadangan]);
    assert.equal(D.sidikData(JSON.parse(laptop.penyimpanan.getItem(h.cadangan))), sidikLaptop, 'salinan = data laptop sebelum digabung');
    assert.equal(laptop.data.transaksi.length, 7);
    assert.equal(laptop.data.akun.length, 4);
    assert.equal(D.hitungSaldo(laptop.data).total, 7400000 + 1000000 - 10000);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(laptop.data));

    server.jam += 60000;
    const h3 = await hp.sinkronkan();
    assert.deepStrictEqual([h3.status, h3.berubahLokal, h3.pertama], ['selesai', true, null]);
    assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data), 'HP menerima tambahan dari laptop');

    // Sesudah tersambung, laptop tidak ditanya lagi.
    laptop.ubah(transaksiBaru(laptop, 5000));
    assert.equal((await laptop.sinkronkan()).pertama, null);
  });

  test('"Pakai data dari Google": data perangkat diganti, yang lama ada di salinan pengaman', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    await hp.masuk();
    await hp.sinkronkan();

    const laptop = buatPerangkat(server, { nama: 'laptop' });
    laptop.ubah(transaksiBaru(laptop, 123456, 'data uji lama'));
    const sidikLaptop = D.sidikData(laptop.data);
    await laptop.masuk();
    const h = await laptop.sinkronkan({ caraPertama: 'pakaiAwan' });
    assert.deepStrictEqual([h.status, h.pertama, h.berubahLokal, h.terkirim], ['selesai', 'pakaiAwan', true, 0]);
    assert.equal(D.sidikData(laptop.data), D.sidikData(hp.data));
    assert.equal(laptop.data.transaksi.some((t) => t.jumlah === 123456), false);
    assert.equal(D.sidikData(JSON.parse(laptop.penyimpanan.getItem(h.cadangan))), sidikLaptop);
    assert.equal(D.bacaBackup(laptop.penyimpanan.getItem(h.cadangan)).ok, true, 'salinan bisa dipulihkan seperti backup');
  });

  test('salinan pengaman gagal dibuat: sambungan pertama dibatalkan, tidak ada yang berubah', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    await hp.masuk();
    await hp.sinkronkan();
    const laptop = buatPerangkat(server, { nama: 'laptop' });
    laptop.ubah(transaksiBaru(laptop, 123456));
    const sidikLaptop = D.sidikData(laptop.data);
    const awanSebelum = JSON.stringify(server.pohon);
    await laptop.masuk();

    // Penyimpanan hampir penuh: salinan pengaman (satu salinan data lagi) tidak muat,
    // padahal menyimpan hasil gabungannya sendiri masih bisa. Tanpa salinan, data
    // perangkat tidak boleh diganti maupun dicampur.
    laptop.penyimpanan.tolak = (kunci) => kunci.startsWith(D.AWALAN_CADANGAN);
    for (const cara of ['gabung', 'pakaiAwan']) {
      const h = await laptop.sinkronkan({ caraPertama: cara });
      assert.deepStrictEqual([h.ok, h.jenis], [false, 'simpan'], cara);
      assert.match(h.pesan, /salinan pengaman/);
      assert.equal(D.sidikData(laptop.data), sidikLaptop, cara);
      assert.equal(D.sidikData(D.muatData(laptop.penyimpanan).data), sidikLaptop, cara);
      assert.equal(JSON.stringify(server.pohon), awanSebelum, cara);
      assert.equal(laptop.sinkron.sesi().terhubung, false, cara);
    }

    laptop.penyimpanan.tolak = null;
    const h = await laptop.sinkronkan({ caraPertama: 'gabung' });
    assert.equal(h.status, 'selesai');
    assert.deepStrictEqual(D.daftarCadangan(laptop.penyimpanan), [h.cadangan]);
  });

  test('hasil gabungan yang tidak sah tidak disimpan dan tidak dikirim', async () => {
    const { server, hp, id } = await duaPerangkatTersambung();
    hp.ubah(transaksiBaru(hp, 9000));
    const sebelum = D.sidikData(hp.data);

    // Tiap rekaman di awan sah bila dilihat sendiri-sendiri, tetapi gabungannya tidak:
    // transaksi pengeluaran itu menunjuk kategori yang di perangkat ini berjenis pemasukan.
    const gaji = hp.data.kategori.find((k) => k.nama === 'Gaji').id;
    const pohon = server.pohon.pengguna[UID_SAYA].v1;
    pohon.transaksi[id.makan].kategoriId = gaji;
    pohon.transaksi[id.makan].diubah = server.jam + SEJAM;
    delete pohon.kategori[gaji];
    pohon.info.revisi += 1;
    const awan = JSON.stringify(server.pohon);
    assert.equal(S.bacaAwan(salin(pohon)).ok, true, 'lolos pemeriksaan per rekaman');

    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'data']);
    assert.match(h.pesan, /tidak bisa digabung/);
    assert.equal(D.sidikData(hp.data), sebelum);
    assert.equal(D.sidikData(D.muatData(hp.penyimpanan).data), sebelum);
    assert.equal(JSON.stringify(server.pohon), awan);
  });

  test('cabang data terpisah (mis. "uji" di localhost) tidak menyentuh data sungguhan', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    await hp.masuk();
    await hp.sinkronkan();
    const sungguhan = JSON.stringify(server.dataPengguna(UID_SAYA));

    const percobaan = buatPerangkat(server, { nama: 'percobaan', cabang: 'uji' });
    percobaan.ubah(transaksiBaru(percobaan, 1234, 'coba-coba'));
    await percobaan.masuk();
    const h = await percobaan.sinkronkan();
    assert.deepStrictEqual([h.status, h.pertama], ['selesai', 'unggah'], 'cabang uji masih kosong, jadi tidak ada yang ditanyakan');
    assert.equal(JSON.stringify(server.dataPengguna(UID_SAYA)), sungguhan);
    assert.equal(Object.keys(server.dataPengguna(UID_SAYA, 'uji').transaksi).length, 1);
    assert.equal(percobaan.data.transaksi.length, 1, 'data sungguhan tidak ikut masuk ke perangkat percobaan');

    // Nama cabang yang tidak wajar diabaikan: kembali ke cabang bawaan.
    const aneh = buatPerangkat(server, { nama: 'aneh', cabang: '../v1' });
    await aneh.masuk();
    server.catatan.length = 0;
    assert.equal((await aneh.sinkronkan()).status, 'selesai');
    assert.deepStrictEqual(server.catatan.map((c) => c.jalur), ['/pengguna/' + UID_SAYA + '/v1.json']);
    assert.equal(aneh.data.transaksi.length, 5);
  });

  test('sambungan pertama terputus saat mengirim: sinkron berikutnya melanjutkan tanpa bertanya lagi', async () => {
    const server = new ServerUji();
    const hp = buatPerangkat(server, { nama: 'hp', data: skenario().data });
    await hp.masuk();
    await hp.sinkronkan();
    const laptop = buatPerangkat(server, { nama: 'laptop' });
    laptop.ubah(transaksiBaru(laptop, 10000, 'makan di laptop'));
    await laptop.masuk();

    server.saat('PATCH', /\/v1\.json$/, () => { throw new TypeError('fetch failed'); });
    const h1 = await laptop.sinkronkan({ caraPertama: 'gabung' });
    assert.deepStrictEqual([h1.ok, h1.jenis, h1.tersimpanLokal, h1.pertama], [false, 'jaringan', true, 'gabung']);
    assert.equal(laptop.data.transaksi.length, 6, 'gabungan sudah tersimpan di laptop');
    assert.equal(laptop.sinkron.sesi().terhubung, true, 'laptop sudah dianggap tersambung');
    assert.deepStrictEqual(D.daftarCadangan(laptop.penyimpanan), [h1.cadangan]);

    const h2 = await laptop.sinkronkan(); // tanpa jawaban "gabung" lagi
    assert.deepStrictEqual([h2.status, h2.pertama, h2.cadangan], ['selesai', null, null]);
    assert.equal(D.daftarCadangan(laptop.penyimpanan).length, 1, 'tidak membuat salinan pengaman kedua');
    assert.equal(laptop.data.transaksi.length, 6, 'tidak ada transaksi kembar');
    assert.equal(laptop.data.akun.length, 3, 'tidak ada akun kembar');
    awanHarusSama(server, laptop);
  });
});

describe('Sinkron sehari-hari', () => {
  test('perubahan mengalir dua arah, dan hanya yang berubah yang dikirim', async () => {
    const { server, hp, laptop, id } = await duaPerangkatTersambung();

    const baru = hp.ubah(transaksiBaru(hp, 20000, 'kopi')).transaksi;
    server.catatan.length = 0;
    let h = await hp.sinkronkan();
    assert.deepStrictEqual([h.status, h.terkirim, h.berubahLokal], ['selesai', 1, false]);
    assert.deepStrictEqual(Object.keys(server.patchTerakhir).sort(), ['info/revisi', 'transaksi/' + baru.id].sort());
    assert.equal(server.catatan.filter((c) => c.metode === 'PATCH').length, 1);

    h = await laptop.sinkronkan();
    assert.deepStrictEqual([h.berubahLokal, h.terkirim], [true, 0]);
    assert.equal(D.cariTransaksi(laptop.data, baru.id).catatan, 'kopi');

    // Laptop mengubah satu transaksi dan menghapus satu lagi.
    server.jam += 60000;
    const makan = D.cariTransaksi(laptop.data, id.makan);
    laptop.ubah(D.ubahTransaksi(laptop.data, id.makan, { ...makan, jumlah: 30000 }, laptop.jam()));
    laptop.ubah(D.hapusTransaksi(laptop.data, id.belanja, laptop.jam()));
    h = await laptop.sinkronkan();
    assert.equal(h.terkirim, 3); // transaksi diubah, transaksi dihapus, tanda hapusnya
    const pohon = server.dataPengguna(UID_SAYA);
    assert.equal(pohon.transaksi[id.belanja], undefined, 'isi transaksi yang dihapus tidak tersisa di awan');
    assert.equal(typeof pohon.terhapus.transaksi[id.belanja], 'number');

    h = await hp.sinkronkan();
    assert.equal(h.berubahLokal, true);
    assert.equal(D.cariTransaksi(hp.data, id.makan).jumlah, 30000);
    assert.equal(D.cariTransaksi(hp.data, id.belanja), null);
    assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
    assert.equal(D.hitungSaldo(hp.data).total, 7400000 - 20000 - 5000 + 75000);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });

  test('tanpa perubahan di mana pun, sinkron hanya menanyakan nomor revisi', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    await hp.sinkronkan();
    server.jam += 5000;
    server.catatan.length = 0;
    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.status, h.tanpaPerubahan, h.terkirim, h.berubahLokal], [true, 'selesai', true, 0, false]);
    assert.deepStrictEqual(server.catatan.map((c) => c.metode + ' ' + c.jalur), ['GET /pengguna/' + UID_SAYA + '/v1/info/revisi.json']);
    assert.equal(hp.sinkron.sesi().sinkronTerakhir, server.jam);

    // "paksa" selalu mengambil seluruh data
    server.catatan.length = 0;
    assert.equal((await hp.sinkronkan({ paksa: true })).tanpaPerubahan, false);
    assert.equal(server.catatan[0].jalur, '/pengguna/' + UID_SAYA + '/v1.json');
  });

  test('selama aplikasi terbuka, mencatat tidak membuat seluruh data diunduh ulang', async () => {
    const { server, hp, laptop, id } = await duaPerangkatTersambung();
    const lihat = () => server.catatan.splice(0).map((c) => c.metode + ' ' + c.jalur.replace('/pengguna/' + UID_SAYA + '/v1', ''));
    const HEMAT = ['GET /info/revisi.json', 'PATCH .json', 'GET /info/revisi.json'];
    lihat();

    // Tambah.
    const kopi = hp.ubah(transaksiBaru(hp, 20000, 'kopi')).transaksi;
    let h = await hp.sinkronkan();
    assert.deepStrictEqual([h.status, h.terkirim, lihat()], ['selesai', 1, HEMAT]);
    awanHarusSama(server, hp);

    // Ubah.
    server.jam += 1000;
    hp.ubah(D.ubahTransaksi(hp.data, kopi.id, { ...kopi, jumlah: 22000 }, hp.jam()));
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.terkirim, lihat()], [1, HEMAT]);
    awanHarusSama(server, hp);

    // Hapus transaksi dan tambah akun: isi transaksi dibuang, tanda hapusnya dan akun baru dikirim.
    server.jam += 1000;
    hp.ubah(D.hapusTransaksi(hp.data, id.belanja, hp.jam()));
    const dompet = hp.ubah(D.tambahAkun(hp.data, { nama: 'Dompet', jenis: 'tunai' }, hp.jam())).akun;
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.terkirim, lihat()], [3, HEMAT]);
    awanHarusSama(server, hp);

    // Hapus akun itu: hanya tanda hapusnya yang dikirim.
    server.jam += 1000;
    hp.ubah(D.hapusAkun(hp.data, dompet.id, hp.jam()));
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.terkirim, lihat()], [1, HEMAT]);
    awanHarusSama(server, hp);

    // Sesudahnya tidak ada yang terkirim ulang.
    server.jam += 1000;
    hp.ubah(transaksiBaru(hp, 5000));
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.terkirim, lihat()], [1, HEMAT]);
    awanHarusSama(server, hp);

    // Begitu perangkat lain menulis, isi yang diingat tidak dipakai lagi: semuanya diambil ulang.
    const dariLaptop = laptop.ubah(transaksiBaru(laptop, 7000, 'dari laptop')).transaksi;
    assert.equal((await laptop.sinkronkan()).status, 'selesai');
    lihat();
    hp.ubah(transaksiBaru(hp, 6000));
    h = await hp.sinkronkan();
    assert.deepStrictEqual(lihat(), ['GET /info/revisi.json', 'GET .json', 'PATCH .json', 'GET /info/revisi.json']);
    assert.deepStrictEqual([h.berubahLokal, h.terkirim], [true, 1]);
    assert.ok(D.cariTransaksi(hp.data, dariLaptop.id));
    assert.equal(D.cariAkun(hp.data, dompet.id), null);
    awanHarusSama(server, hp);

    // Kiriman yang gagal diulang tanpa mengunduh ulang, dan tidak ada yang hilang.
    hp.ubah(transaksiBaru(hp, 8000));
    server.saat('PATCH', /\/v1\.json$/, () => { throw new TypeError('fetch failed'); });
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis, lihat()], [false, 'jaringan', ['GET /info/revisi.json', 'PATCH .json']]);
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.terkirim, lihat()], [1, HEMAT]);
    awanHarusSama(server, hp);
  });

  test('sesudah aplikasi dibuka ulang, sinkron pertama mengambil seluruh data, lalu berhemat lagi', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    const lihat = () => server.catatan.splice(0).map((c) => c.metode + ' ' + c.jalur.replace('/pengguna/' + UID_SAYA + '/v1', ''));

    // "Dibuka ulang": objek sinkron baru di atas penyimpanan yang sama. Sesinya masih ada,
    // tetapi isi awan yang diingat tidak.
    const dibuka = buatPerangkat(server, { nama: 'hp-dibuka-ulang', penyimpanan: hp.penyimpanan, data: hp.data });
    assert.equal(dibuka.sinkron.sesi().terhubung, true);
    lihat();

    assert.equal((await dibuka.sinkronkan()).tanpaPerubahan, true);
    assert.deepStrictEqual(lihat(), ['GET /info/revisi.json'], 'tidak ada perubahan: cukup menanyakan nomor revisi');

    dibuka.ubah(transaksiBaru(dibuka, 1000));
    server.saat('PATCH', /\/v1\.json$/, () => { throw new TypeError('fetch failed'); });
    assert.equal((await dibuka.sinkronkan()).jenis, 'jaringan');
    assert.deepStrictEqual(lihat(), ['GET .json', 'PATCH .json'], 'belum ada yang diingat: ambil seluruh data');
    assert.equal((await dibuka.sinkronkan()).terkirim, 1);
    assert.deepStrictEqual(lihat(), ['GET /info/revisi.json', 'PATCH .json', 'GET /info/revisi.json'], 'kiriman yang gagal diulang tanpa mengunduh lagi');

    dibuka.ubah(transaksiBaru(dibuka, 2000));
    assert.equal((await dibuka.sinkronkan()).terkirim, 1);
    assert.deepStrictEqual(lihat(), ['GET /info/revisi.json', 'PATCH .json', 'GET /info/revisi.json']);
    awanHarusSama(server, dibuka);
  });

  test('dua tab di perangkat yang sama: isi awan yang diingat tab lain tidak dipakai', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    const lihat = () => server.catatan.splice(0).map((c) => c.metode + ' ' + c.jalur.replace('/pengguna/' + UID_SAYA + '/v1', ''));
    // Tab kedua di browser yang sama: penyimpanan (data dan sesi login) sama, ingatan sendiri-sendiri.
    const tab2 = buatPerangkat(server, { nama: 'tab2', penyimpanan: hp.penyimpanan, data: hp.data });
    const muatUlang = (tab) => tab.ubah({ ok: true, data: D.muatData(hp.penyimpanan).data }); // seperti kejadian "storage"

    hp.ubah(transaksiBaru(hp, 1000, 'dari tab 1'));
    assert.equal((await hp.sinkronkan()).terkirim, 1);
    muatUlang(tab2);
    tab2.ubah(transaksiBaru(tab2, 2000, 'dari tab 2'));
    assert.equal((await tab2.sinkronkan()).terkirim, 1);

    // Tab 1 masih mengingat isi awan SEBELUM tab 2 menulis. Nomor revisi di sesi (milik
    // bersama) sudah maju, jadi ingatan tab 1 tidak boleh dipakai.
    muatUlang(hp);
    hp.ubah(transaksiBaru(hp, 3000, 'dari tab 1 lagi'));
    lihat();
    const h = await hp.sinkronkan();
    assert.deepStrictEqual(lihat(), ['GET .json', 'PATCH .json', 'GET /info/revisi.json']);
    assert.deepStrictEqual([h.status, h.terkirim], ['selesai', 1], 'hanya transaksi baru yang dikirim');
    assert.equal(hp.data.transaksi.length, 8);
    awanHarusSama(server, hp);
  });

  test('isi awan yang tanggung tidak membuat perangkat mana pun macet, dan pulih begitu ada yang menyimpan isi aslinya', async () => {
    const { server, hp, id } = await duaPerangkatTersambung();
    // Keadaan yang tidak bisa dibuat aplikasi ini sendiri (mis. data di Firebase diubah
    // dengan tangan): isi akun Tunai, yang masih dipakai transaksi, hilang dari awan.
    delete server.pohon.pengguna[UID_SAYA].v1.akun[id.tunai];
    server.pohon.pengguna[UID_SAYA].v1.info.revisi += 1;

    // Perangkat baru tetap bisa tersambung; akun yang hilang diganti akun pengganti.
    const tablet = buatPerangkat(server, { nama: 'tablet' });
    assert.equal((await tablet.masuk()).ok, true);
    const h = await tablet.sinkronkan();
    assert.deepStrictEqual([h.status, h.pertama], ['selesai', 'pakaiAwan']);
    assert.equal(D.cariAkun(tablet.data, id.tunai).nama, 'Akun terhapus');
    assert.equal(tablet.data.transaksi.length, 5, 'tidak ada transaksi yang hilang');

    // HP masih menyimpan isi aslinya: begitu HP sinkron, semuanya kembali benar.
    assert.equal((await hp.sinkronkan()).status, 'selesai');
    assert.equal((await tablet.sinkronkan()).status, 'selesai');
    for (const p of [hp, tablet]) {
      assert.deepStrictEqual([D.cariAkun(p.data, id.tunai).nama, D.cariAkun(p.data, id.tunai).saldoAwal], ['Tunai', 500000]);
      assert.equal(D.hitungSaldo(p.data).total, 7400000);
    }
    assert.equal(D.sidikData(hp.data), D.sidikData(tablet.data));
    awanHarusSama(server, hp);
  });

  test('catatan yang sama diubah di dua perangkat: perubahan terakhir menang di keduanya', async () => {
    const { server, hp, laptop, id } = await duaPerangkatTersambung();
    const makan = D.cariTransaksi(hp.data, id.makan);
    hp.ubah(D.ubahTransaksi(hp.data, id.makan, { ...makan, jumlah: 30000 }, hp.jam()));
    server.jam += 5000;
    laptop.ubah(D.ubahTransaksi(laptop.data, id.makan, { ...makan, jumlah: 45000 }, laptop.jam()));
    await hp.sinkronkan();
    await laptop.sinkronkan();
    await hp.sinkronkan();
    assert.equal(D.cariTransaksi(hp.data, id.makan).jumlah, 45000);
    assert.equal(D.cariTransaksi(laptop.data, id.makan).jumlah, 45000);
    assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
  });

  test('yang dicatat saat sinkron sedang berjalan tidak hilang', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    const dariLaptop = laptop.ubah(transaksiBaru(laptop, 11000, 'dari laptop')).transaksi;
    await laptop.sinkronkan();

    // Tepat saat data awan masih dalam perjalanan ke HP, pengguna mencatat transaksi di HP.
    let dariHp = null;
    server.saat('GET', /\/v1\.json$/, () => { dariHp = hp.ubah(transaksiBaru(hp, 22000, 'dicatat saat sinkron')).transaksi; });
    const h = await hp.sinkronkan();
    assert.equal(h.status, 'selesai');
    assert.ok(dariHp, 'kejadian sisipan dijalankan');
    assert.ok(D.cariTransaksi(hp.data, dariHp.id), 'transaksi yang baru dicatat tetap ada di HP');
    assert.ok(D.cariTransaksi(hp.data, dariLaptop.id), 'transaksi dari laptop sampai di HP');
    assert.ok(server.dataPengguna(UID_SAYA).transaksi[dariHp.id], 'dan ikut terkirim ke awan');
    assert.equal(D.sidikData(D.muatData(hp.penyimpanan).data), D.sidikData(hp.data));
  });

  test('perangkat lain menulis di sela-sela pengiriman: tidak ada yang terlewat', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    const h1 = hp.ubah(transaksiBaru(hp, 11000, 'dari hp')).transaksi;
    const l1 = laptop.ubah(transaksiBaru(laptop, 22000, 'dari laptop')).transaksi;

    // HP sudah mengambil data awan; sebelum kirimannya sampai, laptop lebih dulu sinkron penuh.
    server.catatan.length = 0;
    const h = await sinkronDisela(server, hp, laptop);
    assert.deepStrictEqual([h.status, h.berubahLokal, h.terkirim], ['selesai', true, 1]);
    assert.ok(server.dataPengguna(UID_SAYA).transaksi[h1.id] && server.dataPengguna(UID_SAYA).transaksi[l1.id], 'awan memuat keduanya');
    // HP melihat nomor revisi melompat, jadi langsung mengambil ulang dalam sinkron yang sama.
    assert.ok(D.cariTransaksi(hp.data, l1.id), 'HP langsung menerima transaksi laptop');
    assert.equal(server.catatan.filter((c) => c.jalur.endsWith('/v1.json') && c.metode === 'GET').length, 1, 'satu unduhan penuh saja: HP, saat mengulang');

    // Laptop belum tahu transaksi HP; tanpa perubahan lokal pun ia harus menyusul.
    assert.equal(D.cariTransaksi(laptop.data, h1.id), null);
    server.jam += 1000;
    assert.equal((await laptop.sinkronkan()).berubahLokal, true);
    assert.ok(D.cariTransaksi(laptop.data, h1.id));
    assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
    awanHarusSama(server, hp);

    // Sesudah itu semuanya tenang lagi.
    assert.equal((await hp.sinkronkan()).tanpaPerubahan, true);
    assert.equal((await laptop.sinkronkan()).tanpaPerubahan, true);
  });

  test('perangkat lain yang terus-menerus menulis tidak membuat sinkron berputar tanpa henti', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    hp.ubah(transaksiBaru(hp, 1000, 'dari hp'));
    // Tiap kali HP hendak mengirim, laptop lebih dulu mencatat dan mengirim sesuatu.
    let sela = 0;
    const selaLagi = async () => {
      sela++;
      if (sela < 10) server.saat('PATCH', /\/v1\.json$/, selaLagi); // batas supaya tes ini sendiri pasti berhenti
      laptop.ubah(transaksiBaru(laptop, 2000 + sela, 'dari laptop ' + sela));
      hp.ubah(transaksiBaru(hp, 3000 + sela, 'dari hp ' + sela));
      const kait = server.kait.splice(0);          // sinkron laptop sendiri tidak disela
      assert.equal((await laptop.sinkronkan()).status, 'selesai');
      server.kait.push(...kait);
    };
    server.saat('PATCH', /\/v1\.json$/, selaLagi);
    const h = await hp.sinkronkan();
    server.kait.length = 0;
    assert.equal(h.status, 'selesai');
    assert.equal(sela, 3, 'paling banyak tiga putaran dalam satu sinkron');

    // Tidak ada yang hilang: dua sinkron biasa sesudahnya menyamakan semuanya.
    await hp.sinkronkan();
    await laptop.sinkronkan();
    await hp.sinkronkan();
    assert.equal(hp.data.transaksi.length, 5 + 1 + 3 + 3);
    assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
    awanHarusSama(server, hp);
  });

  test('pengambilan ulang sesudah disela gagal: tetap dianggap selesai, dan sinkron berikutnya menyusul', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    const h1 = hp.ubah(transaksiBaru(hp, 11000, 'dari hp')).transaksi;
    const l1 = laptop.ubah(transaksiBaru(laptop, 22000, 'dari laptop')).transaksi;
    // Jaringan HP putus tepat ketika ia hendak mengambil ulang data awan.
    let dicoba = false;
    const h = await sinkronDisela(server, hp, laptop, () => {
      server.saat('GET', /\/v1\.json$/, () => { dicoba = true; throw new TypeError('fetch failed'); });
    });
    assert.deepStrictEqual([h.ok, h.status, h.terkirim], [true, 'selesai', 1]);
    assert.equal(dicoba, true, 'pengambilan ulang memang dicoba');
    assert.ok(server.dataPengguna(UID_SAYA).transaksi[h1.id], 'kiriman HP sendiri sudah sampai');
    assert.equal(D.cariTransaksi(hp.data, l1.id), null, 'yang dari laptop belum terambil');

    // Sinkron berikutnya wajib mengambil semuanya, walau HP tidak punya perubahan baru.
    assert.equal((await hp.sinkronkan()).berubahLokal, true);
    assert.ok(D.cariTransaksi(hp.data, l1.id));
  });

  test('akun dihapus di laptop tepat saat HP mengirim transaksi yang memakainya: akun itu hidup lagi, utuh', async () => {
    for (const hpSempatMemeriksa of [true, false]) {
      const { server, hp, laptop } = await duaPerangkatTersambung();
      const dompet = laptop.ubah(D.tambahAkun(laptop.data, { nama: 'Dompet', jenis: 'tunai', saldoAwal: 150000 }, laptop.jam())).akun;
      await laptop.sinkronkan();
      await hp.sinkronkan();
      server.jam += 60000;

      laptop.ubah(D.hapusAkun(laptop.data, dompet.id, laptop.jam())); // di laptop akun itu belum dipakai
      server.jam += 1000;
      const jajan = hp.ubah(D.tambahTransaksi(hp.data, {
        tanggal: '2026-11-10', tipe: 'keluar', jumlah: 20000, akunId: dompet.id,
        kategoriId: D.kategoriPerTipe(hp.data, 'keluar')[0].id, catatan: 'jajan'
      }, hp.jam())).transaksi;

      // Tanda hapus dari laptop sampai di awan di antara "HP mengambil" dan "HP mengirim".
      // Pada putaran kedua, jaringan HP putus tepat sesudah kirimannya sampai, jadi HP
      // tidak sempat memeriksa ulang dan awan dibiarkan tanggung.
      const h = await sinkronDisela(server, hp, laptop, hpSempatMemeriksa ? null : () => {
        server.saat('GET', /\/info\/revisi\.json$/, () => { throw new TypeError('fetch failed'); });
      });
      assert.equal(h.status, 'selesai', h.pesan);

      const pohon = server.dataPengguna(UID_SAYA);
      assert.ok(pohon.transaksi[jajan.id], 'transaksi HP ada di awan');
      assert.equal(pohon.akun[dompet.id].nama, 'Dompet', 'isi akun yang dihapus tidak pernah dibuang dari awan');
      if (!hpSempatMemeriksa) assert.equal(typeof pohon.terhapus.akun[dompet.id], 'number', 'awan masih tanggung');

      // Siapa pun yang sinkron berikutnya membereskannya; di sini laptop, yang sudah tidak menyimpan isi akun itu.
      server.jam += 1000;
      assert.equal((await laptop.sinkronkan()).status, 'selesai');
      assert.equal((await hp.sinkronkan()).status, 'selesai');
      assert.equal((await laptop.sinkronkan()).status, 'selesai');

      for (const p of [hp, laptop]) {
        const a = D.cariAkun(p.data, dompet.id);
        assert.deepStrictEqual([a.nama, a.jenis, a.saldoAwal], ['Dompet', 'tunai', 150000]);
        assert.ok(D.cariTransaksi(p.data, jajan.id));
        assert.equal(D.tandaHapus(p.data, 'akun', dompet.id), null);
        assert.equal(D.hitungSaldo(p.data).total, 7400000 + 150000 - 20000);
      }
      assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
      awanHarusSama(server, hp);
      assert.equal(server.dataPengguna(UID_SAYA).terhapus, undefined, 'tanda hapus yang kalah sudah dibuang dari awan');
    }
  });

  test('transaksi diubah di HP tepat saat laptop menghapusnya: yang terakhir yang berlaku, awan tidak menyimpan dua-duanya', async () => {
    for (const ubahBelakangan of [true, false]) {
      const { server, hp, laptop, id } = await duaPerangkatTersambung();
      const makan = D.cariTransaksi(hp.data, id.makan);
      if (ubahBelakangan) {
        laptop.ubah(D.hapusTransaksi(laptop.data, id.makan, laptop.jam()));
        server.jam += 1000;
        hp.ubah(D.ubahTransaksi(hp.data, id.makan, { ...makan, jumlah: 30000 }, hp.jam()));
      } else {
        hp.ubah(D.ubahTransaksi(hp.data, id.makan, { ...makan, jumlah: 30000 }, hp.jam()));
        server.jam += 1000;
        laptop.ubah(D.hapusTransaksi(laptop.data, id.makan, laptop.jam()));
      }
      assert.equal((await sinkronDisela(server, hp, laptop)).status, 'selesai');
      assert.equal((await laptop.sinkronkan()).status, 'selesai');

      const pohon = server.dataPengguna(UID_SAYA);
      const tanda = ((pohon.terhapus || {}).transaksi || {})[id.makan];
      if (ubahBelakangan) {
        assert.equal(D.cariTransaksi(hp.data, id.makan).jumlah, 30000);
        assert.equal(D.cariTransaksi(laptop.data, id.makan).jumlah, 30000, 'hidup lagi di laptop dengan isi yang baru');
        assert.equal(pohon.transaksi[id.makan].jumlah, 30000);
        assert.equal(tanda, undefined);
      } else {
        assert.equal(D.cariTransaksi(hp.data, id.makan), null, 'ikut terhapus di HP');
        assert.equal(D.cariTransaksi(laptop.data, id.makan), null);
        assert.equal(pohon.transaksi[id.makan], undefined);
        assert.equal(typeof tanda, 'number');
      }
      assert.equal(D.sidikData(hp.data), D.sidikData(laptop.data));
      awanHarusSama(server, hp);
    }
  });

  test('dua panggilan sinkron bersamaan dijalankan bergantian', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    const a = hp.ubah(transaksiBaru(hp, 1000, 'A')).transaksi;
    const p1 = hp.sinkronkan();
    assert.equal(hp.sinkron.sedangSinkron(), true);
    const b = hp.ubah(transaksiBaru(hp, 2000, 'B')).transaksi; // dicatat saat sinkron pertama masih jalan
    const p2 = hp.sinkronkan();
    const p3 = hp.sinkronkan();
    assert.equal(p2, p3, 'panggilan berikutnya menunggu di antrean yang sama');
    const [h1, h2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual([h1.ok, h2.ok], [true, true]);
    assert.equal(hp.sinkron.sedangSinkron(), false);
    const pohon = server.dataPengguna(UID_SAYA);
    assert.ok(pohon.transaksi[a.id] && pohon.transaksi[b.id]);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });
});

describe('Sinkron saat ada gangguan', () => {
  test('token yang habis diperpanjang sendiri', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    server.jam += 2 * SEJAM;
    hp.ubah(transaksiBaru(hp, 9000));
    server.catatan.length = 0;
    const h = await hp.sinkronkan();
    assert.equal(h.status, 'selesai');
    assert.equal(server.catatan[0].host, 'securetoken.googleapis.com');
    assert.equal(server.catatan.filter((c) => c.host === 'securetoken.googleapis.com').length, 1);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });

  test('jam perangkat mundur: server menolak token lama, token diperpanjang lalu diulang sekali', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    hp.selisihJam = -2 * SEJAM;  // jam HP dimundurkan setelah login
    server.jam += 1.5 * SEJAM;   // menurut server token sudah habis; menurut HP masih lama
    hp.ubah(transaksiBaru(hp, 9000));
    server.catatan.length = 0;
    const h = await hp.sinkronkan();
    assert.equal(h.status, 'selesai', h.pesan);
    assert.equal(server.catatan.filter((c) => c.host === 'securetoken.googleapis.com').length, 1);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });

  test('izin dicabut: sinkron berhenti dengan pesan jelas, data perangkat utuh; masuk lagi lalu lanjut tanpa ditanya', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    hp.ubah(transaksiBaru(hp, 9000));
    const sebelum = D.sidikData(hp.data);
    server.cabut(UID_SAYA);
    server.jam += 2 * SEJAM;

    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'sesi']);
    assert.match(h.pesan, /Masuk lagi/);
    assert.equal(D.sidikData(hp.data), sebelum);
    const sesi = hp.sinkron.sesi();
    assert.deepStrictEqual([sesi.perluMasukLagi, sesi.email, sesi.terhubung], [true, 'pemilik@contoh.test', true]);
    assert.equal(hp.penyimpanan.getItem(S.KUNCI_SESI).includes('segar-'), false, 'token lama dibuang');

    server.catatan.length = 0;
    assert.equal((await hp.sinkronkan()).jenis, 'sesi');
    assert.equal(server.catatan.length, 0, 'tidak mencoba lagi sebelum pengguna masuk');

    const tujuan = new URL(hp.sinkron.urlLogin());
    assert.equal(tujuan.searchParams.get('login_hint'), 'pemilik@contoh.test');
    assert.equal((await hp.masuk()).ok, true);
    const h2 = await hp.sinkronkan();
    assert.deepStrictEqual([h2.status, h2.pertama], ['selesai', null]);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });

  test('akun yang tidak diizinkan aturan database ditolak tanpa mengubah apa pun', async () => {
    const server = new ServerUji();
    const lain = buatPerangkat(server, { nama: 'lain', data: skenario().data });
    assert.equal((await lain.masuk({ sub: '999', email: 'orang-lain@contoh.test', nama: 'Orang Lain' })).ok, true);
    const sebelum = D.sidikData(lain.data);
    const h = await lain.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'izin']);
    assert.match(h.pesan, /orang-lain@contoh\.test/);
    assert.deepStrictEqual(server.pohon, {});
    assert.equal(D.sidikData(lain.data), sebelum);
    assert.equal(lain.sinkron.sesi().terhubung, false);
  });

  test('jaringan putus: data perangkat utuh dan sinkron berikutnya menuntaskan', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    const baru = hp.ubah(transaksiBaru(hp, 9000)).transaksi;
    const sebelum = D.sidikData(hp.data);

    server.putus = true;
    let h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'jaringan']);
    assert.equal(D.sidikData(hp.data), sebelum);
    server.putus = false;

    // Putus tepat saat mengirim, sesudah data awan diterima dan digabung.
    const dariLaptop = laptop.ubah(transaksiBaru(laptop, 7000)).transaksi;
    await laptop.sinkronkan();
    server.saat('PATCH', /\/v1\.json$/, () => { throw new TypeError('fetch failed'); });
    h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis, h.tersimpanLokal], [false, 'jaringan', true]);
    assert.ok(D.cariTransaksi(hp.data, dariLaptop.id), 'yang dari awan sudah tersimpan di perangkat');
    assert.equal(server.dataPengguna(UID_SAYA).transaksi[baru.id], undefined, 'kiriman belum sampai');

    h = await hp.sinkronkan();
    assert.equal(h.status, 'selesai');
    assert.ok(server.dataPengguna(UID_SAYA).transaksi[baru.id]);
    assert.equal(D.sidikData(dataAwan(server)), D.sidikData(hp.data));
  });

  test('server sedang sibuk (503, 500, 429): dianggap gangguan sementara, bukan sesi berakhir', async () => {
    const { server, hp } = await duaPerangkatTersambung();
    hp.ubah(transaksiBaru(hp, 9000));
    const sebelum = D.sidikData(hp.data);
    for (const status of [503, 500, 429]) {
      server.statusPaksa = status;
      const h = await hp.sinkronkan();
      assert.deepStrictEqual([h.ok, h.jenis], [false, 'jaringan'], 'status ' + status);
      assert.equal(D.sidikData(hp.data), sebelum);
    }
    assert.equal((await hp.sinkronkan()).status, 'selesai');

    // Sama halnya kalau yang sibuk adalah server yang memperpanjang token.
    server.jam += 2 * SEJAM;
    hp.ubah(transaksiBaru(hp, 8000));
    server.statusPaksa = 503;
    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'jaringan']);
    assert.equal(hp.sinkron.sesi().perluMasukLagi, false);
    assert.equal((await hp.sinkronkan()).status, 'selesai');
    awanHarusSama(server, hp);

    // Jawaban yang tidak dikenal dilaporkan apa adanya, tanpa mengubah apa pun.
    hp.ubah(transaksiBaru(hp, 7000));
    server.statusPaksa = 400;
    const aneh = await hp.sinkronkan();
    assert.deepStrictEqual([aneh.ok, aneh.jenis], [false, 'lain']);
    assert.match(aneh.pesan, /400/);
    assert.equal((await hp.sinkronkan()).status, 'selesai');
  });

  test('permintaan yang menggantung diputus sendiri dan tidak menahan sinkron berikutnya', async () => {
    const server = new ServerUji();
    let gantung = false;
    const hp = buatPerangkat(server, {
      nama: 'hp',
      data: skenario().data,
      batasWaktu: 40,
      ambil: (url, init) => {
        if (!gantung) return server.fetch(url, init);
        // Seperti fetch sungguhan di sinyal buruk: tidak pernah selesai, kecuali diputus.
        return new Promise((_, tolak) => {
          init.signal.addEventListener('abort', () => tolak(new DOMException('diputus', 'AbortError')));
        });
      }
    });
    assert.equal((await hp.masuk()).ok, true);
    gantung = true;
    let pewaktu;
    const h = await Promise.race([
      hp.sinkronkan(),
      new Promise((selesai) => { pewaktu = setTimeout(() => selesai('macet'), 3000); })
    ]);
    clearTimeout(pewaktu);
    assert.notEqual(h, 'macet', 'sinkron tidak boleh menunggu selamanya');
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'jaringan']);
    assert.equal(hp.sinkron.sedangSinkron(), false);
    gantung = false;
    assert.equal((await hp.sinkronkan()).status, 'selesai');
  });

  test('kesalahan tak terduga dijadikan hasil gagal biasa dan tidak membuat antrean macet', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    laptop.ubah(transaksiBaru(laptop, 7000));
    await laptop.sinkronkan();
    const sebelum = D.sidikData(hp.data);
    const h = await hp.sinkron.sinkronkan({
      ambilLokal: hp.ambilLokal,
      simpanLokal: () => { throw new Error('rusak di tengah'); }
    });
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'lain']);
    assert.match(h.pesan, /rusak di tengah/);
    assert.equal(D.sidikData(hp.data), sebelum);
    assert.equal(hp.sinkron.sedangSinkron(), false);
    assert.equal((await hp.sinkronkan()).status, 'selesai');
    awanHarusSama(server, hp);
  });

  test('data di awan tidak sah: tidak ada yang ditimpa, di perangkat maupun di awan', async () => {
    const { server, hp, id } = await duaPerangkatTersambung();
    hp.ubah(transaksiBaru(hp, 9000));
    const sebelum = D.sidikData(hp.data);
    server.pohon.pengguna[UID_SAYA].v1.transaksi[id.makan].jumlah = -5;
    server.pohon.pengguna[UID_SAYA].v1.info.revisi += 1; // seperti tulisan dari perangkat lain
    const awan = JSON.stringify(server.pohon);

    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'data']);
    assert.match(h.pesan, /tidak bisa dibaca/);
    assert.equal(D.sidikData(hp.data), sebelum);
    assert.equal(JSON.stringify(server.pohon), awan);
  });

  test('perangkat tidak bisa menyimpan hasil gabungan: awan tidak ikut diubah', async () => {
    const { server, hp, laptop } = await duaPerangkatTersambung();
    laptop.ubah(transaksiBaru(laptop, 7000));
    await laptop.sinkronkan();
    hp.ubah(transaksiBaru(hp, 9000));
    const sebelum = D.sidikData(hp.data);
    const awan = JSON.stringify(server.pohon);

    hp.penyimpanan.penuh = true;
    const h = await hp.sinkronkan();
    assert.deepStrictEqual([h.ok, h.jenis], [false, 'simpan']);
    assert.equal(D.sidikData(hp.data), sebelum);
    assert.equal(JSON.stringify(server.pohon), awan);
    hp.penyimpanan.penuh = false;
    assert.equal((await hp.sinkronkan()).status, 'selesai');
  });
});

// ---------------------------------------------------------------------------
// Simulasi acak lewat jaringan tiruan
// ---------------------------------------------------------------------------

describe('Simulasi acak lewat jaringan', () => {
  function pembangkitAcak(benih) {
    let a = benih >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function jalankan(benih, langkah) {
    const r = pembangkitAcak(benih);
    const pilih = (daftar) => daftar[Math.floor(r() * daftar.length)];
    const server = new ServerUji();
    const selisih = [0, -5 * 60000, 90000]; // jam tiap perangkat tidak sama
    const perangkat = [];
    for (let i = 0; i < 3; i++) {
      const p = buatPerangkat(server, { nama: 'p' + i, selisihJam: selisih[i], data: i === 0 ? skenario().data : undefined });
      assert.equal((await p.masuk()).ok, true);
      assert.equal((await p.sinkronkan()).status, 'selesai');
      perangkat.push(p);
    }
    let nomor = 0;
    let gagalJaringan = 0;
    let selaan = 0;
    const putus = () => { throw new TypeError('fetch failed'); };

    for (let i = 0; i < langkah; i++) {
      server.jam += 1 + Math.floor(r() * 60000);
      const p = pilih(perangkat);
      const d = p.data;
      const x = r();
      let hasil = null;
      if (x < 0.28) {
        const tipe = pilih(['keluar', 'keluar', 'masuk', 'transfer']);
        const input = {
          tanggal: '2026-11-' + String(1 + Math.floor(r() * 28)).padStart(2, '0'), tipe,
          jumlah: 1000 * (1 + Math.floor(r() * 500)), akunId: pilih(d.akun).id, catatan: ''
        };
        if (tipe === 'transfer') {
          const lain = d.akun.filter((a) => a.id !== input.akunId);
          if (!lain.length) continue;
          input.akunTujuanId = pilih(lain).id;
        } else {
          input.kategoriId = pilih(D.kategoriPerTipe(d, tipe)).id;
        }
        hasil = D.tambahTransaksi(d, input, p.jam());
      } else if (x < 0.40) {
        if (!d.transaksi.length) continue;
        const t = pilih(d.transaksi);
        hasil = D.ubahTransaksi(d, t.id, { ...t, jumlah: 1000 * (1 + Math.floor(r() * 500)) }, p.jam());
      } else if (x < 0.50) {
        if (!d.transaksi.length) continue;
        hasil = D.hapusTransaksi(d, pilih(d.transaksi).id, p.jam());
      } else if (x < 0.55) {
        hasil = D.tambahAkun(d, { nama: 'Akun ' + (++nomor), jenis: pilih(D.JENIS_AKUN), saldoAwal: 1000 * Math.floor(r() * 100) }, p.jam());
      } else if (x < 0.60) {
        hasil = D.ubahAkun(d, pilih(d.akun).id, r() < 0.5 ? { nama: 'Akun ' + (++nomor) } : { saldoAwal: -1000 * Math.floor(r() * 100) }, p.jam());
      } else if (x < 0.64) {
        hasil = D.hapusAkun(d, pilih(d.akun).id, p.jam());
      } else if (x < 0.68) {
        hasil = D.tambahKategori(d, { nama: 'Kategori ' + (++nomor), tipe: pilih(['keluar', 'masuk']) }, p.jam());
      } else if (x < 0.72) {
        hasil = D.ubahKategori(d, pilih(d.kategori).id, { nama: 'Kategori ' + (++nomor) }, p.jam());
      } else if (x < 0.75) {
        hasil = D.hapusKategori(d, pilih(d.kategori).id, p.jam());
      } else {
        // Sinkron. Kadang jaringan putus sama sekali, kadang putus tepat saat mengirim atau
        // tepat sesudahnya, dan kadang perangkat lain menyinkron persis di tengah-tengahnya
        // (sesudah perangkat ini mengambil data awan, sebelum kirimannya sampai).
        const gangguan = r();
        if (gangguan < 0.10) {
          server.putus = true;
        } else if (gangguan < 0.18) {
          server.saat('PATCH', /\/v1\.json$/, putus);
        } else if (gangguan < 0.24) {
          server.saat('GET', /\/info\/revisi\.json$/, putus);
        } else if (gangguan < 0.60) {
          const lain = pilih(perangkat.filter((q) => q !== p));
          const putusSesudahnya = r() < 0.3;
          server.saat('PATCH', /\/v1\.json$/, async () => {
            const hLain = await lain.sinkronkan();
            assert.equal(hLain.ok, true, 'benih ' + benih + ' (sinkron selaan): ' + hLain.pesan);
            selaan++;
            // Kadang perangkat ini lalu tidak sempat memeriksa ulang, jadi awan dibiarkan tanggung.
            if (putusSesudahnya) server.saat('GET', /\/info\/revisi\.json$/, putus);
          });
        }
        const h = await p.sinkronkan();
        server.putus = false;
        server.kait.length = 0;
        if (!h.ok) {
          assert.equal(h.jenis, 'jaringan', 'benih ' + benih + ': ' + h.pesan);
          gagalJaringan++;
        }
        continue;
      }
      if (hasil && hasil.ok && hasil.data !== d) p.ubah(hasil);
    }

    // Sesudah semua kesibukan itu: sinkron bergiliran sampai tidak ada lagi yang berubah.
    let putaranTenang = 0;
    for (;;) {
      putaranTenang++;
      let adaGerak = false;
      for (const p of perangkat) {
        const h = await p.sinkronkan();
        assert.equal(h.ok, true, 'benih ' + benih + ': ' + h.pesan);
        if (h.berubahLokal || h.terkirim > 0) adaGerak = true;
      }
      if (!adaGerak) break;
      assert.ok(putaranTenang < 6, 'benih ' + benih + ': perangkat tidak kunjung sama');
    }
    return { server, perangkat, gagalJaringan, selaan, putaranTenang };
  }

  test('20 rangkaian acak dengan jaringan putus dan sinkron yang saling menyela: tiga perangkat dan awan berakhir sama', async () => {
    let totalGangguan = 0;
    let totalSelaan = 0;
    let putaranTerbanyak = 0;
    for (let benih = 1; benih <= 20; benih++) {
      const { server, perangkat, gagalJaringan, selaan, putaranTenang } = await jalankan(benih, 260);
      totalGangguan += gagalJaringan;
      totalSelaan += selaan;
      putaranTerbanyak = Math.max(putaranTerbanyak, putaranTenang);
      const awan = dataAwan(server);
      const sidikAwan = D.sidikData(awan);
      perangkat.forEach((p, i) => {
        const siapa = 'benih ' + benih + ', perangkat ' + (i + 1);
        assert.equal(D.sidikData(p.data), sidikAwan, siapa + ': berbeda dari awan');
        assert.equal(D.sidikData(D.muatData(p.penyimpanan).data), sidikAwan, siapa + ': yang tersimpan berbeda');
        assert.equal(D.hitungSaldo(p.data).total, D.hitungSaldo(awan).total);
        assert.equal(D.periksaData(salin(p.data)).ok, true, siapa + ': data tidak sah');
        awanHarusSama(server, p, siapa);
        // Akun atau kategori "pengganti" hanya muncul kalau isi aslinya hilang dari semua tempat;
        // itu tidak boleh terjadi hanya karena sinkron saling menyela atau jaringan putus.
        assert.equal(p.data.akun.some((a) => a.nama === 'Akun terhapus'), false, siapa + ': ada akun pengganti');
        assert.equal(p.data.kategori.some((k) => k.nama === 'Kategori terhapus'), false, siapa + ': ada kategori pengganti');
      });
      // Di awan, transaksi yang sudah dihapus tidak boleh masih menyimpan isinya.
      const pohon = server.dataPengguna(UID_SAYA);
      for (const idTerhapus of Object.keys((pohon.terhapus && pohon.terhapus.transaksi) || {})) {
        assert.equal((pohon.transaksi || {})[idTerhapus], undefined, 'benih ' + benih + ': transaksi ' + idTerhapus + ' terhapus tetapi isinya masih ada');
      }
    }
    assert.ok(totalGangguan > 30, 'simulasi harus benar-benar mengalami gangguan jaringan (terjadi ' + totalGangguan + ' kali)');
    assert.ok(totalSelaan > 100, 'simulasi harus benar-benar mengalami sinkron yang saling menyela (terjadi ' + totalSelaan + ' kali)');
    assert.ok(putaranTerbanyak <= 3, 'perangkat seharusnya sama lagi dalam paling banyak 3 putaran (terjadi ' + putaranTerbanyak + ')');
  });
});
