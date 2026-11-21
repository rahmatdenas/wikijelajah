'use strict';

/* ==========================================================================
   main.js — App controller: state, event listeners, UI rendering.
   wikidata.js menyediakan semua fungsi data; map.js menyediakan semua peta.
   ========================================================================== */

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

// ---------------------------------------------------------------------------
// FORM HELPERS
// ---------------------------------------------------------------------------
function updateFormVisibility() {
  const tipe = regionType();
  DOM.wadahProvinsi.classList.toggle('hidden', tipe !== 'provinsi');
  DOM.wadahLuarNegeri.classList.toggle('hidden', tipe !== 'luar_negeri');
  DOM.wadahQidWilayah?.classList.toggle('hidden', tipe !== 'qid');
  if (tipe === 'qid' && !DOM.inputQidWilayah.value) DOM.inputQidWilayah.focus();
}

/** "Q123", "wd:Q123", atau URL Wikidata → "wd:Q123"; selain itu null. */
function normalizeWilayahQid(text) {
  const m = String(text || '').trim().match(/^(?:wd:|https?:\/\/\S*\/)?(Q\d+)$/i);
  return m ? `wd:${m[1].toUpperCase()}` : null;
}

// ---------------------------------------------------------------------------
// INPUT "CARI WILAYAH": ketik nama → pilih dari saran, atau ketik Q-ID langsung.
// Wilayah terpilih disimpan di dataset input: qid ("Q123"), label, negara ("wd:Q252").
// ---------------------------------------------------------------------------
let _wilayahTimer = null, _wilayahCtrl = null, _wilayahResults = [], _wilayahActive = -1;

function setWilayahInfo(cls, text) {
  const info = $('qid-wilayah-info');
  info.className = `qid-wilayah-info${cls ? ' qid-wilayah-info--' + cls : ''}`;
  info.textContent = text;
}

function hideWilayahSuggest() {
  $('qid-wilayah-suggest').classList.add('hidden');
  DOM.inputQidWilayah.setAttribute('aria-expanded', 'false');
  _wilayahActive = -1;
}

/** Simpan wilayah terpilih ke input dan tampilkan konfirmasinya. */
function selectWilayah(w) {
  const input = DOM.inputQidWilayah;
  input.value = w.label;
  input.dataset.qid = w.id;
  input.dataset.label = w.label;
  if (w.negara) input.dataset.negara = `wd:${w.negara}`;
  hideWilayahSuggest();
  setWilayahInfo('ok', `✓ ${w.label} (${w.id})${w.description ? ' — ' + w.description : ''}`);
}

function renderWilayahSuggest() {
  const list = $('qid-wilayah-suggest');
  list.innerHTML = _wilayahResults.length
    ? _wilayahResults.map((w, i) => `
        <li class="prop-suggest-item${i === _wilayahActive ? ' active' : ''}" role="option" data-index="${i}"
            aria-selected="${i === _wilayahActive}">
          <span class="prop-suggest-label">${escHtml(w.label)}</span>
          <span class="prop-suggest-qid">${escHtml(w.id)}</span>
          ${w.description ? `<span class="prop-suggest-desc">${escHtml(w.description)}</span>` : ''}
        </li>`).join('')
    : `<li class="prop-suggest-empty">${escHtml(msg('region-none-suggest'))}</li>`;
  list.classList.remove('hidden');
  DOM.inputQidWilayah.setAttribute('aria-expanded', 'true');
}

/** Q-ID diketik langsung: periksa keberadaannya, ambil nama & negaranya. */
async function resolveWilayahQid(id, signal) {
  const [data, claims] = await Promise.all([
    _wbGet({ action: 'wbgetentities', ids: id, props: 'labels|descriptions', languages: WD_LANGS.join('|') }, signal),
    _wbGet({ action: 'wbgetclaims', entity: id, property: 'P17' }, signal).catch(() => ({})),
  ]);
  const e = data.entities?.[id];
  if (!e || 'missing' in e) return null;
  return {
    id,
    label: pickLang(e.labels) || id,
    description: pickLang(e.descriptions),
    // Negara wilayah — membatasi query "Semua Jenis Objek" agar tidak timeout
    negara: _itemId(bestRankClaims(claims.claims?.P17)[0]?.mainsnak?.datavalue?.value) || '',
  };
}

function onQidWilayahInput() {
  const input = DOM.inputQidWilayah;
  ['qid', 'label', 'negara'].forEach(k => delete input.dataset[k]);
  clearTimeout(_wilayahTimer);
  _wilayahCtrl?.abort();
  _wilayahResults = [];
  hideWilayahSuggest();

  const raw = input.value.trim();
  const qid = normalizeWilayahQid(raw);
  if (!raw) return setWilayahInfo('', msg('region-search-hint'));
  if (!qid && raw.length < 2) return setWilayahInfo('', msg('region-search-min'));

  setWilayahInfo('', msg(qid ? 'region-checking-qid' : 'region-searching'));
  _wilayahTimer = setTimeout(async () => {
    _wilayahCtrl = new AbortController();
    try {
      if (qid) {
        const w = await resolveWilayahQid(qid.slice(3), _wilayahCtrl.signal);
        if (!w) return setWilayahInfo('bad', msg('region-qid-missing', qid.slice(3)));
        selectWilayah(w);
        input.value = raw;  // biarkan Q-ID yang diketik tetap terlihat
        return;
      }
      _wilayahResults = await searchWilayah(raw, _wilayahCtrl.signal);
      renderWilayahSuggest();
      setWilayahInfo(_wilayahResults.length ? '' : 'bad',
        msg(_wilayahResults.length ? 'region-choose-hint' : 'region-none'));
    } catch (err) {
      if (err.name !== 'AbortError') setWilayahInfo('bad', msg('region-search-failed'));
    }
  }, qid ? 300 : 450);
}

function onQidWilayahKeydown(e) {
  const list = $('qid-wilayah-suggest');
  if (list.classList.contains('hidden') || !_wilayahResults.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = _wilayahResults.length;
    _wilayahActive = (_wilayahActive + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderWilayahSuggest();
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectWilayah(_wilayahResults[Math.max(_wilayahActive, 0)]);
  } else if (e.key === 'Escape') {
    hideWilayahSuggest();
  }
}

function initWilayahSearch() {
  const input = DOM.inputQidWilayah, list = $('qid-wilayah-suggest');
  if (!input || !list) return;
  input.addEventListener('input', onQidWilayahInput);
  input.addEventListener('keydown', onQidWilayahKeydown);
  // mousedown (bukan click) agar input tidak kehilangan fokus sebelum pilihan tercatat
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.prop-suggest-item');
    if (!li) return;
    e.preventDefault();
    selectWilayah(_wilayahResults[+li.dataset.index]);
  });
  input.addEventListener('blur', () => setTimeout(hideWilayahSuggest, 150));
  input.addEventListener('focus', () => { if (_wilayahResults.length && !input.dataset.qid) renderWilayahSuggest(); });
}

/** Kolom Q-ID kategori hanya untuk "Ketik Q-ID Sendiri". */
function updateQidFromKategori() {
  const opt = DOM.selectKategori.options[DOM.selectKategori.selectedIndex];
  const custom = opt?.value === 'custom';
  $('wadah-qid')?.classList.toggle('hidden', !custom);
  if (custom && DOM.inputQid) { DOM.inputQid.value = ''; DOM.inputQid.focus(); }
}

/** Pilih kategori berdasarkan slug (parameter URL). */
function selectKategoriBySlug(slug) {
  const opt = slug && [...DOM.selectKategori.options].find(o => o.dataset.slug === slug);
  if (!opt) return false;
  DOM.selectKategori.value = opt.value;
  DOM.selectKategori.dispatchEvent(new Event('change'));
  return true;
}

/**
 * Isi form dari URL (tautan dari Perkaya Data, top nav, atau tautan yang dibagikan) lalu langsung cari.
 * ?region=province|all|abroad|area&province=Q..&country=Q..&area=Q..&category=<slug>
 */
function applyQueryParams() {
  const q = new URLSearchParams(location.search);
  if (!selectKategoriBySlug(q.get('category'))) return false;
  const tipe = REGION_FROM_PARAM[q.get('region')] || 'provinsi';
  DOM.selectTipe.value = tipe;
  updateFormVisibility();
  const setSelect = (select, qid) => {
    const val = qid && `wd:${qid.replace(/^wd:/, '')}`;
    if (val && [...select.options].some(o => o.value === val)) {
      select.value = val;
      select.dispatchEvent(new Event('change'));
    }
  };
  if (tipe === 'provinsi') setSelect(DOM.selectProvinsi, q.get('province'));
  if (tipe === 'luar_negeri') setSelect(DOM.selectNegara, q.get('country'));
  if (tipe === 'qid') {
    const area = normalizeWilayahQid(q.get('area'));
    if (!area) return false;
    DOM.inputQidWilayah.value = q.get('area_label') || area.slice(3);
    DOM.inputQidWilayah.dataset.qid = area.slice(3);
    DOM.inputQidWilayah.dataset.label = q.get('area_label') || area.slice(3);
  }
  return true;
}

/** Konteks pencarian (untuk URL, top nav, dan Perkaya Data). Kategori Q-ID bebas tidak bisa dibawa. */
function searchContext(p) {
  if (!p.klasterSlug || p.klasterSlug === 'custom') return null;
  const ctx = { region: REGION_TO_PARAM[p.wilayah], category: p.klasterSlug };
  if (p.wilayah === 'provinsi') ctx.province = p.provQid.replace(/^wd:/, '');
  if (p.wilayah === 'luar_negeri') ctx.country = p.negaraQid.replace(/^wd:/, '');
  if (p.wilayah === 'qid') ctx.area = p.provQid.replace(/^wd:/, '');
  return ctx;
}

// ---------------------------------------------------------------------------
// STATUS LOADING INLINE (di dalam panel-hasil)
// ---------------------------------------------------------------------------
function setLoadingStatus(text) {
  const bar    = $('hasil-loading-bar');
  const center = $('loading-center');
  const span   = $('hasil-loading-text');

  if (text === null) {
    bar?.classList.add('hidden');
    center?.classList.add('hidden');
    return;
  }

  if (!_listBuilt) {
    // Fase 1: list belum muncul → tampilkan centered loading
    bar?.classList.add('hidden');
    if (center) {
      center.classList.remove('hidden');
      const title = $('loading-center-text');
      if (title) title.textContent = text;
    }
  } else {
    // Fase 2: list sudah muncul → pakai bar kecil di atas
    center?.classList.add('hidden');
    if (bar) {
      bar.classList.remove('hidden');
      if (span) span.textContent = text;
    }
  }
}

// ---------------------------------------------------------------------------
// CACHE SESI (sessionStorage) — invalidasi otomatis setelah 30 menit
// ---------------------------------------------------------------------------
const _CACHE_TTL = 30 * 60 * 1000;

function _cacheKey(p) {
  // Bahasa ikut kunci: label & judul artikel Wikipedia berbeda per bahasa
  return `wj5:${I18N.lang}:${p.jenis}:${p.wilayah}:${p.provQid}:${p.negaraQid}`;
}

function _loadCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (Date.now() - saved.ts > _CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return saved;
  } catch { return null; }
}

function _saveCache(key, records, sortedIds) {
  try {
    // Leaflet marker/popup tidak bisa di-serialize — strip dulu.
    // _detail juga dibuang agar detail selalu diambil segar (bisa sudah diedit);
    // _imagePropsP adalah Promise (tidak bisa di-serialize), jadi ikut dibuang bersama hasilnya.
    const clean = {};
    for (const [qid, r] of Object.entries(records)) {
      const { marker, popup, _detail, _imagePropsP, _imageProps, ...rest } = r;
      clean[qid] = rest;
    }
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), records: clean, sortedIds }));
  } catch {} // abaikan jika kuota penuh
}

// ---------------------------------------------------------------------------
// TARIK DATA — FLOW UTAMA
// Alur: langsung tampil panel hasil → item masuk progresif → marker di map
// ---------------------------------------------------------------------------
async function startSearch() {
  const tipe      = regionType();
  const provQid   = DOM.selectProvinsi.value;
  const negaraQid = DOM.selectNegara.value;
  const opt       = DOM.selectKategori.options[DOM.selectKategori.selectedIndex];

  if (!opt || !opt.value) {
    appShowDialog(escHtml(msg('category-required')), 'alert', msg('dialog-attention'));
    return;
  }

  const jenis       = opt.value === 'custom'
    ? (DOM.inputQid?.value?.trim() || '')
    : opt.value;
  // klasterNama = kunci internal (nama Indonesia); klasterLabel = teks tampilan sesuai bahasa
  const klasterNama  = opt.dataset.klaster   || opt.textContent.trim();
  const klasterLabel = opt.textContent.trim();
  const klasterSlug  = opt.dataset.slug || '';
  const propLokasi   = opt.dataset.lokasi    || 'P131';
  const propTahun    = opt.dataset.tahun     || 'P571';
  const useSubclass  = opt.dataset.subclass  === '1';

  // Wilayah terpilih dari saran, atau Q-ID yang diketik langsung
  const wilayahQid = tipe !== 'qid' ? null
    : DOM.inputQidWilayah.dataset.qid ? `wd:${DOM.inputQidWilayah.dataset.qid}`
    : normalizeWilayahQid(DOM.inputQidWilayah.value);
  if (tipe === 'qid' && !wilayahQid) {
    appShowDialog(escHtml(msg('region-required')), 'alert', msg('dialog-attention'));
    DOM.inputQidWilayah?.focus();
    return;
  }

  const wilayahNama = tipe === 'provinsi'
    ? DOM.selectProvinsi.options[DOM.selectProvinsi.selectedIndex]?.text || ''
    : tipe === 'qid'
    ? DOM.inputQidWilayah.dataset.label || wilayahQid.slice(3)
    : tipe === 'luar_negeri'
    ? DOM.selectNegara.options[DOM.selectNegara.selectedIndex]?.text || ''
    : 'Indonesia';

  const params = {
    jenis, klasterNama, klasterLabel, klasterSlug, propLokasi, propTahun, useSubclass, wilayahNama,
    wilayah:   tipe === 'provinsi' ? 'provinsi' : tipe,
    // Q-ID wilayah bebas memakai jalur query yang sama dengan provinsi
    provQid:   tipe === 'provinsi' ? provQid : tipe === 'qid' ? wilayahQid : '',
    wilayahNegaraQid: tipe === 'qid' ? (DOM.inputQidWilayah.dataset.negara || '') : '',
    negaraQid: tipe === 'luar_negeri' ? negaraQid : '',
  };

  // Bawa konteks ke URL (bisa dibagikan) dan top nav
  const ctx = searchContext(params);
  if (ctx) {
    saveSearchContext(ctx);
    const q = new URLSearchParams(contextQuery(ctx));
    if (ctx.area) q.set('area_label', wilayahNama);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }

  // Reset state
  State.records    = {};
  State.sortedIds  = [];
  State.visibleIds = [];
  State.params     = params;
  State.mediaLoaded = false;

  State.abortCtrl?.abort();
  State.abortCtrl = new AbortController();
  State.stopCtrl  = new AbortController();
  State.partial   = false;
  State.missing   = { coords: [], media: [] };
  const signal = State.abortCtrl.signal;

  mapClear();
  resetHasilUI();
  showSection('hasil');

  // ===== CEK CACHE SESI =====
  const cacheKey = State.cacheKey = _cacheKey(params);
  const cached   = _loadCache(cacheKey);
  if (cached) {
    State.records     = cached.records;
    State.sortedIds   = cached.sortedIds;
    setMediaReady();
    finishBuildResults();
    Object.values(State.records).forEach(r => mapBuildMarker(r));
    syncMapMarkers({ force: true });
    mapFitAll();
    setLoadingStatus(null);
    return;
  }

  setLoadingStatus(msg('loading-category', klasterLabel, wilayahNama));

  try {
    // ===== FASE 1: Item + koordinat langsung dari SPARQL =====
    const queryFn = (limit, offset) => buildItemsQuery({ ...params, limit, offset });

    const fetched = await fetchAllPages(queryFn, signal, row => {
      const qid = row.SQ?.value;
      if (!qid) return;
      const pQid    = row.PQ?.value || null;
      const pLabel  = row.pLabel?.value || '';
      const lQid    = row.LQ?.value || null;
      const title   = row.sLabel?.value || qid;
      const yearStr = formatDate(row.tM?.value, row.tP?.value);

      let rec = State.records[qid];
      if (!rec) {
        rec = State.records[qid] = {
          id: qid, title,
          lokQid: lQid, lokLabel: row.lLabel?.value || '',
          provQid: null, provLabel: '',   // provinsi pertama (untuk teks ringkas)
          provQids: [], provLabels: [],   // semua provinsi: butir berlokasi banyak muncul di setiap filternya
          yearStr, year: yearOf(row.tM?.value),
        };
        State.sortedIds.push(qid);
      }
      if (pQid && !rec.provQids.includes(pQid)) {
        rec.provQids.push(pQid);
        rec.provLabels.push(pLabel);
        if (!rec.provQid) { rec.provQid = pQid; rec.provLabel = pLabel; }
      }
    }, total => {
      setLoadingStatus(msg('loading-category-count', klasterLabel, wilayahNama, total));
      // Tombol "Cukupkan" baru muncul bila data sudah cukup banyak
      if (total >= CUKUPKAN_MIN_DATA) $('cukupkan-wrap')?.classList.remove('hidden');
    }, { stopSignal: State.stopCtrl.signal, keepPartial: true });

    if (signal.aborted) return;

    const allQids = Object.keys(State.records);
    if (!fetched.complete) {
      State.partial = true;
      showPartialNote(fetched, allQids.length);
    }
    if (!allQids.length) {
      setLoadingStatus(null);
      DOM.searchInput && (DOM.searchInput.placeholder = msg('results-none'));
      $('hasil-empty')?.classList.remove('hidden');
      return;
    }

    // Render daftar — list muncul seketika, map masih kosong
    finishBuildResults();
    setLoadingStatus(null);

    // ===== FASE 2: Koordinat (bisa dihentikan; batch yang sudah masuk tetap dipakai) =====
    await loadCoordinates(allQids, signal, { fitMap: true });

    // ===== FASE 3: Media (background), sesuai urutan tampil: butir teratas dapat gambar lebih dulu =====
    loadMediaBackground([...State.sortedIds], signal);

  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Search error:', err);
    // Galat ditampilkan sebagai catatan, bukan di bar status yang berspinner
    setLoadingStatus(null);
    addNote(msg('search-error', err.message || msg('try-again')));
  }
}

/** Mulai langkah latar baru; tombol "Hentikan" di bar status menghentikan langkah ini saja. */
function startStep() {
  State.stepCtrl = new AbortController();
  return State.stepCtrl.signal;
}

/**
 * Tambah satu baris ke catatan kuning di atas hasil (hasil sebagian / galat).
 * `kind` 'coords' / 'media' menggantikan baris sebelumnya dari langkah yang sama (setelah "Coba lagi").
 */
function addNote(text, kind = 'main') {
  const note = $('hasil-partial-note');
  if (!note) return;
  if (kind !== 'main') removeNote(kind);
  const line = document.createElement('span');
  line.className = 'hasil-partial-line';
  line.dataset.kind = kind;
  line.textContent = text;
  note.insertBefore(line, note.querySelector('.hasil-retry'));
  note.classList.remove('hidden');
}

function removeNote(kind) {
  const note = $('hasil-partial-note');
  note?.querySelectorAll(`[data-kind="${kind}"]`).forEach(el => el.remove());
  if (note && !note.querySelector('.hasil-partial-line')) note.classList.add('hidden');
}

/** Tombol "Coba lagi" di catatan kuning: hanya bila ada butir yang koordinat/medianya belum termuat. */
function updateRetryButton() {
  const note = $('hasil-partial-note');
  if (!note) return;
  const n = new Set([...State.missing.coords, ...State.missing.media]).size;
  let btn = note.querySelector('.hasil-retry');
  if (!n) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hasil-retry';
    btn.addEventListener('click', retryMissing);
    note.appendChild(btn);
  }
  btn.disabled = false;
  btn.textContent = msg('partial-retry', n);
}

/** Muat ulang hanya butir yang koordinat / gambar-artikelnya belum termuat. */
async function retryMissing() {
  const signal = State.abortCtrl?.signal;
  if (!signal || signal.aborted) return;
  const btn = $('hasil-partial-note')?.querySelector('.hasil-retry');
  if (btn) btn.disabled = true;
  const { coords, media } = State.missing;
  try {
    if (coords.length) await loadCoordinates(coords, signal);
    if (media.length)  await loadMediaBackground(media, signal);
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('Retry failed:', e);
  }
}

/** Simpan ke cache sesi hanya bila semua data sudah lengkap. */
function maybeSaveCache() {
  if (State.partial || State.missing.coords.length || State.missing.media.length || !State.mediaLoaded) return;
  _saveCache(State.cacheKey, State.records, State.sortedIds);
}

/** Beri tahu bahwa hasil hanya sebagian, beserta alasannya. */
function showPartialNote(fetched, count) {
  addNote(fetched.reason === 'stopped'
    ? (count ? msg('partial-stopped', count) : msg('partial-stopped-empty'))
    : msg('partial-error', fetched.error?.message || msg('unknown'), count));
}

function resetHasilUI() {
  _listBuilt = false;
  $('hasil-empty')?.classList.add('hidden');
  const note = $('hasil-partial-note');
  if (note) { note.innerHTML = ''; note.classList.add('hidden'); }
  setLoadingStatus(null);
  $('cukupkan-wrap')?.classList.add('hidden');
  const btnCukup = $('btn-cukupkan');
  if (btnCukup) { btnCukup.disabled = false; btnCukup.textContent = msg('stop-search'); }
  if (DOM.hasilList) DOM.hasilList.innerHTML = '';
  if (DOM.filterWilayah) DOM.filterWilayah.innerHTML = `<option value="all">${escHtml(msg('filter-all-regions'))}</option>`;
  if (DOM.filterUrut) DOM.filterUrut.innerHTML = `
    <option value="nama">${escHtml(msg('sort-name'))}</option>
    <option value="wilayah">${escHtml(msg('sort-region'))}</option>
    <option value="tahun">${escHtml(msg('sort-year'))}</option>
  `;
  $('filter-header')?.classList.add('hidden');
  if (DOM.searchInput) { DOM.searchInput.value = ''; DOM.searchInput.placeholder = msg('search-counting'); }
  DOM.btnArtikel?.classList.add('loading');
  DOM.btnGambar?.classList.add('loading');
  State.filter = { wilayah: 'all', search: '', image: null, article: null };
  _mapSig = '';
  updateFilterButtons();
}

/** Ada saringan apa pun (wilayah, kata cari, gambar, artikel)? Bila tidak, tombol Semua aktif. */
function hasFilter() {
  const f = State.filter;
  return f.wilayah !== 'all' || !!f.search || !!f.image || !!f.article;
}

/** Siklus tombol Gambar/Artikel: lepas → Ada → Tanpa → lepas. */
const nextMediaFilter = state => state === null ? 'has' : state === 'has' ? 'without' : null;

/** Label, jumlah, dan status aktif tombol Semua / Artikel / Foto. Jumlah media = spinner selama dimuat. */
function updateFilterButtons() {
  const f   = State.filter;
  const all = State.sortedIds.map(id => State.records[id]);
  const setLabel = (btn, text, count, on) => {
    if (!btn) return;
    const badge = count === null
      ? '<span class="loader feature-btn-loader" aria-hidden="true"></span>'
      : `<span class="feature-btn-count">${escHtml(formatNumber(count))}</span>`;
    btn.innerHTML = `<span>${escHtml(text)}</span>${badge}`;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  const media = (btn, state, field, hasKey, withoutKey) => {
    // Jumlah tidak terpengaruh saringan lain agar angkanya tetap
    // Butir yang medianya belum termuat (undefined) tidak dihitung sebagai Ada maupun Tanpa
    const n = State.mediaLoaded
      ? all.filter(r => r[field] !== undefined && !!r[field] === (state !== 'without')).length : null;
    setLabel(btn, msg(state === 'without' ? withoutKey : hasKey), n, !!state);
  };
  setLabel(DOM.btnSemua, msg('filter-all'), all.length, !hasFilter());
  media(DOM.btnArtikel, f.article, 'articleTitle', 'filter-has-article', 'filter-no-article');
  media(DOM.btnGambar,  f.image,   'imageFilename', 'filter-has-photo',  'filter-no-photo');
}

// Data gambar/artikel tersedia → aktifkan tombol Artikel/Foto beserta jumlahnya
function setMediaReady() {
  State.mediaLoaded = true;
  DOM.btnArtikel?.classList.remove('loading');
  DOM.btnGambar?.classList.remove('loading');
  updateFilterButtons();
}

/**
 * Koordinat untuk `qids`, lalu tambahkan titiknya ke peta. Butir yang batchnya gagal / dihentikan
 * dicatat di State.missing.coords agar bisa dicoba lagi. Melempar AbortError bila pencarian diganti.
 */
async function loadCoordinates(qids, signal, { fitMap = false } = {}) {
  const { klasterNama, klasterLabel, propLokasi } = State.params;
  const res = await fetchCoordinates(qids.map(q => `wd:${q}`), klasterNama, propLokasi, signal, {
    stopSignal: startStep(),
    onProgress: pct => setLoadingStatus(msg('loading-coordinates', klasterLabel, pct)),
  });
  Object.entries(res.coords).forEach(([q, c]) => {
    const r = State.records[q];
    if (!r || r.lat !== undefined) return;
    r.lat = c.lat; r.lon = c.lon;
    mapBuildMarker(r);
  });
  syncMapMarkers({ force: true });
  if (fitMap) mapFitAll();
  setLoadingStatus(null);

  State.missing.coords = res.missing.map(stripWd);
  const n = State.missing.coords.length;
  if (!n) removeNote('coords');
  else addNote(res.reason === 'stopped'
    ? msg('partial-coords-stopped', n)
    : msg('partial-coords-error', res.error?.message || msg('unknown'), n), 'coords');
  updateRetryButton();
  maybeSaveCache();
}

const stripWd = q => q.replace(/^wd:/, '');

async function loadMediaBackground(qids, signal) {
  try {
    const res = await fetchMedia(qids.map(q => `wd:${q}`), signal, {
      stopSignal: startStep(),
      onProgress: pct => setLoadingStatus(msg('loading-media', pct)),
    });
    Object.entries(res.media).forEach(([qid, m]) => {
      const r = State.records[qid];
      if (!r) return;
      Object.assign(r, m);
      mapRefreshMarkerIcon(r);
    });
    refreshListThumbs();
    const wasLoaded = State.mediaLoaded;
    setMediaReady();
    setLoadingStatus(null);
    // Coba lagi saat saringan Foto/Artikel aktif → butir yang baru termuat ikut tersaring
    if (wasLoaded && (State.filter.image || State.filter.article)) {
      applyFilter();
      syncMapMarkers({ force: true });
    }

    // Butir yang tidak termuat tetap `undefined` (belum diketahui), bukan null (memang tidak ada)
    State.missing.media = res.missing.map(stripWd).filter(q => State.records[q]?.imageFilename === undefined);
    const n = State.missing.media.length;
    if (!n) removeNote('media');
    else addNote(res.reason === 'stopped'
      ? msg('partial-media-stopped', n)
      : msg('partial-media-error', res.error?.message || msg('unknown'), n), 'media');
    updateRetryButton();
    maybeSaveCache();
  } catch (e) {
    // AbortError = pencarian sudah diganti: jangan sentuh tampilan atau cache pencarian baru
    if (e.name === 'AbortError') return;
    console.warn('Media load failed:', e);
    setLoadingStatus(null);
  }
}

// ---------------------------------------------------------------------------
// BUILD & RENDER RESULTS
// ---------------------------------------------------------------------------
// Hasil dimuat bertahap saat digulir agar daftar ribuan butir tetap ringan
const LOAD_STEP = 40;
let _listObserver = null;  // mengamati penanda di bawah daftar (#hasil-end)

/** Dipanggil setelah FASE 1 selesai — sort + render list + isi filter wilayah */
function finishBuildResults() {
  _listBuilt = true;
  const allIds = State.sortedIds; // sudah diisi saat row masuk

  // Populasi filter wilayah (semua provinsi tiap butir)
  const provMap = {};
  allIds.forEach(q => {
    const r = State.records[q];
    r.provQids.forEach((p, i) => { if (r.provLabels[i]) provMap[p] = r.provLabels[i]; });
  });
  const provOpts = Object.entries(provMap)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`)
    .join('');
  if (DOM.filterWilayah)
    DOM.filterWilayah.innerHTML = `<option value="all">${escHtml(msg('filter-all-regions'))}</option>` + provOpts;

  // Kotak cari & filter baru muncul setelah ada data yang bisa disaring
  $('filter-header')?.classList.remove('hidden');
  applySort(DOM.filterUrut?.value || 'nama');
}

function applyFilter() {
  const { wilayah, image, article, search } = State.filter;
  const q = search.toLowerCase();

  State.visibleIds = State.sortedIds.filter(id => {
    const r = State.records[id];
    if (wilayah !== 'all' && !r.provQids.includes(wilayah)) return false;
    if (image   && (r.imageFilename === undefined || !!r.imageFilename !== (image === 'has')))  return false;
    if (article && (r.articleTitle  === undefined || !!r.articleTitle  !== (article === 'has'))) return false;
    if (q && ![r.title, r.lokLabel, ...r.provLabels].some(t => t?.toLowerCase().includes(q))) return false;
    return true;
  });

  renderList();
  updateSearchPlaceholder();
  updateFilterButtons();
  // Peta menyusul sedikit kemudian: mengetik di kotak cari tidak membangun ulang marker per huruf
  clearTimeout(_mapSyncTimer);
  _mapSyncTimer = setTimeout(syncMapMarkers, 150);
}

let _mapSyncTimer = null;
let _mapSig = '';

/**
 * Peta hanya menampilkan butir yang lolos saringan, sama dengan daftar.
 * Dilewati bila saringan dan jumlah marker tidak berubah (mis. hanya urutan yang berganti);
 * `force` bila isinya bisa berubah dengan jumlah yang sama (marker baru, media baru termuat).
 */
function syncMapMarkers({ force = false } = {}) {
  clearTimeout(_mapSyncTimer);
  const markers = State.visibleIds.map(id => State.records[id]?.marker).filter(Boolean);
  const sig = `${JSON.stringify(State.filter)}|${markers.length}`;
  if (!force && sig === _mapSig) return;
  _mapSig = sig;
  mapSetMarkers(markers);
}

/** Render ulang daftar dari awal; butir berikutnya ditambahkan saat pengguna menggulir ke bawah. */
function renderList() {
  if (!DOM.hasilList) return;
  // Galeri hanya untuk "Ada foto"; selain itu daftar
  DOM.hasilList.className = State.filter.image === 'has' ? 'result-grid' : 'result-list';
  DOM.hasilList.innerHTML = '';
  State.shown = 0;
  appendItems(LOAD_STEP);
}

/** Tambah `count` butir berikutnya di bawah daftar. */
function appendItems(count) {
  const isGrid = State.filter.image === 'has';
  const end = Math.min(State.shown + count, State.visibleIds.length);
  for (let i = State.shown; i < end; i++) {
    if (isGrid) renderGridItem(State.visibleIds[i], i);
    else        renderListItem(State.visibleIds[i], i);
  }
  State.shown = end;
  updateListEnd();
}

/** Penanda di bawah daftar: "1–40 dari 694" selama masih ada lanjutan, lalu total di akhir. */
function updateListEnd() {
  const el = $('hasil-end');
  if (!el) return;
  const n = State.visibleIds.length, t = State.sortedIds.length;
  el.classList.toggle('hidden', !n);
  el.textContent = State.shown < n ? msg('results-range', 1, State.shown, n)
    : n === t ? msg('results-count', n) : msg('search-filtered', n, t);
  // Amati ulang: bila penanda masih terlihat setelah butir ditambah, observer terpanggil lagi
  if (_listObserver) {
    _listObserver.unobserve(el);
    if (State.shown < n) _listObserver.observe(el);
  }
}

/** Kembali dari detail: pastikan butir yang terakhir dibuka sudah dirender, lalu gulir ke sana. */
function revealCurrentItem() {
  const i = State.currentIndex;
  if (i < 0 || !_listBuilt) return;
  if (i >= State.shown) appendItems(i + 1 - State.shown);
  const item = DOM.hasilList?.querySelector(`[data-index="${i}"]`);
  const box  = DOM.sections.hasil;
  if (!item || !box) return;
  // Gulir daftarnya saja. scrollIntoView ikut menggulir pembungkus ber-overflow:hidden (#app-body) bila
  // butir tidak bisa ditengahkan, sehingga panel HP bergeser dan tidak bisa diusap tutup lagi.
  const offset = item.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTop += offset - (box.clientHeight - item.offsetHeight) / 2;
}

function renderListItem(qid, index) {
  const r = State.records[qid];
  if (!r || !DOM.hasilList) return;

  const li = document.createElement('li');
  li.className = 'result-list__item';
  li.dataset.qid = qid;
  li.dataset.index = index;

  const sub = [r.lokLabel || r.provLabel, r.yearStr].filter(Boolean).join(' · ');
  const thumb = r.imageFilename
    ? `<img class="result-thumb" src="${commonsFileUrl(r.imageFilename, 120)}" alt="" loading="lazy">`
    : `<span class="result-thumb result-thumb--empty" aria-hidden="true"></span>`;

  li.innerHTML = `
    <span class="result-list__link">
      ${thumb}
      <span class="result-list__text">
        <span class="result-list__title">${escHtml(r.title)}</span>
        ${sub ? `<span class="result-list__sub">${escHtml(sub)}</span>` : ''}
      </span>
    </span>`;

  li.addEventListener('click', () => openDetail(index));
  DOM.hasilList.appendChild(li);
}

function renderGridItem(qid, index) {
  const r = State.records[qid];
  if (!r || !DOM.hasilList) return;

  const li = document.createElement('li');
  li.className = 'result-grid__item';
  li.dataset.qid = qid;
  li.dataset.index = index;

  const sub = [r.lokLabel || r.provLabel, r.yearStr].filter(Boolean).join(' · ');
  const isRawQid = /^Q\d+$/.test(r.title);
  const displayTitle = isRawQid ? r.id : r.title;

  li.innerHTML = `
    <img class="result-grid__img" src="${commonsFileUrl(r.imageFilename, 300)}"
         alt="${escHtml(displayTitle)}" loading="lazy">
    <div class="result-grid__overlay">
      <span class="result-grid__title">${escHtml(displayTitle)}</span>
      ${sub ? `<span class="result-grid__sub">${escHtml(sub)}</span>` : ''}
    </div>`;

  li.addEventListener('click', () => openDetail(index));
  DOM.hasilList.appendChild(li);
}

/** Foto selesai dimuat setelah daftar tampil: isi gambar kecil tanpa merender ulang daftar. */
function refreshListThumbs() {
  DOM.hasilList?.querySelectorAll('.result-list__item').forEach(li => {
    const r = State.records[li.dataset.qid];
    const empty = li.querySelector('.result-thumb--empty');
    if (r?.imageFilename && empty) {
      empty.outerHTML = `<img class="result-thumb" src="${commonsFileUrl(r.imageFilename, 120)}" alt="" loading="lazy">`;
    }
  });
}

/** Placeholder kotak cari sekaligus penanda pencarian: "Cari di 694 Masjid di Sumatera Barat…". */
function updateSearchPlaceholder() {
  if (!DOM.searchInput) return;
  const n = State.visibleIds.length, t = State.sortedIds.length;
  DOM.searchInput.placeholder = n === t
    ? msg('search-in-results', t, State.params?.klasterLabel || '', State.params?.wilayahNama || '')
    : msg('search-filtered', n, t);
}

// ---------------------------------------------------------------------------
// SORT
// ---------------------------------------------------------------------------
function applySort(key) {
  State.sortedIds.sort((a, b) => {
    const ra = State.records[a], rb = State.records[b];
    if (key === 'tahun') {
      const d = (ra.year ?? 9999) - (rb.year ?? 9999);
      if (d) return d;
    }
    if (key === 'wilayah') {
      // Abjad lokasi spesifik (Aceh, Alor, Ambon, Anyer…), bukan provinsinya
      const c = (ra.lokLabel || ra.provLabel || '').localeCompare(rb.lokLabel || rb.provLabel || '');
      if (c) return c;
    }
    return (ra.title || '').localeCompare(rb.title || '');
  });
  applyFilter();
}

// ---------------------------------------------------------------------------
// DETAIL PANEL
// ---------------------------------------------------------------------------
function openDetail(index) {
  const qid = State.visibleIds[index];
  if (!qid) return;
  State.currentIndex = index;
  renderDetail(qid);
  showSection('detail');
  mapFlyTo(State.records[qid]);
  updateDetailNav();
}

/** URL masuk yang kembali ke halaman ini (beserta pencariannya) setelah login. */
const loginUrl = () => `/oauth/login?next=${encodeURIComponent(location.pathname + location.search)}`;

const ICON_EXT = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';

function renderDetail(qid) {
  const r = State.records[qid];
  const el = DOM.sections.detail;
  if (!r || !el) return;

  const encodedFilename = r.imageFilename ? encodeURIComponent(r.imageFilename) : null;

  const mediaReady = r.imageFilename !== undefined;
  const imgFigure = r.imageFilename
    ? `<figure class="detail-figure">
        <img src="${commonsFileUrl(r.imageFilename, 800)}"
             alt="${escHtml(r.title)}"
             class="detail-img js-lightbox-trigger"
             loading="lazy">
        <figcaption id="img-caption-${escHtml(qid)}" class="detail-caption">${escHtml(msg('loading'))}</figcaption>
       </figure>`
    : !mediaReady
    ? `<div class="detail-media-skeleton">
         <div class="loader loader--small"></div>
       </div>`
    : `<div class="detail-no-image" id="no-image-zone-${escHtml(qid)}">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" opacity=".35" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        <span>${escHtml(msg('detail-no-photo'))}</span>
        ${APP_USER
          ? `<div class="no-image-btns">
               <button class="btn btn--primary btn--sm upload-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↑ ${escHtml(msg('detail-upload-photo'))}</button>
               <button class="btn btn--secondary btn--sm link-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↗ ${escHtml(msg('detail-link-photo'))}</button>
             </div>`
          : `<a href="${loginUrl()}" class="btn btn--secondary btn--sm">${escHtml(msg('detail-login-to-upload'))}</a>`}
       </div>`;

  const kategoriNama  = State.params?.klasterLabel || '';
  const isRawQid      = /^Q\d+$/.test(r.title);
  const createWikiUrl = `${WIKI_BASE}/w/index.php?title=${encodeURIComponent(r.title)}&action=edit`;
  const sub = [r.lokLabel || r.provLabel, r.yearStr].filter(Boolean).join(' · ');

  // Catatan bila belum ada artikel Wikipedia / belum ada label
  const articleNote = r.articleTitle ? ''
    : isRawQid
    ? `<p class="detail-callout">
         ${escHtml(msg('detail-no-label'))}
         <a href="https://www.wikidata.org/wiki/${escHtml(r.id)}" target="_blank" rel="noopener">${escHtml(msg('detail-complete-wikidata'))} →</a>
       </p>`
    : r.articleTitle === null
    ? `<p class="detail-callout">
         ${msgHtml('detail-no-article', { html: `<em>${escHtml(kategoriNama || msg('detail-article'))}</em>` })}
         <a href="${createWikiUrl}" target="_blank" rel="noopener">${escHtml(msg('detail-add-article'))}</a>
       </p>`
    : '';

  const counter = State.currentIndex >= 0 ? `${State.currentIndex + 1} / ${State.visibleIds.length}` : '';

  el.innerHTML = `
    <div class="detail-panel">

      <div class="detail-nav panel-nav">
        <button class="back-link" id="btn-kembali-detail">← ${escHtml(msg('detail-back'))}</button>
        <div class="panel-nav-actions">
          ${counter ? `<div class="detail-pager">
            <button class="icon-btn" id="btn-prev" type="button" aria-label="${escHtml(msg('panel-previous'))}" title="${escHtml(msg('panel-previous'))}">‹</button>
            <span class="detail-back-counter">${counter}</span>
            <button class="icon-btn" id="btn-next" type="button" aria-label="${escHtml(msg('panel-next'))}" title="${escHtml(msg('panel-next'))}">›</button>
          </div>` : ''}
        </div>
      </div>

      <h2 class="detail-title${isRawQid ? ' detail-title--unlabeled' : ''}">
        ${isRawQid ? `<span class="detail-title-qid">${escHtml(r.id)}</span><span class="detail-title-nolabel"> — ${escHtml(msg('detail-unlabeled'))}</span>` : escHtml(r.title)}
      </h2>
      ${sub ? `<p class="detail-subtitle">${escHtml(sub)}</p>` : ''}

      <div class="detail-media">${imgFigure}</div>

      <div id="detail-excerpt-${escHtml(qid)}" class="detail-excerpt">
        ${(r.articleTitle || r.articleTitle === undefined) ? `<p class="detail-excerpt-loading">${escHtml(msg('detail-loading-excerpt'))}</p>` : ''}
      </div>
      ${articleNote}

      <div class="detail-links" id="detail-links-${escHtml(qid)}">${detailLinksHtml(qid)}</div>

      <section class="detail-section">
        <div class="detail-section-head">
          <h3>${escHtml(msg('detail-data-title'))}</h3>
        </div>
        <div id="detail-dynprops-${escHtml(qid)}">
          <p class="detail-excerpt-loading">${escHtml(msg('detail-loading'))}</p>
        </div>
      </section>

      <section class="detail-section hidden" id="detail-gallery-${escHtml(qid)}"></section>

    </div>`;

  const backToResults = () => { mapShowShape(null); showSection('hasil'); revealCurrentItem(); };
  el.querySelector('#btn-kembali-detail')?.addEventListener('click', backToResults);
  el.querySelector('#btn-prev')?.addEventListener('click', () => {
    if (State.currentIndex > 0) openDetail(State.currentIndex - 1);
  });
  el.querySelector('#btn-next')?.addEventListener('click', () => {
    if (State.currentIndex < State.visibleIds.length - 1) openDetail(State.currentIndex + 1);
  });

  el.querySelector('.js-lightbox-trigger')
    ?.addEventListener('click', () => openLightbox(r.imageFilename));

  el.querySelector('.upload-foto-btn')
    ?.addEventListener('click', e => openUploadModal(e.currentTarget.dataset.qid, e.currentTarget.dataset.title));

  el.querySelector('.link-foto-btn')
    ?.addEventListener('click', e => openLinkPhotoModal(e.currentTarget.dataset.qid, e.currentTarget.dataset.title));

  if (r.imageFilename) loadCaption(qid);
  if (r.articleTitle)  loadExcerpt(qid);
  loadDetailProps(qid);
  if (!mediaReady)     loadSingleItemMedia(qid);
  // Jenis gambar yang sesuai butir disiapkan lebih awal, sebelum modal unggah / tautkan dibuka
  if (APP_USER)        loadImageProps(qid).catch(() => {});

  // OSM shape
  if (!r._osmTriggered && r.lat) {
    r._osmTriggered = true;
    fetchOsmShape(qid, State.abortCtrl?.signal)
      .then(geo => mapShowShape(geo))
      .catch(() => {});
  } else {
    mapShowShape(null);
  }
}

/** Tautan ke proyek Wikimedia; galeri Commons & WikiBuku baru ada setelah data detail dimuat. */
function detailLinksHtml(qid) {
  const r = State.records[qid];
  const d = r._detail;
  const linkChip = (href, icon, label) =>
    `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="link-chip">
       <img src="/static/img/${icon}" alt="" width="16" height="16"><span>${escHtml(label)}</span>${ICON_EXT}
     </a>`;
  return [
    r.articleTitle && linkChip(`${WIKI_BASE}/wiki/${encodeURIComponent(r.articleTitle)}`, 'wikipedia_tiny_logo.png', msg('detail-read-wikipedia')),
    linkChip(`https://www.wikidata.org/wiki/${qid}`, 'wikidata_tiny_logo.png', msg('detail-view-wikidata')),
    d?.commonsCat && linkChip(`https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(d.commonsCat)}`, 'wikicommons_tiny_logo.png', msg('detail-gallery')),
    d?.wikibooks && linkChip(d.wikibooks, 'wikibook_tiny_logo.png', msg('detail-view-wikibooks')),
  ].filter(Boolean).join('');
}

// ---------------------------------------------------------------------------
// DETAIL ATRIBUT PER KATEGORI (skema: SKEMA_KATEGORI di wikidata.js)
// ---------------------------------------------------------------------------
const INPUT_PLACEHOLDER = {
  item:     msg('input-placeholder-item'),
  quantity: msg('input-placeholder-quantity'),
  time:     msg('input-placeholder-time'),
  url:      'https://...',
  string:   '',
};

function renderDynPropsHtml(qid, detail, klasterNama = '') {
  const r    = State.records[qid];
  const row  = (key, valHtml) =>
    `<li class="detail-data-row"><span class="detail-info-key">${escHtml(key)}</span><span class="detail-info-val">${valHtml}</span></li>`;
  const items = [];

  const prov = r?.provLabels?.length ? r.provLabels.join(', ') : r?.provLabel;
  if (prov) items.push(row(msg('region-label'), escHtml(prov)));
  if (detail.tipe) {
    const tipe = detail.tipe.split(', ').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
    items.push(row(msg('detail-type'), escHtml(tipe)));
  }

  const skema = skemaKategori(klasterNama);
  skema.forEach(attr => {
    const v = detail.values[attr.pid];
    if (!v) { items.push(renderEmptyPropRow(attr)); return; }
    const val = v.url && /^https?:\/\//i.test(v.url)
      ? `<a href="${escHtml(v.url)}" target="_blank" rel="noopener" class="break-all">${escHtml(v.text)}</a>`
      : escHtml(v.text);
    items.push(row(attr.label, val));
  });

  // Properti tambahan pengguna untuk butir ini (di luar skema kategori).
  // attr.more = nilai kedua dst. untuk properti yang sudah terisi (PROP_MULTI_VALUE)
  (detail.extra || []).forEach(attr => {
    const v = attr.more ? null : attr.saved || detail.values[attr.pid];
    items.push(v ? row(attr.label, v.url ? `<a href="${escHtml(v.url)}" target="_blank" rel="noopener" class="break-all">${escHtml(v.text)}</a>` : escHtml(v.text))
                 : renderEmptyPropRow(attr));
  });

  let html = `<ul class="detail-data">${items.join('')}</ul>`;

  if (APP_USER) {
    html += `<div class="add-prop">
      <button type="button" class="link-btn js-add-prop-open">+ ${escHtml(msg('detail-add-property'))}</button>
      <div class="add-prop-box hidden">
        <div class="prop-edit-field add-prop-field">
          <input type="text" class="form-input form-input--sm js-add-prop-input" autocomplete="off" spellcheck="false"
                 placeholder="${escHtml(msg('detail-add-property-placeholder'))}" aria-label="${escHtml(msg('detail-add-property'))}">
          <ul class="prop-suggest add-prop-list hidden" role="listbox"></ul>
        </div>
        <button type="button" class="prop-cancel-btn js-add-prop-close" aria-label="${escHtml(msg('button-cancel'))}" title="${escHtml(msg('button-cancel'))}">✕</button>
      </div>
    </div>`;
  }

  const nAll = Object.keys(otherClaims(qid)).length;
  if (nAll) {
    html += `<details class="detail-all">
      <summary>${escHtml(msg('detail-all-data', nAll))}</summary>
      <div class="detail-all-body"><p class="detail-excerpt-loading">${escHtml(msg('loading'))}</p></div>
    </details>`;
  }

  return html;
}

function renderEmptyPropRow(attr) {
  const inputType = { quantity: 'number', url: 'url' }[attr.type] || 'text';
  const extraAttr = attr.type === 'quantity' ? ' step="any"' : '';
  const unitText  = attr.type === 'quantity' && !attr.units?.length ? (attr.unitLabel || attr.suffix || '') : '';
  // Properti tambahan bertipe angka: satuan dipilih dari satuan yang diizinkan properti itu
  const unitSelect = attr.units?.length
    ? `<select class="form-select form-select--sm prop-unit-select" aria-label="${escHtml(msg('detail-unit'))}">
        ${attr.units.map(u => `<option value="${escHtml(u.id)}">${escHtml(u.label)}</option>`).join('')}
      </select>` : '';
  return `<li class="detail-data-row detail-prop-empty-row" data-pid="${escHtml(attr.pid)}">
    <span class="detail-info-key">${escHtml(attr.label)}</span>
    <span class="detail-info-val">
      <span class="prop-empty-badge">${escHtml(msg(attr.more ? 'detail-new-value' : 'detail-empty-value'))}</span>
      ${APP_USER ? `<span class="prop-actions">
        <button class="js-prop-pencil prop-add-btn" type="button" title="${escHtml(msg('prop-add'))}">${escHtml(msg('detail-add-manual'))}</button>
        ${attr.more ? '' : `<button class="js-prop-ai prop-add-btn prop-add-btn--ai" type="button" title="${escHtml(msg('detail-ai-title'))}">✨ AI</button>`}
      </span>`
      // Tamu: tombol Isi tetap terlihat, tetapi mengarah ke halaman masuk; tanpa tombol AI
      : `<a href="${loginUrl()}" class="prop-add-btn" title="${escHtml(msg('detail-login-to-fill'))}">${escHtml(msg('detail-add-manual'))}</a>`}
      <span class="prop-edit-inline hidden">
        <span class="prop-edit-field">
          <input type="${inputType}" class="form-input prop-edit-input"
                 placeholder="${escHtml(INPUT_PLACEHOLDER[attr.type] || '')}" autocomplete="off"${extraAttr}
                 aria-label="${escHtml(attr.label)}">
          ${attr.type === 'item' ? '<ul class="prop-suggest hidden" role="listbox"></ul>' : ''}
        </span>
        ${unitText ? `<span class="prop-edit-unit">${escHtml(unitText)}</span>` : ''}${unitSelect}
        <button class="prop-save-btn" type="button" title="${escHtml(msg('button-save'))}" aria-label="${escHtml(msg('button-save'))}">✓</button>
        <button class="prop-cancel-btn" type="button" title="${escHtml(msg('button-cancel'))}" aria-label="${escHtml(msg('button-cancel'))}">✕</button>
      </span>
    </span>
    <div class="ai-slot hidden" aria-live="polite"></div>
  </li>`;
}

async function loadDetailProps(qid) {
  const r = State.records[qid];
  if (!r || !$(`detail-dynprops-${qid}`)) return;

  try {
    if (!r._detail) {
      r._detail = await fetchDetailProps(qid, State.params?.klasterNama || '', State.abortCtrl?.signal);
    }
    renderDetailProps(qid);
  } catch (err) {
    if (err.name === 'AbortError') return;
    const el = $(`detail-dynprops-${qid}`);
    if (el) el.innerHTML = `<p class="detail-excerpt-loading">${escHtml(msg('detail-load-failed'))}</p>`;
  }
}

function renderDetailProps(qid) {
  const r  = State.records[qid];
  const el = $(`detail-dynprops-${qid}`);
  if (!el || !r?._detail) return;
  el.innerHTML = renderDynPropsHtml(qid, r._detail, State.params?.klasterNama || '');
  const links = $(`detail-links-${qid}`);
  if (links) links.innerHTML = detailLinksHtml(qid);
  renderDetailGallery(qid);
  attachPropEditHandlers(qid, el);
  attachAddProperty(qid, el);
  el.querySelector('.detail-all')?.addEventListener('toggle', e => renderAllData(qid, e.currentTarget), { once: true });
}

/** Sorot sebentar baris yang baru tersimpan agar terlihat apa yang berubah (baris dicari lewat labelnya). */
function flashSavedRow(qid, label) {
  $(`detail-dynprops-${qid}`)?.querySelectorAll('.detail-data-row').forEach(row => {
    if (row.querySelector('.detail-info-key')?.textContent !== label) return;
    row.classList.add('detail-data-row--saved');
    setTimeout(() => row.classList.remove('detail-data-row--saved'), 2500);
  });
}

/** Atribut yang tampil di panel detail: skema kategori + properti tambahan butir ini. */
function detailAttrs(qid) {
  return skemaKategori(State.params?.klasterNama || '').concat(State.records[qid]?._detail?.extra || []);
}

/** Satuan pilihan pengguna (dropdown satuan properti tambahan) → atribut. */
function applyUnitChoice(attr, li) {
  const sel = li?.querySelector('.prop-unit-select');
  if (!sel || !attr.units) return;
  const u = attr.units.find(x => x.id === sel.value);
  if (u) { attr.unit = u.id; attr.unitLabel = u.label; }
}

// ---------------------------------------------------------------------------
// TAMBAH DATA LAIN — properti Wikidata di luar skema kategori, hanya untuk butir ini
// ---------------------------------------------------------------------------
/** Label properti Wikidata ditulis huruf kecil; samakan dengan label skema. */
const ucFirst = t => t ? t.charAt(0).toLocaleUpperCase(I18N.lang) + t.slice(1) : t;

// meter, meter persegi, kilometer, kilogram, hektare, kilometer persegi, detik
const PREFERRED_UNITS = ['Q11573', 'Q25343', 'Q828224', 'Q11570', 'Q35852', 'Q712226', 'Q11574'];

function attachAddProperty(qid, container) {
  const wrap = container.querySelector('.add-prop');
  if (!wrap) return;
  const box   = wrap.querySelector('.add-prop-box');
  const open  = wrap.querySelector('.js-add-prop-open');
  const input = wrap.querySelector('.js-add-prop-input');
  const list  = wrap.querySelector('.add-prop-list');
  const r = State.records[qid];
  let results = [], timer = null, ctrl = null, suggested = null;

  // Properti yang sudah ada di butir atau sudah tampil di panel tidak ditawarkan lagi,
  // kecuali PROP_MULTI_VALUE yang sudah terisi (boleh punya beberapa nilai) dan belum sedang ditambah
  const hasValue = pid => !!(r._detail.claims?.[pid] || r._detail.values[pid]);
  const taken = () => {
    const ids = new Set([...Object.keys(r._detail.claims || {}), ...detailAttrs(qid).map(a => a.pid)]);
    PROP_MULTI_VALUE.forEach(pid => {
      const pending = (r._detail.extra || []).some(a => a.pid === pid && a.more);
      if (hasValue(pid) && !pending) ids.delete(pid);
    });
    return ids;
  };

  const render = (items, heading) => {
    // Properti yang belum bisa disunting di sini ditaruh paling bawah
    const avail = items.filter(p => !taken().has(p.id)).sort((a, b) => !a.type - !b.type);
    results = avail;
    list.innerHTML = (heading && avail.length ? `<li class="combo-group" role="presentation">${escHtml(heading)}</li>` : '')
      + (avail.length ? avail.map((p, i) => `
        <li class="prop-suggest-item${p.type ? '' : ' prop-suggest-item--disabled'}" role="option" data-index="${i}"
            aria-disabled="${!p.type}">
          <span class="prop-suggest-label">${escHtml(p.label)}</span>
          <span class="prop-suggest-qid">${escHtml(p.id)}</span>
          ${p.type ? '' : `<span class="prop-suggest-qid">· ${escHtml(msg('detail-add-property-unsupported'))}</span>`}
          ${p.description ? `<span class="prop-suggest-desc">${escHtml(p.description)}</span>` : ''}
        </li>`).join('')
      : `<li class="prop-suggest-empty">${escHtml(msg('detail-add-property-none'))}</li>`);
    list.classList.remove('hidden');
  };

  const showSuggested = async () => {
    list.innerHTML = `<li class="prop-suggest-empty">${escHtml(msg('loading'))}</li>`;
    list.classList.remove('hidden');
    try { suggested ??= await suggestProperties(qid); } catch { suggested = []; }
    if (!input.value.trim()) render(suggested, msg('detail-add-property-suggested'));
  };

  const close = () => {
    box.classList.add('hidden');
    open.classList.remove('hidden');
    list.classList.add('hidden');
    input.value = '';
  };

  open.addEventListener('click', () => {
    open.classList.add('hidden');
    box.classList.remove('hidden');
    input.focus();
    showSuggested();
  });
  wrap.querySelector('.js-add-prop-close').addEventListener('click', close);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) { if (!term) showSuggested(); return; }
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try { render(await searchProperties(term, ctrl.signal)); } catch (err) { if (err.name !== 'AbortError') list.classList.add('hidden'); }
    }, 250);
  });

  // mousedown agar input tidak kehilangan fokus sebelum pilihan tercatat
  list.addEventListener('mousedown', async e => {
    const li = e.target.closest('.prop-suggest-item');
    if (!li) return;
    e.preventDefault();
    const p = results[+li.dataset.index];
    if (!p?.type) return;
    const attr = { pid: p.id, label: ucFirst(p.label), type: p.type, unit: '', unitLabel: '', extra: true, more: hasValue(p.id) };
    if (p.type === 'quantity') {
      list.innerHTML = `<li class="prop-suggest-empty">${escHtml(msg('loading'))}</li>`;
      try { attr.units = await fetchPropertyUnits(p.id); } catch { attr.units = []; }
      // Satuan bawaan: satuan SI yang umum bila diizinkan, selain itu satuan pertama
      const u = attr.units.find(x => PREFERRED_UNITS.includes(x.id)) || attr.units[0];
      if (u) {
        attr.units = [u, ...attr.units.filter(x => x !== u)];
        attr.unit = u.id;
        attr.unitLabel = u.label;
      }
    }
    (r._detail.extra ||= []).push(attr);
    renderDetailProps(qid);
    // Langsung buka isian properti baru
    $(`detail-dynprops-${qid}`)?.querySelector(`.detail-prop-empty-row[data-pid="${CSS.escape(p.id)}"] .js-prop-pencil`)?.click();
  });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
  input.addEventListener('focus', () => { if (!input.value.trim()) showSuggested(); });
}

// Properti yang boleh diberi nilai tambahan walau sudah terisi (server: MULTI_VALUE_PROPS di api/routes.py):
// terbuat dari, teknik pembuatan, bagian dari, status warisan budaya
const PROP_MULTI_VALUE = new Set(['P186', 'P2079', 'P361', 'P1435']);

// Properti gambar untuk "Data Gambar" dan pilihan jenis gambar saat unggah / tautkan
// (sama dengan IMAGE_PROPS di api/routes.py)
const IMAGE_PROPS = ['P18', 'P5775', 'P1442', 'P1766', 'P1801', 'P3451', 'P9721', 'P12565', 'P8592'];

/**
 * Data Gambar: gambar lain milik butir (P18 selain foto utama + properti gambar lain yang ada isinya),
 * diakhiri kotak "Tambah data foto". Jenis yang tidak ada isinya tidak ditampilkan.
 */
function renderDetailGallery(qid) {
  const el = $(`detail-gallery-${qid}`);
  const r  = State.records[qid];
  if (!el || !r?._detail) return;

  const items = IMAGE_PROPS.flatMap(pid => (r._detail.claims[pid] || [])
    .filter(c => c.rank !== 'deprecated' && typeof c.mainsnak.datavalue?.value === 'string')
    .map(c => ({ pid, file: c.mainsnak.datavalue.value })))
    .filter(it => !(it.pid === 'P18' && sameCommonsFile(it.file, r.imageFilename)));

  const addBox = APP_USER
    ? `<div class="detail-gallery-add">
         <span>${escHtml(msg('detail-gallery-add'))}</span>
         <button type="button" class="btn btn--primary btn--sm js-gallery-upload" title="${escHtml(msg('detail-upload-photo'))}">↑ ${escHtml(msg('detail-gallery-upload'))}</button>
         <button type="button" class="btn btn--secondary btn--sm js-gallery-link" title="${escHtml(msg('detail-link-photo'))}">↗ ${escHtml(msg('detail-gallery-link'))}</button>
       </div>`
    : `<div class="detail-gallery-add">
         <span>${escHtml(msg('detail-gallery-add'))}</span>
         <a href="${loginUrl()}" class="btn btn--secondary btn--sm" title="${escHtml(msg('detail-login-to-upload'))}">${escHtml(msg('nav-login'))}</a>
       </div>`;

  el.innerHTML = `
    <div class="detail-section-head"><h3>${escHtml(msg('detail-gallery-title'))}</h3></div>
    <ul class="detail-gallery">
      ${items.map(it => `<li>
        <button type="button" class="detail-gallery-item js-gallery-open" data-file="${escHtml(it.file)}"
                title="${escHtml(it.file)}">
          <img src="${commonsFileUrl(it.file, 240)}" alt="" loading="lazy">
          <span class="detail-gallery-label">${escHtml(msg(`image-prop-${it.pid}`))}</span>
        </button>
      </li>`).join('')}
      <li>${addBox}</li>
    </ul>`;
  el.classList.remove('hidden');

  el.querySelectorAll('.js-gallery-open').forEach(btn =>
    btn.addEventListener('click', () => openLightbox(btn.dataset.file)));
  // Dari Data Gambar: jenis gambar dipilih sendiri (tanpa bawaan)
  el.querySelector('.js-gallery-upload')?.addEventListener('click', () => openUploadModal(qid, r.title, ''));
  el.querySelector('.js-gallery-link')?.addEventListener('click', () => openLinkPhotoModal(qid, r.title, ''));
}

/** Nama berkas Commons sama? Garis bawah = spasi, huruf pertama tidak peka besar-kecil. */
function sameCommonsFile(a, b) {
  const norm = f => { const n = (f || '').replace(/_/g, ' ').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };
  return !!a && !!b && norm(a) === norm(b);
}

/** Berkas sudah tertaut ke properti ini di butir (menurut data detail yang sudah dimuat)? */
function imageAlreadyLinked(qid, prop, filename) {
  return (State.records[qid]?._detail?.claims?.[prop] || [])
    .some(c => sameCommonsFile(c.mainsnak.datavalue?.value, filename));
}

/**
 * Jenis gambar yang sesuai butir, sekali per butir. Dimulai saat detail dibuka (pengguna masuk),
 * jadi biasanya sudah siap saat modal unggah / tautkan dibuka.
 */
function loadImageProps(qid) {
  const r = State.records[qid];
  if (!r) return Promise.resolve(IMAGE_PROPS_ANY);
  r._imagePropsP ||= fetchAllowedImageProps(qid, IMAGE_PROPS, State.abortCtrl?.signal)
    .then(pids => (r._imageProps = pids))
    .catch(err => { r._imagePropsP = null; throw err; });  // gagal / dibatalkan: coba lagi lain kali
  return r._imagePropsP;
}

// Jenis gambar yang cocok untuk butir apa pun: ditawarkan sambil menunggu pengecekan, atau bila gagal
const IMAGE_PROPS_ANY = ['P18'];

/** Isi pilihan "Jenis gambar"; `selected` tetap terpilih bila masih ada di daftar. */
function fillImagePropSelect(select, pids, selected = '') {
  if (!select) return;
  select.innerHTML = `<option value="">— ${escHtml(msg('image-type-choose'))} —</option>`
    + pids.map(pid => `<option value="${pid}">${escHtml(msg(`image-prop-${pid}`))} (${pid})</option>`).join('');
  select.value = pids.includes(selected) ? selected : '';
}

/**
 * Pilihan "Jenis gambar" untuk butir: hanya yang sesuai (fetchAllowedImageProps; mis. "Makam" hanya
 * untuk tokoh, tarian hanya P18). Sementara pengecekan berjalan, yang ditawarkan hanya P18.
 */
async function prepareImagePropSelect(select, qid, selected) {
  const r = State.records[qid];
  fillImagePropSelect(select, r?._imageProps || IMAGE_PROPS_ANY, selected);
  if (!r || r._imageProps) return;
  try {
    await loadImageProps(qid);
    // Modal mungkin sudah ditutup atau beralih ke butir lain
    if (select.closest('.upload-modal-overlay')?._qid === qid) {
      fillImagePropSelect(select, r._imageProps, select.value || selected);
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('Image property check failed:', err);
  }
}

/** Jenis gambar yang dipilih di modal (null = belum dipilih). */
function chosenImageProp(select) {
  return select.value || null;
}

/** Setelah gambar tersimpan: perbarui foto utama bila perlu, lalu muat ulang detail (Data Gambar ikut). */
function afterImageSaved(qid, prop, filename) {
  const r = State.records[qid];
  if (!r) return;
  if (prop === 'P18' && !r.imageFilename) {
    r.imageFilename = filename;
    mapRefreshMarkerIcon(r);
  }
  r._detail = null;  // klaim berubah: ambil ulang dari Wikidata
}

/** Klaim yang belum tampil di Data Utama (Tipe = P31, atribut skema, properti tambahan). */
function otherClaims(qid) {
  const shown = new Set(['P31', ...detailAttrs(qid).map(a => a.pid)]);
  return Object.fromEntries(Object.entries(State.records[qid]._detail.claims || {}).filter(([pid]) => !shown.has(pid)));
}

/** "Data lainnya": properti butir di luar Data Utama, dimuat saat pertama dibuka. */
async function renderAllData(qid, details) {
  const body = details.querySelector('.detail-all-body');
  try {
    const rows = await fetchAllClaimsView(otherClaims(qid), State.abortCtrl?.signal);
    const MAX = 5;
    body.innerHTML = `<ul class="detail-data detail-data--all">${rows.map(row => {
      const vals = row.values.slice(0, MAX).map(v => v.url
        ? `<a href="${escHtml(v.url)}" target="_blank" rel="noopener" class="break-all">${escHtml(v.text)}</a>`
        : escHtml(v.text)).join(', ');
      const more = row.values.length > MAX ? ` <span class="prop-empty-badge">${escHtml(msg('detail-more-values', row.values.length - MAX))}</span>` : '';
      return `<li class="detail-data-row">
        <span class="detail-info-key">${escHtml(ucFirst(row.label))}</span>
        <span class="detail-info-val">${vals}${more}</span>
      </li>`;
    }).join('')}</ul>`;
  } catch (err) {
    if (err.name !== 'AbortError') body.innerHTML = `<p class="detail-excerpt-loading">${escHtml(msg('detail-load-failed'))}</p>`;
  }
}

/** Nilai tampilan untuk atribut yang baru disimpan (tanpa perlu memuat ulang). */
function formatNilaiBaru(attr, value, itemLabel) {
  if (attr.type === 'item') return { text: itemLabel };
  if (attr.type === 'quantity') {
    const angka = formatNumber(parseFloat(value), { maximumFractionDigits: 2 });
    return { text: [angka, attr.unitLabel || attr.suffix || ''].filter(Boolean).join(' ') };
  }
  if (attr.type === 'time') {
    const [y, m, d] = value.split('-');
    const prec = d ? 11 : m ? 10 : 9;
    return { text: formatDate(`+${y.padStart(4, '0')}-${m || '00'}-${d || '00'}`, prec) };
  }
  if (attr.type === 'url') {
    return { text: value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), url: value };
  }
  return { text: value };
}

function attachPropEditHandlers(qid, container) {
  const attrByPid = Object.fromEntries(detailAttrs(qid).map(a => [a.pid, a]));

  const closeEdit = li => {
    li.querySelector('.prop-empty-badge').classList.remove('hidden');
    li.querySelector('.prop-actions').classList.remove('hidden');
    li.querySelector('.prop-edit-inline').classList.add('hidden');
    li.querySelector('.prop-suggest')?.classList.add('hidden');
    const input = li.querySelector('.prop-edit-input');
    input.value = '';
    delete input.dataset.qid;
    delete input.dataset.label;
  };

  const save = async li => {
    const attr  = attrByPid[li.dataset.pid];
    const input = li.querySelector('.prop-edit-input');
    const btn   = li.querySelector('.prop-save-btn');
    if (!attr || btn.disabled) return;

    let value = input.value.trim();
    if (!value) { input.focus(); return; }

    if (attr.type === 'item') {
      if (!input.dataset.qid) {
        appShowDialog(escHtml(msg('prop-choose-item')), 'alert', msg('dialog-attention'));
        return;
      }
      value = input.dataset.qid;
    } else if (attr.type === 'time' && !/^\d{1,4}(-\d{2}(-\d{2})?)?$/.test(value)) {
      appShowDialog(escHtml(msg('prop-date-invalid')), 'alert', msg('dialog-attention'));
      return;
    }

    applyUnitChoice(attr, li);
    btn.disabled    = true;
    btn.textContent = '…';

    try {
      const res  = await fetch(`/api/item/${qid}/add-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: attr.pid, value, datatype: attr.type, unit: attr.unit || '' }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        appShowDialog(escHtml(data.error || msg('save-failed')), 'alert', msg('dialog-error'));
        btn.disabled    = false;
        btn.textContent = '✓';
        return;
      }

      const r = State.records[qid];
      if (r?._detail) {
        const shown = formatNilaiBaru(attr, value, input.dataset.label);
        // Nilai tambahan tampil sebagai baris sendiri; nilai lama tetap di barisnya
        if (attr.more) { attr.more = false; attr.saved = shown; }
        else r._detail.values[attr.pid] = shown;
        renderDetailProps(qid);
        flashSavedRow(qid, attr.label);
      }
      toastSaved(attr.label, r?.title || qid, data.revid);
    } catch (err) {
      appShowDialog(escHtml(msg('error-generic', err.message)), 'alert', msg('dialog-error'));
      btn.disabled    = false;
      btn.textContent = '✓';
    }
  };

  // Tanpa login tidak ada tombol tambah — baris kosong cukup ditampilkan
  if (!APP_USER) return;

  // Tombol ✨ AI per atribut, dan kandidat AI yang sudah ada (mis. dari Perkaya Data) langsung ditampilkan
  container.querySelectorAll('.detail-prop-empty-row').forEach(li => {
    li.querySelector('.js-prop-ai')?.addEventListener('click', () => aiSearchRow(qid, li));
  });
  aiShowExisting(qid, container);

  container.querySelectorAll('.detail-prop-empty-row').forEach(li => {
    const input = li.querySelector('.prop-edit-input');

    li.querySelector('.js-prop-pencil').addEventListener('click', () => {
      li.querySelector('.prop-empty-badge').classList.add('hidden');
      li.querySelector('.prop-actions').classList.add('hidden');
      li.querySelector('.ai-slot').classList.add('hidden');
      li.querySelector('.prop-edit-inline').classList.remove('hidden');
      input.focus();
    });
    li.querySelector('.prop-cancel-btn').addEventListener('click', () => closeEdit(li));
    li.querySelector('.prop-save-btn').addEventListener('click', () => save(li));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); save(li); }
      if (e.key === 'Escape') closeEdit(li);
    });

    const suggest = li.querySelector('.prop-suggest');
    if (suggest) attachItemSuggest(input, suggest);
  });
}

// ---------------------------------------------------------------------------
// ✨ AI DI PANEL DETAIL — cari satu atribut kosong, periksa sumbernya, lalu simpan.
// Memakai endpoint & antrean yang sama dengan Perkaya Data (ai.js): kandidat yang
// belum diputuskan di sini tetap muncul di langkah Validasi Perkaya Data.
// ---------------------------------------------------------------------------
let _aiOpen = null;  // kandidat terbuka milik pengguna (dimuat sekali, lalu diperbarui lokal)

async function aiOpenList() {
  if (_aiOpen === null) {
    try { _aiOpen = await aiOpenCandidates(); } catch { _aiOpen = []; }
  }
  return _aiOpen;
}

/** Tampilkan kandidat menunggu validasi yang sudah ada untuk atribut-atribut kosong butir ini. */
async function aiShowExisting(qid, container) {
  const open = await aiOpenList();
  container.querySelectorAll('.detail-prop-empty-row').forEach(li => {
    const cands = sortCandidates(open.filter(c => c.qid === qid && c.pid === li.dataset.pid && c.status === 'pending'));
    if (cands.length && li.isConnected) aiRenderCandidates(qid, li, cands);
  });
}

function aiAttr(qid, li) {
  const attr = detailAttrs(qid).find(a => a.pid === li.dataset.pid);
  if (attr) applyUnitChoice(attr, li);
  return attr;
}

function aiSetSlot(li, html) {
  const slot = li.querySelector('.ai-slot');
  slot.innerHTML = html;
  slot.classList.toggle('hidden', !html);
  return slot;
}

/** Cari nilai satu atribut dengan AI lalu tampilkan kandidatnya di bawah baris itu. */
async function aiSearchRow(qid, li) {
  const attr = aiAttr(qid, li);
  const r = State.records[qid];
  if (!attr || !r) return true;
  if (!aiReady()) {
    openSettings(() => aiSearchRow(qid, li));  // isi API key dulu, lalu langsung mencari
    return false;
  }
  const btn = li.querySelector('.js-prop-ai');
  btn.disabled = true;
  aiSetSlot(li, `<p class="ai-status"><span class="loader loader--small"></span>${escHtml(msg('detail-ai-searching'))}</p>`);

  try {
    const { ok, status, data } = await aiSearch({
      qid, label: r.title, description: r._detail?.description || '',
      kategori: State.params?.klasterNama || '',
      lokasi: [r.lokLabel, ...(r.provLabels || [r.provLabel])].filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
    }, attr);
    if (!li.isConnected) return true;
    btn.disabled = false;
    if (!ok) {
      aiSetSlot(li, `<p class="ai-status ai-status--error">${escHtml(data.error || msg('pk-failed-http', status))}</p>`);
      return !(status === 401 || data.fatal);
    }
    // Simpan ke daftar lokal agar konsisten bila detail dibuka ulang
    if (_aiOpen) _aiOpen = _aiOpen.filter(c => !(c.qid === qid && c.pid === attr.pid)).concat(data);
    if (data[0]?.status !== 'pending') {
      aiSetSlot(li, `<p class="ai-status">${escHtml(msg('detail-ai-not-found'))}${data[0]?.note ? ` <span class="ai-note">${escHtml(data[0].note)}</span>` : ''}</p>`);
      return true;
    }
    aiRenderCandidates(qid, li, sortCandidates(data));
  } catch (err) {
    btn.disabled = false;
    aiSetSlot(li, `<p class="ai-status ai-status--error">${escHtml(msg('error-generic', err.message))}</p>`);
  }
  return true;
}

function aiCandidateHtml(c, multi) {
  const src = (c.sources || [])[0] || {};
  const v = VERIF_VIEW_DETAIL[src.verification || c.verification] || VERIF_VIEW_DETAIL.gagal_dibuka;
  let host = '';
  try { host = new URL(src.url).hostname.replace(/^www\./, ''); } catch {}
  const value = `${c.value}${c.unit_label ? ' ' + c.unit_label : ''}`;
  return `<div class="ai-cand" data-id="${c.id}">
    <div class="ai-cand-head">
      <strong class="ai-cand-value">${escHtml(value)}</strong>
      <span class="pk-source-verif pk-source-verif--${v.cls}" title="${escHtml(src.verify_note || '')}">${escHtml(v.label)}</span>
    </div>
    ${src.url ? `<a class="ai-cand-src" href="${escHtml(src.url)}" target="_blank" rel="noopener">${escHtml(src.title || host)} ↗</a>` : ''}
    ${src.quote ? `<blockquote class="ai-cand-quote">${escHtml(src.quote)}</blockquote>` : ''}
    ${c.datatype === 'item' ? `<div class="ai-item-choices"><span class="loader loader--small"></span></div>` : ''}
    <div class="ai-cand-actions">
      <button type="button" class="btn btn--primary btn--sm js-ai-approve"${c.datatype === 'item' ? ' disabled' : ''}>✓ ${escHtml(msg('detail-ai-save'))}</button>
      ${multi ? '' : `<button type="button" class="btn btn--secondary btn--sm js-ai-reject">${escHtml(msg('pk-reject'))}</button>`}
    </div>
  </div>`;
}

const VERIF_VIEW_DETAIL = {
  terverifikasi:       { cls: 'ok',    label: msg('pk-verif-ok') },
  nilai_tidak_cocok:   { cls: 'warn',  label: msg('pk-verif-value-mismatch') },
  nilai_di_halaman:    { cls: 'warn',  label: msg('pk-verif-value-on-page') },
  tidak_terverifikasi: { cls: 'bad',   label: msg('pk-verif-unverified') },
  gagal_dibuka:        { cls: 'muted', label: msg('pk-verif-unchecked') },
};

/** Kandidat AI di bawah baris atribut: Simpan langsung ke Wikidata, atau Tolak. */
function aiRenderCandidates(qid, li, cands) {
  const attr = aiAttr(qid, li);
  const multi = cands.length > 1;
  const slot = aiSetSlot(li, `
    ${multi ? `<p class="ai-status ai-status--warn">${escHtml(msg('pk-disagree-title', cands.length))}</p>` : ''}
    ${cands.map(c => aiCandidateHtml(c, multi)).join('')}
    ${multi ? `<div class="ai-cand-actions"><button type="button" class="btn btn--secondary btn--sm js-ai-reject">${escHtml(msg('pk-reject-all'))}</button></div>` : ''}
    <p class="ai-msg hidden"></p>`);
  const setMsg = (cls, text) => {
    const el = slot.querySelector('.ai-msg');
    el.className = `ai-msg ai-status ai-status--${cls}`;
    el.textContent = text;
  };
  const busy = on => slot.querySelectorAll('button').forEach(b => { b.disabled = on || b.dataset.locked === '1'; });

  // Atribut bertipe butir: AI memberi nama, pengguna memilih butir Wikidata yang tepat
  cands.filter(c => c.datatype === 'item').forEach(async c => {
    const box = slot.querySelector(`.ai-cand[data-id="${c.id}"] .ai-item-choices`);
    let results = [];
    try { results = await searchWikidataItems(c.value); } catch {}
    if (!box.isConnected) return;
    box.innerHTML = results.length
      ? `<span class="ai-item-label">${escHtml(msg('detail-ai-choose-item'))}</span>` + results.slice(0, 3).map((it, i) => `
          <label class="ai-item-choice">
            <input type="radio" name="ai-item-${c.id}" value="${escHtml(it.id)}" data-label="${escHtml(it.label)}"${i === 0 ? ' checked' : ''}>
            <span><strong>${escHtml(it.label)}</strong> <span class="pk-choice-qid">${escHtml(it.id)}</span>
            ${it.description ? `<span class="pk-choice-desc">${escHtml(it.description)}</span>` : ''}</span>
          </label>`).join('')
      : `<span class="ai-item-label">${escHtml(msg('pk-item-none'))}</span>`;
    const approve = box.closest('.ai-cand').querySelector('.js-ai-approve');
    approve.disabled = !results.length;
    approve.dataset.locked = results.length ? '' : '1';
  });

  slot.querySelectorAll('.js-ai-approve').forEach(btn => btn.addEventListener('click', async () => {
    const c = cands.find(x => String(x.id) === btn.closest('.ai-cand').dataset.id);
    const picked = slot.querySelector(`input[name="ai-item-${c.id}"]:checked`);
    const body = c.datatype === 'item'
      ? { value_qid: picked?.value || '', value_label: picked?.dataset.label || '' }
      : { value: c.value };
    body.source_index = 0;
    busy(true);
    setMsg('info', msg('pk-saving'));
    try {
      const { ok, status, data } = await aiApprove(c.id, body);
      if (!ok) { busy(false); setMsg('error', data.error || msg('pk-failed-http', status)); return; }
      if (data.warning) appShowDialog(escHtml(data.warning), 'alert', msg('pk-saved-with-warning'));
      if (_aiOpen) _aiOpen = _aiOpen.filter(x => !(x.qid === qid && x.pid === c.pid));
      const r = State.records[qid];
      if (r?._detail && attr) {
        r._detail.values[attr.pid] = formatNilaiBaru(attr, body.value_qid || c.value, body.value_label);
        renderDetailProps(qid);
        flashSavedRow(qid, attr.label);
      }
      toastSaved(attr?.label || c.pid, r?.title || c.item_label, data.revid);
    } catch (err) {
      busy(false);
      setMsg('error', msg('error-generic', err.message));
    }
  }));

  slot.querySelectorAll('.js-ai-reject').forEach(btn => btn.addEventListener('click', async () => {
    busy(true);
    try {
      for (const c of cands) {
        const { ok, data } = await aiReject(c.id);
        if (!ok) { busy(false); setMsg('error', data.error || msg('pk-cell-error')); return; }
      }
      if (_aiOpen) _aiOpen = _aiOpen.filter(x => !(x.qid === qid && x.pid === cands[0].pid));
      aiSetSlot(li, '');
    } catch (err) {
      busy(false);
      setMsg('error', msg('error-generic', err.message));
    }
  }));
}

async function loadSingleItemMedia(qid) {
  const r = State.records[qid];
  if (!r || r.imageFilename !== undefined) return;
  try {
    const media = await fetchSingleItemMedia(qid, State.abortCtrl?.signal);
    Object.assign(r, media);
    mapRefreshMarkerIcon(r);
    if (document.getElementById(`detail-excerpt-${qid}`)) renderDetail(qid);
  } catch (_) {}
}

async function loadCaption(qid) {
  const r = State.records[qid];
  if (!r?.imageFilename) return;
  try {
    const cap = await fetchImageCaption(r.imageFilename, State.abortCtrl?.signal);
    const el  = $(`img-caption-${qid}`);
    if (el) el.innerHTML = cap || '';
  } catch (_) {}
}

async function loadExcerpt(qid) {
  const r = State.records[qid];
  if (!r?.articleTitle) return;
  try {
    const html = await fetchWikipediaExcerpt(r.articleTitle, State.abortCtrl?.signal);
    const el   = $(`detail-excerpt-${qid}`);
    if (el) el.innerHTML = html;
  } catch (_) {}
}

function updateDetailNav() {
  const i = State.currentIndex;
  if ($('btn-prev')) $('btn-prev').disabled = i <= 0;
  if ($('btn-next')) $('btn-next').disabled = i >= State.visibleIds.length - 1;
}

// ---------------------------------------------------------------------------
// LIGHTBOX
// ---------------------------------------------------------------------------
function openLightbox(filename) {
  const overlay = $('lightbox-overlay');
  const img     = $('lightbox-img');
  if (!overlay || !img) return;
  img.src = commonsFileUrl(filename, 1200);
  img.dataset.file = filename;

  const title = $('lightbox-title');
  if (title) {
    title.href = commonsFilePageUrl(filename);
    title.innerHTML = `<span>${escHtml(filename.replace(/_/g, ' ').replace(/\.[^.]+$/, ''))}</span>${ICON_EXT}`;
  }
  const credit = $('lightbox-credit');
  if (credit) {
    credit.textContent = msg('loading');
    // Fotografer & lisensi sebagai teks biasa (tanpa tautan); <template> agar HTML dari Commons tidak dijalankan
    fetchImageCaption(filename, State.abortCtrl?.signal).then(html => {
      if (img.dataset.file !== filename) return;  // lightbox sudah berganti foto
      const tpl = document.createElement('template');
      tpl.innerHTML = html || '';
      credit.textContent = tpl.content.textContent.trim();
    }).catch(() => { credit.textContent = ''; });
  }
  overlay.classList.remove('hidden');
}

function closeLightbox() {
  $('lightbox-overlay')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// MOBILE BOTTOM-SHEET
// ---------------------------------------------------------------------------
// Tiga posisi panel di HP: terbuka penuh, sebagian (sampai bawah tombol Semua / Ada artikel / Ada foto,
// jadi pencarian & filter tetap bisa dipakai sambil melihat peta), dan tersembunyi (tinggal pegangan).
// Tinggi sebagian sama dengan responsive.css.
const SHEET_PEEK = 212;
let _setSheetOpen = null;

function initBottomSheet() {
  const handle = $('panel-handle');
  const panel  = $('panel');
  if (!handle || !panel) return;

  const STOPS = () => ({
    open:   0,
    peek:   panel.offsetHeight - SHEET_PEEK,
    hidden: panel.offsetHeight - handle.offsetHeight,
  });
  const SWIPE_MIN = 60;  // jarak tarik/usap (px) agar panel berpindah; kurang dari itu kembali ke posisi semula

  function getCurrentTranslateY() {
    const m = new DOMMatrix(getComputedStyle(panel).transform);
    return m.m42;
  }

  function snapTo(stop) {
    panel.classList.remove('dragging');
    panel.style.transform = `translateY(${STOPS()[stop]}px)`;
    panel.dataset.sheet = stop;
    // Ikon tombol peta / daftar mengikuti kelas ini (responsive.css)
    panel.classList.toggle('sheet-closed', stop !== 'open');
  }
  _setSheetOpen = open => snapTo(open ? 'open' : 'peek');
  // Posisi awal di CSS adalah sebagian (mis. jendela desktop yang dikecilkan jadi ukuran HP)
  panel.dataset.sheet = 'peek';
  panel.classList.add('sheet-closed');

  /** Geser panel mengikuti jari, dibatasi antara terbuka dan tersembunyi. */
  function dragTo(y) {
    panel.style.transform = `translateY(${Math.max(STOPS().open, Math.min(STOPS().hidden, y))}px)`;
  }

  /** Setelah ditarik: berhenti di posisi terdekat; tarikan pendek kembali ke posisi awal. */
  function settle(fromStop) {
    const stops = STOPS();
    const y = getCurrentTranslateY();
    const moved = y - stops[fromStop];
    if (Math.abs(moved) < SWIPE_MIN) return snapTo(fromStop);
    // Hanya posisi di arah tarikan; yang terdekat dengan posisi jari saat dilepas
    const ahead = Object.keys(stops).filter(k => moved > 0 ? stops[k] > stops[fromStop] : stops[k] < stops[fromStop]);
    snapTo(ahead.reduce((a, b) => Math.abs(stops[b] - y) < Math.abs(stops[a] - y) ? b : a));
  }

  // Setelah panel dipindah lewat pegangan / usapan, "click" bawaan sentuhan menyusul di titik jari, dan
  // karena panel sudah bergeser, yang kena adalah isi panel di titik itu (mis. foto → lightbox). Telan sekali.
  function swallowNextClick() {
    const block = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', block, { capture: true }), 400);
  }

  // Tombol di baris navigasi: pengguna awam belum tahu panel bisa ditarik untuk melihat peta
  document.addEventListener('click', e => {
    if (e.target.closest('.js-sheet-toggle')) _setSheetOpen(panel.dataset.sheet !== 'open');
  });

  // Pegangan: tarik ke posisi mana pun; ketuk = buka penuh, atau turun ke sebagian bila sudah terbuka
  let grab = null;  // { y, from, moved }
  handle.addEventListener('pointerdown', e => {
    grab = { y: e.clientY, from: panel.dataset.sheet, start: getCurrentTranslateY(), moved: false };
    panel.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!grab) return;
    const dy = e.clientY - grab.y;
    if (Math.abs(dy) > 5) grab.moved = true;
    dragTo(grab.start + dy);
  });

  handle.addEventListener('pointerup', () => {
    if (!grab) return;
    if (grab.moved) settle(grab.from);
    else snapTo(grab.from === 'open' ? 'peek' : 'open');
    grab = null;
    swallowNextClick();
  });

  // Usap isi panel: ke bawah saat gulirannya sudah mentok di atas → turun satu posisi;
  // ke atas saat belum terbuka penuh → naik. Selain itu usapan tetap menggulir isi panel seperti biasa.
  let swipe = null;  // { x, y, from, start, section, mode: null | 'drag' | 'scroll' }

  panel.addEventListener('touchstart', e => {
    if (!window.matchMedia('(max-width: 800px)').matches || e.touches.length !== 1) return;
    if (e.target.closest('#panel-handle')) return;  // pegangan punya penanganan sendiri
    const t = e.touches[0];
    swipe = { x: t.clientX, y: t.clientY, from: panel.dataset.sheet, start: getCurrentTranslateY(),
              section: e.target.closest('.panel-section'), mode: null };
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!swipe || swipe.mode === 'scroll') return;
    const t  = e.touches[0];
    const dy = t.clientY - swipe.y;
    if (!swipe.mode) {
      if (Math.abs(dy) < 6) return;
      const atTop    = !swipe.section || swipe.section.scrollTop <= 0;
      const vertical = Math.abs(dy) > Math.abs(t.clientX - swipe.x);
      const canDrag  = dy < 0 ? swipe.from !== 'open' : atTop && swipe.from !== 'hidden';
      swipe.mode = vertical && canDrag ? 'drag' : 'scroll';
      if (swipe.mode === 'scroll') return;
      panel.classList.add('dragging');
    }
    e.preventDefault();  // jangan ikut menggulir / memantul selama panel ditarik
    dragTo(swipe.start + dy);
  }, { passive: false });

  const endSwipe = () => {
    if (swipe?.mode === 'drag') { settle(swipe.from); swallowNextClick(); }
    swipe = null;
  };
  panel.addEventListener('touchend', endSwipe);
  panel.addEventListener('touchcancel', endSwipe);

  // Pengguna baru langsung melihat form, bukan hanya peta dengan pegangan kecil di bawah
  if (window.matchMedia('(max-width: 800px)').matches) snapTo('open');
}

// ---------------------------------------------------------------------------
// MAP POPUP HTML
// ---------------------------------------------------------------------------
function buildMapPopupHtml(r) {
  const sub = [r.lokLabel || r.provLabel, r.yearStr].filter(Boolean).join(' · ');
  const imgHtml = r.imageFilename
    ? `<img class="map-popup-img" src="${commonsFileUrl(r.imageFilename, 200)}" alt="" loading="lazy">`
    : '';
  const isMobile = window.innerWidth <= 800;
  const btnHtml  = isMobile
    ? `<button class="popup-lihat-detail" data-qid="${escHtml(r.id)}">${escHtml(msg('popup-view-detail'))} →</button>`
    : '';
  return `
    <div class="map-popup">
      ${imgHtml}
      <div class="map-popup-body">
        <strong class="map-popup-title">${escHtml(r.title)}</strong>
        ${sub ? `<div class="map-popup-sub">${escHtml(sub)}</div>` : ''}
        ${btnHtml}
      </div>
    </div>`;
}

function openBottomSheet() {
  _setSheetOpen?.(true);
}

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

// ---------------------------------------------------------------------------
// TAUTKAN FOTO COMMONS KE WIKIDATA (P18)
// ---------------------------------------------------------------------------

function parseCommonsFilename(val) {
  val = val.trim();
  const m = val.match(/[Ff]ile:([^?#&\n]+)/);
  if (m) return decodeURIComponent(m[1].trim());
  if (/\.(jpe?g|png|gif|webp|svg|tiff?)$/i.test(val)) return val;
  return null;
}

function setLinkPhotoStatus(type, msg) {
  const el = $('link-photo-status');
  if (!el) return;
  el.className = `upload-status upload-status--${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function initLinkPhotoModal() {
  const modal      = $('link-photo-modal');
  if (!modal) return;
  const input      = $('link-photo-input');
  const previewArea= $('link-photo-preview-area');
  const previewImg = $('link-photo-preview-img');
  const previewName= $('link-photo-preview-name');
  const submitBtn  = $('link-photo-btn-submit');
  const propSelect = $('link-photo-prop');

  const closeModal = () => {
    modal.classList.add('hidden');
    input.value = '';
    previewArea.classList.add('hidden');
    $('link-photo-status').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.remove('loading');
    $('link-photo-btn-label').textContent = msg('link-photo-submit');
    modal._qid = null;
  };

  $('link-photo-modal-close')?.addEventListener('click', closeModal);
  $('link-photo-btn-cancel')?.addEventListener('click',  closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  let previewTimer;
  input.addEventListener('input', () => {
    clearTimeout(previewTimer);
    $('link-photo-status').classList.add('hidden');
    const fname = parseCommonsFilename(input.value);
    if (!fname) { previewArea.classList.add('hidden'); submitBtn.disabled = true; return; }

    previewTimer = setTimeout(() => {
      previewImg.src = commonsFileUrl(fname, 320);
      previewName.textContent = fname;
      previewImg.onload  = () => { previewArea.classList.remove('hidden'); submitBtn.disabled = false; };
      previewImg.onerror = () => {
        previewArea.classList.add('hidden');
        submitBtn.disabled = true;
        setLinkPhotoStatus('error', msg('link-photo-not-found'));
      };
    }, 600);
  });

  submitBtn.addEventListener('click', async () => {
    const qid   = modal._qid;
    const fname = parseCommonsFilename(input.value);
    if (!fname || !qid) return;
    const prop = chosenImageProp(propSelect);
    if (!prop) return setLinkPhotoStatus('error', msg('image-type-required'));
    // Cek cepat di sisi tampilan; server tetap memeriksa ulang ke Wikidata
    if (imageAlreadyLinked(qid, prop, fname))
      return setLinkPhotoStatus('error', msg('image-already-linked', msg(`image-prop-${prop}`)));

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('link-photo-btn-label').textContent = msg('link-photo-linking');
    setLinkPhotoStatus('info', msg('link-photo-adding', msg(`image-prop-${prop}`)));

    try {
      const res  = await fetch(`/api/item/${qid}/set-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname, property: prop }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setLinkPhotoStatus('error', data.error || msg('link-photo-failed'));
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('link-photo-btn-label').textContent = msg('link-photo-submit');
        return;
      }

      afterImageSaved(qid, prop, data.filename);
      // Peringatan = tertaut di Wikidata, tapi data terstruktur Commons gagal; beri waktu membaca
      if (data.warning) setLinkPhotoStatus('warning', `✓ ${msg('link-photo-success', msg(`image-prop-${prop}`))} ${data.warning}`);
      else setLinkPhotoStatus('success', `✓ ${msg('link-photo-success', msg(`image-prop-${prop}`))}`);
      $('link-photo-btn-label').textContent = msg('button-done');

      setTimeout(() => { closeModal(); renderDetail(qid); }, data.warning ? 5000 : 1500);

    } catch (err) {
      setLinkPhotoStatus('error', msg('error-generic', err.message));
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('link-photo-btn-label').textContent = msg('link-photo-submit');
    }
  });
}

/**
 * `prop`: jenis gambar terpilih saat modal dibuka — P18 dari kotak foto utama, kosong dari Data Gambar.
 * `filename`: nama berkas yang langsung diisi (mis. dari unggahan yang ternyata duplikat).
 */
function openLinkPhotoModal(qid, title, prop = 'P18', filename = '') {
  const modal = $('link-photo-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  prepareImagePropSelect($('link-photo-prop'), qid, prop);
  const input = $('link-photo-input');
  input.value = filename;
  $('link-photo-preview-area').classList.add('hidden');
  $('link-photo-status').classList.add('hidden');
  $('link-photo-btn-submit').disabled = true;
  modal.classList.remove('hidden');
  if (filename) input.dispatchEvent(new Event('input'));  // tampilkan pratinjau
  setTimeout(() => input.focus(), 100);
}

// ---------------------------------------------------------------------------
// UPLOAD FOTO KE COMMONS
// ---------------------------------------------------------------------------

function initUploadModal() {
  const modal    = $('upload-modal');
  const fileInput = $('upload-file-input');
  const dropZone  = $('upload-drop-zone');
  const preview   = $('upload-preview-img');
  const dropLabel = $('upload-drop-label');
  const submitBtn = $('upload-btn-submit');
  if (!modal) return;
  const propSelect = $('upload-prop');

  // Tutup modal
  const closeModal = () => {
    modal.classList.add('hidden');
    fileInput.value = '';
    preview.classList.add('hidden');
    dropLabel.classList.remove('hidden');
    $('upload-filename').value = '';
    $('upload-caption').value  = '';
    $('upload-status').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.remove('loading');
    $('upload-btn-label').textContent = msg('upload-submit');
    linkExistingBtn.classList.add('hidden');
    modal._qid = null;
    modal._pick = null;
    modal._exif = {};
    showUploadLocation({});
    resetUploadCategories(null);
  };
  initUploadCategories();

  // Foto yang sama sudah ada di Commons: pindah ke modal Tautkan dengan nama berkas itu
  const linkExistingBtn = $('upload-btn-link-existing');
  linkExistingBtn.addEventListener('click', () => {
    const { _qid: qid, _title: title, _existing: existing } = modal;
    const prop = propSelect.value;
    closeModal();
    openLinkPhotoModal(qid, title, prop, existing);
  });

  $('upload-modal-close')?.addEventListener('click', closeModal);
  $('upload-btn-cancel')?.addEventListener('click',  closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // File picker — klik drop zone
  dropZone.addEventListener('click', e => {
    if (!e.target.closest('.upload-preview-img')) fileInput.click();
  });

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
  });

  async function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) return setUploadStatus('error', msg('upload-images-only'));
    if (file.size > 10 * 1024 * 1024) return setUploadStatus('error', msg('upload-too-large', 10));

    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      dropLabel.classList.add('hidden');
    };
    reader.readAsDataURL(file);
    linkExistingBtn.classList.add('hidden');
    $('upload-status').classList.add('hidden');

    // Auto-isi nama file: judul butir + tanggal foto (EXIF → tanggal file → hari ini)
    const pick = modal._pick = {};  // pilihan foto terbaru; pilihan lama yang masih berjalan diabaikan
    const title = modal._title || '';
    const ext   = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safe  = title.replace(/[^a-zA-Z0-9À-ɏ\s\-]/g, '').trim().replace(/\s+/g, '_');
    $('upload-caption').value = $('upload-caption').value || title;

    const exif = await exifInfo(file);
    if (modal._pick !== pick) return;
    modal._exif = exif;
    showUploadLocation(exif);
    const day  = exif.date || isoDate(new Date(file.lastModified || Date.now()));
    const base = safe ? `${safe}_${day}` : file.name.replace(/\.[^.]*$/, '').trim().replace(/\s+/g, '_');
    const suggested = `${base}.${ext}`;
    $('upload-filename').value = suggested;
    submitBtn.disabled = false;

    // Nama sudah dipakai di Commons? Ganti dengan _2, _3, … — kecuali pengguna sudah mengubahnya
    try {
      const free = await fetchFreeCommonsName(base, ext);
      if (modal._pick === pick && free && $('upload-filename').value === suggested) $('upload-filename').value = free;
    } catch { /* gagal mengecek: server tetap menolak nama yang sudah dipakai */ }
  }

  // Submit
  $('upload-btn-submit')?.addEventListener('click', async () => {
    const qid      = modal._qid;
    const file     = fileInput.files[0];
    const filename = $('upload-filename').value.trim();
    const caption  = $('upload-caption').value.trim();

    if (!file)     return setUploadStatus('error', msg('upload-choose-photo'));
    if (!filename) return setUploadStatus('error', msg('upload-filename-required'));
    const prop = chosenImageProp(propSelect);
    if (!prop)     return setUploadStatus('error', msg('image-type-required'));

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('upload-btn-label').textContent = msg('upload-uploading');
    setUploadStatus('info', msg('upload-in-progress'));

    const fd = new FormData();
    fd.append('file',     file);
    fd.append('filename', filename);
    fd.append('caption',  caption);
    fd.append('property', prop);
    // Data EXIF untuk halaman berkas: tanggal & jam pemotretan, lokasi kamera (bila dicentang)
    const exif = modal._exif || {};
    fd.append('date', exif.date || '');
    fd.append('time', exif.date && exif.time ? exif.time : '');
    if (exif.lat != null && $('upload-location-check').checked) {
      fd.append('lat', exif.lat);
      fd.append('lon', exif.lon);
      if (exif.heading != null) fd.append('heading', exif.heading);
    }
    fd.append('categories', JSON.stringify(UploadCats.chosen));

    try {
      const res  = await fetch(`/api/item/${qid}/upload-photo`, { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok || data.error) {
        setUploadStatus('error', data.error || msg('upload-failed'));
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('upload-btn-label').textContent = msg('upload-submit');
        if (data.code === 'duplicate' && data.existing) {
          // Unggah ulang foto yang sama tidak berguna; tawarkan menautkan berkas yang sudah ada
          modal._existing = data.existing;
          submitBtn.disabled = true;
          linkExistingBtn.classList.remove('hidden');
        } else if (data.code === 'exists') {
          $('upload-filename').focus();
          $('upload-filename').select();
        }
        return;
      }

      // Berhasil — perbarui state dan re-render detail
      afterImageSaved(qid, prop, data.filename);

      if (data.warning) {
        setUploadStatus('warning', `✓ ${msg('upload-success-warning', data.warning)}`);
      } else {
        setUploadStatus('success', `✓ ${msg('upload-success', msg(`image-prop-${prop}`))}`);
      }

      $('upload-btn-label').textContent = msg('button-done');

      // Tunggu sebentar lalu tutup dan refresh detail
      setTimeout(() => {
        closeModal();
        renderDetail(qid);
      }, data.warning ? 5000 : 1800);

    } catch (err) {
      setUploadStatus('error', msg('error-generic', err.message));
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('upload-btn-label').textContent = msg('upload-submit');
    }
  });
}

/** `prop`: jenis gambar terpilih saat modal dibuka — P18 dari kotak foto utama, kosong dari Data Gambar. */
function openUploadModal(qid, title, prop = 'P18') {
  const modal = $('upload-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  prepareImagePropSelect($('upload-prop'), qid, prop);
  $('upload-caption').value  = title || '';
  $('upload-filename').value = '';
  $('upload-status').classList.add('hidden');
  $('upload-btn-submit').disabled = true;
  resetUploadCategories(qid);
  modal.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// KATEGORI COMMONS di modal unggah — opsional; hanya dari saran (P373) atau hasil pencarian,
// tidak bisa diketik bebas. Server memeriksa ulang ke Commons sebelum menulis wikitext.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_CATEGORIES = 5;
const UploadCats = { chosen: [], suggested: [], qid: null };
const _catSuggestCache = new Map();  // qid → Promise<string[]>

function renderUploadCategories() {
  const chips = $('upload-cat-chips');
  const sugg  = $('upload-cat-suggest');
  const full  = UploadCats.chosen.length >= MAX_UPLOAD_CATEGORIES;

  chips.innerHTML = UploadCats.chosen.map(c => `
    <span class="cat-chip">${escHtml(c)}<button type="button" class="cat-chip-remove" data-cat="${escHtml(c)}"
      aria-label="${escHtml(msg('upload-category-remove', c))}">×</button></span>`).join('');
  chips.classList.toggle('hidden', !UploadCats.chosen.length);

  const open = UploadCats.suggested.filter(c => !UploadCats.chosen.includes(c));
  sugg.innerHTML = open.length
    ? `<span class="upload-hint">${escHtml(msg('upload-categories-suggested'))}</span>` +
      open.map(c => `<button type="button" class="cat-suggest-btn" data-cat="${escHtml(c)}"${full ? ' disabled' : ''}>+ ${escHtml(c)}</button>`).join('')
    : '';
  sugg.classList.toggle('hidden', !open.length);

  const input = $('upload-cat-input');
  input.disabled = full;
  input.placeholder = full ? msg('upload-category-too-many', MAX_UPLOAD_CATEGORIES) : msg('upload-categories-search');
}

function addUploadCategory(name) {
  if (UploadCats.chosen.includes(name) || UploadCats.chosen.length >= MAX_UPLOAD_CATEGORIES) return;
  UploadCats.chosen.push(name);
  renderUploadCategories();
}

/** Kosongkan pilihan; `qid` diisi saat modal dibuka → muat saran kategori butir itu. */
function resetUploadCategories(qid) {
  UploadCats.chosen = [];
  UploadCats.suggested = [];
  UploadCats.qid = qid;
  $('upload-cat-input').value = '';
  $('upload-cat-results').classList.add('hidden');
  renderUploadCategories();
  if (!qid) return;

  if (!_catSuggestCache.has(qid)) {
    _catSuggestCache.set(qid, fetchCategorySuggestions(qid).catch(() => { _catSuggestCache.delete(qid); return []; }));
  }
  _catSuggestCache.get(qid).then(list => {
    if (UploadCats.qid !== qid) return;  // modal sudah ditutup / butir lain
    UploadCats.suggested = list;
    renderUploadCategories();
  });
}

function initUploadCategories() {
  const input = $('upload-cat-input');
  const list  = $('upload-cat-results');
  if (!input) return;
  let timer = null;
  let ctrl  = null;

  $('upload-cat-chips').addEventListener('click', e => {
    const btn = e.target.closest('.cat-chip-remove');
    if (!btn) return;
    UploadCats.chosen = UploadCats.chosen.filter(c => c !== btn.dataset.cat);
    renderUploadCategories();
  });
  $('upload-cat-suggest').addEventListener('click', e => {
    const btn = e.target.closest('.cat-suggest-btn');
    if (btn) addUploadCategory(btn.dataset.cat);
  });

  const pick = li => {
    addUploadCategory(li.dataset.cat);
    input.value = '';
    list.classList.add('hidden');
    input.focus();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) { list.classList.add('hidden'); return; }

    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const results = (await searchCommonsCategories(term, ctrl.signal)).filter(c => !UploadCats.chosen.includes(c));
        list.innerHTML = results.length
          ? results.map(c => `<li class="prop-suggest-item" role="option" data-cat="${escHtml(c)}">
              <span class="prop-suggest-label">${escHtml(c)}</span></li>`).join('')
          : `<li class="prop-suggest-empty">${escHtml(msg('upload-categories-none'))}</li>`;
        list.classList.remove('hidden');
      } catch (err) {
        if (err.name !== 'AbortError') list.classList.add('hidden');
      }
    }, 250);
  });

  // Panah atas/bawah memilih, Enter menambahkan, Esc menutup daftar
  input.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('.prop-suggest-item')];
    if (list.classList.contains('hidden') || !items.length) return;
    const cur = items.findIndex(li => li.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault();
      pick(items[cur]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      list.classList.add('hidden');
    }
  });

  // mousedown (bukan click) agar input tidak kehilangan fokus sebelum pilihan tercatat
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.prop-suggest-item');
    if (!li) return;
    e.preventDefault();
    pick(li);
  });

  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
}

/** Pilihan "Sertakan lokasi kamera": hanya tampil bila foto punya GPS; bawaannya dicentang. */
function showUploadLocation(exif) {
  const group = $('upload-location-group');
  if (!group) return;
  const has = exif.lat != null;
  group.classList.toggle('hidden', !has);
  $('upload-location-check').checked = true;
  $('upload-location-coords').textContent = has ? `${exif.lat}, ${exif.lon}` : '';
}

/** Tanggal lokal sebagai YYYY-MM-DD. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Info pemotretan dari EXIF foto JPEG: { date: 'YYYY-MM-DD', time: 'HH:MM:SS', lat, lon, heading }.
 * Bagian yang tidak ada / tidak terbaca dibiarkan kosong; berkas selain JPEG → {}.
 */
async function exifInfo(file) {
  if (!/jpe?g$/i.test(file.type)) return {};
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return {};
    // Cari segmen APP1 "Exif" di antara segmen-segmen awal JPEG
    for (let off = 2; off + 10 < v.byteLength; off += 2 + v.getUint16(off + 2)) {
      const marker = v.getUint16(off);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return exifTiffInfo(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;  // awal data gambar: tidak ada EXIF
    }
  } catch { /* berkas rusak / terpotong */ }
  return {};
}

/**
 * Dari blok TIFF EXIF: tanggal & jam DateTimeOriginal (0x9003) → DateTimeDigitized (0x9004) →
 * DateTime (0x0132), dan GPS (lintang/bujur 0x1–0x4, arah kamera 0x11).
 */
function exifTiffInfo(v, tiff) {
  const le  = v.getUint16(tiff) === 0x4949;  // "II" = little endian
  const u16 = o => v.getUint16(tiff + o, le);
  const u32 = o => v.getUint32(tiff + o, le);
  const tags = ifd => {
    const out = {};
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const e = ifd + 2 + i * 12;
      out[u16(e)] = { count: u32(e + 4), value: u32(e + 8), entry: e };
    }
    return out;
  };
  // Nilai ≤ 4 bita tersimpan langsung di entri, lebih dari itu di offset `value`
  const ascii = t => {
    if (!t || !t.count) return '';
    const start = t.count > 4 ? t.value : t.entry + 8;
    return String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + tiff + start, t.count)).replace(/\0.*$/s, '');
  };
  const rational = (t, i = 0) => {
    const den = u32(t.value + i * 8 + 4);
    return den ? u32(t.value + i * 8) / den : NaN;
  };

  const info = {};
  const ifd0 = tags(u32(4));
  const exif = ifd0[0x8769] ? tags(ifd0[0x8769].value) : {};
  for (const t of [exif[0x9003], exif[0x9004], ifd0[0x0132]]) {
    const m = ascii(t).match(/^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/);
    if (m && +m[1] >= 1840 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
      info.date = `${m[1]}-${m[2]}-${m[3]}`;
      if (m[4] && +m[4] < 24 && +m[5] < 60 && +m[6] < 60) info.time = `${m[4]}:${m[5]}:${m[6]}`;
      break;
    }
  }

  const gps = ifd0[0x8825] ? tags(ifd0[0x8825].value) : {};
  const deg = (t, ref, neg) => {
    if (!t || t.count !== 3) return NaN;
    const d = rational(t, 0) + rational(t, 1) / 60 + rational(t, 2) / 3600;
    return ascii(ref).trim().toUpperCase() === neg ? -d : d;
  };
  const lat = deg(gps[0x2], gps[0x1], 'S');
  const lon = deg(gps[0x4], gps[0x3], 'W');
  // 0,0 biasanya berarti GPS kosong, bukan benar-benar di Teluk Guinea
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) {
    info.lat = +lat.toFixed(6);
    info.lon = +lon.toFixed(6);
    const h = gps[0x11] ? rational(gps[0x11]) : NaN;
    if (h >= 0 && h <= 360) info.heading = +h.toFixed(2);
  }
  return info;
}

function setUploadStatus(type, msg) {
  const el = $('upload-status');
  if (!el) return;
  el.className = `upload-status upload-status--${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}
