/**
 * e2e test app karyawan (index.html + js/app.js) pakai jsdom, fetch di-mock
 * langsung ke mockBackend.js (bukan Apps Script sungguhan).
 * Jalankan: node tests/e2e-karyawan.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var { JSDOM } = require('jsdom');
var backend = require('./mockBackend');

var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var CONFIG_JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
var APP_JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

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
        var result = backend.doGet(params);
        resolve({ json: function () { return Promise.resolve(result); } });
      } else {
        var body = JSON.parse(opts.body);
        var result2 = backend.doPost(body);
        resolve({ json: function () { return Promise.resolve(result2); } });
      }
    });
  };
}

// Bikin window+DOM baru & jalankan app.js di dalamnya — dipakai "device" baru
// tiap kali dipanggil (localStorage terpisah kalau tidak dioper manual).
function buatDevice(localStorageAwal, geoSukses) {
  var dom = new JSDOM(HTML, { url: 'https://absensi-omahkebon.test/', pretendToBeVisual: true, runScripts: 'outside-only' });
  var win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: localStorageAwal || makeLocalStorage(), configurable: true });
  win.fetch = makeFetchMock();
  win.navigator.geolocation = {
    getCurrentPosition: function (sukses, gagalFn) {
      if (geoSukses === false) {
        gagalFn({ code: 1, PERMISSION_DENIED: 1 });
      } else {
        sukses({ coords: { latitude: -7.3234422729931525, longitude: 110.19331425092193 } });
      }
    }
  };
  win.eval(CONFIG_JS);
  win.eval(APP_JS);
  return win;
}

function tunggu(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Semua alur app.js berbasis Promise (fetch) — beri jeda kecil supaya
// microtask chain (then/then/then) sempat selesai sebelum assert dijalankan.
function tick(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 5); i++) p = p.then(function () { return tunggu(0); });
  return p;
}

function $(win, id) { return win.document.getElementById(id); }

function klik(win, id) {
  $(win, id).dispatchEvent(new win.Event('click', { bubbles: true }));
}

// pinLengkap() di app.js dijadwalkan lewat setTimeout(fn, 150) asli (bukan 0)
// supaya dot terakhir sempat kelihatan terisi — tick() berbasis setTimeout(0)
// TIDAK akan menyusul timer 150ms itu, jadi wajib nunggu waktu asli di sini.
async function setupKaryawanBaru(win, idKaryawan, pin) {
  await tick(8); // tunggu getKaryawan awal + render dropdown
  var select = $(win, 'pilih-nama');
  select.value = idKaryawan;
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  klik(win, 'btn-lanjut-nama');
  // ketik PIN 2x (buat + konfirmasi)
  ketikPin(win, pin);
  await tunggu(250);
  ketikPin(win, pin);
  await tunggu(250);
  await tick(8);
}

function ketikPin(win, pin) {
  pin.split('').forEach(function (digit) {
    var btn = win.document.querySelector('.btn-angka[data-angka="' + digit + '"]');
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  });
}

async function tekanTombolAbsen(win, tipeId) {
  klik(win, tipeId);
  await tick(3);
  klik(win, 'btn-konfirmasi-ya');
  await tick(10);
}

// ===================== TEST =====================

(async function () {
  await test_run('App load: dropdown terisi 2 karyawan aktif', async function () {
    var win = buatDevice();
    await tick(8);
    var select = $(win, 'pilih-nama');
    assert.strictEqual(select.options.length, 3); // placeholder + 2 karyawan
    assert.strictEqual($(win, 'layar-setup').classList.contains('aktif'), true);
  });

  await test_run('Setup PIN baru lalu masuk ke layar absen, tombol MASUK aktif & lainnya sesuai default', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    assert.strictEqual($(win, 'layar-absen').classList.contains('aktif'), true);
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, false);
    assert.strictEqual($(win, 'btn-absen-pulang').disabled, true);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, true);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, false);
    assert.strictEqual($(win, 'btn-absen-cuti').disabled, false);
  });

  await test_run('PIN tidak sama saat konfirmasi → error, kembali ke langkah buat PIN', async function () {
    var win = buatDevice();
    await tick(8);
    $(win, 'pilih-nama').value = 'OKT001';
    klik(win, 'btn-lanjut-nama');
    ketikPin(win, '1111');
    await tunggu(250);
    ketikPin(win, '2222');
    await tunggu(250);
    assert.ok(/tidak sama/i.test($(win, 'pin-error').textContent));
  });

  await test_run('Absen MASUK end-to-end: layar sukses tampil, lalu tombol PULANG aktif', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-masuk');
    assert.strictEqual($(win, 'layar-sukses').classList.contains('aktif'), true);
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Absen Masuk Berhasil');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, true); // sudah selesai, terkunci
    assert.strictEqual($(win, 'btn-absen-masuk').classList.contains('selesai'), true);
    assert.strictEqual($(win, 'btn-absen-pulang').disabled, false);
  });

  await test_run('MASUK lalu PULANG: kedua tombol terkunci selesai', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-masuk');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    await tekanTombolAbsen(win, 'btn-absen-pulang');
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Absen Pulang Berhasil');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, true);
    assert.strictEqual($(win, 'btn-absen-pulang').disabled, true);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, false); // lembur tetap boleh
  });

  await test_run('Lembur end-to-end: Mulai lalu Selesai, dan Cuti/Off ikut terkunci selama sesi lembur berjalan', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-mulai-lembur');
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Mulai Lembur Tercatat');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, true);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, false);
    assert.strictEqual($(win, 'btn-absen-cuti').disabled, true);
    assert.strictEqual($(win, 'btn-absen-off').disabled, true);

    await tekanTombolAbsen(win, 'btn-absen-selesai-lembur');
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Selesai Lembur Tercatat');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, true);
  });

  await test_run('CUTI mengunci Masuk/Pulang/Lembur, dan tidak minta lokasi GPS', async function () {
    var win = buatDevice(null, false); // geolocation SENGAJA gagal — CUTI tidak boleh memanggilnya
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-cuti');
    assert.strictEqual($(win, 'layar-sukses').classList.contains('aktif'), true);
    assert.strictEqual($(win, 'lokasi-sukses').classList.contains('tersembunyi'), true);
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, true);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, true);
    assert.strictEqual($(win, 'btn-absen-off').disabled, true);
  });

  await test_run('Lokasi GPS ditolak saat MASUK → pesan error, tombol kembali aktif (tidak dobel-kunci)', async function () {
    var win = buatDevice(null, false);
    await setupKaryawanBaru(win, 'OKT001', '1234');
    klik(win, 'btn-absen-masuk');
    await tick(3);
    klik(win, 'btn-konfirmasi-ya');
    await tick(5);
    assert.ok(/izin lokasi ditolak/i.test($(win, 'status-absen').textContent));
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, false);
  });

  await test_run('Sesi tersimpan di device divalidasi ulang: PIN direset admin → dipaksa setup ulang', async function () {
    var ls = makeLocalStorage();
    var win1 = buatDevice(ls);
    await setupKaryawanBaru(win1, 'OKT001', '1234');
    assert.strictEqual($(win1, 'layar-absen').classList.contains('aktif'), true);

    // Admin reset PIN langsung di "Sheet" (mock)
    var rows = backend.getSheetData('Karyawan');
    rows[1][2] = ''; // kosongkan pin_hash OKT001

    // Buka device BARU dgn localStorage yg sama (mensimulasikan reload app)
    var win2 = buatDevice(ls);
    await tick(8);
    assert.strictEqual($(win2, 'layar-setup').classList.contains('aktif'), true);
  });

  await test_run('2 karyawan beda device: status absen tidak saling bocor', async function () {
    var winA = buatDevice();
    await setupKaryawanBaru(winA, 'OKT001', '1234');
    await tekanTombolAbsen(winA, 'btn-absen-masuk');
    klik(winA, 'btn-sukses-ok');
    await tick(3);

    var winB = buatDevice();
    await setupKaryawanBaru(winB, 'OKT002', '5678');
    assert.strictEqual($(winB, 'btn-absen-masuk').disabled, false); // OKT002 belum absen apa2
    assert.strictEqual($(winB, 'btn-absen-masuk').classList.contains('selesai'), false);
  });

  await test_run('Kalender: hari dengan Masuk+Pulang berwarna hadir-pulang (menang atas Masuk)', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-masuk');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    await tekanTombolAbsen(win, 'btn-absen-pulang');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    klik(win, 'nav-riwayat');
    await tick(8);
    var selHariIni = win.document.querySelector('.sel-tanggal.hari-ini');
    assert.ok(selHariIni.classList.contains('hadir-pulang'));
  });

  await test_run('Kalender: hari yang cuma ada Lembur (tanpa Masuk/Pulang) berwarna hadir-selesai_lembur', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-mulai-lembur');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    await tekanTombolAbsen(win, 'btn-absen-selesai-lembur');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    klik(win, 'nav-riwayat');
    await tick(8);
    var selHariIni = win.document.querySelector('.sel-tanggal.hari-ini');
    assert.ok(selHariIni.classList.contains('hadir-selesai_lembur'));
  });

  console.log('');
  console.log(total - gagal + '/' + total + ' test e2e karyawan PASS');
  if (gagal > 0) process.exit(1);
})();

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
