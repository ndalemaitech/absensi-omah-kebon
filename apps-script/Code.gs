/**
 * Absensi Omah Kebon — Backend (Google Apps Script Web App)
 * Vendor: Ndalem AI Tech
 *
 * Endpoint karyawan (routing berbasis parameter "action"):
 *   GET  ?action=getKaryawan                 → daftar karyawan aktif untuk dropdown
 *   POST action=login   {id_karyawan, pin, buat_baru}  → verifikasi PIN / set PIN baru
 *   POST action=absen   {id_karyawan, lat, lng, tipe_absen} → catat absen
 *        tipe_absen: "MASUK", "PULANG", "MULAI_LEMBUR", atau "SELESAI_LEMBUR" SAJA.
 *        - Semua tipe ini wajib sertakan lat/lng (perlu verifikasi lokasi).
 *        - PULANG ditolak kalau belum ada MASUK di hari yang sama.
 *        - SELESAI_LEMBUR ditolak kalau belum ada MULAI_LEMBUR di hari yang sama.
 *        - Ditolak kalau hari itu sudah ada Cuti/Sakit/Izin Biasa/Off yang DISETUJUI
 *          (lihat fitur Pengajuan Izin di bawah — cuti/off TIDAK LAGI bisa
 *          di-self-report langsung dari layar absen sejak 2026-07-30).
 *   GET  ?action=riwayat&id_karyawan=..&bulan=YYYY-MM → data absen 1 bulan
 *
 * Endpoint admin dashboard (ditambahkan 2026-07-30 — fitur Lembur + Dashboard Admin):
 *   GET  ?action=getDaftarAdmin              → daftar semua akun admin (dipakai dropdown
 *                                               login & validasi sesi, sama filosofi dengan
 *                                               getKaryawan — publik, trust berbasis device fisik)
 *   POST action=adminLogin {id_admin, pin}   → verifikasi PIN admin / set PIN pertama kali
 *   POST action=adminGantiPin {id_admin, pin_lama, pin_baru} → ganti PIN sendiri (self-service)
 *   POST action=adminSimpanAkun {actor_id_admin, mode, ...}  → KHUSUS OWNER: kelola akun admin
 *        mode: 'tambah' {nama, role} | 'reset_pin' {target_id_admin}
 *            | 'nonaktifkan'/'aktifkan' {target_id_admin}
 *            | 'edit_izin' {target_id_admin, izin_approve_pengajuan?, izin_verifikasi_lembur?,
 *                            izin_lihat_rekap_gaji?, izin_lihat_pengajuan?}
 *   GET  ?action=getAntreanLembur&actor_id_admin=..         → sesi lembur (mulai+selesai lengkap)
 *                                                               yang belum diverifikasi. Butuh izin
 *                                                               izin_verifikasi_lembur atau role OWNER.
 *   POST action=verifikasiLembur {actor_id_admin, id_karyawan, tanggal} → tandai sesi lembur
 *        tanggal itu TERVERIFIKASI. Butuh izin izin_verifikasi_lembur atau role OWNER.
 *   GET  ?action=getRekapGaji&actor_id_admin=..&bulan=YYYY-MM → rekap dasar per karyawan
 *        (hari masuk, hari lengkap, jam lembur terverifikasi). BELUM termasuk cuti/izin.
 *        Butuh izin izin_lihat_rekap_gaji atau role OWNER.
 *
 * Endpoint Pengajuan Izin (Cuti/Sakit/Izin Biasa/Off — ditambahkan 2026-07-30):
 *   POST action=ajukanIzin {id_karyawan, tipe_izin, tanggal_mulai, tanggal_selesai, alasan,
 *                            lampiran_base64?, lampiran_mime?, lampiran_nama?}
 *        → karyawan submit pengajuan baru, status awal selalu PENDING. tipe_izin salah satu
 *          dari CUTI/SAKIT/IZIN_BIASA/OFF. Lampiran opsional (foto, sudah dikompresi di
 *          client sebelum dikirim), diunggah ke folder Drive khusus.
 *   GET  ?action=getPengajuanSaya&id_karyawan=..   → riwayat pengajuan milik karyawan itu sendiri
 *   GET  ?action=getAntreanPengajuan&actor_id_admin=..  → daftar pengajuan berstatus PENDING.
 *        Butuh izin izin_lihat_pengajuan atau role OWNER (lihat-saja, BUKAN otomatis boleh
 *        memutuskan — lihat model izin di bawah).
 *   POST action=putuskanPengajuan {actor_id_admin, id_pengajuan, keputusan, catatan_admin?}
 *        → keputusan: DISETUJUI atau DITOLAK. Butuh izin izin_approve_pengajuan atau role
 *          OWNER. Kalau DISETUJUI, sistem otomatis menulis baris di tab Absensi untuk SETIAP
 *          tanggal dalam rentang (tipe_absen = tipe_izin), memakai ulang mesin saling-eksklusif
 *          yang sama dengan absen manual (lihat tulisAbsenTidakHadir) — supaya kalender &
 *          guard bentrok Masuk/Pulang/Lembur otomatis konsisten tanpa kode terpisah.
 *
 *   Model izin admin: role OWNER selalu boleh semua aksi (bypass semua pengecekan izin).
 *   Role lain (HR/REKAP) diatur lewat kolom izin_* yang bisa diubah OWNER kapan saja lewat
 *   adminSimpanAkun mode 'edit_izin' — TIDAK hardcode di kode, supaya Mas Abim bisa geser
 *   wewenang Mbak Tika/Bu Lis sendiri tanpa minta developer ubah kode. Catatan khusus fitur
 *   Pengajuan: izin_lihat_pengajuan (lihat antrean & baca detail) SENGAJA dipisah dari
 *   izin_approve_pengajuan (boleh memutuskan) — supaya Bu Lis (HR) bisa diberi akses lihat
 *   tanpa otomatis punya wewenang memutuskan, sesuai keputusan bisnis: approve/reject Cuti/
 *   Izin cuma dipegang Mas Abim, Bu Lis cuma lihat & bisa dikasih akses baca (lihat MEMORY.md).
 *   Satu-satunya hal yang TETAP hardcode (tidak bisa diubah lewat dashboard oleh siapa pun):
 *   hanya role === 'OWNER' yang boleh memanggil adminSimpanAkun sama sekali.
 *
 * Script ini HARUS bound ke Google Sheet-nya (dibuat lewat menu
 * Extensions → Apps Script dari dalam Sheet).
 *
 * Setup awal / migrasi: jalankan fungsi setupSheet() dari editor Apps Script untuk
 * membuat tab Karyawan, Absensi, Config, Admin, dan (baru) Pengajuan — lengkap dengan
 * header dan data contoh. AMAN dijalankan ulang kapan saja (idempotent): tab yang sudah
 * ada tidak ditimpa, kolom yang hilang otomatis ditambahkan tanpa mengubah data lama.
 */

var TIMEZONE = 'Asia/Jakarta';

var SHEET_KARYAWAN = 'Karyawan';
var SHEET_ABSENSI = 'Absensi';
var SHEET_CONFIG = 'Config';
var SHEET_ADMIN = 'Admin';
var SHEET_PENGAJUAN = 'Pengajuan';

// Nilai default tab Config (Fase A — build & testing)
var DEFAULT_CONFIG = {
  lokasi_kantor_lat: -7.3234422729931525,
  lokasi_kantor_lng: 110.19331425092193,
  radius_toleransi_m: 1000
};

// ===================== ROUTING =====================

function doGet(e) {
  try {
    var action = (e.parameter.action || '').trim();
    if (action === 'getKaryawan') return jsonOut(handleGetKaryawan());
    if (action === 'riwayat') return jsonOut(handleRiwayat(e.parameter));
    if (action === 'getDaftarAdmin') return jsonOut(handleGetDaftarAdmin());
    if (action === 'getAntreanLembur') return jsonOut(handleGetAntreanLembur(e.parameter.actor_id_admin));
    if (action === 'getRekapGaji') return jsonOut(handleGetRekapGaji(e.parameter.actor_id_admin, e.parameter.bulan));
    if (action === 'getPengajuanSaya') return jsonOut(handleGetPengajuanSaya(e.parameter.id_karyawan));
    if (action === 'getAntreanPengajuan') return jsonOut(handleGetAntreanPengajuan(e.parameter.actor_id_admin));
    return jsonOut({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var action = (body.action || '').trim();
    if (action === 'login') return jsonOut(handleLogin(body));
    if (action === 'absen') return jsonOut(handleAbsen(body));
    if (action === 'adminLogin') return jsonOut(handleAdminLogin(body));
    if (action === 'adminGantiPin') return jsonOut(handleAdminGantiPin(body));
    if (action === 'adminSimpanAkun') return jsonOut(handleAdminSimpanAkun(body));
    if (action === 'verifikasiLembur') return jsonOut(handleVerifikasiLembur(body));
    if (action === 'ajukanIzin') return jsonOut(handleAjukanIzin(body));
    if (action === 'putuskanPengajuan') return jsonOut(handlePutuskanPengajuan(body));
    return jsonOut({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ===================== ENDPOINT: getKaryawan =====================

function handleGetKaryawan() {
  var rows = getSheet(SHEET_KARYAWAN).getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue; // baris kosong
    if (String(r[3]).trim().toLowerCase() !== 'aktif') continue;
    list.push({
      id_karyawan: String(r[0]).trim(),
      nama: String(r[1]).trim(),
      // pin_hash kosong → frontend tampilkan layar "Buat PIN Baru"
      perlu_pin_baru: String(r[2]).trim() === ''
    });
  }
  return { ok: true, karyawan: list };
}

// ===================== ENDPOINT: login =====================

function handleLogin(body) {
  var id = String(body.id_karyawan || '').trim();
  var pin = String(body.pin || '').trim();
  if (!id || !/^\d{4}$/.test(pin)) {
    return { ok: false, error: 'PIN harus 4 angka.' };
  }

  var sheet = getSheet(SHEET_KARYAWAN);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (String(rows[i][3]).trim().toLowerCase() !== 'aktif') {
      return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };
    }
    var nama = String(rows[i][1]).trim();
    var storedHash = String(rows[i][2]).trim();

    if (storedHash === '') {
      // pin_hash kosong → PIN yang dikirim disimpan sebagai PIN baru
      sheet.getRange(i + 1, 3).setValue(hashPin(id, pin));
      return { ok: true, id_karyawan: id, nama: nama, pin_baru_dibuat: true };
    }

    if (hashPin(id, pin) === storedHash) {
      return { ok: true, id_karyawan: id, nama: nama, pin_baru_dibuat: false };
    }
    return { ok: false, error: 'PIN salah. Coba lagi.' };
  }
  return { ok: false, error: 'Karyawan tidak ditemukan.' };
}

function hashPin(idPemilik, pin) {
  // Salt dengan id pemilik (karyawan ATAU admin) supaya PIN sama tidak
  // menghasilkan hash sama antar akun.
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    idPemilik + ':' + pin,
    Utilities.Charset.UTF_8
  );
  return digest
    .map(function (b) {
      var v = (b + 256) % 256;
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
}

// ===================== ENDPOINT: absen =====================

// Sejak 2026-07-30: action=absen HANYA menerima 4 tipe ini (kelompok Hadir +
// Lembur). Cuti/Sakit/Izin Biasa/Off TIDAK LAGI bisa di-self-report langsung
// dari sini — semua lewat alur Pengajuan Izin (ajukanIzin → approval Owner →
// baru ditulis ke Absensi lewat tulisAbsenTidakHadir). Lihat komentar atas file.
var KELOMPOK_HADIR = ['MASUK', 'PULANG'];
var KELOMPOK_LEMBUR = ['MULAI_LEMBUR', 'SELESAI_LEMBUR'];
var TIPE_ABSEN_LANGSUNG = KELOMPOK_HADIR.concat(KELOMPOK_LEMBUR);
// Kelompok "tidak hadir" — sekarang 4 tipe (dulu cuma Cuti/Off), semuanya
// datang dari Pengajuan Izin yang disetujui. Saling eksklusif satu sama lain
// DAN eksklusif terhadap Hadir+Lembur (lihat tulisAbsenTidakHadir).
var KELOMPOK_TIDAK_HADIR = ['CUTI', 'SAKIT', 'IZIN_BIASA', 'OFF'];
var LABEL_TIPE = {
  MASUK: 'masuk',
  PULANG: 'pulang',
  MULAI_LEMBUR: 'mulai lembur',
  SELESAI_LEMBUR: 'selesai lembur',
  CUTI: 'cuti',
  SAKIT: 'sakit',
  IZIN_BIASA: 'izin',
  OFF: 'off'
};

function handleAbsen(body) {
  var id = String(body.id_karyawan || '').trim();
  var tipe = String(body.tipe_absen || 'MASUK').trim().toUpperCase();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  if (TIPE_ABSEN_LANGSUNG.indexOf(tipe) === -1) {
    if (KELOMPOK_TIDAK_HADIR.indexOf(tipe) !== -1) {
      return { ok: false, error: 'Cuti/Sakit/Izin/Off sekarang lewat menu "Ajukan Izin", bukan absen langsung.' };
    }
    return { ok: false, error: 'tipe_absen tidak dikenal: ' + tipe };
  }

  var lat = parseFloat(body.lat);
  var lng = parseFloat(body.lng);
  if (isNaN(lat) || isNaN(lng)) {
    return { ok: false, error: 'Lokasi GPS tidak terbaca. Coba lagi.' };
  }

  var karyawan = findKaryawan(id);
  if (!karyawan) return { ok: false, error: 'Karyawan tidak ditemukan.' };
  if (karyawan.status.toLowerCase() !== 'aktif') {
    return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };
  }

  // LockService: cegah double-submit menulis dua baris di waktu bersamaan
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    var tanggal = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    var waktu = Utilities.formatDate(now, TIMEZONE, 'HH:mm:ss');

    // Absen pulang cuma masuk akal kalau sudah ada absen masuk hari itu.
    if (tipe === 'PULANG') {
      var sudahMasuk = cariAbsenHariIni(id, tanggal, 'MASUK');
      if (!sudahMasuk) {
        return { ok: false, error: 'Anda belum absen masuk hari ini. Absen masuk dulu.' };
      }
    }
    // Sama halnya, Selesai Lembur cuma masuk akal kalau sudah Mulai Lembur.
    if (tipe === 'SELESAI_LEMBUR') {
      var sudahMulaiLembur = cariAbsenHariIni(id, tanggal, 'MULAI_LEMBUR');
      if (!sudahMulaiLembur) {
        return { ok: false, error: 'Anda belum mulai lembur hari ini. Mulai lembur dulu.' };
      }
    }

    // Kalau hari ini sudah ada Cuti/Sakit/Izin/Off yang DISETUJUI (ditulis
    // lewat tulisAbsenTidakHadir), tolak absen Hadir/Lembur hari itu.
    for (var i = 0; i < KELOMPOK_TIDAK_HADIR.length; i++) {
      var bentrok = cariAbsenHariIni(id, tanggal, KELOMPOK_TIDAK_HADIR[i]);
      if (bentrok) {
        return {
          ok: false,
          error: 'Hari ini sudah ditandai ' + LABEL_TIPE[KELOMPOK_TIDAK_HADIR[i]].toUpperCase() + ', tidak bisa ' + LABEL_TIPE[tipe] + '.'
        };
      }
    }

    var sudah = cariAbsenHariIni(id, tanggal, tipe);
    if (sudah) {
      return {
        ok: true,
        sudah_absen: true,
        tipe_absen: tipe,
        tanggal: tanggal,
        waktu: sudah.waktu,
        pesan: 'Sudah tercatat ' + LABEL_TIPE[tipe] + ' hari ini jam ' + sudah.waktu.substring(0, 5)
      };
    }

    var config = getConfig();
    var jarak = Math.round(haversineMeter(lat, lng, config.lokasi_kantor_lat, config.lokasi_kantor_lng));
    var statusLokasi = jarak <= config.radius_toleransi_m ? 'DALAM_RADIUS' : 'DILUAR_RADIUS';
    var statusVerifikasi = KELOMPOK_LEMBUR.indexOf(tipe) !== -1 ? 'BELUM_DIVERIFIKASI' : 'TIDAK_BERLAKU';

    var idAbsen = 'ABS-' + Utilities.formatDate(now, TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + id;
    getSheet(SHEET_ABSENSI).appendRow([
      idAbsen,
      id,
      karyawan.nama,
      tanggal,
      waktu,
      tipe,
      lat,
      lng,
      jarak,
      statusLokasi,
      '', // catatan — hanya diisi admin/sistem untuk baris input manual/pengajuan
      statusVerifikasi, // relevan khusus utk MULAI_LEMBUR/SELESAI_LEMBUR
      '', // diverifikasi_oleh
      ''  // waktu_verifikasi
    ]);

    return {
      ok: true,
      sudah_absen: false,
      tipe_absen: tipe,
      tanggal: tanggal,
      waktu: waktu,
      jarak_dari_kantor_m: jarak,
      status_lokasi: statusLokasi
    };
  } finally {
    lock.releaseLock();
  }
}

// Dipakai KHUSUS oleh alur approval Pengajuan Izin (handlePutuskanPengajuan)
// untuk menulis baris Cuti/Sakit/Izin Biasa/Off ke Absensi — TIDAK dipanggil
// dari action=absen publik. Tidak butuh lokasi (statusLokasi TIDAK_BERLAKU,
// sama seperti desain Cuti/Off yang lama). Melewati tanggal yang bentrok
// (skip, bukan gagal total) supaya approval rentang tanggal tetap jalan
// sebisa mungkin walau satu-dua hari di tengahnya sudah ada catatan lain.
function tulisAbsenTidakHadir(idKaryawan, nama, tanggal, tipe, catatan) {
  var kelompokHadirLembur = KELOMPOK_HADIR.concat(KELOMPOK_LEMBUR);
  for (var h = 0; h < kelompokHadirLembur.length; h++) {
    if (cariAbsenHariIni(idKaryawan, tanggal, kelompokHadirLembur[h])) {
      return { ok: false, alasan: 'sudah ada catatan ' + LABEL_TIPE[kelompokHadirLembur[h]] + ' hari itu' };
    }
  }
  for (var g = 0; g < KELOMPOK_TIDAK_HADIR.length; g++) {
    if (KELOMPOK_TIDAK_HADIR[g] === tipe) continue;
    if (cariAbsenHariIni(idKaryawan, tanggal, KELOMPOK_TIDAK_HADIR[g])) {
      return { ok: false, alasan: 'hari itu sudah ditandai ' + LABEL_TIPE[KELOMPOK_TIDAK_HADIR[g]] };
    }
  }
  var sudah = cariAbsenHariIni(idKaryawan, tanggal, tipe);
  if (sudah) return { ok: true, sudahAda: true };

  var idAbsen = 'ABS-' + tanggal.replace(/-/g, '') + '-IZIN-' + idKaryawan;
  getSheet(SHEET_ABSENSI).appendRow([
    idAbsen, idKaryawan, nama, tanggal, '00:00:00', tipe,
    '', '', '', 'TIDAK_BERLAKU', catatan || '', 'TIDAK_BERLAKU', '', ''
  ]);
  return { ok: true };
}

function cariAbsenHariIni(idKaryawan, tanggal, tipe) {
  var rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (
      String(rows[i][1]).trim() === idKaryawan &&
      normalisasiTanggal(rows[i][3]) === tanggal &&
      String(rows[i][5]).trim().toUpperCase() === tipe
    ) {
      return { waktu: normalisasiWaktu(rows[i][4]) };
    }
  }
  return null;
}

function haversineMeter(lat1, lng1, lat2, lng2) {
  var R = 6371000; // radius bumi dalam meter
  var toRad = function (d) {
    return (d * Math.PI) / 180;
  };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===================== ENDPOINT: riwayat =====================

function handleRiwayat(params) {
  var id = String(params.id_karyawan || '').trim();
  var bulan = String(params.bulan || '').trim(); // format YYYY-MM
  if (!id || !/^\d{4}-\d{2}$/.test(bulan)) {
    return { ok: false, error: 'Parameter id_karyawan dan bulan (YYYY-MM) wajib.' };
  }

  var rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  var records = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== id) continue;
    var tanggal = normalisasiTanggal(rows[i][3]);
    if (tanggal.substring(0, 7) !== bulan) continue;
    records.push({
      tanggal: tanggal,
      waktu: normalisasiWaktu(rows[i][4]),
      tipe_absen: String(rows[i][5]).trim().toUpperCase(),
      status_lokasi: String(rows[i][9]).trim()
    });
  }
  return { ok: true, bulan: bulan, records: records };
}

// ===================== ADMIN: login & self-service PIN =====================

function adminProfilDariBaris(row) {
  return {
    id_admin: String(row[0]).trim(),
    nama: String(row[1]).trim(),
    role: String(row[2]).trim().toUpperCase(),
    perlu_pin_baru: String(row[3]).trim() === '',
    status: String(row[4]).trim(),
    izin_approve_pengajuan: castBool(row[5]),
    izin_verifikasi_lembur: castBool(row[6]),
    izin_lihat_rekap_gaji: castBool(row[7]),
    izin_lihat_pengajuan: castBool(row[9])
  };
}

function castBool(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function findAdmin(id) {
  var rows = getSheet(SHEET_ADMIN).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return adminProfilDariBaris(rows[i]);
  }
  return null;
}

// Owner selalu lolos semua pengecekan izin. Role lain butuh flag izin_* TRUE.
function requireIzin(idAdmin, izinKey) {
  var admin = findAdmin(idAdmin);
  if (!admin) return { ok: false, error: 'Akun admin tidak ditemukan.' };
  if (admin.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Akun admin sudah tidak aktif.' };
  if (admin.role === 'OWNER') return { ok: true, admin: admin };
  if (izinKey && !admin[izinKey]) return { ok: false, error: 'Anda tidak punya izin untuk aksi ini.' };
  return { ok: true, admin: admin };
}

// Khusus aksi kelola akun admin — SENGAJA hardcode role==='OWNER', bukan flag
// izin_* yang bisa diubah dari dashboard. Ini satu-satunya hal yang tidak bisa
// digeser siapa pun lewat UI, supaya kendali akun admin selalu berawal dari
// Mas Abim (lihat catatan di komentar atas file).
function requireOwner(idAdmin) {
  var admin = findAdmin(idAdmin);
  if (!admin) return { ok: false, error: 'Akun admin tidak ditemukan.' };
  if (admin.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Akun admin sudah tidak aktif.' };
  if (admin.role !== 'OWNER') return { ok: false, error: 'Hanya Owner yang bisa melakukan ini.' };
  return { ok: true, admin: admin };
}

function handleGetDaftarAdmin() {
  var rows = getSheet(SHEET_ADMIN).getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    list.push(adminProfilDariBaris(rows[i]));
  }
  return { ok: true, admin: list };
}

function handleAdminLogin(body) {
  var id = String(body.id_admin || '').trim();
  var pin = String(body.pin || '').trim();
  if (!id || !/^\d{4}$/.test(pin)) {
    return { ok: false, error: 'PIN harus 4 angka.' };
  }

  var sheet = getSheet(SHEET_ADMIN);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (String(rows[i][4]).trim().toLowerCase() !== 'aktif') {
      return { ok: false, error: 'Akun admin sudah tidak aktif. Hubungi Owner.' };
    }
    var storedHash = String(rows[i][3]).trim();

    if (storedHash === '') {
      sheet.getRange(i + 1, 4).setValue(hashPin(id, pin));
      var profilBaru = adminProfilDariBaris(sheet.getRange(i + 1, 1, 1, 10).getValues()[0]);
      profilBaru.ok = true;
      profilBaru.pin_baru_dibuat = true;
      return profilBaru;
    }

    if (hashPin(id, pin) === storedHash) {
      var profil = adminProfilDariBaris(rows[i]);
      profil.ok = true;
      profil.pin_baru_dibuat = false;
      return profil;
    }
    return { ok: false, error: 'PIN salah. Coba lagi.' };
  }
  return { ok: false, error: 'Akun admin tidak ditemukan.' };
}

function handleAdminGantiPin(body) {
  var id = String(body.id_admin || '').trim();
  var pinLama = String(body.pin_lama || '').trim();
  var pinBaru = String(body.pin_baru || '').trim();
  if (!/^\d{4}$/.test(pinBaru)) return { ok: false, error: 'PIN baru harus 4 angka.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(SHEET_ADMIN);
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== id) continue;
      var storedHash = String(rows[i][3]).trim();
      if (storedHash !== '' && hashPin(id, pinLama) !== storedHash) {
        return { ok: false, error: 'PIN lama salah.' };
      }
      sheet.getRange(i + 1, 4).setValue(hashPin(id, pinBaru));
      return { ok: true };
    }
    return { ok: false, error: 'Akun admin tidak ditemukan.' };
  } finally {
    lock.releaseLock();
  }
}

// ===================== ADMIN: kelola akun (khusus Owner) =====================

function buatIdAdminBaru(rows) {
  var maxNum = 0;
  for (var i = 1; i < rows.length; i++) {
    var m = /^ADM(\d+)$/.exec(String(rows[i][0]).trim());
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  var nomorBaru = maxNum + 1;
  var nomorStr = String(nomorBaru);
  while (nomorStr.length < 3) nomorStr = '0' + nomorStr;
  return 'ADM' + nomorStr;
}

function handleAdminSimpanAkun(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireOwner(actorId);
  if (!cek.ok) return cek;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var mode = String(body.mode || '').trim();
    var sheet = getSheet(SHEET_ADMIN);
    var rows = sheet.getDataRange().getValues();

    if (mode === 'tambah') {
      var nama = String(body.nama || '').trim();
      var role = String(body.role || '').trim().toUpperCase();
      if (!nama) return { ok: false, error: 'Nama wajib diisi.' };
      if (['OWNER', 'HR', 'REKAP'].indexOf(role) === -1) {
        return { ok: false, error: 'Role tidak dikenal: ' + role };
      }
      var idBaru = buatIdAdminBaru(rows);
      var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
      sheet.appendRow([
        idBaru,
        nama,
        role,
        '',
        'Aktif',
        role === 'OWNER',
        role === 'OWNER' || role === 'REKAP',
        role === 'OWNER' || role === 'REKAP',
        today,
        role === 'OWNER' || role === 'HR'
      ]);
      return { ok: true, id_admin: idBaru };
    }

    var targetId = String(body.target_id_admin || '').trim();
    var rowIdx = -1;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === targetId) {
        rowIdx = i + 1;
        break;
      }
    }
    if (rowIdx === -1) return { ok: false, error: 'Akun admin target tidak ditemukan.' };

    if (mode === 'reset_pin') {
      sheet.getRange(rowIdx, 4).setValue('');
      return { ok: true };
    }
    if (mode === 'nonaktifkan') {
      if (targetId === actorId) return { ok: false, error: 'Tidak bisa menonaktifkan akun sendiri.' };
      sheet.getRange(rowIdx, 5).setValue('Nonaktif');
      return { ok: true };
    }
    if (mode === 'aktifkan') {
      sheet.getRange(rowIdx, 5).setValue('Aktif');
      return { ok: true };
    }
    if (mode === 'edit_izin') {
      if (body.izin_approve_pengajuan !== undefined) sheet.getRange(rowIdx, 6).setValue(!!body.izin_approve_pengajuan);
      if (body.izin_verifikasi_lembur !== undefined) sheet.getRange(rowIdx, 7).setValue(!!body.izin_verifikasi_lembur);
      if (body.izin_lihat_rekap_gaji !== undefined) sheet.getRange(rowIdx, 8).setValue(!!body.izin_lihat_rekap_gaji);
      if (body.izin_lihat_pengajuan !== undefined) sheet.getRange(rowIdx, 10).setValue(!!body.izin_lihat_pengajuan);
      return { ok: true };
    }
    return { ok: false, error: 'mode tidak dikenal: ' + mode };
  } finally {
    lock.releaseLock();
  }
}

// ===================== ADMIN: verifikasi Lembur =====================

function hitungDurasiMenit(waktuMulai, waktuSelesai) {
  var a = String(waktuMulai).split(':');
  var b = String(waktuSelesai).split(':');
  var menitMulai = parseInt(a[0], 10) * 60 + parseInt(a[1], 10);
  var menitSelesai = parseInt(b[0], 10) * 60 + parseInt(b[1], 10);
  var selisih = menitSelesai - menitMulai;
  if (selisih < 0) selisih += 24 * 60; // jaga-jaga kalau lembur lewat tengah malam
  return selisih;
}

function handleGetAntreanLembur(actorId) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_verifikasi_lembur');
  if (!cek.ok) return cek;

  var rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  var sesi = {}; // key: id_karyawan + '|' + tanggal
  for (var i = 1; i < rows.length; i++) {
    var tipe = String(rows[i][5]).trim().toUpperCase();
    if (tipe !== 'MULAI_LEMBUR' && tipe !== 'SELESAI_LEMBUR') continue;
    var idK = String(rows[i][1]).trim();
    var tgl = normalisasiTanggal(rows[i][3]);
    var key = idK + '|' + tgl;
    if (!sesi[key]) sesi[key] = { id_karyawan: idK, nama: String(rows[i][2]).trim(), tanggal: tgl };
    if (tipe === 'MULAI_LEMBUR') {
      sesi[key].mulai = normalisasiWaktu(rows[i][4]);
      sesi[key].verifMulai = String(rows[i][11]).trim();
    } else {
      sesi[key].selesai = normalisasiWaktu(rows[i][4]);
      sesi[key].verifSelesai = String(rows[i][11]).trim();
    }
  }

  var hasil = [];
  for (var key2 in sesi) {
    var s = sesi[key2];
    if (!s.mulai || !s.selesai) continue; // sesi belum lengkap, jangan tampil dulu
    if (s.verifMulai === 'TERVERIFIKASI' && s.verifSelesai === 'TERVERIFIKASI') continue;
    hasil.push({
      id_karyawan: s.id_karyawan,
      nama: s.nama,
      tanggal: s.tanggal,
      mulai: s.mulai,
      selesai: s.selesai,
      durasi_menit: hitungDurasiMenit(s.mulai, s.selesai)
    });
  }
  hasil.sort(function (a, b) {
    return a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0;
  });
  return { ok: true, antrean: hasil };
}

function handleVerifikasiLembur(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireIzin(actorId, 'izin_verifikasi_lembur');
  if (!cek.ok) return cek;

  var idK = String(body.id_karyawan || '').trim();
  var tanggal = String(body.tanggal || '').trim();
  if (!idK || !tanggal) return { ok: false, error: 'id_karyawan dan tanggal wajib diisi.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(SHEET_ABSENSI);
    var rows = sheet.getDataRange().getValues();
    var now = new Date();
    var waktuVerif = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var ditemukanMulai = false;
    var ditemukanSelesai = false;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).trim() !== idK) continue;
      if (normalisasiTanggal(rows[i][3]) !== tanggal) continue;
      var tipe = String(rows[i][5]).trim().toUpperCase();
      if (tipe !== 'MULAI_LEMBUR' && tipe !== 'SELESAI_LEMBUR') continue;
      sheet.getRange(i + 1, 12).setValue('TERVERIFIKASI');
      sheet.getRange(i + 1, 13).setValue(cek.admin.nama);
      sheet.getRange(i + 1, 14).setValue(waktuVerif);
      if (tipe === 'MULAI_LEMBUR') ditemukanMulai = true;
      else ditemukanSelesai = true;
    }
    if (!ditemukanMulai || !ditemukanSelesai) {
      return { ok: false, error: 'Sesi lembur mulai/selesai untuk tanggal ini tidak lengkap.' };
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ===================== ADMIN: rekap gaji (dasar) =====================

function handleGetRekapGaji(actorId, bulan) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_lihat_rekap_gaji');
  if (!cek.ok) return cek;
  bulan = String(bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulan)) return { ok: false, error: 'Parameter bulan (YYYY-MM) wajib.' };

  var karyawanRows = getSheet(SHEET_KARYAWAN).getDataRange().getValues();
  var rekap = {};
  for (var i = 1; i < karyawanRows.length; i++) {
    var idK = String(karyawanRows[i][0]).trim();
    if (!idK) continue;
    rekap[idK] = {
      id_karyawan: idK,
      nama: String(karyawanRows[i][1]).trim(),
      hari_masuk: 0,
      hari_lengkap: 0,
      menit_lembur_terverifikasi: 0
    };
  }

  var rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  var lemburPerHari = {};
  for (var j = 1; j < rows.length; j++) {
    var idKar = String(rows[j][1]).trim();
    var tgl = normalisasiTanggal(rows[j][3]);
    if (tgl.substring(0, 7) !== bulan) continue;
    if (!rekap[idKar]) continue;
    var tipe = String(rows[j][5]).trim().toUpperCase();
    if (tipe === 'MASUK') rekap[idKar].hari_masuk += 1;
    if (tipe === 'PULANG') rekap[idKar].hari_lengkap += 1;
    if (tipe === 'MULAI_LEMBUR' || tipe === 'SELESAI_LEMBUR') {
      var key = idKar + '|' + tgl;
      if (!lemburPerHari[key]) lemburPerHari[key] = { id_karyawan: idKar };
      if (tipe === 'MULAI_LEMBUR') {
        lemburPerHari[key].mulai = normalisasiWaktu(rows[j][4]);
        lemburPerHari[key].verifMulai = String(rows[j][11]).trim();
      } else {
        lemburPerHari[key].selesai = normalisasiWaktu(rows[j][4]);
        lemburPerHari[key].verifSelesai = String(rows[j][11]).trim();
      }
    }
  }
  for (var key2 in lemburPerHari) {
    var s = lemburPerHari[key2];
    if (!s.mulai || !s.selesai) continue;
    if (s.verifMulai !== 'TERVERIFIKASI' || s.verifSelesai !== 'TERVERIFIKASI') continue;
    if (!rekap[s.id_karyawan]) continue;
    rekap[s.id_karyawan].menit_lembur_terverifikasi += hitungDurasiMenit(s.mulai, s.selesai);
  }

  var hasil = [];
  for (var idK2 in rekap) hasil.push(rekap[idK2]);
  hasil.sort(function (a, b) {
    return a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0;
  });
  return { ok: true, bulan: bulan, rekap: hasil, catatan: 'Belum termasuk hari Cuti/Sakit/Izin/Off — bisa ditambahkan setelah field final disepakati.' };
}

// ===================== PENGAJUAN IZIN (Cuti/Sakit/Izin Biasa/Off) =====================

var TIPE_IZIN_VALID = ['CUTI', 'SAKIT', 'IZIN_BIASA', 'OFF'];

function hitungJumlahHari(mulai, selesai) {
  var a = new Date(mulai + 'T00:00:00');
  var b = new Date(selesai + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

function daftarTanggalDalamRentang(mulai, selesai) {
  var hasil = [];
  var cur = new Date(mulai + 'T00:00:00');
  var akhir = new Date(selesai + 'T00:00:00');
  while (cur <= akhir) {
    hasil.push(Utilities.formatDate(cur, TIMEZONE, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return hasil;
}

function getOrCreateLampiranFolder() {
  var namaFolder = 'Lampiran Izin - Absensi Omah Kebon';
  var folders = DriveApp.getFoldersByName(namaFolder);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(namaFolder);
}

function simpanLampiran(base64, mime, namaFile) {
  var folder = getOrCreateLampiranFolder();
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mime || 'image/jpeg', namaFile);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function pengajuanDariBaris(row) {
  return {
    id_pengajuan: String(row[0]).trim(),
    id_karyawan: String(row[1]).trim(),
    nama: String(row[2]).trim(),
    tipe_izin: String(row[3]).trim().toUpperCase(),
    tanggal_mulai: normalisasiTanggal(row[4]),
    tanggal_selesai: normalisasiTanggal(row[5]),
    jumlah_hari: Number(row[6]) || 0,
    alasan: String(row[7]).trim(),
    lampiran_url: String(row[8]).trim(),
    status: String(row[9]).trim(),
    diajukan_pada: String(row[10]).trim(),
    diputuskan_oleh: String(row[11]).trim(),
    diputuskan_pada: String(row[12]).trim(),
    catatan_admin: String(row[13]).trim()
  };
}

function handleAjukanIzin(body) {
  var id = String(body.id_karyawan || '').trim();
  var tipeIzin = String(body.tipe_izin || '').trim().toUpperCase();
  var tanggalMulai = String(body.tanggal_mulai || '').trim();
  var tanggalSelesai = String(body.tanggal_selesai || '').trim();
  var alasan = String(body.alasan || '').trim();

  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  if (TIPE_IZIN_VALID.indexOf(tipeIzin) === -1) return { ok: false, error: 'Tipe izin tidak dikenal: ' + tipeIzin };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai) || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesai)) {
    return { ok: false, error: 'Tanggal mulai/selesai wajib diisi.' };
  }
  if (tanggalSelesai < tanggalMulai) return { ok: false, error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' };
  if (!alasan) return { ok: false, error: 'Alasan wajib diisi.' };

  var karyawan = findKaryawan(id);
  if (!karyawan) return { ok: false, error: 'Karyawan tidak ditemukan.' };
  if (karyawan.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };

  var jumlahHari = hitungJumlahHari(tanggalMulai, tanggalSelesai);
  if (jumlahHari > 31) return { ok: false, error: 'Rentang tanggal terlalu panjang (maks 31 hari per pengajuan).' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Cegah pengajuan tumpang tindih tanggal dgn pengajuan lain milik
    // karyawan yang sama yang masih berjalan (PENDING atau sudah DISETUJUI).
    var sheet = getSheet(SHEET_PENGAJUAN);
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).trim() !== id) continue;
      var statusLain = String(rows[i][9]).trim();
      if (statusLain !== 'PENDING' && statusLain !== 'DISETUJUI') continue;
      var mLain = normalisasiTanggal(rows[i][4]);
      var sLain = normalisasiTanggal(rows[i][5]);
      if (tanggalMulai <= sLain && mLain <= tanggalSelesai) {
        return { ok: false, error: 'Anda sudah punya pengajuan lain yang tumpang tindih tanggal (' + mLain + ' s/d ' + sLain + ', status ' + statusLain + ').' };
      }
    }

    var lampiranUrl = '';
    if (body.lampiran_base64) {
      try {
        lampiranUrl = simpanLampiran(body.lampiran_base64, body.lampiran_mime, (body.lampiran_nama || 'lampiran') + '.jpg');
      } catch (errUpload) {
        return { ok: false, error: 'Gagal unggah lampiran: ' + String(errUpload) };
      }
    }

    var now = new Date();
    var idPengajuan = 'PJ-' + Utilities.formatDate(now, TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + id;
    var diajukanPada = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([
      idPengajuan, id, karyawan.nama, tipeIzin, tanggalMulai, tanggalSelesai,
      jumlahHari, alasan, lampiranUrl, 'PENDING', diajukanPada, '', '', ''
    ]);
    return { ok: true, id_pengajuan: idPengajuan, jumlah_hari: jumlahHari };
  } finally {
    lock.releaseLock();
  }
}

function handleGetPengajuanSaya(idKaryawan) {
  var id = String(idKaryawan || '').trim();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  var rows = getSheet(SHEET_PENGAJUAN).getDataRange().getValues();
  var hasil = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== id) continue;
    hasil.push(pengajuanDariBaris(rows[i]));
  }
  hasil.sort(function (a, b) { return a.diajukan_pada < b.diajukan_pada ? 1 : -1; });
  return { ok: true, pengajuan: hasil };
}

function handleGetAntreanPengajuan(actorId) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_lihat_pengajuan');
  if (!cek.ok) return cek;
  var rows = getSheet(SHEET_PENGAJUAN).getDataRange().getValues();
  var hasil = [];
  for (var i = 1; i < rows.length; i++) {
    var p = pengajuanDariBaris(rows[i]);
    if (p.status !== 'PENDING') continue;
    hasil.push(p);
  }
  hasil.sort(function (a, b) { return a.diajukan_pada < b.diajukan_pada ? -1 : 1; });
  return { ok: true, antrean: hasil, bisa_putuskan: cek.admin.role === 'OWNER' || !!cek.admin.izin_approve_pengajuan };
}

function handlePutuskanPengajuan(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireIzin(actorId, 'izin_approve_pengajuan');
  if (!cek.ok) return cek;

  var idPengajuan = String(body.id_pengajuan || '').trim();
  var keputusan = String(body.keputusan || '').trim().toUpperCase();
  var catatan = String(body.catatan_admin || '').trim();
  if (['DISETUJUI', 'DITOLAK'].indexOf(keputusan) === -1) return { ok: false, error: 'Keputusan harus DISETUJUI atau DITOLAK.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(SHEET_PENGAJUAN);
    var rows = sheet.getDataRange().getValues();
    var rowIdx = -1, data = null;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === idPengajuan) { rowIdx = i + 1; data = rows[i]; break; }
    }
    if (rowIdx === -1) return { ok: false, error: 'Pengajuan tidak ditemukan.' };
    var statusSekarang = String(data[9]).trim();
    if (statusSekarang !== 'PENDING') return { ok: false, error: 'Pengajuan ini sudah diputuskan sebelumnya (' + statusSekarang + ').' };

    var now = new Date();
    var waktuKeputusan = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(rowIdx, 10).setValue(keputusan);
    sheet.getRange(rowIdx, 12).setValue(cek.admin.nama);
    sheet.getRange(rowIdx, 13).setValue(waktuKeputusan);
    sheet.getRange(rowIdx, 14).setValue(catatan);

    var tanggalDitulis = [];
    var tanggalDilewati = [];
    if (keputusan === 'DISETUJUI') {
      var idK = String(data[1]).trim();
      var nama = String(data[2]).trim();
      var tipeIzin = String(data[3]).trim().toUpperCase();
      var tanggalList = daftarTanggalDalamRentang(normalisasiTanggal(data[4]), normalisasiTanggal(data[5]));
      for (var t = 0; t < tanggalList.length; t++) {
        var r = tulisAbsenTidakHadir(idK, nama, tanggalList[t], tipeIzin, 'Disetujui via pengajuan ' + idPengajuan);
        if (r.ok && !r.sudahAda) tanggalDitulis.push(tanggalList[t]);
        else if (!r.ok) tanggalDilewati.push(tanggalList[t] + ' (' + r.alasan + ')');
      }
    }
    return { ok: true, status: keputusan, tanggal_ditulis: tanggalDitulis, tanggal_dilewati: tanggalDilewati };
  } finally {
    lock.releaseLock();
  }
}

// ===================== HELPER =====================

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Tab "' + name + '" tidak ditemukan. Jalankan setupSheet() dulu.');
  return sheet;
}

function findKaryawan(id) {
  var rows = getSheet(SHEET_KARYAWAN).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      return {
        id_karyawan: id,
        nama: String(rows[i][1]).trim(),
        status: String(rows[i][3]).trim()
      };
    }
  }
  return null;
}

function getConfig() {
  var rows = getSheet(SHEET_CONFIG).getDataRange().getValues();
  var config = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0]).trim();
    if (key) config[key] = parseFloat(rows[i][1]);
  }
  // fallback ke default kalau ada nilai yang kosong/rusak
  for (var k in DEFAULT_CONFIG) {
    if (isNaN(config[k])) config[k] = DEFAULT_CONFIG[k];
  }
  return config;
}

// Sel tanggal/waktu di Sheet bisa berubah jadi objek Date kalau tersentuh
// format otomatis — normalisasi balik ke string supaya perbandingan konsisten
function normalisasiTanggal(nilai) {
  if (nilai instanceof Date) {
    return Utilities.formatDate(nilai, TIMEZONE, 'yyyy-MM-dd');
  }
  return String(nilai).trim();
}

function normalisasiWaktu(nilai) {
  if (nilai instanceof Date) {
    return Utilities.formatDate(nilai, TIMEZONE, 'HH:mm:ss');
  }
  return String(nilai).trim();
}

// ===================== SETUP SEKALI JALAN / MIGRASI =====================

/**
 * Jalankan dari editor Apps Script (pilih fungsi ini → Run) setiap kali ada
 * tab baru yang perlu dibuat ATAU kolom baru yang perlu dimigrasikan.
 * AMAN dijalankan ulang berkali-kali — tab yang sudah ada dan datanya tidak
 * ditimpa, cuma kolom header yang hilang yang ditambahkan (idempotent).
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName(SHEET_KARYAWAN)) {
    var k = ss.insertSheet(SHEET_KARYAWAN);
    k.getRange(1, 1, 1, 5)
      .setValues([['id_karyawan', 'nama', 'pin_hash', 'status', 'tanggal_daftar']])
      .setFontWeight('bold');
    // Karyawan contoh untuk testing internal Fase A
    var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    k.getRange(2, 1, 2, 5).setValues([
      ['OKT001', 'Test Rama', '', 'Aktif', today],
      ['OKT002', 'Test Karyawan', '', 'Aktif', today]
    ]);
    k.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET_ABSENSI)) {
    var a = ss.insertSheet(SHEET_ABSENSI);
    a.getRange(1, 1, 1, 14)
      .setValues([
        [
          'id_absen',
          'id_karyawan',
          'nama',
          'tanggal',
          'waktu',
          'tipe_absen',
          'latitude',
          'longitude',
          'jarak_dari_kantor_m',
          'status_lokasi',
          'catatan',
          'status_verifikasi',
          'diverifikasi_oleh',
          'waktu_verifikasi'
        ]
      ])
      .setFontWeight('bold');
    // Kolom tanggal & waktu dipaksa format teks supaya tidak berubah jadi Date
    a.getRange('D:E').setNumberFormat('@');
    a.setFrozenRows(1);
  } else {
    // Migrasi: tab Absensi lama (sebelum fitur Lembur) belum punya 3 kolom
    // verifikasi ini — tambahkan headernya tanpa menyentuh baris data yang ada.
    var absensiLama = ss.getSheetByName(SHEET_ABSENSI);
    var headerLama = absensiLama.getRange(1, 1, 1, Math.max(absensiLama.getLastColumn(), 1)).getValues()[0];
    if (headerLama.indexOf('status_verifikasi') === -1) {
      absensiLama.getRange(1, 12, 1, 3)
        .setValues([['status_verifikasi', 'diverifikasi_oleh', 'waktu_verifikasi']])
        .setFontWeight('bold');
    }
  }

  if (!ss.getSheetByName(SHEET_CONFIG)) {
    var c = ss.insertSheet(SHEET_CONFIG);
    c.getRange(1, 1, 1, 3)
      .setValues([['key', 'value', 'keterangan']])
      .setFontWeight('bold');
    c.getRange(2, 1, 3, 3).setValues([
      ['lokasi_kantor_lat', DEFAULT_CONFIG.lokasi_kantor_lat, 'Latitude titik pusat Omah Kebon'],
      ['lokasi_kantor_lng', DEFAULT_CONFIG.lokasi_kantor_lng, 'Longitude titik pusat Omah Kebon'],
      ['radius_toleransi_m', DEFAULT_CONFIG.radius_toleransi_m, 'Radius toleransi dalam meter (1km)']
    ]);
    c.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET_ADMIN)) {
    var ad = ss.insertSheet(SHEET_ADMIN);
    ad.getRange(1, 1, 1, 10)
      .setValues([[
        'id_admin', 'nama', 'role', 'pin_hash', 'status',
        'izin_approve_pengajuan', 'izin_verifikasi_lembur', 'izin_lihat_rekap_gaji',
        'tanggal_daftar', 'izin_lihat_pengajuan'
      ]])
      .setFontWeight('bold');
    var todayAdmin = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    // 3 akun awal sesuai role yang sudah disepakati. pin_hash kosong → tiap
    // orang buat PIN sendiri saat login pertama kali (sama pola dgn Karyawan).
    // izin_* adalah DEFAULT AWAL saja — Mas Abim (role OWNER) bisa ubah kapan
    // saja lewat dashboard "Kelola Akun Admin" tanpa perlu developer. Bu Lis
    // (HR) default dapat izin_lihat_pengajuan=true (bisa lihat & baca antrean
    // Cuti/Izin) tapi izin_approve_pengajuan=false (TIDAK bisa memutuskan) —
    // sesuai keputusan bisnis: approve/reject cuma Mas Abim.
    ad.getRange(2, 1, 3, 10).setValues([
      ['ADM001', 'Mas Abim', 'OWNER', '', 'Aktif', true, true, true, todayAdmin, true],
      ['ADM002', 'Mbak Tika', 'REKAP', '', 'Aktif', false, true, true, todayAdmin, false],
      ['ADM003', 'Bu Lis', 'HR', '', 'Aktif', false, false, false, todayAdmin, true]
    ]);
    ad.setFrozenRows(1);
  } else {
    // Migrasi: tab Admin yang sudah ada dari versi sebelum fitur Pengajuan
    // belum punya kolom izin_lihat_pengajuan — tambahkan tanpa mengubah data
    // lain. Nilai default kosong (false) untuk semua baris yang sudah ada —
    // Owner perlu nyalakan manual utk Bu Lis lewat "Kelola Akun Admin" kalau
    // mau dia bisa lihat antrean Pengajuan.
    var adminLama = ss.getSheetByName(SHEET_ADMIN);
    var headerAdminLama = adminLama.getRange(1, 1, 1, Math.max(adminLama.getLastColumn(), 1)).getValues()[0];
    if (headerAdminLama.indexOf('izin_lihat_pengajuan') === -1) {
      var kolomBaru = adminLama.getLastColumn() + 1;
      adminLama.getRange(1, kolomBaru).setValue('izin_lihat_pengajuan').setFontWeight('bold');
    }
  }

  if (!ss.getSheetByName(SHEET_PENGAJUAN)) {
    var p = ss.insertSheet(SHEET_PENGAJUAN);
    p.getRange(1, 1, 1, 14)
      .setValues([[
        'id_pengajuan', 'id_karyawan', 'nama', 'tipe_izin', 'tanggal_mulai', 'tanggal_selesai',
        'jumlah_hari', 'alasan', 'lampiran_url', 'status', 'diajukan_pada',
        'diputuskan_oleh', 'diputuskan_pada', 'catatan_admin'
      ]])
      .setFontWeight('bold');
    p.getRange('E:F').setNumberFormat('@'); // tanggal_mulai/selesai sbg teks
    // 1 baris contoh berstatus PENDING supaya begitu dashboard admin dibuka,
    // tab "Pengajuan Cuti/Izin" langsung kelihatan isinya (bukan kosong).
    var todayPengajuan = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    p.getRange(2, 1, 1, 14).setValues([[
      'PJ-CONTOH-001', 'OKT001', 'Test Rama', 'CUTI', '2026-08-05', '2026-08-07',
      3, 'Pulang kampung (contoh data uji)', '', 'PENDING', todayPengajuan, '', '', ''
    ]]);
    p.setFrozenRows(1);
  }

  // Hapus tab default "Sheet1" kalau masih ada dan kosong
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 5) {
    ss.deleteSheet(sheet1);
  }

  Logger.log('Setup selesai. Tab Karyawan, Absensi, Config, Admin, Pengajuan siap dipakai.');
}
