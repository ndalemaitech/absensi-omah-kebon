/* Dashboard Admin — Absensi Omah Kebon (vanilla JS, tanpa framework) */

(function () {
  'use strict';

  var KUNCI_SESI_ADMIN = 'absensi_omahkebon_admin_sesi';

  // ============ STATE ============
  var daftarAdmin = [];
  var adminTerpilih = null; // saat proses login, sebelum PIN dikirim
  var sesiAdmin = null; // profil lengkap admin yang sedang login

  var LABEL_ROLE = { OWNER: 'Owner', HR: 'HR', REKAP: 'Rekap' };

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

  function tampilkanAdminLayar(id) {
    document.querySelectorAll('.admin-layar').forEach(function (el) {
      el.classList.toggle('admin-layar-aktif', el.id === id);
    });
  }

  // ============ ALUR MULAI ============

  function mulai() {
    if (typeof API_URL === 'undefined' || API_URL.indexOf('PASTE_URL') !== -1) {
      alert('Aplikasi belum dikonfigurasi. (Developer: isi API_URL di js/config.js)');
      return;
    }
    var sesi = getSesi();
    if (sesi && sesi.id_admin) {
      validasiSesi(sesi);
    } else {
      muatDaftarUntukLogin();
    }
  }

  // Sesi TIDAK otomatis dipercaya — selalu dicek ulang ke server (sama
  // filosofi dgn validasiSesi karyawan). Kalau Owner reset PIN atau ubah
  // izin/status admin ini, sesi lama otomatis mengikuti perubahan terbaru.
  function validasiSesi(sesi) {
    apiGet({ action: 'getDaftarAdmin' })
      .then(function (data) {
        if (!data.ok) { bukaDashboard(sesi); return; }
        daftarAdmin = data.admin;
        var a = daftarAdmin.filter(function (x) { return x.id_admin === sesi.id_admin; })[0];
        if (!a || a.perlu_pin_baru || a.status.toLowerCase() !== 'aktif') {
          hapusSesi();
          muatDaftarUntukLogin();
        } else {
          bukaDashboard(a);
        }
      })
      .catch(function () { bukaDashboard(sesi); });
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
        bukaDashboard(data);
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
    sesiAdmin = null;
    muatDaftarUntukLogin();
  });

  // ============ DASHBOARD ============

  function bolehAkses(izinKey) {
    return sesiAdmin.role === 'OWNER' || !!sesiAdmin[izinKey];
  }

  function bukaDashboard(profil) {
    sesiAdmin = profil;
    $('admin-nama-aktif').textContent = sesiAdmin.nama;
    $('admin-role-aktif').textContent = LABEL_ROLE[sesiAdmin.role] || sesiAdmin.role;

    // Sembunyikan tab yang bukan wewenang admin ini. "pengajuan" (placeholder)
    // dan "pin" (ganti PIN sendiri) selalu tampil untuk siapa pun yg login.
    aturVisibilitasTab('lembur', bolehAkses('izin_verifikasi_lembur'));
    aturVisibilitasTab('rekap', bolehAkses('izin_lihat_rekap_gaji'));
    aturVisibilitasTab('akun', sesiAdmin.role === 'OWNER');

    var tabPertama = document.querySelector('.admin-tab-item:not(.admin-tab-tersembunyi)');
    if (tabPertama) pindahTab(tabPertama.getAttribute('data-tab'));

    tampilkanAdminLayar('admin-layar-dashboard');
    muatAntreanLembur();
    if (sesiAdmin.role === 'OWNER') muatDaftarAkun();
  }

  function aturVisibilitasTab(nama, tampil) {
    var tombol = document.querySelector('.admin-tab-item[data-tab="' + nama + '"]');
    tombol.classList.toggle('admin-tab-tersembunyi', !tampil);
  }

  function pindahTab(nama) {
    document.querySelectorAll('.admin-tab-item').forEach(function (el) {
      el.classList.toggle('aktif', el.getAttribute('data-tab') === nama);
    });
    document.querySelectorAll('.admin-tab-konten').forEach(function (el) {
      el.classList.toggle('aktif', el.id === 'admin-tab-' + nama);
    });
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
            '<td>' + escapeHtml(s.nama) + '</td>' +
            '<td>' + escapeHtml(s.tanggal) + '</td>' +
            '<td>' + escapeHtml(s.mulai.substring(0, 5)) + '</td>' +
            '<td>' + escapeHtml(s.selesai.substring(0, 5)) + '</td>' +
            '<td>' + formatDurasi(s.durasi_menit) + '</td>' +
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

  // ============ TAB: REKAP GAJI ============

  function bulanIniISO() {
    var d = new Date();
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
  }
  $('admin-rekap-bulan').value = bulanIniISO();

  function muatRekapGaji() {
    if (!bolehAkses('izin_lihat_rekap_gaji')) return;
    var bulan = $('admin-rekap-bulan').value;
    if (!bulan) return;
    apiGet({ action: 'getRekapGaji', actor_id_admin: sesiAdmin.id_admin, bulan: bulan })
      .then(function (data) {
        var tbody = $('admin-rekap-tbody');
        tbody.innerHTML = '';
        if (!data.ok) {
          $('admin-rekap-catatan').textContent = data.error || 'Gagal memuat rekap.';
          return;
        }
        $('admin-rekap-catatan').textContent = data.catatan || '';
        data.rekap.forEach(function (r) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + escapeHtml(r.nama) + '</td>' +
            '<td>' + r.hari_masuk + '</td>' +
            '<td>' + r.hari_lengkap + '</td>' +
            '<td>' + formatDurasi(r.menit_lembur_terverifikasi) + '</td>';
          tbody.appendChild(tr);
        });
      });
  }

  $('admin-btn-muat-rekap').addEventListener('click', muatRekapGaji);

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
          '<td>' + escapeHtml(a.nama) + '</td>' +
          '<td>' + (LABEL_ROLE[a.role] || a.role) + '</td>' +
          '<td>' + (aktif ? 'Aktif' : 'Nonaktif') + '</td>' +
          '<td><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_approve_pengajuan" ' + (a.izin_approve_pengajuan ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_verifikasi_lembur" ' + (a.izin_verifikasi_lembur ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td><input type="checkbox" class="admin-cek-izin" data-id="' + a.id_admin + '" data-izin="izin_lihat_rekap_gaji" ' + (a.izin_lihat_rekap_gaji ? 'checked' : '') + (a.role === 'OWNER' ? ' disabled' : '') + ' /></td>' +
          '<td>' +
            '<button class="admin-btn-kecil admin-btn-reset-pin" data-id="' + a.id_admin + '">Reset PIN</button> ' +
            '<button class="admin-btn-kecil admin-btn-toggle-aktif" data-id="' + a.id_admin + '" data-target="' + (aktif ? 'nonaktifkan' : 'aktifkan') + '"' + (a.id_admin === sesiAdmin.id_admin ? ' disabled' : '') + '>' + (aktif ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
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
    var role = $('admin-akun-role-baru').value;
    $('admin-akun-pesan').textContent = '';
    if (!nama) {
      $('admin-akun-pesan').textContent = 'Nama wajib diisi.';
      return;
    }
    apiPost({ action: 'adminSimpanAkun', actor_id_admin: sesiAdmin.id_admin, mode: 'tambah', nama: nama, role: role })
      .then(function (data) {
        if (!data.ok) {
          $('admin-akun-pesan').textContent = data.error || 'Gagal menambah akun.';
          return;
        }
        $('admin-akun-nama-baru').value = '';
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

  // ============ UTIL ============

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  mulai();
})();
