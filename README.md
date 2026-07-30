# Absensi Omah Kebon

Aplikasi absensi karyawan Omah Kebon (klien Ndalem AI Tech). PWA mobile-first + Google Apps Script + Google Sheet. Nol biaya operasional.

**Fase saat ini: Fase A (build & testing internal)** — Sheet + Apps Script di akun Google Ndalem AI Tech, frontend di GitHub Pages akun Ndalem AI Tech. Migrasi ke akun klien (Fase B) dilakukan nanti setelah lolos testing.

**Update 2026-07-30:** ditambah 2 fitur besar — tipe absen **Lembur** (Mulai/Selesai Lembur) dan **dashboard admin** (`/admin/`) dengan 3 role (Owner/HR/Rekap), termasuk verifikasi lembur dan rekap gaji dasar. Approval Cuti/Izin (form pengganti tombol Cuti/Off lama) **BELUM diaktifkan** — masih menunggu detail field dari form kertas yang sudah dipakai Mas Abim di lapangan. Tombol Cuti/Off di app karyawan untuk sementara masih berperilaku sama seperti sebelumnya (self-report langsung, tanpa approval).

## Struktur Repo

```
├── index.html               # PWA karyawan — 3 layar (setup device, absen, kalender riwayat)
├── css/style.css
├── js/config.js              # ← URL Web App Apps Script diisi di sini (dipakai app karyawan & admin)
├── js/app.js
├── manifest.json             # supaya app karyawan bisa "Tambahkan ke Layar Utama"
├── sw.js                     # service worker (cache app shell KARYAWAN saja, admin tidak)
├── icons/
├── admin/                    # Dashboard admin (baru, 2026-07-30) — TIDAK offline/PWA, butuh internet
│   ├── index.html
│   ├── css/admin.css
│   └── js/admin.js
├── apps-script/Code.gs       # backend — di-paste manual ke editor Apps Script
└── tests/                    # test otomatis (Node, tidak ikut di-deploy) — lihat bagian Testing
    ├── mockBackend.js
    ├── backend.test.js
    ├── e2e-karyawan.test.js
    └── e2e-admin.test.js
```

## Setup Backend (manual, sekali jalan — pakai akun Google Ndalem AI Tech)

1. **Buat Google Sheet baru** di [sheets.new](https://sheets.new). Beri nama misalnya `Absensi Omah Kebon (Testing)`. Tidak perlu bikin tab/header manual — nanti dibuat otomatis.
2. **Buka editor Apps Script** dari dalam Sheet itu: menu **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu **paste seluruh isi [`apps-script/Code.gs`](apps-script/Code.gs)** dari repo ini. Simpan (Ctrl+S).
4. (Disarankan) Set timezone project: ikon gear ⚙ **Project Settings** → Time zone → `(GMT+07:00) Jakarta`.
5. **Jalankan `setupSheet()`**: di toolbar editor pilih fungsi `setupSheet` → klik **Run** → izinkan otorisasi yang diminta (akses Spreadsheet). Ini otomatis membuat 4 tab (`Karyawan`, `Absensi`, `Config`, `Admin`) lengkap dengan header dan data contoh.
   - **Kalau Sheet-mu sudah pernah setup sebelum 2026-07-30** (masih 3 tab lama): tetap jalankan `setupSheet()` ulang — ini AMAN, idempotent. Tab `Admin` baru akan dibuat, dan tab `Absensi` lama otomatis dimigrasi (ditambah 3 kolom `status_verifikasi`/`diverifikasi_oleh`/`waktu_verifikasi` di akhir) TANPA mengubah data yang sudah ada.
6. **Deploy sebagai Web App**: tombol **Deploy → New deployment** → tipe **Web app** →
   - Description: bebas (misal `v1`)
   - Execute as: **Me**
   - Who has access: **Anyone** ← penting, kalau tidak, frontend tidak bisa akses
   - Klik **Deploy**, lalu **copy URL Web App** (bentuknya `https://script.google.com/macros/s/.../exec`).
7. **Isi URL itu ke [`js/config.js`](js/config.js)** (ganti `PASTE_URL_WEB_APP_DI_SINI`), commit, push. File ini dipakai BERSAMA oleh app karyawan dan dashboard admin — cukup isi sekali.

> **Catatan update backend:** kalau `Code.gs` diubah, cukup **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. URL tidak berubah. Kalau bikin *New deployment* baru, URL berubah dan `config.js` harus diupdate.

## Verifikasi Backend

Buka di browser: `<URL_WEB_APP>?action=getKaryawan` — harus muncul JSON berisi daftar karyawan contoh. Untuk cek tab Admin: `<URL_WEB_APP>?action=getDaftarAdmin`.

## Frontend (GitHub Pages)

Repo: `https://github.com/ndalemaitech/absensi-omah-kebon` — GitHub Pages aktif dari branch `main`, root. URL app karyawan: `https://ndalemaitech.github.io/absensi-omah-kebon/`. URL dashboard admin: `https://ndalemaitech.github.io/absensi-omah-kebon/admin/`.

Setiap push ke `main` otomatis ter-deploy (tunggu ± 1 menit). Kalau ada perubahan file **app karyawan** (`index.html`, `css/style.css`, `js/app.js`, `js/config.js`), **naikkan angka `VERSI` di `sw.js`** supaya HP user mengambil versi baru. Perubahan di `admin/` TIDAK butuh bump versi apa pun — dashboard admin selalu ambil versi terbaru dari network setiap dibuka (tidak di-cache service worker).

## Alur Pakai — App Karyawan

1. Buka URL app di HP → pilih nama → buat PIN 4 digit (2x) → masuk layar absen.
2. Layar absen menampilkan **6 tombol**, dikelompokkan 3 baris: **MASUK** (hijau) / **PULANG** (kuning), **MULAI LEMBUR** / **SELESAI LEMBUR** (teal), **CUTI** (biru) / **OFF** (ungu). Warna ini konsisten di modal konfirmasi, layar sukses, dan kalender.
3. Tekan **MASUK** → izinkan lokasi → layar sukses hijau. Tombol PULANG otomatis aktif, CUTI & OFF nonaktif (satu hari cuma satu "jalur": hadir kerja ATAU cuti/off).
4. Tekan **PULANG** → hari itu "lengkap". MASUK & PULANG terkunci sampai hari berikutnya.
5. **MULAI LEMBUR** / **SELESAI LEMBUR** (fitur baru): sama pola dgn Masuk/Pulang — butuh lokasi GPS, Selesai Lembur baru bisa ditekan setelah Mulai Lembur tercatat hari itu. **Lembur BOLEH terjadi di hari yang sama dengan Masuk/Pulang** (tidak saling mengunci) — tapi TETAP terkunci kalau hari itu sudah CUTI/OFF, dan sebaliknya. Durasi lembur otomatis dihitung dari selisih jam Mulai–Selesai, tapi baru **resmi masuk rekap gaji setelah diverifikasi admin** lewat dashboard (lihat bagian Dashboard Admin di bawah) — ini untuk memastikan jam lembur yang diklaim akurat sebelum dihitung sebagai biaya tambahan.
6. **CUTI** dan **OFF** tidak butuh lokasi GPS — untuk sementara masih langsung tercatat tanpa approval (lihat catatan di atas soal Form Izin yang belum aktif).
7. Cek tab `Absensi` di Sheet: baris baru dengan `tipe_absen` (MASUK/PULANG/MULAI_LEMBUR/SELESAI_LEMBUR/CUTI/OFF). Untuk baris Lembur, kolom `status_verifikasi` mulai dari `BELUM_DIVERIFIKASI` sampai admin verifikasi lewat dashboard.
8. Tab **Riwayat**: kalender bulanan berwarna sesuai tipe dominan hari itu. Prioritas warna: Cuti/Off > Pulang > Masuk > Lembur (Lembur cuma jadi warna dominan kalau hari itu tidak ada Masuk/Pulang sama sekali).

## Dashboard Admin (`/admin/`) — baru 2026-07-30

Dipakai dari browser biasa (laptop/HP), 3 role:

- **Owner** (Mas Abim): akses penuh — verifikasi lembur, lihat rekap gaji, dan **satu-satunya** yang bisa membuka tab "Kelola Akun Admin".
- **HR** (Bu Lis): default cuma bisa lihat tab "Pengajuan Cuti/Izin" (placeholder, belum aktif) dan ganti PIN sendiri.
- **Rekap** (Mbak Tika): default bisa verifikasi lembur + lihat rekap gaji.

Izin tiap role (kecuali Owner) **bisa diubah kapan saja oleh Owner** lewat tab "Kelola Akun Admin" — ceklis per kapabilitas (approve pengajuan / verifikasi lembur / lihat rekap gaji), tanpa perlu developer ubah kode.

**Login:** pilih nama dari dropdown → PIN 4 digit. Login pertama kali (pin_hash masih kosong di tab `Admin`) otomatis jadi "buat PIN baru". Semua admin bisa ganti PIN sendiri kapan saja lewat tab "Ganti PIN Saya" — tidak perlu minta developer.

**SOP kalau ada admin lupa PIN:** Owner buka tab "Kelola Akun Admin" → tombol **Reset PIN** di baris admin itu → admin tsb otomatis diminta buat PIN baru saat login berikutnya. Kalau **Owner sendiri** yang lupa PIN (tidak ada "atasan" di dashboard): kosongkan langsung sel `pin_hash` milik ADM001 di tab `Admin` pada Sheet — SOP yang sama persis dengan reset PIN karyawan.

**Verifikasi Lembur:** tab ini cuma menampilkan sesi lembur yang SUDAH lengkap (Mulai + Selesai tercatat) dan belum diverifikasi. Klik "Verifikasi" untuk menandai sah — setelah itu baru ikut terhitung di Rekap Gaji.

**Rekap Gaji:** pilih bulan, tampil per karyawan: hari Masuk, hari Lengkap (Masuk+Pulang), dan total jam Lembur terverifikasi. **Belum termasuk Cuti/Izin** — menunggu skema Form Izin final.

## Kelola Karyawan (via Sheet langsung)

- **Tambah:** isi baris baru di tab `Karyawan` — `id_karyawan` unik (misal `OKT003`), `nama`, kosongkan `pin_hash`, `status` = `Aktif`, `tanggal_daftar`.
- **Nonaktifkan:** ubah `status` jadi `Nonaktif` (jangan hapus baris — riwayat absen tetap tersimpan).
- **Ubah radius/koordinat:** edit tab `Config` — berlaku langsung tanpa deploy ulang.

## SOP Admin: Reset Akses Karyawan (HP rusak / hilang / ketinggalan)

Satu alur untuk semua kasus (tidak berubah dari sebelumnya):

1. Buka Sheet → tab `Karyawan` → cari baris nama karyawan.
2. Kosongkan sel `pin_hash` (klik sel → Delete).
3. Karyawan buka app di HP mana pun → app otomatis mendeteksi PIN sudah direset dan meminta **Buat PIN Baru** → selesai.

## Testing (Node, lokal — tidak ikut di-deploy ke GitHub Pages)

Folder `tests/` berisi test otomatis yang jalan di Node, bukan bagian dari app yang di-deploy:

- `mockBackend.js` — port manual `apps-script/Code.gs` ke Node (Apps Script API seperti `SpreadsheetApp` tidak ada di Node). **Kalau `Code.gs` diubah, `mockBackend.js` WAJIB diupdate juga** supaya test tetap merepresentasikan backend asli.
- `backend.test.js` — test logic murni (tanpa DOM), jalankan: `node tests/backend.test.js`
- `e2e-karyawan.test.js` — test end-to-end app karyawan pakai jsdom, jalankan: `node tests/e2e-karyawan.test.js` (butuh `npm install jsdom` sekali di folder ini)
- `e2e-admin.test.js` — test end-to-end dashboard admin pakai jsdom, jalankan: `node tests/e2e-admin.test.js`

Status per 2026-07-30: 38 test backend + 12 test e2e karyawan + 11 test e2e admin — **61/61 PASS**.
