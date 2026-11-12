/*
 * Keuangan Harian - login Google dan sinkron antar perangkat.
 *
 * File ini tidak menyentuh tampilan. Semua hubungan ke luar (jaringan, penyimpanan,
 * jam, bilangan acak) dioper lewat buatSinkron(), sehingga bisa dimuat di browser
 * sebagai <script> biasa (window.KeuanganSinkron) dan diuji di Node dengan server
 * tiruan (module.exports). Aturan penggabungan data ada di js/data.js.
 *
 * Cara kerjanya, tanpa SDK dan tanpa server sendiri:
 *   1. Masuk: halaman diarahkan ke Google, lalu kembali membawa "ID token" di
 *      alamat (#id_token=...). Token itu ditukar ke Firebase menjadi sesi yang
 *      bisa diperpanjang sendiri, jadi cukup masuk sekali per perangkat.
 *   2. Data disimpan per rekaman di Firebase Realtime Database, di bawah
 *      /pengguna/<uid>/v1/. Aturan database hanya mengizinkan pemilik akun.
 *   3. Sinkron: ambil data awan -> gabung dengan data perangkat (data.js) ->
 *      simpan hasilnya di perangkat -> kirim HANYA yang berbeda ke awan.
 *
 * Sesi login disimpan di kunci tersendiri, terpisah dari data keuangan, dan tidak
 * pernah ikut ke file backup.
 */
(function (root, buat) {
  'use strict';
  const diNode = typeof module === 'object' && module.exports;
  const api = buat(root, diNode ? require('./data.js') : root.KeuanganData);
  if (diNode) {
    module.exports = api;
  } else {
    root.KeuanganSinkron = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, D) {
  'use strict';

  const KUNCI_SESI = 'keuangan-harian:akun';
  const KUNCI_LOGIN = 'keuangan-harian:login';
  const URL_GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth';
  const URL_MASUK = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
  const URL_TOKEN = 'https://securetoken.googleapis.com/v1/token';
  const VERSI_AWAN = 'v1';
  const UMUR_PERMINTAAN_LOGIN = 30 * 60 * 1000; // jawaban login yang lebih tua dari ini ditolak (cukup longgar untuk verifikasi 2 langkah)
  const SISA_MINIMAL_TOKEN = 5 * 60 * 1000;     // token diperbarui kalau sisa umurnya kurang dari ini
  const BATAS_WAKTU = 20000;
  const MAKS_PUTARAN = 3;                       // ulangan dalam satu sinkron kalau perangkat lain ikut menulis

  const PESAN_JARINGAN = 'Tidak bisa menghubungi server. Sinkron dicoba lagi saat ada internet.';
  const PESAN_SESI = 'Sesi login sudah berakhir. Masuk lagi dengan Google untuk melanjutkan sinkron.';
  const SESI_BERAKHIR = ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN'];

  function galat(jenis, pesan, tambahan) {
    return Object.assign({ ok: false, jenis: jenis, pesan: pesan }, tambahan || {});
  }

  // ---------------------------------------------------------------------------
  // Bentuk data di awan
  // ---------------------------------------------------------------------------
  //
  //   akun/<id>            { nama, jenis, saldoAwal, diubah }
  //   kategori/<id>        { nama, tipe, diubah }
  //   transaksi/<id>       { tanggal, tipe, jumlah, akunId, akunTujuanId?, kategoriId?, catatan, dibuat, diubah }
  //   terhapus/<koleksi>/<id>   waktu tanda hapus
  //   info                 { backupTerakhir?, saldoAwalDiatur, revisi }
  //
  // Realtime Database tidak menyimpan nilai null, jadi isian yang null dihilangkan
  // dan dikembalikan saat dibaca. "Terakhir dipakai" di form tidak ikut ke awan.
  //
  // Awan bukan satu file yang ditulis utuh: tiap perangkat hanya menulis jalur yang
  // berubah. Kalau dua perangkat menulis pada waktu yang hampir bersamaan, isi awan
  // bisa sesaat "tanggung", misalnya ada transaksi yang akunnya baru saja diberi
  // tanda hapus oleh perangkat lain. Karena itu:
  //   - awan dibaca secara longgar (bacaAwan) dan dibereskan oleh gabungData,
  //     bukan ditolak;
  //   - isi akun dan kategori yang dihapus TETAP disimpan di awan (yang berlaku
  //     adalah tanda hapusnya), supaya perangkat mana pun bisa menghidupkannya
  //     lagi dengan nama dan saldo awal yang benar bila ternyata masih dipakai.
  //     Isi transaksi yang dihapus benar-benar dibuang dari awan.

  function rekamanKeAwan(koleksi, r) {
    const hasil = {};
    D.ISIAN[koleksi].forEach(function (isian) {
      if (isian !== 'id' && r[isian] !== null && r[isian] !== undefined) hasil[isian] = r[isian];
    });
    return hasil;
  }

  /** Seluruh data perangkat dalam bentuk awan (untuk tes dan pemeriksaan). */
  function keAwan(data) {
    const pohon = {};
    D.KOLEKSI.forEach(function (k) {
      data[k].forEach(function (r) {
        if (!pohon[k]) pohon[k] = {};
        pohon[k][r.id] = rekamanKeAwan(k, r);
      });
      const tanda = (data.terhapus && data.terhapus[k]) || {};
      Object.keys(tanda).forEach(function (id) {
        if (!pohon.terhapus) pohon.terhapus = {};
        if (!pohon.terhapus[k]) pohon.terhapus[k] = {};
        pohon.terhapus[k][id] = tanda[id];
      });
    });
    pohon.info = { saldoAwalDiatur: !!data.pengaturan.saldoAwalDiatur };
    if (data.pengaturan.backupTerakhir != null) pohon.info.backupTerakhir = data.pengaturan.backupTerakhir;
    return pohon;
  }

  function objek(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {};
  }

  /**
   * Pohon dari awan -> data berbentuk seperti data perangkat (belum diperiksa;
   * pemanggil wajib melewatkannya ke D.periksaData).
   */
  function dariAwan(pohon) {
    const p = objek(pohon);
    const data = {
      aplikasi: 'keuangan-harian',
      versi: 1,
      akun: [],
      kategori: [],
      transaksi: [],
      terhapus: { akun: {}, kategori: {}, transaksi: {} },
      pengaturan: {
        terakhir: null,
        backupTerakhir: typeof objek(p.info).backupTerakhir === 'number' ? p.info.backupTerakhir : null,
        saldoAwalDiatur: objek(p.info).saldoAwalDiatur === true
      }
    };
    D.KOLEKSI.forEach(function (k) {
      const simpul = objek(p[k]);
      Object.keys(simpul).forEach(function (id) {
        const r = objek(simpul[id]);
        const rekaman = { id: id };
        D.ISIAN[k].forEach(function (isian) {
          if (isian !== 'id') rekaman[isian] = r[isian] === undefined ? null : r[isian];
        });
        if (k === 'transaksi' && rekaman.catatan === null) rekaman.catatan = '';
        data[k].push(rekaman);
      });
      const tanda = objek(objek(p.terhapus)[k]);
      Object.keys(tanda).forEach(function (id) { data.terhapus[k][id] = tanda[id]; });
    });
    return data;
  }

  function dataAwanKosong() {
    return dariAwan(null);
  }

  /**
   * Membaca pohon yang diambil dari awan. Hasil:
   *   { ok: true, kosong: true }                  belum ada data sama sekali
   *   { ok: true, kosong: false, mentah, data }
   *       mentah  isi awan apa adanya, tiap rekaman sudah diperiksa; dipakai untuk
   *               gabungData (sebagai `jauh`) dan untuk selisih
   *       data    isi awan sebagai data utuh yang sah, yaitu yang akan dilihat
   *               perangkat yang baru tersambung; null kalau isi awan belum bisa
   *               berdiri sendiri (mis. tidak ada satu akun pun)
   *   { ok: false, pesan }                        ada rekaman yang tidak sah: jangan ubah apa pun
   */
  function bacaAwan(pohon) {
    const mentah = dariAwan(pohon);
    const kosong = D.KOLEKSI.every(function (k) {
      return mentah[k].length === 0 && Object.keys(mentah.terhapus[k]).length === 0;
    });
    if (kosong) return { ok: true, kosong: true, mentah: null, data: null };
    const periksa = D.periksaDataAwan(mentah);
    if (!periksa.ok) return { ok: false, pesan: periksa.pesan };
    const utuh = D.gabungData(dataAwanKosong(), periksa.data);
    return { ok: true, kosong: false, mentah: periksa.data, data: utuh.ok ? utuh.data : null };
  }

  function sidik(koleksi, r) {
    return JSON.stringify(D.ISIAN[koleksi].map(function (isian) { return r[isian]; }));
  }

  /**
   * Apa saja yang harus ditulis ke awan supaya isinya menjadi `gabungan`, kalau
   * isi awan sekarang `jauh` (bentuk `mentah` dari bacaAwan). Hasil:
   * { 'akun/<id>': {...}, 'transaksi/<id>': null, ... } untuk satu kali tulis;
   * null berarti hapus. Objek kosong berarti awan sudah sama.
   */
  function selisih(jauh, gabungan) {
    const ubah = {};
    D.KOLEKSI.forEach(function (k) {
      const lama = new Map(jauh[k].map(function (r) { return [r.id, sidik(k, r)]; }));
      gabungan[k].forEach(function (r) {
        if (lama.get(r.id) !== sidik(k, r)) ubah[k + '/' + r.id] = rekamanKeAwan(k, r);
        lama.delete(r.id);
      });
      // Yang sudah tidak ada di gabungan berarti sudah dihapus. Isi transaksinya dibuang
      // dari awan; isi akun dan kategori sengaja dibiarkan (lihat catatan di atas).
      if (k === 'transaksi') lama.forEach(function (_, id) { ubah[k + '/' + id] = null; });

      const tandaLama = (jauh.terhapus && jauh.terhapus[k]) || {};
      const tandaBaru = (gabungan.terhapus && gabungan.terhapus[k]) || {};
      Object.keys(tandaBaru).forEach(function (id) {
        if (tandaLama[id] !== tandaBaru[id]) ubah['terhapus/' + k + '/' + id] = tandaBaru[id];
      });
      Object.keys(tandaLama).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(tandaBaru, id)) ubah['terhapus/' + k + '/' + id] = null;
      });
    });
    const pj = jauh.pengaturan;
    const pg = gabungan.pengaturan;
    if ((pj.backupTerakhir == null ? null : pj.backupTerakhir) !== (pg.backupTerakhir == null ? null : pg.backupTerakhir)) {
      ubah['info/backupTerakhir'] = pg.backupTerakhir == null ? null : pg.backupTerakhir;
    }
    if (!!pj.saldoAwalDiatur !== !!pg.saldoAwalDiatur) ubah['info/saldoAwalDiatur'] = !!pg.saldoAwalDiatur;
    return ubah;
  }

  /** Sidik pendek sebuah teks (cyrb53), untuk mengenali "data belum berubah sejak sinkron terakhir". */
  function hashTeks(teks) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < teks.length; i++) {
      const c = teks.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + teks.length;
  }

  /** Isi (payload) sebuah JWT, atau null. Tanda tangannya diperiksa oleh Firebase, bukan di sini. */
  function isiToken(jwt) {
    try {
      const bagian = String(jwt).split('.');
      if (bagian.length < 2) return null;
      let b64 = bagian[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const biner = atob(b64);
      const bita = new Uint8Array(biner.length);
      for (let i = 0; i < biner.length; i++) bita[i] = biner.charCodeAt(i);
      const isi = JSON.parse(new TextDecoder().decode(bita));
      return isi !== null && typeof isi === 'object' ? isi : null;
    } catch (e) {
      return null;
    }
  }

  function acakBawaan() {
    const bita = new Uint8Array(16);
    root.crypto.getRandomValues(bita);
    return Array.from(bita, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ---------------------------------------------------------------------------
  // buatSinkron
  // ---------------------------------------------------------------------------

  /**
   * opsi: {
   *   konfig          { apiKey, authDomain, databaseURL, idKlienGoogle } (js/konfig.js)
   *   ambil           fungsi seperti fetch
   *   penyimpanan     seperti localStorage
   *   alamatKembali   alamat aplikasi yang terdaftar di Google, mis. https://.../keuangan-harian/
   *   kini?           () => waktu sekarang (ms)
   *   acak?           () => teks acak yang tidak bisa ditebak
   *   batasWaktu?     berapa lama (ms) satu permintaan ditunggu sebelum dianggap gagal
   *   cabang?         nama cabang data di bawah /pengguna/<uid>/ (bawaan: 'v1'). Dipakai
   *                   untuk memisahkan data percobaan (mis. 'uji' di localhost) dari data
   *                   sungguhan.
   * }
   */
  function buatSinkron(opsi) {
    const konfig = opsi.konfig || {};
    const ambil = opsi.ambil;
    const penyimpanan = opsi.penyimpanan;
    const alamatKembali = opsi.alamatKembali || '';
    const kini = opsi.kini || function () { return Date.now(); };
    const acak = opsi.acak || acakBawaan;
    const batasWaktu = opsi.batasWaktu || BATAS_WAKTU;
    const cabang = /^[A-Za-z0-9_-]{1,32}$/.test(opsi.cabang || '') ? opsi.cabang : VERSI_AWAN;

    // Isi awan yang terakhir dilihat, diingat selama halaman belum dimuat ulang:
    // { uid, revisi, mentah }. Tiap tulisan ke awan menaikkan nomor revisinya, jadi selama
    // nomor itu masih sama, isi awan pasti masih sama dan tidak perlu diunduh lagi. Tanpa
    // ini, seluruh data ikut terunduh setiap kali ada satu transaksi dicatat.
    let ingatan = null;

    /** Fitur ini hanya ada kalau konfigurasinya lengkap dan aplikasi dibuka lewat http(s). */
    function tersedia() {
      return !!(konfig.apiKey && konfig.authDomain && konfig.databaseURL && konfig.idKlienGoogle &&
        typeof ambil === 'function' && penyimpanan && /^https?:\/\//.test(alamatKembali));
    }

    // ----- sesi ---------------------------------------------------------------

    function bacaSesi() {
      try {
        const s = JSON.parse(penyimpanan.getItem(KUNCI_SESI));
        return s && typeof s === 'object' && typeof s.uid === 'string' && s.uid ? s : null;
      } catch (e) {
        return null;
      }
    }

    function tulisSesi(s) {
      try {
        penyimpanan.setItem(KUNCI_SESI, JSON.stringify(s));
        return true;
      } catch (e) {
        return false;
      }
    }

    /** Keadaan login untuk ditampilkan. Tidak pernah memuat token. null = belum masuk. */
    function sesi() {
      const s = bacaSesi();
      if (!s) return null;
      return {
        uid: s.uid,
        email: s.email || '',
        nama: s.nama || '',
        masukPada: s.masukPada || null,
        sinkronTerakhir: s.sinkronTerakhir || null,
        terhubung: !!s.terhubung,
        perluMasukLagi: !!s.perluMasukLagi
      };
    }

    /** Keluar di perangkat ini. Data keuangan di perangkat maupun di awan tidak disentuh. */
    function keluar() {
      ingatan = null;
      try {
        penyimpanan.removeItem(KUNCI_SESI);
        penyimpanan.removeItem(KUNCI_LOGIN);
      } catch (e) {
        // penyimpanan tidak bisa diubah: tidak ada yang bisa dilakukan
      }
    }

    // ----- jaringan -----------------------------------------------------------

    /**
     * Hasil: { status, isi }. status 0 = tidak tersambung, kehabisan waktu, atau diblokir.
     * Permintaan yang menggantung diputus setelah `batasWaktu`, supaya satu sinkron yang
     * macet (sinyal lemah) tidak menahan semua sinkron sesudahnya.
     */
    async function panggil(url, init) {
      const pengaturan = Object.assign({}, init);
      let pewaktu = null;
      if (typeof AbortController === 'function') {
        const kendali = new AbortController();
        pengaturan.signal = kendali.signal;
        pewaktu = setTimeout(function () { kendali.abort(); }, batasWaktu);
      }
      try {
        const jawab = await ambil(url, pengaturan);
        let isi = null;
        try { isi = await jawab.json(); } catch (e) { isi = null; }
        return { status: jawab.status, isi: isi };
      } catch (e) {
        return { status: 0, isi: null };
      } finally {
        if (pewaktu) clearTimeout(pewaktu);
      }
    }

    function pesanFirebase(r) {
      const g = r.isi && r.isi.error;
      if (!g) return '';
      return typeof g === 'string' ? g : String(g.message || '');
    }

    // ----- login --------------------------------------------------------------

    /**
     * Alamat Google untuk mulai masuk. Pemanggil tinggal mengarahkan halaman ke
     * sana. `state` dan `nonce` acak disimpan untuk mencocokkan jawabannya nanti;
     * kalau browser menolak menyimpannya, hasilnya null (login tidak bisa dimulai).
     */
    function urlLogin() {
      const permintaan = { state: acak(), nonce: acak(), waktu: kini() };
      try {
        penyimpanan.setItem(KUNCI_LOGIN, JSON.stringify(permintaan));
      } catch (e) {
        return null; // tanpa pencocok, jawaban dari Google nanti pasti ditolak
      }
      const p = new URLSearchParams({
        client_id: konfig.idKlienGoogle,
        redirect_uri: alamatKembali,
        response_type: 'id_token',
        scope: 'openid email profile',
        nonce: permintaan.nonce,
        state: permintaan.state,
        prompt: 'select_account' // selalu tanya akun mana: di satu browser bisa ada beberapa akun Google
      });
      const lama = bacaSesi();
      if (lama && lama.email) p.set('login_hint', lama.email);
      return URL_GOOGLE + '?' + p.toString();
    }

    /** Apakah bagian # di alamat ini jawaban dari Google (bukan rute aplikasi seperti #/riwayat)? */
    function adaJawabanLogin(hash) {
      const h = String(hash || '');
      return h.charAt(0) === '#' && h.charAt(1) !== '/' &&
        /[#&](id_token|error)=/.test(h) && /[#&]state=/.test(h);
    }

    /**
     * Menyelesaikan login dari bagian # di alamat. Hasil: { ok: true, sesi } atau
     * { ok: false, jenis, pesan }. Pemanggil sebaiknya langsung membuang bagian #
     * itu dari alamat, apa pun hasilnya.
     */
    async function selesaikanLogin(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      let permintaan = null;
      try { permintaan = JSON.parse(penyimpanan.getItem(KUNCI_LOGIN)); } catch (e) { permintaan = null; }
      try { penyimpanan.removeItem(KUNCI_LOGIN); } catch (e) { /* biarkan */ }

      if (!permintaan || typeof permintaan.state !== 'string' || p.get('state') !== permintaan.state ||
          kini() - permintaan.waktu > UMUR_PERMINTAAN_LOGIN) {
        return galat('login', 'Permintaan masuk itu sudah tidak berlaku. Coba masuk lagi.');
      }
      if (p.get('error')) {
        return p.get('error') === 'access_denied'
          ? galat('batal', 'Masuk dengan Google dibatalkan.')
          : galat('login', 'Google menolak permintaan masuk (' + p.get('error') + ').');
      }
      const tokenGoogle = p.get('id_token');
      const isi = isiToken(tokenGoogle);
      if (!tokenGoogle || !isi || isi.nonce !== permintaan.nonce) {
        return galat('login', 'Jawaban dari Google tidak cocok dengan permintaan masuk. Coba masuk lagi.');
      }

      // requestUri: domain bawaan proyek, yang selalu diizinkan Firebase.
      const r = await panggil(URL_MASUK + '?key=' + encodeURIComponent(konfig.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: 'id_token=' + encodeURIComponent(tokenGoogle) + '&providerId=google.com',
          requestUri: 'https://' + konfig.authDomain,
          returnSecureToken: true,
          returnIdpCredential: false
        })
      });
      if (r.status === 0) return galat('jaringan', 'Tidak bisa menghubungi server untuk menyelesaikan login. Coba lagi saat ada internet.');
      if (r.status !== 200 || !r.isi || !r.isi.idToken || !r.isi.refreshToken || !r.isi.localId) {
        const pesan = pesanFirebase(r);
        if (/ADMIN_ONLY_OPERATION|USER_DISABLED/.test(pesan)) {
          return galat('izin', 'Akun Google itu tidak diizinkan memakai aplikasi ini.');
        }
        return galat('login', 'Login tidak bisa diselesaikan' + (pesan ? ' (' + pesan.split(' : ')[0] + ')' : '') + '. Coba masuk lagi.');
      }

      const lama = bacaSesi();
      const samaAkun = !!lama && lama.uid === r.isi.localId;
      const baru = {
        uid: r.isi.localId,
        email: r.isi.email || isi.email || '',
        nama: r.isi.displayName || isi.name || '',
        idToken: r.isi.idToken,
        refreshToken: r.isi.refreshToken,
        kedaluwarsa: kini() + (Number(r.isi.expiresIn) || 3600) * 1000,
        masukPada: kini(),
        // Akun yang sama masuk lagi: perangkat ini tetap dianggap sudah tersambung.
        terhubung: samaAkun ? !!lama.terhubung : false,
        sinkronTerakhir: samaAkun ? (lama.sinkronTerakhir || null) : null,
        hashTerakhir: null,
        revisiAwan: null,
        perluMasukLagi: false
      };
      if (!tulisSesi(baru)) return galat('simpan', 'Browser menolak menyimpan sesi login.');
      return { ok: true, sesi: sesi() };
    }

    /**
     * Token Firebase yang masih berlaku; diperbarui sendiri kalau hampir habis.
     * Hasil: { ok: true, token, sesi } atau galat 'sesi' / 'jaringan' / 'lain'.
     */
    async function tokenSegar(paksa) {
      const s = bacaSesi();
      if (!s) return galat('sesi', 'Belum masuk dengan akun Google.');
      if (s.perluMasukLagi || !s.refreshToken) return galat('sesi', PESAN_SESI);
      if (!paksa && s.idToken && s.kedaluwarsa - kini() > SISA_MINIMAL_TOKEN) {
        return { ok: true, token: s.idToken, sesi: s };
      }
      const r = await panggil(URL_TOKEN + '?key=' + encodeURIComponent(konfig.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken)
      });
      if (r.status === 0) return galat('jaringan', PESAN_JARINGAN);
      if (r.status === 200 && r.isi && r.isi.id_token) {
        const kiniSesi = bacaSesi();
        if (!kiniSesi || kiniSesi.uid !== s.uid) return galat('sesi', 'Akun berganti saat sinkron berjalan.');
        const baru = Object.assign({}, kiniSesi, {
          idToken: r.isi.id_token,
          refreshToken: r.isi.refresh_token || kiniSesi.refreshToken,
          kedaluwarsa: kini() + (Number(r.isi.expires_in) || 3600) * 1000
        });
        tulisSesi(baru);
        return { ok: true, token: baru.idToken, sesi: baru };
      }
      const pesan = pesanFirebase(r);
      if (SESI_BERAKHIR.some(function (kode) { return pesan.indexOf(kode) >= 0; })) {
        // Izin dicabut atau akunnya sudah tidak ada: token dibuang, identitas disimpan
        // supaya tampilan bisa meminta masuk lagi dengan akun yang sama.
        const kiniSesi = bacaSesi();
        if (kiniSesi && kiniSesi.uid === s.uid) {
          tulisSesi(Object.assign({}, kiniSesi, { idToken: null, refreshToken: null, kedaluwarsa: 0, perluMasukLagi: true }));
        }
        return galat('sesi', PESAN_SESI);
      }
      if (r.status === 429 || r.status >= 500) return galat('jaringan', 'Server login sedang sibuk. Sinkron dicoba lagi nanti.');
      return galat('lain', 'Sesi login tidak bisa diperpanjang' + (pesan ? ' (' + pesan + ')' : '') + '.');
    }

    // ----- database -----------------------------------------------------------

    /** Baca/tulis satu jalur di bawah /pengguna/<uid>/<cabang>. Hasil: { ok: true, isi } atau galat. */
    async function basisData(metode, jalur, isi) {
      for (let percobaan = 0; percobaan < 2; percobaan++) {
        const t = await tokenSegar(percobaan > 0);
        if (!t.ok) return t;
        const url = konfig.databaseURL.replace(/\/+$/, '') + '/pengguna/' + encodeURIComponent(t.sesi.uid) + '/' + cabang +
          jalur + '.json?auth=' + encodeURIComponent(t.token);
        const init = { method: metode };
        if (isi !== undefined) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(isi);
        }
        const r = await panggil(url, init);
        if (r.status === 0) return galat('jaringan', PESAN_JARINGAN);
        if (r.status === 200) return { ok: true, isi: r.isi };
        const pesan = pesanFirebase(r);
        // 401 bisa berarti token dianggap habis oleh server (jam perangkat meleset) atau memang
        // tidak diizinkan. Token diperbarui dan permintaan diulang sekali; kalau masih ditolak,
        // berarti memang tidak diizinkan.
        if (r.status === 401 && percobaan === 0) continue;
        if (r.status === 401 || r.status === 403) {
          return galat('izin', 'Akun ' + (t.sesi.email || 'ini') + ' tidak diizinkan menyimpan data di sini. Masuk dengan akun Google pemilik aplikasi ini.');
        }
        if (r.status === 429 || r.status >= 500) return galat('jaringan', 'Server sedang sibuk. Sinkron dicoba lagi nanti.');
        return galat('lain', 'Sinkron gagal (kode ' + r.status + (pesan ? ': ' + pesan : '') + ').');
      }
      return galat('sesi', PESAN_SESI);
    }

    // ----- sinkron ------------------------------------------------------------

    let berjalan = null;
    let antrean = null;

    function sedangSinkron() {
      return berjalan !== null;
    }

    /**
     * Sinkronkan data perangkat dengan awan.
     *
     * masukan: {
     *   ambilLokal()        data perangkat SAAT INI (dipanggil lagi setelah data awan tiba,
     *                       supaya perubahan yang dibuat selama menunggu tidak hilang)
     *   simpanLokal(data)   menyimpan hasil gabungan; mengembalikan { ok } (seketika)
     *   caraPertama?        'gabung' | 'pakaiAwan': jawaban pengguna untuk perangkat yang
     *                       baru pertama kali tersambung dan sudah punya data sendiri
     *   paksa?              true = selalu ambil seluruh data awan
     * }
     * hasil:
     *   { ok: true, status: 'selesai', berubahLokal, terkirim, tanpaPerubahan, pertama, ringkas, cadangan }
     *   { ok: true, status: 'perlu-pilihan', lokal, awan }   belum ada yang diubah; tanyakan caraPertama
     *   { ok: false, jenis, pesan }   jenis: 'jaringan' | 'sesi' | 'izin' | 'data' | 'simpan' | 'lain'
     *
     * Hanya satu sinkron berjalan pada satu waktu; panggilan yang datang selagi sibuk
     * dijalankan sekali lagi sesudahnya.
     */
    function sinkronkan(masukan) {
      if (!berjalan) {
        berjalan = jalankan(masukan)
          .catch(function (e) {
            // Kesalahan yang tidak terduga dijadikan hasil gagal biasa, supaya pemanggil
            // tidak perlu menangkapnya dan antrean sinkron tidak ikut macet.
            return galat('lain', 'Sinkron berhenti karena kesalahan yang tidak terduga' +
              (e && e.message ? ' (' + e.message + ')' : '') + '.');
          })
          .finally(function () { berjalan = null; });
        return berjalan;
      }
      if (!antrean) {
        const sesudah = function () {
          antrean = null;
          return sinkronkan(masukan);
        };
        antrean = berjalan.then(sesudah, sesudah);
      }
      return antrean;
    }

    async function jalankan(masukan) {
      if (!tersedia()) return galat('lain', 'Sinkron tidak tersedia di sini.');
      const awal = bacaSesi();
      if (!awal) return galat('sesi', 'Belum masuk dengan akun Google.');
      const uid = awal.uid;

      // 1. Jalan pintas. Nomor revisi awan (permintaan kecil) ditanyakan dulu kalau itu bisa
      //    menghemat unduhan seluruh data, yaitu kalau data perangkat belum berubah sejak
      //    sinkron terakhir, atau kalau isi awan yang terakhir dilihat masih diingat.
      const kenal = !masukan.paksa && awal.terhubung && awal.revisiAwan != null;
      const lokalSama = kenal && !!awal.hashTerakhir &&
        awal.hashTerakhir === hashTeks(D.sidikData(masukan.ambilLokal()));
      const ingat = kenal && ingatan && ingatan.uid === uid && ingatan.revisi === awal.revisiAwan ? ingatan : null;
      let diingat = null;
      if (lokalSama || ingat) {
        const cek = await basisData('GET', '/info/revisi');
        if (!cek.ok) return cek;
        if (cek.isi === awal.revisiAwan) {
          if (lokalSama) {
            // Tidak ada yang berubah di perangkat ini maupun di awan.
            const s = bacaSesi();
            if (s && s.uid === uid) tulisSesi(Object.assign({}, s, { sinkronTerakhir: kini() }));
            return { ok: true, status: 'selesai', berubahLokal: false, terkirim: 0, tanpaPerubahan: true, pertama: null, ringkas: null, cadangan: null };
          }
          diingat = ingat; // awan belum berubah: pakai isi yang diingat, tidak perlu diunduh lagi
        }
      }

      // 2-5. Ambil, gabung, simpan, kirim. Kalau ternyata ada perangkat lain yang menulis
      //      ke awan di sela-sela itu, putarannya diulang supaya tulisan mereka ikut terbawa
      //      sekarang juga, bukan baru pada sinkron berikutnya.
      const total = { berubahLokal: false, terkirim: 0, pertama: null, ringkas: null, cadangan: null };
      for (let putaran = 1; ; putaran++) {
        const h = await satuPutaran(masukan, uid, putaran === 1 ? diingat : null);
        if (h.ok && h.status === 'perlu-pilihan') return h;
        if (!h.ok) {
          if (putaran === 1) return h;
          // Putaran susulan gagal (mis. jaringan putus): yang sudah dikerjakan tetap sah,
          // dan sinkron berikutnya akan mengambil seluruh data lagi.
          total.berubahLokal = total.berubahLokal || !!h.tersimpanLokal;
          break;
        }
        total.berubahLokal = total.berubahLokal || h.berubahLokal;
        total.terkirim += h.terkirim;
        if (putaran === 1) {
          total.pertama = h.pertama;
          total.ringkas = h.ringkas;
          total.cadangan = h.cadangan;
        }
        if (!h.adaPenulisLain || putaran >= MAKS_PUTARAN) break;
      }
      return Object.assign({ ok: true, status: 'selesai', tanpaPerubahan: false }, total);
    }

    /**
     * Satu putaran sinkron: ambil seluruh data awan (atau pakai `diingat`, isi awan yang
     * sudah dipastikan belum berubah) -> gabung -> simpan di perangkat -> kirim selisihnya.
     * Hasil seperti sinkronkan(), ditambah `adaPenulisLain`: true kalau ada perangkat lain
     * yang menulis ke awan selagi putaran ini berjalan.
     */
    async function satuPutaran(masukan, uid, diingat) {
      // 2. Isi awan.
      let awan = null; // hasil bacaAwan; hanya ada kalau data awan benar-benar diambil
      let jauh;
      let revisiDilihat;
      if (diingat) {
        jauh = diingat.mentah;
        revisiDilihat = diingat.revisi;
      } else {
        const jawab = await basisData('GET', '');
        if (!jawab.ok) return jawab;
        const pohon = jawab.isi;
        awan = bacaAwan(pohon);
        if (!awan.ok) {
          return galat('data', 'Data di akun Google tidak bisa dibaca, jadi tidak ada yang diubah. ' + awan.pesan);
        }
        revisiDilihat = pohon && pohon.info && typeof pohon.info.revisi === 'number' ? pohon.info.revisi : 0;
        jauh = awan.kosong ? dataAwanKosong() : awan.mentah;
        ingatan = { uid: uid, revisi: revisiDilihat, mentah: jauh };
      }

      // 3. Gabungkan dengan data perangkat pada saat ini juga. Dari sini sampai data
      //    tersimpan (langkah 4) tidak ada jeda menunggu, jadi tidak ada yang terselip.
      let sesiKini = bacaSesi();
      if (!sesiKini || sesiKini.uid !== uid) return galat('sesi', 'Akun berganti saat sinkron berjalan.');
      // Isi yang diingat hanya dipakai perangkat yang sudah tersambung (lihat jalankan).
      if (!awan && !sesiKini.terhubung) return galat('sesi', 'Akun berganti saat sinkron berjalan.');
      const lokal = masukan.ambilLokal();
      let pertama = null;
      if (!sesiKini.terhubung) {
        // awan.data null: awan kosong, atau isinya belum bisa berdiri sendiri. Dalam dua
        // keadaan itu data perangkat ini tinggal ditambahkan ke sana.
        if (!awan.data) pertama = 'unggah';
        else if (D.dataMasihBawaan(lokal)) pertama = 'pakaiAwan';
        else if (masukan.caraPertama === 'gabung' || masukan.caraPertama === 'pakaiAwan') pertama = masukan.caraPertama;
        else return { ok: true, status: 'perlu-pilihan', lokal: D.ringkasData(lokal), awan: D.ringkasData(awan.data) };
      }

      let hasil;
      if (pertama === 'pakaiAwan') {
        hasil = D.periksaData(Object.assign({}, awan.data, {
          pengaturan: Object.assign({}, awan.data.pengaturan, { terakhir: lokal.pengaturan.terakhir })
        }));
      } else if (pertama === 'gabung') {
        hasil = D.gabungPertama(lokal, awan.data, kini());
      } else {
        hasil = D.gabungData(lokal, jauh);
      }
      if (!hasil.ok) return galat('data', hasil.pesan);
      const gabungan = hasil.data;
      const sidikGabungan = D.sidikData(gabungan);
      const berubahLokal = sidikGabungan !== D.sidikData(lokal);

      // Sebelum data perangkat diganti atau dicampur untuk pertama kali: simpan salinannya.
      let cadangan = null;
      if ((pertama === 'gabung' || pertama === 'pakaiAwan') && berubahLokal && !D.dataMasihBawaan(lokal)) {
        const c = D.simpanCadangan(penyimpanan, lokal, kini());
        if (!c.ok) return galat('simpan', c.pesan);
        cadangan = c.kunci;
      }

      // 4. Simpan hasil gabungan di perangkat.
      if (berubahLokal) {
        const s = masukan.simpanLokal(gabungan);
        if (!s || !s.ok) return galat('simpan', (s && s.pesan) || 'Hasil sinkron tidak bisa disimpan di perangkat ini.');
      }
      //    Sejak saat ini perangkat sudah tersambung, walau kirimannya nanti gagal: data
      //    perangkat sudah digabung, jadi sinkron berikutnya tidak perlu bertanya lagi.
      sesiKini = Object.assign({}, sesiKini, { terhubung: true });
      tulisSesi(sesiKini);

      // 5. Kirim ke awan hanya yang berbeda. Nomor revisi dinaikkan oleh server di tulisan
      //    yang sama, jadi tiap tulisan dari perangkat mana pun menaikkannya tepat satu.
      const ubah = selisih(jauh, gabungan);
      const terkirim = Object.keys(ubah).length;
      let revisiAwan = revisiDilihat;
      let adaPenulisLain = false;
      if (terkirim > 0) {
        ubah['info/revisi'] = { '.sv': { increment: 1 } };
        const kirim = await basisData('PATCH', '', ubah);
        if (!kirim.ok) {
          // Data perangkat sudah benar; awan menyusul pada sinkron berikutnya.
          return Object.assign(kirim, { tersimpanLokal: berubahLokal, pertama: pertama, cadangan: cadangan });
        }
        // Nomor revisi seharusnya tepat satu di atas yang tadi dilihat. Kalau tidak, ada
        // perangkat lain yang menulis di sela-sela dan tulisannya belum terbaca di sini.
        const cek = await basisData('GET', '/info/revisi');
        if (cek.ok && cek.isi === revisiDilihat + 1) {
          revisiAwan = cek.isi;
        } else {
          revisiAwan = null; // sinkron berikutnya wajib mengambil seluruh data
          adaPenulisLain = cek.ok;
        }
      }
      // Kalau nomor revisinya pasti, isi awan sekarang juga pasti: sama dengan hasil gabungan
      // yang baru saja dikirim. (Isi akun/kategori terhapus yang masih tinggal di awan tidak
      // perlu ikut diingat: itu hanya berguna saat membaca tulisan perangkat lain, dan saat
      // itu nomor revisinya sudah berubah sehingga seluruh data diambil lagi.)
      ingatan = revisiAwan === null ? null : { uid: uid, revisi: revisiAwan, mentah: gabungan };

      const akhir = bacaSesi();
      if (akhir && akhir.uid === uid) {
        tulisSesi(Object.assign({}, akhir, {
          terhubung: true,
          sinkronTerakhir: kini(),
          hashTerakhir: hashTeks(sidikGabungan),
          revisiAwan: revisiAwan
        }));
      }
      return {
        ok: true,
        status: 'selesai',
        berubahLokal: berubahLokal,
        terkirim: terkirim,
        pertama: pertama,
        ringkas: hasil.ringkas || null,
        cadangan: cadangan,
        adaPenulisLain: adaPenulisLain
      };
    }

    return {
      tersedia: tersedia,
      sesi: sesi,
      urlLogin: urlLogin,
      adaJawabanLogin: adaJawabanLogin,
      selesaikanLogin: selesaikanLogin,
      keluar: keluar,
      sinkronkan: sinkronkan,
      sedangSinkron: sedangSinkron
    };
  }

  return {
    KUNCI_SESI: KUNCI_SESI,
    KUNCI_LOGIN: KUNCI_LOGIN,
    buatSinkron: buatSinkron,
    keAwan: keAwan,
    dariAwan: dariAwan,
    bacaAwan: bacaAwan,
    selisih: selisih,
    hashTeks: hashTeks,
    isiToken: isiToken
  };
});
