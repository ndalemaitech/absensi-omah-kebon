/**
 * mockBackend.js — reimplementasi Code.gs (Apps Script) dalam Node biasa,
 * dipakai untuk testing logic backend + e2e frontend tanpa perlu Apps Script
 * sungguhan. Struktur sheet (array header + baris) dan urutan kolom dibuat
 * SAMA PERSIS dengan apps-script/Code.gs supaya gampang di-diff manual kalau
 * Code.gs berubah — lihat komentar "// SELARAS Code.gs:" di tiap fungsi.
 *
 * TIDAK menjalankan Code.gs secara langsung (Apps Script API seperti
 * SpreadsheetApp/Utilities/LockService tidak ada di Node), jadi ini adalah
 * PORT manual, bukan eksekusi asli — risikonya bisa diverge kalau Code.gs
 * diubah tanpa mockBackend ikut diupdate. Wajib update dua-duanya bersamaan.
 */

'use strict';

var crypto = require('crypto');

var TIMEZONE = 'Asia/Jakarta';
var mockNow = new Date();

function setNow(d) {
  mockNow = d;
}

function formatTanggal(d) {
  // yyyy-MM-dd di zona Asia/Jakarta
  var s = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  return s; // en-CA locale sudah format yyyy-MM-dd
}

function formatWaktu(d) {
  var s = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d);
  return s.replace(/‎/g, ''); // beberapa locale sisipkan LRM, buang
}

function hashPin(idPemilik, pin) {
  return crypto.createHash('sha256').update(idPemilik + ':' + pin, 'utf8').digest('hex');
}

// ===================== STATE (mirip 4 tab Sheet) =====================

var HEADER_KARYAWAN = ['id_karyawan', 'nama', 'pin_hash', 'status', 'tanggal_daftar'];
var HEADER_ABSENSI = ['id_absen', 'id_karyawan', 'nama', 'tanggal', 'waktu', 'tipe_absen', 'latitude', 'longitude', 'jarak_dari_kantor_m', 'status_lokasi', 'catatan', 'status_verifikasi', 'diverifikasi_oleh', 'waktu_verifikasi'];
var HEADER_CONFIG = ['key', 'value', 'keterangan'];
var HEADER_ADMIN = ['id_admin', 'nama', 'role', 'pin_hash', 'status', 'izin_approve_pengajuan', 'izin_verifikasi_lembur', 'izin_lihat_rekap_gaji', 'tanggal_daftar'];

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
      ['OKT001', 'Test Rama', '', 'Aktif', today],
      ['OKT002', 'Test Karyawan', '', 'Aktif', today]
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
      ['ADM001', 'Mas Abim', 'OWNER', '', 'Aktif', true, true, true, today],
      ['ADM002', 'Mbak Tika', 'REKAP', '', 'Aktif', false, true, true, today],
      ['ADM003', 'Bu Lis', 'HR', '', 'Aktif', false, false, false, today]
    ]
  };
}
resetState();

function getSheetData(name) {
  return db[name];
}

// ===================== LOGIC — SELARAS Code.gs =====================

var TIPE_ABSEN_VALID = ['MASUK', 'PULANG', 'MULAI_LEMBUR', 'SELESAI_LEMBUR', 'CUTI', 'OFF'];
var KELOMPOK_HADIR = ['MASUK', 'PULANG'];
var KELOMPOK_LEMBUR = ['MULAI_LEMBUR', 'SELESAI_LEMBUR'];
var KELOMPOK_TIDAK_HADIR = ['CUTI', 'OFF'];
var LABEL_TIPE = {
  MASUK: 'masuk', PULANG: 'pulang', MULAI_LEMBUR: 'mulai lembur',
  SELESAI_LEMBUR: 'selesai lembur', CUTI: 'cuti', OFF: 'off'
};

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
  if (TIPE_ABSEN_VALID.indexOf(tipe) === -1) return { ok: false, error: 'tipe_absen tidak dikenal: ' + tipe };

  var butuhLokasi = KELOMPOK_HADIR.indexOf(tipe) !== -1 || KELOMPOK_LEMBUR.indexOf(tipe) !== -1;
  var lat = butuhLokasi ? parseFloat(body.lat) : (body.lat === undefined || body.lat === null ? null : parseFloat(body.lat));
  var lng = butuhLokasi ? parseFloat(body.lng) : (body.lng === undefined || body.lng === null ? null : parseFloat(body.lng));
  if (butuhLokasi && (isNaN(lat) || isNaN(lng))) return { ok: false, error: 'Lokasi GPS tidak terbaca. Coba lagi.' };
  if (!butuhLokasi && (isNaN(lat) || lat === null)) lat = '';
  if (!butuhLokasi && (isNaN(lng) || lng === null)) lng = '';

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

  var kelompokLawan = KELOMPOK_TIDAK_HADIR.indexOf(tipe) !== -1 ? KELOMPOK_HADIR.concat(KELOMPOK_LEMBUR) : KELOMPOK_TIDAK_HADIR;
  for (var i = 0; i < kelompokLawan.length; i++) {
    var bentrok = cariAbsenHariIni(id, tanggal, kelompokLawan[i]);
    if (bentrok) return { ok: false, error: 'Hari ini sudah ditandai ' + LABEL_TIPE[kelompokLawan[i]].toUpperCase() + ', tidak bisa ' + LABEL_TIPE[tipe] + '.' };
  }
  if (KELOMPOK_TIDAK_HADIR.indexOf(tipe) !== -1) {
    var lawanSatuGrup = tipe === 'CUTI' ? 'OFF' : 'CUTI';
    if (cariAbsenHariIni(id, tanggal, lawanSatuGrup)) return { ok: false, error: 'Hari ini sudah ditandai ' + LABEL_TIPE[lawanSatuGrup].toUpperCase() + '.' };
  }

  var sudah = cariAbsenHariIni(id, tanggal, tipe);
  if (sudah) {
    return { ok: true, sudah_absen: true, tipe_absen: tipe, tanggal: tanggal, waktu: sudah.waktu, pesan: 'Sudah tercatat ' + LABEL_TIPE[tipe] + ' hari ini jam ' + sudah.waktu.substring(0, 5) };
  }

  var jarak = '';
  var statusLokasi = 'TIDAK_BERLAKU';
  if (butuhLokasi) {
    var config = getConfig();
    jarak = Math.round(haversineMeter(lat, lng, config.lokasi_kantor_lat, config.lokasi_kantor_lng));
    statusLokasi = jarak <= config.radius_toleransi_m ? 'DALAM_RADIUS' : 'DILUAR_RADIUS';
  }
  var statusVerifikasi = KELOMPOK_LEMBUR.indexOf(tipe) !== -1 ? 'BELUM_DIVERIFIKASI' : 'TIDAK_BERLAKU';
  var idAbsen = 'ABS-' + tanggal.replace(/-/g, '') + '-' + waktu.replace(/:/g, '') + '-' + id;
  db.Absensi.push([idAbsen, id, karyawan.nama, tanggal, waktu, tipe, lat, lng, jarak, statusLokasi, '', statusVerifikasi, '', '']);

  return { ok: true, sudah_absen: false, tipe_absen: tipe, tanggal: tanggal, waktu: waktu, jarak_dari_kantor_m: jarak, status_lokasi: statusLokasi };
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
    izin_approve_pengajuan: castBool(row[5]), izin_verifikasi_lembur: castBool(row[6]), izin_lihat_rekap_gaji: castBool(row[7])
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
    if (['OWNER', 'HR', 'REKAP'].indexOf(role) === -1) return { ok: false, error: 'Role tidak dikenal: ' + role };
    var idBaru = buatIdAdminBaru(rows);
    var today = formatTanggal(mockNow);
    db.Admin.push([idBaru, nama, role, '', 'Aktif', role === 'OWNER', role === 'OWNER' || role === 'REKAP', role === 'OWNER' || role === 'REKAP', today]);
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

function handleGetRekapGaji(actorId, bulan) {
  var cek = requireIzin(String(actorId || '').trim(), 'izin_lihat_rekap_gaji');
  if (!cek.ok) return cek;
  bulan = String(bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulan)) return { ok: false, error: 'Parameter bulan (YYYY-MM) wajib.' };

  var karyawanRows = db.Karyawan;
  var rekap = {};
  for (var i = 1; i < karyawanRows.length; i++) {
    var idK = String(karyawanRows[i][0]).trim();
    if (!idK) continue;
    rekap[idK] = { id_karyawan: idK, nama: String(karyawanRows[i][1]).trim(), hari_masuk: 0, hari_lengkap: 0, menit_lembur_terverifikasi: 0 };
  }
  var rows = db.Absensi;
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
  return { ok: true, bulan: bulan, rekap: hasil, catatan: 'Belum termasuk Cuti/Izin — menunggu skema Form Izin final.' };
}

// ===================== ROUTING (mirip doGet/doPost) =====================

function doGet(params) {
  var action = String(params.action || '').trim();
  if (action === 'getKaryawan') return handleGetKaryawan();
  if (action === 'riwayat') return handleRiwayat(params);
  if (action === 'getDaftarAdmin') return handleGetDaftarAdmin();
  if (action === 'getAntreanLembur') return handleGetAntreanLembur(params.actor_id_admin);
  if (action === 'getRekapGaji') return handleGetRekapGaji(params.actor_id_admin, params.bulan);
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
  return { ok: false, error: 'Action tidak dikenal: ' + action };
}

module.exports = {
  resetState: resetState,
  setNow: setNow,
  getSheetData: getSheetData,
  doGet: doGet,
  doPost: doPost
};
