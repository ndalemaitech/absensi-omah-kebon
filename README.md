# Absensi Omah Kebon

Aplikasi absensi karyawan Omah Kebon (klien Ndalem AI Tech). PWA mobile-first + Google Apps Script + Google Sheet. Nol biaya operasional.

**Fase saat ini: Fase A (build & testing internal)** — Sheet + Apps Script di akun Google Ndalem AI Tech, frontend di GitHub Pages akun Ndalem AI Tech. Migrasi ke akun klien (Fase B) dilakukan nanti setelah lolos testing.

## Struktur Repo

```
├── index.html          # PWA — 3 layar (setup device, absen, kalender riwayat)
├── css/style.css
├── js/config.js        # ← URL Web App Apps Script diisi di sini
├── js/app.js
├── manifest.json       # supaya bisa "Tambahkan ke Layar Utama"
├── sw.js               # service worker (cache app shell)
├── icons/
└── apps-script/Code.gs # backend — di-paste manual ke editor Apps Script
```

## Setup Backend (manual, sekali jalan — pakai akun Google Ndalem AI Tech)

1. **Buat Google Sheet baru** di [sheets.new](https://sheets.new). Beri nama misalnya `Absensi Omah Kebon (Testing)`. Tidak perlu bikin tab/header manual — nanti dibuat otomatis.
2. **Buka editor Apps Script** dari dalam Sheet itu: menu **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu **paste seluruh isi [`apps-script/Code.gs`](apps-script/Code.gs)** dari repo ini. Simpan (Ctrl+S).
4. (Disarankan) Set timezone project: ikon gear ⚙ **Project Settings** → Time zone → `(GMT+07:00) Jakarta`.
5. **Jalankan `setupSheet()` sekali**: di toolbar editor pilih fungsi `setupSheet` → klik **Run** → izinkan otorisasi yang diminta (akses Spreadsheet). Ini otomatis membuat 3 tab (`Karyawan`, `Absensi`, `Config`) lengkap dengan header, koordinat Omah Kebon di Config, dan 2 karyawan contoh untuk testing.
6. **Deploy sebagai Web App**: tombol **Deploy → New deployment** → tipe **Web app** →
   - Description: bebas (misal `v1`)
   - Execute as: **Me**
   - Who has access: **Anyone** ← penting, kalau tidak, frontend tidak bisa akses
   - Klik **Deploy**, lalu **copy URL Web App** (bentuknya `https://script.google.com/macros/s/.../exec`).
7. **Isi URL itu ke [`js/config.js`](js/config.js)** (ganti `PASTE_URL_WEB_APP_DI_SINI`), commit, push.

> **Catatan update backend:** kalau `Code.gs` diubah, cukup **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. URL tidak berubah. Kalau bikin *New deployment* baru, URL berubah dan `config.js` harus diupdate.

## Verifikasi Backend

Buka di browser: `<URL_WEB_APP>?action=getKaryawan` — harus muncul JSON berisi daftar karyawan contoh.

## Frontend (GitHub Pages)

Repo: `https://github.com/ndalemaitech/absensi-omah-kebon` — GitHub Pages aktif dari branch `main`, root. URL app: `https://ndalemaitech.github.io/absensi-omah-kebon/`

Setiap push ke `main` otomatis ter-deploy (tunggu ± 1 menit). Kalau ada perubahan file frontend, **naikkan angka `VERSI` di `sw.js`** supaya HP user mengambil versi baru.

## Alur Pakai (untuk testing)

1. Buka URL app di HP → pilih nama → buat PIN 4 digit (2x) → masuk layar absen.
2. Tekan tombol besar (awalnya **ABSEN MASUK**) → izinkan lokasi → muncul layar sukses dengan tanggal, jam, dan info lokasi tercatat.
3. Setelah SELESAI, tombol yang SAMA otomatis berubah jadi **ABSEN PULANG** (bukan tombol terpisah) — status di bawahnya menampilkan jam masuk. Tekan lagi untuk absen pulang.
4. Setelah masuk & pulang lengkap, tombol nonaktif dan menampilkan "SUDAH LENGKAP" beserta jam masuk & pulang, sampai hari berikutnya (reset otomatis per hari).
5. Absen pulang tidak bisa dilakukan tanpa absen masuk di hari yang sama — backend akan menolak dengan pesan "Anda belum absen masuk hari ini."
6. Cek tab `Absensi` di Sheet: baris baru dengan koordinat, jarak (meter), `status_lokasi`, dan `tipe_absen` (MASUK/PULANG).
7. Tab **Riwayat** di app: tanggal hari ini jadi hijau di kalender segera setelah absen (instan, tidak perlu nunggu network).
8. Chrome Android akan menawarkan **"Tambahkan ke Layar Utama"** (atau lewat menu ⋮).

## SOP Admin: Reset Akses (HP rusak / hilang / ketinggalan)

Satu alur untuk semua kasus:

1. Buka Sheet → tab `Karyawan` → cari baris nama karyawan.
2. Kosongkan sel `pin_hash` (klik sel → Delete).
3. Karyawan buka app di HP mana pun (HP baru, HP lama yang sudah pernah login, atau pinjam HP orang lain) → app otomatis mendeteksi PIN sudah direset dan meminta **Buat PIN Baru** → selesai.

App selalu mengecek status ke server tiap kali dibuka (bukan cuma percaya sesi tersimpan di HP), jadi mengosongkan `pin_hash` langsung "memaksa keluar" device manapun yang sedang login dengan identitas itu — termasuk device lama yang belum sempat diganti. Efek yang sama berlaku kalau `status` diubah jadi `Nonaktif`: device yang sedang login akan otomatis diminta setup ulang (dan tidak akan lolos karena karyawan nonaktif tidak muncul di daftar) — ini jadi tombol darurat kalau HP dicuri/disalahgunakan, cukup ubah `status`, tanpa langkah tambahan lain.

**Catatan untuk testing:** kalau kamu menguji reset ini di HP/browser yang sama yang dipakai login, tutup dan buka ulang app (atau refresh) supaya app menjalankan pengecekan ke server — perubahan di Sheet tidak akan terasa kalau app-nya cuma dibiarkan terbuka di layar yang sama tanpa reload.

## Kelola Karyawan (via Sheet langsung)

- **Tambah:** isi baris baru di tab `Karyawan` — `id_karyawan` unik (misal `OKT003`), `nama`, kosongkan `pin_hash`, `status` = `Aktif`, `tanggal_daftar`.
- **Nonaktifkan:** ubah `status` jadi `Nonaktif` (jangan hapus baris — riwayat absen tetap tersimpan).
- **Ubah radius/koordinat:** edit tab `Config` — berlaku langsung tanpa deploy ulang.
