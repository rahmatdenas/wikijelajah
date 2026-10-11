'use strict';

/* ==========================================================================
   perkaya.js — Halaman Perkaya Data: cek kelengkapan atribut, cari nilai
   yang kosong dengan AI, validasi kandidat, lalu simpan ke Wikidata.
   Butuh: ui.js (helper UI), wikidata.js (query & skema kategori).
   ========================================================================== */

const PK_MAX_ITEMS     = 1000;  // batas butir yang dicek sekaligus
const PK_CONCURRENCY   = 2;     // pencarian AI paralel
const PK_SETTINGS_KEY  = 'wj-perkaya-ai';

const PK = {
  items:     [],          // [{ qid, label, description, lokasi, values: {pid: {text, url?}} }]
  itemsById: {},
  skema:     [],
  kategori:  '',
  selected:  new Set(),   // 'Q123|P2044'
  cells:     {},          // 'Q123|P2044' → { status, candId, msg }
  open:      [],          // kandidat pending/not_found dari server
  history:   [],
  currentKey: null,       // sel (butir|PID) yang sedang divalidasi
  queue:     [],
  running:   0,
  stopRequested: false,
  activeTab: 'kelengkapan',
};

const cellKey = (qid, pid) => `${qid}|${pid}`;

// ---------------------------------------------------------------------------
// PENGATURAN AI (disimpan di localStorage browser)
// ---------------------------------------------------------------------------
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(PK_SETTINGS_KEY) || '{}'); } catch { s = {}; }
  return { provider: s.provider || 'claude', keys: s.keys || {}, models: s.models || {} };
}

function saveSettings(s) {
  try { localStorage.setItem(PK_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

const PROVIDER_LABEL = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', groq: 'Groq' };

function updateProviderBadge() {
  const s = loadSettings();
  const badge = $('pk-provider-badge');
  if (!badge) return;
  badge.textContent = s.keys[s.provider] ? `· ${PROVIDER_LABEL[s.provider]}` : '· belum diatur';
  badge.classList.toggle('pk-provider-badge--warn', !s.keys[s.provider]);
}

/** Tampilkan hanya isian penyedia yang dipilih; isian lain tetap ada (tersembunyi) sehingga ikut tersimpan. */
function showProviderFields() {
  const provider = $('pk-set-provider').value;
  document.querySelectorAll('.pk-set-provider').forEach(fs =>
    fs.classList.toggle('hidden', fs.dataset.provider !== provider));
}

function openSettings() {
  const s = loadSettings();
  $('pk-set-provider').value = s.provider;
  Object.keys(PROVIDER_LABEL).forEach(p => {
    $(`pk-set-key-${p}`).value   = s.keys[p] || '';
    $(`pk-set-model-${p}`).value = s.models[p] || '';
  });
  showProviderFields();
  $('pk-settings').classList.remove('hidden');
}

function closeSettings() { $('pk-settings').classList.add('hidden'); }

function initSettings() {
  $('pk-btn-settings')?.addEventListener('click', openSettings);
  $('pk-settings-close')?.addEventListener('click', closeSettings);
  $('pk-settings-cancel')?.addEventListener('click', closeSettings);
  $('pk-set-provider')?.addEventListener('change', showProviderFields);
  $('pk-settings-save')?.addEventListener('click', () => {
    const s = { provider: $('pk-set-provider').value, keys: {}, models: {} };
    Object.keys(PROVIDER_LABEL).forEach(p => {
      const key   = $(`pk-set-key-${p}`).value.trim();
      const model = $(`pk-set-model-${p}`).value.trim();
      if (key)   s.keys[p]   = key;
      if (model) s.models[p] = model;
    });
    saveSettings(s);
    updateProviderBadge();
    closeSettings();
  });
  updateProviderBadge();
}

// ---------------------------------------------------------------------------
// FORM PILIHAN DATA
// ---------------------------------------------------------------------------
function updateWilayahVisibility() {
  const tipe = $('pk-wilayah-tipe').value;
  $('pk-wadah-provinsi').classList.toggle('hidden', tipe !== 'provinsi');
  $('pk-wadah-negara').classList.toggle('hidden', tipe !== 'luar_negeri');
}

function readParams() {
  const tipe = $('pk-wilayah-tipe').value;
  const sel  = $('pk-kategori');
  const opt  = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return null;
  return {
    jenis:       opt.value,
    klasterNama: opt.textContent.trim(),
    propLokasi:  opt.dataset.lokasi || 'P131',
    propTahun:   opt.dataset.tahun || 'P571',
    useSubclass: opt.dataset.subclass === '1',
    wilayah:     tipe,
    provQid:     tipe === 'provinsi' ? $('pk-provinsi').value : '',
    negaraQid:   tipe === 'luar_negeri' ? $('pk-negara').value : '',
  };
}

/** Isi form dari query string, mis. tautan "Perkaya data ini" dari halaman Jelajah. */
function applyQueryParams() {
  const q = new URLSearchParams(location.search);
  const setSelect = (id, val) => {
    const el = $(id);
    if (!el || !val || ![...el.options].some(o => o.value === val)) return false;
    el.value = val;
    el.dispatchEvent(new Event('change'));
    return true;
  };
  setSelect('pk-wilayah-tipe', q.get('tipe'));
  setSelect('pk-provinsi', q.get('prov'));
  setSelect('pk-negara', q.get('negara'));
  const kat = q.get('kategori');
  const opt = kat && [...$('pk-kategori').options].find(o => o.textContent.trim() === kat);
  if (opt) {
    $('pk-kategori').value = opt.value;
    $('pk-kategori').dispatchEvent(new Event('change'));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MUAT DATA & CEK KELENGKAPAN
// ---------------------------------------------------------------------------
function setLoading(text) {
  $('pk-empty').classList.add('hidden');
  $('pk-loading').classList.toggle('hidden', text === null);
  if (text !== null) $('pk-loading-text').textContent = text;
}

async function loadItems() {
  const params = readParams();
  if (!params) { appShowDialog('Pilih kategori terlebih dahulu.', 'alert', 'Perhatian'); return; }

  PK.kategori  = params.klasterNama;
  PK.skema     = skemaKategori(params.klasterNama);
  PK.items     = [];
  PK.itemsById = {};
  PK.selected.clear();
  $('pk-matrix-wrap').classList.add('hidden');
  $('pk-actionbar').classList.add('hidden');
  $('pk-btn-muat').disabled = true;

  try {
    // 1. Daftar butir (SPARQL yang sama dengan halaman Jelajah)
    setLoading(`Mengambil ${params.klasterNama}…`);
    const seen = new Set();
    await fetchAllPages(
      (limit, offset) => buildItemsQuery({ ...params, limit, offset }),
      null,
      row => {
        const qid = row.SQ?.value;
        if (!qid || seen.has(qid) || PK.items.length >= PK_MAX_ITEMS) return;
        seen.add(qid);
        const item = {
          qid,
          label:  row.sLabel?.value || qid,
          lokasi: [row.lLabel?.value, row.pLabel?.value].filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
          description: '',
          values: {},
        };
        PK.items.push(item);
        PK.itemsById[qid] = item;
      },
      total => setLoading(`Mengambil ${params.klasterNama}… ${Math.min(total, PK_MAX_ITEMS)} butir`),
    );

    if (!PK.items.length) {
      setLoading(null);
      $('pk-empty').classList.remove('hidden');
      $('pk-empty').innerHTML = '<p>Tidak ada butir untuk pilihan ini.</p>';
      return;
    }

    // 2. Kelengkapan atribut skema (wbgetentities, 50 butir per permintaan)
    const chunks = chunkArray(PK.items.map(i => i.qid), 50);
    const claimsById = {};
    const labelIds = new Set();
    let done = 0;
    for (let i = 0; i < chunks.length; i += 3) {
      await Promise.all(chunks.slice(i, i + 3).map(async ids => {
        const data = await _wbGet({
          action: 'wbgetentities', ids: ids.join('|'),
          props: 'claims|descriptions', languages: 'id|en',
        });
        Object.entries(data.entities || {}).forEach(([qid, e]) => {
          const item = PK.itemsById[qid];
          if (!item) return;
          item.description = e.descriptions?.id?.value || e.descriptions?.en?.value || '';
          claimsById[qid] = e.claims || {};
          attrLabelIds(claimsById[qid], PK.skema).forEach(id => labelIds.add(id));
        });
      }));
      done += Math.min(3, chunks.length - i);
      setLoading(`Memeriksa kelengkapan… ${Math.round(done / chunks.length * 100)}%`);
    }

    // 3. Label untuk nilai bertipe butir (mis. Lokasi) & satuan, sekaligus untuk semua butir
    setLoading('Memuat label nilai…');
    const labels = labelIds.size ? await fetchLabels([...labelIds]) : {};
    Object.entries(claimsById).forEach(([qid, claims]) => {
      PK.itemsById[qid].values = formatAttrValues(claims, PK.skema, labels);
    });

    await refreshOpenCandidates();
    setLoading(null);
    $('pk-matrix-wrap').classList.remove('hidden');
    $('pk-actionbar').classList.remove('hidden');
    renderMatrix();
  } catch (err) {
    console.error(err);
    setLoading(null);
    $('pk-empty').classList.remove('hidden');
    $('pk-empty').innerHTML = `<p>Gagal memuat data: ${escHtml(err.message || 'coba lagi')}</p>`;
  } finally {
    $('pk-btn-muat').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// MATRIKS KELENGKAPAN
// ---------------------------------------------------------------------------
const isFilled = (item, pid) => !!item.values[pid];

function cellState(item, attr) {
  if (isFilled(item, attr.pid)) return { status: 'filled', value: item.values[attr.pid] };
  return PK.cells[cellKey(item.qid, attr.pid)] || { status: 'empty' };
}

const CELL_VIEW = {
  empty:     { ico: '○', cls: 'empty',    title: 'Kosong — klik untuk memilih' },
  pending:   { ico: '◐', cls: 'pending',  title: 'Ada kandidat — klik untuk memvalidasi' },
  not_found: { ico: '–', cls: 'notfound', title: 'AI tidak menemukan' },
  error:     { ico: '!', cls: 'error',    title: 'Gagal' },
  queued:    { ico: '…', cls: 'queued',   title: 'Dalam antrean' },
  searching: { ico: '',  cls: 'searching', title: 'Sedang dicari…' },
};

function cellHtml(item, attr) {
  const st   = cellState(item, attr);
  const view = CELL_VIEW[st.status] || CELL_VIEW.empty;
  const key  = cellKey(item.qid, attr.pid);
  const sel  = PK.selected.has(key) ? ' pk-cell--selected' : '';
  if (st.status === 'filled') {
    return `<td class="pk-cell pk-cell--filled" title="${escHtml(st.value.text)}">
              <span class="pk-cell-value">${escHtml(st.value.text)}</span></td>`;
  }
  const title = st.msg ? `${view.title}: ${st.msg}` : view.title;
  return `<td class="pk-cell pk-cell--${view.cls}${sel}" data-key="${escHtml(key)}" title="${escHtml(title)}">
            <span class="pk-cell-ico pk-ico--${view.cls}">${view.ico}</span></td>`;
}

function isIncomplete(item) {
  return PK.skema.some(a => !isFilled(item, a.pid));
}

function visibleItems() {
  const only = $('pk-only-incomplete').checked;
  const term = _normalize($('pk-search').value.trim());
  return PK.items.filter(it =>
    (!only || isIncomplete(it)) && (!term || _normalize(it.label).includes(term)));
}

function renderMatrix() {
  const total      = PK.items.length;
  const incomplete = PK.items.filter(isIncomplete).length;
  $('pk-summary-text').innerHTML =
    `<strong>${escHtml(PK.kategori)}</strong> · ${total} butir` +
    `${total >= PK_MAX_ITEMS ? ` (dibatasi ${PK_MAX_ITEMS} pertama — persempit wilayah)` : ''}` +
    ` · ${total - incomplete} lengkap · <strong>${incomplete} belum lengkap</strong>`;

  const head = PK.skema.map(attr => {
    return `<th class="pk-col">
      <span class="pk-col-label">${escHtml(attr.label)}</span>
      <span class="pk-col-meta">${escHtml(attr.pid)}</span>
      <button class="pk-col-select" data-pid="${escHtml(attr.pid)}" type="button">pilih kosong</button>
    </th>`;
  }).join('');

  const rows = visibleItems().map(it => `
    <tr data-qid="${escHtml(it.qid)}">
      <th class="pk-row-head" scope="row">
        <a href="https://www.wikidata.org/wiki/${escHtml(it.qid)}" target="_blank" rel="noopener">${escHtml(it.label)}</a>
        <span class="pk-row-meta">${escHtml(it.qid)}</span>
      </th>
      ${PK.skema.map(attr => cellHtml(it, attr)).join('')}
    </tr>`).join('');

  $('pk-matrix').innerHTML = `
    <thead><tr><th class="pk-row-head">Butir</th>${head}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${PK.skema.length + 1}" class="pk-empty-text">Tidak ada butir yang cocok.</td></tr>`}</tbody>`;
  updateSelectionUi();
}

function refreshCell(key) {
  const [qid, pid] = key.split('|');
  const td   = $('pk-matrix').querySelector(`td[data-key="${CSS.escape(key)}"]`);
  const item = PK.itemsById[qid];
  const attr = PK.skema.find(a => a.pid === pid);
  if (td && item && attr) td.outerHTML = cellHtml(item, attr);
}

function selectable(key) {
  const [qid, pid] = key.split('|');
  const item = PK.itemsById[qid];
  if (!item || isFilled(item, pid)) return false;
  const st = PK.cells[key]?.status;
  return !st || st === 'not_found' || st === 'error';
}

function updateSelectionUi() {
  const n = PK.selected.size;
  $('pk-selected-text').textContent = `${n} sel dipilih`;
  $('pk-btn-run').disabled = n === 0 || PK.running > 0;
  $('pk-btn-run').textContent = n ? `✨ Cari dengan AI (${n})` : '✨ Cari dengan AI';
}

function toggleCell(key) {
  if (PK.selected.has(key)) PK.selected.delete(key);
  else if (selectable(key)) PK.selected.add(key);
  refreshCell(key);
  updateSelectionUi();
}

function initMatrix() {
  $('pk-matrix').addEventListener('click', e => {
    const colBtn = e.target.closest('.pk-col-select');
    if (colBtn) {
      visibleItems().forEach(it => {
        const key = cellKey(it.qid, colBtn.dataset.pid);
        if (selectable(key)) PK.selected.add(key);
      });
      renderMatrix();
      return;
    }
    const td = e.target.closest('td.pk-cell');
    if (!td) return;
    const key = td.dataset.key;
    const st  = PK.cells[key];
    if (st?.status === 'pending') { showTab('validasi'); selectCell(key); return; }
    toggleCell(key);
  });

  $('pk-only-incomplete').addEventListener('change', renderMatrix);
  $('pk-search').addEventListener('input', renderMatrix);
  $('pk-btn-clear').addEventListener('click', () => { PK.selected.clear(); renderMatrix(); });
  $('pk-btn-run').addEventListener('click', runSearch);
  $('pk-btn-stop').addEventListener('click', () => {
    PK.stopRequested = true;
    $('pk-btn-stop').disabled = true;
    $('pk-progress').textContent = 'Menghentikan setelah pencarian yang sedang berjalan…';
  });
}

// ---------------------------------------------------------------------------
// PENCARIAN AI (antrean di browser, maks. PK_CONCURRENCY paralel)
// ---------------------------------------------------------------------------
async function runSearch() {
  const settings = loadSettings();
  if (!settings.keys[settings.provider]) {
    appShowDialog(`API key ${PROVIDER_LABEL[settings.provider]} belum diisi. Buka ⚙ Pengaturan AI.`, 'alert', 'Pengaturan AI');
    return;
  }

  PK.queue = [...PK.selected];
  PK.selected.clear();
  PK.stopRequested = false;
  PK.queue.forEach(key => { PK.cells[key] = { status: 'queued' }; refreshCell(key); });

  const total = PK.queue.length;
  let done = 0;
  const progress = () => {
    $('pk-progress').textContent = `Mencari ${done}/${total} · ${PROVIDER_LABEL[settings.provider]}`;
  };
  $('pk-progress').classList.remove('hidden');
  $('pk-btn-stop').classList.remove('hidden');
  $('pk-btn-stop').disabled = false;
  progress();

  const worker = async () => {
    while (PK.queue.length && !PK.stopRequested) {
      const key = PK.queue.shift();
      const fatal = await searchCell(key, settings);
      done++;
      progress();
      if (fatal) {
        PK.stopRequested = true;
        appShowDialog(escHtml(fatal), 'alert', 'Pencarian dihentikan');
      }
    }
  };

  PK.running = PK_CONCURRENCY;
  updateSelectionUi();
  await Promise.all(Array.from({ length: PK_CONCURRENCY }, worker));
  PK.running = 0;

  // Sisa antrean yang belum sempat dicari kembali jadi kosong
  PK.queue.forEach(key => { delete PK.cells[key]; refreshCell(key); });
  PK.queue = [];

  $('pk-btn-stop').classList.add('hidden');
  $('pk-progress').textContent = `Selesai: ${done} dari ${total} dicari`;
  updateSelectionUi();
  renderQueue();
}

/** Cari satu sel. Kembalikan pesan bila kesalahannya fatal (mis. API key salah) agar antrean dihentikan. */
async function searchCell(key, settings) {
  const [qid, pid] = key.split('|');
  const item = PK.itemsById[qid];
  const attr = PK.skema.find(a => a.pid === pid);
  PK.cells[key] = { status: 'searching' };
  refreshCell(key);

  try {
    const res = await fetch('/api/perkaya/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        api_key:  settings.keys[settings.provider],
        model:    settings.models[settings.provider] || '',
        item: { qid, label: item.label, description: item.description, kategori: PK.kategori, lokasi: item.lokasi },
        attr: { pid, label: attr.label, type: attr.type, unit: attr.unit || '', unit_label: attr.unitLabel || '' },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      PK.cells[key] = { status: 'error', msg: data.error || `HTTP ${res.status}` };
      refreshCell(key);
      const fatal = res.status === 401 || /API key|tidak punya akses|Batas pemakaian/i.test(data.error || '');
      return fatal ? (data.error || 'Autentikasi diperlukan') : null;
    }
    upsertOpen(data);  // satu atau lebih kandidat (bila sumber berbeda pendapat)
    PK.cells[key] = { status: data[0].status, candId: data[0].id, msg: data[0].note || '' };
  } catch (err) {
    PK.cells[key] = { status: 'error', msg: err.message };
  }
  refreshCell(key);
  return null;
}

// ---------------------------------------------------------------------------
// KANDIDAT (server)
// ---------------------------------------------------------------------------
async function refreshOpenCandidates() {
  const res = await fetch('/api/perkaya/candidates?group=open');
  PK.open = res.ok ? await res.json() : [];
  syncCellsFromOpen();
  renderQueue();
}

function syncCellsFromOpen() {
  PK.cells = {};
  PK.open.forEach(c => {
    const key = cellKey(c.qid, c.pid);
    // Satu sel bisa punya beberapa kandidat (sumber berbeda pendapat); cukup status sekali
    if (!PK.cells[key]) PK.cells[key] = { status: c.status, candId: c.id, msg: c.note || '' };
  });
}

/** Ganti kandidat untuk satu sel dengan hasil pencarian terbaru (satu atau lebih kandidat). */
function upsertOpen(cands) {
  if (!cands.length) return;
  const key = cellKey(cands[0].qid, cands[0].pid);
  PK.open = PK.open.filter(c => cellKey(c.qid, c.pid) !== key);
  PK.open.unshift(...cands);
  renderQueue();
}

const VERIF_RANK = { terverifikasi: 4, nilai_di_halaman: 3, nilai_tidak_cocok: 2, gagal_dibuka: 1, tidak_terverifikasi: 0 };

/** Kandidat menunggu validasi untuk satu sel: paling terverifikasi dulu, lalu yang sumbernya paling banyak. */
function cellCandidates(key) {
  return PK.open
    .filter(c => c.status === 'pending' && cellKey(c.qid, c.pid) === key)
    .sort((a, b) => (VERIF_RANK[b.verification] ?? 0) - (VERIF_RANK[a.verification] ?? 0)
      || (b.sources?.length || 0) - (a.sources?.length || 0) || a.id - b.id);
}

/** Daftar sel yang punya kandidat menunggu validasi, urut nama butir lalu PID. */
function pendingCells() {
  const seen = new Map();
  PK.open.filter(c => c.status === 'pending').forEach(c => {
    const key = cellKey(c.qid, c.pid);
    if (!seen.has(key)) seen.set(key, c);
  });
  return [...seen.entries()]
    .sort(([, a], [, b]) => (a.item_label || '').localeCompare(b.item_label || '') || a.pid.localeCompare(b.pid))
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// TAB VALIDASI
// ---------------------------------------------------------------------------
const VERIF_VIEW = {
  terverifikasi:       { cls: 'ok',   label: 'Kutipan terverifikasi' },
  nilai_tidak_cocok:   { cls: 'warn', label: 'Nilai tidak ada di kutipan' },
  nilai_di_halaman:    { cls: 'warn', label: 'Kutipan tidak persis, nilai ada di halaman' },
  tidak_terverifikasi: { cls: 'bad',  label: 'Tidak terverifikasi' },
  gagal_dibuka:        { cls: 'muted', label: 'Sumber tidak bisa diperiksa otomatis' },
};
const verifView = status => VERIF_VIEW[status] || VERIF_VIEW.gagal_dibuka;

const displayValue = c => `${c.value}${c.unit_label ? ' ' + c.unit_label : ''}`;

function renderQueue() {
  const keys  = pendingCells();
  const badge = $('pk-count-validasi');
  badge.textContent = keys.length;
  badge.classList.toggle('hidden', !keys.length);

  $('pk-queue-list').innerHTML = keys.map(key => {
    const opts = cellCandidates(key);
    const c = opts[0];
    const sub = opts.length > 1
      ? `${escHtml(c.attr_label)}: ${opts.length} pilihan (${opts.map(o => escHtml(displayValue(o))).join(' / ')})`
      : `${escHtml(c.attr_label)}: ${escHtml(displayValue(c))}`;
    const v = verifView(c.verification);
    return `<li class="pk-queue-item${key === PK.currentKey ? ' active' : ''}" data-key="${escHtml(key)}">
      <span class="pk-dot pk-dot--${opts.length > 1 ? 'warn' : v.cls}" title="${opts.length > 1 ? 'Sumber berbeda pendapat' : escHtml(v.label)}"></span>
      <span class="pk-queue-text">
        <span class="pk-queue-title">${escHtml(c.item_label)}</span>
        <span class="pk-queue-sub">${sub}</span>
      </span>
    </li>`;
  }).join('') || '<li class="pk-empty-text">Tidak ada kandidat.</li>';

  if (!keys.includes(PK.currentKey)) {
    PK.currentKey = keys[0] ?? null;
    renderCard();
    $('pk-queue-list').querySelector(`[data-key="${CSS.escape(PK.currentKey || '')}"]`)?.classList.add('active');
  }
}

function selectCell(key) {
  PK.currentKey = key;
  $('pk-queue-list').querySelectorAll('.pk-queue-item').forEach(li =>
    li.classList.toggle('active', li.dataset.key === key));
  $('pk-queue-list').querySelector('.pk-queue-item.active')?.scrollIntoView({ block: 'nearest' });
  renderCard();
}

/** Bentuk penulisan nilai yang mungkin muncul di kutipan (untuk disorot). */
function valueVariants(c) {
  const v = String(c.value || '');
  if (c.datatype === 'quantity' && /^-?\d+$/.test(v)) {
    const n = Number(v);
    return [v, n.toLocaleString('id-ID'), n.toLocaleString('en-US')];
  }
  if (c.datatype === 'quantity') return [v, v.replace('.', ',')];
  if (c.datatype === 'time') return [v.split('-')[0]];
  return [v];
}

function highlightQuote(c, quote) {
  let html = escHtml(quote || '');
  valueVariants(c).filter(Boolean).sort((a, b) => b.length - a.length).forEach(v => {
    const safe = escHtml(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`);
  });
  return html;
}

function valueEditorHtml(c) {
  if (c.datatype === 'item') {
    return `<span class="prop-edit-field pk-item-field">
        <input type="text" id="pk-value-${c.id}" class="form-input" value="${escHtml(c.value)}" autocomplete="off">
        <ul class="prop-suggest hidden" role="listbox"></ul>
      </span>
      <small class="pk-hint">Pilih butir Wikidata yang tepat, atau ketik untuk mencari yang lain.</small>
      <ul id="pk-item-choices-${c.id}" class="pk-item-choices"><li class="pk-hint">Mencari butir yang cocok…</li></ul>`;
  }
  const type = c.datatype === 'quantity' ? 'number' : c.datatype === 'url' ? 'url' : 'text';
  return `<span class="pk-value-row">
      <input type="${type}" id="pk-value-${c.id}" class="form-input" value="${escHtml(c.value)}"${type === 'number' ? ' step="any"' : ''}>
      ${c.unit_label ? `<span class="pk-unit">${escHtml(c.unit_label)}</span>` : ''}
    </span>
    ${c.datatype === 'time' ? '<small class="pk-hint">Format: TTTT, TTTT-BB, atau TTTT-BB-HH</small>' : ''}`;
}

/** Satu sumber. Bila sumbernya lebih dari satu, ada radio untuk memilih yang dijadikan referensi. */
function sourceHtml(c, src, index, pickable) {
  const v = verifView(src.verification);
  let host = '';
  try { host = new URL(src.url).hostname; } catch {}
  return `<li class="pk-source${pickable && index === 0 ? ' selected' : ''}">
    <div class="pk-source-head">
      ${pickable ? `<input type="radio" name="pk-ref-${c.id}" value="${index}"${index === 0 ? ' checked' : ''}
        ${src.url ? '' : 'disabled'} aria-label="Jadikan referensi">` : ''}
      <strong>${escHtml(src.title || host || 'Sumber')}</strong>
      <span class="pk-source-verif pk-source-verif--${v.cls}" title="${escHtml(src.verify_note || '')}">${escHtml(v.label)}</span>
    </div>
    ${src.url ? `<a href="${escHtml(src.url)}" target="_blank" rel="noopener" class="pk-source-url break-all">${escHtml(src.url)} ↗</a>` : ''}
    <blockquote class="pk-quote">${highlightQuote(c, src.quote) || '<em>Tidak ada kutipan</em>'}</blockquote>
  </li>`;
}

function optionHtml(c, index, multi) {
  const sources = c.sources || [];
  const pickable = sources.length > 1;
  return `<section class="pk-option${multi && index === 0 ? ' selected' : ''}" data-id="${c.id}">
    ${multi ? `<label class="pk-option-head">
        <input type="radio" name="pk-option" value="${c.id}"${index === 0 ? ' checked' : ''}>
        Pilihan ${index + 1}: <strong>${escHtml(displayValue(c))}</strong>
        <span class="pk-option-count">· ${sources.length} sumber</span>
      </label>` : ''}
    <div class="pk-field">
      <label class="pk-field-label" for="pk-value-${c.id}">Nilai</label>
      <div>${valueEditorHtml(c)}</div>
    </div>
    <div class="pk-field">
      <span class="pk-field-label">Sumber (${sources.length})</span>
      <div>
        ${pickable ? '<small class="pk-hint">Pilih satu sumber yang dijadikan referensi.</small>' : ''}
        <ol class="pk-sources">${sources.map((src, i) => sourceHtml(c, src, i, pickable)).join('') || '<li class="pk-hint">Tanpa sumber</li>'}</ol>
      </div>
    </div>
  </section>`;
}

function renderCard() {
  const card = $('pk-card');
  const opts = PK.currentKey ? cellCandidates(PK.currentKey) : [];
  if (!opts.length) {
    card.innerHTML = '<p class="pk-empty-text">Belum ada kandidat. Jalankan pencarian AI di tab Kelengkapan.</p>';
    return;
  }
  const c = opts[0];
  const multi = opts.length > 1;

  card.innerHTML = `
    <header class="pk-card-head">
      <a href="https://www.wikidata.org/wiki/${escHtml(c.qid)}" target="_blank" rel="noopener" class="pk-card-title">${escHtml(c.item_label)}</a>
      <span class="pk-card-sub">${escHtml(c.qid)} · ${escHtml(c.kategori || '')}</span>
    </header>

    <div class="pk-field">
      <span class="pk-field-label">Atribut</span>
      <span><a href="https://www.wikidata.org/wiki/Property:${escHtml(c.pid)}" target="_blank" rel="noopener">${escHtml(c.attr_label)} (${escHtml(c.pid)})</a></span>
    </div>

    ${multi ? `<div class="pk-verif pk-verif--warn">
        <strong>Sumber berbeda pendapat — ${opts.length} pilihan nilai</strong>
        <span>Periksa sumbernya, lalu pilih satu nilai untuk disimpan. Pilihan lain akan ditolak otomatis.</span>
      </div>` : ''}

    ${opts.map((o, i) => optionHtml(o, i, multi)).join('')}

    ${c.note ? `<p class="pk-note">Catatan AI: ${escHtml(c.note)}</p>` : ''}
    <p class="pk-meta">Dicari dengan ${escHtml(PROVIDER_LABEL[c.provider] || c.provider)} · ${escHtml(c.model || '')}</p>

    <div class="pk-card-actions">
      <button id="pk-btn-reject" class="btn btn--secondary" type="button">✕ Tolak${multi ? ' semua' : ''}</button>
      <button id="pk-btn-approve" class="btn btn--primary" type="button">✓ Setujui${multi ? ' pilihan terpilih' : ''} &amp; simpan ke Wikidata</button>
    </div>
    <p id="pk-card-status" class="pk-card-status hidden"></p>`;

  opts.forEach(o => {
    if (o.datatype !== 'item') return;
    const section = card.querySelector(`.pk-option[data-id="${o.id}"]`);
    attachItemSuggest($(`pk-value-${o.id}`), section.querySelector('.prop-suggest'));
    renderItemChoices(o);
  });
  card.querySelectorAll('input[name="pk-option"]').forEach(radio => radio.addEventListener('change', () =>
    card.querySelectorAll('.pk-option').forEach(sec =>
      sec.classList.toggle('selected', sec.dataset.id === radio.value))));
  // Mengisi/mengubah nilai sebuah pilihan otomatis memilih pilihan itu
  card.querySelectorAll('.pk-option').forEach(sec => sec.addEventListener('focusin', () => {
    const radio = sec.querySelector('input[name="pk-option"]');
    if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
  }));
  card.querySelectorAll('.pk-sources input[type="radio"]').forEach(radio => radio.addEventListener('change', () =>
    radio.closest('.pk-sources').querySelectorAll('.pk-source').forEach(li =>
      li.classList.toggle('selected', li.contains(radio)))));
  $('pk-btn-approve').addEventListener('click', approveCurrent);
  $('pk-btn-reject').addEventListener('click', rejectCurrent);
}

/** Tampilkan butir Wikidata yang cocok dengan nama dari AI sebagai pilihan di bawah input. */
async function renderItemChoices(c) {
  const list  = $(`pk-item-choices-${c.id}`);
  const input = $(`pk-value-${c.id}`);
  let results = [];
  try { results = await searchWikidataItems(c.value); } catch {}
  if (!list || !list.isConnected) return;  // kartu sudah berganti

  list.innerHTML = results.length
    ? results.slice(0, 5).map(it => `
        <li><button type="button" class="pk-item-choice" data-qid="${escHtml(it.id)}" data-label="${escHtml(it.label)}">
          <strong>${escHtml(it.label)}</strong> <span class="pk-choice-qid">${escHtml(it.id)}</span>
          ${it.description ? `<span class="pk-choice-desc">${escHtml(it.description)}</span>` : ''}
        </button></li>`).join('')
    : '<li class="pk-hint">Tidak ada butir yang cocok — ketik nama lain di atas.</li>';

  list.addEventListener('click', e => {
    const btn = e.target.closest('.pk-item-choice');
    if (!btn) return;
    input.value = btn.dataset.label;
    input.dataset.qid = btn.dataset.qid;
    input.dataset.label = btn.dataset.label;
    list.querySelectorAll('.pk-item-choice').forEach(b => b.classList.toggle('selected', b === btn));
  });
  // Mengetik manual membatalkan pilihan dari daftar ini
  input.addEventListener('input', () =>
    list.querySelectorAll('.pk-item-choice').forEach(b => b.classList.remove('selected')));
}

function setCardStatus(type, msg) {
  const el = $('pk-card-status');
  if (!el) return;
  el.className = `pk-card-status pk-card-status--${type}`;
  el.textContent = msg;
}

function setCardBusy(busy) {
  ['pk-btn-approve', 'pk-btn-reject'].forEach(id => { if ($(id)) $(id).disabled = busy; });
}

/** Sel selesai divalidasi (disetujui/ditolak semua): bersihkan antrean & perbarui matriks. */
function afterResolved(key, published) {
  PK.open = PK.open.filter(c => cellKey(c.qid, c.pid) !== key);
  delete PK.cells[key];
  if (published && PK.itemsById[published.qid]) {
    const text = [published.published_value || published.value, published.unit_label].filter(Boolean).join(' ');
    PK.itemsById[published.qid].values[published.pid] = { text };
  }
  if ($('pk-matrix-wrap') && !$('pk-matrix-wrap').classList.contains('hidden')) refreshCell(key);
  loadHistory();
  // Lanjut ke sel berikutnya
  PK.currentKey = pendingCells()[0] ?? null;
  renderQueue();
  renderCard();
}

function selectedOption() {
  const opts = cellCandidates(PK.currentKey);
  const checked = document.querySelector('input[name="pk-option"]:checked');
  return checked ? opts.find(o => String(o.id) === checked.value) : opts[0];
}

async function approveCurrent() {
  const c = selectedOption();
  if (!c) return;
  const input = $(`pk-value-${c.id}`);
  const body = c.datatype === 'item'
    ? { value_qid: input.dataset.qid || '', value_label: input.dataset.label || '' }
    : { value: input.value.trim() };
  body.source_index = Number(document.querySelector(`input[name="pk-ref-${c.id}"]:checked`)?.value ?? 0);
  if (c.datatype === 'item' && !body.value_qid) {
    setCardStatus('error', 'Pilih butir Wikidata dari daftar saran terlebih dahulu.');
    input.focus();
    return;
  }

  setCardBusy(true);
  setCardStatus('info', 'Menyimpan ke Wikidata…');
  try {
    const res  = await fetch(`/api/perkaya/candidates/${c.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCardStatus('error', data.error || `Gagal (HTTP ${res.status})`);
      setCardBusy(false);
      return;
    }
    if (data.warning) appShowDialog(escHtml(data.warning), 'alert', 'Tersimpan dengan catatan');
    afterResolved(PK.currentKey, data);
  } catch (err) {
    setCardStatus('error', err.message);
    setCardBusy(false);
  }
}

async function rejectCurrent() {
  const key  = PK.currentKey;
  const opts = cellCandidates(key);
  if (!opts.length) return;
  setCardBusy(true);
  try {
    for (const c of opts) {
      const res = await fetch(`/api/perkaya/candidates/${c.id}/reject`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCardStatus('error', data.error || 'Gagal');
        setCardBusy(false);
        return;
      }
    }
    afterResolved(key, null);
  } catch (err) {
    setCardStatus('error', err.message);
    setCardBusy(false);
  }
}

function initValidasi() {
  $('pk-queue-list').addEventListener('click', e => {
    const li = e.target.closest('.pk-queue-item');
    if (li) selectCell(li.dataset.key);
  });

  document.addEventListener('keydown', e => {
    if (PK.activeTab !== 'validasi' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input:not([type="radio"]), textarea, select') || !$('pk-settings').classList.contains('hidden')) return;
    const keys = pendingCells();
    const idx  = keys.indexOf(PK.currentKey);
    const key  = e.key.toLowerCase();
    if ((key === 'arrowdown' || key === 'j') && idx < keys.length - 1) { e.preventDefault(); selectCell(keys[idx + 1]); }
    else if ((key === 'arrowup' || key === 'k') && idx > 0) { e.preventDefault(); selectCell(keys[idx - 1]); }
  });
}

// ---------------------------------------------------------------------------
// TAB RIWAYAT
// ---------------------------------------------------------------------------
async function loadHistory() {
  const res = await fetch('/api/perkaya/candidates?group=history');
  PK.history = res.ok ? await res.json() : [];
  renderHistory();
}

function renderHistory() {
  const fmt = iso => {
    try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return iso; }
  };
  $('pk-history-body').innerHTML = PK.history.map(c => {
    const status = c.status === 'published'
      ? `<span class="pk-status pk-status--ok">Terbit</span>${c.revid ? ` <a href="https://www.wikidata.org/w/index.php?diff=${c.revid}" target="_blank" rel="noopener">diff ↗</a>` : ''}`
      : '<span class="pk-status pk-status--muted">Ditolak</span>';
    const nilai = c.status === 'published' ? (c.published_value || c.value) : c.value;
    return `<tr>
      <td>${escHtml(fmt(c.updated_at))}</td>
      <td><a href="https://www.wikidata.org/wiki/${escHtml(c.qid)}" target="_blank" rel="noopener">${escHtml(c.item_label)}</a></td>
      <td>${escHtml(c.attr_label)}</td>
      <td>${escHtml(nilai || '')}${c.unit_label && c.status === 'published' ? ' ' + escHtml(c.unit_label) : ''}</td>
      <td>${status}</td>
      <td>${(c.sources || []).filter(src => src.url).map(src =>
        `<a href="${escHtml(src.url)}" target="_blank" rel="noopener">${escHtml(src.title || 'sumber')} ↗</a>`).join('<br>') || '–'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="pk-empty-text">Belum ada riwayat.</td></tr>';
}

// ---------------------------------------------------------------------------
// TAB
// ---------------------------------------------------------------------------
function showTab(name) {
  PK.activeTab = name;
  document.querySelectorAll('.pk-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['kelengkapan', 'validasi', 'riwayat'].forEach(t =>
    $(`pk-tab-${t}`).classList.toggle('hidden', t !== name));
  if (name === 'riwayat') loadHistory();
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  if (!$('pk-tab-kelengkapan')) return;  // belum login

  enhanceSearchableSelect($('pk-provinsi'), 'Ketik atau pilih provinsi…');
  enhanceSearchableSelect($('pk-negara'), 'Ketik atau pilih negara…');
  enhanceSearchableSelect($('pk-kategori'), 'Ketik atau pilih kategori…');
  $('pk-wilayah-tipe').addEventListener('change', updateWilayahVisibility);
  updateWilayahVisibility();

  document.querySelectorAll('.pk-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('pk-btn-muat').addEventListener('click', loadItems);

  initSettings();
  initMatrix();
  initValidasi();
  refreshOpenCandidates();

  if (applyQueryParams()) loadItems();
});
