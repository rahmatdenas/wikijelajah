'use strict';

/* ==========================================================================
   main.js — Inisialisasi halaman Jelajah: memasang semua event listener.
   Kodenya tersebar per fitur di search/, detail/, layout/, dan upload/
   (dimuat lebih dulu di index.html). wikidata.js menyediakan semua fungsi
   data; map.js menyediakan semua peta.
   ========================================================================== */

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

  initDOM();

  // Peta
  mapInit(qid => {
    const r = State.records[qid];
    if (!r) return;

    // Update popup dengan gambar jika tersedia
    if (r.popup) {
      r.popup.setContent(buildMapPopupHtml(r));
      r.popup.update();
    }

    const isMobile = window.innerWidth <= 800;

    if (isMobile) {
      // Mobile: popup tampil dulu dengan tombol "Lihat Detail"
      // Tunggu DOM popup ter-render lalu pasang listener tombol
      setTimeout(() => {
        const btn = document.querySelector(`.popup-lihat-detail[data-qid="${qid}"]`);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const idx = State.visibleIds.indexOf(qid);
          if (idx >= 0) {
            openDetail(idx);
          } else {
            State.currentIndex = -1;
            renderDetail(qid);
            showSection('detail');
            updateDetailNav();
          }
          openBottomSheet();
        }, { once: true });
      }, 50);
      return;
    }

    // Desktop: langsung buka detail
    const idx = State.visibleIds.indexOf(qid);
    if (idx === State.currentIndex && _activeSection === 'detail') return;
    if (idx >= 0) {
      openDetail(idx);
    } else {
      State.currentIndex = -1;
      renderDetail(qid);
      showSection('detail');
      updateDetailNav();
    }
  });

  // Form
  enhanceSearchableSelect(DOM.selectProvinsi, msg('region-province-placeholder'));
  enhanceSearchableSelect(DOM.selectNegara, msg('region-country-placeholder'));
  enhanceSearchableSelect(DOM.selectKategori, msg('category-combo-placeholder'));
  updateFormVisibility();
  DOM.selectTipe?.addEventListener('change', updateFormVisibility);
  initWilayahSearch();
  DOM.selectKategori?.addEventListener('change', updateQidFromKategori);
  DOM.btnJelajahi?.addEventListener('click', startSearch);
  $('btn-ubah-pencarian')?.addEventListener('click', () => showSection('landing'));
  $('btn-hasil-terakhir')?.addEventListener('click', () => showSection('hasil'));
  // Muat butir berikutnya saat penanda di bawah daftar terlihat
  if ('IntersectionObserver' in window) {
    _listObserver = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && State.shown < State.visibleIds.length) appendItems(LOAD_STEP);
    });
  }

  // Cukupkan: hentikan penarikan, tampilkan data yang sudah masuk
  $('btn-cukupkan')?.addEventListener('click', e => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = msg('stopping');
    State.stopCtrl?.abort();
  });

  // Tambah butir baru: fitur menyusul
  $('btn-tambah-butir')?.addEventListener('click', () =>
    appShowDialog(escHtml(msg('add-item-soon')), 'alert', msg('add-item')));

  // Hentikan (bar status): hentikan langkah latar yang berjalan, data yang sudah masuk tetap dipakai
  $('btn-batalkan')?.addEventListener('click', () => State.stepCtrl?.abort());

  // Filter hasil
  DOM.filterWilayah?.addEventListener('change', e => {
    State.filter.wilayah = e.target.value; applyFilter();
    syncMapMarkers();
    mapFitAll();
  });
  DOM.filterUrut?.addEventListener('change', e => applySort(e.target.value));
  DOM.searchInput?.addEventListener('input', e => {
    State.filter.search = e.target.value; applyFilter();
  });
  // Semua: lepas semua saringan (wilayah, kata cari, gambar, artikel)
  DOM.btnSemua?.addEventListener('click', () => {
    State.filter = { wilayah: 'all', search: '', image: null, article: null };
    if (DOM.filterWilayah) DOM.filterWilayah.value = 'all';
    if (DOM.searchInput) DOM.searchInput.value = '';
    applyFilter();
    syncMapMarkers();
    mapFitAll();
  });
  // Artikel / Foto: Ada → Tanpa → lepas; keduanya bisa aktif bersamaan
  [[DOM.btnArtikel, 'article'], [DOM.btnGambar, 'image']].forEach(([btn, key]) => btn?.addEventListener('click', () => {
    State.filter[key] = nextMediaFilter(State.filter[key]);
    applyFilter();
  }));

  // Lightbox
  $('lightbox-overlay')?.addEventListener('click', e => {
    if (!e.target.closest('.lightbox-content') || e.target.closest('.lightbox-close'))
      closeLightbox();
  });
  $('lightbox-overlay')?.querySelector('.lightbox-close')
    ?.addEventListener('click', closeLightbox);

  // Mobile bottom-sheet
  initBottomSheet();

  // Upload modal
  initUploadModal();
  // Aturan jenis subjek properti gambar diambil sekali di awal, agar pengecekan di detail lebih cepat
  if (APP_USER) fetchImagePropClasses(IMAGE_PROPS).catch(() => {});
  initLinkPhotoModal();

  // Landing default; tautan yang membawa pencarian langsung dijalankan
  showSection('landing');
  if (applyQueryParams()) startSearch();
});
