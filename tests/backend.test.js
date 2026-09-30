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

test('action=absen dgn tipe_absen IZIN juga ditolak (bukan cuma CUTI)', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'IZIN' });
  assert.strictEqual(res.ok, false);
  assert.ok(/ajukan izin/i.test(res.error));
});

test('tipe_absen OFF sudah dihapus — dianggap tidak dikenal', function () {
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'OFF' });
  assert.strictEqual(res.ok, false);
  assert.ok(/tidak dikenal/i.test(res.error));
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

test('Owner bisa tambah admin dgn role BEBAS TEKS (bukan cuma OWNER/HR/REKAP)', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'tambah', nama: 'Pak Joko', role: 'SUPERVISOR' });
  assert.strictEqual(res.ok, true);
  var daftar = backend.doGet({ action: 'getDaftarAdmin' });
  var joko = daftar.admin.filter(function (a) { return a.id_admin === res.id_admin; })[0];
  assert.strictEqual(joko.role, 'SUPERVISOR');
  // role custom → default SEMUA izin OFF (Owner tinggal centang manual)
  assert.strictEqual(joko.izin_approve_pengajuan, false);
  assert.strictEqual(joko.izin_verifikasi_lembur, false);
  assert.strictEqual(joko.izin_lihat_rekap_gaji, false);
  assert.strictEqual(joko.izin_lihat_pengajuan, false);
});

test('tambah admin: role kosong ditolak', function () {
  var res = backend.doPost({ action: 'adminSimpanAkun', actor_id_admin: 'ADM001', mode: 'tambah', nama: 'Coba', role: '' });
  assert.strictEqual(res.ok, false);
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

// ===================== ADMIN: rekap =====================

test('rekap: hari_kerja/hari_izin/hari_cuti/menit_lembur_terverifikasi dihitung benar', function () {
  ubahJam('08:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  ubahJam('16:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: -7.32, lng: 110.19 });
  ubahJam('17:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
  ubahJam('19:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
  backend.doPost({ action: 'verifikasiLembur', actor_id_admin: 'ADM001', id_karyawan: 'OKT001', tanggal: '2026-07-30' });

  var buatIzin = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-07-31', tanggal_selesai: '2026-07-31', alasan: 'Demam' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buatIzin.id_pengajuan, keputusan: 'DISETUJUI' });
  backend.setNow(new Date('2026-07-30T02:00:05.000Z')); // geser 5 detik hindari id_pengajuan sama persis (dua ajukanIzin di detik yg sama akan collide)
  var buatCuti = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-07-28', tanggal_selesai: '2026-07-28', alasan: 'Acara keluarga' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buatCuti.id_pengajuan, keputusan: 'DISETUJUI' });

  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' });
  assert.strictEqual(res.ok, true);
  var rama = res.rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(rama.hari_kerja, 1);
  assert.strictEqual(rama.hari_izin, 1);
  assert.strictEqual(rama.hari_cuti, 1);
  assert.ok(rama.menit_lembur_terverifikasi > 0);
});

test('rekap: filter id_karyawan hanya kembalikan 1 orang', function () {
  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07', id_karyawan: 'OKT002' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rekap.length, 1);
  assert.strictEqual(res.rekap[0].id_karyawan, 'OKT002');
});

test('rekap: filter rentang tanggal custom override bulan', function () {
  ubahJam('08:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
  var res = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', tanggal_mulai: '2026-07-30', tanggal_selesai: '2026-07-30' });
  assert.strictEqual(res.ok, true);
  var rama = res.rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(rama.hari_kerja, 1);
});

// ===================== PENGAJUAN IZIN: ajukanIzin =====================

test('ajukanIzin CUTI sukses maks 2 hari, jumlah_hari dihitung benar', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'Pulang kampung'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.jumlah_hari, 2);
  var rows = backend.getSheetData('Pengajuan');
  assert.strictEqual(rows.length, 2); // header + 1 baris baru
  assert.strictEqual(rows[1][9], 'PENDING');
});

test('ajukanIzin CUTI lebih dari 2 hari ditolak', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'Pulang kampung'
  });
  assert.strictEqual(res.ok, false);
  assert.ok(/maksimal 2 hari/i.test(res.error));
});

test('ajukanIzin SAKIT boleh lebih dari 2 hari (batas cuma berlaku utk CUTI)', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT',
    tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-13', alasan: 'Demam berdarah'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.jumlah_hari, 4);
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

test('ajukanIzin: tipe_izin tidak dikenal ditolak (termasuk OFF, sudah dihapus)', function () {
  var res = backend.doPost({
    action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'OFF',
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
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  var res = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'IZIN', tanggal_mulai: '2026-08-11', tanggal_selesai: '2026-08-13', alasan: 'B' });
  assert.strictEqual(res.ok, false);
  assert.ok(/tumpang tindih/i.test(res.error));
});

test('ajukanIzin: karyawan lain boleh ajukan tanggal yg sama (overlap cuma dicek per-orang)', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  var res = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT002', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'B' });
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

test('getAntreanPengajuan: item CUTI disertai sisa_kuota_cuti', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-10', alasan: 'A' });
  var res = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(typeof res.antrean[0].sisa_kuota_cuti, 'number');
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

test('putuskanPengajuan: Owner tolak (DITOLAK) TANPA catatan → status berubah, TIDAK ada baris Absensi baru', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DITOLAK' });
  assert.strictEqual(res.ok, true);
  var rowsAbsensi = backend.getSheetData('Absensi');
  assert.strictEqual(rowsAbsensi.length, 1); // cuma header, tidak ada baris baru
  var rowsPengajuan = backend.getSheetData('Pengajuan');
  assert.strictEqual(rowsPengajuan[1][9], 'DITOLAK');
});

test('putuskanPengajuan: Owner setuju (DISETUJUI) → Absensi terisi utk SETIAP tanggal dalam rentang', function () {
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  var res = backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tanggal_ditulis.length, 2);
  var rowsAbsensi = backend.getSheetData('Absensi');
  assert.strictEqual(rowsAbsensi.length, 3); // header + 2 hari
  var tanggalTertulis = rowsAbsensi.slice(1).map(function (r) { return r[3]; });
  assert.deepStrictEqual(tanggalTertulis, ['2026-08-10', '2026-08-11']);
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

  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-12', alasan: 'Demam' });
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

// ===================== KUOTA CUTI =====================

test('kuota cuti: karyawan baru (< 1 thn kerja) kuota otomatis 0', function () {
  var res = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kuota, 0);
});

test('kuota cuti: karyawan lewat 1 thn kerja dapat 12 hari otomatis', function () {
  var rows = backend.getSheetData('Karyawan');
  rows[1][4] = '2025-01-01'; // OKT001 daftar > 1 tahun sebelum mockNow (2026-07-30)
  var res = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kuota, 12);
});

test('kuota cuti: terpakai bertambah setelah pengajuan CUTI disetujui, sisa berkurang', function () {
  var rows = backend.getSheetData('Karyawan');
  rows[1][4] = '2025-01-01';
  var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'A' });
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });
  var res = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(res.terpakai, 2);
  assert.strictEqual(res.sisa, 10);
});

test('setKuotaCutiOverride: KHUSUS Owner, menimpa perhitungan otomatis', function () {
  var tolak = backend.doPost({ action: 'setKuotaCutiOverride', actor_id_admin: 'ADM003', id_karyawan: 'OKT001', override: '20' });
  assert.strictEqual(tolak.ok, false);
  var res = backend.doPost({ action: 'setKuotaCutiOverride', actor_id_admin: 'ADM001', id_karyawan: 'OKT001', override: '20' });
  assert.strictEqual(res.ok, true);
  var cek = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(cek.kuota, 20);
});

test('setKuotaCutiOverride: kosongkan override balik ke perhitungan otomatis', function () {
  backend.doPost({ action: 'setKuotaCutiOverride', actor_id_admin: 'ADM001', id_karyawan: 'OKT001', override: '20' });
  backend.doPost({ action: 'setKuotaCutiOverride', actor_id_admin: 'ADM001', id_karyawan: 'OKT001', override: '' });
  var cek = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
  assert.strictEqual(cek.kuota, 0); // OKT001 belum 1 thn kerja di skenario default
});

test('getKuotaCuti: KHUSUS Owner, daftar semua karyawan aktif', function () {
  var tolak = backend.doGet({ action: 'getKuotaCuti', actor_id_admin: 'ADM002' });
  assert.strictEqual(tolak.ok, false);
  var res = backend.doGet({ action: 'getKuotaCuti', actor_id_admin: 'ADM001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kuota.length, 2);
});

// ===================== DIVISI, JAM KERJA & STATUS TERLAMBAT =====================

var LOK = { lat: -7.3234422729931525, lng: 110.19331425092193 };

function setJadwal(idxBaris, teks) { backend.getSheetData('Karyawan')[idxBaris][7] = teks; }

function barisAbsenTerakhir() {
  var a = backend.getSheetData('Absensi');
  return a[a.length - 1];
}

// Absen MASUK OKT001 pada jam WIB tertentu, kembalikan status_waktu yg tertulis di Sheet
function statusMasukPada(jamStr, idKaryawan) {
  ubahJam(jamStr);
  var res = backend.doPost({ action: 'absen', id_karyawan: idKaryawan || 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(res.ok, true);
  return barisAbsenTerakhir()[14];
}

test('getKaryawan menyertakan divisi (dipakai filter dashboard admin)', function () {
  var res = backend.doGet({ action: 'getKaryawan' });
  assert.strictEqual(res.karyawan[0].divisi, 'DIVISI A');
  assert.strictEqual(res.karyawan[1].divisi, 'DIVISI B');
});

test('jadwal 08.00-16.00: tepat 08:00 dan tepat 08:15 = TEPAT_WAKTU, 08:16 = TERLAMBAT', function () {
  setJadwal(1, '08.00 - 16.00');
  assert.strictEqual(statusMasukPada('08:00'), 'TEPAT_WAKTU');
  backend.resetState(); setJadwal(1, '08.00 - 16.00');
  assert.strictEqual(statusMasukPada('08:15'), 'TEPAT_WAKTU');
  backend.resetState(); setJadwal(1, '08.00 - 16.00');
  assert.strictEqual(statusMasukPada('08:16'), 'TERLAMBAT');
});

test('detik diabaikan: 08:15:59 masih TEPAT_WAKTU, 08:16:00 TERLAMBAT', function () {
  setJadwal(1, '08.00 - 16.00');
  backend.setNow(new Date('2026-07-30T01:15:59.000Z')); // 08:15:59 WIB
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(barisAbsenTerakhir()[4], '08:15:59');
  assert.strictEqual(barisAbsenTerakhir()[14], 'TEPAT_WAKTU');
  backend.resetState(); setJadwal(1, '08.00 - 16.00');
  backend.setNow(new Date('2026-07-30T01:16:00.000Z')); // 08:16:00 WIB
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(barisAbsenTerakhir()[14], 'TERLAMBAT');
});

test('datang lebih awal dari jam masuk = TEPAT_WAKTU', function () {
  setJadwal(1, '07.00 - 16.00');
  assert.strictEqual(statusMasukPada('06:20'), 'TEPAT_WAKTU');
});

test('dua shift (Cafe): shift acuan = jam mulai terdekat dgn jam absen', function () {
  var cafe = '09.00 - 17.00 / 14.00 - 22.00';
  var kasus = [['09:10', 'TEPAT_WAKTU'], ['09:20', 'TERLAMBAT'], ['13:50', 'TEPAT_WAKTU'], ['14:10', 'TEPAT_WAKTU'], ['14:20', 'TERLAMBAT']];
  kasus.forEach(function (k) {
    backend.resetState(); setJadwal(1, cafe);
    assert.strictEqual(statusMasukPada(k[0]), k[1], 'jam ' + k[0]);
  });
});

test('pemisah titik dua & tanpa spasi ("08:00-16:00") juga terbaca', function () {
  setJadwal(1, '08:00-16:00');
  assert.strictEqual(statusMasukPada('08:30'), 'TERLAMBAT');
});

test('tanpa jam_kerja (kosong) = TIDAK_BERLAKU, absen tetap sukses', function () {
  assert.strictEqual(statusMasukPada('11:00'), 'TIDAK_BERLAKU');
});

test('jam_kerja tidak terbaca / rusak = TIDAK_BERLAKU, absen TIDAK diblokir', function () {
  ['pagi hari', '25.00 - 16.00', '08.00', '08.99 - 16.00'].forEach(function (rusak) {
    backend.resetState(); setJadwal(1, rusak);
    assert.strictEqual(statusMasukPada('11:00'), 'TIDAK_BERLAKU', rusak);
  });
});

test('hanya MASUK yang dinilai: PULANG & Lembur = TIDAK_BERLAKU', function () {
  setJadwal(1, '08.00 - 16.00');
  statusMasukPada('08:00');
  ubahJam('16:05');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'PULANG', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(barisAbsenTerakhir()[5], 'PULANG');
  assert.strictEqual(barisAbsenTerakhir()[14], 'TIDAK_BERLAKU');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(barisAbsenTerakhir()[14], 'TIDAK_BERLAKU');
});

test('absen MASUK ganda tidak menulis ulang / mengubah status_waktu', function () {
  setJadwal(1, '08.00 - 16.00');
  assert.strictEqual(statusMasukPada('08:30'), 'TERLAMBAT');
  ubahJam('08:31');
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(res.sudah_absen, true);
  assert.strictEqual(backend.getSheetData('Absensi').length, 2); // header + 1 baris
});

test('toleransi bisa diubah lewat Config (toleransi_terlambat_menit)', function () {
  setJadwal(1, '08.00 - 16.00');
  backend.getSheetData('Config').forEach(function (r) { if (r[0] === 'toleransi_terlambat_menit') r[1] = 30; });
  assert.strictEqual(statusMasukPada('08:30'), 'TEPAT_WAKTU');
  backend.resetState(); setJadwal(1, '08.00 - 16.00');
  backend.getSheetData('Config').forEach(function (r) { if (r[0] === 'toleransi_terlambat_menit') r[1] = 30; });
  assert.strictEqual(statusMasukPada('08:31'), 'TERLAMBAT');
});

test('Config lama tanpa key toleransi_terlambat_menit → default 15 menit', function () {
  setJadwal(1, '08.00 - 16.00');
  var cfg = backend.getSheetData('Config');
  for (var i = cfg.length - 1; i >= 1; i--) if (cfg[i][0] === 'toleransi_terlambat_menit') cfg.splice(i, 1);
  assert.strictEqual(statusMasukPada('08:15'), 'TEPAT_WAKTU');
  backend.resetState(); setJadwal(1, '08.00 - 16.00');
  cfg = backend.getSheetData('Config');
  for (var j = cfg.length - 1; j >= 1; j--) if (cfg[j][0] === 'toleransi_terlambat_menit') cfg.splice(j, 1);
  assert.strictEqual(statusMasukPada('08:16'), 'TERLAMBAT');
});

test('karyawan TIDAK melihat status_waktu: respons absen & riwayat tidak memuatnya', function () {
  setJadwal(1, '08.00 - 16.00');
  ubahJam('09:00');
  var res = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(JSON.stringify(res).indexOf('TERLAMBAT'), -1);
  assert.strictEqual(JSON.stringify(res).indexOf('status_waktu'), -1);
  var ulang = backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  assert.strictEqual(JSON.stringify(ulang).indexOf('TERLAMBAT'), -1);
  var riwayat = backend.doGet({ action: 'riwayat', id_karyawan: 'OKT001', bulan: '2026-07' });
  assert.strictEqual(JSON.stringify(riwayat).indexOf('TERLAMBAT'), -1);
  assert.strictEqual(JSON.stringify(riwayat).indexOf('status_waktu'), -1);
});

test('baris Cuti/Izin hasil approval pengajuan = status_waktu TIDAK_BERLAKU', function () {
  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'IZIN', tanggal_mulai: '2026-08-03', tanggal_selesai: '2026-08-03', alasan: 'Urusan keluarga' });
  var id = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM001' }).antrean[0].id_pengajuan;
  backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: id, keputusan: 'DISETUJUI' });
  var baris = barisAbsenTerakhir();
  assert.strictEqual(baris[5], 'IZIN');
  assert.strictEqual(baris.length, 15);
  assert.strictEqual(baris[14], 'TIDAK_BERLAKU');
});

test('ID format OKT+NIK (mis. OKT123456): login & absen jalan normal', function () {
  backend.getSheetData('Karyawan').push(['OKT123456', 'KARYAWAN CONTOH', '', 'Aktif', '2026-07-01', '', 'MARKETING SALES', '08.00 - 16.00']);
  var login = backend.doPost({ action: 'login', id_karyawan: 'OKT123456', pin: '4321' });
  assert.strictEqual(login.ok, true);
  assert.strictEqual(statusMasukPada('08:40', 'OKT123456'), 'TERLAMBAT');
});

test('rekap: kolom divisi + jumlah terlambat (hanya MASUK berstatus TERLAMBAT dalam periode)', function () {
  setJadwal(1, '08.00 - 16.00');
  // 3 hari: tepat waktu, terlambat, terlambat  (28-30 Juli 2026)
  [['2026-07-28T01:00:00.000Z', 'TEPAT'], ['2026-07-29T01:30:00.000Z', 'LATE'], ['2026-07-30T01:45:00.000Z', 'LATE']].forEach(function (k) {
    backend.setNow(new Date(k[0]));
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  });
  // 1 hari terlambat di bulan lain → tidak boleh ikut hitungan Juli
  backend.setNow(new Date('2026-08-03T01:40:00.000Z'));
  backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: LOK.lat, lng: LOK.lng });
  var rekap = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' }).rekap;
  var r1 = rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(r1.hari_kerja, 3);
  assert.strictEqual(r1.terlambat, 2);
  assert.strictEqual(r1.divisi, 'DIVISI A');
  var r2 = rekap.filter(function (r) { return r.id_karyawan === 'OKT002'; })[0];
  assert.strictEqual(r2.terlambat, 0);
  var rentang = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', tanggal_mulai: '2026-07-29', tanggal_selesai: '2026-08-03' }).rekap;
  assert.strictEqual(rentang.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0].terlambat, 3);
});

test('rekap: baris Absensi lama (tanpa kolom status_waktu) tidak error & tidak dihitung terlambat', function () {
  var a = backend.getSheetData('Absensi');
  a.push(['ABS-LAMA', 'OKT001', 'Test Rama', '2026-07-10', '09:30:00', 'MASUK', LOK.lat, LOK.lng, 0, 'DALAM_RADIUS', '', 'TIDAK_BERLAKU', '', '']); // hanya 14 kolom
  var rekap = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' }).rekap;
  var r1 = rekap.filter(function (r) { return r.id_karyawan === 'OKT001'; })[0];
  assert.strictEqual(r1.hari_kerja, 1);
  assert.strictEqual(r1.terlambat, 0);
});

test('rekap: filter divisi (tidak peka huruf besar/kecil), bisa digabung dgn filter karyawan', function () {
  var semua = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' }).rekap;
  assert.strictEqual(semua.length, 2);
  var a = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07', divisi: 'divisi a' }).rekap;
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].id_karyawan, 'OKT001');
  var kosong = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07', divisi: 'DIVISI A', id_karyawan: 'OKT002' }).rekap;
  assert.strictEqual(kosong.length, 0);
  var tidakAda = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07', divisi: 'TIDAK ADA' }).rekap;
  assert.strictEqual(tidakAda.length, 0);
});

test('divisi ikut di antrean Lembur, antrean Pengajuan, dan Kuota Cuti', function () {
  ubahJam('17:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT002', tipe_absen: 'MULAI_LEMBUR', lat: LOK.lat, lng: LOK.lng });
  ubahJam('19:00');
  backend.doPost({ action: 'absen', id_karyawan: 'OKT002', tipe_absen: 'SELESAI_LEMBUR', lat: LOK.lat, lng: LOK.lng });
  var lembur = backend.doGet({ action: 'getAntreanLembur', actor_id_admin: 'ADM001' }).antrean;
  assert.strictEqual(lembur[0].divisi, 'DIVISI B');

  backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-03', tanggal_selesai: '2026-08-03', alasan: 'Demam' });
  var pengajuan = backend.doGet({ action: 'getAntreanPengajuan', actor_id_admin: 'ADM001' }).antrean;
  assert.strictEqual(pengajuan[0].divisi, 'DIVISI A');

  var kuota = backend.doGet({ action: 'getKuotaCuti', actor_id_admin: 'ADM001' }).kuota;
  assert.strictEqual(kuota.filter(function (k) { return k.id_karyawan === 'OKT001'; })[0].divisi, 'DIVISI A');
});

test('Sheet Karyawan lama (6 kolom, tanpa divisi/jam_kerja) tetap jalan: divisi kosong, status TIDAK_BERLAKU', function () {
  var k = backend.getSheetData('Karyawan');
  for (var i = 0; i < k.length; i++) k[i].length = 6; // simulasi Sheet belum dimigrasi
  var res = backend.doGet({ action: 'getKaryawan' });
  assert.strictEqual(res.karyawan[0].divisi, '');
  assert.strictEqual(statusMasukPada('09:00'), 'TIDAK_BERLAKU');
  var rekap = backend.doGet({ action: 'getRekapGaji', actor_id_admin: 'ADM001', bulan: '2026-07' });
  assert.strictEqual(rekap.ok, true);
  assert.strictEqual(rekap.rekap[0].divisi, '');
});
test('kuota cuti: tanggal_daftar bertipe Date (dari Sheet) dibaca benar, bukan dianggap tanggal rusak', function () {
  var k = backend.getSheetData('Karyawan');
  k[1][4] = new Date('2021-03-01T00:00:00+07:00'); // >1 thn kerja
  k[2][4] = new Date('2026-07-01T00:00:00+07:00'); // <1 thn
  assert.strictEqual(backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' }).kuota, 12);
  assert.strictEqual(backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT002' }).kuota, 0);
  var daftar = backend.doGet({ action: 'getKuotaCuti', actor_id_admin: 'ADM001' }).kuota;
  assert.strictEqual(daftar.filter(function (x) { return x.id_karyawan === 'OKT001'; })[0].tanggal_daftar, '2021-03-01');
});
// ===================== RINGKASAN =====================

console.log('');
console.log(total - gagal + '/' + total + ' test backend PASS');
if (gagal > 0) process.exit(1);
