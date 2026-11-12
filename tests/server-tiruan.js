'use strict';
/*
 * Server tiruan untuk tes: meniru layanan yang dipanggil js/sinkron.js, tanpa jaringan.
 *   - halaman login Google (hanya untuk uji lewat browser; lihat alamatKembaliGoogle)
 *   - identitytoolkit: menukar ID token Google menjadi sesi Firebase
 *   - securetoken: memperpanjang sesi
 *   - Realtime Database REST, dengan aturan: /pengguna/$uid hanya untuk
 *     auth.uid === $uid dan email yang diizinkan
 *
 * Dipakai oleh tests/sinkron.test.js dan oleh uji lewat browser. Ini bukan file tes:
 * `node --test` tidak menjalankannya.
 */

const SEJAM = 3600000;

const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const salin = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

/** ID token Google tiruan (tanda tangannya tidak diperiksa di sisi aplikasi). */
function tokenGoogle(akun, nonce, aud) {
  return b64url({ alg: 'RS256' }) + '.' + b64url({
    iss: 'https://accounts.google.com', aud: aud, sub: akun.sub,
    email: akun.email, email_verified: true, name: akun.nama, nonce: nonce
  }) + '.tanda-tangan';
}

function isiToken(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function ambilDi(pohon, jalur) {
  let x = pohon;
  for (const k of jalur) {
    if (x === null || typeof x !== 'object' || !Object.prototype.hasOwnProperty.call(x, k)) return null;
    x = x[k];
  }
  return x;
}

function hapusDi(pohon, jalur) {
  const rantai = [pohon];
  let x = pohon;
  for (let i = 0; i < jalur.length - 1; i++) {
    x = x[jalur[i]];
    if (x === null || typeof x !== 'object') return;
    rantai.push(x);
  }
  delete x[jalur[jalur.length - 1]];
  for (let i = rantai.length - 1; i > 0; i--) { // Realtime Database tidak menyimpan objek kosong
    if (Object.keys(rantai[i]).length) break;
    delete rantai[i - 1][jalur[i - 1]];
  }
}

function aturDi(pohon, jalur, nilai) {
  if (nilai !== null && typeof nilai === 'object' && nilai['.sv']) { // nilai yang dihitung server
    const lama = ambilDi(pohon, jalur);
    nilai = (typeof lama === 'number' ? lama : 0) + nilai['.sv'].increment;
  }
  if (nilai === null) { hapusDi(pohon, jalur); return; }
  let x = pohon;
  for (let i = 0; i < jalur.length - 1; i++) {
    if (x[jalur[i]] === null || typeof x[jalur[i]] !== 'object') x[jalur[i]] = {};
    x = x[jalur[i]];
  }
  x[jalur[jalur.length - 1]] = salin(nilai);
}

class ServerTiruan {
  /**
   * opsi: {
   *   konfig            { apiKey, authDomain, databaseURL, idKlienGoogle } yang dipakai aplikasi
   *   emailDiizinkan    satu-satunya email yang diizinkan aturan database
   *   jam               waktu server (ms); token berlaku satu jam sejak diterbitkan
   *   alamatTerdaftar?  daftar alamat kembali yang "terdaftar di Google" (bawaan: semua diterima)
   * }
   */
  constructor(opsi) {
    this.konfig = opsi.konfig;
    this.emailDiizinkan = opsi.emailDiizinkan;
    this.jam = opsi.jam;
    this.alamatTerdaftar = opsi.alamatTerdaftar || null;
    this.pohon = {};
    this.token = new Map();  // idToken -> { uid, email, habis }
    this.segar = new Map();  // refreshToken -> { uid, email }
    this.nomor = 0;
    this.catatan = [];       // tiap permintaan: { metode, host, jalur }
    this.patchTerakhir = null;
    this.putus = false;
    this.statusPaksa = 0;    // kalau diisi: permintaan berikutnya dijawab dengan status ini (sekali)
    this.kait = [];          // kejadian yang disisipkan sebelum permintaan tertentu dijawab
  }

  /** Jalankan `fn` satu kali, tepat sebelum permintaan berikutnya yang cocok dijawab. */
  saat(metode, pola, fn) { this.kait.push({ metode, pola, fn }); }

  dataPengguna(uid, cabang) { return ambilDi(this.pohon, ['pengguna', uid, cabang || 'v1']); }

  /** Cabut semua sesi seorang pengguna (seperti izin dicabut atau kata sandi diganti). */
  cabut(uid) {
    for (const [k, v] of this.segar) if (v.uid === uid) this.segar.delete(k);
    for (const [k, v] of this.token) if (v.uid === uid) this.token.delete(k);
  }

  jawab(status, isi) { return { status, ok: status >= 200 && status < 300, json: async () => salin(isi) }; }

  terbitkan(uid, email) {
    const idToken = 'fb-' + uid + '-' + (++this.nomor);
    this.token.set(idToken, { uid, email, habis: this.jam + SEJAM });
    return idToken;
  }

  /**
   * Meniru halaman login Google. Dari alamat otorisasi yang dibuka aplikasi, hasilkan
   * alamat pengalihannya: kembali ke aplikasi membawa #state=...&id_token=...
   * `akun` null berarti pengguna menekan Batal. Hasil null berarti Google menolak
   * permintaannya (klien salah atau alamat kembali tidak terdaftar).
   */
  alamatKembaliGoogle(urlOtorisasi, akun) {
    const u = new URL(urlOtorisasi);
    const p = u.searchParams;
    this.catatan.push({ metode: 'GET', host: u.host, jalur: u.pathname });
    const kembali = p.get('redirect_uri');
    if (p.get('client_id') !== this.konfig.idKlienGoogle || p.get('response_type') !== 'id_token' ||
        !p.get('nonce') || !p.get('state') || !/\bopenid\b/.test(p.get('scope') || '')) return null;
    if (this.alamatTerdaftar && this.alamatTerdaftar.indexOf(kembali) < 0) return null;
    const jawaban = akun
      ? { state: p.get('state'), id_token: tokenGoogle(akun, p.get('nonce'), p.get('client_id')), authuser: '0', prompt: 'consent' }
      : { error: 'access_denied', state: p.get('state') };
    return kembali + '#' + new URLSearchParams(jawaban).toString();
  }

  async fetch(url, init = {}) {
    const u = new URL(url);
    const metode = (init.method || 'GET').toUpperCase();
    this.catatan.push({ metode, host: u.host, jalur: u.pathname });
    if (this.putus) throw new TypeError('fetch failed');
    const i = this.kait.findIndex((k) => k.metode === metode && k.pola.test(u.pathname));
    if (i >= 0) {
      const [kait] = this.kait.splice(i, 1);
      await kait.fn();
    }
    if (this.statusPaksa) {
      const status = this.statusPaksa;
      this.statusPaksa = 0;
      return this.jawab(status, { error: 'server tiruan sengaja menjawab ' + status });
    }
    if (u.host === 'identitytoolkit.googleapis.com') return this.masuk(u, init);
    if (u.host === 'securetoken.googleapis.com') return this.perpanjang(u, init);
    if (u.origin === this.konfig.databaseURL) return this.basisData(u, metode, init);
    return this.jawab(404, { error: 'alamat tidak dikenal' });
  }

  masuk(u, init) {
    if (u.searchParams.get('key') !== this.konfig.apiKey) {
      return this.jawab(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
    }
    const badan = JSON.parse(init.body);
    if (badan.requestUri !== 'https://' + this.konfig.authDomain) {
      return this.jawab(400, { error: { code: 400, message: 'UNAUTHORIZED_DOMAIN : Domain not allowlisted by project' } });
    }
    const p = new URLSearchParams(badan.postBody);
    const isi = isiToken(p.get('id_token'));
    if (p.get('providerId') !== 'google.com' || !isi || isi.aud !== this.konfig.idKlienGoogle) {
      return this.jawab(400, { error: { code: 400, message: 'INVALID_IDP_RESPONSE : Unable to parse Google id_token' } });
    }
    const uid = 'uid-' + isi.sub;
    const refreshToken = 'segar-' + uid + '-' + (++this.nomor);
    this.segar.set(refreshToken, { uid, email: isi.email });
    return this.jawab(200, {
      idToken: this.terbitkan(uid, isi.email), refreshToken, expiresIn: '3600',
      localId: uid, email: isi.email, displayName: isi.name, emailVerified: true
    });
  }

  perpanjang(u, init) {
    const p = new URLSearchParams(init.body);
    const s = this.segar.get(p.get('refresh_token'));
    if (p.get('grant_type') !== 'refresh_token' || !s) {
      return this.jawab(400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN', status: 'INVALID_ARGUMENT' } });
    }
    return this.jawab(200, {
      id_token: this.terbitkan(s.uid, s.email), refresh_token: p.get('refresh_token'), expires_in: '3600', user_id: s.uid
    });
  }

  basisData(u, metode, init) {
    const t = this.token.get(u.searchParams.get('auth'));
    if (!t) return this.jawab(401, { error: 'Permission denied' });
    if (t.habis <= this.jam) return this.jawab(401, { error: 'Auth token is expired' });
    const jalur = u.pathname.replace(/\.json$/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (jalur[0] !== 'pengguna' || jalur[1] !== t.uid || t.email !== this.emailDiizinkan) {
      return this.jawab(401, { error: 'Permission denied' });
    }
    if (metode === 'GET') return this.jawab(200, ambilDi(this.pohon, jalur));
    if (metode === 'PATCH') {
      const isi = JSON.parse(init.body);
      this.patchTerakhir = isi;
      for (const [kunci, nilai] of Object.entries(isi)) aturDi(this.pohon, jalur.concat(kunci.split('/')), nilai);
      return this.jawab(200, isi);
    }
    return this.jawab(405, { error: 'metode tidak didukung' });
  }
}

module.exports = { ServerTiruan, tokenGoogle, salin, SEJAM };
