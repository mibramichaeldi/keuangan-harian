# Keuangan Harian

Aplikasi pribadi untuk mencatat pemasukan, pengeluaran, dan transfer antar akun dengan cepat, lalu melihat saldo dan ringkasan bulanan. Aplikasi ini berjalan di browser dan bisa dipakai tanpa akun dan tanpa internet. Kalau mau, masuk dengan akun Google supaya catatan di HP dan laptop selalu sama.

- Catat transaksi dalam beberapa detik: tombol **+** di tengah, ketik jumlah, tekan **Simpan** (atau Enter).
- Saldo per akun dan saldo total dihitung otomatis dari saldo awal dan transaksi.
- Riwayat per bulan dengan filter jenis dan akun.
- Laporan bulanan: pemasukan, pengeluaran, selisih, rata-rata pengeluaran per hari, dan rincian per kategori.
- Backup dan pulihkan lewat file, ekspor CSV untuk Excel atau spreadsheet.
- Bisa dipasang di HP sebagai aplikasi dan tetap jalan tanpa internet (perlu di-hosting lewat https, lihat di bawah).
- Sinkron antar perangkat lewat akun Google (opsional, lihat [Sinkron antar perangkat](#sinkron-antar-perangkat)).

---

## ⚠️ Penting: di mana data disimpan

Semua catatan disimpan di penyimpanan lokal (localStorage) browser yang Anda pakai. **Tanpa masuk dengan Google**, tidak ada salinan di internet. Akibatnya:

- **Setiap cara membuka punya data sendiri.** Data saat membuka `index.html` dengan klik dua kali (file), lewat `http://localhost`, dan lewat alamat hosting (mis. `https://nama.github.io/...`) **tidak saling terlihat**. Begitu juga antara Chrome dan Edge, antar profil browser, dan antar perangkat.
- **Di iPhone/iPad**, aplikasi yang dipasang di layar utama punya data terpisah dari Safari biasa. Pilih satu cara saja.
- **Data bisa hilang** kalau Anda menghapus data penjelajahan (cookie dan data situs), memakai mode penyamaran/incognito (data hilang saat jendela ditutup), menghapus aplikasi atau browser, atau ganti HP.
- **Safari di iPhone** dapat menghapus data situs yang tidak dibuka selama 7 hari pemakaian Safari. Aplikasi yang dipasang di layar utama tidak terkena aturan ini.

**Setelah masuk dengan Google**, catatan juga disimpan di database milik Anda sendiri dan disamakan otomatis antar perangkat yang masuk dengan akun yang sama (lihat [Sinkron antar perangkat](#sinkron-antar-perangkat)).

**Dengan atau tanpa sinkron, rutinlah membuat backup** (lihat [Backup & pulihkan](#backup--pulihkan)). Sinkron bukan pengganti backup: transaksi yang terhapus di satu perangkat ikut terhapus di perangkat lain. Beranda akan mengingatkan kalau backup terakhir sudah lebih dari 7 hari atau belum pernah dibuat.

Kalau aplikasi di-hosting, misalnya di GitHub Pages, yang ada di hosting hanya **kode** aplikasinya. Catatan keuangan Anda tidak pernah ada di sana.

---

## Membuka di laptop

1. Buka folder aplikasi ini.
2. Klik dua kali **`index.html`**. Aplikasi terbuka di browser (Chrome, Edge, atau Firefox) dan langsung bisa dipakai, tanpa instalasi dan tanpa internet.
3. Supaya datanya selalu sama, **buka file yang sama dengan browser yang sama**. Kalau perlu, simpan sebagai bookmark.

Saat dibuka sebagai file, aplikasi tidak bisa "dipasang" seperti aplikasi HP dan tidak bisa masuk dengan Google. Untuk sinkron dengan HP, buka alamat hosting-nya di browser laptop.

### Mencoba lewat http://localhost (opsional)

Untuk mencoba fitur aplikasi terpasang (PWA) di laptop, jalankan server lokal kecil yang sudah disertakan. Server ini butuh [Node.js](https://nodejs.org) versi 18 atau lebih baru. Dari folder aplikasi, jalankan:

```bash
node tools/server.js
```

Lalu buka `http://localhost:8080`. Tekan Ctrl+C di terminal untuk berhenti. Ingat, data di `http://localhost:8080` terpisah dari data saat membuka file dengan klik dua kali. Kalau masuk dengan Google di `localhost`, data sinkronnya disimpan di cabang percobaan yang terpisah dari data sungguhan (aplikasi menuliskan "Mode percobaan" di Pengaturan).

---

## Memasang di HP

Agar bisa dipasang di layar utama HP dan jalan tanpa internet, aplikasi perlu di-hosting lewat **https**. Dua cara gratis yang mudah adalah GitHub Pages dan Netlify. Pilih salah satu dan pakai **alamat yang sama seterusnya**: alamat baru berarti data baru yang kosong.

> **Sudah di-hosting.** Aplikasi ini sudah tayang di **https://mibramichaeldi.github.io/keuangan-harian/** (GitHub Pages, repo [`mibramichaeldi/keuangan-harian`](https://github.com/mibramichaeldi/keuangan-harian)). Untuk memasangnya di HP, langsung ke bagian [Menambahkan ke layar utama](#menambahkan-ke-layar-utama). Cara A dan Cara B di bawah hanya diperlukan kalau ingin meng-hosting ulang di tempat lain.

### File yang perlu di-hosting

```
index.html
manifest.webmanifest
sw.js
.nojekyll        (file kosong, khusus GitHub Pages)
css/
js/
icons/
```

Folder `tests/`, `tools/`, dan `.claude/` tidak perlu ikut. `README.md` boleh ikut atau tidak. File `.nojekyll` membuat GitHub Pages menyajikan file apa adanya, tanpa diproses Jekyll.

### Cara A: GitHub Pages

1. Buat akun di [github.com](https://github.com) kalau belum punya.
2. Buat repository baru, misalnya `keuangan-harian`, dengan pilihan **Public**. GitHub Pages gratis untuk repository publik; yang publik hanya kodenya, bukan data Anda.
3. Di halaman repository, pilih **Add file → Upload files**. Seret file dan folder yang perlu di-hosting (daftar di atas) sampai `index.html` berada di tingkat paling atas, lalu tekan **Commit changes**.
4. Buka **Settings → Pages**. Pada **Build and deployment**, pilih **Source: Deploy from a branch**, lalu **Branch: main** dan folder **/ (root)**. Tekan **Save**.
5. Tunggu satu sampai dua menit. Alamat aplikasi akan tampil di halaman yang sama, biasanya `https://NAMA-AKUN.github.io/keuangan-harian/`.

### Cara B: Netlify

1. Buat akun di [netlify.com](https://www.netlify.com) dan masuk. Dengan akun, situs tersimpan permanen.
2. Buat folder baru yang hanya berisi file dan folder yang perlu di-hosting.
3. Buka [app.netlify.com/drop](https://app.netlify.com/drop) dan seret folder itu ke halaman tersebut.
4. Netlify memberi alamat seperti `https://nama-acak.netlify.app`. Nama situs bisa diganti di pengaturan situs, tapi lakukan **sebelum** mulai mencatat, karena alamat baru berarti data baru.

Tampilan GitHub dan Netlify bisa sedikit berbeda dari langkah di atas, tapi alurnya sama.

### Menambahkan ke layar utama

**Android (Chrome)**

1. Buka alamat aplikasi di Chrome.
2. Ketuk menu **⋮**, lalu **Instal aplikasi** atau **Tambahkan ke layar utama**.
3. Ikon **Keuangan** muncul di layar utama. Tekan lama ikonnya untuk pintasan **Catat transaksi**.

**iPhone / iPad (Safari)**

1. Buka alamat aplikasi di **Safari** (bukan browser lain).
2. Ketuk tombol **Bagikan** (kotak dengan panah ke atas), lalu **Tambahkan ke Layar Utama**, lalu **Tambah**.
3. Mulai sekarang, buka aplikasi dari ikon di layar utama. Datanya terpisah dari data di Safari biasa.

Setelah dipasang, buka aplikasi sekali saat ada internet. Cek **Pengaturan → Tentang**: kalau tertulis *"Siap dipakai tanpa internet."*, aplikasi bisa dibuka tanpa koneksi.

### Memindahkan data dari laptop ke HP (atau sebaliknya)

Cara termudah: masuk dengan Google di kedua perangkat (lihat [Sinkron antar perangkat](#sinkron-antar-perangkat)). Tanpa masuk, pindahkan lewat file:

1. Di perangkat lama: **Pengaturan → Unduh backup (JSON)**.
2. Kirim file `keuangan-harian-backup-....json` ke perangkat baru, misalnya lewat Google Drive, email ke diri sendiri, atau kabel.
3. Di perangkat baru: **Pengaturan → Pulihkan dari backup**, pilih file tadi, periksa ringkasannya, lalu ketuk **Ganti data**.

Pulihkan **mengganti seluruh data** di perangkat itu, bukan menggabungkan.

### Memperbarui aplikasi yang sudah di-hosting

**Dengan skrip (GitHub).** Kalau [GitHub CLI](https://cli.github.com) sudah terpasang dan sudah login (`gh auth login`, cukup sekali), jalankan dari folder aplikasi:

```powershell
powershell -ExecutionPolicy Bypass -File tools\unggah-github.ps1
```

Skrip ini mengirim semua file proyek (kecuali folder berawalan titik seperti `.claude`) sebagai satu commit, memeriksa bahwa isi repo sama persis dengan folder di laptop, lalu menunggu GitHub Pages selesai memproses. Tambahkan `-Coba` untuk melihat dulu apa yang akan dikirim tanpa mengubah apa pun.

**Tanpa skrip.** Unggah ulang file yang berubah: di GitHub lewat **Add file → Upload files** di repository yang sama, di Netlify dengan menyeret folder baru ke halaman **Deploys** situs yang sama.

Aplikasi mengambil versi baru di latar, jadi versi baru baru terlihat **setelah aplikasi dibuka dua kali**. Nomor versinya tertulis di **Pengaturan → Tentang**. Data tidak terpengaruh.

---

## Sinkron antar perangkat

Dengan masuk memakai akun Google, catatan di HP dan laptop disamakan otomatis. Ini opsional: tanpa masuk, aplikasi bekerja seperti biasa dengan data di perangkat.

### Cara memakai

1. Buat backup dulu di perangkat yang datanya paling lengkap (**Pengaturan → Unduh backup**), untuk berjaga-jaga.
2. Di perangkat itu, buka **Pengaturan → Sinkron antar perangkat → Masuk dengan Google**, lalu pilih akun Anda. Datanya diunggah ke akun Google Anda.
3. Lakukan hal yang sama di perangkat berikutnya, **setelah perangkat pertama selesai**.
   - Kalau perangkat itu masih kosong, data dari akun Google langsung dipakai.
   - Kalau perangkat itu sudah berisi catatan, Anda ditanya dulu:
     - **Gabungkan keduanya**: catatan di perangkat itu ditambahkan ke data di akun Google. Akun dan kategori yang bernama sama disatukan.
     - **Pakai data dari Google saja**: catatan di perangkat itu tidak dipakai lagi.
     - **Nanti saja**: tidak ada yang berubah; bisa dilanjutkan kapan saja dari Pengaturan.

     Apa pun pilihannya, data perangkat itu disalin dulu. Salinannya ada di **Pengaturan → Salinan pengaman**, bisa diunduh, dan bisa dipulihkan seperti file backup.

Cukup masuk sekali per perangkat.

### Sehari-hari

- Sinkron berjalan sendiri: sesaat setelah mencatat, saat aplikasi dibuka, saat internet tersambung lagi, dan tiap menit selagi aplikasi terbuka. Tombol **Sinkronkan sekarang** ada di Pengaturan kalau ingin memastikan.
- **Tanpa internet**, aplikasi tetap bisa dipakai. Catatan tersimpan di perangkat dan terkirim sendiri begitu tersambung.
- Status terakhir terlihat di Beranda (mis. *"Tersinkron hari ini pukul 14.10"*) dan di Pengaturan.
- Catatan baru dari semua perangkat selalu digabung. Kalau catatan yang **sama** diubah di dua perangkat, **perubahan terakhir yang dipakai**. Pastikan jam di tiap perangkat benar, karena "terakhir" ditentukan oleh jam perangkat.
- Saat tersambung, **Hapus semua data** dan **Pulihkan dari backup** berlaku juga di akun Google dan di perangkat lain. Aplikasi mengingatkan sebelum melakukannya. Untuk mengosongkan satu perangkat saja, **Keluar** dulu.
- **Keluar** hanya menghentikan sinkron di perangkat itu. Catatan tetap ada di perangkat dan di akun Google.

### Privasi dan keamanan

- Catatan disimpan di **Firebase Realtime Database** dalam proyek Firebase milik pemilik aplikasi, bukan di hosting dan bukan di server pihak lain selain Google.
- Aturan database hanya mengizinkan **satu akun Google** (pemiliknya) membaca dan menulis datanya sendiri. Akun lain yang mencoba masuk ditolak dengan pesan *"Akun Google ini tidak diizinkan"*.
- File `js/konfig.js` berisi pengenal proyek (bukan kata sandi) dan memang dirancang untuk ditaruh di kode aplikasi web. Yang menjaga data adalah aturan database.
- Kunci sesi login disimpan di browser perangkat itu, terpisah dari data keuangan, dan tidak ikut ke file backup. Siapa pun yang bisa membuka browser Anda bisa melihat catatan Anda, sama seperti sebelum ada sinkron.

### Yang perlu diketahui

- **Masuk ulang kira-kira tiap 5 bulan.** Google menghapus izin login aplikasi yang tidak dipakai selama 6 bulan. Aplikasi mengingatkan lewat kartu "Masuk ulang dengan Google"; cukup ketuk dan pilih akun yang sama.
- Nama, jenis, dan saldo awal **akun atau kategori yang dihapus** tetap tersimpan di database, supaya bisa dihidupkan lagi dengan benar kalau ternyata masih dipakai di perangkat lain. Isi transaksi yang dihapus benar-benar dibuang.
- Sambungkan perangkat **satu per satu** pada kali pertama. Kalau dua perangkat mengunggah data pertamanya pada detik yang sama, akun bawaan (Tunai, Rekening bank, E-wallet) bisa menjadi kembar.
- Sinkron ini untuk **satu orang dengan beberapa perangkat**, bukan untuk berbagi catatan dengan orang lain.

### Menyiapkan sinkron di proyek Firebase sendiri

Bagian ini hanya untuk yang meng-hosting aplikasi ini sendiri. Semuanya gratis untuk pemakaian pribadi.

1. Di [console.firebase.google.com](https://console.firebase.google.com), buat proyek baru, lalu tambahkan **aplikasi Web**. Catat `apiKey`, `authDomain`, dan `projectId` yang ditampilkan.
2. **Authentication → Sign-in method**: aktifkan **Google**.
3. **Realtime Database**: buat database, lalu isi tab **Rules** dengan aturan berikut (ganti alamat emailnya dengan akun Google Anda):

   ```json
   {
     "rules": {
       "pengguna": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid && auth.token.email === 'EMAIL_ANDA@gmail.com' && auth.token.email_verified === true",
           ".write": "auth != null && auth.uid === $uid && auth.token.email === 'EMAIL_ANDA@gmail.com' && auth.token.email_verified === true"
         }
       }
     }
   }
   ```

4. Di [console.cloud.google.com](https://console.cloud.google.com) pada proyek yang sama, buka **APIs & Services → Credentials**, pilih klien OAuth **"Web client (auto created by Google Service)"**, lalu tambahkan alamat aplikasi Anda (persis, diakhiri `/`, mis. `https://NAMA-AKUN.github.io/keuangan-harian/`) ke **Authorized redirect URIs**, dan asalnya (`https://NAMA-AKUN.github.io`) ke **Authorized JavaScript origins**. Tambahkan juga `http://localhost:8080/` kalau ingin mencoba di laptop.
5. Isi `js/konfig.js` dengan `apiKey`, `projectId`, `authDomain`, alamat database (`databaseURL`), dan ID klien OAuth tadi (`idKlienGoogle`). Mengosongkan `apiKey` mematikan fitur login dan sinkron.

Aplikasi tidak memakai SDK Firebase: login dan sinkron dilakukan lewat permintaan `fetch` biasa, jadi tidak ada file tambahan yang perlu diunduh.

---

## Backup & pulihkan

Semua ada di **Pengaturan → Data & backup**.

### Unduh backup

Ketuk **Unduh backup (JSON)**. File bernama `keuangan-harian-backup-TAHUN-BULAN-TANGGAL.json` akan terunduh, berisi semua akun, kategori, transaksi, dan pengaturan.

- Simpan file itu **di luar browser**: Google Drive, email ke diri sendiri, flashdisk, atau laptop lain.
- Pastikan file benar-benar tersimpan (cek folder Unduhan atau aplikasi File). Browser tidak bisa memberi tahu aplikasi apakah file sudah disimpan, jadi aplikasi menganggap backup sudah dibuat saat tombol ditekan.
- Di iPhone, cara menyimpan unduhan bisa berbeda, terutama saat aplikasi dibuka dari layar utama. Coba sekali dan pastikan filenya muncul di aplikasi File.

### Pulihkan dari backup

Ketuk **Pulihkan dari backup** lalu pilih file `.json` hasil backup.

- File diperiksa dulu. Kalau rusak atau bukan backup Keuangan Harian, aplikasi menolaknya, menyebutkan alasannya, dan **data Anda tidak diubah**.
- Kalau file valid, muncul ringkasan isinya (jumlah akun, kategori, transaksi, dan rentang tanggal). Data baru diganti setelah Anda mengetuk **Ganti data**.
- Pulihkan mengganti seluruh data dan tidak bisa dibatalkan. Kalau ragu, unduh backup data yang sekarang dulu.
- Kalau perangkat itu tersambung ke akun Google, isi backup juga menggantikan data di akun Google dan di perangkat lain.

### Salinan pengaman

Saat sebuah perangkat yang sudah berisi catatan pertama kali disambungkan ke akun Google, datanya disalin dulu secara otomatis. Salinan itu ada di **Pengaturan → Salinan pengaman** (bagian ini hanya muncul kalau ada salinan). Unduh kalau masih diperlukan, lalu hapus supaya tidak memenuhi penyimpanan. File hasil unduhannya bisa dipulihkan lewat **Pulihkan dari backup**.

### Ekspor CSV

**Ekspor CSV** menghasilkan `keuangan-harian-TAHUN-BULAN-TANGGAL.csv` untuk dibuka di Excel atau spreadsheet. Formatnya: pemisah titik koma (`;`), UTF-8 dengan BOM, kolom `Tanggal;Jenis;Jumlah;Akun;Akun tujuan;Kategori;Catatan`, dan jumlah tanpa titik ribuan. Teks yang diawali `=`, `+`, `-`, atau `@` diberi awalan `'` supaya tidak dibaca sebagai rumus. File CSV tidak bisa dipakai untuk memulihkan data; gunakan file backup JSON.

### Kalau data tersimpan rusak

Kalau suatu saat data di browser tidak bisa dibaca, aplikasi **tidak menimpanya**. Data lama disalin apa adanya ke tempat terpisah, aplikasi mulai dengan data baru, dan Anda diberi tahu. Salinan itu bisa diunduh atau dihapus di **Pengaturan → Data lama yang rusak**. Bagian ini hanya muncul kalau memang ada salinan. Setelah itu, pulihkan dari file backup terakhir.

### Hapus semua data

**Pengaturan → Hapus semua data** menghapus semua akun, kategori, dan transaksi di browser itu, lalu mengembalikan aplikasi ke data awal. Ada konfirmasi dulu, dan tindakan ini tidak bisa dibatalkan. Kalau perangkat itu tersambung ke akun Google, penghapusannya berlaku juga di akun Google dan di perangkat lain; untuk mengosongkan satu perangkat saja, **Keluar** dulu.

---

## Cara pakai singkat

- **Catat:** ketuk **+** di tengah bawah. Pilih **Pengeluaran**, **Pemasukan**, atau **Transfer**, ketik jumlah (titik ribuan muncul sendiri), lalu **Simpan**. Akun dan kategori yang terakhir dipakai sudah terpilih otomatis. Tanggal bawaannya hari ini; ada tombol **Kemarin**.
- **Ubah atau hapus:** ketuk baris transaksi di Beranda atau Riwayat. Setelah **Hapus transaksi**, ketuk **Batalkan** pada pesan di bawah layar kalau berubah pikiran.
- **Saldo awal:** isi lewat ajakan di Beranda atau **Pengaturan → Atur saldo awal semua akun**. Centang **Utang** untuk saldo minus.
- **Kartu kredit:** buat akun berjenis *Kartu kredit* dengan saldo awal berupa utang. Belanja dengan kartu dicatat sebagai **Pengeluaran** dari akun kartu itu; membayar tagihan dicatat sebagai **Transfer** dari rekening bank ke akun kartu.
- **Transfer** (mis. tarik tunai, isi e-wallet) memindahkan uang antar akun. Transfer tidak dihitung sebagai pemasukan atau pengeluaran di laporan.
- **Akun dan kategori** dikelola di **Pengaturan**. Yang sudah dipakai transaksi tidak bisa dihapus (aplikasi menyebutkan jumlah transaksinya), tapi namanya bisa diganti.

---

## Untuk pengembang

### Struktur file

```
index.html             kerangka halaman
css/style.css          tampilan "buku kas", mode terang & gelap
js/data.js             logika data, perhitungan, dan penggabungan data dua perangkat, tanpa DOM
js/konfig.js           pengenal proyek Firebase (publik) untuk login dan sinkron
js/sinkron.js          login Google, sesi, kirim-ambil data; tanpa DOM, tanpa SDK
js/app.js              layar, form, navigasi lewat hash (#/...), penyimpanan, kapan sinkron dijalankan
sw.js                  service worker: offline, stale-while-revalidate, hanya untuk http/https
manifest.webmanifest   data aplikasi untuk dipasang di HP
icons/                 ikon; sumbernya icon.svg dan icon-maskable.svg
tests/data.test.js     tes otomatis untuk js/data.js
tests/sinkron.test.js  tes otomatis untuk js/sinkron.js
tests/server-tiruan.js tiruan Google dan Firebase untuk tes (tanpa jaringan)
tools/server.js        server lokal untuk mencoba lewat http://localhost (tidak perlu di-hosting)
tools/unggah-github.ps1  mengunggah proyek ke GitHub tanpa git (butuh GitHub CLI yang sudah login)
```

Folder `.claude/` berisi pengaturan alat bantu pengembangan dan tidak dipakai aplikasi. `js/data.js`, `js/konfig.js`, dan `js/sinkron.js` bisa dimuat sebagai `<script>` biasa di browser maupun lewat `require` di Node.

### Aturan data

- Data disimpan di localStorage dengan satu kunci: `keuangan-harian:v1`. Sesi login ada di kunci terpisah (`keuangan-harian:akun`); salinan pengaman dan salinan data rusak memakai awalan `keuangan-harian:v1:cadangan:` dan `keuangan-harian:v1:rusak:`.
- Uang disimpan sebagai bilangan bulat Rupiah. Jumlah transaksi yang sah: lebih dari 0 sampai 999.999.999.999.
- Saldo tidak disimpan; selalu dihitung dari saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk.
- "Hari ini" memakai waktu lokal perangkat, bukan UTC.
- Untuk sinkron, tiap akun, kategori, dan transaksi mencatat waktu ubahnya (`diubah`), dan yang dihapus meninggalkan tanda hapus (`terhapus`). Data lama tanpa keduanya tetap terbaca.

### Cara kerja sinkron

- **Login:** halaman diarahkan ke Google dan kembali membawa ID token di bagian `#` alamat (dengan `state` dan `nonce` yang dicocokkan). Token itu ditukar lewat Firebase Auth REST (`accounts:signInWithIdp`) menjadi sesi yang diperpanjang sendiri (`securetoken`).
- **Penyimpanan:** per rekaman di Realtime Database, di bawah `/pengguna/<uid>/v1/` (`akun/<id>`, `kategori/<id>`, `transaksi/<id>`, `terhapus/<koleksi>/<id>`, `info`). Di `localhost` cabangnya `uji`, bukan `v1`.
- **Satu sinkron:** ambil data awan → gabung dengan data perangkat (`gabungData` di `js/data.js`: per rekaman, perubahan terakhir menang; tanda hapus mengalahkan rekaman yang tidak lebih baru) → simpan di perangkat → kirim hanya yang berbeda dalam satu tulisan, yang sekaligus menaikkan nomor revisi di server.
- **Hemat:** kalau data perangkat dan nomor revisi awan tidak berubah, sinkron hanya satu permintaan kecil. Selama halaman terbuka, isi awan yang terakhir dilihat diingat, jadi mencatat satu transaksi tidak mengunduh ulang semuanya.
- **Tulisan bersamaan:** kalau nomor revisi melompat lebih dari satu, berarti ada perangkat lain yang menulis di sela-sela, dan sinkron diulang saat itu juga. Isi awan dibaca secara longgar dan dibereskan oleh `gabungData`, supaya keadaan "tanggung" tidak membuat sinkron macet.

### Menjalankan tes

Butuh [Node.js](https://nodejs.org) versi 18 atau lebih baru, tanpa dependency tambahan. Dari folder aplikasi, jalankan:

```bash
node --test
```

Tes sinkron tidak memakai jaringan: Google dan Firebase ditiru oleh `tests/server-tiruan.js`.

### Mengubah file aplikasi

Kalau menambah atau mengganti nama file yang perlu tersedia offline, perbarui daftar `FILE_APLIKASI` di `sw.js` dan naikkan `VERSI` (mis. `keuangan-harian-v3`) supaya cache lama dibersihkan. Naikkan juga `VERSI_APLIKASI` di `js/app.js` supaya versi yang sedang dipakai terlihat di Pengaturan. Kalau mengganti ikon, ubah `icons/icon.svg` dan `icons/icon-maskable.svg`, lalu buat ulang file PNG-nya (192, 512, maskable 512, apple-touch 180, favicon 32) dengan alat pengubah SVG ke PNG apa pun.

---

## Masalah yang sering terjadi

**Data saya kosong atau berbeda.**
Hampir selalu karena aplikasi dibuka dengan cara, alamat, browser, atau profil yang berbeda dari biasanya. Periksa alamat di browser. Kalau data memang hilang, pulihkan dari file backup terakhir.

**Catatan di HP tidak muncul di laptop (atau sebaliknya).**
Buka **Pengaturan → Sinkron antar perangkat** di kedua perangkat. Keduanya harus masuk dengan akun Google yang sama dan berstatus *"Tersinkron ..."*. Kalau tertulis *"Belum disambungkan"*, ketuk **Sambungkan sekarang**. Kalau tertulis *"Belum tersinkron"*, periksa internet lalu ketuk **Sinkronkan sekarang**.

**Muncul "Perlu masuk lagi dengan Google".**
Sesi login di perangkat itu berakhir, misalnya karena kata sandi Google diganti. Ketuk **Masuk lagi** dan pilih akun yang sama. Catatan yang dibuat selama itu tetap tersimpan dan terkirim setelah masuk.

**Muncul "Akun Google ini tidak diizinkan".**
Anda masuk dengan akun Google yang bukan pemilik aplikasi ini. Ketuk **Keluar**, lalu masuk dengan akun yang benar.

**Tombol "Masuk dengan Google" tidak ada.**
Login hanya tersedia kalau aplikasi dibuka dari alamat `https://` (atau `http://localhost`), bukan sebagai file.

**Pilihan "Instal aplikasi" atau "Tambahkan ke Layar Utama" tidak muncul.**
Pastikan alamatnya diawali `https://`. Membuka file dengan klik dua kali tidak bisa dipasang. Di iPhone, gunakan Safari.

**Perubahan di hosting belum terlihat.**
Tutup aplikasi lalu buka lagi, dua kali. Versi baru diambil di latar saat pembukaan pertama dan dipakai di pembukaan berikutnya. Nomor versi tertulis di **Pengaturan → Tentang**.

**Penyimpanan penuh.**
Data aplikasi kecil; ribuan transaksi masih muat. Kalau browser tetap menolak menyimpan, aplikasi menampilkan pesan dan perubahan terakhir tidak disimpan. Unduh backup, lalu kosongkan ruang (mis. hapus salinan pengaman atau salinan data rusak di Pengaturan).

---

## Di luar cakupan

Tidak ada koneksi ke bank, anggaran, pindai struk, grafik tren, maupun berbagi catatan dengan orang lain.
