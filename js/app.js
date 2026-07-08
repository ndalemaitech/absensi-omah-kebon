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
  var riwayatCache = {}; // { 'YYYY-MM': [records] } — supaya kalender tampil instan, tanpa nunggu network
  var statusHariIni = { masuk: null, pulang: null, cuti: null, off: null }; // waktu (string) atau null
  var tipeAbsenAktif = 'MASUK'; // tipe yang terakhir ditekan, dikunci saat konfirmasi/kirim berlangsung

  // ---- Peta terpusat 4 tipe absen. Kalau nanti nambah tipe baru, cukup
  // tambah entri di sini + elemen tombolnya di index.html + variabel warna
  // di css/style.css — logika di bawah sudah generik, tidak hardcode 2 tipe. ----
  var ID_TOMBOL = { MASUK: 'btn-absen-masuk', PULANG: 'btn-absen-pulang', CUTI: 'btn-absen-cuti', OFF: 'btn-absen-off' };
  var KUNCI_STATUS = { MASUK: 'masuk', PULANG: 'pulang', CUTI: 'cuti', OFF: 'off' };
  var BUTUH_LOKASI = { MASUK: true, PULANG: true, CUTI: false, OFF: false };
  var JUDUL_KONFIRMASI = {
    MASUK: 'Absen masuk sekarang?',
    PULANG: 'Absen pulang sekarang?',
    CUTI: 'Ajukan cuti hari ini?',
    OFF: 'Tandai off hari ini?'
  };
  var JUDUL_SUKSES = {
    MASUK: 'Absen Masuk Berhasil',
    PULANG: 'Absen Pulang Berhasil',
    CUTI: 'Cuti Tercatat',
    OFF: 'Off Tercatat'
  };

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
    params._ = Date.now(); // cache-buster: data harus selalu segar (mis. setelah admin reset PIN)
    var query = Object.keys(params)
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      })
      .join('&');
    return fetch(API_URL + '?' + query, { cache: 'no-store' }).then(function (res) {
      return res.json();
    });
  }

  // POST pakai Content-Type text/plain supaya tidak memicu CORS preflight
  // (Apps Script Web App tidak melayani request OPTIONS)
  function apiPost(body) {
    return fetch(API_URL, {
      method: 'POST',
      cache: 'no-store',
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
      validasiSesi(sesi);
    } else {
      mulaiSetup();
    }
  }

  // Sesi tersimpan di HP TIDAK otomatis dipercaya — selalu dicek ulang ke
  // server tiap app dibuka. Ini membuat satu aksi admin di Sheet (kosongkan
  // pin_hash ATAU ubah status jadi Nonaktif) langsung berlaku di device
  // manapun yang sedang login, tanpa perlu device itu online terus-menerus
  // atau ada mekanisme "paksa logout" terpisah.
  function validasiSesi(sesi) {
    tampilkanLayar('layar-loading');
    apiGet({ action: 'getKaryawan' })
      .then(function (data) {
        if (!data.ok) {
          // gagal ambil data (bukan berarti sesi tidak valid) — tetap izinkan
          // pakai sesi lama supaya app tetap bisa dipakai saat koneksi jelek
          bukaLayarAbsen(sesi);
          return;
        }
        daftarKaryawan = data.karyawan;
        var k = daftarKaryawan.find(function (x) {
          return x.id_karyawan === sesi.id_karyawan;
        });
        if (!k || k.perlu_pin_baru) {
          // admin sudah kosongkan pin_hash, atau karyawan dinonaktifkan →
          // sesi lama dianggap tidak berlaku lagi, paksa setup ulang
          localStorage.removeItem(KUNCI_SESI);
          mulaiSetupDenganDaftarSiap();
        } else {
          bukaLayarAbsen(sesi);
        }
      })
      .catch(function () {
        // offline saat buka app — tetap izinkan pakai sesi lama, jangan
        // kunci karyawan keluar hanya karena tidak ada internet sesaat
        bukaLayarAbsen(sesi);
      });
  }

  // Sama seperti mulaiSetup(), tapi tidak fetch ulang getKaryawan karena
  // datanya sudah didapat dari validasiSesi()
  function mulaiSetupDenganDaftarSiap() {
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

  // Gambar ulang KEEMPAT tombol sesuai statusHariIni. Aturan saling-silang
  // ini sengaja dicerminkan dari validasi di backend (Code.gs handleAbsen)
  // supaya karyawan tidak perlu menekan tombol dulu baru tahu ditolak —
  // tombol yang memang akan ditolak server langsung tampil nonaktif/abu-abu:
  //  - MASUK/PULANG (kelompok "hadir") dan CUTI/OFF (kelompok "tidak hadir")
  //    saling eksklusif per hari.
  //  - PULANG baru bisa ditekan setelah MASUK tercatat.
  //  - CUTI dan OFF juga saling eksklusif satu sama lain.
  //  - Tipe yang sudah tercatat hari ini ditandai selesai (centang) & dikunci.
  function perbaruiTombolAbsen() {
    var s = statusHariIni;
    var kelompokHadirAktif = !!(s.masuk || s.pulang);
    var kelompokTidakHadirAktif = !!(s.cuti || s.off);

    aturTombol('MASUK', !!s.masuk, !!s.masuk || kelompokTidakHadirAktif);
    aturTombol('PULANG', !!s.pulang, !!s.pulang || !s.masuk || kelompokTidakHadirAktif);
    aturTombol('CUTI', !!s.cuti, !!s.cuti || !!s.off || kelompokHadirAktif);
    aturTombol('OFF', !!s.off, !!s.off || !!s.cuti || kelompokHadirAktif);

    var ringkasan = [];
    if (s.masuk) ringkasan.push('Masuk ' + jamPendek(s.masuk));
    if (s.pulang) ringkasan.push('Pulang ' + jamPendek(s.pulang));
    if (s.cuti) ringkasan.push('Cuti tercatat jam ' + jamPendek(s.cuti));
    if (s.off) ringkasan.push('Off tercatat jam ' + jamPendek(s.off));
    $('status-absen').textContent = ringkasan.join(' · ');
  }

  function aturTombol(tipe, selesai, disabled) {
    var btn = $(ID_TOMBOL[tipe]);
    btn.disabled = disabled;
    btn.classList.toggle('selesai', selesai);
  }

  function cekAbsenHariIni(sesi) {
    var hariIni = new Date();
    var tglIni = tanggalISO(hariIni);
    var bulan = tglIni.substring(0, 7);
    statusHariIni = { masuk: null, pulang: null, cuti: null, off: null };
    apiGet({ action: 'riwayat', id_karyawan: sesi.id_karyawan, bulan: bulan })
      .then(function (data) {
        if (!data.ok) return;
        data.records.forEach(function (r) {
          if (r.tanggal !== tglIni) return;
          if (r.tipe_absen === 'MASUK') statusHariIni.masuk = r.waktu;
          if (r.tipe_absen === 'PULANG') statusHariIni.pulang = r.waktu;
          if (r.tipe_absen === 'CUTI') statusHariIni.cuti = r.waktu;
          if (r.tipe_absen === 'OFF') statusHariIni.off = r.waktu;
        });
        perbaruiTombolAbsen();
      })
      .catch(function () {
        // gagal cek bukan masalah fatal — backend tetap menolak absen ganda,
        // tombol tetap tampil kondisi default sampai berhasil sinkron
      });
  }

  // ---- konfirmasi sebelum absen dikirim ----

  var intervalJamKonfirmasi = null;

  function bukaKonfirmasi() {
    var tipe = tipeAbsenAktif;
    $('judul-konfirmasi').textContent = JUDUL_KONFIRMASI[tipe];
    $('kartu-konfirmasi').className = 'kartu-konfirmasi kartu-konfirmasi-' + tipe.toLowerCase();
    var perbaruiJam = function () {
      var now = new Date();
      $('jam-konfirmasi').textContent =
        pad2(now.getHours()) + '.' + pad2(now.getMinutes()) + '.' + pad2(now.getSeconds());
    };
    perbaruiJam();
    intervalJamKonfirmasi = setInterval(perbaruiJam, 1000);
    $('modal-konfirmasi').classList.remove('tersembunyi');
  }

  function tutupKonfirmasi() {
    clearInterval(intervalJamKonfirmasi);
    $('modal-konfirmasi').classList.add('tersembunyi');
  }

  // Satu listener klik per tombol tipe absen — masing-masing menyimpan
  // tipenya sendiri ke tipeAbsenAktif lalu membuka modal konfirmasi yang sama.
  Object.keys(ID_TOMBOL).forEach(function (tipe) {
    $(ID_TOMBOL[tipe]).addEventListener('click', function () {
      if (this.disabled) return;
      var sesi = getSesi();
      if (!sesi) return mulaiSetup();

      if (BUTUH_LOKASI[tipe] && !navigator.geolocation) {
        $('status-absen').textContent = 'HP ini tidak mendukung GPS.';
        return;
      }
      tipeAbsenAktif = tipe;
      bukaKonfirmasi();
    });
  });

  $('btn-konfirmasi-batal').addEventListener('click', tutupKonfirmasi);

  $('btn-konfirmasi-ya').addEventListener('click', function () {
    tutupKonfirmasi();
    var sesi = getSesi();
    if (!sesi) return mulaiSetup();

    var tipe = tipeAbsenAktif;
    $(ID_TOMBOL[tipe]).disabled = true; // cegah dobel-tap selama proses berjalan

    if (!BUTUH_LOKASI[tipe]) {
      // CUTI/OFF tidak butuh lokasi — langsung kirim tanpa minta GPS.
      tampilkanOverlay('Mengirim...');
      kirimAbsen(sesi, '', '');
      return;
    }

    tampilkanOverlay('Mencari lokasi...');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        kirimAbsen(sesi, pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        sembunyikanOverlay();
        perbaruiTombolAbsen(); // kembalikan status tombol sesuai kondisi asli
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
    var tipe = tipeAbsenAktif; // dikunci di awal request, tidak berubah di tengah jalan
    tampilkanOverlay('Mengirim absen...');
    apiPost({
      action: 'absen',
      id_karyawan: sesi.id_karyawan,
      lat: lat,
      lng: lng,
      tipe_absen: tipe
    })
      .then(function (data) {
        sembunyikanOverlay();
        if (!data.ok) {
          perbaruiTombolAbsen(); // kembalikan tombol ke kondisi sesuai statusHariIni asli
          $('status-absen').textContent = data.error || 'Gagal. Coba lagi.';
          return;
        }

        statusHariIni[KUNCI_STATUS[tipe]] = data.waktu;

        if (data.sudah_absen) {
          // sudah tercatat sebelumnya — cukup refresh tombol, tanpa layar sukses
          perbaruiTombolAbsen();
          return;
        }

        // Simpan langsung ke cache kalender bulan ini — supaya begitu user
        // pindah ke Riwayat, tanggal hari ini SUDAH berwarna tanpa nunggu fetch
        simpanKeCacheRiwayat(sesi.id_karyawan, {
          tanggal: data.tanggal,
          waktu: data.waktu,
          tipe_absen: tipe,
          status_lokasi: data.status_lokasi
        });

        $('judul-sukses').textContent = JUDUL_SUKSES[tipe];
        $('tanggal-sukses').textContent = formatTanggalIndonesia(new Date());
        $('jam-sukses').textContent = jamPendek(data.waktu);
        // Info lokasi hanya relevan untuk MASUK/PULANG (CUTI/OFF tidak merekam GPS)
        $('lokasi-sukses').classList.toggle('tersembunyi', !BUTUH_LOKASI[tipe]);
        $('layar-sukses').className = 'layar layar-sukses layar-sukses-' + tipe.toLowerCase();
        tampilkanLayar('layar-sukses');
      })
      .catch(function () {
        sembunyikanOverlay();
        perbaruiTombolAbsen();
        $('status-absen').textContent = pesanKoneksi();
      });
  }

  $('btn-sukses-ok').addEventListener('click', function () {
    perbaruiTombolAbsen(); // tombol sekarang mencerminkan status terbaru (mis. siap absen pulang)
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

    // Tampilkan dari cache DULU (instan, tanpa nunggu network) kalau ada —
    // ini yang menghilangkan jeda ~3 detik saat pindah dari layar Absen ke
    // Riwayat. Data server tetap diambil di belakang layar untuk sinkronisasi
    // (misal ada absen dari device lain, atau input manual admin di Sheet).
    if (riwayatCache[bulanParam]) {
      tandaiHadirDiGrid(riwayatCache[bulanParam]);
    }

    apiGet({ action: 'riwayat', id_karyawan: sesi.id_karyawan, bulan: bulanParam })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error);
        riwayatCache[bulanParam] = data.records;
        // Bulan yang ditampilkan bisa saja sudah berganti selagi fetch
        // berjalan (user keburu pencet panah bulan) — jangan timpa grid
        // yang salah.
        var bulanSekarangDitampilkan =
          bulanKalender.getFullYear() + '-' + pad2(bulanKalender.getMonth() + 1);
        if (bulanParam === bulanSekarangDitampilkan) {
          tandaiHadirDiGrid(data.records);
        }
      })
      .catch(function () {
        // Kalau sudah ada data dari cache, kegagalan network tidak perlu
        // ditampilkan sebagai error — kalender tetap kelihatan benar.
        if (!riwayatCache[bulanParam]) {
          $('riwayat-error').textContent = pesanKoneksi();
        }
      });
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Urutan prioritas warna kalau satu hari punya lebih dari satu record.
  // CUTI/OFF tak pernah bercampur dengan MASUK/PULANG di hari yang sama
  // (dijamin saling eksklusif oleh backend) — satu-satunya kombinasi nyata
  // adalah MASUK+PULANG di hari yang sama, dan PULANG "menang" karena
  // artinya hari itu sudah lengkap/selesai.
  var PRIORITAS_TIPE = ['CUTI', 'OFF', 'PULANG', 'MASUK'];
  var KELAS_HADIR_SEMUA = ['hadir-masuk', 'hadir-pulang', 'hadir-cuti', 'hadir-off'];

  // Tandai tanggal di grid kalender dengan warna sesuai tipe absen dominan
  // hari itu — dipakai baik oleh cache lokal maupun data segar dari server,
  // supaya keduanya konsisten.
  function tandaiHadirDiGrid(records) {
    var grid = $('kalender-grid');
    var perTanggal = {};
    records.forEach(function (r) {
      if (!perTanggal[r.tanggal]) perTanggal[r.tanggal] = {};
      perTanggal[r.tanggal][r.tipe_absen] = true;
    });
    Object.keys(perTanggal).forEach(function (tgl) {
      var sel = grid.querySelector('[data-tanggal="' + tgl + '"]');
      if (!sel) return;
      var tipeDominan = PRIORITAS_TIPE.filter(function (t) {
        return perTanggal[tgl][t];
      })[0];
      if (!tipeDominan) return;
      sel.classList.remove.apply(sel.classList, KELAS_HADIR_SEMUA);
      sel.classList.add('hadir-' + tipeDominan.toLowerCase());
    });
  }

  function simpanKeCacheRiwayat(idKaryawan, record) {
    var bulan = record.tanggal.substring(0, 7);
    var arr = riwayatCache[bulan] || [];
    var sudahAda = arr.some(function (r) {
      return r.tanggal === record.tanggal && r.tipe_absen === record.tipe_absen;
    });
    if (!sudahAda) arr.push(record);
    riwayatCache[bulan] = arr;
    // Kalau kalender bulan ini sedang tampil di layar, langsung tandai juga
    if ($('layar-riwayat').classList.contains('aktif') && bulan === tanggalISO(bulanKalender).substring(0, 7)) {
      tandaiHadirDiGrid([record]);
    }
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
