# Absensi Omah Kebon

Aplikasi absensi karyawan Omah Kebon (klien Ndalem AI Tech). PWA mobile-first + Google Apps Script + Google Sheet. Nol biaya operasional.

**Fase saat ini: Fase A (build & testing internal)** — Sheet + Apps Script di akun Google Ndalem AI Tech, frontend di GitHub Pages akun Ndalem AI Tech. Migrasi ke akun klien (Fase B) dilakukan nanti setelah lolos testing.

**Update 2026-07-30 (sore):** ditambah **Pengajuan Izin** — tombol Cuti/Off lama diganti form "Ajukan Izin" (Cuti/Sakit/Izin Biasa/Off) yang butuh **persetujuan Owner** sebelum tercatat resmi. Lihat bagian [Pengajuan Izin](#pengajuan-izin-cutisakitizin-biasaoff) di bawah. **Field form ini masih HIPOTESIS/tebakan** berdasar pola umum form cuti perusahaan — belum dicocokkan dengan form kertas asli yang dipakai Mas Abim di lapangan. Jangan anggap final sampai dibandingkan.

**Update 2026-07-30 (siang):** ditambah tipe absen **Lembur** (Mulai/Selesai Lembur) dan **dashboard admin** (`/admin/`) dengan 3 role (Owner/HR/Rekap), termasuk verifikasi lembur dan rekap gaji dasar.

## Struktur Repo

```
├── index.html               # PWA karyawan — 5 layar (setup, absen, ajukan izin, pengajuan saya, kalender)
├── css/style.css
├── js/config.js              # ← URL Web App Apps Script diisi di sini (dipakai app karyawan & admin)
├── js/app.js
├── manifest.json             # supaya app karyawan bisa "Tambahkan ke Layar Utama"
├── sw.js                     # service worker (cache app shell KARYAWAN saja, admin tidak)
├── icons/
├── admin/                    # Dashboard admin — TIDAK offline/PWA, butuh internet
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
5. **Jalankan `setupSheet()`**: di toolbar editor pilih fungsi `setupSheet` → klik **Run** → izinkan otorisasi yang diminta (akses Spreadsheet **dan Drive** — Drive dipakai untuk simpan lampiran foto pengajuan izin). Ini otomatis membuat 5 tab (`Karyawan`, `Absensi`, `Config`, `Admin`, `Pengajuan`) lengkap dengan header dan data contoh.
   - **Kalau Sheet-mu sudah pernah setup sebelumnya** (masih versi lama): tetap jalankan `setupSheet()` ulang — ini AMAN, idempotent. Tab yang belum ada (`Admin`, `Pengajuan`) akan dibuat, dan kolom yang belum ada di tab lama (`status_verifikasi` dkk di `Absensi`, `izin_lihat_pengajuan` di `Admin`) otomatis ditambahkan TANPA mengubah data yang sudah ada.
   - **Kalau Sheet-mu sudah punya tab `Admin` dari update Lembur (2026-07-30 siang)**: setelah jalankan `setupSheet()` ulang, buka dashboard admin → login sebagai Mas Abim → tab **Kelola Akun Admin** → centang **"Lihat Pengajuan"** untuk Bu Lis (default kosong setelah migrasi, harus dinyalakan manual sekali).
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
2. Layar absen menampilkan **4 tombol** (MASUK hijau / PULANG kuning / MULAI LEMBUR & SELESAI LEMBUR teal) plus **1 tombol "Ajukan Izin"** terpisah di bawahnya. Warna tombol konsisten di modal konfirmasi, layar sukses, dan kalender.
3. Tekan **MASUK** → izinkan lokasi → layar sukses hijau. Tombol PULANG otomatis aktif.
4. Tekan **PULANG** → hari itu "lengkap". MASUK & PULANG terkunci sampai hari berikutnya.
5. **MULAI LEMBUR** / **SELESAI LEMBUR**: sama pola dgn Masuk/Pulang — butuh lokasi GPS, Selesai Lembur baru bisa ditekan setelah Mulai Lembur tercatat hari itu. **Lembur BOLEH terjadi di hari yang sama dengan Masuk/Pulang** — tapi TETAP terkunci kalau hari itu sudah ada izin yang DISETUJUI. Durasi lembur otomatis dihitung, tapi baru **resmi masuk rekap gaji setelah diverifikasi admin**.
6. Kalau hari ini ada pengajuan izin yang **sudah disetujui** admin, keempat tombol di atas otomatis terkunci (tidak bisa absen di hari izin).
7. Cek tab `Absensi` di Sheet: baris baru dengan `tipe_absen` (MASUK/PULANG/MULAI_LEMBUR/SELESAI_LEMBUR/CUTI/SAKIT/IZIN_BIASA/OFF — 4 tipe terakhir cuma muncul setelah pengajuan disetujui admin, lihat bagian Pengajuan Izin).
8. Tab **Riwayat**: kalender bulanan berwarna sesuai tipe dominan hari itu. Prioritas warna: Cuti/Sakit/Izin/Off > Pulang > Masuk > Lembur.

## Pengajuan Izin (Cuti/Sakit/Izin Biasa/Off)

**Ganti tombol Cuti/Off lama** (self-report langsung) — sekarang lewat form + approval, sesuai keputusan brainstorm 2026-07-30.

**Alur karyawan:**
1. Tekan **"Ajukan Izin"** di layar absen → pilih jenis (Cuti/Sakit/Izin Biasa/Off) → isi tanggal mulai & selesai (boleh rentang beberapa hari, satu kali submit) → isi alasan → opsional lampirkan foto (di-resize otomatis di HP sebelum dikirim, maks ~1000px).
2. Kirim → status **PENDING**, langsung diarahkan ke layar **"Pengajuan Saya"** yang menampilkan riwayat semua pengajuan + status (Menunggu/Disetujui/Ditolak) + catatan admin kalau ada.
3. Kalau **disetujui**, sistem otomatis menulis baris di tab `Absensi` untuk SETIAP tanggal dalam rentang (jadi langsung muncul di kalender & otomatis mengunci Masuk/Pulang/Lembur di tanggal itu — pakai ulang mesin saling-eksklusif yang sama dengan absen manual).

**Alur admin (tab "Pengajuan Cuti/Izin" di dashboard):**
- **Owner** (Mas Abim): satu-satunya yang bisa **Setujui/Tolak**, dengan catatan opsional.
- **HR** (Bu Lis): defaultnya bisa **lihat** antrean + baca lampiran, tapi TIDAK ada tombol putuskan (tab menampilkan pesan "Lihat saja").
- **Rekap** (Mbak Tika): default TIDAK bisa lihat tab ini sama sekali (tidak involve di proses izin).
- Kedua izin ini (`izin_lihat_pengajuan` utk lihat, `izin_approve_pengajuan` utk memutuskan) **bisa diubah Owner kapan saja** lewat "Kelola Akun Admin" — termasuk kalau nanti Mas Abim mau delegasikan wewenang approve ke orang lain.

**Field form (di tab `Pengajuan`, Sheet):** `id_pengajuan, id_karyawan, nama, tipe_izin, tanggal_mulai, tanggal_selesai, jumlah_hari, alasan, lampiran_url, status, diajukan_pada, diputuskan_oleh, diputuskan_pada, catatan_admin`.

> ⚠️ **Field ini masih HIPOTESIS** — disusun dari pola umum form cuti perusahaan Indonesia, BUKAN hasil menyalin form kertas Mas Abim yang sudah berjalan. Yang sengaja belum dimasukkan (nunggu perbandingan): sisa/kuota cuti tahunan, kontak darurat, pengganti tugas/handover selama cuti. Begitu Rama dapat foto form kertas aslinya, bandingkan dan sesuaikan skema kolom di atas (Code.gs `handleAjukanIzin`/`HEADER_PENGAJUAN` + `mockBackend.js` yang selaras + form di `index.html`/`app.js`).

**Lampiran foto** disimpan di folder Google Drive akun yang menjalankan Apps Script, bernama **"Lampiran Izin - Absensi Omah Kebon"** (dibuat otomatis saat upload pertama), dengan sharing "siapa saja yang punya link bisa lihat" — link-nya disimpan di kolom `lampiran_url`.

## Dashboard Admin (`/admin/`)

Dipakai dari browser biasa (laptop/HP), 3 role:

- **Owner** (Mas Abim): akses penuh — verifikasi lembur, putuskan pengajuan izin, lihat rekap gaji, dan **satu-satunya** yang bisa membuka tab "Kelola Akun Admin".
- **HR** (Bu Lis): default bisa lihat tab "Pengajuan Cuti/Izin" (lihat-saja) dan ganti PIN sendiri.
- **Rekap** (Mbak Tika): default bisa verifikasi lembur + lihat rekap gaji.

Izin tiap role (kecuali Owner) **bisa diubah kapan saja oleh Owner** lewat tab "Kelola Akun Admin" — ceklis per kapabilitas (lihat pengajuan / approve pengajuan / verifikasi lembur / lihat rekap gaji), tanpa perlu developer ubah kode.

**Login:** pilih nama dari dropdown → PIN 4 digit. Login pertama kali (pin_hash masih kosong di tab `Admin`) otomatis jadi "buat PIN baru". Semua admin bisa ganti PIN sendiri kapan saja lewat tab "Ganti PIN Saya" — tidak perlu minta developer.

**SOP kalau ada admin lupa PIN:** Owner buka tab "Kelola Akun Admin" → tombol **Reset PIN** di baris admin itu → admin tsb otomatis diminta buat PIN baru saat login berikutnya. Kalau **Owner sendiri** yang lupa PIN (tidak ada "atasan" di dashboard): kosongkan langsung sel `pin_hash` milik ADM001 di tab `Admin` pada Sheet — SOP yang sama persis dengan reset PIN karyawan.

**Verifikasi Lembur:** tab ini cuma menampilkan sesi lembur yang SUDAH lengkap (Mulai + Selesai tercatat) dan belum diverifikasi. Klik "Verifikasi" untuk menandai sah — setelah itu baru ikut terhitung di Rekap Gaji.

**Pengajuan Cuti/Izin:** lihat bagian [Pengajuan Izin](#pengajuan-izin-cutisakitizin-biasaoff) di atas.

**Rekap Gaji:** pilih bulan, tampil per karyawan: hari Masuk, hari Lengkap (Masuk+Pulang), dan total jam Lembur terverifikasi. **Belum termasuk hari Cuti/Sakit/Izin/Off** — bisa ditambahkan kalau dibutuhkan, setelah field final disepakati.

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

- `mockBackend.js` — port manual `apps-script/Code.gs` ke Node (Apps Script API seperti `SpreadsheetApp`/`DriveApp` tidak ada di Node — upload lampiran Drive DI-MOCK, cukup utk menguji alur bukan penyimpanan file sungguhan). **Kalau `Code.gs` diubah, `mockBackend.js` WAJIB diupdate juga** supaya test tetap merepresentasikan backend asli.
- `backend.test.js` — test logic murni (tanpa DOM), jalankan: `node tests/backend.test.js`
- `e2e-karyawan.test.js` — test end-to-end app karyawan pakai jsdom, jalankan: `node tests/e2e-karyawan.test.js` (butuh `npm install jsdom` sekali di folder ini)
- `e2e-admin.test.js` — test end-to-end dashboard admin pakai jsdom, jalankan: `node tests/e2e-admin.test.js`

Status per 2026-07-30 (update Pengajuan Izin): 42 test backend + 14 test e2e karyawan + 14 test e2e admin — **70/70 PASS**.
