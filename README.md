# Absensi Omah Kebon

Aplikasi absensi karyawan Omah Kebon (klien Ndalem AI Tech). PWA mobile-first + Google Apps Script + Google Sheet. Nol biaya operasional.

**Fase saat ini: Fase A (build & testing internal)** — Sheet + Apps Script di akun Google Ndalem AI Tech, frontend di GitHub Pages akun Ndalem AI Tech. Migrasi ke akun klien (Fase B) dilakukan nanti setelah lolos testing.

**Update 2026-08-07:** revisi besar pasca-demo teknis dengan Mas Abim/Mbak Tika/Bu Lis. Ringkasan: tipe absen **Off dihapus** (cukup lewat Izin), **Cuti dibatasi maks 2 hari per pengajuan**, ditambah sistem **Kuota Cuti** (otomatis 12 hari/tahun setelah 1 tahun kerja, bisa di-override manual Owner), approval pengajuan **tanpa dialog catatan** (langsung Setujui/Tolak), Jenis Izin di form karyawan jadi **dropdown**, tombol **back** & **refresh** ditambah di beberapa layar, foto lampiran sekarang bisa dari **galeri** (bukan cuma kamera), tab **Rekap** dirombak (kolom Hari Kerja/Izin/Cuti + filter lengkap + export CSV/PDF), **Kelola Akun Admin** sekarang role bebas teks (bukan cuma Owner/HR/Rekap), dan optimasi **loading terasa instan** saat buka app (lihat bagian Testing/Phase 0 di bawah). Field notifikasi (in-app, push saat app tertutup) **DITUNDA** — belum dikerjakan, nunggu fitur lain stabil dulu.

**Update 2026-07-30 (sore):** ditambah **Pengajuan Izin** — tombol Cuti/Off lama diganti form "Ajukan Izin" yang butuh **persetujuan Owner** sebelum tercatat resmi. Lihat bagian [Pengajuan Izin](#pengajuan-izin-cutisakitizin) di bawah.

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
   - **Kalau Sheet-mu sudah pernah setup sebelumnya** (masih versi lama): tetap jalankan `setupSheet()` ulang — ini AMAN, idempotent. Tab yang belum ada akan dibuat, dan kolom yang belum ada di tab lama (`status_verifikasi` dkk di `Absensi`, `izin_lihat_pengajuan` di `Admin`, **`kuota_cuti_override` di `Karyawan`** — kolom baru 2026-08-07) otomatis ditambahkan TANPA mengubah data yang sudah ada.
   - **Kalau Sheet-mu sudah punya tab `Admin` dari update Lembur (2026-07-30 siang)**: setelah jalankan `setupSheet()` ulang, buka dashboard admin → login sebagai Mas Abim → tab **Kelola Akun Admin** → centang **"Lihat Pengajuan"** untuk Bu Lis (default kosong setelah migrasi, harus dinyalakan manual sekali).
   - **Data lama dengan tipe absen `OFF` atau `IZIN_BIASA`** (dari sebelum 2026-08-07) TIDAK diubah otomatis oleh migrasi — baris lama tetap tersimpan apa adanya di Sheet (histori tidak hilang), cuma tidak akan tertulis lagi ke depannya (Off dihapus, Izin Biasa → Izin).
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
7. Cek tab `Absensi` di Sheet: baris baru dengan `tipe_absen` (MASUK/PULANG/MULAI_LEMBUR/SELESAI_LEMBUR/CUTI/SAKIT/IZIN — 3 tipe terakhir cuma muncul setelah pengajuan disetujui admin, lihat bagian Pengajuan Izin). Tipe **OFF sudah dihapus** sejak 2026-08-07 — kalau butuh menandai hari libur karyawan, pakai Izin.
8. Tab **Riwayat**: kalender bulanan berwarna sesuai tipe dominan hari itu. Prioritas warna: Cuti/Sakit/Izin > Pulang > Masuk > Lembur.
9. Header layar Absen punya **tombol refresh** (ikon bulat) untuk memuat ulang status hari ini secara manual, kalau-kalau ada perubahan dari device lain atau input manual admin.

## Pengajuan Izin (Cuti/Sakit/Izin)

Self-report langsung (tombol Cuti/Off lama) sudah diganti form + approval sejak 2026-07-30.

**Alur karyawan:**
1. Tekan **"Ajukan Izin"** di layar absen (atau tombol **back** di headernya utk batal & kembali) → pilih jenis dari **dropdown** (Cuti/Sakit/Izin) → isi tanggal mulai & selesai → isi alasan → opsional lampirkan foto, sekarang bisa diambil dari **kamera ATAU galeri** (di-resize otomatis di HP sebelum dikirim, maks ~1000px).
   - **Cuti dibatasi maksimal 2 hari per pengajuan** (Sakit/Izin tidak dibatasi sebesar ini, cuma dibatasi umum maks 31 hari/pengajuan). Begitu jenis Cuti dipilih, form langsung menampilkan **sisa kuota cuti tahun ini** karyawan tsb sebelum submit.
2. Kirim → status **PENDING**, langsung diarahkan ke layar **"Pengajuan Saya"** yang menampilkan riwayat semua pengajuan + status (Menunggu/Disetujui/Ditolak).
3. Kalau **disetujui**, sistem otomatis menulis baris di tab `Absensi` untuk SETIAP tanggal dalam rentang (jadi langsung muncul di kalender & otomatis mengunci Masuk/Pulang/Lembur di tanggal itu — pakai ulang mesin saling-eksklusif yang sama dengan absen manual).

**Alur admin (tab "Pengajuan Cuti/Izin" di dashboard):**
- **Owner** (Mas Abim): satu-satunya yang bisa **Setujui/Tolak** — klik tombol langsung eksekusi, **tanpa dialog isi catatan** (disederhanakan 2026-08-07). Baris CUTI di tabel antrean disertai kolom **Sisa Kuota Cuti** sbg bantuan keputusan.
- **HR** (Bu Lis): defaultnya bisa **lihat** antrean + baca lampiran, tapi TIDAK ada tombol putuskan (tab menampilkan pesan "Lihat saja").
- **Rekap** (Mbak Tika): default TIDAK bisa lihat tab ini sama sekali (tidak involve di proses izin).
- Kedua izin ini (`izin_lihat_pengajuan` utk lihat, `izin_approve_pengajuan` utk memutuskan) **bisa diubah Owner kapan saja** lewat "Kelola Akun Admin" — termasuk kalau nanti Mas Abim mau delegasikan wewenang approve ke orang lain.

**Field form (di tab `Pengajuan`, Sheet):** `id_pengajuan, id_karyawan, nama, tipe_izin, tanggal_mulai, tanggal_selesai, jumlah_hari, alasan, lampiran_url, status, diajukan_pada, diputuskan_oleh, diputuskan_pada, catatan_admin`. Kolom `catatan_admin` masih ada di Sheet (utk kompatibilitas data lama) tapi **tidak lagi diisi otomatis** — approval sekarang tanpa dialog catatan.

> ⚠️ Field-field ini masih belum pernah dibandingkan dgn form kertas Mas Abim yang sudah berjalan di lapangan — sudah lewat satu putaran feedback dari Rama (batas 2 hari Cuti, kuota tahunan, dsb) tapi belum tentu final dari sisi Mas Abim sendiri. Kalau ada perbedaan begitu dicek langsung ke lapangan, sesuaikan skema kolom di atas (Code.gs `handleAjukanIzin`/`HEADER_PENGAJUAN` + `mockBackend.js` yang selaras + form di `index.html`/`app.js`).

**Lampiran foto** disimpan di folder Google Drive akun yang menjalankan Apps Script, bernama **"Lampiran Izin - Absensi Omah Kebon"** (dibuat otomatis saat upload pertama), dengan sharing "siapa saja yang punya link bisa lihat" — link-nya disimpan di kolom `lampiran_url`.

## Kuota Cuti

Ditambahkan 2026-08-07. Aturan default (otomatis, tanpa input manual):
- Karyawan yang **belum genap 1 tahun kerja** (dihitung dari `tanggal_daftar` di tab `Karyawan`): kuota **0 hari**.
- Setelah **lewat 1 tahun kerja**: kuota **12 hari/tahun**, TIDAK pro-rata, TIDAK carry-over (sisa tahun lalu hangus tiap pergantian tahun kalender).
- "Terpakai" dihitung dari total `jumlah_hari` pengajuan CUTI berstatus DISETUJUI yang tanggal mulainya jatuh di tahun kalender berjalan.

Owner bisa **menimpa** angka otomatis ini per karyawan lewat tab **"Kuota Cuti Karyawan"** di dashboard admin (khusus Owner) — isi kolom Override lalu klik Simpan; kosongkan lagi utk kembali ke perhitungan otomatis. Disimpan di kolom `kuota_cuti_override` tab `Karyawan`.

## Dashboard Admin (`/admin/`)

Dipakai dari browser biasa (laptop/HP), 3 role bawaan (role lain bisa dibuat bebas — lihat "Kelola Akun Admin" di bawah):

- **Owner** (Mas Abim): akses penuh — verifikasi lembur, putuskan pengajuan izin, lihat rekap, atur kuota cuti, dan **satu-satunya** yang bisa membuka tab "Kelola Akun Admin" & "Kuota Cuti Karyawan".
- **HR** (Bu Lis): default bisa lihat tab "Pengajuan Cuti/Izin" (lihat-saja) dan ganti PIN sendiri.
- **Rekap** (Mbak Tika): default bisa verifikasi lembur + lihat rekap.

Izin tiap role (kecuali Owner) **bisa diubah kapan saja oleh Owner** lewat tab "Kelola Akun Admin" — ceklis per kapabilitas (lihat pengajuan / approve pengajuan / verifikasi lembur / lihat rekap), tanpa perlu developer ubah kode. Header dashboard sekarang punya 2 tombol ikon: **refresh** (muat ulang tab yang sedang dibuka) dan **keluar** (logout).

**Login:** pilih nama dari dropdown → PIN 4 digit. Login pertama kali (pin_hash masih kosong di tab `Admin`) otomatis jadi "buat PIN baru". Semua admin bisa ganti PIN sendiri kapan saja lewat tab "Ganti PIN Saya" — tidak perlu minta developer.

**SOP kalau ada admin lupa PIN:** Owner buka tab "Kelola Akun Admin" → tombol **Reset PIN** di baris admin itu → admin tsb otomatis diminta buat PIN baru saat login berikutnya. Kalau **Owner sendiri** yang lupa PIN (tidak ada "atasan" di dashboard): kosongkan langsung sel `pin_hash` milik ADM001 di tab `Admin` pada Sheet — SOP yang sama persis dengan reset PIN karyawan.

**Kelola Akun Admin:** Role sekarang **BEBAS DIKETIK** (bukan lagi dropdown 3 pilihan tetap) — Owner bisa bikin role apa saja, misalnya "Supervisor". Role yang persis cocok `OWNER`/`HR`/`REKAP` tetap dapat default izin seperti biasa (kompatibel ke belakang); role custom lain dibuat dengan **semua izin nonaktif**, tinggal dicentang manual di tabel begitu akun dibuat.

**Verifikasi Lembur:** tab ini cuma menampilkan sesi lembur yang SUDAH lengkap (Mulai + Selesai tercatat) dan belum diverifikasi. Klik "Verifikasi" untuk menandai sah — setelah itu baru ikut terhitung di Rekap.

**Pengajuan Cuti/Izin:** lihat bagian [Pengajuan Izin](#pengajuan-izin-cutisakitizin) di atas.

**Rekap** (dulu bernama "Rekap Gaji", diringkas 2026-08-07): kolom **Hari Kerja** (dari absen Masuk), **Izin** (Sakit+Izin digabung), **Cuti**, dan **Jam Lembur Terverifikasi**. Filter: bulan (default) ATAU rentang tanggal custom (dari/sampai, mengesampingkan pilihan bulan kalau diisi keduanya), plus filter per karyawan. Tersedia tombol **Unduh CSV** (native, tanpa library) dan **Cetak/Simpan PDF** (lewat dialog cetak browser).

## Kelola Karyawan (via Sheet langsung)

- **Tambah:** isi baris baru di tab `Karyawan` — `id_karyawan` unik (misal `OKT003`), `nama`, kosongkan `pin_hash`, `status` = `Aktif`, `tanggal_daftar`, kosongkan `kuota_cuti_override` (biar pakai perhitungan otomatis).
- **Nonaktifkan:** ubah `status` jadi `Nonaktif` (jangan hapus baris — riwayat absen tetap tersimpan).
- **Ubah radius/koordinat:** edit tab `Config` — berlaku langsung tanpa deploy ulang.
- **Atur kuota cuti manual:** lewat dashboard admin tab "Kuota Cuti Karyawan" (lihat bagian [Kuota Cuti](#kuota-cuti) di atas) — tidak perlu edit Sheet langsung, walau bisa juga lewat kolom `kuota_cuti_override`.

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

Status per 2026-08-07 (revisi pasca-demo + Phase 0 perceived-loading): 56 test backend + 21 test e2e karyawan + 18 test e2e admin — **95/95 PASS**.

### Phase 0 — loading terasa instan

Keluhan yang diperbaiki: "tiap buka app, loading lumayan lama" (baik karyawan maupun admin). Akar masalahnya BUKAN kecepatan tiap request (Apps Script Web App memang selalu punya cold-start ~1-3 detik per panggilan, di luar kendali frontend) — tapi POLA fetch yang serial/berurutan sebelum layar utama tampil.

Perbaikan (2026-08-07): kalau device sudah pernah login sebelumnya, layar utama (Absen utk karyawan, Dashboard utk admin) langsung digambar dari **cache di localStorage** (status absen hari ini / profil admin) SEKETIKA app dibuka — tanpa nunggu jaringan sama sekali. Validasi ke server (`validasiSesi`) tetap jalan di belakang layar, dan kalau ternyata ada yang berubah (PIN direset, izin admin diubah, dll), UI dikoreksi diam-diam. Device baru / belum pernah login tetap lewat layar loading seperti biasa (tidak ada cache utk dipakai). Lihat komentar "Phase 0" di `js/app.js` dan `admin/js/admin.js` utk detail implementasi.
