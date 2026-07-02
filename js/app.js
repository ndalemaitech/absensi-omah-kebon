/* Absensi Omah Kebon — logika aplikasi (vanilla JS, tanpa framework) */

(function () {
  'use strict';

  var KUNCI_SESI = 'absensi_omahkebon_sesi';

  // ============ STATE ============
  var daftarKaryawan = [];
  var karyawanTerpilih = null; // saat proses setup
  var pinBuffer = '';
  var pinPertama = ''; // untuk konfirmasi saat buat PIN baru
  var modeBuatPin = false;
  var bulanKalender = new Date(); // bulan yang sedang ditampilkan

  // ============ ELEMEN ============
  var $ = function (id) {
    return document.getElementById(id);
  };

  var layarSemua = document.querySelectorAll('.layar');

  // ============ UTIL ============

  function tampilkanLayar(idLayar) {
    layarSemua.forEach(function (el) {
      el.classList.toggle('aktif', el.id === idLayar);
    });
    var pakaiNav = idLayar === 'layar-absen' || idLayar === 'layar-riwayat';
    $('nav-bawah').classList.toggle('tersembunyi', !pakaiNav);
  }

  function tampilkanOverlay(teks) {
    $('overlay-teks').textContent = teks;
    $('overlay-proses').classList.remove('tersembunyi');
  }

  function sembunyikanOverlay() {
    $('overlay-proses').classList.add('tersembunyi');
  }

  function getSesi() {
    try {
      return JSON.parse(localStorage.getItem(KUNCI_SESI));
    } catch (e) {
      return null;
    }
  }

  function simpanSesi(sesi) {
    localStorage.setItem(KUNCI_SESI, JSON.stringify(sesi));
  }

  function apiGet(params) {
    var query = Object.keys(params)
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      })
      .join('&');
    return fetch(API_URL + '?' + query).then(function (res) {
      return res.json();
    });
  }

  // POST pakai Content-Type text/plain supaya tidak memicu CORS preflight
  // (Apps Script Web App tidak melayani request OPTIONS)
  function apiPost(body) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json();
    });
  }

  function pesanKoneksi() {
    return 'Tidak bisa terhubung. Cek internet lalu coba lagi.';
  }

  var NAMA_BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  var NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  function formatTanggalIndonesia(d) {
    return NAMA_HARI[d.getDay()] + ', ' + d.getDate() + ' ' + NAMA_BULAN[d.getMonth()] + ' ' + d.getFullYear();
  }

  function tanggalISO(d) {
    var m = d.getMonth() + 1;
    var t = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (t < 10 ? '0' : '') + t;
  }

  function jamPendek(waktu) {
    // "07:14:03" → "07.14" (format jam Indonesia pakai titik)
    return String(waktu).substring(0, 5).replace(':', '.');
  }

  // ============ ALUR MULAI ============

  function mulai() {
    if (typeof API_URL === 'undefined' || API_URL.indexOf('PASTE_URL') !== -1) {
      $('layar-loading').querySelector('.teks-sedang').textContent =
        'Aplikasi belum dikonfigurasi. (Developer: isi API_URL di js/config.js)';
      return;
    }
    var sesi = getSesi();
    if (sesi && sesi.id_karyawan) {
      bukaLayarAbsen(sesi);
    } else {
      mulaiSetup();
    }
  }

  // ============ LAYAR SETUP ============

  function mulaiSetup() {
    tampilkanLayar('layar-loading');
    apiGet({ action: 'getKaryawan' })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error);
        daftarKaryawan = data.karyawan;
        var select = $('pilih-nama');
        select.innerHTML = '<option value="">-- Pilih nama --</option>';
        daftarKaryawan.forEach(function (k) {
          var opt = document.createElement('option');
          opt.value = k.id_karyawan;
          opt.textContent = k.nama;
          select.appendChild(opt);
        });
        $('setup-pilih-nama').classList.remove('tersembunyi');
        $('setup-pin').classList.add('tersembunyi');
        tampilkanLayar('layar-setup');
      })
      .catch(function () {
        $('layar-loading').querySelector('.teks-sedang').textContent = pesanKoneksi();
        // coba ulang otomatis tiap 5 detik
        setTimeout(mulaiSetup, 5000);
      });
  }

  $('pilih-nama').addEventListener('change', function () {
    $('btn-lanjut-nama').disabled = !this.value;
  });

  $('btn-lanjut-nama').addEventListener('click', function () {
    var id = $('pilih-nama').value;
    karyawanTerpilih = daftarKaryawan.find(function (k) {
      return k.id_karyawan === id;
    });
    if (!karyawanTerpilih) return;

    modeBuatPin = karyawanTerpilih.perlu_pin_baru;
    pinBuffer = '';
    pinPertama = '';
    $('pin-nama-terpilih').textContent = karyawanTerpilih.nama;
    $('pin-instruksi').textContent = modeBuatPin ? 'Buat PIN baru (4 angka)' : 'Masukkan PIN Anda';
    $('pin-error').textContent = '';
    perbaruiDots();
    $('setup-pilih-nama').classList.add('tersembunyi');
    $('setup-pin').classList.remove('tersembunyi');
  });

  // ---- keypad PIN ----

  function perbaruiDots() {
    var dots = document.querySelectorAll('#pin-dots .dot');
    dots.forEach(function (dot, i) {
      dot.classList.toggle('terisi', i < pinBuffer.length);
    });
  }

  $('keypad').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.id === 'btn-pin-kembali') {
      // balik ke pilihan nama
      pinBuffer = '';
      pinPertama = '';
      $('setup-pin').classList.add('tersembunyi');
      $('setup-pilih-nama').classList.remove('tersembunyi');
      return;
    }
    if (btn.id === 'btn-pin-hapus') {
      pinBuffer = pinBuffer.slice(0, -1);
      $('pin-error').textContent = '';
      perbaruiDots();
      return;
    }
    var angka = btn.getAttribute('data-angka');
    if (angka === null || pinBuffer.length >= 4) return;
    pinBuffer += angka;
    perbaruiDots();
    if (pinBuffer.length === 4) {
      setTimeout(pinLengkap, 150); // beri waktu dot terakhir terlihat terisi
    }
  });

  function pinLengkap() {
    if (modeBuatPin && !pinPertama) {
      // langkah konfirmasi: minta ketik ulang
      pinPertama = pinBuffer;
      pinBuffer = '';
      $('pin-instruksi').textContent = 'Ketik ulang PIN yang sama';
      perbaruiDots();
      return;
    }
    if (modeBuatPin && pinBuffer !== pinPertama) {
      pinPertama = '';
      pinBuffer = '';
      $('pin-instruksi').textContent = 'Buat PIN baru (4 angka)';
      $('pin-error').textContent = 'PIN tidak sama. Ulangi dari awal.';
      perbaruiDots();
      return;
    }
    kirimLogin(pinBuffer);
  }

  function kirimLogin(pin) {
    tampilkanOverlay('Sebentar ya...');
    apiPost({
      action: 'login',
      id_karyawan: karyawanTerpilih.id_karyawan,
      pin: pin
    })
      .then(function (data) {
        sembunyikanOverlay();
        if (!data.ok) {
          pinBuffer = '';
          pinPertama = '';
          if (modeBuatPin) $('pin-instruksi').textContent = 'Buat PIN baru (4 angka)';
          $('pin-error').textContent = data.error || 'Gagal. Coba lagi.';
          perbaruiDots();
          return;
        }
        var sesi = { id_karyawan: data.id_karyawan, nama: data.nama };
        simpanSesi(sesi);
        bukaLayarAbsen(sesi);
      })
      .catch(function () {
        sembunyikanOverlay();
        pinBuffer = '';
        perbaruiDots();
        $('pin-error').textContent = pesanKoneksi();
      });
  }

  // ============ LAYAR ABSEN ============

  function bukaLayarAbsen(sesi) {
    $('nama-karyawan').textContent = sesi.nama;
    $('tanggal-hari-ini').textContent = formatTanggalIndonesia(new Date());
    setNavAktif('nav-absen');
    tampilkanLayar('layar-absen');
    cekAbsenHariIni(sesi);
  }

  function setTombolAbsen(sudahAbsen, jam) {
    var btn = $('btn-absen');
    if (sudahAbsen) {
      btn.disabled = true;
      $('btn-absen-teks').innerHTML = 'SUDAH<br />ABSEN';
      $('status-absen').textContent = 'Anda sudah absen jam ' + jamPendek(jam);
    } else {
      btn.disabled = false;
      $('btn-absen-teks').innerHTML = 'ABSEN<br />MASUK';
      $('status-absen').textContent = '';
    }
  }

  function cekAbsenHariIni(sesi) {
    var hariIni = new Date();
    var bulan = tanggalISO(hariIni).substring(0, 7);
    apiGet({ action: 'riwayat', id_karyawan: sesi.id_karyawan, bulan: bulan })
      .then(function (data) {
        if (!data.ok) return;
        var tglIni = tanggalISO(hariIni);
        var recHariIni = data.records.find(function (r) {
          return r.tanggal === tglIni && r.tipe_absen === 'MASUK';
        });
        if (recHariIni) {
          setTombolAbsen(true, recHariIni.waktu);
        }
      })
      .catch(function () {
        // gagal cek bukan masalah fatal — backend tetap menolak absen ganda
      });
  }

  $('btn-absen').addEventListener('click', function () {
    var sesi = getSesi();
    if (!sesi) return mulaiSetup();

    if (!navigator.geolocation) {
      $('status-absen').textContent = 'HP ini tidak mendukung GPS.';
      return;
    }

    $('btn-absen').disabled = true;
    tampilkanOverlay('Mencari lokasi...');

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        kirimAbsen(sesi, pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        sembunyikanOverlay();
        $('btn-absen').disabled = false;
        if (err.code === err.PERMISSION_DENIED) {
          $('status-absen').textContent =
            'Izin lokasi ditolak. Nyalakan izin lokasi untuk aplikasi ini, lalu coba lagi.';
        } else {
          $('status-absen').textContent = 'Lokasi tidak ditemukan. Coba lagi di tempat terbuka.';
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  });

  function kirimAbsen(sesi, lat, lng) {
    tampilkanOverlay('Mengirim absen...');
    apiPost({
      action: 'absen',
      id_karyawan: sesi.id_karyawan,
      lat: lat,
      lng: lng,
      tipe_absen: 'MASUK'
    })
      .then(function (data) {
        sembunyikanOverlay();
        if (!data.ok) {
          $('btn-absen').disabled = false;
          $('status-absen').textContent = data.error || 'Gagal. Coba lagi.';
          return;
        }
        setTombolAbsen(true, data.waktu);
        if (data.sudah_absen) {
          // sudah tercatat sebelumnya — cukup tampilkan status, tanpa layar sukses
          return;
        }
        $('jam-sukses').textContent = jamPendek(data.waktu);
        tampilkanLayar('layar-sukses');
      })
      .catch(function () {
        sembunyikanOverlay();
        $('btn-absen').disabled = false;
        $('status-absen').textContent = pesanKoneksi();
      });
  }

  $('btn-sukses-ok').addEventListener('click', function () {
    tampilkanLayar('layar-absen');
    $('nav-bawah').classList.remove('tersembunyi');
  });

  // ============ LAYAR KALENDER / RIWAYAT ============

  function bukaRiwayat() {
    setNavAktif('nav-riwayat');
    tampilkanLayar('layar-riwayat');
    renderKalender();
  }

  function renderKalender() {
    var sesi = getSesi();
    if (!sesi) return;

    var tahun = bulanKalender.getFullYear();
    var bulanIdx = bulanKalender.getMonth();
    $('label-bulan').textContent = NAMA_BULAN[bulanIdx] + ' ' + tahun;
    $('riwayat-error').textContent = '';

    // gambar grid dulu (tanpa data), lalu tandai hijau setelah data datang
    var grid = $('kalender-grid');
    grid.innerHTML = '';
    var hariPertama = new Date(tahun, bulanIdx, 1);
    var jumlahHari = new Date(tahun, bulanIdx + 1, 0).getDate();
    // geser supaya minggu mulai Senin (getDay(): 0=Minggu)
    var offset = (hariPertama.getDay() + 6) % 7;

    for (var i = 0; i < offset; i++) {
      var kosong = document.createElement('div');
      kosong.className = 'sel-tanggal kosong';
      grid.appendChild(kosong);
    }
    var tglHariIni = tanggalISO(new Date());
    for (var t = 1; t <= jumlahHari; t++) {
      var sel = document.createElement('div');
      sel.className = 'sel-tanggal';
      sel.textContent = t;
      var iso = tahun + '-' + pad2(bulanIdx + 1) + '-' + pad2(t);
      sel.setAttribute('data-tanggal', iso);
      if (iso === tglHariIni) sel.classList.add('hari-ini');
      grid.appendChild(sel);
    }

    var bulanParam = tahun + '-' + pad2(bulanIdx + 1);
    apiGet({ action: 'riwayat', id_karyawan: sesi.id_karyawan, bulan: bulanParam })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error);
        data.records.forEach(function (r) {
          var sel = grid.querySelector('[data-tanggal="' + r.tanggal + '"]');
          if (sel) sel.classList.add('hadir');
        });
      })
      .catch(function () {
        $('riwayat-error').textContent = pesanKoneksi();
      });
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  $('btn-bulan-prev').addEventListener('click', function () {
    bulanKalender = new Date(bulanKalender.getFullYear(), bulanKalender.getMonth() - 1, 1);
    renderKalender();
  });

  $('btn-bulan-next').addEventListener('click', function () {
    bulanKalender = new Date(bulanKalender.getFullYear(), bulanKalender.getMonth() + 1, 1);
    renderKalender();
  });

  // ============ NAV BAWAH ============

  function setNavAktif(idNav) {
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('aktif', el.id === idNav);
    });
  }

  $('nav-absen').addEventListener('click', function () {
    var sesi = getSesi();
    if (sesi) bukaLayarAbsen(sesi);
  });

  $('nav-riwayat').addEventListener('click', function () {
    bulanKalender = new Date();
    bukaRiwayat();
  });

  // ============ SERVICE WORKER ============

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // gagal daftar SW tidak menghalangi pemakaian app
      });
    });
  }

  mulai();
})();
