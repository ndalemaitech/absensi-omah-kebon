/* Dashboard Admin — Absensi Omah Kebon (vanilla JS, tanpa framework) */

(function () {
  'use strict';

  var KUNCI_SESI_ADMIN = 'absensi_omahkebon_admin_sesi';
  // Cache profil admin — dipakai utk gambar dashboard (nama, role, tab yg
  // kelihatan) SEKETIKA saat app dibuka, sebelum validasiSesi() ke server
  // selesai (Phase 0: perceived-loading, sama filosofi dgn js/app.js).
  var KUNCI_CACHE_PROFIL = 'absensi_omahkebon_admin_cache_profil';

  // ============ STATE ============
  var daftarAdmin = [];
  var daftarKaryawanAktif = [];
  var adminTerpilih = null; // saat proses login, sebelum PIN dikirim
  var sesiAdmin = null; // profil lengkap admin yang sedang login
  var tabAktifSekarang = 'lembur';

  var LABEL_ROLE = { OWNER: 'Owner', HR: 'HR', REKAP: 'Rekap' };
  var LABEL_IZIN_TAMPIL = { CUTI: 'Cuti', SAKIT: 'Sakit', IZIN: 'Izin' };

  // ============ ELEMEN ============
  var $ = function (id) { return document.getElementById(id); };

  // ============ UTIL API (sama pola dgn js/app.js) ============

  function apiGet(params) {
    params._ = Date.now();
    var query = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return fetch(API_URL + '?' + query, { cache: 'no-store' }).then(function (res) { return res.json(); });
  }

  function apiPost(body) {
    return fetch(API_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  function pesanKoneksi() { return 'Tidak bisa terhubung. Cek internet lalu coba lagi.'; }

  function getSesi() {
    try { return JSON.parse(localStorage.getItem(KUNCI_SESI_ADMIN)); } catch (e) { return null; }
  }
  function simpanSesi(s) { localStorage.setItem(KUNCI_SESI_ADMIN, JSON.stringify(s)); }
  function hapusSesi() { localStorage.removeItem(KUNCI_SESI_ADMIN); }

  function getCacheProfil() {
    try { return JSON.parse(localStorage.getItem(KUNCI_CACHE_PROFIL)); } catch (e) { return null; }
  }
  function simpanCacheProfil(profil) {
    try { localStorage.setItem(KUNCI_CACHE_PROFIL, JSON.stringify(profil)); } catch (e) { /* abaikan */ }
  }

  function tampilkanAdminLayar(id) {
    document.querySelectorAll('.admin-layar').forEach(function (el) {
      el.classList.toggle('admin-layar-aktif', el.id === id);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ============ ALUR MULAI ============
  //
  // Phase 0 (perceived-loading, 2026-08-07): kalau ada sesi + cache profil
  // tersimpan dari sesi TERAKHIR admin ini, dashboard langsung digambar dari
  // cache (nama, role, visibilitas tab) tanpa nunggu getDaftarAdmin selesai.
  // validasiSesi() tetap jalan di belakang layar utk konfirmasi & koreksi
  // diam-diam kalau izin/status admin ini berubah sejak sesi terakhir.

  function mulai() {
    if (typeof API_URL === 'undefined' || API_URL.indexOf('PASTE_URL') !== -1) {
      alert('Aplikasi belum dikonfigurasi. (Developer: isi API_URL di js/config.js)');
      return;
    }
    var sesi = getSesi();
    if (sesi && sesi.id_admin) {
      var cache = getCacheProfil();
      if (cache && cache.id_admin === sesi.id_admin) {
        bukaDashboard(cache, true);
      }
      validasiSesi(sesi);
    } else {
      muatDaftarUntukLogin();
    }
  }

  // Sesi TIDAK otomatis dipercaya — selalu dicek ulang ke server (sama
  // filosofi dgn validasiSesi karyawan). Kalau Owner reset PIN atau ubah
  // izin/status admin ini, sesi lama otomatis mengikuti perubahan terbaru.
  function validasiSesi(sesi) {
    var sudahTampilOptimis = $('admin-layar-dashboard').classList.contains('admin-layar-aktif');
    apiGet({ action: 'getDaftarAdmin' })
      .then(function (data) {
        if (!data.ok) { if (!sudahTampilOptimis) bukaDashboard(sesi, false); return; }
        daftarAdmin = data.admin;
        var a = daftarAdmin.filter(function (x) { return x.id_admin === sesi.id_admin; })[0];
        if (!a || a.perlu_pin_baru || a.status.toLowerCase() !== 'aktif') {
          hapusSesi();
          localStorage.removeItem(KUNCI_CACHE_PROFIL);
          muatDaftarUntukLogin();
        } else {
          bukaDashboard(a, false);
        }
      })
      .catch(function () { if (!sudahTampilOptimis) bukaDashboard(sesi, false); });
  }

  // ============ LOGIN ============

  function muatDaftarUntukLogin() {
    tampilkanAdminLayar('admin-layar-login');
    apiGet({ action: 'getDaftarAdmin' })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error);
        daftarAdmin = data.admin.filter(function (a) { return a.status.toLowerCase() === 'aktif'; });
        var select = $('admin-pilih-akun');
        select.innerHTML = '<option value="">-- Pilih akun --</option>';
        daftarAdmin.forEach(function (a) {
          var opt = document.createElement('option');
          opt.value = a.id_admin;
          opt.textContent = a.nama + ' (' + (LABEL_ROLE[a.role] || a.role) + ')';
          select.appendChild(opt);
        });
      })
      .catch(function () {
        // biarkan dropdown kosong, admin bisa refresh manual
      });
  }

  $('admin-pilih-akun').addEventListener('change', function () {
    $('admin-btn-lanjut-akun').disabled = !this.value;
  });

  $('admin-btn-lanjut-akun').addEventListener('click', function () {
    var id = $('admin-pilih-akun').value;
    adminTerpilih = daftarAdmin.filter(function (a) { return a.id_admin === id; })[0];
    if (!adminTerpilih) return;
    $('admin-pin-nama-terpilih').textContent = adminTerpilih.nama;
    $('admin-pin-instruksi').textContent = adminTerpilih.perlu_pin_baru ? 'Buat PIN baru (4 angka)' : 'Masukkan PIN Anda';
    $('admin-pin-input').value = '';
    $('admin-pin-error').textContent = '';
    $('admin-login-pilih').classList.add('tersembunyi');
    $('admin-login-pin').classList.remove('tersembunyi');
    $('admin-pin-input').focus();
  });

  $('admin-btn-batal-pin').addEventListener('click', function () {
    $('admin-login-pin').classList.add('tersembunyi');
    $('admin-login-pilih').classList.remove('tersembunyi');
  });

  function kirimLoginAdmin() {
    var pin = $('admin-pin-input').value.trim();
    if (!/^\d{4}$/.test(pin)) {
      $('admin-pin-error').textContent = 'PIN harus 4 angka.';
      return;
    }
    apiPost({ action: 'adminLogin', id_admin: adminTerpilih.id_admin, pin: pin })
      .then(function (data) {
        if (!data.ok) {
          $('admin-pin-error').textContent = data.error || 'Gagal. Coba lagi.';
          $('admin-pin-input').value = '';
          return;
        }
        simpanSesi(data);
        bukaDashboard(data, false);
      })
      .catch(function () {
        $('admin-pin-error').textContent = pesanKoneksi();
      });
  }

  $('admin-btn-kirim-pin').addEventListener('click', kirimLoginAdmin);
  $('admin-pin-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') kirimLoginAdmin();
  });

  $('admin-btn-keluar').addEventListener('click', function () {
    hapusSesi();
    localStorage.removeItem(KUNCI_CACHE_PROFIL);
    sesiAdmin = null;
    muatDaftarUntukLogin();
  });

  $('admin-btn-refresh').addEventListener('click', function () {
    this.classList.add('berputar');
    var btn = this;
    if (sesiAdmin) muatDataTab(tabAktifSekarang);
    var sesi = getSesi();
    if (sesi) validasiSesi(sesi);
    setTimeout(function () { btn.classList.remove('berputar'); }, 500);
  });

  // ============ DASHBOARD ============

  function bolehAkses(izinKey) {
    return sesiAdmin.role === 'OWNER' || !!sesiAdmin[izinKey];
  }

  function bukaDashboard(profil, optimis) {
    sesiAdmin = profil;
    simpanCacheProfil(profil);
    $('admin-nama-aktif').textContent = sesiAdmin.nama;
    $('admin-role-aktif').textContent = LABEL_ROLE[sesiAdmin.role] || sesiAdmin.role;

    // Sembunyikan tab yang bukan wewenang admin ini. "pin" (ganti PIN
    // sendiri) selalu tampil untuk siapa pun yg login.
    aturVisibilitasTab('lembur', bolehAkses('izin_verifikasi_lembur'));
    aturVisibilitasTab('pengajuan', bolehAkses('izin_lihat_pengajuan'));
    aturVisibilitasTab('rekap', bolehAkses('izin_lihat_rekap_gaji'));
    aturVisibilitasTab('kuota', sesiAdmin.role === 'OWNER');
    aturVisibilitasTab('akun', sesiAdmin.role === 'OWNER');

    if (!optimis || !document.querySelector('.admin-tab-item.aktif:not(.admin-tab-tersembunyi)')) {
      var tabPertama = document.querySelector('.admin-tab-item:not(.admin-tab-tersembunyi)');
      if (tabPertama) pindahTab(tabPertama.getAttribute('data-tab'));
    }

    tampilkanAdminLayar('admin-layar-dashboard');
    muatDataTab(tabAktifSekarang);
  }

  function aturVisibilitasTab(nama, tampil) {
    var tombol = document.querySelector('.admin-tab-item[data-tab="' + nama + '"]');
    tombol.classList.toggle('admin-tab-tersembunyi', !tampil);
  }

  function pindahTab(nama) {
    tabAktifSekarang = nama;
    document.querySelectorAll('.admin-tab-item').forEach(function (el) {
      el.classList.toggle('aktif', el.getAttribute('data-tab') === nama);
    });
    document.querySelectorAll('.admin-tab-konten').forEach(function (el) {
      el.classList.toggle('aktif', el.id === 'admin-tab-' + nama);
    });
    muatDataTab(nama);
  }

  // Muat data KHUSUS tab yang sedang aktif (bukan semua tab sekaligus) —
  // lebih ringan & lebih cepat terasa drpd nge-fetch 4-5 tab tiap kali
  // dashboard dibuka, terutama saat baru login/reload.
  function muatDataTab(nama) {
    if (!sesiAdmin) return;
    if (nama === 'lembur') muatAntreanLembur();
    else if (nama === 'pengajuan') muatAntreanPengajuan();
    else if (nama === 'rekap') { muatDaftarKaryawanUntukFilter(); muatRekapGaji(); }
    else if (nama === 'kuota') muatKuotaCuti();
    else if (nama === 'akun') muatDaftarAkun();
  }

  $('admin-nav-tab').addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-tab-item');
    if (!btn || btn.classList.contains('admin-tab-tersembunyi')) return;
    pindahTab(btn.getAttribute('data-tab'));
  });

  // ============ TAB: VERIFIKASI LEMBUR ============

  function formatDurasi(menit) {
    var jam = Math.floor(menit / 60);
    var sisaMenit = menit % 60;
    return jam + ' jam ' + sisaMenit + ' menit';
  }

  function muatAntreanLembur() {
    if (!bolehAkses('izin_verifikasi_lembur')) return;
    apiGet({ action: 'getAntreanLembur', actor_id_admin: sesiAdmin.id_admin })
      .then(function (data) {
        var tbody = $('admin-lembur-tbody');
        tbody.innerHTML = '';
        if (!data.ok) return;
        $('admin-lembur-kosong').classList.toggle('tersembunyi', data.antrean.length > 0);
        data.antrean.forEach(function (s) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td data-label="Nama">' + escapeHtml(s.nama) + '</td>' +
            '<td data-label="Tanggal">' + escapeHtml(s.tanggal) + '</td>' +
            '<td data-label="Mulai">' + escapeHtml(s.mulai.substring(0, 5)) + '</td>' +
            '<td data-label="Selesai">' + escapeHtml(s.selesai.substring(0, 5)) + '</td>' +
            '<td data-label="Durasi">' + formatDurasi(s.durasi_menit) + '</td>' +
            '<td><button class="admin-btn-kecil admin-btn-verifikasi" data-id="' + escapeHtml(s.id_karyawan) + '" data-tanggal="' + escapeHtml(s.tanggal) + '">Verifikasi</button></td>';
          tbody.appendChild(tr);
        });
      });
  }

  $('admin-lembur-tbody').addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-btn-verifikasi');
    if (!btn) return;
    btn.disabled = true;
    apiPost({
      action: 'verifikasiLembur',
      actor_id_admin: sesiAdmin.id_admin,
      id_karyawan: btn.getAttribute('data-id'),
      tanggal: btn.getAttribute('data-tanggal')
    }).then(function (data) {
      if (!data.ok) {
        alert(data.error || 'Gagal verifikasi.');
        btn.disabled = false;
        return;
      }
      muatAntreanLembur();
    });
  });

  // ============ TAB: PENGAJUAN CUTI/IZIN ============

  function muatAntreanPengajuan() {
    if (!bolehAkses('izin_lihat_pengajuan')) return;
    apiGet({ action: 'getAntreanPengajuan', actor_id_admin: sesiAdmin.id_admin })
      .then(function (data) {
        var tbody = $('admin-pengajuan-tbody');
        tbody.innerHTML = '';
        if (!data.ok) return;
        $('admin-pengajuan-kosong').classList.toggle('tersembunyi', data.antrean.length > 0);
        $('admin-pengajuan-readonly-note').classList.toggle('tersembunyi', !!data.bisa_putuskan);

        data.antrean.forEach(function (p) {
          var rentang = p.tanggal_mulai === p.tanggal_selesai
            ? p.tanggal_mulai
            : p.tanggal_mulai + ' s/d ' + p.tanggal_selesai;
          var lampiran = p.lampiran_url
            ? '<a href="' + escapeHtml(p.lampiran_url) + '" target="_blank" rel="noopener">Lihat</a>'
            : '—';
          var sisaKuota = p.tipe_izin === 'CUTI' && typeof p.sisa_kuota_cuti === 'number'
            ? p.sisa_kuota_cuti + ' hari'
            : '—';
          var aksi = data.bisa_putuskan
            ? '<button class="admin-btn-kecil admin-btn-setujui" data-id="' + escapeHtml(p.id_pengajuan) + '">Setujui</button> ' +
              '<button class="admin-btn-kecil admin-btn-tolak" data-id="' + escapeHtml(p.id_pengajuan) + '">Tolak</button>'
            : '<span class="admin-teks-redup-kecil">Lihat saja</span>';
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td data-label="Nama">' + escapeHtml(p.nama) + '</td>' +
            '<td data-label="Jenis">' + escapeHtml(LABEL_IZIN_TAMPIL[p.tipe_izin] || p.tipe_izin) + '</td>' +
            '<td data-label="Tanggal">' + escapeHtml(rentang) + '</td>' +
            '<td data-label="Hari">' + p.jumlah_hari + '</td>' +
            '<td data-label="Sisa Kuota Cuti">' + sisaKuota + '</td>' +
            '<td class="admin-td-alasan" data-label="Alasan">' + escapeHtml(p.alasan) + '</td>' +
            '<td data-label="Lampiran">' + lampiran + '</td>' +
            '<td data-label="Diajukan">' + escapeHtml(p.diajukan_pada) + '</td>' +
            '<td>' + aksi + '</td>';
          tbody.appendChild(tr);
        });
      });
  }

  // TANPA prompt catatan (Fase 3, 2026-08-07) — klik Setujui/Tolak langsung
  // eksekusi, tidak ada dialog isi catatan lagi.
  $('admin-pengajuan-tbody').addEventListener('click', function (e) {
    var btnSetuju = e.target.closest('.admin-btn-setujui');
    var btnTolak = e.target.closest('.admin-btn-tolak');
    var btn = btnSetuju || btnTolak;
    if (!btn) return;
    var keputusan = btnSetuju ? 'DISETUJUI' : 'DITOLAK';
    btn.disabled = true;
    apiPost({
      action: 'putuskanPengajuan',
      actor_id_admin: sesiAdmin.id_admin,
      id_pengajuan: btn.getAttribute('data-id'),
      keputusan: keputusan
    }).then(function (data) {
      if (!data.ok) {
        alert(data.error || 'Gagal menyimpan keputusan.');
        btn.disabled = false;
        return;
      }
      if (data.tanggal_dilewati && data.tanggal_dilewati.length > 0) {
        alert('Disetujui, tapi beberapa tanggal dilewati karena sudah ada catatan lain:\n' + data.tanggal_dilewati.join('\n'));
      }
      muatAntreanPengajuan();
    });
  });

  // ============ TAB: REKAP ============

  function bulanIniISO() {
    var d = new Date();
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
  }
  $('admin-rekap-bulan').value = bulanIniISO();

  var rekapDataTerakhir = [];

  function muatDaftarKaryawanUntukFilter() {
    if (daftarKaryawanAktif.length > 0) return; // cukup sekali per sesi
    apiGet({ action: 'getKaryawan' }).then(function (data) {
      if (!data.ok) return;
      daftarKaryawanAktif = data.karyawan;
      var select = $('admin-rekap-karyawan');
      daftarKaryawanAktif.forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = k.id_karyawan;
        opt.textContent = k.nama;
        select.appendChild(opt);
      });
    });
  }

  function muatRekapGaji() {
    if (!bolehAkses('izin_lihat_rekap_gaji')) return;
    var params = { actor_id_admin: sesiAdmin.id_admin };
    var dari = $('admin-rekap-dari').value;
    var sampai = $('admin-rekap-sampai').value;
    if (dari && sampai) {
      params.tanggal_mulai = dari;
      params.tanggal_selesai = sampai;
    } else {
      var bulan = $('admin-rekap-bulan').value;
      if (!bulan) return;
      params.bulan = bulan;
    }
    var idKaryawan = $('admin-rekap-karyawan').value;
    if (idKaryawan) params.id_karyawan = idKaryawan;

    apiGet(Object.assign({ action: 'getRekapGaji' }, params))
      .then(function (data) {
        var tbody = $('admin-rekap-tbody');
        tbody.innerHTML = '';
        if (!data.ok) {
          $('admin-rekap-catatan').textContent = data.error || 'Gagal memuat rekap.';
          return;
        }
        rekapDataTerakhir = data.rekap;
        data.rekap.forEach(function (r) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td data-label="Nama">' + escapeHtml(r.nama) + '</td>' +
            '<td data-label="Hari Kerja">' + r.hari_kerja + '</td>' +
            '<td data-label="Izin">' + r.hari_izin + '</td>' +
            '<td data-label="Cuti">' + r.hari_cuti + '</td>' +
            '<td data-label="Jam Lembur Terverifikasi">' + formatDurasi(r.menit_lembur_terverifikasi) + '</td>';
          tbody.appendChild(tr);
        });
      });
  }

  $('admin-btn-muat-rekap').addEventListener('click', muatRekapGaji);

  // Export CSV — native (tanpa library), cukup buat kebutuhan sederhana ini.
  $('admin-btn-export-csv').addEventListener('click', function () {
    if (rekapDataTerakhir.length === 0) { alert('Tidak ada data rekap untuk diunduh. Klik Tampilkan dulu.'); return; }
    var header = ['Nama', 'Hari Kerja', 'Izin', 'Cuti', 'Menit Lembur Terverifikasi'];
    var baris = rekapDataTerakhir.map(function (r) {
      return [r.nama, r.hari_kerja, r.hari_izin, r.hari_cuti, r.menit_lembur_terverifikasi]
        .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; })
        .join(',');
    });
    var csv = header.join(',') + '\n' + baris.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'rekap-omahkebon-' + ($('admin-rekap-bulan').value || 'custom') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Export PDF — pakai dialog cetak browser (window.print), tanpa library
  // eksternal. Style @media print di admin.css menyembunyikan bagian selain
  // tabel rekap supaya hasil cetak/simpan-PDF cuma berisi tabelnya.
  $('admin-btn-export-pdf').addEventListener('click', function () {
    if (rekapDataTerakhir.length === 0) { alert('Tidak ada data rekap untuk dicetak. Klik Tampilkan dulu.'); return; }
    document.body.classList.add('admin-mode-cetak');
    window.print();
    document.body.classList.remove('admin-mode-cetak');
  });

  // ============ TAB: KUOTA CUTI KARYAWAN (khusus Owner) ============

  function muatKuotaCuti() {
    if (sesiAdmin.role !== 'OWNER') return;
    apiGet({ action: 'getKuotaCuti', actor_id_admin: sesiAdmin.id_admin })
      .then(function (data) {
        var tbody = $('admin-kuota-tbody');
        tbody.innerHTML = '';
        if (!data.ok) return;
        data.kuota.forEach(function (k) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td data-label="Nama">' + escapeHtml(k.nama) + '</td>' +
            '<td data-label="Tanggal Daftar">' + escapeHtml(k.tanggal_daftar) + '</td>' +
            '<td data-label="Kuota Otomatis">' + k.kuota_otomatis + ' hari</td>' +
            '<td data-label="Override"><input type="number" min="0" class="admin-input-kuota" data-id="' + escapeHtml(k.id_karyawan) + '" value="' + escapeHtml(k.override) + '" placeholder="otomatis" /></td>' +
            '<td data-label="Terpakai Thn Ini">' + k.terpakai + ' hari</td>' +
            '<td data-label="Sisa">' + k.sisa + ' hari</td>' +
            '<td><button class="admin-btn-kecil admin-btn-simpan-kuota" data-id="' + escapeHtml(k.id_karyawan) + '">Simpan</button></td>';
          tbody.appendChild(tr);
        });
      });
  }

  $('admin-kuota-tbody').addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-btn-simpan-kuota');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var input = document.querySelector('.admin-input-kuota[data-id="' + id + '"]');
    btn.disabled = true;
    apiPost({ action: 'setKuotaCutiOverride', actor_id_admin: sesiAdmin.id_admin, id_karyawan: id, override: input.value })
      .then(function (data) {
        btn.disabled = false;
        if (!data.ok) { alert(data.error || 'Gagal menyimpan.'); return; }
        muatKuotaCuti();
      });
  });

  // ============ TAB: KELOLA AKUN ADMIN (khusus Owner) ============

  function muatDaftarAkun() {
    apiGet({ action: 'getDaftarAdmin' }).then(function (data) {
      if (!data.ok) return;
      daftarAdmin = data.admin;
      var tbody = $('admin-akun-tbody');
      tbody.innerHTML = '';
      daftarAdmin.forEach(function (a) {
        var tr = document.createElement('tr');
        var aktif = a.status.toLowerCase() === 'aktif';
        tr.innerHTML =
          '<td data-label="Nama">' + escapeHtml(a.nama) + '</td>' +
          '<td data-label="Role">' + escapeHtml(LABEL_ROLE[a.role] || a.role) + '</td>' +
          '<td data-label="Status">' + (aktif ? 'Aktif' : 'Nonaktif') + '</td>' +
          '<td data-label="Lihat Pengajuan"><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_lihat_pengajuan" ' + (a.izin_lihat_pengajuan ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td data-label="Approve Pengajuan"><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_approve_pengajuan" ' + (a.izin_approve_pengajuan ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td data-label="Verifikasi Lembur"><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_verifikasi_lembur" ' + (a.izin_verifikasi_lembur ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td data-label="Lihat Rekap"><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_lihat_rekap_gaji" ' + (a.izin_lihat_rekap_gaji ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td>' +
            '<button class="admin-btn-kecil admin-btn-reset-pin" data-id="' + a.id_admin + '">Reset PIN</button> ' +
            '<button class="admin-btn-kecil ' + (aktif ? 'admin-btn-toggle-merah' : '') + ' admin-btn-toggle-aktif" data-id="' + a.id_admin + '" data-target="' + (aktif ? 'nonaktifkan' : 'aktifkan') + '"' + (a.id_admin === sesiAdmin.id_admin ? ' disabled' : '') + '>' + (aktif ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    });
  }

  $('admin-akun-tbody').addEventListener('change', function (e) {
    var cek = e.target.closest('.admin-cek-izin');
    if (!cek) return;
    var body = { action: 'adminSimpanAkun', actor_id_admin: sesiAdmin.id_admin, mode: 'edit_izin', target_id_admin: cek.getAttribute('data-id') };
    body[cek.getAttribute('data-izin')] = cek.checked;
    apiPost(body).then(function (data) {
      if (!data.ok) {
        alert(data.error || 'Gagal menyimpan.');
        cek.checked = !cek.checked;
      }
    });
  });

  $('admin-akun-tbody').addEventListener('click', function (e) {
    var resetBtn = e.target.closest('.admin-btn-reset-pin');
    if (resetBtn) {
      if (!confirm('Reset PIN akun ini? Admin itu akan diminta buat PIN baru saat login berikutnya.')) return;
      apiPost({ action: 'adminSimpanAkun', actor_id_admin: sesiAdmin.id_admin, mode: 'reset_pin', target_id_admin: resetBtn.getAttribute('data-id') })
        .then(function (data) {
          if (!data.ok) { alert(data.error || 'Gagal reset PIN.'); return; }
          alert('PIN berhasil direset.');
        });
      return;
    }
    var toggleBtn = e.target.closest('.admin-btn-toggle-aktif');
    if (toggleBtn) {
      var mode = toggleBtn.getAttribute('data-target');
      apiPost({ action: 'adminSimpanAkun', actor_id_admin: sesiAdmin.id_admin, mode: mode, target_id_admin: toggleBtn.getAttribute('data-id') })
        .then(function (data) {
          if (!data.ok) { alert(data.error || 'Gagal.'); return; }
          muatDaftarAkun();
        });
    }
  });

  $('admin-btn-tambah-akun').addEventListener('click', function () {
    var nama = $('admin-akun-nama-baru').value.trim();
    var role = $('admin-akun-role-baru').value.trim();
    $('admin-akun-pesan').textContent = '';
    if (!nama) {
      $('admin-akun-pesan').textContent = 'Nama wajib diisi.';
      return;
    }
    if (!role) {
      $('admin-akun-pesan').textContent = 'Role wajib diisi.';
      return;
    }
    apiPost({ action: 'adminSimpanAkun', actor_id_admin: sesiAdmin.id_admin, mode: 'tambah', nama: nama, role: role })
      .then(function (data) {
        if (!data.ok) {
          $('admin-akun-pesan').textContent = data.error || 'Gagal menambah akun.';
          return;
        }
        $('admin-akun-nama-baru').value = '';
        $('admin-akun-role-baru').value = '';
        muatDaftarAkun();
      });
  });

  // ============ TAB: GANTI PIN SAYA ============

  $('admin-btn-ganti-pin').addEventListener('click', function () {
    var pinLama = $('admin-pin-lama').value.trim();
    var pinBaru = $('admin-pin-baru').value.trim();
    $('admin-ganti-pin-pesan').textContent = '';
    if (!/^\d{4}$/.test(pinBaru)) {
      $('admin-ganti-pin-pesan').textContent = 'PIN baru harus 4 angka.';
      return;
    }
    apiPost({ action: 'adminGantiPin', id_admin: sesiAdmin.id_admin, pin_lama: pinLama, pin_baru: pinBaru })
      .then(function (data) {
        if (!data.ok) {
          $('admin-ganti-pin-pesan').textContent = data.error || 'Gagal mengganti PIN.';
          return;
        }
        $('admin-pin-lama').value = '';
        $('admin-pin-baru').value = '';
        $('admin-ganti-pin-pesan').textContent = '';
        alert('PIN berhasil diganti.');
      });
  });

  mulai();
})();
