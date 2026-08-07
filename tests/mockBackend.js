/**
 * mockBackend.js — reimplementasi Code.gs (Apps Script) dalam Node biasa,
 * dipakai untuk testing logic backend + e2e frontend tanpa perlu Apps Script
 * sungguhan. Struktur sheet (array header + baris) dan urutan kolom dibuat
 * SAMA PERSIS dengan apps-script/Code.gs supaya gampang di-diff manual kalau
 * Code.gs berubah — lihat komentar "// SELARAS Code.gs:" di tiap fungsi.
 *
 * TIDAK menjalankan Code.gs secara langsung (Apps Script API seperti
 * SpreadsheetApp/Utilities/LockService/DriveApp tidak ada di Node), jadi ini
 * adalah PORT manual, bukan eksekusi asli — risikonya bisa diverge kalau
 * Code.gs diubah tanpa mockBackend ikut diupdate. Wajib update dua-duanya
 * bersamaan. Upload lampiran Drive DI-MOCK (lihat simpanLampiran) karena Drive
 * sungguhan tidak ada di Node — cukup untuk menguji ALUR, bukan penyimpanan
 * file sungguhan.
 */

'use strict';

var crypto = require('crypto');

var TIMEZONE = 'Asia/Jakarta';
var mockNow = new Date();

function setNow(d) {
  mockNow = d;
}

function formatTanggal(d) {
  var s = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  return s;
}

function formatWaktu(d) {
  var s = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d);
  return s.replace(/‎/g, '');
}

function hashPin(idPemilik, pin) {
  return crypto.createHash('sha256').update(idPemilik + ':' + pin, 'utf8').digest('hex');
}

// ===================== STATE (mirip 5 tab Sheet) =====================

var HEADER_KARYAWAN = ['id_karyawan', 'nama', 'pin_hash', 'status', 'tanggal_daftar', 'kuota_cuti_override'];
var HEADER_ABSENSI = ['id_absen', 'id_karyawan', 'nama', 'tanggal', 'waktu', 'tipe_absen', 'latitude', 'longitude', 'jarak_dari_kantor_m', 'status_lokasi', 'catatan', 'status_verifikasi', 'diverifikasi_oleh', 'waktu_verifikasi'];
var HEADER_CONFIG = ['key', 'value', 'keterangan'];
var HEADER_ADMIN = ['id_admin', 'nama', 'role', 'pin_hash', 'status', 'izin_approve_pengajuan', 'izin_verifikasi_lembur', 'izin_lihat_rekap_gaji', 'tanggal_daftar', 'izin_lihat_pengajuan'];
var HEADER_PENGAJUAN = ['id_pengajuan', 'id_karyawan', 'nama', 'tipe_izin', 'tanggal_mulai', 'tanggal_selesai', 'jumlah_hari', 'alasan', 'lampiran_url', 'status', 'diajukan_pada', 'diputuskan_oleh', 'diputuskan_pada', 'catatan_admin'];

var DEFAULT_CONFIG = {
  lokasi_kantor_lat: -7.3234422729931525,
  lokasi_kantor_lng: 110.19331425092193,
  radius_toleransi_m: 1000
};

var db;

function resetState() {
  var today = formatTanggal(mockNow);
  db = {
    Karyawan: [
      HEADER_KARYAWAN.slice(),
      ['OKT001', 'Test Rama', '', 'Aktif', today, ''],
      ['OKT002', 'Test Karyawan', '', 'Aktif', today, '']
    ],
    Absensi: [HEADER_ABSENSI.slice()],
    Config: [
      HEADER_CONFIG.slice(),
      ['lokasi_kantor_lat', DEFAULT_CONFIG.lokasi_kantor_lat, ''],
      ['lokasi_kantor_lng', DEFAULT_CONFIG.lokasi_kantor_lng, ''],
      ['radius_toleransi_m', DEFAULT_CONFIG.radius_toleransi_m, '']
    ],
    Admin: [
      HEADER_ADMIN.slice(),
      ['ADM001', 'Mas Abim', 'OWNER', '', 'Aktif', true, true, true, today, true],
      ['ADM002', 'Mbak Tika', 'REKAP', '', 'Aktif', false, true, true, today, false],
      ['ADM003', 'Bu Lis', 'HR', '', 'Aktif', false, false, false, today, true]
    ],
    Pengajuan: [HEADER_PENGAJUAN.slice()]
  };
}
resetState();

function getSheetData(name) {
  return db[name];
}

// ===================== LOGIC — SELARAS Code.gs =====================

var KELOMPOK_HADIR = ['MASUK', 'PULANG'];
var KELOMPOK_LEMBUR = ['MULAI_LEMBUR', 'SELESAI_LEMBUR'];
var TIPE_ABSEN_LANGSUNG = KELOMPOK_HADIR.concat(KELOMPOK_LEMBUR);
// Tipe OFF sudah dihapus (Fase 3) — cukup terwakili lewat IZIN.
var KELOMPOK_TIDAK_HADIR = ['CUTI', 'SAKIT', 'IZIN'];
var LABEL_TIPE = {
  MASUK: 'masuk', PULANG: 'pulang', MULAI_LEMBUR: 'mulai lembur',
  SELESAI_LEMBUR: 'selesai lembur', CUTI: 'cuti', SAKIT: 'sakit', IZIN: 'izin'
};
var TIPE_IZIN_VALID = ['CUTI', 'SAKIT', 'IZIN'];
var MAKS_HARI_CUTI = 2;
var KUOTA_CUTI_TAHUNAN = 12;

function normalisasiTanggal(v) { return String(v).trim(); }
function normalisasiWaktu(v) { return String(v).trim(); }

function haversineMeter(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var toRad = function (d) { return (d * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getConfig() {
  var rows = db.Config;
  var config = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0]).trim();
    if (key) config[key] = parseFloat(rows[i][1]);
  }
  for (var k in DEFAULT_CONFIG) {
    if (isNaN(config[k])) config[k] = DEFAULT_CONFIG[k];
  }
  return config;
}

function findKaryawan(id) {
  var rows = db.Karyawan;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      return { id_karyawan: id, nama: String(rows[i][1]).trim(), status: String(rows[i][3]).trim() };
    }
  }
  return null;
}

function cariAbsenHariIni(idKaryawan, tanggal, tipe) {
  var rows = db.Absensi;
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1]).trim() === idKaryawan && normalisasiTanggal(rows[i][3]) === tanggal && String(rows[i][5]).trim().toUpperCase() === tipe) {
      return { waktu: normalisasiWaktu(rows[i][4]) };
    }
  }
  return null;
}

// ---------- karyawan ----------

function handleGetKaryawan() {
  var rows = db.Karyawan;
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (String(r[3]).trim().toLowerCase() !== 'aktif') continue;
    list.push({ id_karyawan: String(r[0]).trim(), nama: String(r[1]).trim(), perlu_pin_baru: String(r[2]).trim() === '' });
  }
  return { ok: true, karyawan: list };
}

function handleLogin(body) {
  var id = String(body.id_karyawan || '').trim();
  var pin = String(body.pin || '').trim();
  if (!id || !/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN harus 4 angka.' };
  var rows = db.Karyawan;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (String(rows[i][3]).trim().toLowerCase() !== 'aktif') return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };
    var nama = String(rows[i][1]).trim();
    var storedHash = String(rows[i][2]).trim();
    if (storedHash === '') {
      rows[i][2] = hashPin(id, pin);
      return { ok: true, id_karyawan: id, nama: nama, pin_baru_dibuat: true };
    }
    if (hashPin(id, pin) === storedHash) return { ok: true, id_karyawan: id, nama: nama, pin_baru_dibuat: false };
    return { ok: false, error: 'PIN salah. Coba lagi.' };
  }
  return { ok: false, error: 'Karyawan tidak ditemukan.' };
}

function handleAbsen(body) {
  var id = String(body.id_karyawan || '').trim();
  var tipe = String(body.tipe_absen || 'MASUK').trim().toUpperCase();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  if (TIPE_ABSEN_LANGSUNG.indexOf(tipe) === -1) {
    if (KELOMPOK_TIDAK_HADIR.indexOf(tipe) !== -1) {
      return { ok: false, error: 'Cuti/Sakit/Izin sekarang lewat menu "Ajukan Izin", bukan absen langsung.' };
    }
    return { ok: false, error: 'tipe_absen tidak dikenal: ' + tipe };
  }

  var lat = parseFloat(body.lat);
  var lng = parseFloat(body.lng);
  if (isNaN(lat) || isNaN(lng)) return { ok: false, error: 'Lokasi GPS tidak terbaca. Coba lagi.' };

  var karyawan = findKaryawan(id);
  if (!karyawan) return { ok: false, error: 'Karyawan tidak ditemukan.' };
  if (karyawan.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };

  var tanggal = formatTanggal(mockNow);
  var waktu = formatWaktu(mockNow);

  if (tipe === 'PULANG') {
    if (!cariAbsenHariIni(id, tanggal, 'MASUK')) return { ok: false, error: 'Anda belum absen masuk hari ini. Absen masuk dulu.' };
  }
  if (tipe === 'SELESAI_LEMBUR') {
    if (!cariAbsenHariIni(id, tanggal, 'MULAI_LEMBUR')) return { ok: false, error: 'Anda belum mulai lembur hari ini. Mulai lembur dulu.' };
  }

  for (var i = 0; i < KELOMPOK_TIDAK_HADIR.length; i++) {
    var bentrok = cariAbsenHariIni(id, tanggal, KELOMPOK_TIDAK_HADIR[i]);
    if (bentrok) return { ok: false, error: 'Hari ini sudah ditandai ' + LABEL_TIPE[KELOMPOK_TIDAK_HADIR[i]].toUpperCase() + ', tidak bisa ' + LABEL_TIPE[tipe] + '.' };
  }

  var sudah = cariAbsenHariIni(id, tanggal, tipe);
  if (sudah) {
    return { ok: true, sudah_absen: true, tipe_absen: tipe, tanggal: tanggal, waktu: sudah.waktu, pesan: 'Sudah tercatat ' + LABEL_TIPE[tipe] + ' hari ini jam ' + sudah.waktu.substring(0, 5) };
  }

  var config = getConfig();
  var jarak = Math.round(haversineMeter(lat, lng, config.lokasi_kantor_lat, config.lokasi_kantor_lng));
  var statusLokasi = jarak <= config.radius_toleransi_m ? 'DALAM_RADIUS' : 'DILUAR_RADIUS';
  var statusVerifikasi = KELOMPOK_LEMBUR.indexOf(tipe) !== -1 ? 'BELUM_DIVERIFIKASI' : 'TIDAK_BERLAKU';
  var idAbsen = 'ABS-' + tanggal.replace(/-/g, '') + '-' + waktu.replace(/:/g, '') + '-' + id;
  db.Absensi.push([idAbsen, id, karyawan.nama, tanggal, waktu, tipe, lat, lng, jarak, statusLokasi, '', statusVerifikasi, '', '']);

  return { ok: true, sudah_absen: false, tipe_absen: tipe, tanggal: tanggal, waktu: waktu, jarak_dari_kantor_m: jarak, status_lokasi: statusLokasi };
}

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
  db.Absensi.push([idAbsen, idKaryawan, nama, tanggal, '00:00:00', tipe, '', '', '', 'TIDAK_BERLAKU', catatan || '', 'TIDAK_BERLAKU', '', '']);
  return { ok: true };
}

function handleRiwayat(params) {
  var id = String(params.id_karyawan || '').trim();
  var bulan = String(params.bulan || '').trim();
  if (!id || !/^\d{4}-\d{2}$/.test(bulan)) return { ok: false, error: 'Parameter id_karyawan dan bulan (YYYY-MM) wajib.' };
  var rows = db.Absensi;
  var records = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== id) continue;
    var tanggal = normalisasiTanggal(rows[i][3]);
    if (tanggal.substring(0, 7) !== bulan) continue;
    records.push({ tanggal: tanggal, waktu: normalisasiWaktu(rows[i][4]), tipe_absen: String(rows[i][5]).trim().toUpperCase(), status_lokasi: String(rows[i][9]).trim() });
  }
  return { ok: true, bulan: bulan, records: records };
}

// ---------- admin ----------

function castBool(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }

function adminProfilDariBaris(row) {
  return {
    id_admin: String(row[0]).trim(), nama: String(row[1]).trim(), role: String(row[2]).trim().toUpperCase(),
    perlu_pin_baru: String(row[3]).trim() === '', status: String(row[4]).trim(),
    izin_approve_pengajuan: castBool(row[5]), izin_verifikasi_lembur: castBool(row[6]), izin_lihat_rekap_gaji: castBool(row[7]),
    izin_lihat_pengajuan: castBool(row[9])
  };
}

function findAdmin(id) {
  var rows = db.Admin;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return adminProfilDariBaris(rows[i]);
  }
  return null;
}

function requireIzin(idAdmin, izinKey) {
  var admin = findAdmin(idAdmin);
  if (!admin) return { ok: false, error: 'Akun admin tidak ditemukan.' };
  if (admin.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Akun admin sudah tidak aktif.' };
  if (admin.role === 'OWNER') return { ok: true, admin: admin };
  if (izinKey && !admin[izinKey]) return { ok: false, error: 'Anda tidak punya izin untuk aksi ini.' };
  return { ok: true, admin: admin };
}

function requireOwner(idAdmin) {
  var admin = findAdmin(idAdmin);
  if (!admin) return { ok: false, error: 'Akun admin tidak ditemukan.' };
  if (admin.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Akun admin sudah tidak aktif.' };
  if (admin.role !== 'OWNER') return { ok: false, error: 'Hanya Owner yang bisa melakukan ini.' };
  return { ok: true, admin: admin };
}

function handleGetDaftarAdmin() {
  var rows = db.Admin;
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
  if (!id || !/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN harus 4 angka.' };
  var rows = db.Admin;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    if (String(rows[i][4]).trim().toLowerCase() !== 'aktif') return { ok: false, error: 'Akun admin sudah tidak aktif. Hubungi Owner.' };
    var storedHash = String(rows[i][3]).trim();
    if (storedHash === '') {
      rows[i][3] = hashPin(id, pin);
      var profilBaru = adminProfilDariBaris(rows[i]);
      profilBaru.ok = true; profilBaru.pin_baru_dibuat = true;
      return profilBaru;
    }
    if (hashPin(id, pin) === storedHash) {
      var profil = adminProfilDariBaris(rows[i]);
      profil.ok = true; profil.pin_baru_dibuat = false;
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
  var rows = db.Admin;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    var storedHash = String(rows[i][3]).trim();
    if (storedHash !== '' && hashPin(id, pinLama) !== storedHash) return { ok: false, error: 'PIN lama salah.' };
    rows[i][3] = hashPin(id, pinBaru);
    return { ok: true };
  }
  return { ok: false, error: 'Akun admin tidak ditemukan.' };
}

function buatIdAdminBaru(rows) {
  var maxNum = 0;
  for (var i = 1; i < rows.length; i++) {
    var m = /^ADM(\d+)$/.exec(String(rows[i][0]).trim());
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  var nomorStr = String(maxNum + 1);
  while (nomorStr.length < 3) nomorStr = '0' + nomorStr;
  return 'ADM' + nomorStr;
}

// Role SEKARANG BEBAS TEKS (Fase 3) — role persis OWNER/HR/REKAP tetap dapat
// default izin lama (kompatibel ke belakang), role custom lain default SEMUA
// izin OFF (Owner tinggal centang manual dari tabel Kelola Akun).
function handleAdminSimpanAkun(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireOwner(actorId);
  if (!cek.ok) return cek;

  var mode = String(body.mode || '').trim();
  var rows = db.Admin;

  if (mode === 'tambah') {
    var nama = String(body.nama || '').trim();
    var role = String(body.role || '').trim().toUpperCase();
    if (!nama) return { ok: false, error: 'Nama wajib diisi.' };
    if (!role) return { ok: false, error: 'Role wajib diisi.' };
    var idBaru = buatIdAdminBaru(rows);
    var today = formatTanggal(mockNow);
    db.Admin.push([
      idBaru, nama, role, '', 'Aktif',
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
    if (String(rows[i][0]).trim() === targetId) { rowIdx = i; break; }
  }
  if (rowIdx === -1) return { ok: false, error: 'Akun admin target tidak ditemukan.' };

  if (mode === 'reset_pin') { rows[rowIdx][3] = ''; return { ok: true }; }
  if (mode === 'nonaktifkan') {
    if (targetId === actorId) return { ok: false, error: 'Tidak bisa menonaktifkan akun sendiri.' };
    rows[rowIdx][4] = 'Nonaktif';
    return { ok: true };
  }
  if (mode === 'aktifkan') { rows[rowIdx][4] = 'Aktif'; return { ok: true }; }
  if (mode === 'edit_izin') {
    if (body.izin_approve_pengajuan !== undefined) rows[rowIdx][5] = !!body.izin_approve_pengajuan;
    if (body.izin_verifikasi_lembur !== undefined) rows[rowIdx][6] = !!body.izin_verifikasi_lembur;
    if (body.izin_lihat_rekap_gaji !== undefined) rows[rowIdx][7] = !!body.izin_lihat_rekap_gaji;
    if (body.izin_lihat_pengajuan !== undefined) rows[rowIdx][9] = !!body.izin_lihat_pengajuan;
    return { ok: true };
  }
  return { ok: false, error: 'mode tidak dikenal: ' + mode };
}

function hitungDurasiMenit(waktuMulai, waktuSelesai) {
  var a = String(waktuMulai).split(':');
  var b = String(waktuSelesai).split(':');
  var menitMulai = parseInt(a[0], 10) * 60 + parseInt(a[1], 10);
  var menitSelesai = parseInt(b[0], 10) * 60 + parseInt(b[1], 10);
  var selisih = menitSelesai - menitMulai;
  if (selisih < 0) selisih += 24 * 60;
  return selisih;
}

function handleGetAntreanLembur(actorId) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_verifikasi_lembur');
  if (!cek.ok) return cek;
  var rows = db.Absensi;
  var sesi = {};
  for (var i = 1; i < rows.length; i++) {
    var tipe = String(rows[i][5]).trim().toUpperCase();
    if (tipe !== 'MULAI_LEMBUR' && tipe !== 'SELESAI_LEMBUR') continue;
    var idK = String(rows[i][1]).trim();
    var tgl = normalisasiTanggal(rows[i][3]);
    var key = idK + '|' + tgl;
    if (!sesi[key]) sesi[key] = { id_karyawan: idK, nama: String(rows[i][2]).trim(), tanggal: tgl };
    if (tipe === 'MULAI_LEMBUR') { sesi[key].mulai = normalisasiWaktu(rows[i][4]); sesi[key].verifMulai = String(rows[i][11]).trim(); }
    else { sesi[key].selesai = normalisasiWaktu(rows[i][4]); sesi[key].verifSelesai = String(rows[i][11]).trim(); }
  }
  var hasil = [];
  for (var key2 in sesi) {
    var s = sesi[key2];
    if (!s.mulai || !s.selesai) continue;
    if (s.verifMulai === 'TERVERIFIKASI' && s.verifSelesai === 'TERVERIFIKASI') continue;
    hasil.push({ id_karyawan: s.id_karyawan, nama: s.nama, tanggal: s.tanggal, mulai: s.mulai, selesai: s.selesai, durasi_menit: hitungDurasiMenit(s.mulai, s.selesai) });
  }
  hasil.sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0; });
  return { ok: true, antrean: hasil };
}

function handleVerifikasiLembur(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireIzin(actorId, 'izin_verifikasi_lembur');
  if (!cek.ok) return cek;
  var idK = String(body.id_karyawan || '').trim();
  var tanggal = String(body.tanggal || '').trim();
  if (!idK || !tanggal) return { ok: false, error: 'id_karyawan dan tanggal wajib diisi.' };

  var rows = db.Absensi;
  var waktuVerif = formatTanggal(mockNow) + ' ' + formatWaktu(mockNow);
  var ditemukanMulai = false, ditemukanSelesai = false;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== idK) continue;
    if (normalisasiTanggal(rows[i][3]) !== tanggal) continue;
    var tipe = String(rows[i][5]).trim().toUpperCase();
    if (tipe !== 'MULAI_LEMBUR' && tipe !== 'SELESAI_LEMBUR') continue;
    rows[i][11] = 'TERVERIFIKASI';
    rows[i][12] = cek.admin.nama;
    rows[i][13] = waktuVerif;
    if (tipe === 'MULAI_LEMBUR') ditemukanMulai = true; else ditemukanSelesai = true;
  }
  if (!ditemukanMulai || !ditemukanSelesai) return { ok: false, error: 'Sesi lembur mulai/selesai untuk tanggal ini tidak lengkap.' };
  return { ok: true };
}

// Rekap — SELARAS Code.gs handleGetRekapGaji: kolom baru hari_kerja/hari_izin/
// hari_cuti/menit_lembur_terverifikasi, filter bulan ATAU rentang custom
// (tanggal_mulai+tanggal_selesai), plus id_karyawan opsional.
function handleGetRekapGaji(actorId, params) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_lihat_rekap_gaji');
  if (!cek.ok) return cek;
  params = params || {};

  var bulan = String(params.bulan || '').trim();
  var tanggalMulaiFilter = String(params.tanggal_mulai || '').trim();
  var tanggalSelesaiFilter = String(params.tanggal_selesai || '').trim();
  var idKaryawanFilter = String(params.id_karyawan || '').trim();
  var pakaiRentangCustom = /^\d{4}-\d{2}-\d{2}$/.test(tanggalMulaiFilter) && /^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesaiFilter);

  if (!pakaiRentangCustom && !/^\d{4}-\d{2}$/.test(bulan)) {
    return { ok: false, error: 'Parameter bulan (YYYY-MM), atau tanggal_mulai+tanggal_selesai, wajib.' };
  }

  var karyawanRows = db.Karyawan;
  var rekap = {};
  for (var i = 1; i < karyawanRows.length; i++) {
    var idK = String(karyawanRows[i][0]).trim();
    if (!idK) continue;
    if (idKaryawanFilter && idK !== idKaryawanFilter) continue;
    rekap[idK] = { id_karyawan: idK, nama: String(karyawanRows[i][1]).trim(), hari_kerja: 0, hari_izin: 0, hari_cuti: 0, menit_lembur_terverifikasi: 0 };
  }
  var rows = db.Absensi;
  var lemburPerHari = {};
  for (var j = 1; j < rows.length; j++) {
    var idKar = String(rows[j][1]).trim();
    if (!rekap[idKar]) continue;
    var tgl = normalisasiTanggal(rows[j][3]);
    var cocokRentang = pakaiRentangCustom
      ? (tgl >= tanggalMulaiFilter && tgl <= tanggalSelesaiFilter)
      : (tgl.substring(0, 7) === bulan);
    if (!cocokRentang) continue;
    var tipe = String(rows[j][5]).trim().toUpperCase();
    if (tipe === 'MASUK') rekap[idKar].hari_kerja += 1;
    if (tipe === 'SAKIT' || tipe === 'IZIN') rekap[idKar].hari_izin += 1;
    if (tipe === 'CUTI') rekap[idKar].hari_cuti += 1;
    if (tipe === 'MULAI_LEMBUR' || tipe === 'SELESAI_LEMBUR') {
      var key = idKar + '|' + tgl;
      if (!lemburPerHari[key]) lemburPerHari[key] = { id_karyawan: idKar };
      if (tipe === 'MULAI_LEMBUR') { lemburPerHari[key].mulai = normalisasiWaktu(rows[j][4]); lemburPerHari[key].verifMulai = String(rows[j][11]).trim(); }
      else { lemburPerHari[key].selesai = normalisasiWaktu(rows[j][4]); lemburPerHari[key].verifSelesai = String(rows[j][11]).trim(); }
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
  hasil.sort(function (a, b) { return a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0; });
  return { ok: true, bulan: bulan, rekap: hasil };
}

// ---------- pengajuan izin ----------

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
    hasil.push(formatTanggal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return hasil;
}

// Mock upload Drive — Drive sungguhan tidak ada di Node, cukup kembalikan
// URL palsu yang deterministik supaya alur bisa diuji end-to-end.
function simpanLampiran(base64, mime, namaFile) {
  return 'MOCK_DRIVE_URL/' + namaFile;
}

function pengajuanDariBaris(row) {
  return {
    id_pengajuan: String(row[0]).trim(), id_karyawan: String(row[1]).trim(), nama: String(row[2]).trim(),
    tipe_izin: String(row[3]).trim().toUpperCase(), tanggal_mulai: normalisasiTanggal(row[4]), tanggal_selesai: normalisasiTanggal(row[5]),
    jumlah_hari: Number(row[6]) || 0, alasan: String(row[7]).trim(), lampiran_url: String(row[8]).trim(),
    status: String(row[9]).trim(), diajukan_pada: String(row[10]).trim(), diputuskan_oleh: String(row[11]).trim(),
    diputuskan_pada: String(row[12]).trim(), catatan_admin: String(row[13]).trim()
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai) || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesai)) return { ok: false, error: 'Tanggal mulai/selesai wajib diisi.' };
  if (tanggalSelesai < tanggalMulai) return { ok: false, error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' };
  if (!alasan) return { ok: false, error: 'Alasan wajib diisi.' };

  var karyawan = findKaryawan(id);
  if (!karyawan) return { ok: false, error: 'Karyawan tidak ditemukan.' };
  if (karyawan.status.toLowerCase() !== 'aktif') return { ok: false, error: 'Karyawan sudah tidak aktif. Hubungi admin.' };

  var jumlahHari = hitungJumlahHari(tanggalMulai, tanggalSelesai);
  if (tipeIzin === 'CUTI' && jumlahHari > MAKS_HARI_CUTI) {
    return { ok: false, error: 'Cuti maksimal ' + MAKS_HARI_CUTI + ' hari per pengajuan.' };
  }
  if (jumlahHari > 31) return { ok: false, error: 'Rentang tanggal terlalu panjang (maks 31 hari per pengajuan).' };

  var rows = db.Pengajuan;
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
    lampiranUrl = simpanLampiran(body.lampiran_base64, body.lampiran_mime, (body.lampiran_nama || 'lampiran') + '.jpg');
  }

  var idPengajuan = 'PJ-' + formatTanggal(mockNow).replace(/-/g, '') + '-' + formatWaktu(mockNow).replace(/:/g, '') + '-' + id;
  var diajukanPada = formatTanggal(mockNow) + ' ' + formatWaktu(mockNow);
  db.Pengajuan.push([idPengajuan, id, karyawan.nama, tipeIzin, tanggalMulai, tanggalSelesai, jumlahHari, alasan, lampiranUrl, 'PENDING', diajukanPada, '', '', '']);
  return { ok: true, id_pengajuan: idPengajuan, jumlah_hari: jumlahHari };
}

function handleGetPengajuanSaya(idKaryawan) {
  var id = String(idKaryawan || '').trim();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  var rows = db.Pengajuan;
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
  var rows = db.Pengajuan;
  var hasil = [];
  for (var i = 1; i < rows.length; i++) {
    var p = pengajuanDariBaris(rows[i]);
    if (p.status !== 'PENDING') continue;
    if (p.tipe_izin === 'CUTI') p.sisa_kuota_cuti = hitungKuotaCutiKaryawan(p.id_karyawan).sisa;
    hasil.push(p);
  }
  hasil.sort(function (a, b) { return a.diajukan_pada < b.diajukan_pada ? -1 : 1; });
  return { ok: true, antrean: hasil, bisa_putuskan: cek.admin.role === 'OWNER' || !!cek.admin.izin_approve_pengajuan };
}

// TANPA catatan admin (Fase 3) — Setujui/Tolak langsung eksekusi, tidak ada
// dialog isi catatan.
function handlePutuskanPengajuan(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireIzin(actorId, 'izin_approve_pengajuan');
  if (!cek.ok) return cek;

  var idPengajuan = String(body.id_pengajuan || '').trim();
  var keputusan = String(body.keputusan || '').trim().toUpperCase();
  if (['DISETUJUI', 'DITOLAK'].indexOf(keputusan) === -1) return { ok: false, error: 'Keputusan harus DISETUJUI atau DITOLAK.' };

  var rows = db.Pengajuan;
  var rowIdx = -1, data = null;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === idPengajuan) { rowIdx = i; data = rows[i]; break; }
  }
  if (rowIdx === -1) return { ok: false, error: 'Pengajuan tidak ditemukan.' };
  var statusSekarang = String(data[9]).trim();
  if (statusSekarang !== 'PENDING') return { ok: false, error: 'Pengajuan ini sudah diputuskan sebelumnya (' + statusSekarang + ').' };

  var waktuKeputusan = formatTanggal(mockNow) + ' ' + formatWaktu(mockNow);
  rows[rowIdx][9] = keputusan;
  rows[rowIdx][11] = cek.admin.nama;
  rows[rowIdx][12] = waktuKeputusan;

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
}

// ---------- kuota cuti ----------

// Otomatis: 0 hari kalau belum genap 1 tahun kerja (TIDAK pro-rata), 12 hari
// begitu sudah lewat 1 tahun. Tidak carry-over (hangus tiap tahun kalender).
function hitungKuotaOtomatis(tanggalDaftar) {
  if (!tanggalDaftar) return 0;
  var mulai = new Date(String(tanggalDaftar) + 'T00:00:00');
  var sekarang = mockNow;
  var tahunKerja = (sekarang.getTime() - mulai.getTime()) / (365 * 86400000);
  return tahunKerja >= 1 ? KUOTA_CUTI_TAHUNAN : 0;
}

function hitungKuotaCutiKaryawan(idKaryawan) {
  var rows = db.Karyawan;
  var tanggalDaftar = '', override = '';
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== idKaryawan) continue;
    tanggalDaftar = String(rows[i][4]).trim();
    override = rows[i].length > 5 ? String(rows[i][5]).trim() : '';
    break;
  }
  var kuotaOtomatis = hitungKuotaOtomatis(tanggalDaftar);
  var kuota = (override !== '' && !isNaN(Number(override))) ? Number(override) : kuotaOtomatis;

  var tahunIni = mockNow.getFullYear();
  var terpakai = 0;
  var pengajuanRows = db.Pengajuan;
  for (var j = 1; j < pengajuanRows.length; j++) {
    if (String(pengajuanRows[j][1]).trim() !== idKaryawan) continue;
    if (String(pengajuanRows[j][3]).trim().toUpperCase() !== 'CUTI') continue;
    if (String(pengajuanRows[j][9]).trim() !== 'DISETUJUI') continue;
    var tglMulai = normalisasiTanggal(pengajuanRows[j][4]);
    if (new Date(tglMulai + 'T00:00:00').getFullYear() !== tahunIni) continue;
    terpakai += Number(pengajuanRows[j][6]) || 0;
  }

  return { kuota: kuota, kuota_otomatis: kuotaOtomatis, override: override, terpakai: terpakai, sisa: kuota - terpakai };
}

function handleGetKuotaCuti(actorId) {
  var cek = requireOwner(String(actorId || '').trim());
  if (!cek.ok) return cek;
  var rows = db.Karyawan;
  var hasil = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (String(rows[i][3]).trim().toLowerCase() !== 'aktif') continue;
    var idK = String(rows[i][0]).trim();
    var info = hitungKuotaCutiKaryawan(idK);
    hasil.push({
      id_karyawan: idK, nama: String(rows[i][1]).trim(), tanggal_daftar: normalisasiTanggal(rows[i][4]),
      kuota: info.kuota, kuota_otomatis: info.kuota_otomatis, override: info.override, terpakai: info.terpakai, sisa: info.sisa
    });
  }
  hasil.sort(function (a, b) { return a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0; });
  return { ok: true, kuota: hasil };
}

function handleSetKuotaCutiOverride(body) {
  var actorId = String(body.actor_id_admin || '').trim();
  var cek = requireOwner(actorId);
  if (!cek.ok) return cek;
  var idKaryawan = String(body.id_karyawan || '').trim();
  var override = body.override === undefined || body.override === null ? '' : String(body.override).trim();
  if (override !== '' && isNaN(Number(override))) return { ok: false, error: 'Jatah cuti harus berupa angka (atau kosongkan utk pakai otomatis).' };

  var rows = db.Karyawan;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== idKaryawan) continue;
    rows[i][5] = override;
    return { ok: true };
  }
  return { ok: false, error: 'Karyawan tidak ditemukan.' };
}

function handleGetKuotaCutiSaya(idKaryawan) {
  var id = String(idKaryawan || '').trim();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
  var karyawan = findKaryawan(id);
  if (!karyawan) return { ok: false, error: 'Karyawan tidak ditemukan.' };
  var info = hitungKuotaCutiKaryawan(id);
  return { ok: true, kuota: info.kuota, terpakai: info.terpakai, sisa: info.sisa };
}

// ===================== ROUTING (mirip doGet/doPost) =====================

function doGet(params) {
  var action = String(params.action || '').trim();
  if (action === 'getKaryawan') return handleGetKaryawan();
  if (action === 'riwayat') return handleRiwayat(params);
  if (action === 'getDaftarAdmin') return handleGetDaftarAdmin();
  if (action === 'getAntreanLembur') return handleGetAntreanLembur(params.actor_id_admin);
  if (action === 'getRekapGaji') return handleGetRekapGaji(params.actor_id_admin, params);
  if (action === 'getPengajuanSaya') return handleGetPengajuanSaya(params.id_karyawan);
  if (action === 'getAntreanPengajuan') return handleGetAntreanPengajuan(params.actor_id_admin);
  if (action === 'getKuotaCuti') return handleGetKuotaCuti(params.actor_id_admin);
  if (action === 'getKuotaCutiSaya') return handleGetKuotaCutiSaya(params.id_karyawan);
  return { ok: false, error: 'Action tidak dikenal: ' + action };
}

function doPost(body) {
  var action = String(body.action || '').trim();
  if (action === 'login') return handleLogin(body);
  if (action === 'absen') return handleAbsen(body);
  if (action === 'adminLogin') return handleAdminLogin(body);
  if (action === 'adminGantiPin') return handleAdminGantiPin(body);
  if (action === 'adminSimpanAkun') return handleAdminSimpanAkun(body);
  if (action === 'verifikasiLembur') return handleVerifikasiLembur(body);
  if (action === 'ajukanIzin') return handleAjukanIzin(body);
  if (action === 'putuskanPengajuan') return handlePutuskanPengajuan(body);
  if (action === 'setKuotaCutiOverride') return handleSetKuotaCutiOverride(body);
  return { ok: false, error: 'Action tidak dikenal: ' + action };
}

module.exports = {
  resetState: resetState,
  setNow: setNow,
  getSheetData: getSheetData,
  hitungKuotaCutiKaryawan: hitungKuotaCutiKaryawan,
  doGet: doGet,
  doPost: doPost
};
