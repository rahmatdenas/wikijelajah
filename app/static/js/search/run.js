'use strict';

// Menarik data: status loading, cache sesi, alur pencarian, koordinat & media latar.

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
  return `wj6:${I18N.lang}:${p.jenis}:${p.wilayah}:${p.provQid}:${p.negaraQid}:${p.lat ?? ''}:${p.lon ?? ''}:${p.radius ?? ''}`;
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

/**
 * Posisi pengguna dari GPS browser, dibulatkan ke 3 desimal (±100 m): hanya posisi
 * bulat ini yang dikirim ke layanan kueri Wikidata.
 */
function getUserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(msg('nearby-unsupported'))); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
      err => reject(new Error(msg(err.code === err.PERMISSION_DENIED ? 'nearby-denied' : 'nearby-unavailable'))),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
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
  const nearby    = tipe === 'sekitar';  // tanpa kategori: semua objek di sekitar lokasi GPS

  if (!nearby && (!opt || !opt.value)) {
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

  if (nearby) {
    const btn = DOM.btnJelajahi, btnText = btn.textContent;
    btn.disabled = true;
    btn.textContent = msg('nearby-locating');
    let pos;
    try {
      pos = await getUserPosition();
    } catch (err) {
      appShowDialog(escHtml(err.message), 'alert', msg('dialog-attention'));
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = btnText;
    }
    const radius = Number($('select-radius')?.value) || 5;
    Object.assign(params, {
      jenis: '', klasterNama: '', klasterSlug: '', klasterLabel: msg('nearby-all-objects'),
      propLokasi: 'P131', propTahun: 'P571', useSubclass: false,
      wilayah: 'sekitar', wilayahNama: msg('nearby-area', radius), ...pos, radius,
    });
  }

  // Bawa konteks ke URL (bisa dibagikan) dan top nav
  const ctx = searchContext(params);
  if (ctx) {
    saveSearchContext(ctx);
    const q = new URLSearchParams(contextQuery(ctx));
    if (ctx.area) q.set('area_label', wilayahNama);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  } else if (nearby) {
    // Tanpa koordinat: tautan ini mencari di sekitar siapa pun yang membukanya
    history.replaceState(null, '', `${location.pathname}?region=nearby&radius=${params.radius}`);
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
  updateFavoriteButton();
  showSection('hasil');

  // ===== CEK CACHE SESI =====
  const cacheKey = State.cacheKey = _cacheKey(params);
  const cached   = _loadCache(cacheKey);
  if (cached) {
    State.records     = cached.records;
    State.sortedIds   = cached.sortedIds;
    setMediaReady();
    finishBuildResults();
    if (nearby) mapShowArea(params.lat, params.lon, params.radius);
    Object.values(State.records).forEach(r => mapBuildMarker(r));
    syncMapMarkers({ force: true });
    mapFitAll();
    setLoadingStatus(null);
    return;
  }

  setLoadingStatus(msg('loading-category', params.klasterLabel, params.wilayahNama));

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
          lokasiRaw: {},                  // QID lokasi → [label, QID wilayah filter]; dirapikan jadi r.lokasi di finishBuildResults
          yearStr, year: yearOf(row.tM?.value),
        };
        State.sortedIds.push(qid);
      }
      if (lQid) {
        const lok = rec.lokasiRaw[lQid] ||= [row.lLabel?.value || '', []];
        if (pQid && !lok[1].includes(pQid)) lok[1].push(pQid);
      }
      // "Di sekitar saya": koordinat & jarak (km) sudah ikut di query
      if (row.coord && rec.lat === undefined) {
        const bits = row.coord.value.split(/[() ]/);
        rec.lon = parseFloat(bits[1]); rec.lat = parseFloat(bits[2]);
      }
      if (row.dist) rec.dist = Math.min(rec.dist ?? Infinity, parseFloat(row.dist.value));
      if (pQid && !rec.provQids.includes(pQid)) {
        rec.provQids.push(pQid);
        rec.provLabels.push(pLabel);
        if (!rec.provQid) { rec.provQid = pQid; rec.provLabel = pLabel; }
      }
    }, total => {
      setLoadingStatus(msg('loading-category-count', params.klasterLabel, params.wilayahNama, total));
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
    if (nearby) {
      // Koordinat sudah ada dari query radius
      Object.values(State.records).forEach(r => mapBuildMarker(r));
      mapShowArea(params.lat, params.lon, params.radius);
      syncMapMarkers({ force: true });
      mapFitAll();
    } else {
      await loadCoordinates(allQids, signal, { fitMap: true });
    }

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
  // Jumlah hasil pencarian sebelumnya ("107 hasil") ikut hilang; muncul lagi setelah daftar baru dirender
  const end = $('hasil-end');
  if (end) { end.textContent = ''; end.classList.add('hidden'); _listObserver?.unobserve(end); }
  if (DOM.filterWilayah) DOM.filterWilayah.innerHTML = `<option value="all">${escHtml(msg('filter-all-regions'))}</option>`;
  if (DOM.filterUrut) DOM.filterUrut.innerHTML = `
    ${State.params?.wilayah === 'sekitar' ? `<option value="jarak">${escHtml(msg('sort-distance'))}</option>` : ''}
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

/** Label, jumlah, dan status aktif tombol Semua / Artikel / Foto. Jumlah media = spinner selama dimuat; Semua tanpa jumlah. */
function updateFilterButtons() {
  const f   = State.filter;
  const all = State.sortedIds.map(id => State.records[id]);
  const setLabel = (btn, text, count, on) => {
    if (!btn) return;
    const badge = count === undefined ? ''
      : count === null ? '<span class="loader feature-btn-loader" aria-hidden="true"></span>'
      : `<span class="feature-btn-count">${escHtml(formatNumber(count))}</span>`;
    btn.innerHTML = `<span>${escHtml(text)}</span>${badge}`;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  const media = (btn, state, field, key, hasKey, withoutKey) => {
    // Jumlah mengikuti saringan lain (wilayah, kata cari, media satunya) tetapi tidak dirinya sendiri
    // Butir yang medianya belum termuat (undefined) tidak dihitung sebagai Ada maupun Tanpa
    const pass = filterPredicate(key);
    const n = State.mediaLoaded
      ? all.filter(r => pass(r) && r[field] !== undefined && !!r[field] === (state !== 'without')).length : null;
    setLabel(btn, msg(state === 'without' ? withoutKey : hasKey), n, !!state);
  };
  // Semua: tanpa jumlah — sudah jelas mencakup seluruh hasil
  setLabel(DOM.btnSemua, msg('filter-all'), undefined, !hasFilter());
  media(DOM.btnArtikel, f.article, 'articleTitle', 'article', 'filter-has-article', 'filter-no-article');
  media(DOM.btnGambar,  f.image,   'imageFilename', 'image', 'filter-has-photo',  'filter-no-photo');
  updateRegionCounts();
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
