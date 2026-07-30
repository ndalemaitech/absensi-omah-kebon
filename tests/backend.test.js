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

test('action=absen dgn tipe_absen CUTI ditolak, diarahkan ke menu Ajukan Izin', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'CUTI' });
  assert.strictEqual(res.ok, false);
  assert.ok(/ajukan izin/i.test(res.error));
});

test('action=absen dgn tipe_absen OFF juga ditolak (bukan cuma CUTI)', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'OFF' });
  assert.strictEqual(res.ok, false);
  assert.ok(/ajukan izin/i.test(res.error));
});

// ===================== KARYAWAN: Lembur =====================

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

test('getDaftarAdmin: role & izin default benar termasuk izin_lihat_pengajuan', function () {
  var res = backend.doGet({ action: 'getDaftarAdmin' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.admin.length, 3);
  var owner = res.admin.filter(function (a) { return a.role === 'OWNER'; })[0];
  var hr = res.admin.filter(function (a) { return a.role === 'HR'; })[0];
  var rekap = res.admin.filter(function (a) { return a.role === 'REKAP'; })[0];
  assert.strictEqual(owner.izin_lihat_pengajuan, true);
  assert.strictEqual(hr.izin_lihat_pengajuan, true);
  assert.strictEqual(hr.izin_approve_pengajuan, false);
  assert.strictEqual(rekap.izin_lihat_pengajuan, false);
});

test('adminGantiPin: PIN lama salah ditolak, PIN lama benar sukses', function () {
  backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' });
  var salah = backend.doPost({ action: 'adminGantiPin', id_admin: 'ADM001', pin_lama: '0000', pin_baru: '5555' });
  assert.strictEqual(salah.ok, false);
  var benar = backend.doPost({ action: 'adminGantiPin', id_admin: 'ADM001', pin_lama: '1111', pin_baru: '5555' });
  assert.strictEqual(benar.ok, true);
  var loginBaru = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '5555' });
  assert.strictEqual(loginBaru.ok, true);
});

// ===================== ADMIN: kelola akun =====================

test('non-Owner ditolak akses adminSimpanAkun', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM003', mode: 'tambah', nama: 'Coba', role: 'HR' });
  assert.strictEqual(res.ok, false);
  assert.ok(/hanya owner/i.test(res.error));
});

test('Owner bisa ubah izin_lihat_pengajuan admin lain via edit_izin', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'edit_izin', target_id_admin: 'ADM002', izin_lihat_pengajuan: true });
  assert.strictEqual(res.ok, true);
  var daftar = backend.doGet({ action: 'getDaftarAdmin' });
  var tika = daftar.admin.filter(function (a) { return a.id_admin === 'ADM002'; })[0];
  assert.strictEqual(tika.izin_lihat_pengajuan, true);
});

// ===================== ADMIN: antrean & verifikasi Lembur =====================

test('REKAP bisa lihat antrean lembur, HR tanpa izin ditolak', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM002' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.antrean.length, 1);
  var resHr = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM003' });
  assert.strictEqual(resHr.ok, false);
});

test('durasi lembur dihitung benar dari jam mulai/selesai', function () {
  ubahJam('17:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  ubahJam('19:30');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.antrean[0].durasi_menit, 150);
});

test('verifikasiLembur sukses, sesudahnya hilang dari antrean', function () {
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  var verif = backend.doPost({ action: 'verifikasiLembur', actor_id_admin: 'ADM002', id_karyawan: 'OKT001', tanggal: '2026-07-30' });
  assert.strictEqual(verif.ok, true);
  var antrean = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM002' });
  assert.strictEqual(antrean.antrean.length, 0);
});

// ===================== ADMIN: rekap gaji =====================

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

// ===================== PENGAJUAN IZIN: ajukanIzin =====================

test('ajukanIzin sukses, jumlah_hari dihitung benar (rentang 3 hari)', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'Pulang kampung'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.jumlah_hari, 3);
  var rows = backend.getSheetData('Pengajuan');
  assert.strictEqual(rows.length, 2); // header + 1 baris baru
  assert.strictEqual(rows[1][9], 'PENDING');
});

test('ajukanIzin: tanggal selesai sebelum mulai ditolak', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI',
    tanggal_mulai: '2026-08-12', tanggal_selesai: '2026-08-10', alasan: 'x'
  });
  assert.strictEqual(res.ok, false);
});

test('ajukanIzin: alasan kosong ditolak', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: ''
  });
  assert.strictEqual(res.ok, false);
});

test('ajukanIzin: tipe_izin tidak dikenal ditolak', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'LIBUR_NASIONAL',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'x'
  });
  assert.strictEqual(res.ok, false);
});

test('ajukanIzin: lampiran base64 tersimpan sbg lampiran_url', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'Demam',
    lampiran_base64: 'ZmFrZS1pbWFnZS1kYXRh', lampiran_mime: 'image/jpeg', lampiran_nama: 'surat-sakit'
  });
  assert.strictEqual(res.ok, true);
  var rows = backend.getSheetData('Pengajuan');
  assert.ok(rows[1][8].indexOf('surat-sakit') !== -1);
});

test('ajukanIzin: rentang tumpang tindih dgn pengajuan sendiri yg masih berjalan ditolak', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'A' });
  var res = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'OFF', tanggal_mulai: '2026-08-12', tanggal_selesai: '2026-08-13', alasan: 'B' });
  assert.strictEqual(res.ok, false);
  assert.ok(/tumpang tindih/i.test(res.error));
});

test('ajukanIzin: karyawan lain boleh ajukan tanggal yg sama (overlap cuma dicek per-orang)', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'A' });
  var res = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT002', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'B' });
  assert.strictEqual(res.ok, true);
});

// ===================== PENGAJUAN IZIN: lihat riwayat & antrean =====================

test('getPengajuanSaya hanya kembalikan milik karyawan itu', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT002', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-11', tanggal_selesai: '2026-08-11', alasan: 'B' });
  var res = backend.doGet({ action: 'getPengajuanSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.pengajuan.length, 1);
  assert.strictEqual(res.pengajuan[0].id_karyawan, 'OKT001');
});

test('getAntreanPengajuan: HR (izin_lihat_pengajuan default true) bisa lihat tapi bisa_putuskan false', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  var res = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM003' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.antrean.length, 1);
  assert.strictEqual(res.bisa_putuskan, false);
});

test('getAntreanPengajuan: Rekap (izin_lihat_pengajuan default false) ditolak', function () {
  var res = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM002' });
  assert.strictEqual(res.ok, false);
});

test('getAntreanPengajuan: yang sudah diputuskan tidak lagi muncul di antrean', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DITOLAK' });
  var res = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.antrean.length, 0);
});

// ===================== PENGAJUAN IZIN: putuskanPengajuan =====================

test('putuskanPengajuan: HR (izin_approve_pengajuan false) ditolak memutuskan', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM003', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  assert.strictEqual(res.ok, false);
});

test('putuskanPengajuan: Owner tolak (DITOLAK) → status berubah, TIDAK ada baris Absensi baru', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DITOLAK', catatan_admin: 'Belum waktunya' });
  assert.strictEqual(res.ok, true);
  var rowsAbsensi = backend.getSheetData('Absensi');
  assert.strictEqual(rowsAbsensi.length, 1); // cuma header, tidak ada baris baru
  var rowsPengajuan = backend.getSheetData('Pengajuan');
  assert.strictEqual(rowsPengajuan[1][9], 'DITOLAK');
  assert.strictEqual(rowsPengajuan[1][13], 'Belum waktunya');
});

test('putuskanPengajuan: Owner setuju (DISETUJUI) → Absensi terisi utk SETIAP tanggal dalam rentang', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tanggal_ditulis.length, 3);
  var rowsAbsensi = backend.getSheetData('Absensi');
  assert.strictEqual(rowsAbsensi.length, 4); // header + 3 hari
  var tanggalTertulis = rowsAbsensi.slice(1).map(function (r) { return r[3]; });
  assert.deepStrictEqual(tanggalTertulis, ['2026-08-10', '2026-08-11', '2026-08-12']);
  assert.strictEqual(rowsAbsensi[1][5], 'CUTI');
});

test('putuskanPengajuan: pengajuan yg sudah diputuskan tidak bisa diputuskan lagi', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DITOLAK' });
  assert.strictEqual(res.ok, false);
  assert.ok(/sudah diputuskan/i.test(res.error));
});

test('putuskanPengajuan DISETUJUI: tanggal yg sudah ada MASUK di-skip (tanggal_dilewati), tanggal lain tetap ditulis', function () {
  ubahJam('08:00');
  backend.setNow(new Date('2026-08-11T01:00:00.000Z')); // 2026-08-11 08:00 WIB
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  backend.setNow(new Date('2026-07-30T02:00:00.000Z')); // balik ke waktu submit pengajuan

  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tanggal_ditulis.length, 2); // 10 & 12 (11 bentrok Masuk)
  assert.strictEqual(res.tanggal_dilewati.length, 1);
  assert.ok(res.tanggal_dilewati[0].indexOf('2026-08-11') !== -1);
});

test('Integrasi: setelah pengajuan CUTI disetujui, absen MASUK di tanggal itu ditolak', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });

  backend.setNow(new Date('2026-08-10T01:00:00.000Z')); // 2026-08-10 08:00 WIB
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  assert.strictEqual(res.ok, false);
  assert.ok(/cuti/i.test(res.error));
});

// ===================== RINGKASAN =====================

console.log('');
console.log(total - gagal + '/' + total + ' test backend PASS');
if (gagal > 0) process.exit(1);
