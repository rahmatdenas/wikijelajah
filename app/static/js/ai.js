'use strict';

/* ==========================================================================
   ai.js — Bersama untuk panel detail (tombol ✨ AI) dan halaman Perkaya Data:
   pengaturan AI di localStorage, lalu panggilan cari / setujui / tolak kandidat.
   Kandidat tersimpan di server, jadi hasil dari panel detail juga muncul di
   antrean Validasi Perkaya Data (dan sebaliknya).
   Butuh: ui.js. Modal pengaturan ada di _ai_settings.html (hanya bila login).
   ========================================================================== */

const AI_SETTINGS_KEY = 'wj-perkaya-ai';
const PROVIDER_LABEL  = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', groq: 'Groq' };

// ---------------------------------------------------------------------------
// PENGATURAN (API key hanya disimpan di browser ini)
// ---------------------------------------------------------------------------
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || '{}'); } catch { s = {}; }
  return { provider: s.provider || 'claude', keys: s.keys || {}, models: s.models || {} };
}

function saveSettings(s) {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

/** API key penyedia terpilih sudah diisi? */
function aiReady() {
  const s = loadSettings();
  return !!s.keys[s.provider];
}

/** Tampilkan hanya isian penyedia yang dipilih; isian lain tetap ada (tersembunyi) sehingga ikut tersimpan. */
function showProviderFields() {
  const provider = $('pk-set-provider').value;
  document.querySelectorAll('.pk-set-provider').forEach(fs =>
    fs.classList.toggle('hidden', fs.dataset.provider !== provider));
}

let _afterSettingsSaved = null;

/** Buka pengaturan; onSaved dipanggil sekali bila pengguna menyimpan (mis. lanjutkan pencarian). */
function openSettings(onSaved = null) {
  if (!$('pk-settings')) return;
  _afterSettingsSaved = typeof onSaved === 'function' ? onSaved : null;
  const s = loadSettings();
  $('pk-set-provider').value = s.provider;
  Object.keys(PROVIDER_LABEL).forEach(p => {
    $(`pk-set-key-${p}`).value   = s.keys[p] || '';
    $(`pk-set-model-${p}`).value = s.models[p] || '';
  });
  showProviderFields();
  $('pk-settings').classList.remove('hidden');
}

function closeSettings() { $('pk-settings')?.classList.add('hidden'); }

function initSettings() {
  if (!$('pk-settings')) return;
  $('pk-settings-close').addEventListener('click', closeSettings);
  $('pk-settings-cancel').addEventListener('click', closeSettings);
  $('pk-set-provider').addEventListener('change', showProviderFields);
  $('pk-settings-save').addEventListener('click', () => {
    const s = { provider: $('pk-set-provider').value, keys: {}, models: {} };
    Object.keys(PROVIDER_LABEL).forEach(p => {
      const key   = $(`pk-set-key-${p}`).value.trim();
      const model = $(`pk-set-model-${p}`).value.trim();
      if (key)   s.keys[p]   = key;
      if (model) s.models[p] = model;
    });
    saveSettings(s);
    closeSettings();
    document.dispatchEvent(new CustomEvent('wj:ai-settings'));
    const next = _afterSettingsSaved;
    _afterSettingsSaved = null;
    if (next && aiReady()) next();
  });
}

// ---------------------------------------------------------------------------
// PANGGILAN SERVER
// ---------------------------------------------------------------------------

/**
 * Cari nilai satu atribut untuk satu butir.
 * item: { qid, label, description, kategori, lokasi }; attr: entri skema (wikidata.js).
 * Hasil: { ok, status, data } — data berupa daftar kandidat bila ok, atau { error, fatal }.
 */
async function aiSearch(item, attr, settings = loadSettings()) {
  const res = await fetch('/api/enrich/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: settings.provider,
      api_key:  settings.keys[settings.provider],
      model:    settings.models[settings.provider] || '',
      item,
      attr: { pid: attr.pid, label: attr.label, type: attr.type, unit: attr.unit || '', unit_label: attr.unitLabel || '' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function aiApprove(candId, body) {
  const res = await fetch(`/api/enrich/candidates/${candId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function aiReject(candId) {
  const res = await fetch(`/api/enrich/candidates/${candId}/reject`, { method: 'POST' });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/** Kandidat terbuka (menunggu validasi / tidak ditemukan) milik pengguna. */
async function aiOpenCandidates() {
  const res = await fetch('/api/enrich/candidates?group=open');
  return res.ok ? res.json() : [];
}

// Urutan kepercayaan hasil verifikasi sumber (sama dengan server)
const VERIF_RANK = { terverifikasi: 4, nilai_di_halaman: 3, nilai_tidak_cocok: 2, gagal_dibuka: 1, tidak_terverifikasi: 0 };

/** Kandidat menunggu validasi: paling terverifikasi dulu, lalu yang sumbernya paling banyak. */
function sortCandidates(cands) {
  return cands.slice().sort((a, b) => (VERIF_RANK[b.verification] ?? 0) - (VERIF_RANK[a.verification] ?? 0)
    || (b.sources?.length || 0) - (a.sources?.length || 0) || a.id - b.id);
}

document.addEventListener('DOMContentLoaded', initSettings);
