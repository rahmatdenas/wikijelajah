'use strict';

// State terpusat, referensi DOM, dan perpindahan bagian halaman.

// ---------------------------------------------------------------------------
// STATE TERPUSAT
// ---------------------------------------------------------------------------
const State = {
  records:      {},      // QID → { id, title, provQid(s), provLabel(s), lokLabel, yearStr, year, lat, lon, ... }
  sortedIds:    [],      // urutan saat ini
  visibleIds:   [],      // setelah filter
  currentIndex: -1,      // index di visibleIds untuk detail
  // image/article: null (tidak disaring) | 'has' (ada) | 'without' (tanpa)
  filter: { wilayah: 'all', search: '', image: null, article: null },
  shown:       0,       // jumlah butir visibleIds yang sudah dirender (dimuat bertahap saat digulir)
  params:      null,
  mediaLoaded: false,
  abortCtrl:   null,
  stopCtrl:    null,      // "Cukupkan pencarian": hentikan penarikan, tampilkan yang sudah ada
  stepCtrl:    null,      // "Hentikan" di bar status: hentikan langkah latar (koordinat / media) yang berjalan
  partial:     false,     // data utama tidak lengkap (dicukupkan / galat)
  // QID yang koordinat / gambar-artikelnya belum termuat (batch gagal atau dihentikan) → "Coba lagi"
  missing:     { coords: [], media: [] },
  cacheKey:    null,
};

// Jumlah data minimal sebelum tombol "Cukupkan pencarian" muncul
const CUKUPKAN_MIN_DATA = 5000;

let _activeSection = 'landing';
let _listBuilt = false;

// ---------------------------------------------------------------------------
// DOM REFERENCES
// ---------------------------------------------------------------------------
const DOM = {
  panel: null,
  sections: {},
  // Form
  selectTipe:      null,
  wadahProvinsi:   null,
  wadahQidWilayah: null,
  inputQidWilayah: null,
  selectProvinsi:  null,
  wadahLuarNegeri: null,
  selectNegara:    null,
  selectKategori:  null,
  inputQid:        null,
  btnJelajahi:     null,
  // Hasil
  filterWilayah:   null,
  filterUrut:      null,
  searchInput:     null,
  hasilList:       null,
  btnArtikel:      null,
  btnGambar:       null,
  btnSemua:        null,
};

function initDOM() {
  DOM.panel          = $('panel');
  DOM.sections       = {
    landing: $('panel-landing'),
    hasil:   $('panel-hasil'),
    detail:  $('panel-details'),
  };
  DOM.selectTipe       = $('select-wilayah-tipe');
  DOM.wadahProvinsi    = $('wadah-provinsi');
  DOM.wadahQidWilayah  = $('wadah-qid-wilayah');
  DOM.inputQidWilayah  = $('input-qid-wilayah');
  DOM.selectProvinsi   = $('select-provinsi');
  DOM.wadahLuarNegeri  = $('wadah-luar-negeri');
  DOM.selectNegara     = $('select-negara');
  DOM.selectKategori   = $('select-kategori');
  DOM.inputQid         = $('input-qid');
  DOM.btnJelajahi      = $('btn-jelajahi');
  // (loading sekarang inline di panel-hasil, tidak ada section terpisah)
  DOM.filterWilayah    = $('filter-wilayah');
  DOM.filterUrut       = $('filter-urut');
  DOM.searchInput      = $('search-input');
  DOM.hasilList        = $('hasil-list');
  DOM.btnArtikel       = $('btn-jelajahi-artikel');
  DOM.btnGambar        = $('btn-jelajahi-gambar');
  DOM.btnSemua         = $('btn-semua-hasil');
}

const regionType = () => DOM.selectTipe.value;

// ---------------------------------------------------------------------------
// SECTION SWITCHING
// ---------------------------------------------------------------------------
function showSection(name) {
  Object.entries(DOM.sections).forEach(([k, el]) =>
    el?.classList.toggle('hidden', k !== name)
  );
  _activeSection = name;

  // Di beranda: tawarkan kembali ke hasil terakhir bila ada
  const last = $('btn-hasil-terakhir');
  if (last) {
    last.classList.toggle('hidden', name !== 'landing' || !State.sortedIds.length);
    if (State.params) last.textContent = `${msg('explore-last-results', State.params.klasterLabel, State.sortedIds.length)} →`;
  }

  DOM.panel?.scrollTo({ top: 0, behavior: 'smooth' });
}
