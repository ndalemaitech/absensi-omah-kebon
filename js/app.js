/* Absensi Omah Kebon — logika aplikasi (vanilla JS, tanpa framework) */

(function () {
  'use strict';

  var KUNCI_SESI = 'absensi_omahkebon_sesi';
  // Cache status absen hari ini per device — dipakai utk render layar Absen
  // SEKETIKA saat app dibuka (Phase 0: perceived-loading), tanpa nunggu
  // round-trip ke Apps Script. Data server tetap diambil di belakang layar
  // (lihat cekAbsenHariIni) utk sinkronisasi & koreksi diam-diam kalau beda.
  var KUNCI_CACHE_STATUS = 'absensi_omahkebon_cache_status';

  // ============ STATE ============
  var daftarKaryawan = [];
  var karyawanTerpilih = null; // saat proses setup
  var pinBuffer = '';
  var pinPertama = ''; // untuk konfirmasi saat buat PIN baru
  var modeBuatPin = false;
  var bulanKalender = new Date(); // bulan yang sedang ditampilkan
  var riwayatCache = {}; // { 'YYYY-MM': [records] } — supaya kalender tampil instan, tanpa nunggu network
  // waktu (string) atau null per tipe absen hari ini. tidak_hadir menyimpan
  // TIPE (CUTI/SAKIT/IZIN) kalau hari ini ada izin yang disetujui.
  var statusHariIni = { masuk: null, pulang: null, mulai_lembur: null, selesai_lembur: null, tidak_hadir: null };
  var tipeAbsenAktif = 'MASUK'; // tipe yang terakhir ditekan, dikunci saat konfirmasi/kirim berlangsung

  // ---- Peta terpusat 4 tipe absen tap-langsung (Hadir + Lembur). Cuti/Sakit/
  // Izin SEJAK 2026-07-30 tidak lagi di sini — sekarang lewat form "Ajukan
  // Izin" (lihat bagian PENGAJUAN IZIN di bawah), butuh approval Owner
  // sebelum tercatat resmi. Kalau nanti nambah tipe hadir/lembur baru, cukup
  // tambah entri di sini + elemen tombolnya di index.html + variabel warna
  // di css/style.css. ----
  var ID_TOMBOL = {
    MASUK: 'btn-absen-masuk',
    PULANG: 'btn-absen-pulang',
    MULAI_LEMBUR: 'btn-absen-mulai-lembur',
    SELESAI_LEMBUR: 'btn-absen-selesai-lembur'
  };
  var KUNCI_STATUS = {
    MASUK: 'masuk', PULANG: 'pulang', MULAI_LEMBUR: 'mulai_lembur', SELESAI_LEMBUR: 'selesai_lembur'
  };
  var JUDUL_KONFIRMASI = {
    MASUK: 'Absen masuk sekarang?',
    PULANG: 'Absen pulang sekarang?',
    MULAI_LEMBUR: 'Mulai lembur sekarang?',
    SELESAI_LEMBUR: 'Selesai lembur sekarang?'
  };
  var JUDUL_SUKSES = {
    MASUK: 'Absen Masuk Berhasil',
    PULANG: 'Absen Pulang Berhasil',
    MULAI_LEMBUR: 'Mulai Lembur Tercatat',
    SELESAI_LEMBUR: 'Selesai Lembur Tercatat'
  };

  // Tipe izin (Pengajuan) — dipetakan warna/label sendiri, terpisah dari 4
  // tipe absen tap-langsung di atas. Tipe OFF sudah dihapus (2026-08-07) —
  // cukup terwakili lewat IZIN.
  var LABEL_IZIN_TAMPIL = { CUTI: 'Cuti', SAKIT: 'Sakit', IZIN: 'Izin' };
  var LABEL_STATUS_TAMPIL = { PENDING: 'Menunggu', DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak' };

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
    var pakaiNav = idLayar === 'layar-absen' || idLayar === 'layar-riwayat' || idLayar === 'layar-pengajuan-saya';
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

  function getCacheStatus() {
    try {
      return JSON.parse(localStorage.getItem(KUNCI_CACHE_STATUS));
    } catch (e) {
      return null;
    }
  }

  function simpanCacheStatus(idKaryawan, tanggal, status) {
    try {
      localStorage.setItem(KUNCI_CACHE_STATUS, JSON.stringify({ id_karyawan: idKaryawan, tanggal: tanggal, status: status }));
    } catch (e) {
      // localStorage penuh/diblokir — bukan masalah fatal, cuma kehilangan cache
    }
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
  //
  // Phase 0 (perceived-loading, 2026-08-07): kalau ada sesi tersimpan DAN ada
  // cache status hari ini yang masih berlaku (tanggal cache === hari ini,
  // id_karyawan cocok), layar Absen langsung digambar dari cache TANPA layar
  // loading — device sudah pernah buka app hari ini jadi hampir pasti masih
  // valid. validasiSesi() tetap jalan di belakang layar utk konfirmasi ke
  // server & koreksi diam-diam kalau ternyata beda (mis. admin baru saja
  // reset PIN atau nonaktifkan). Kalau tidak ada cache yang cocok (device
  // baru / lewat tengah malam), tetap tampilkan layar loading seperti biasa.

  function mulai() {
    if (typeof API_URL === 'undefined' || API_URL.indexOf('PASTE_URL') !== -1) {
      $('layar-loading').querySelector('.teks-sedang').textContent =
        'Aplikasi belum dikonfigurasi. (Developer: isi API_URL di js/config.js)';
      return;
    }
    var sesi = getSesi();
    if (sesi && sesi.id_karyawan) {
      var cache = getCacheStatus();
      var tglIni = tanggalISO(new Date());
      if (cache && cache.id_karyawan === sesi.id_karyawan && cache.tanggal === tglIni) {
        statusHariIni = cache.status;
        $('nama-karyawan').textContent = sesi.nama;
        $('tanggal-hari-ini').textContent = formatTanggalIndonesia(new Date());
        setNavAktif('nav-absen');
        tampilkanLayar('layar-absen');
        perbaruiTombolAbsen();
      }
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
    var sudahTampilOptimis = $('layar-absen').classList.contains('aktif');
    if (!sudahTampilOptimis) tampilkanLayar('layar-loading');
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
          localStorage.removeItem(KUNCI_CACHE_STATUS);
          mulaiSetupDenganDaftarSiap();
        } else {
          bukaLayarAbsen(sesi);
        }
      })
      .catch(function () {
        // offline saat buka app — tetap izinkan pakai sesi lama, jangan
        // kunci karyawan keluar hanya karena tidak ada internet sesaat
        if (!sudahTampilOptimis) bukaLayarAbsen(sesi);
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

  // Gambar ulang KEEMPAT tombol Hadir/Lembur sesuai statusHariIni. Aturan ini
  // dicerminkan dari validasi di backend (Code.gs handleAbsen) supaya
  // karyawan tidak perlu menekan tombol dulu baru tahu ditolak:
  //  - PULANG baru bisa ditekan setelah MASUK tercatat.
  //  - SELESAI LEMBUR baru bisa ditekan setelah MULAI LEMBUR tercatat.
  //  - Lembur TIDAK diblokir oleh Masuk/Pulang (boleh terjadi di hari yg sama).
  //  - Kalau hari ini ada izin (Cuti/Sakit/Izin) yang SUDAH DISETUJUI
  //    (statusHariIni.tidak_hadir terisi), keempat tombol ini dikunci — sama
  //    seperti guard di backend tulisAbsenTidakHadir/handleAbsen.
  //  - Tipe yang sudah tercatat hari ini ditandai selesai (centang) & dikunci.
  function perbaruiTombolAbsen() {
    var s = statusHariIni;
    var izinAktif = !!s.tidak_hadir;

    aturTombol('MASUK', !!s.masuk, !!s.masuk || izinAktif);
    aturTombol('PULANG', !!s.pulang, !!s.pulang || !s.masuk || izinAktif);
    aturTombol('MULAI_LEMBUR', !!s.mulai_lembur, !!s.mulai_lembur || izinAktif);
    aturTombol('SELESAI_LEMBUR', !!s.selesai_lembur, !!s.selesai_lembur || !s.mulai_lembur || izinAktif);

    var ringkasan = [];
    if (s.masuk) ringkasan.push('Masuk ' + jamPendek(s.masuk));
    if (s.pulang) ringkasan.push('Pulang ' + jamPendek(s.pulang));
    if (s.mulai_lembur) ringkasan.push('Mulai Lembur ' + jamPendek(s.mulai_lembur));
    if (s.selesai_lembur) ringkasan.push('Selesai Lembur ' + jamPendek(s.selesai_lembur));
    if (s.tidak_hadir) ringkasan.push((LABEL_IZIN_TAMPIL[s.tidak_hadir] || s.tidak_hadir) + ' hari ini (disetujui)');
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
    statusHariIni = { masuk: null, pulang: null, mulai_lembur: null, selesai_lembur: null, tidak_hadir: null };
    apiGet({ action: 'riwayat', id_karyawan: sesi.id_karyawan, bulan: bulan })
      .then(function (data) {
        if (!data.ok) return;
        data.records.forEach(function (r) {
          if (r.tanggal !== tglIni) return;
          if (r.tipe_absen === 'MASUK') statusHariIni.masuk = r.waktu;
          if (r.tipe_absen === 'PULANG') statusHariIni.pulang = r.waktu;
          if (r.tipe_absen === 'MULAI_LEMBUR') statusHariIni.mulai_lembur = r.waktu;
          if (r.tipe_absen === 'SELESAI_LEMBUR') statusHariIni.selesai_lembur = r.waktu;
          if (LABEL_IZIN_TAMPIL[r.tipe_absen]) statusHariIni.tidak_hadir = r.tipe_absen;
        });
        perbaruiTombolAbsen();
        simpanCacheStatus(sesi.id_karyawan, tglIni, statusHariIni);
      })
      .catch(function () {
        // gagal cek bukan masalah fatal — backend tetap menolak absen ganda,
        // tombol tetap tampil kondisi default sampai berhasil sinkron
      });
  }

  $('btn-refresh-absen').addEventListener('click', function () {
    var sesi = getSesi();
    if (!sesi) return;
    this.classList.add('berputar');
    var btn = this;
    cekAbsenHariIni(sesi);
    setTimeout(function () { btn.classList.remove('berputar'); }, 500);
  });

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
  // Keempat tipe di sini SEMUA butuh lokasi GPS (beda dgn versi lama yang
  // punya tipe tanpa-lokasi Cuti/Sakit/Izin — sekarang itu di layar Ajukan Izin).
  Object.keys(ID_TOMBOL).forEach(function (tipe) {
    $(ID_TOMBOL[tipe]).addEventListener('click', function () {
      if (this.disabled) return;
      var sesi = getSesi();
      if (!sesi) return mulaiSetup();

      if (!navigator.geolocation) {
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
        simpanCacheStatus(sesi.id_karyawan, data.tanggal, statusHariIni);

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
        $('lokasi-sukses').classList.remove('tersembunyi'); // 4 tipe di sini semua butuh lokasi
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

  // ============ LAYAR AJUKAN IZIN ============

  var tipeIzinTerpilih = null;
  var fotoIzinBase64 = null;
  var fotoIzinMime = 'image/jpeg';

  $('btn-buka-ajukan-izin').addEventListener('click', function () {
    var sesi = getSesi();
    if (!sesi) return mulaiSetup();
    resetFormIzin();
    tampilkanLayar('layar-ajukan-izin');
    $('nav-bawah').classList.add('tersembunyi');
  });

  // Tombol back di header (panah) dan tombol Batal di bawah form melakukan
  // hal yang sama persis — cukup satu fungsi dipakai berdua.
  function kembaliDariAjukanIzin() {
    var sesi = getSesi();
    if (sesi) bukaLayarAbsen(sesi);
  }
  $('btn-batal-izin').addEventListener('click', kembaliDariAjukanIzin);
  $('btn-kembali-izin').addEventListener('click', kembaliDariAjukanIzin);

  // Jenis izin sekarang dropdown (bukan chip tombol) — lebih ringkas &
  // gampang nambah tipe baru nanti tanpa desain ulang grid.
  $('izin-tipe').addEventListener('change', function () {
    tipeIzinTerpilih = this.value || null;
    if (tipeIzinTerpilih === 'CUTI') {
      tampilkanInfoKuotaCuti();
    } else {
      $('izin-kuota-info').classList.add('tersembunyi');
    }
  });

  // Tampilkan sisa kuota cuti karyawan ini saat tipe Cuti dipilih — supaya
  // karyawan tahu jatahnya SEBELUM kirim pengajuan, bukan baru tahu setelah
  // ditolak Owner.
  function tampilkanInfoKuotaCuti() {
    var sesi = getSesi();
    if (!sesi) return;
    var info = $('izin-kuota-info');
    info.textContent = 'Mengecek sisa kuota cuti...';
    info.classList.remove('tersembunyi');
    apiGet({ action: 'getKuotaCutiSaya', id_karyawan: sesi.id_karyawan })
      .then(function (data) {
        if (tipeIzinTerpilih !== 'CUTI') return; // user sudah ganti pilihan sebelum respons datang
        if (!data.ok) {
          info.classList.add('tersembunyi');
          return;
        }
        info.textContent = 'Sisa kuota cuti Anda tahun ini: ' + data.sisa + ' dari ' + data.kuota + ' hari.';
      })
      .catch(function () {
        info.classList.add('tersembunyi');
      });
  }

  // Kalau tanggal selesai belum diisi (atau lebih awal dari tanggal mulai
  // baru), otomatis samakan dgn tanggal mulai — cukup untuk kasus izin
  // sehari, user tinggal ubah manual kalau memang beberapa hari.
  $('izin-tanggal-mulai').addEventListener('change', function () {
    var selesai = $('izin-tanggal-selesai');
    if (!selesai.value || selesai.value < this.value) selesai.value = this.value;
  });

  $('btn-pilih-foto').addEventListener('click', function () {
    $('input-foto-izin').click();
  });

  // Input foto TIDAK lagi punya atribut capture="environment" (lihat
  // index.html) — supaya browser menawarkan pilihan "Kamera" ATAU "Galeri",
  // bukan langsung buka kamera. Logika resize di bawah sama saja utk kedua
  // sumber (file dari galeri diproses persis seperti foto kamera).
  $('input-foto-izin').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    resizeGambar(file, 1000)
      .then(function (hasil) {
        fotoIzinBase64 = hasil.base64;
        fotoIzinMime = hasil.mime;
        $('preview-foto-izin').src = 'data:' + hasil.mime + ';base64,' + hasil.base64;
        $('preview-foto-izin').classList.remove('tersembunyi');
        $('btn-hapus-foto').classList.remove('tersembunyi');
      })
      .catch(function () {
        $('izin-error').textContent = 'Gagal memproses foto. Coba lagi atau lewati saja.';
      });
  });

  $('btn-hapus-foto').addEventListener('click', function () {
    fotoIzinBase64 = null;
    $('input-foto-izin').value = '';
    $('preview-foto-izin').classList.add('tersembunyi');
    $('btn-hapus-foto').classList.add('tersembunyi');
  });

  // Resize gambar di browser sebelum dikirim (maks ~1000px sisi terpanjang,
  // kualitas JPEG 0.7) — supaya upload cepat & hemat storage Drive, tanpa
  // perlu library eksternal.
  function resizeGambar(file, maxDim) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
            else { w = Math.round((w * maxDim) / h); h = maxDim; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function resetFormIzin() {
    tipeIzinTerpilih = null;
    fotoIzinBase64 = null;
    $('izin-tipe').value = '';
    $('izin-kuota-info').classList.add('tersembunyi');
    $('izin-tanggal-mulai').value = '';
    $('izin-tanggal-selesai').value = '';
    $('izin-alasan').value = '';
    $('input-foto-izin').value = '';
    $('preview-foto-izin').classList.add('tersembunyi');
    $('btn-hapus-foto').classList.add('tersembunyi');
    $('izin-error').textContent = '';
  }

  $('btn-kirim-izin').addEventListener('click', function () {
    var sesi = getSesi();
    if (!sesi) return mulaiSetup();
    $('izin-error').textContent = '';

    if (!tipeIzinTerpilih) {
      $('izin-error').textContent = 'Pilih jenis izin dulu.';
      return;
    }
    var mulaiTgl = $('izin-tanggal-mulai').value;
    var selesaiTgl = $('izin-tanggal-selesai').value;
    if (!mulaiTgl || !selesaiTgl) {
      $('izin-error').textContent = 'Tanggal mulai dan selesai wajib diisi.';
      return;
    }
    if (selesaiTgl < mulaiTgl) {
      $('izin-error').textContent = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
      return;
    }
    // Validasi maks 2 hari utk Cuti di sisi frontend juga — supaya karyawan
    // tahu SEBELUM kirim, bukan baru tahu setelah ditolak backend.
    if (tipeIzinTerpilih === 'CUTI') {
      var jumlahHari = Math.round((new Date(selesaiTgl) - new Date(mulaiTgl)) / 86400000) + 1;
      if (jumlahHari > 2) {
        $('izin-error').textContent = 'Cuti maksimal 2 hari per pengajuan.';
        return;
      }
    }
    var alasan = $('izin-alasan').value.trim();
    if (!alasan) {
      $('izin-error').textContent = 'Alasan wajib diisi.';
      return;
    }

    var body = {
      action: 'ajukanIzin',
      id_karyawan: sesi.id_karyawan,
      tipe_izin: tipeIzinTerpilih,
      tanggal_mulai: mulaiTgl,
      tanggal_selesai: selesaiTgl,
      alasan: alasan
    };
    if (fotoIzinBase64) {
      body.lampiran_base64 = fotoIzinBase64;
      body.lampiran_mime = fotoIzinMime;
      body.lampiran_nama = sesi.id_karyawan + '-' + mulaiTgl;
    }

    tampilkanOverlay('Mengirim pengajuan...');
    apiPost(body)
      .then(function (data) {
        sembunyikanOverlay();
        if (!data.ok) {
          $('izin-error').textContent = data.error || 'Gagal mengirim. Coba lagi.';
          return;
        }
        bukaPengajuanSaya(true);
      })
      .catch(function () {
        sembunyikanOverlay();
        $('izin-error').textContent = pesanKoneksi();
      });
  });

  // ============ LAYAR PENGAJUAN SAYA ============

  function bukaPengajuanSaya(pesanSukses) {
    setNavAktif('nav-pengajuan');
    tampilkanLayar('layar-pengajuan-saya');
    $('nav-bawah').classList.remove('tersembunyi');
    $('pengajuan-pesan').textContent = pesanSukses ? 'Pengajuan berhasil dikirim. Menunggu persetujuan.' : '';
    muatPengajuanSaya();
  }

  function muatPengajuanSaya() {
    var sesi = getSesi();
    if (!sesi) return;
    apiGet({ action: 'getPengajuanSaya', id_karyawan: sesi.id_karyawan })
      .then(function (data) {
        var wadah = $('daftar-pengajuan-saya');
        wadah.innerHTML = '';
        if (!data.ok) return;
        $('pengajuan-kosong').classList.toggle('tersembunyi', data.pengajuan.length > 0);
        data.pengajuan.forEach(function (p) {
          var kartu = document.createElement('div');
          kartu.className = 'kartu-pengajuan status-' + p.status.toLowerCase();
          var rentang = p.tanggal_mulai === p.tanggal_selesai
            ? p.tanggal_mulai
            : p.tanggal_mulai + ' s/d ' + p.tanggal_selesai;
          kartu.innerHTML =
            '<div class="kartu-pengajuan-atas">' +
              '<span class="label-tipe-izin">' + escapeHtml(LABEL_IZIN_TAMPIL[p.tipe_izin] || p.tipe_izin) + '</span>' +
              '<span class="badge-status badge-' + p.status.toLowerCase() + '">' + escapeHtml(LABEL_STATUS_TAMPIL[p.status] || p.status) + '</span>' +
            '</div>' +
            '<p class="kartu-pengajuan-tanggal">' + escapeHtml(rentang) + ' (' + p.jumlah_hari + ' hari)</p>' +
            '<p class="kartu-pengajuan-alasan">' + escapeHtml(p.alasan) + '</p>';
          wadah.appendChild(kartu);
        });
      });
  }

  $('nav-pengajuan').addEventListener('click', function () {
    bukaPengajuanSaya(false);
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
  // Izin (Cuti/Sakit/Izin — semuanya dari Pengajuan yang disetujui) tak
  // pernah bercampur dengan MASUK/PULANG/LEMBUR di hari yang sama (dijamin
  // saling eksklusif oleh backend). MASUK+PULANG di hari yang sama tetap
  // mungkin (PULANG "menang" karena artinya hari itu lengkap). Lembur
  // ditaruh PALING BAWAH prioritas — cuma jadi warna dominan kalau hari itu
  // TIDAK ada Masuk/Pulang sama sekali.
  var PRIORITAS_TIPE = ['CUTI', 'SAKIT', 'IZIN', 'PULANG', 'MASUK', 'SELESAI_LEMBUR', 'MULAI_LEMBUR'];
  var KELAS_HADIR_SEMUA = ['hadir-masuk', 'hadir-pulang', 'hadir-mulai_lembur', 'hadir-selesai_lembur', 'hadir-cuti', 'hadir-sakit', 'hadir-izin'];

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
