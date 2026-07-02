/**
 * Absensi Omah Kebon — Backend (Google Apps Script Web App)
 * Vendor: Ndalem AI Tech
 *
 * Endpoint (routing berbasis parameter "action"):
 *   GET  ?action=getKaryawan                 → daftar karyawan aktif untuk dropdown
 *   POST action=login   {id_karyawan, pin, buat_baru}  → verifikasi PIN / set PIN baru
 *   POST action=absen   {id_karyawan, lat, lng, tipe_absen} → catat absen
 *   GET  ?action=riwayat&id_karyawan=..&bulan=YYYY-MM → data absen 1 bulan
 *
 * Script ini HARUS bound ke Google Sheet-nya (dibuat lewat menu
 * Extensions → Apps Script dari dalam Sheet).
 *
 * Setup awal: jalankan fungsi setupSheet() sekali dari editor Apps Script
 * untuk membuat 3 tab (Karyawan, Absensi, Config) lengkap dengan header
 * dan nilai Config default.
 */

var TIMEZONE = 'Asia/Jakarta';

var SHEET_KARYAWAN = 'Karyawan';
var SHEET_ABSENSI = 'Absensi';
var SHEET_CONFIG = 'Config';

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

function hashPin(idKaryawan, pin) {
  // Salt dengan id_karyawan supaya PIN sama tidak menghasilkan hash sama
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    idKaryawan + ':' + pin,
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

function handleAbsen(body) {
  var id = String(body.id_karyawan || '').trim();
  var lat = parseFloat(body.lat);
  var lng = parseFloat(body.lng);
  var tipe = String(body.tipe_absen || 'MASUK').trim().toUpperCase();
  if (!id) return { ok: false, error: 'id_karyawan wajib diisi.' };
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

    var sudah = cariAbsenHariIni(id, tanggal, tipe);
    if (sudah) {
      return {
        ok: true,
        sudah_absen: true,
        tanggal: tanggal,
        waktu: sudah.waktu,
        pesan: 'Sudah absen hari ini jam ' + sudah.waktu.substring(0, 5)
      };
    }

    var config = getConfig();
    var jarak = Math.round(
      haversineMeter(lat, lng, config.lokasi_kantor_lat, config.lokasi_kantor_lng)
    );
    var statusLokasi =
      jarak <= config.radius_toleransi_m ? 'DALAM_RADIUS' : 'DILUAR_RADIUS';

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
      '' // catatan — hanya diisi admin untuk baris input manual
    ]);

    return {
      ok: true,
      sudah_absen: false,
      tanggal: tanggal,
      waktu: waktu,
      jarak_dari_kantor_m: jarak,
      status_lokasi: statusLokasi
    };
  } finally {
    lock.releaseLock();
  }
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

// ===================== SETUP SEKALI JALAN =====================

/**
 * Jalankan SEKALI dari editor Apps Script (pilih fungsi ini → Run).
 * Membuat 3 tab lengkap dengan header, mengisi Config dengan koordinat
 * Omah Kebon, dan menambah 2 karyawan contoh untuk testing.
 * Aman dijalankan ulang — tab yang sudah ada tidak ditimpa.
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
    a.getRange(1, 1, 1, 11)
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
          'catatan'
        ]
      ])
      .setFontWeight('bold');
    // Kolom tanggal & waktu dipaksa format teks supaya tidak berubah jadi Date
    a.getRange('D:E').setNumberFormat('@');
    a.setFrozenRows(1);
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

  // Hapus tab default "Sheet1" kalau masih ada dan kosong
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 3) {
    ss.deleteSheet(sheet1);
  }

  Logger.log('Setup selesai. Tab Karyawan, Absensi, Config siap dipakai.');
}
