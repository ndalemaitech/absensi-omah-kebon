/**
 * e2e test dashboard admin (admin/index.html + admin/js/admin.js) pakai
 * jsdom, fetch di-mock langsung ke mockBackend.js.
 * Jalankan: node tests/e2e-admin.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var { JSDOM } = require('jsdom');
var backend = require('./mockBackend');

var HTML = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
var CONFIG_JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
var ADMIN_JS = fs.readFileSync(path.join(__dirname, '..', 'admin', 'js', 'admin.js'), 'utf8');

var total = 0, gagal = 0;

function makeLocalStorage() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
}

function makeFetchMock() {
  return function (url, opts) {
    return new Promise(function (resolve) {
      var qIdx = url.indexOf('?');
      if (!opts || !opts.method || opts.method === 'GET') {
        var params = {};
        if (qIdx !== -1) {
          url.slice(qIdx + 1).split('&').forEach(function (pair) {
            var kv = pair.split('=');
            params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
          });
        }
        resolve({ json: function () { return Promise.resolve(backend.doGet(params)); } });
      } else {
        var body = JSON.parse(opts.body);
        resolve({ json: function () { return Promise.resolve(backend.doPost(body)); } });
      }
    });
  };
}

// "Hari ini" tetap (WIB 09:00, 2026-07-30) — SAMA dgn default backend.setNow()
// di test_run(), supaya test tidak rapuh tergantung kapan persis suite ini
// dijalankan (lihat penjelasan lebih lengkap di e2e-karyawan.test.js).
var WAKTU_TETAP_ISO = '2026-07-30T02:00:00.000Z';

function buatFakeDate(RealDate, iso) {
  function FakeDate() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 0) args = [iso];
    var Bound = Function.prototype.bind.apply(RealDate, [null].concat(args));
    return new Bound();
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return new RealDate(iso).getTime(); };
  return FakeDate;
}

function buatDevice(localStorageAwal) {
  // admin/index.html referensi ../css/style.css & css/admin.css — tidak
  // relevan utk jsdom (kita tidak nge-tes rendering visual), abaikan aman.
  var dom = new JSDOM(HTML, { url: 'https://absensi-omahkebon.test/admin/', pretendToBeVisual: true, runScripts: 'outside-only' });
  var win = dom.window;
  win.Date = buatFakeDate(win.Date, WAKTU_TETAP_ISO);
  Object.defineProperty(win, 'localStorage', { value: localStorageAwal || makeLocalStorage(), configurable: true });
  win.fetch = makeFetchMock();
  win.confirm = function () { return true; };
  win.alert = function () { };
  win.eval(CONFIG_JS);
  win.eval(ADMIN_JS);
  return win;
}

function tunggu(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function tick(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 5); i++) p = p.then(function () { return tunggu(0); });
  return p;
}

function $(win, id) { return win.document.getElementById(id); }
function klik(win, id) { $(win, id).dispatchEvent(new win.Event('click', { bubbles: true })); }

async function loginAdmin(win, idAdmin, pin) {
  await tick(8);
  var select = $(win, 'admin-pilih-akun');
  select.value = idAdmin;
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  klik(win, 'admin-btn-lanjut-akun');
  $(win, 'admin-pin-input').value = pin;
  klik(win, 'admin-btn-kirim-pin');
  await tick(8);
}

function pindahTabUji(win, nama) {
  var tombol = win.document.querySelector('.admin-tab-item[data-tab="' + nama + '"]');
  tombol.dispatchEvent(new win.Event('click', { bubbles: true }));
}

async function test_run(nama, fn) {
  total++;
  try {
    backend.resetState();
    backend.setNow(new Date('2026-07-30T02:00:00.000Z'));
    await fn();
    console.log('  OK  ' + nama);
  } catch (e) {
    gagal++;
    console.log('FAIL  ' + nama);
    console.log('      ' + (e.stack || e.message));
  }
}

(async function () {
  await test_run('Dropdown login terisi 3 akun admin awal', async function () {
    var win = buatDevice();
    await tick(8);
    var select = $(win, 'admin-pilih-akun');
    assert.strictEqual(select.options.length, 4); // placeholder + 3 admin
  });

  await test_run('Login pertama Owner (Mas Abim): buat PIN, dashboard tampil semua tab termasuk Kuota Cuti', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    assert.strictEqual($(win, 'admin-layar-dashboard').classList.contains('admin-layar-aktif'), true);
    assert.strictEqual($(win, 'admin-nama-aktif').textContent, 'Mas Abim');
    assert.strictEqual($(win, 'admin-role-aktif').textContent, 'Owner');
    ['lembur', 'pengajuan', 'rekap', 'kuota', 'akun', 'pin'].forEach(function (tab) {
      var el = win.document.querySelector('.admin-tab-item[data-tab="' + tab + '"]');
      assert.strictEqual(el.classList.contains('admin-tab-tersembunyi'), false, tab + ' harusnya tampil utk Owner');
    });
  });

  await test_run('Login HR (Bu Lis): tab Pengajuan TAMPIL tapi lembur/rekap/kuota/akun tersembunyi', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM003', '3333');
    assert.strictEqual($(win, 'admin-role-aktif').textContent, 'HR');
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="lembur"]').classList.contains('admin-tab-tersembunyi'), true);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="pengajuan"]').classList.contains('admin-tab-tersembunyi'), false);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="rekap"]').classList.contains('admin-tab-tersembunyi'), true);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="kuota"]').classList.contains('admin-tab-tersembunyi'), true);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="akun"]').classList.contains('admin-tab-tersembunyi'), true);
  });

  await test_run('Login Rekap (Mbak Tika): tab Pengajuan tersembunyi (izin_lihat_pengajuan default false)', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM002', '2222');
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="pengajuan"]').classList.contains('admin-tab-tersembunyi'), true);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="lembur"]').classList.contains('admin-tab-tersembunyi'), false);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="rekap"]').classList.contains('admin-tab-tersembunyi'), false);
    assert.strictEqual(win.document.querySelector('.admin-tab-item[data-tab="kuota"]').classList.contains('admin-tab-tersembunyi'), true);
  });

  await test_run('PIN salah saat login ditolak dengan pesan error', async function () {
    var win = buatDevice();
    await tick(8);
    $(win, 'admin-pilih-akun').value = 'ADM001';
    $(win, 'admin-pilih-akun').dispatchEvent(new win.Event('change', { bubbles: true }));
    klik(win, 'admin-btn-lanjut-akun');
    backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '1111' });
    $(win, 'admin-pin-input').value = '9999';
    klik(win, 'admin-btn-kirim-pin');
    await tick(8);
    assert.strictEqual($(win, 'admin-layar-dashboard').classList.contains('admin-layar-aktif'), false);
    assert.ok($(win, 'admin-pin-error').textContent.length > 0);
  });

  await test_run('Verifikasi Lembur: sesi lengkap muncul di antrean, hilang setelah diverifikasi', async function () {
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-lembur-tbody tr');
    assert.strictEqual(baris.length, 1);
    assert.ok(baris[0].textContent.indexOf('Test Rama') !== -1);

    win.document.querySelector('.admin-btn-verifikasi').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(8);
    var barisSetelah = win.document.querySelectorAll('#admin-lembur-tbody tr');
    assert.strictEqual(barisSetelah.length, 0);
    assert.strictEqual($(win, 'admin-lembur-kosong').classList.contains('tersembunyi'), false);
  });

  // ===================== TAB: PENGAJUAN CUTI/IZIN =====================

  await test_run('Pengajuan: Owner lihat antrean kosong kalau belum ada pengajuan', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'pengajuan');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-pengajuan-tbody tr');
    assert.strictEqual(baris.length, 0);
    assert.strictEqual($(win, 'admin-pengajuan-kosong').classList.contains('tersembunyi'), false);
  });

  await test_run('Pengajuan: Owner setujui TANPA prompt catatan → hilang dari antrean, tercatat di Absensi', async function () {
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-08-10', tanggal_selesai: '2026-08-11', alasan: 'Pulang kampung' });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'pengajuan');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-pengajuan-tbody tr');
    assert.strictEqual(baris.length, 1);
    assert.ok(baris[0].textContent.indexOf('Cuti') !== -1);
    assert.ok(baris[0].querySelector('.admin-btn-setujui'));
    // Kolom Sisa Kuota Cuti muncul (walau OKT001 blm 1 thn kerja jadi 0 hari)
    assert.ok(/hari/i.test(baris[0].cells[5].textContent));

    win.document.querySelector('.admin-btn-setujui').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(8);
    var barisSetelah = win.document.querySelectorAll('#admin-pengajuan-tbody tr');
    assert.strictEqual(barisSetelah.length, 0);

    var rowsPengajuan = backend.getSheetData('Pengajuan');
    assert.strictEqual(rowsPengajuan[1][9], 'DISETUJUI');
    var rowsAbsensi = backend.getSheetData('Absensi');
    assert.strictEqual(rowsAbsensi.length, 3); // header + 2 hari (10 & 11 Agustus)
  });

  await test_run('Pengajuan: Owner tolak TANPA prompt catatan → status DITOLAK, TIDAK ada baris Absensi baru', async function () {
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-05', tanggal_selesai: '2026-08-05', alasan: 'Demam' });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'pengajuan');
    await tick(8);
    win.document.querySelector('.admin-btn-tolak').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(8);
    var rowsPengajuan = backend.getSheetData('Pengajuan');
    assert.strictEqual(rowsPengajuan[1][9], 'DITOLAK');
    var rowsAbsensi = backend.getSheetData('Absensi');
    assert.strictEqual(rowsAbsensi.length, 1); // cuma header
  });

  await test_run('Pengajuan: HR (lihat saja) TIDAK punya tombol Setujui/Tolak', async function () {
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'IZIN', tanggal_mulai: '2026-08-06', tanggal_selesai: '2026-08-06', alasan: 'Acara keluarga' });
    var win = buatDevice();
    await loginAdmin(win, 'ADM003', '3333');
    pindahTabUji(win, 'pengajuan');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-pengajuan-tbody tr');
    assert.strictEqual(baris.length, 1);
    assert.strictEqual(baris[0].querySelector('.admin-btn-setujui'), null);
    assert.strictEqual($(win, 'admin-pengajuan-readonly-note').classList.contains('tersembunyi'), false);
  });

  await test_run('Ganti PIN Saya: PIN lama salah ditolak, PIN lama benar sukses & berlaku', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'pin');
    $(win, 'admin-pin-lama').value = '0000';
    $(win, 'admin-pin-baru').value = '5555';
    klik(win, 'admin-btn-ganti-pin');
    await tick(5);
    assert.ok($(win, 'admin-ganti-pin-pesan').textContent.length > 0);

    $(win, 'admin-pin-lama').value = '1111';
    $(win, 'admin-pin-baru').value = '5555';
    klik(win, 'admin-btn-ganti-pin');
    await tick(5);

    var res = backend.doPost({ action: 'adminLogin', id_admin: 'ADM001', pin: '5555' });
    assert.strictEqual(res.ok, true);
  });

  // ===================== TAB: KELOLA AKUN ADMIN =====================

  await test_run('Kelola Akun Admin (Owner): toggle izin_lihat_pengajuan checkbox tersimpan ke backend', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'akun');
    await tick(8);
    var cekLihatPengajuan = win.document.querySelector('.admin-cek-izin[data-id="ADM002"][data-izin="izin_lihat_pengajuan"]');
    assert.strictEqual(cekLihatPengajuan.checked, false);
    cekLihatPengajuan.checked = true;
    cekLihatPengajuan.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick(8);
    var daftar = backend.doGet({ action: 'getDaftarAdmin' });
    var tika = daftar.admin.filter(function (a) { return a.id_admin === 'ADM002'; })[0];
    assert.strictEqual(tika.izin_lihat_pengajuan, true);
  });

  await test_run('Kelola Akun Admin: role BEBAS TEKS — tambah akun dgn role custom "Supervisor" muncul di tabel', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'akun');
    await tick(8);
    $(win, 'admin-akun-nama-baru').value = 'Pak Joko';
    $(win, 'admin-akun-role-baru').value = 'Supervisor';
    klik(win, 'admin-btn-tambah-akun');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-akun-tbody tr');
    var namaSemua = Array.prototype.map.call(baris, function (tr) { return tr.textContent; }).join(' | ');
    assert.ok(namaSemua.indexOf('Pak Joko') !== -1);
    assert.ok(namaSemua.indexOf('SUPERVISOR') !== -1);
  });

  await test_run('Kelola Akun Admin: role kosong ditolak dgn pesan error, tidak terkirim ke backend', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'akun');
    await tick(8);
    $(win, 'admin-akun-nama-baru').value = 'Tanpa Role';
    $(win, 'admin-akun-role-baru').value = '';
    klik(win, 'admin-btn-tambah-akun');
    await tick(5);
    assert.ok($(win, 'admin-akun-pesan').textContent.length > 0);
    var daftar = backend.doGet({ action: 'getDaftarAdmin' });
    assert.strictEqual(daftar.admin.length, 3); // tidak nambah
  });

  // ===================== TAB: REKAP =====================

  await test_run('Rekap: tabel terisi Hari Kerja/Izin/Cuti sesuai data backend', async function () {
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
    var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-07-29', tanggal_selesai: '2026-07-29', alasan: 'Demam' });
    backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });

    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    $(win, 'admin-rekap-bulan').value = '2026-07';
    klik(win, 'admin-btn-muat-rekap');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-rekap-tbody tr');
    var rama = Array.prototype.filter.call(baris, function (tr) { return tr.textContent.indexOf('Test Rama') !== -1; })[0];
    assert.ok(rama);
    assert.strictEqual(rama.cells[1].textContent, 'DIVISI A'); // divisi
    assert.strictEqual(rama.cells[2].textContent, '1'); // hari_kerja
    assert.strictEqual(rama.cells[3].textContent, '0'); // terlambat (OKT001 tanpa jam_kerja)
    assert.strictEqual(rama.cells[4].textContent, '1'); // hari_izin
    assert.strictEqual(rama.cells[5].textContent, '0'); // hari_cuti
  });

  await test_run('Rekap: filter rentang tanggal custom (dari/sampai) mengesampingkan bulan', async function () {
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    $(win, 'admin-rekap-dari').value = '2026-07-30';
    $(win, 'admin-rekap-sampai').value = '2026-07-30';
    klik(win, 'admin-btn-muat-rekap');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-rekap-tbody tr');
    var rama = Array.prototype.filter.call(baris, function (tr) { return tr.textContent.indexOf('Test Rama') !== -1; })[0];
    assert.strictEqual(rama.cells[2].textContent, '1'); // hari_kerja
  });

  // ===================== TAB: KUOTA CUTI KARYAWAN (khusus Owner) =====================

  await test_run('Kuota Cuti: Owner lihat daftar karyawan aktif dgn kuota otomatis', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'kuota');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-kuota-tbody tr');
    assert.strictEqual(baris.length, 2); // OKT001 & OKT002
  });

  await test_run('Kuota Cuti: Owner simpan override → tersimpan ke backend & tabel ter-refresh', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'kuota');
    await tick(8);
    var input = win.document.querySelector('.admin-input-kuota[data-id="OKT001"]');
    input.value = '20';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    win.document.querySelector('.admin-btn-simpan-kuota[data-id="OKT001"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(8);
    var cek = backend.doGet({ action: 'getKuotaCutiSaya', id_karyawan: 'OKT001' });
    assert.strictEqual(cek.kuota, 20);
  });

  // ===================== DIVISI & TERLAMBAT =====================

  function teksBaris(tbodyId, win) {
    return Array.prototype.map.call(win.document.querySelectorAll('#' + tbodyId + ' tr'), function (tr) { return tr.textContent; });
  }
  function pilihDivisi(win, selectId, nilai) {
    var s = $(win, selectId);
    s.value = nilai;
    s.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  function opsi(win, selectId) {
    return Array.prototype.map.call($(win, selectId).options, function (o) { return o.value; });
  }

  await test_run('Rekap: kolom Terlambat menghitung absen Masuk terlambat (karyawan dgn jam_kerja)', async function () {
    backend.getSheetData('Karyawan')[1][7] = '08.00 - 16.00'; // OKT001, sekarang 09:00 WIB → terlambat
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    $(win, 'admin-rekap-bulan').value = '2026-07';
    klik(win, 'admin-btn-muat-rekap');
    await tick(8);
    var baris = win.document.querySelectorAll('#admin-rekap-tbody tr');
    var rama = Array.prototype.filter.call(baris, function (tr) { return tr.textContent.indexOf('Test Rama') !== -1; })[0];
    assert.strictEqual(rama.cells[2].textContent, '1'); // hari kerja
    assert.strictEqual(rama.cells[3].textContent, '1'); // terlambat
    var header = Array.prototype.map.call(win.document.querySelectorAll('#admin-rekap-tabel thead th'), function (th) { return th.textContent; });
    assert.deepStrictEqual(header.slice(0, 4), ['Nama', 'Divisi', 'Hari Kerja', 'Terlambat']);
  });

  await test_run('Rekap: pilihan Divisi terisi dari data karyawan, filter Divisi menyaring tabel', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    assert.deepStrictEqual(opsi(win, 'admin-rekap-divisi'), ['', 'DIVISI A', 'DIVISI B']);
    $(win, 'admin-rekap-bulan').value = '2026-07';
    pilihDivisi(win, 'admin-rekap-divisi', 'DIVISI B');
    klik(win, 'admin-btn-muat-rekap');
    await tick(8);
    var baris = teksBaris('admin-rekap-tbody', win);
    assert.strictEqual(baris.length, 1);
    assert.ok(baris[0].indexOf('Test Karyawan') !== -1);
  });

  await test_run('Rekap: dropdown Karyawan menyempit mengikuti Divisi terpilih', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    assert.deepStrictEqual(opsi(win, 'admin-rekap-karyawan'), ['', 'OKT002', 'OKT001'] /* urut nama: Test Karyawan, Test Rama */);
    pilihDivisi(win, 'admin-rekap-divisi', 'DIVISI A');
    assert.deepStrictEqual(opsi(win, 'admin-rekap-karyawan'), ['', 'OKT001']);
    // karyawan yang tadinya dipilih tapi beda divisi → kembali ke "Semua karyawan"
    $(win, 'admin-rekap-karyawan').value = 'OKT001';
    pilihDivisi(win, 'admin-rekap-divisi', 'DIVISI B');
    assert.strictEqual($(win, 'admin-rekap-karyawan').value, '');
    pilihDivisi(win, 'admin-rekap-divisi', '');
    assert.deepStrictEqual(opsi(win, 'admin-rekap-karyawan'), ['', 'OKT002', 'OKT001'] /* urut nama: Test Karyawan, Test Rama */);
  });

  await test_run('Rekap: export CSV memuat kolom Divisi & Terlambat', async function () {
    backend.getSheetData('Karyawan')[1][7] = '08.00 - 16.00';
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MASUK', lat: -7.32, lng: 110.19 });
    var win = buatDevice();
    var blobDiambil = null;
    win.URL.createObjectURL = function (b) { blobDiambil = b; return 'blob:tes'; };
    win.URL.revokeObjectURL = function () { };
    win.HTMLAnchorElement.prototype.click = function () { };
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'rekap');
    await tick(8);
    $(win, 'admin-rekap-bulan').value = '2026-07';
    klik(win, 'admin-btn-muat-rekap');
    await tick(8);
    klik(win, 'admin-btn-export-csv');
    assert.ok(blobDiambil, 'CSV harusnya dibuat');
    var isi = await new Promise(function (resolve) {
      var fr = new win.FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.readAsText(blobDiambil);
    });
    var baris = isi.split('\n');
    assert.strictEqual(baris[0], 'Nama,Divisi,Hari Kerja,Terlambat,Izin,Cuti,Menit Lembur Terverifikasi');
    var rama = baris.filter(function (b) { return b.indexOf('Test Rama') !== -1; })[0];
    assert.strictEqual(rama, '"Test Rama","DIVISI A","1","1","0","0","0"');
  });

  await test_run('Verifikasi Lembur: kolom Divisi + filter Divisi', async function () {
    ['OKT001', 'OKT002'].forEach(function (id) {
      backend.doPost({ action: 'absen', id_karyawan: id, tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
      backend.doPost({ action: 'absen', id_karyawan: id, tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
    });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    await tick(8);
    assert.strictEqual(teksBaris('admin-lembur-tbody', win).length, 2);
    var barisA = win.document.querySelector('#admin-lembur-tbody tr');
    assert.ok(/DIVISI [AB]/.test(barisA.cells[1].textContent));
    pilihDivisi(win, 'admin-filter-divisi-lembur', 'DIVISI A');
    var tampil = teksBaris('admin-lembur-tbody', win);
    assert.strictEqual(tampil.length, 1);
    assert.ok(tampil[0].indexOf('Test Rama') !== -1);
    assert.strictEqual($(win, 'admin-lembur-kosong').classList.contains('tersembunyi'), true);
    // hapus filter → semua sesi muncul lagi
    pilihDivisi(win, 'admin-filter-divisi-lembur', '');
    assert.strictEqual(teksBaris('admin-lembur-tbody', win).length, 2);
  });

  await test_run('Verifikasi Lembur: divisi yang ada tapi tanpa sesi → pesan kosong khusus divisi', async function () {
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'MULAI_LEMBUR', lat: -7.32, lng: 110.19 });
    backend.doPost({ action: 'absen', id_karyawan: 'OKT001', tipe_absen: 'SELESAI_LEMBUR', lat: -7.32, lng: 110.19 });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    await tick(8);
    pilihDivisi(win, 'admin-filter-divisi-lembur', 'DIVISI B');
    assert.strictEqual(teksBaris('admin-lembur-tbody', win).length, 0);
    assert.strictEqual($(win, 'admin-lembur-kosong').classList.contains('tersembunyi'), false);
    assert.ok($(win, 'admin-lembur-kosong').textContent.indexOf('divisi ini') !== -1);
  });

  await test_run('Pengajuan: kolom Divisi + filter Divisi (Owner masih bisa putuskan hasil filter)', async function () {
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-05', tanggal_selesai: '2026-08-05', alasan: 'Demam' });
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT002', tipe_izin: 'IZIN', tanggal_mulai: '2026-08-06', tanggal_selesai: '2026-08-06', alasan: 'Acara' });
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'pengajuan');
    await tick(8);
    assert.strictEqual(teksBaris('admin-pengajuan-tbody', win).length, 2);
    pilihDivisi(win, 'admin-filter-divisi-pengajuan', 'DIVISI B');
    var tampil = win.document.querySelectorAll('#admin-pengajuan-tbody tr');
    assert.strictEqual(tampil.length, 1);
    assert.strictEqual(tampil[0].cells[0].textContent, 'Test Karyawan');
    assert.strictEqual(tampil[0].cells[1].textContent, 'DIVISI B');
    assert.ok(tampil[0].querySelector('.admin-btn-setujui'));
    tampil[0].querySelector('.admin-btn-setujui').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(8);
    assert.strictEqual(backend.getSheetData('Pengajuan')[2][9], 'DISETUJUI');
    assert.strictEqual(backend.getSheetData('Pengajuan')[1][9], 'PENDING'); // divisi A tidak tersentuh
  });

  await test_run('Kuota Cuti: kolom Divisi + filter Divisi', async function () {
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'kuota');
    await tick(8);
    assert.strictEqual(teksBaris('admin-kuota-tbody', win).length, 2);
    pilihDivisi(win, 'admin-filter-divisi-kuota', 'DIVISI A');
    var tampil = win.document.querySelectorAll('#admin-kuota-tbody tr');
    assert.strictEqual(tampil.length, 1);
    assert.strictEqual(tampil[0].cells[0].textContent, 'Test Rama');
    assert.strictEqual(tampil[0].cells[1].textContent, 'DIVISI A');
  });

  await test_run('Divisi kosong di Sheet tampil "—" dan tidak masuk daftar pilihan filter', async function () {
    backend.getSheetData('Karyawan')[2][6] = ''; // OKT002 tanpa divisi
    var win = buatDevice();
    await loginAdmin(win, 'ADM001', '1111');
    pindahTabUji(win, 'kuota');
    await tick(8);
    assert.deepStrictEqual(opsi(win, 'admin-filter-divisi-kuota'), ['', 'DIVISI A']);
    var baris = win.document.querySelectorAll('#admin-kuota-tbody tr');
    var tk = Array.prototype.filter.call(baris, function (tr) { return tr.cells[0].textContent === 'Test Karyawan'; })[0];
    assert.strictEqual(tk.cells[1].textContent, '—');
  });
  console.log('');
  console.log(total - gagal + '/' + total + ' test e2e admin PASS');
  if (gagal > 0) process.exit(1);
})();
