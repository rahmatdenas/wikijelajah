'use strict';

/* ==========================================================================
   main.js — App controller: state, event listeners, UI rendering.
   wikidata.js menyediakan semua fungsi data; map.js menyediakan semua peta.
   ========================================================================== */

// ---------------------------------------------------------------------------
// STATE TERPUSAT
// ---------------------------------------------------------------------------
const State = {
  records:      {},      // QID → { id, title, provQid, provLabel, lokLabel, yearStr, lat, lon, ... }
  sortedIds:    [],      // urutan saat ini
  visibleIds:   [],      // setelah filter
  currentIndex: -1,      // index di visibleIds untuk detail
  filter: { wilayah: 'all', mediaOnly: null, search: '' },
  viewMode:    'list',
  params:      null,
  mediaLoaded: false,
  abortCtrl:   null,
};

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
  // Nav
  navStandar:      null,
  navDetail:       null,
  btnPrev:         null,
  btnNext:         null,
};

function initDOM() {
  DOM.panel          = $('panel');
  DOM.sections       = {
    landing: $('panel-landing'),
    hasil:   $('panel-hasil'),
    detail:  $('panel-details'),
    about:   $('panel-about'),
  };
  DOM.selectTipe       = $('select-wilayah-tipe');
  DOM.wadahProvinsi    = $('wadah-provinsi');
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
  DOM.navStandar       = $('nav-standar');
  DOM.navDetail        = $('nav-detail');
  DOM.btnPrev          = $('btn-prev');
  DOM.btnNext          = $('btn-next');
}

// ---------------------------------------------------------------------------
// SECTION SWITCHING
// ---------------------------------------------------------------------------
function showSection(name) {
  Object.entries(DOM.sections).forEach(([k, el]) =>
    el?.classList.toggle('hidden', k !== name)
  );
  _activeSection = name;

  const inDetail = (name === 'detail');
  DOM.navDetail?.classList.toggle('hidden', !inDetail);
  DOM.navStandar?.classList.toggle('hidden', inDetail);
  DOM.navSubmenu?.classList.add('hidden');

  DOM.panel?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// FORM HELPERS
// ---------------------------------------------------------------------------
function updateFormVisibility() {
  const tipe = DOM.selectTipe.value;
  DOM.wadahProvinsi.classList.toggle('hidden', tipe !== 'provinsi');
  DOM.wadahLuarNegeri.classList.toggle('hidden', tipe !== 'luar_negeri');
}

function updateQidFromKategori() {
  const opt = DOM.selectKategori.options[DOM.selectKategori.selectedIndex];
  const val = opt?.value || '';
  if (!DOM.inputQid) return;
  if (val === 'custom') {
    DOM.inputQid.value = '';
    DOM.inputQid.readOnly = false;
    DOM.inputQid.placeholder = 'Contoh: wd:Q1234 wd:Q5678';
    DOM.inputQid.focus();
  } else {
    DOM.inputQid.value = val;
    DOM.inputQid.readOnly = true;
    DOM.inputQid.placeholder = '';
  }
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
  return `wj2:${p.jenis}:${p.wilayah}:${p.provQid}:${p.negaraQid}`;
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
    // _detail juga dibuang agar detail selalu diambil segar (bisa sudah diedit).
    const clean = {};
    for (const [qid, r] of Object.entries(records)) {
      const { marker, popup, _detail, ...rest } = r;
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
  const tipe      = DOM.selectTipe.value;
  const provQid   = DOM.selectProvinsi.value;
  const negaraQid = DOM.selectNegara.value;
  const opt       = DOM.selectKategori.options[DOM.selectKategori.selectedIndex];

  if (!opt || !opt.value) {
    appShowDialog('Pilih kategori data terlebih dahulu.', 'alert', 'Perhatian');
    return;
  }

  const jenis       = opt.value === 'custom'
    ? (DOM.inputQid?.value?.trim() || '')
    : opt.value;
  const klasterNama  = opt.dataset.klaster   || opt.textContent.trim();
  const propLokasi   = opt.dataset.lokasi    || 'P131';
  const propTahun    = opt.dataset.tahun     || 'P571';
  const useSubclass  = opt.dataset.subclass  === '1';

  const wilayahNama = tipe === 'provinsi'
    ? DOM.selectProvinsi.options[DOM.selectProvinsi.selectedIndex]?.text || ''
    : tipe === 'luar_negeri'
    ? DOM.selectNegara.options[DOM.selectNegara.selectedIndex]?.text || ''
    : 'Indonesia';

  const params = {
    jenis, klasterNama, propLokasi, propTahun, useSubclass,
    wilayah:   tipe === 'provinsi' ? 'provinsi' : tipe,
    provQid:   tipe === 'provinsi' ? provQid : '',
    negaraQid: tipe === 'luar_negeri' ? negaraQid : '',
  };

  // Reset state
  State.records    = {};
  State.sortedIds  = [];
  State.visibleIds = [];
  State.params     = params;
  State.mediaLoaded = false;

  State.abortCtrl?.abort();
  State.abortCtrl = new AbortController();
  const signal = State.abortCtrl.signal;

  mapClear();
  resetHasilUI();
  showSection('hasil');

  // ===== CEK CACHE SESI =====
  const cacheKey = _cacheKey(params);
  const cached   = _loadCache(cacheKey);
  if (cached) {
    State.records     = cached.records;
    State.sortedIds   = cached.sortedIds;
    setMediaReady();
    finishBuildResults();
    const markers = Object.values(State.records).map(r => mapBuildMarker(r)).filter(Boolean);
    mapAddMarkers(markers);
    mapFitAll();
    setLoadingStatus(null);
    return;
  }

  setLoadingStatus(`Menarik ${klasterNama} di ${wilayahNama}…`);

  try {
    // ===== FASE 1: Item + koordinat langsung dari SPARQL =====
    const queryFn = (limit, offset) => buildItemsQuery({ ...params, limit, offset });

    await fetchAllPages(queryFn, signal, row => {
      const qid = row.SQ?.value;
      if (!qid) return;
      const pQid    = row.PQ?.value || null;
      const lQid    = row.LQ?.value || null;
      const title   = row.sLabel?.value || qid;
      const yearStr = formatDate(row.tM?.value, row.tP?.value);

      if (!State.records[qid]) {
        State.records[qid] = {
          id: qid, title,
          lokQid: lQid, lokLabel: row.lLabel?.value || '',
          provQid: pQid, provLabel: row.pLabel?.value || '',
          yearStr,
        };
        State.sortedIds.push(qid);
      } else if (pQid && !State.records[qid].provQid) {
        State.records[qid].provQid   = pQid;
        State.records[qid].provLabel = row.pLabel?.value || '';
      }
    }, total => {
      setLoadingStatus(`Menarik ${klasterNama} di ${wilayahNama}… ${total} ditemukan`);
    });

    if (signal.aborted) return;

    const allQids = Object.keys(State.records);
    if (!allQids.length) {
      setLoadingStatus(null);
      DOM.searchInput && (DOM.searchInput.placeholder = '0 hasil ditemukan');
      return;
    }

    // Render daftar — list muncul seketika, map masih kosong
    finishBuildResults();
    setLoadingStatus(null);

    // ===== FASE 2: Koordinat =====
    const allQidsWd = allQids.map(q => `wd:${q}`);
    setLoadingStatus(`Memuat koordinat ${klasterNama}…`);
    const coords = await fetchCoordinates(allQidsWd, klasterNama, propLokasi, signal, null);
    if (signal.aborted) return;
    Object.entries(coords).forEach(([q, c]) => {
      if (State.records[q]) { State.records[q].lat = c.lat; State.records[q].lon = c.lon; }
    });
    const markers = Object.values(State.records).map(r => mapBuildMarker(r)).filter(Boolean);
    if (markers.length) { mapAddMarkers(markers); mapFitAll(); }
    setLoadingStatus(null);

    // ===== FASE 3: Media (background) =====
    loadMediaBackground(allQids, signal, () => _saveCache(cacheKey, State.records, State.sortedIds));

  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Search error:', err);
    setLoadingStatus('Terjadi kesalahan: ' + (err.message || 'coba lagi'));
  }
}

function resetHasilUI() {
  _listBuilt = false;
  if (DOM.hasilList) DOM.hasilList.innerHTML = '';
  if (DOM.filterWilayah) DOM.filterWilayah.innerHTML = '<option value="all">Semua Wilayah</option>';
  if (DOM.filterUrut) DOM.filterUrut.innerHTML = `
    <option value="tahun">Urut: Tahun</option>
    <option value="nama">Urut: Nama</option>
    <option value="wilayah">Urut: Wilayah</option>
  `;
  if (DOM.searchInput) { DOM.searchInput.value = ''; DOM.searchInput.placeholder = 'Menghitung data…'; }
  DOM.btnArtikel?.classList.add('loading');
  DOM.btnGambar?.classList.add('loading');
  DOM.btnSemua?.classList.remove('loading');
  State.filter = { wilayah: 'all', mediaOnly: null, search: '' };
}

// Data gambar/artikel tersedia → aktifkan tombol Jelajahi Artikel/Gambar
function setMediaReady() {
  State.mediaLoaded = true;
  DOM.btnArtikel?.classList.remove('loading');
  DOM.btnGambar?.classList.remove('loading');
  DOM.btnSemua?.classList.remove('loading');
}

async function loadMediaBackground(qids, signal, onComplete) {
  try {
    const media = await fetchMedia(qids.map(q => `wd:${q}`), signal);
    Object.entries(media).forEach(([qid, m]) => {
      const r = State.records[qid];
      if (!r) return;
      Object.assign(r, m);
      mapRefreshMarkerIcon(r);
    });
    setMediaReady();
    onComplete?.();
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('Media load failed:', e);
  }
}

// ---------------------------------------------------------------------------
// BUILD & RENDER RESULTS
// ---------------------------------------------------------------------------
const VIRTUAL_CHUNK = 40;

/** Dipanggil setelah FASE 1 selesai — sort + render list + isi filter wilayah */
function finishBuildResults() {
  _listBuilt = true;
  const allIds = State.sortedIds; // sudah diisi saat row masuk

  // Populasi filter wilayah
  const provMap = {};
  allIds.forEach(q => {
    const r = State.records[q];
    if (r.provQid && r.provLabel) provMap[r.provQid] = r.provLabel;
  });
  const provOpts = Object.entries(provMap)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`)
    .join('');
  if (DOM.filterWilayah)
    DOM.filterWilayah.innerHTML = '<option value="all">Semua Wilayah</option>' + provOpts;

  // Sort default: tahun → nama
  State.sortedIds.sort((a, b) => {
    const ya = parseInt(State.records[a].yearStr) || 9999;
    const yb = parseInt(State.records[b].yearStr) || 9999;
    if (ya !== yb) return ya - yb;
    return (State.records[a].title || '').localeCompare(State.records[b].title || '');
  });

  applyFilter();
}

function applyFilter() {
  const { wilayah, mediaOnly, search } = State.filter;
  const q = search.toLowerCase();

  State.visibleIds = State.sortedIds.filter(id => {
    const r = State.records[id];
    if (wilayah !== 'all' && r.provQid !== wilayah) return false;
    if (mediaOnly === 'image'   && !r.imageFilename) return false;
    if (mediaOnly === 'article' && !r.articleTitle)  return false;
    if (q && !r.title.toLowerCase().includes(q) &&
        !r.lokLabel?.toLowerCase().includes(q)  &&
        !r.provLabel?.toLowerCase().includes(q)) return false;
    return true;
  });

  renderList();
  updateSearchPlaceholder();
}

function renderList() {
  if (!DOM.hasilList) return;
  const isGrid = State.viewMode === 'grid';
  DOM.hasilList.className = isGrid ? 'result-grid' : 'result-list';
  DOM.hasilList.innerHTML = '';
  let chunk = 0;

  function renderChunk() {
    const start = chunk * VIRTUAL_CHUNK;
    const end   = Math.min(start + VIRTUAL_CHUNK, State.visibleIds.length);
    for (let i = start; i < end; i++) {
      if (isGrid) renderGridItem(State.visibleIds[i], i);
      else        renderListItem(State.visibleIds[i], i);
    }
    chunk++;
  }

  renderChunk();

  const sentinel = document.createElement('li');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'list-style:none;height:1px;pointer-events:none';
  DOM.hasilList.appendChild(sentinel);

  const container = DOM.hasilList.closest('#hasil-container') || DOM.hasilList.parentElement;
  const observer  = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    if (chunk * VIRTUAL_CHUNK < State.visibleIds.length) {
      renderChunk();
    } else {
      observer.disconnect();
      sentinel.remove();
    }
  }, { root: container, threshold: 0.1 });

  observer.observe(sentinel);
}

function renderListItem(qid, index) {
  const r = State.records[qid];
  if (!r || !DOM.hasilList) return;

  const li = document.createElement('li');
  li.className = 'result-list__item';
  li.dataset.qid = qid;
  li.dataset.index = index;

  const sub = [r.lokLabel || r.provLabel, r.yearStr].filter(Boolean).join(' · ');

  li.innerHTML = `
    <span class="result-list__link">
      ${escHtml(r.title)}
      ${sub ? `<span class="result-list__sub">${escHtml(sub)}</span>` : ''}
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

function updateSearchPlaceholder() {
  if (!DOM.searchInput) return;
  const n = State.visibleIds.length, t = State.sortedIds.length;
  DOM.searchInput.placeholder = n === t ? `Cari dari ${n} hasil…` : `${n} dari ${t} hasil`;
}

// ---------------------------------------------------------------------------
// SORT
// ---------------------------------------------------------------------------
function applySort(key) {
  State.sortedIds.sort((a, b) => {
    const ra = State.records[a], rb = State.records[b];
    if (key === 'tahun') {
      const d = (parseInt(ra.yearStr) || 9999) - (parseInt(rb.yearStr) || 9999);
      if (d) return d;
    }
    if (key === 'wilayah') {
      const c = (ra.provLabel || '').localeCompare(rb.provLabel || '');
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

function renderDetail(qid) {
  const r = State.records[qid];
  const el = DOM.sections.detail;
  if (!r || !el) return;

  const encodedFilename = r.imageFilename ? encodeURIComponent(r.imageFilename) : null;

  const mediaReady = r.imageFilename !== undefined;
  const imgFigure = r.imageFilename
    ? `<figure class="detail-figure">
        <a href="https://commons.wikimedia.org/wiki/File:${encodedFilename}" target="_blank" rel="noopener">
          <img src="${commonsFileUrl(r.imageFilename, 600)}"
               alt="${escHtml(r.title)}"
               class="detail-img js-lightbox-trigger"
               loading="lazy">
        </a>
        <figcaption id="img-caption-${escHtml(qid)}" class="detail-caption">Memuat…</figcaption>
       </figure>`
    : !mediaReady
    ? `<div class="detail-media-skeleton">
         <div class="loader loader--small"></div>
       </div>`
    : `<div class="detail-no-image" id="no-image-zone-${escHtml(qid)}">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" opacity=".3"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        <span>Belum ada foto</span>
        ${APP_USER
          ? `<div class="no-image-btns">
               <button class="btn btn--primary btn--sm upload-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↑ Upload Foto</button>
               <button class="btn btn--secondary btn--sm link-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↗ Tautkan Commons</button>
             </div>`
          : `<a href="/oauth/login" class="btn btn--secondary btn--sm">Masuk untuk upload</a>`}
       </div>`;

  const kategoriNama  = State.params?.klasterNama || '';
  const isRawQid      = /^Q\d+$/.test(r.title);
  const createWikiUrl = `https://id.wikipedia.org/w/index.php?title=${encodeURIComponent(r.title)}&action=edit`;

  const wikiLink = r.articleTitle
    ? `<p class="detail-wiki-link">
         <a href="https://id.wikipedia.org/wiki/${encodeURIComponent(r.articleTitle)}"
            target="_blank" rel="noopener">
           <img src="/static/img/wikipedia_tiny_logo.png" alt="" width="18" height="18">
           <span>Baca selengkapnya di Wikipedia</span>
         </a>
       </p>`
    : isRawQid
    ? `<p class="detail-no-article">
         Butir ini belum memiliki label di Wikidata.
         <a href="https://www.wikidata.org/wiki/${escHtml(r.id)}" target="_blank" rel="noopener" class="detail-no-article-link">Lengkapi di Wikidata →</a>
       </p>`
    : `<p class="detail-no-article">
         <em>${escHtml(kategoriNama || 'Artikel')}</em> ini belum memiliki artikel Wikipedia.
         <a href="${createWikiUrl}" target="_blank" rel="noopener" class="detail-no-article-link">Tambahkan!</a>
       </p>`;

  el.innerHTML = `
    <div class="detail-panel">

      <div class="detail-back-bar">
        <button class="detail-back-btn" id="btn-kembali-detail">← Kembali ke Hasil</button>
        <span class="detail-back-counter">${State.currentIndex >= 0 ? `${State.currentIndex + 1} / ${State.visibleIds.length}` : ''}</span>
      </div>

      <a href="https://www.wikidata.org/wiki/${escHtml(qid)}"
         target="_blank" rel="noopener" class="detail-title-link">
        <h2 class="detail-title${isRawQid ? ' detail-title--unlabeled' : ''}">
          ${isRawQid ? `<span class="detail-title-qid">${escHtml(r.id)}</span><span class="detail-title-nolabel"> — belum ada label</span>` : escHtml(r.title)}
          <svg class="detail-title-exticon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </h2>
      </a>
      <hr class="detail-hr">

      <div class="detail-lead">
        <div class="detail-lead-text">
          <div id="detail-excerpt-${escHtml(qid)}" class="detail-excerpt">
            ${(r.articleTitle || r.articleTitle === undefined) ? '<p class="detail-excerpt-loading">Memuat ringkasan Wikipedia…</p>' : ''}
          </div>

          ${wikiLink}
        </div>
        <div class="detail-lead-media">
          ${imgFigure}
        </div>
      </div>

      <hr class="detail-hr">

      ${kategoriNama ? `<p class="detail-kategori">${escHtml(kategoriNama)}</p>` : ''}

      <div id="detail-dynprops-${escHtml(qid)}">
        <p class="detail-excerpt-loading">Memuat detail…</p>
      </div>

      <p class="detail-wikidata-link">
        <a href="https://www.wikidata.org/wiki/${escHtml(qid)}" target="_blank" rel="noopener">
          <img src="/static/img/wikidata_tiny_logo.png" alt="" width="18" height="18">
          <span>Lihat di Wikidata</span>
        </a>
      </p>

      ${r.commonsCat ? `<hr class="detail-hr">
      <div class="detail-galeri-section">
        <p class="detail-galeri-heading">Galeri lainnya</p>
        <p class="detail-galeri-link">
          <a href="https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(r.commonsCat)}"
             target="_blank" rel="noopener">
            <img src="/static/img/wikicommons_tiny_logo.png" alt="" width="18" height="18">
            <span>Lihat di Wikimedia Commons</span>
          </a>
        </p>
      </div>` : ''}

    </div>`;

  el.querySelector('#btn-kembali-detail')
    ?.addEventListener('click', () => { mapShowShape(null); showSection('hasil'); });

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

// ---------------------------------------------------------------------------
// DETAIL ATRIBUT PER KATEGORI (skema: SKEMA_KATEGORI di wikidata.js)
// ---------------------------------------------------------------------------
const INPUT_PLACEHOLDER = {
  item:     'Ketik untuk mencari…',
  quantity: 'Contoh: 1000',
  time:     'Contoh: 1945 atau 1945-08-17',
  url:      'https://...',
  string:   '',
};

function renderDynPropsHtml(qid, detail, klasterNama = '') {
  const r    = State.records[qid];
  const row  = (key, valHtml) =>
    `<li><span class="detail-info-key">${escHtml(key)}:</span> ${valHtml}</li>`;
  const items = [];

  if (r?.provLabel) items.push(row('Wilayah', escHtml(r.provLabel)));
  if (detail.tipe) {
    const tipe = detail.tipe.split(', ').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
    items.push(row('Tipe/Jenis', escHtml(tipe)));
  }

  skemaKategori(klasterNama).forEach(attr => {
    const v = detail.values[attr.pid];
    if (!v) { items.push(renderEmptyPropRow(attr)); return; }
    const val = v.url && /^https?:\/\//i.test(v.url)
      ? `<a href="${escHtml(v.url)}" target="_blank" rel="noopener" class="break-all">${escHtml(v.text)}</a>`
      : escHtml(v.text);
    items.push(row(attr.label, val));
  });

  let html = `<ul class="detail-info-list detail-info-list--dyn">${items.join('')}</ul>`;

  if (detail.wikibooks) {
    html += `<p class="detail-wiki-link"><a href="${escHtml(detail.wikibooks)}" target="_blank" rel="noopener"><img src="/static/img/wikibook_tiny_logo.png" alt="" width="18" height="18"><span>Lihat di Wikibuku</span></a></p>`;
  }

  return html;
}

function renderEmptyPropRow(attr) {
  const inputType = { quantity: 'number', url: 'url' }[attr.type] || 'text';
  const extraAttr = attr.type === 'quantity' ? ' step="any"' : '';
  const unitText  = attr.type === 'quantity' ? (attr.unitLabel || attr.suffix || '') : '';
  return `<li class="detail-prop-empty-row" data-pid="${escHtml(attr.pid)}">
    <span class="detail-info-key">${escHtml(attr.label)}:</span>
    <span class="prop-empty-badge">–</span>
    <button class="js-prop-pencil prop-pencil-btn" title="Tambah nilai" type="button">✏</button>
    <span class="prop-edit-inline hidden">
      <span class="prop-edit-field">
        <input type="${inputType}" class="prop-edit-input${attr.type === 'item' ? ' prop-edit-input--item' : ''}"
               placeholder="${escHtml(INPUT_PLACEHOLDER[attr.type] || '')}" autocomplete="off"${extraAttr}>
        ${attr.type === 'item' ? '<ul class="prop-suggest hidden" role="listbox"></ul>' : ''}
      </span>
      ${unitText ? `<span class="prop-edit-unit">${escHtml(unitText)}</span>` : ''}
      <button class="prop-save-btn" type="button" title="Simpan">✓</button>
      <button class="prop-cancel-btn" type="button" title="Batal">✕</button>
    </span>
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
    if (el) el.innerHTML = '<p class="detail-excerpt-loading">Gagal memuat detail.</p>';
  }
}

function renderDetailProps(qid) {
  const r  = State.records[qid];
  const el = $(`detail-dynprops-${qid}`);
  if (!el || !r?._detail) return;
  el.innerHTML = renderDynPropsHtml(qid, r._detail, State.params?.klasterNama || '');
  attachPropEditHandlers(qid, el);
}

/** Nilai tampilan untuk atribut yang baru disimpan (tanpa perlu memuat ulang). */
function formatNilaiBaru(attr, value, itemLabel) {
  if (attr.type === 'item') return { text: itemLabel };
  if (attr.type === 'quantity') {
    const angka = parseFloat(value).toLocaleString('id-ID', { maximumFractionDigits: 2 });
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
  const attrByPid = Object.fromEntries(
    skemaKategori(State.params?.klasterNama || '').map(a => [a.pid, a])
  );

  const closeEdit = li => {
    li.querySelector('.prop-empty-badge').classList.remove('hidden');
    li.querySelector('.js-prop-pencil').classList.remove('hidden');
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
        appShowDialog('Pilih salah satu butir dari daftar saran.', 'alert', 'Perhatian');
        return;
      }
      value = input.dataset.qid;
    } else if (attr.type === 'time' && !/^\d{1,4}(-\d{2}(-\d{2})?)?$/.test(value)) {
      appShowDialog('Format tanggal: TTTT, TTTT-BB, atau TTTT-BB-HH (contoh: 1945-08-17).', 'alert', 'Perhatian');
      return;
    }

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
        appShowDialog(data.error || 'Gagal menyimpan.', 'alert', 'Kesalahan');
        btn.disabled    = false;
        btn.textContent = '✓';
        return;
      }

      const r = State.records[qid];
      if (r?._detail) {
        r._detail.values[attr.pid] = formatNilaiBaru(attr, value, input.dataset.label);
        renderDetailProps(qid);
      }
    } catch (err) {
      appShowDialog(`Error: ${err.message}`, 'alert', 'Kesalahan');
      btn.disabled    = false;
      btn.textContent = '✓';
    }
  };

  container.querySelectorAll('.detail-prop-empty-row').forEach(li => {
    const input = li.querySelector('.prop-edit-input');

    li.querySelector('.js-prop-pencil').addEventListener('click', () => {
      li.querySelector('.prop-empty-badge').classList.add('hidden');
      li.querySelector('.js-prop-pencil').classList.add('hidden');
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
  if (DOM.btnPrev) DOM.btnPrev.style.visibility = i > 0 ? 'visible' : 'hidden';
  if (DOM.btnNext) DOM.btnNext.style.visibility =
    i < State.visibleIds.length - 1 ? 'visible' : 'hidden';
}

// ---------------------------------------------------------------------------
// LIGHTBOX
// ---------------------------------------------------------------------------
function openLightbox(filename) {
  const overlay = $('lightbox-overlay');
  const img     = $('lightbox-img');
  if (!overlay || !img) return;
  img.src = commonsFileUrl(filename, 1200);
  overlay.classList.remove('hidden');
}

function closeLightbox() {
  $('lightbox-overlay')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// MOBILE BOTTOM-SHEET
// ---------------------------------------------------------------------------
function initBottomSheet() {
  const handle = $('panel-handle');
  const panel  = $('panel');
  if (!handle || !panel) return;

  const CLOSED_Y = () => panel.offsetHeight - 56; // hanya handle yang terlihat
  const OPEN_Y   = 0;

  let startY = 0, startTranslate = 0, dragging = false;

  function getCurrentTranslateY() {
    const m = new DOMMatrix(getComputedStyle(panel).transform);
    return m.m42;
  }

  function snapTo(targetY) {
    panel.classList.remove('dragging');
    panel.style.transform = `translateY(${targetY}px)`;
  }

  handle.addEventListener('pointerdown', e => {
    dragging = true;
    startY = e.clientY;
    startTranslate = getCurrentTranslateY();
    panel.classList.add('dragging');
    panel.style.transform = `translateY(${startTranslate}px)`;
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const next = Math.max(OPEN_Y, Math.min(CLOSED_Y(), startTranslate + dy));
    panel.style.transform = `translateY(${next}px)`;
  });

  handle.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    const current = getCurrentTranslateY();
    // Snap: kalau sudah > 40% terbuka → buka penuh, sebaliknya tutup
    snapTo(current < CLOSED_Y() * 0.6 ? OPEN_Y : CLOSED_Y());
  });
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
    ? `<button class="popup-lihat-detail" data-qid="${escHtml(r.id)}">Lihat Detail →</button>`
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
  const panel = $('panel');
  if (panel) panel.style.transform = 'translateY(0)';
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
  enhanceSearchableSelect(DOM.selectProvinsi, 'Ketik atau pilih provinsi…');
  enhanceSearchableSelect(DOM.selectNegara, 'Ketik atau pilih negara…');
  enhanceSearchableSelect(DOM.selectKategori, 'Ketik atau pilih kategori…');
  updateFormVisibility();
  DOM.selectTipe?.addEventListener('change', updateFormVisibility);
  DOM.selectKategori?.addEventListener('change', updateQidFromKategori);
  DOM.btnJelajahi?.addEventListener('click', startSearch);

  // Batalkan (tombol di dalam panel-hasil)
  $('btn-batalkan')?.addEventListener('click', () => {
    State.abortCtrl?.abort();
    showSection('landing');
  });

  // Filter hasil
  DOM.filterWilayah?.addEventListener('change', e => {
    State.filter.wilayah = e.target.value; applyFilter();
  });
  DOM.filterUrut?.addEventListener('change', e => applySort(e.target.value));
  DOM.searchInput?.addEventListener('input', e => {
    State.filter.search = e.target.value; applyFilter();
  });
  DOM.btnArtikel?.addEventListener('click', () => { State.viewMode = 'list'; State.filter.mediaOnly = 'article'; applyFilter(); });
  DOM.btnGambar?.addEventListener('click',  () => { State.viewMode = 'grid'; State.filter.mediaOnly = 'image';   applyFilter(); });
  DOM.btnSemua?.addEventListener('click',   () => { State.viewMode = 'list'; State.filter.mediaOnly = null;      applyFilter(); });

  // Buka halaman Perkaya Data dengan wilayah & kategori pencarian saat ini
  $('btn-perkaya')?.addEventListener('click', e => {
    const p = State.params;
    if (!p) return;
    e.preventDefault();
    const q = new URLSearchParams({ tipe: p.wilayah, kategori: p.klasterNama });
    if (p.provQid)   q.set('prov', p.provQid);
    if (p.negaraQid) q.set('negara', p.negaraQid);
    location.href = `${e.currentTarget.getAttribute('href')}?${q}`;
  });

  // Navigasi panel
  $('nav-beranda')?.addEventListener('click', e => { e.preventDefault(); showSection('landing'); });
  $('nav-hasil')?.addEventListener('click', e => {
    e.preventDefault();
    if (State.sortedIds.length) showSection('hasil');
  });
  $('nav-tentang')?.addEventListener('click', e => { e.preventDefault(); showSection('about'); });
  $('nav-kembali-hasil')?.addEventListener('click', e => {
    e.preventDefault();
    mapShowShape(null);
    showSection('hasil');
  });

  // Detail prev/next
  DOM.btnPrev?.addEventListener('click', () => {
    if (State.currentIndex > 0) openDetail(State.currentIndex - 1);
  });
  DOM.btnNext?.addEventListener('click', () => {
    if (State.currentIndex < State.visibleIds.length - 1) openDetail(State.currentIndex + 1);
  });

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
  initLinkPhotoModal();

  // Landing default
  showSection('landing');
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

  const closeModal = () => {
    modal.classList.add('hidden');
    input.value = '';
    previewArea.classList.add('hidden');
    $('link-photo-status').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.remove('loading');
    $('link-photo-btn-label').textContent = 'Tautkan ke Wikidata';
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
        setLinkPhotoStatus('error', 'File tidak ditemukan di Commons. Periksa ejaan nama file.');
      };
    }, 600);
  });

  submitBtn.addEventListener('click', async () => {
    const qid   = modal._qid;
    const fname = parseCommonsFilename(input.value);
    if (!fname || !qid) return;

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('link-photo-btn-label').textContent = 'Menautkan…';
    setLinkPhotoStatus('info', 'Menambahkan P18 ke Wikidata…');

    try {
      const res  = await fetch(`/api/item/${qid}/set-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setLinkPhotoStatus('error', data.error || 'Gagal menautkan.');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('link-photo-btn-label').textContent = 'Tautkan ke Wikidata';
        return;
      }

      if (State.records[qid]) {
        State.records[qid].imageFilename = data.filename;
        mapRefreshMarkerIcon(State.records[qid]);
      }
      setLinkPhotoStatus('success', '✓ Foto berhasil ditautkan ke Wikidata (P18).');
      $('link-photo-btn-label').textContent = 'Selesai';

      setTimeout(() => { closeModal(); renderDetail(qid); }, 1500);

    } catch (err) {
      setLinkPhotoStatus('error', `Error: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('link-photo-btn-label').textContent = 'Tautkan ke Wikidata';
    }
  });
}

function openLinkPhotoModal(qid, title) {
  const modal = $('link-photo-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  $('link-photo-input').value = '';
  $('link-photo-preview-area').classList.add('hidden');
  $('link-photo-status').classList.add('hidden');
  $('link-photo-btn-submit').disabled = true;
  modal.classList.remove('hidden');
  setTimeout(() => $('link-photo-input').focus(), 100);
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
    $('upload-btn-label').textContent = 'Upload';
    modal._qid = null;
  };

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

  function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) return setUploadStatus('error', 'Hanya file gambar yang diterima.');
    if (file.size > 10 * 1024 * 1024) return setUploadStatus('error', 'Ukuran file melebihi 10 MB.');

    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      dropLabel.classList.add('hidden');
    };
    reader.readAsDataURL(file);

    // Auto-isi nama file dari judul item
    const title = modal._title || '';
    const ext   = file.name.split('.').pop();
    const safe  = title.replace(/[^a-zA-Z0-9À-ɏ\s\-]/g, '').trim().replace(/\s+/g, '_');
    $('upload-filename').value = safe ? `${safe}.${ext}` : file.name.replace(/\s+/g, '_');
    $('upload-caption').value  = $('upload-caption').value || title;

    submitBtn.disabled = false;
    $('upload-status').classList.add('hidden');
  }

  // Submit
  $('upload-btn-submit')?.addEventListener('click', async () => {
    const qid      = modal._qid;
    const file     = fileInput.files[0];
    const filename = $('upload-filename').value.trim();
    const caption  = $('upload-caption').value.trim();

    if (!file)     return setUploadStatus('error', 'Pilih foto terlebih dahulu.');
    if (!filename) return setUploadStatus('error', 'Nama file tidak boleh kosong.');

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('upload-btn-label').textContent = 'Mengunggah…';
    setUploadStatus('info', 'Mengupload ke Commons dan memperbarui Wikidata…');

    const fd = new FormData();
    fd.append('file',     file);
    fd.append('filename', filename);
    fd.append('caption',  caption);

    try {
      const res  = await fetch(`/api/item/${qid}/upload-photo`, { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok || data.error) {
        setUploadStatus('error', data.error || 'Upload gagal.');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('upload-btn-label').textContent = 'Upload';
        return;
      }

      // Berhasil — perbarui state dan re-render detail
      if (State.records[qid]) {
        State.records[qid].imageFilename = data.filename;
        mapRefreshMarkerIcon(State.records[qid]);
      }

      if (data.warning) {
        setUploadStatus('warning', `✓ Berhasil upload ke Commons! Tapi: ${data.warning}`);
      } else {
        setUploadStatus('success', `✓ Foto berhasil diupload dan ditambahkan ke Wikidata (P18).`);
      }

      $('upload-btn-label').textContent = 'Selesai';

      // Tunggu sebentar lalu tutup dan refresh detail
      setTimeout(() => {
        closeModal();
        renderDetail(qid);
      }, 1800);

    } catch (err) {
      setUploadStatus('error', `Error: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('upload-btn-label').textContent = 'Upload';
    }
  });
}

function openUploadModal(qid, title) {
  const modal = $('upload-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  $('upload-caption').value  = title || '';
  $('upload-filename').value = '';
  $('upload-status').classList.add('hidden');
  $('upload-btn-submit').disabled = true;
  modal.classList.remove('hidden');
}

function setUploadStatus(type, msg) {
  const el = $('upload-status');
  if (!el) return;
  el.className = `upload-status upload-status--${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}
