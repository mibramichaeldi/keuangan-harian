# Keuangan Harian

Aplikasi pribadi untuk mencatat pemasukan, pengeluaran, dan transfer antar akun dengan cepat, lalu melihat saldo dan ringkasan bulanan. Aplikasi ini berjalan sepenuhnya di browser: tanpa server, tanpa akun, tanpa internet.

- Catat transaksi dalam beberapa detik: tombol **+** di tengah, ketik jumlah, tekan **Simpan** (atau Enter).
- Saldo per akun dan saldo total dihitung otomatis dari saldo awal dan transaksi.
- Riwayat per bulan dengan filter jenis dan akun.
- Laporan bulanan: pemasukan, pengeluaran, selisih, rata-rata pengeluaran per hari, dan rincian per kategori.
- Backup dan pulihkan lewat file, ekspor CSV untuk Excel atau spreadsheet.
- Bisa dipasang di HP sebagai aplikasi dan tetap jalan tanpa internet (perlu di-hosting lewat https, lihat di bawah).

---

## ⚠️ Penting: data hanya tersimpan di browser tempat aplikasi dibuka

Semua catatan disimpan di penyimpanan lokal (localStorage) browser yang Anda pakai. Tidak ada salinan di internet dan tidak ada sinkron otomatis. Akibatnya:

- **Setiap cara membuka punya data sendiri.** Data saat membuka `index.html` dengan klik dua kali (file), lewat `http://localhost`, dan lewat alamat hosting (mis. `https://nama.github.io/...`) **tidak saling terlihat**. Begitu juga antara Chrome dan Edge, antar profil browser, dan antar perangkat.
- **Di iPhone/iPad**, aplikasi yang dipasang di layar utama punya data terpisah dari Safari biasa. Pilih satu cara saja.
- **Data bisa hilang** kalau Anda menghapus data penjelajahan (cookie dan data situs), memakai mode penyamaran/incognito (data hilang saat jendela ditutup), menghapus aplikasi atau browser, atau ganti HP.
- **Safari di iPhone** dapat menghapus data situs yang tidak dibuka selama 7 hari pemakaian Safari. Aplikasi yang dipasang di layar utama tidak terkena aturan ini.

**Karena itu, rutinlah membuat backup** (lihat [Backup & pulihkan](#backup--pulihkan)). Beranda akan mengingatkan kalau backup terakhir sudah lebih dari 7 hari atau belum pernah dibuat. Memindahkan data antar perangkat juga hanya bisa lewat file backup.

Kalau aplikasi di-hosting, misalnya di GitHub Pages, yang tersimpan di internet hanya **kode** aplikasinya. Catatan keuangan Anda tidak pernah dikirim ke mana pun.

---

## Membuka di laptop

1. Buka folder aplikasi ini.
2. Klik dua kali **`index.html`**. Aplikasi terbuka di browser (Chrome, Edge, atau Firefox) dan langsung bisa dipakai, tanpa instalasi dan tanpa internet.
3. Supaya datanya selalu sama, **buka file yang sama dengan browser yang sama**. Kalau perlu, simpan sebagai bookmark.

Saat dibuka sebagai file, aplikasi tidak bisa "dipasang" seperti aplikasi HP. Itu tidak masalah, karena semuanya sudah ada di laptop.

### Mencoba lewat http://localhost (opsional)

Untuk mencoba fitur aplikasi terpasang (PWA) di laptop, jalankan server lokal kecil yang sudah disertakan. Server ini butuh [Node.js](https://nodejs.org) versi 18 atau lebih baru. Dari folder aplikasi, jalankan:

```bash
node tools/server.js
```

Lalu buka `http://localhost:8080`. Tekan Ctrl+C di terminal untuk berhenti. Ingat, data di `http://localhost:8080` terpisah dari data saat membuka file dengan klik dua kali.

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

1. Di perangkat lama: **Pengaturan → Unduh backup (JSON)**.
2. Kirim file `keuangan-harian-backup-....json` ke perangkat baru, misalnya lewat Google Drive, email ke diri sendiri, atau kabel.
3. Di perangkat baru: **Pengaturan → Pulihkan dari backup**, pilih file tadi, periksa ringkasannya, lalu ketuk **Ganti data**.

Pulihkan **mengganti seluruh data** di perangkat itu, bukan menggabungkan. Jadi pindahkan data sekali, lalu lanjutkan mencatat di satu perangkat utama.

### Memperbarui aplikasi yang sudah di-hosting

**Dengan skrip (GitHub).** Kalau [GitHub CLI](https://cli.github.com) sudah terpasang dan sudah login (`gh auth login`, cukup sekali), jalankan dari folder aplikasi:

```powershell
powershell -ExecutionPolicy Bypass -File tools\unggah-github.ps1
```

Skrip ini mengirim semua file proyek (kecuali folder berawalan titik seperti `.claude`) sebagai satu commit, memeriksa bahwa isi repo sama persis dengan folder di laptop, lalu menunggu GitHub Pages selesai memproses. Tambahkan `-Coba` untuk melihat dulu apa yang akan dikirim tanpa mengubah apa pun.

**Tanpa skrip.** Unggah ulang file yang berubah: di GitHub lewat **Add file → Upload files** di repository yang sama, di Netlify dengan menyeret folder baru ke halaman **Deploys** situs yang sama.

Aplikasi mengambil versi baru di latar, jadi versi baru baru terlihat **setelah aplikasi dibuka dua kali**. Data tidak terpengaruh.

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

### Ekspor CSV

**Ekspor CSV** menghasilkan `keuangan-harian-TAHUN-BULAN-TANGGAL.csv` untuk dibuka di Excel atau spreadsheet. Formatnya: pemisah titik koma (`;`), UTF-8 dengan BOM, kolom `Tanggal;Jenis;Jumlah;Akun;Akun tujuan;Kategori;Catatan`, dan jumlah tanpa titik ribuan. Teks yang diawali `=`, `+`, `-`, atau `@` diberi awalan `'` supaya tidak dibaca sebagai rumus. File CSV tidak bisa dipakai untuk memulihkan data; gunakan file backup JSON.

### Kalau data tersimpan rusak

Kalau suatu saat data di browser tidak bisa dibaca, aplikasi **tidak menimpanya**. Data lama disalin apa adanya ke tempat terpisah, aplikasi mulai dengan data baru, dan Anda diberi tahu. Salinan itu bisa diunduh atau dihapus di **Pengaturan → Data lama yang rusak**. Bagian ini hanya muncul kalau memang ada salinan. Setelah itu, pulihkan dari file backup terakhir.

### Hapus semua data

**Pengaturan → Hapus semua data** menghapus semua akun, kategori, dan transaksi di browser itu, lalu mengembalikan aplikasi ke data awal. Ada konfirmasi dulu, dan tindakan ini tidak bisa dibatalkan.

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
js/data.js             logika data & perhitungan, tanpa DOM (dipakai browser dan tes Node)
js/app.js              layar, form, navigasi lewat hash (#/...), penyimpanan
sw.js                  service worker: offline, stale-while-revalidate, hanya untuk http/https
manifest.webmanifest   data aplikasi untuk dipasang di HP
icons/                 ikon; sumbernya icon.svg dan icon-maskable.svg
tests/data.test.js     tes otomatis untuk js/data.js
tools/server.js        server lokal untuk mencoba lewat http://localhost (tidak perlu di-hosting)
tools/unggah-github.ps1  mengunggah proyek ke GitHub tanpa git (butuh GitHub CLI yang sudah login)
```

Folder `.claude/` berisi pengaturan alat bantu pengembangan dan tidak dipakai aplikasi.

### Aturan data

- Data disimpan di localStorage dengan satu kunci: `keuangan-harian:v1`.
- Uang disimpan sebagai bilangan bulat Rupiah. Jumlah transaksi yang sah: lebih dari 0 sampai 999.999.999.999.
- Saldo tidak disimpan; selalu dihitung dari saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk.
- "Hari ini" memakai waktu lokal perangkat, bukan UTC.

### Menjalankan tes

Butuh [Node.js](https://nodejs.org) versi 18 atau lebih baru, tanpa dependency tambahan. Dari folder aplikasi, jalankan:

```bash
node --test
```

### Mengubah file aplikasi

Kalau menambah atau mengganti nama file yang perlu tersedia offline, perbarui daftar `FILE_APLIKASI` di `sw.js` dan naikkan `VERSI` (mis. `keuangan-harian-v2`) supaya cache lama dibersihkan. Kalau mengganti ikon, ubah `icons/icon.svg` dan `icons/icon-maskable.svg`, lalu buat ulang file PNG-nya (192, 512, maskable 512, apple-touch 180, favicon 32) dengan alat pengubah SVG ke PNG apa pun.

---

## Masalah yang sering terjadi

**Data saya kosong atau berbeda.**
Hampir selalu karena aplikasi dibuka dengan cara, alamat, browser, atau profil yang berbeda dari biasanya. Periksa alamat di browser. Kalau data memang hilang, pulihkan dari file backup terakhir.

**Pilihan "Instal aplikasi" atau "Tambahkan ke Layar Utama" tidak muncul.**
Pastikan alamatnya diawali `https://`. Membuka file dengan klik dua kali tidak bisa dipasang. Di iPhone, gunakan Safari.

**Perubahan di hosting belum terlihat.**
Tutup aplikasi lalu buka lagi, dua kali. Versi baru diambil di latar saat pembukaan pertama dan dipakai di pembukaan berikutnya.

**Penyimpanan penuh.**
Data aplikasi kecil; ribuan transaksi masih muat. Kalau browser tetap menolak menyimpan, aplikasi menampilkan pesan dan perubahan terakhir tidak disimpan. Unduh backup, lalu kosongkan ruang (mis. hapus salinan data rusak di Pengaturan).

---

## Di luar cakupan

Tidak ada login, server, sinkron antar perangkat, koneksi ke bank, anggaran, pindai struk, maupun grafik tren.
