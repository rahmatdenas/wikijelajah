'use strict';

// Unduh daftar hasil yang sedang tampil (ikut saringan & urutan) sebagai CSV atau Excel (.xlsx).

// SheetJS hanya dimuat saat pertama kali mengunduh Excel
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let _xlsxP = null;

function loadXlsx() {
  _xlsxP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_SRC;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { _xlsxP = null; reject(new Error(msg('export-lib-failed'))); };
    document.head.appendChild(s);
  });
  return _xlsxP;
}

// Kolom yang bisa dipilih di modal unduh; label(nearby) karena "Wilayah" menjadi "Jenis" pada "Di sekitar saya"
const EXPORT_COLUMNS = [
  { key: 'qid',      label: () => 'QID',                            value: r => r.id },
  { key: 'name',     label: () => msg('export-col-name'),           value: r => r.title },
  { key: 'location', label: () => msg('export-col-location'),
    value: r => (r.lokasi || []).map(l => l.label).join('; ') || r.lokLabel || '' },
  { key: 'region',   label: nearby => msg(nearby ? 'export-col-type' : 'export-col-region'),
    value: r => (r.provLabels || []).join('; ') },
  { key: 'distance', label: () => msg('export-col-distance'),       nearbyOnly: true,
    value: r => (r.dist !== undefined ? +r.dist.toFixed(2) : '') },
  { key: 'year',     label: () => msg('export-col-year'),           value: r => r.yearStr || '' },
  { key: 'lat',      label: () => msg('export-col-lat'),            value: r => r.lat ?? '' },
  { key: 'lon',      label: () => msg('export-col-lon'),            value: r => r.lon ?? '' },
  { key: 'photo',    label: () => msg('export-col-photo'),
    value: r => (r.imageFilename ? commonsFilePageUrl(r.imageFilename) : '') },
  { key: 'article',  label: () => msg('export-col-article'),
    value: r => (r.articleTitle ? `${WIKI_BASE}/wiki/${encodeURIComponent(r.articleTitle)}` : '') },
  { key: 'wikidata', label: () => 'Wikidata',                       value: r => `https://www.wikidata.org/wiki/${r.id}` },
];

const isNearbySearch = () => State.params?.wilayah === 'sekitar';
const exportColumns = () => EXPORT_COLUMNS.filter(c => !c.nearbyOnly || isNearbySearch());

/** Tabel hasil (kolom `keys`): baris kepala lalu satu baris per butir. Foto/artikel kosong bila medianya belum termuat. */
function exportRows(keys) {
  const cols = exportColumns().filter(c => keys.includes(c.key));
  const nearby = isNearbySearch();
  return [
    cols.map(c => c.label(nearby)),
    ...State.visibleIds.map(id => cols.map(c => c.value(State.records[id]))),
  ];
}

function toCsv(rows) {
  const cell = v => {
    let s = String(v ?? '');
    // Teks yang diawali = + - @ dibaca sebagai rumus oleh spreadsheet (angka dibiarkan, mis. lintang negatif)
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}

/** "wikijelajah-museum-bali-2026-11-23.csv" */
function exportFilename(ext) {
  const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = [slug(State.params?.klasterLabel), slug(State.params?.wilayahNama)].filter(Boolean);
  return `wikijelajah-${parts.join('-')}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function downloadResults(format, keys) {
  const rows = exportRows(keys);
  try {
    if (format === 'csv') {
      // BOM agar Excel membaca huruf non-ASCII (é, ñ, aksara) dengan benar
      saveBlob(new Blob(['\ufeff' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), exportFilename('csv'));
    } else {
      const XLSX = await loadXlsx();
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'WikiJelajah');
      XLSX.writeFile(wb, exportFilename('xlsx'));
    }
  } catch (err) {
    showToast(msg('export-failed', err.message), { type: 'error' });
  }
}

// Pilihan terakhir (format & kolom yang tidak dicentang) diingat di browser ini saja
const EXPORT_PREFS_KEY = 'wj-export-prefs';

function _loadExportPrefs() {
  try { return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || '{}'); } catch { return {}; }
}

function openExportModal() {
  if (!State.visibleIds.length) {
    showToast(msg('export-empty'), { type: 'error' });
    return;
  }
  const prefs = _loadExportPrefs();
  const off = new Set(prefs.off || []);
  const nearby = isNearbySearch();
  $('export-count').textContent = msg('export-count', State.visibleIds.length);
  document.querySelector(`input[name="export-format"][value="${prefs.format === 'csv' ? 'csv' : 'xlsx'}"]`).checked = true;
  $('export-columns').innerHTML = exportColumns().map(c => `
    <label class="upload-check export-col">
      <input type="checkbox" value="${c.key}"${off.has(c.key) ? '' : ' checked'}> ${escHtml(c.label(nearby))}
    </label>`).join('');
  updateExportSubmit();
  $('export-modal').classList.remove('hidden');
}

function closeExportModal() {
  $('export-modal')?.classList.add('hidden');
}

const checkedExportColumns = () =>
  [...$('export-columns').querySelectorAll('input:checked')].map(i => i.value);

function updateExportSubmit() {
  $('export-btn-submit').disabled = !checkedExportColumns().length;
}

function initExport() {
  const modal = $('export-modal');
  if (!modal) return;
  $('btn-unduh')?.addEventListener('click', openExportModal);
  $('export-modal-close')?.addEventListener('click', closeExportModal);
  $('export-btn-cancel')?.addEventListener('click', closeExportModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeExportModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeExportModal(); });
  $('export-columns').addEventListener('change', updateExportSubmit);
  $('export-select-all')?.addEventListener('click', () => {
    const boxes = [...$('export-columns').querySelectorAll('input')];
    const all = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !all; });
    updateExportSubmit();
  });
  $('export-btn-submit').addEventListener('click', () => {
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'xlsx';
    const keys = checkedExportColumns();
    const off = exportColumns().map(c => c.key).filter(k => !keys.includes(k));
    try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({ format, off })); } catch {}
    closeExportModal();
    downloadResults(format, keys);
  });
}
