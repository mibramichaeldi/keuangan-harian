<#
.SYNOPSIS
  Mengunggah aplikasi Keuangan Harian ke GitHub (untuk GitHub Pages) tanpa perlu git.

.DESCRIPTION
  Butuh GitHub CLI (gh) yang sudah login. Login cukup sekali:  gh auth login

  Yang diunggah: semua file di folder proyek, kecuali folder yang namanya diawali
  titik (mis. .claude) dan node_modules. Data keuangan TIDAK ikut: data hanya ada
  di browser, bukan di folder ini.

  Satu kali jalan = satu commit di cabang utama repo. Isi repo dibuat sama persis
  dengan folder proyek: file yang dihapus di laptop ikut terhapus di repo. Kalau
  tidak ada yang berubah, tidak ada commit yang dibuat.

  Commit memakai alamat noreply GitHub, jadi email akun tidak tampil di repo.

.PARAMETER Repo
  Nama repo di akun GitHub yang sedang login. Bawaan: keuangan-harian

.PARAMETER Pesan
  Pesan commit. Bawaan: "Perbarui aplikasi"

.PARAMETER Buat
  Untuk pertama kali: buat repo publik kalau belum ada, lalu aktifkan GitHub Pages.

.PARAMETER Coba
  Hanya menampilkan apa yang akan dikirim, tanpa mengubah apa pun di GitHub.

.PARAMETER Paksa
  Tetap mengunggah walau isi repo tidak terlihat seperti aplikasi ini.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\unggah-github.ps1
  Mengirim perubahan terbaru.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\unggah-github.ps1 -Coba
  Melihat dulu apa yang akan dikirim.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\unggah-github.ps1 -Buat
  Pertama kali: membuat repo, mengunggah, dan mengaktifkan GitHub Pages.
#>
param(
  [string]$Repo = 'keuangan-harian',
  [string]$Pesan = 'Perbarui aplikasi',
  [switch]$Buat,
  [switch]$Coba,
  [switch]$Paksa
)

$ErrorActionPreference = 'Continue'
$akar = Split-Path -Parent $PSScriptRoot
$sementara = Join-Path ([IO.Path]::GetTempPath()) ('kh-unggah-' + [Guid]::NewGuid().ToString('N') + '.json')
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Selesai([int]$kode) {
  if (Test-Path -LiteralPath $sementara) { Remove-Item -LiteralPath $sementara -Force -ErrorAction SilentlyContinue }
  exit $kode
}

function Berhenti([string]$teks) {
  Write-Host ''
  Write-Host ('GAGAL: ' + $teks)
  Selesai 1
}

# ---------------------------------------------------------------- GitHub CLI

$gh = $null
$perintah = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($perintah) {
  $gh = $perintah.Path
} elseif (Test-Path (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe')) {
  $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
} else {
  Berhenti 'GitHub CLI (gh) tidak ditemukan. Pasang dulu dengan: winget install GitHub.cli'
}

# Panggil API GitHub. Hasil: objek jawaban, $true kalau jawabannya kosong, $null kalau gagal.
function Panggil([string]$metode, [string]$jalur, $isi, [switch]$Diam) {
  $argumen = @('api', $jalur, '--method', $metode)
  if ($null -ne $isi) {
    [IO.File]::WriteAllText($sementara, ($isi | ConvertTo-Json -Depth 6 -Compress), $utf8)
    $argumen += @('--input', $sementara)
  }
  if ($Diam) { $keluaran = & $gh @argumen 2>$null } else { $keluaran = & $gh @argumen }
  if ($LASTEXITCODE -ne 0) {
    if (-not $Diam -and $keluaran) { Write-Host ('  Jawaban GitHub: ' + ($keluaran -join ' ')) }
    return $null
  }
  $teks = ($keluaran -join "`n").Trim()
  if (-not $teks) { return $true }
  return ($teks | ConvertFrom-Json)
}

# SHA-1 ala git untuk isi file ("blob <ukuran>\0<isi>"): sama dengan yang dihitung GitHub.
function ShaBlobGit([byte[]]$isi) {
  $kepala = [Text.Encoding]::ASCII.GetBytes('blob ' + $isi.Length + [char]0)
  $sha1 = [Security.Cryptography.SHA1]::Create()
  try {
    [void]$sha1.TransformBlock($kepala, 0, $kepala.Length, $null, 0)
    [void]$sha1.TransformFinalBlock($isi, 0, $isi.Length)
    return (($sha1.Hash | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $sha1.Dispose()
  }
}

# ---------------------------------------------------------------------- akun

$saya = Panggil 'GET' 'user' $null -Diam
if (-not $saya -or -not $saya.login) { Berhenti 'Belum login ke GitHub. Jalankan dulu: gh auth login' }
$pemilik = [string]$saya.login
$penulis = @{ name = $pemilik; email = ('{0}+{1}@users.noreply.github.com' -f $saya.id, $pemilik) }
$jalurRepo = 'repos/' + $pemilik + '/' + $Repo
$alamat = 'https://' + $pemilik.ToLower() + '.github.io/' + $Repo + '/'

# ---------------------------------------------------------------- file lokal

$daftar = @(Get-ChildItem -LiteralPath $akar -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($akar.Length + 1).Replace('\', '/')
  # lewati folder berawalan titik (.claude, .git, ...) dan node_modules
  if ($rel -match '(^|/)\.[^/]+/' -or $rel -match '(^|/)node_modules/') { return }
  $byte = [IO.File]::ReadAllBytes($_.FullName)
  New-Object psobject -Property @{ Jalur = $rel; Byte = $byte; Sha = (ShaBlobGit $byte) }
} | Sort-Object Jalur)

if (-not ($daftar | Where-Object { $_.Jalur -eq 'index.html' })) {
  Berhenti ('index.html tidak ditemukan di ' + $akar)
}

Write-Host ('Akun   : ' + $pemilik)
Write-Host ('Repo   : https://github.com/' + $pemilik + '/' + $Repo)
Write-Host ('Folder : ' + $akar + ' (' + $daftar.Count + ' file)')

# ---------------------------------------------------------------------- repo

$repoInfo = Panggil 'GET' $jalurRepo $null -Diam
$repoBaru = $false
if (-not $repoInfo) {
  if (-not $Buat) { Berhenti ('Repo ' + $pemilik + '/' + $Repo + ' belum ada. Tambahkan -Buat untuk membuatnya.') }
  if ($Coba) {
    Write-Host ('Coba   : repo belum ada. Tanpa -Coba, repo publik akan dibuat dan ' + $daftar.Count + ' file diunggah.')
    Selesai 0
  }
  Write-Host 'Membuat repo publik ...'
  $repoInfo = Panggil 'POST' 'user/repos' @{
    name = $Repo
    description = 'Keuangan Harian: catatan pemasukan, pengeluaran, dan transfer pribadi. Web app statis (PWA); data hanya tersimpan di browser.'
    homepage = $alamat
    private = $false
  }
  if (-not $repoInfo) { Berhenti 'Repo tidak bisa dibuat.' }
  $repoBaru = $true
}
$cabang = [string]$repoInfo.default_branch
if (-not $cabang) { $cabang = 'main' }

function AmbilKepala {
  $ref = Panggil 'GET' ($jalurRepo + '/git/ref/heads/' + $cabang) $null -Diam
  if ($ref -and $ref.object) { return [string]$ref.object.sha }
  return $null
}

$kepala = AmbilKepala
if (-not $kepala) {
  # Repo masih kosong: commit pertama dibuat lewat Contents API, sisanya menyusul di bawah.
  if ($Coba) {
    Write-Host ('Coba   : repo masih kosong. Tanpa -Coba, ' + $daftar.Count + ' file akan diunggah.')
    Selesai 0
  }
  $pertama = $daftar | Where-Object { $_.Jalur -eq 'README.md' } | Select-Object -First 1
  if (-not $pertama) { $pertama = $daftar | Where-Object { $_.Byte.Length -gt 0 } | Select-Object -First 1 }
  $mulai = Panggil 'PUT' ($jalurRepo + '/contents/' + $pertama.Jalur) @{
    message = 'Mulai repo'
    content = [Convert]::ToBase64String($pertama.Byte)
    author = $penulis
    committer = $penulis
  }
  if (-not $mulai) { Berhenti 'Commit pertama tidak bisa dibuat.' }
  $repoLagi = Panggil 'GET' $jalurRepo $null -Diam
  if ($repoLagi -and $repoLagi.default_branch) { $cabang = [string]$repoLagi.default_branch }
  for ($i = 0; $i -lt 10 -and -not $kepala; $i++) {
    Start-Sleep -Seconds 1
    $kepala = AmbilKepala
  }
  if (-not $kepala) { Berhenti ('Cabang ' + $cabang + ' tidak ditemukan setelah commit pertama.') }
}

# --------------------------------------------- bandingkan dengan isi repo kini

$komitLama = Panggil 'GET' ($jalurRepo + '/git/commits/' + $kepala) $null
if (-not $komitLama) { Berhenti 'Commit terakhir di repo tidak bisa dibaca.' }
$pohonLama = Panggil 'GET' ($jalurRepo + '/git/trees/' + $komitLama.tree.sha + '?recursive=1') $null
if (-not $pohonLama) { Berhenti 'Daftar file di repo tidak bisa dibaca.' }

$shaLama = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($e in @($pohonLama.tree)) {
  if ($e.type -eq 'blob') { $shaLama[[string]$e.path] = [string]$e.sha }
}

# Isi repo akan diganti seluruhnya, jadi pastikan ini memang repo aplikasi ini.
if (-not $repoBaru -and -not $Paksa -and $shaLama.Count -gt 1) {
  if (-not ($shaLama.ContainsKey('manifest.webmanifest') -and $shaLama.ContainsKey('js/data.js'))) {
    Berhenti ('Isi repo ' + $Repo + ' tidak terlihat seperti aplikasi ini. Unggahan MENGGANTI seluruh isi repo; kalau memang itu maksudnya, tambahkan -Paksa.')
  }
}

$shaLokal = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($f in $daftar) { $shaLokal[$f.Jalur] = $f.Sha }
$berubah = @($daftar | Where-Object { -not ($shaLama.ContainsKey($_.Jalur) -and $shaLama[$_.Jalur] -eq $_.Sha) })
$dihapus = @($shaLama.Keys | Where-Object { -not $shaLokal.ContainsKey($_) } | Sort-Object)

foreach ($f in $berubah) {
  $jenis = 'baru  '
  if ($shaLama.ContainsKey($f.Jalur)) { $jenis = 'ubah  ' }
  Write-Host ('  ' + $jenis + $f.Jalur)
}
foreach ($j in $dihapus) { Write-Host ('  hapus ' + $j) }
$tetap = $daftar.Count - $berubah.Count
Write-Host ('Ringkas: ' + $berubah.Count + ' baru/berubah, ' + $dihapus.Count + ' dihapus, ' + $tetap + ' tetap')

$komitBaru = $null
if ($berubah.Count -eq 0 -and $dihapus.Count -eq 0) {
  Write-Host 'Tidak ada perubahan, jadi tidak ada yang dikirim.'
} elseif ($Coba) {
  Write-Host 'Coba   : tidak ada yang dikirim. Jalankan tanpa -Coba untuk mengunggah.'
  Selesai 0
} else {
  # ------------------------------------------------------------------ unggah
  foreach ($f in $berubah) {
    $hasil = Panggil 'POST' ($jalurRepo + '/git/blobs') @{ content = [Convert]::ToBase64String($f.Byte); encoding = 'base64' }
    if (-not $hasil -or [string]$hasil.sha -ne $f.Sha) { Berhenti ('File ' + $f.Jalur + ' gagal diunggah (isi di GitHub tidak sama).') }
  }
  $entri = @($daftar | ForEach-Object { @{ path = $_.Jalur; mode = '100644'; type = 'blob'; sha = $_.Sha } })
  $pohon = Panggil 'POST' ($jalurRepo + '/git/trees') @{ tree = $entri }
  if (-not $pohon) { Berhenti 'Daftar file baru tidak bisa dibuat.' }
  $komitBaru = Panggil 'POST' ($jalurRepo + '/git/commits') @{
    message = $Pesan
    tree = [string]$pohon.sha
    parents = @($kepala)
    author = $penulis
    committer = $penulis
  }
  if (-not $komitBaru) { Berhenti 'Commit tidak bisa dibuat.' }
  $geser = Panggil 'PATCH' ($jalurRepo + '/git/refs/heads/' + $cabang) @{ sha = [string]$komitBaru.sha; force = $false }
  if (-not $geser) { Berhenti ('Cabang ' + $cabang + ' tidak bisa diperbarui.') }
  $kepala = [string]$komitBaru.sha

  # Periksa ulang: isi repo harus sama persis dengan folder proyek.
  $pohonBaru = Panggil 'GET' ($jalurRepo + '/git/trees/' + $pohon.sha + '?recursive=1') $null
  $cocok = 0
  $jumlahRepo = 0
  foreach ($e in @($pohonBaru.tree)) {
    if ($e.type -ne 'blob') { continue }
    $jumlahRepo++
    if ($shaLokal.ContainsKey([string]$e.path) -and $shaLokal[[string]$e.path] -eq [string]$e.sha) { $cocok++ }
  }
  if ($cocok -ne $daftar.Count -or $jumlahRepo -ne $daftar.Count) {
    Berhenti ('Isi repo tidak sama dengan folder proyek (' + $cocok + ' dari ' + $daftar.Count + ' file cocok, repo berisi ' + $jumlahRepo + ').')
  }
  Write-Host ('Commit : ' + $kepala.Substring(0, 7) + ' "' + $Pesan + '"')
  Write-Host ('Periksa: ' + $cocok + ' file di repo sama persis dengan folder proyek')
}

# -------------------------------------------------------------- GitHub Pages

$halaman = Panggil 'GET' ($jalurRepo + '/pages') $null -Diam
$halamanBaru = $false
if (-not $halaman) {
  if ($Buat -and -not $Coba) {
    Write-Host 'Mengaktifkan GitHub Pages ...'
    $halaman = Panggil 'POST' ($jalurRepo + '/pages') @{ source = @{ branch = $cabang; path = '/' } }
    if ($halaman) {
      $halamanBaru = $true
    } else {
      Write-Host 'PERINGATAN: GitHub Pages belum aktif. Aktifkan di Settings > Pages (Deploy from a branch, main, / root).'
    }
  } else {
    Write-Host 'Catatan: GitHub Pages belum aktif untuk repo ini. Jalankan dengan -Buat untuk mengaktifkannya.'
  }
}
if ($halaman -and $halaman.html_url) { $alamat = [string]$halaman.html_url }

if ($halaman -and ($komitBaru -or $halamanBaru)) {
  Write-Host 'Menunggu GitHub Pages memproses ' -NoNewline
  $tayang = $false
  for ($i = 0; $i -lt 48 -and -not $tayang; $i++) {
    Start-Sleep -Seconds 5
    $b = Panggil 'GET' ($jalurRepo + '/pages/builds/latest') $null -Diam
    if ($b -and [string]$b.commit -eq $kepala) {
      if ($b.status -eq 'built') { $tayang = $true; break }
      if ($b.status -eq 'errored') {
        Write-Host ''
        Berhenti ('GitHub Pages gagal memproses: ' + $b.error.message)
      }
    }
    Write-Host '.' -NoNewline
  }
  if ($tayang) {
    Write-Host ' selesai.'
  } else {
    Write-Host ''
    Write-Host 'Belum selesai setelah 4 menit. Coba buka alamatnya beberapa menit lagi.'
  }
}

Write-Host ('Alamat : ' + $alamat)
Write-Host 'Di perangkat yang sudah memasang aplikasi, versi baru terlihat setelah aplikasi dibuka dua kali.'
Selesai 0
