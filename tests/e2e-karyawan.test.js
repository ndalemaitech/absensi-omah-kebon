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

function setInputValue(win, id, value) {
  var el = $(win, id);
  var setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
  var setterArea = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
  if (el.tagName === 'TEXTAREA') setterArea.call(el, value); else setter.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

async function ajukanIzin(win, tipe, mulai, selesai, alasan) {
  klik(win, 'btn-buka-ajukan-izin');
  await tick(3);
  win.document.querySelector('.chip-tipe-izin[data-tipe="' + tipe + '"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  setInputValue(win, 'izin-tanggal-mulai', mulai);
  setInputValue(win, 'izin-tanggal-selesai', selesai);
  setInputValue(win, 'izin-alasan', alasan);
  klik(win, 'btn-kirim-izin');
  await tick(8);
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

  await test_run('Setup PIN baru lalu masuk ke layar absen, 4 tombol Hadir/Lembur sesuai default', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    assert.strictEqual($(win, 'layar-absen').classList.contains('aktif'), true);
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, false);
    assert.strictEqual($(win, 'btn-absen-pulang').disabled, true);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, true);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, false);
    assert.strictEqual($(win, 'btn-buka-ajukan-izin'), $(win, 'btn-buka-ajukan-izin')); // tombol Ajukan Izin ada
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

  await test_run('MASUK lalu PULANG: kedua tombol terkunci selesai, Lembur tetap boleh', async function () {
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
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, false);
  });

  await test_run('Lembur end-to-end: Mulai lalu Selesai tercatat berurutan', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await tekanTombolAbsen(win, 'btn-absen-mulai-lembur');
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Mulai Lembur Tercatat');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, true);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, false);

    await tekanTombolAbsen(win, 'btn-absen-selesai-lembur');
    assert.strictEqual($(win, 'judul-sukses').textContent, 'Selesai Lembur Tercatat');
    klik(win, 'btn-sukses-ok');
    await tick(3);
    assert.strictEqual($(win, 'btn-absen-selesai-lembur').disabled, true);
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

    var rows = backend.getSheetData('Karyawan');
    rows[1][2] = ''; // kosongkan pin_hash OKT001

    var win2 = buatDevice(ls);
    await tick(8);
    assert.strictEqual($(win2, 'layar-setup').classList.contains('aktif'), true);
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

  // ===================== AJUKAN IZIN (fitur baru 2026-07-30) =====================

  await test_run('Ajukan Izin: submit CUTI sukses → masuk ke Pengajuan Saya berstatus Menunggu', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    await ajukanIzin(win, 'CUTI', '2026-08-10', '2026-08-12', 'Pulang kampung');
    assert.strictEqual($(win, 'layar-pengajuan-saya').classList.contains('aktif'), true);
    assert.ok(/berhasil dikirim/i.test($(win, 'pengajuan-pesan').textContent));
    var kartu = win.document.querySelectorAll('.kartu-pengajuan');
    assert.strictEqual(kartu.length, 1);
    assert.ok(kartu[0].textContent.indexOf('Cuti') !== -1);
    assert.ok(kartu[0].textContent.indexOf('Menunggu') !== -1);
  });

  await test_run('Ajukan Izin: alasan kosong ditolak di frontend sebelum kirim ke server', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    klik(win, 'btn-buka-ajukan-izin');
    await tick(3);
    win.document.querySelector('.chip-tipe-izin[data-tipe="SAKIT"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    setInputValue(win, 'izin-tanggal-mulai', '2026-08-10');
    klik(win, 'btn-kirim-izin');
    await tick(3);
    assert.ok(/alasan/i.test($(win, 'izin-error').textContent));
    assert.strictEqual($(win, 'layar-ajukan-izin').classList.contains('aktif'), true); // belum pindah layar
  });

  await test_run('Ajukan Izin: pilih tanggal mulai otomatis mengisi tanggal selesai kalau masih kosong', async function () {
    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    klik(win, 'btn-buka-ajukan-izin');
    await tick(3);
    setInputValue(win, 'izin-tanggal-mulai', '2026-08-15');
    assert.strictEqual($(win, 'izin-tanggal-selesai').value, '2026-08-15');
  });

  await test_run('Nav Pengajuan menampilkan riwayat pengajuan (termasuk yg sudah diputuskan)', async function () {
    backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'SAKIT', tanggal_mulai: '2026-08-05', tanggal_selesai: '2026-08-05', alasan: 'Demam' });
    var rows = backend.getSheetData('Pengajuan');
    var idPengajuan = rows[1][0];
    backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: idPengajuan, keputusan: 'DITOLAK', catatan_admin: 'Kurang bukti' });

    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    klik(win, 'nav-pengajuan');
    await tick(8);
    var kartu = win.document.querySelectorAll('.kartu-pengajuan');
    assert.strictEqual(kartu.length, 1);
    assert.ok(kartu[0].textContent.indexOf('Ditolak') !== -1);
    assert.ok(kartu[0].textContent.indexOf('Kurang bukti') !== -1);
  });

  await test_run('Integrasi: Cuti hari ini yg sudah DISETUJUI mengunci semua tombol Hadir/Lembur & tampil di status', async function () {
    var buat = backend.doPost({ action: 'ajukanIzin', id_karyawan: 'OKT001', tipe_izin: 'CUTI', tanggal_mulai: '2026-07-30', tanggal_selesai: '2026-07-30', alasan: 'Acara keluarga' });
    backend.doPost({ action: 'putuskanPengajuan', actor_id_admin: 'ADM001', id_pengajuan: buat.id_pengajuan, keputusan: 'DISETUJUI' });

    var win = buatDevice();
    await setupKaryawanBaru(win, 'OKT001', '1234');
    assert.strictEqual($(win, 'btn-absen-masuk').disabled, true);
    assert.strictEqual($(win, 'btn-absen-mulai-lembur').disabled, true);
    assert.ok(/cuti hari ini/i.test($(win, 'status-absen').textContent));
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
