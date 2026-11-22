'use strict';

// Form pencarian: wilayah (saran & Q-ID), kategori, parameter URL.

// ---------------------------------------------------------------------------
// FORM HELPERS
// ---------------------------------------------------------------------------
function updateFormVisibility() {
  const tipe = regionType();
  DOM.wadahProvinsi.classList.toggle('hidden', tipe !== 'provinsi');
  DOM.wadahLuarNegeri.classList.toggle('hidden', tipe !== 'luar_negeri');
  DOM.wadahQidWilayah?.classList.toggle('hidden', tipe !== 'qid');
  // "Di sekitar saya" mengambil semua objek: pilihan kategori disembunyikan
  $('wadah-sekitar')?.classList.toggle('hidden', tipe !== 'sekitar');
  $('wadah-kategori')?.classList.toggle('hidden', tipe === 'sekitar');
  $('wadah-qid')?.classList.toggle('hidden', tipe === 'sekitar' || DOM.selectKategori.value !== 'custom');
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
 * ?region=province|all|abroad|area&province=Q..&country=Q..&area=Q..&category=<slug>, atau ?region=nearby&radius=5
 */
function applyQueryParams() {
  const q = new URLSearchParams(location.search);
  // "Di sekitar saya": tanpa koordinat — lokasi diambil dari GPS orang yang membuka tautan
  if (q.get('region') === 'nearby') {
    DOM.selectTipe.value = 'sekitar';
    const radius = $('select-radius');
    if (radius && [...radius.options].some(o => o.value === q.get('radius'))) radius.value = q.get('radius');
    updateFormVisibility();
    return true;
  }
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
