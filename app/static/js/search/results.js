'use strict';

// Daftar/grid hasil: render bertahap, filter, sinkron peta, urutan.

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
  const regionQid = stripWd(State.params?.provQid || '');
  allIds.forEach(q => { State.records[q].lokasi = tidyLokasi(State.records[q], regionQid); });

  // Populasi filter wilayah (semua provinsi tiap butir)
  const provMap = {};
  allIds.forEach(q => {
    const r = State.records[q];
    r.provQids.forEach((p, i) => { if (r.provLabels[i]) provMap[p] = r.provLabels[i]; });
  });
  // data-label: nama tanpa jumlah; teks opsinya diisi updateRegionCounts
  const provOpts = Object.entries(provMap)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([v, l]) => `<option value="${v}" data-label="${escHtml(l)}">${escHtml(l)}</option>`)
    .join('');
  const allLabel = escHtml(msg('filter-all-regions'));
  if (DOM.filterWilayah)
    DOM.filterWilayah.innerHTML = `<option value="all" data-label="${allLabel}">${allLabel}</option>` + provOpts;

  // Kotak cari & filter baru muncul setelah ada data yang bisa disaring
  $('filter-header')?.classList.remove('hidden');
  applySort(DOM.filterUrut?.value || 'nama');
}

/**
 * Lokasi spesifik butir, tanpa lokasi yang hanya wilayah induk lokasi lain atau wilayah yang dicari
 * (mis. P131 = Medan dan Sumatera Utara → Medan saja). Urutannya sesuai hasil query.
 * @returns {Array<{qid: string, label: string, regions: string[]}>}  regions = QID opsi filter wilayah yang memuatnya
 */
function tidyLokasi(r, regionQid) {
  const all = Object.entries(r.lokasiRaw || {}).map(([qid, [label, regions]]) => ({ qid, label, regions }));
  const parents = new Set(all.flatMap(l => l.regions.filter(p => p !== l.qid)));
  const specific = all.filter(l => l.qid !== regionQid && !parents.has(l.qid));
  return specific.length ? specific : all;
}

const isMultiLokasi = r => (r.lokasi?.length || 0) > 1;

/** Subjudul butir di daftar/grid/popup: lokasi · tahun. */
const itemSub = r => [lokasiText(r), r.yearStr].filter(Boolean).join(' · ');

/** Teks lokasi ringkas: "Medan", atau "Palembang, Tanjungpinang +5 lainnya" untuk butir berlokasi banyak. */
function lokasiText(r) {
  const list = r.lokasi || [];
  if (list.length < 2) return list[0]?.label || r.lokLabel || r.provLabel;
  // Lokasi di wilayah yang sedang disaring didahulukan: jelas kenapa butir ini muncul di filter itu
  const w = State.filter.wilayah;
  const sorted = w === 'all' ? list
    : [...list.filter(l => l.regions.includes(w)), ...list.filter(l => !l.regions.includes(w))];
  const names = sorted.slice(0, 2).map(l => l.label).join(', ');
  return list.length > 2 ? `${names} ${msg('more-locations', list.length - 2)}` : names;
}

/**
 * Penyaring butir sesuai State.filter. `skip` ('wilayah' | 'image' | 'article') mengabaikan satu saringan,
 * agar jumlah per pilihan saringan itu mengikuti saringan lain tetapi tidak dirinya sendiri.
 */
function filterPredicate(skip = null) {
  const { wilayah, image, article, search } = State.filter;
  const q = search.toLowerCase();
  return r => {
    if (skip !== 'wilayah' && wilayah !== 'all' && !r.provQids.includes(wilayah)) return false;
    if (skip !== 'image'   && image   && (r.imageFilename === undefined || !!r.imageFilename !== (image === 'has')))  return false;
    if (skip !== 'article' && article && (r.articleTitle  === undefined || !!r.articleTitle  !== (article === 'has'))) return false;
    if (q && ![r.title, r.lokLabel, ...r.provLabels, ...(r.lokasi || []).map(l => l.label)]
      .some(t => t?.toLowerCase().includes(q))) return false;
    return true;
  };
}

/** Jumlah butir di setiap opsi filter wilayah, mis. "Kota Medan (30)". */
function updateRegionCounts() {
  if (!_listBuilt || !DOM.filterWilayah) return;
  const pass = filterPredicate('wilayah');
  const counts = {};
  let total = 0;
  State.sortedIds.forEach(id => {
    const r = State.records[id];
    if (!pass(r)) return;
    total++;
    // Butir berlokasi banyak dihitung di setiap wilayahnya (jumlah opsi bisa melebihi total)
    new Set(r.provQids).forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  });
  [...DOM.filterWilayah.options].forEach(o => {
    if (o.dataset.label === undefined) return;
    const n = o.value === 'all' ? total : counts[o.value] || 0;
    o.textContent = `${o.dataset.label} (${formatNumber(n)})`;
  });
}

function applyFilter() {
  const pass = filterPredicate();
  State.visibleIds = State.sortedIds.filter(id => pass(State.records[id]));

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

  const sub = itemSub(r);
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

  const sub = itemSub(r);
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
      // Butir berlokasi banyak dikumpulkan paling atas (urut nama), lalu abjad lokasi spesifik
      // (Aceh, Alor, Ambon, Anyer…), bukan provinsinya
      const m = isMultiLokasi(rb) - isMultiLokasi(ra);
      if (m) return m;
      if (!isMultiLokasi(ra)) {
        const c = (lokasiText(ra) || '').localeCompare(lokasiText(rb) || '');
        if (c) return c;
      }
    }
    return (ra.title || '').localeCompare(rb.title || '');
  });
  applyFilter();
}
