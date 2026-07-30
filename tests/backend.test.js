/**
 * Test logic backend (lewat mockBackend.js) — tanpa jsdom, murni cek
 * request/response action=... seperti yang akan dikirim frontend.
 * Jalankan: node tests/backend.test.js
 */
'use strict';

var assert = require('assert');
var backend = require('./mockBackend');

var total = 0, gagal = 0;

function test(nama, fn) {
  total++;
  try {
    backend.resetState();
    backend.setNow(new Date('2026-07-30T02:00:00.000Z')); // ~09:00 WIB
    fn();
    console.log('  OK  ' + nama);
  } catch (e) {
    gagal++;
    console.log('FAIL  ' + nama);
    console.log('      ' + e.message);
  }
}

function ubahJam(jamStr) {
  // jamStr 'HH:mm' WIB → set mockNow ke jam itu tanggal 2026-07-30
  var parts = jamStr.split(':');
  var jamUTC = (parseInt(parts[0], 10) - 7 + 24) % 24;
  backend.setNow(new Date('2026-07-30T' + (jamUTC < 10 ? '0' : '') + jamUTC + ':' + parts[1] + ':00.000Z'));
}

// ===================== KARYAWAN: login & absen dasar =====================

test('getKaryawan hanya kembalikan yang Aktif', function () {
  var res = backend.doGet({ action: 'getKaryawan' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.karyawan.length, 2);
  assert.strictEqual(res.karyawan[0].perlu_pin_baru, true);
});

test('login pertama kali membuat PIN baru', function () {
  var res = backend.doPost({ action: 'login', id_karyawan: 'OKT001', pin: '1234' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.pin_baru_dibuat, true);
  var res2 = backend.doPost({ action: 'login', id_karyawan: 'OKT001', pin: '1234' });
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.pin_baru_dibuat, false);
});

test('login PIN salah ditolak', function () {
  backend.doPost({ action: 'login', id_karyawan: 'OKT001', pin: '1234' });
  var res = backend.doPost({ action: 'login', id_karyawan: 'OKT001', pin: '9999' });
  assert.strictEqual(res.ok, false);
});

test('absen MASUK sukses, lokasi dalam radius', function () {
  // koordinat sama persis dgn Config → jarak 0
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.3234422729931525, lng: 110.19331425092193 });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status_lokasi, 'DALAM_RADIUS');
});

test('absen MASUK tanpa lokasi ditolak', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK' });
  assert.strictEqual(res.ok, false);
});

test('absen PULANG tanpa MASUK ditolak', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, false);
  assert.ok(/belum absen masuk/i.test(res.error));
});

test('MASUK lalu PULANG sukses berurutan', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.3234422729931525, lng: 110.19331425092193 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: -7.3234422729931525, lng: 110.19331425092193 });
  assert.strictEqual(res.ok, true);
});

test('absen ganda MASUK dua kali → sudah_absen true, bukan baris baru', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.sudah_absen, true);
  var rows = backend.getSheetData('Absensi');
  assert.strictEqual(rows.length, 2); // header + 1 baris saja
});

test('CUTI sukses tanpa lokasi', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status_lokasi, 'TIDAK_BERLAKU');
});

test('MASUK lalu CUTI ditolak (hadir vs tidak hadir eksklusif)', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  assert.strictEqual(res.ok, false);
});

test('CUTI lalu MASUK ditolak (arah sebaliknya)', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, false);
});

test('CUTI lalu OFF ditolak (saling eksklusif dlm kelompok tidak hadir)', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'OFF' });
  assert.strictEqual(res.ok, false);
});

// ===================== KARYAWAN: Lembur (fitur baru) =====================

test('MULAI_LEMBUR butuh lokasi, sukses dengan lokasi', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, true);
});

test('SELESAI_LEMBUR tanpa MULAI_LEMBUR ditolak', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, false);
  assert.ok(/belum mulai lembur/i.test(res.error));
});

test('MULAI_LEMBUR lalu SELESAI_LEMBUR sukses berurutan', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, true);
});

test('Lembur baru ditulis dgn status_verifikasi BELUM_DIVERIFIKASI', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var rows = backend.getSheetData('Absensi');
  var last = rows[rows.length - 1];
  assert.strictEqual(last[5], 'MULAI_LEMBUR');
  assert.strictEqual(last[11], 'BELUM_DIVERIFIKASI');
});

test('MASUK + PULANG lalu Lembur TETAP boleh (lembur tidak eksklusif thd hadir)', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, true);
});

test('Sudah MULAI_LEMBUR lalu coba CUTI ditolak (lembur termasuk golongan butuh-eksklusi thd tidak-hadir)', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  assert.strictEqual(res.ok, false);
});

test('Sudah CUTI lalu coba MULAI_LEMBUR ditolak', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, false);
});

// ===================== ADMIN: login & ganti PIN =====================

test('adminLogin pertama kali buat PIN baru', function () {
  var res = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.pin_baru_dibuat, true);
  assert.strictEqual(res.role, 'OWNER');
});

test('adminLogin PIN salah ditolak', function () {
  backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' });
  var res = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '2222' });
  assert.strictEqual(res.ok, false);
});

test('getDaftarAdmin kembalikan 3 akun awal dgn role & izin default benar', function () {
  var res = backend.doGet({ action: 'getDaftarAdmin' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.admin.length, 3);
  var owner = res.admin.filter(function (a) { return a.role === 'OWNER'; })[0];
  var hr = res.admin.filter(function (a) { return a.role === 'HR'; })[0];
  var rekap = res.admin.filter(function (a) { return a.role === 'REKAP'; })[0];
  assert.strictEqual(owner.izin_approve_pengajuan, true);
  assert.strictEqual(hr.izin_approve_pengajuan, false);
  assert.strictEqual(hr.izin_verifikasi_lembur, false);
  assert.strictEqual(rekap.izin_verifikasi_lembur, true);
  assert.strictEqual(rekap.izin_lihat_rekap_gaji, true);
});

test('adminGantiPin: PIN lama salah ditolak, PIN lama benar sukses', function () {
  backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' }); // set PIN pertama
  var salah = backend.doPost({ action: 'adminGantiPin', id_admin: 'ADM001', pin_lama: '0000', pin_baru: '5555' });
  assert.strictEqual(salah.ok, false);
  var benar = backend.doPost({ action: 'adminGantiPin', id_admin: 'ADM001', pin_lama: '1111', pin_baru: '5555' });
  assert.strictEqual(benar.ok, true);
  // Login lama sudah tidak berlaku, PIN baru berlaku
  var loginLama = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' });
  assert.strictEqual(loginLama.ok, false);
  var loginBaru = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '5555' });
  assert.strictEqual(loginBaru.ok, true);
});

// ===================== ADMIN: kelola akun (khusus Owner) =====================

test('non-Owner (HR) ditolak akses adminSimpanAkun', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM003', mode: 'tambah', nama: 'Coba', role: 'HR' });
  assert.strictEqual(res.ok, false);
  assert.ok(/hanya owner/i.test(res.error));
});

test('Owner bisa tambah akun admin baru', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'tambah', nama: 'Admin Baru', role: 'REKAP' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.id_admin, 'ADM004');
  var daftar = backend.doGet({ action: 'getDaftarAdmin' });
  assert.strictEqual(daftar.admin.length, 4);
});

test('Owner bisa reset PIN admin lain', function () {
  backend.doPost({ action: 'adminLogin', id_admin: 'ADM003', pin: '3333' });
  var reset = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'reset_pin', target_id_admin: 'ADM003' });
  assert.strictEqual(reset.ok, true);
  // Setelah reset, pin_hash kosong lagi → login berikutnya (PIN apa pun,
  // termasuk yg lama) diperlakukan sbg "buat PIN baru", sama seperti SOP
  // reset PIN karyawan. Ini BUKAN penolakan — itu justru intinya self-service.
  var loginSetelahReset = backend.doPost({ action: 'adminLogin', id_admin: 'ADM003', pin: '3333' });
  assert.strictEqual(loginSetelahReset.ok, true);
  assert.strictEqual(loginSetelahReset.pin_baru_dibuat, true);
});

test('Owner tidak bisa menonaktifkan akun sendiri', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'nonaktifkan', target_id_admin: 'ADM001' });
  assert.strictEqual(res.ok, false);
});

test('Owner bisa nonaktifkan admin lain, dan admin itu tidak bisa login lagi', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'nonaktifkan', target_id_admin: 'ADM003' });
  assert.strictEqual(res.ok, true);
  var login = backend.doPost({ action: 'adminLogin', id_admin: 'ADM003', pin: '0000' });
  assert.strictEqual(login.ok, false);
  assert.ok(/tidak aktif/i.test(login.error));
});

test('Owner bisa ubah izin admin lain via edit_izin', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'edit_izin', target_id_admin: 'ADM003', izin_approve_pengajuan: true });
  assert.strictEqual(res.ok, true);
  var daftar = backend.doGet({ action: 'getDaftarAdmin' });
  var bulis = daftar.admin.filter(function (a) { return a.id_admin === 'ADM003'; })[0];
  assert.strictEqual(bulis.izin_approve_pengajuan, true);
});

// ===================== ADMIN: antrean & verifikasi Lembur =====================

test('HR (tanpa izin_verifikasi_lembur) ditolak lihat antrean lembur', function () {
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM003' });
  assert.strictEqual(res.ok, false);
});

test('REKAP (punya izin_verifikasi_lembur) bisa lihat antrean lembur', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM002' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.antrean.length, 1);
  assert.strictEqual(res.antrean[0].id_karyawan, 'OKT001');
});

test('Sesi lembur belum lengkap (baru MULAI) tidak muncul di antrean', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.antrean.length, 0);
});

test('durasi lembur dihitung benar dari jam mulai/selesai', function () {
  ubahJam('17:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  ubahJam('19:30');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.antrean[0].durasi_menit, 150); // 2 jam 30 menit
});

test('verifikasiLembur oleh yg tidak berizin ditolak', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doPost({ action: 'verifikasiLembur', actor_id_admin: 'ADM003', id_karyawan: 'OKT001', tanggal: '2026-07-30' });
  assert.strictEqual(res.ok, false);
});

test('verifikasiLembur sukses, sesudahnya hilang dari antrean', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var verif = backend.doPost({ action: 'verifikasiLembur', actor_id_admin: 'ADM002', id_karyawan: 'OKT001', tanggal: '2026-07-30' });
  assert.strictEqual(verif.ok, true);
  var antrean = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM002' });
  assert.strictEqual(antrean.antrean.length, 0);
  var rows = backend.getSheetData('Absensi');
  var mulaiRow = rows.filter(function (r) { return r[5] === 'MULAI_LEMBUR'; })[0];
  assert.strictEqual(mulaiRow[11], 'TERVERIFIKASI');
  assert.strictEqual(mulaiRow[12], 'Mbak Tika');
});

// ===================== ADMIN: rekap gaji =====================

test('rekap gaji: HR tanpa izin_lihat_rekap_gaji ditolak', function () {
  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM003', bulan: '2026-07' });
  assert.strictEqual(res.ok, false);
});

test('rekap gaji: hitung hari masuk/lengkap/lembur terverifikasi dengan benar', function () {
  ubahJam('08:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  ubahJam('16:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: -7.32, lng: 110.19 });
  ubahJam('17:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  ubahJam('19:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'verifikasiLembur', actor_id_admin: 'ADM001', id_karyawan: 'OKT001', tanggal: '2026-07-30' });

  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' });
  assert.strictEqual(res.ok, true);
  var rama = res.rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(rama.hari_masuk, 1);
  assert.strictEqual(rama.hari_lengkap, 1);
  assert.ok(rama.menit_lembur_terverifikasi > 0);
});

test('rekap gaji: lembur BELUM diverifikasi tidak ikut terhitung', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' });
  var rama = res.rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(rama.menit_lembur_terverifikasi, 0);
});

// ===================== RINGKASAN =====================

console.log('');
console.log(total - gagal + '/' + total + ' test backend PASS');
if (gagal > 0) process.exit(1);
