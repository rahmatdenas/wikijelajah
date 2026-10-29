'use strict';

/* ==========================================================================
   ui.js — Helper UI bersama untuk semua halaman (Jelajah & Perkaya):
   terjemahan, escaping, dialog, combobox, saran butir Wikidata,
   konteks pencarian bersama, dan panduan singkat.
   ========================================================================== */

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// TERJEMAHAN — pesan dari i18n/*.json, disisipkan server di base.html (I18N)
// Sintaks: $1 parameter, {{PLURAL:$1|satu|banyak}}, {{formatnum:$1}} angka.
// ---------------------------------------------------------------------------
const _banana = new Banana(I18N.lang, { messages: { [I18N.lang]: I18N.messages } });

/** Teks pesan polos. Hasilnya harus di-escape bila dimasukkan ke innerHTML. */
function msg(key, ...params) {
  return _banana.i18n(key, ...params);
}

/**
 * Pesan sebagai HTML aman: teks pesan & parameter biasa di-escape; parameter
 * berbentuk { html: '…' } disisipkan apa adanya (mis. tautan atau <strong>).
 */
function msgHtml(key, ...params) {
  const html = [];
  const args = params.map(p => (p && typeof p === 'object' && 'html' in p)
    ? `\u0001${html.push(p.html) - 1}\u0001` : p);
  return escHtml(msg(key, ...args)).replace(/\u0001(\d+)\u0001/g, (_, i) => html[i]);
}

/** Angka sesuai bahasa antarmuka (pemisah ribuan/desimal). */
function formatNumber(n, opts) {
  return Number(n).toLocaleString(I18N.lang, opts);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// DIALOG — global agar map.js bisa akses
// ---------------------------------------------------------------------------
function appShowDialog(html, type = 'alert', title = msg('dialog-message')) {
  const overlay = $('dialog-overlay');
  if (!overlay) { alert(title + '\n' + html.replace(/<[^>]+>/g, '')); return; }
  const titleEl = overlay.querySelector('.dialog-title') || $('dialog-title');
  const bodyEl  = overlay.querySelector('.dialog-body')  || $('dialog-message');
  const cancelEl = $('dialog-btn-cancel');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML    = html;
  cancelEl?.classList.toggle('hidden', type === 'alert');
  overlay.classList.remove('hidden');
}

window.appShowDialog = appShowDialog;

/** Dialog konfirmasi: resolve true bila pengguna menekan OK, false bila batal/menutup. */
function appConfirm(html, title = msg('dialog-warning')) {
  const overlay = $('dialog-overlay');
  if (!overlay) return Promise.resolve(confirm(title + '\n' + html.replace(/<[^>]+>/g, '')));
  appShowDialog(html, 'confirm', title);
  return new Promise(resolve => {
    const ctrl = new AbortController();
    const done = ok => { ctrl.abort(); resolve(ok); };
    $('dialog-btn-confirm')?.addEventListener('click', () => done(true), { signal: ctrl.signal });
    $('dialog-btn-cancel')?.addEventListener('click', () => done(false), { signal: ctrl.signal });
    overlay.addEventListener('click', e => { if (!e.target.closest('.dialog-box')) done(false); }, { signal: ctrl.signal });
  });
}

window.appConfirm = appConfirm;

// ---------------------------------------------------------------------------
// SELECT YANG BISA DIKETIK (combobox)
// <select> asli tetap jadi sumber kebenaran (disembunyikan): nilai dipilih
// lewat select.selectedIndex lalu event 'change' dikirim, sehingga kode lain
// tetap membaca option terpilih beserta data-* seperti biasa.
// ---------------------------------------------------------------------------
function _normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function enhanceSearchableSelect(select, placeholder = msg('combo-placeholder')) {
  const wrap  = document.createElement('div');
  const input = document.createElement('input');
  const list  = document.createElement('ul');
  const listId = `${select.id}-list`;

  wrap.className = 'combo';
  input.type = 'text';
  input.id = `${select.id}-combo`;
  input.className = 'form-input form-select combo-input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  list.id = listId;
  list.className = 'combo-list hidden';
  list.setAttribute('role', 'listbox');

  // Bangun daftar dari option/optgroup; option disabled (placeholder) dilewati
  const entries = [];
  [...select.options].forEach((opt, index) => {
    if (opt.disabled) return;
    const group = opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement.label : '';
    const label = opt.textContent.trim();
    entries.push({ index, label, group, words: _normalize(`${label} ${group}`).split(/[^a-z0-9]+/).filter(Boolean) });
  });

  select.classList.add('hidden');
  select.after(wrap);
  wrap.append(input, list);
  document.querySelector(`label[for="${select.id}"]`)?.setAttribute('for', input.id);

  let visible = [];
  let active  = -1;

  const selectedLabel = () => {
    const opt = select.options[select.selectedIndex];
    return opt && !opt.disabled ? opt.textContent.trim() : '';
  };

  const render = term => {
    // Setiap kata yang diketik harus menjadi awal salah satu kata di label/grup
    // ("gun" → Gunung, bukan semua isi grup "Bangunan")
    const terms = _normalize(term).split(/[^a-z0-9]+/).filter(Boolean);
    visible = entries.filter(e => terms.every(t => e.words.some(w => w.startsWith(t))));
    active  = visible.length ? 0 : -1;

    let lastGroup = null;
    list.innerHTML = visible.length
      ? visible.map((e, i) => {
          const header = e.group !== lastGroup && e.group
            ? `<li class="combo-group" role="presentation">${escHtml(e.group)}</li>` : '';
          lastGroup = e.group;
          return `${header}<li class="combo-option${i === active ? ' active' : ''}" role="option" data-i="${i}">${escHtml(e.label)}</li>`;
        }).join('')
      : `<li class="combo-empty">${escHtml(msg('not-found'))}</li>`;
  };

  const setActive = i => {
    active = i;
    list.querySelectorAll('.combo-option').forEach(li =>
      li.classList.toggle('active', Number(li.dataset.i) === i));
    list.querySelector('.combo-option.active')?.scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    render('');
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    // Tandai pilihan saat ini agar mudah terlihat
    const cur = visible.findIndex(e => e.index === select.selectedIndex);
    if (cur >= 0) setActive(cur);
  };

  const close = () => {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    input.value = selectedLabel();
  };

  const choose = i => {
    const e = visible[i];
    if (!e) return;
    select.selectedIndex = e.index;
    select.dispatchEvent(new Event('change'));
    close();
  };

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('click', () => {
    if (list.classList.contains('hidden')) { input.select(); open(); }
  });
  input.addEventListener('input', () => {
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    render(input.value);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.classList.contains('hidden')) open();
      else if (visible.length) setActive(Math.min(active + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible.length) setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.classList.contains('hidden')) choose(active);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== input) close();  // abaikan bila sudah fokus lagi
  }, 150));

  // Cegah input blur saat daftar ditekan; pilihan dicatat di 'click'
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const li = e.target.closest('.combo-option');
    if (li) choose(Number(li.dataset.i));
  });

  // Sinkron bila select diubah dari kode lain
  select.addEventListener('change', () => { input.value = selectedLabel(); });
  input.value = selectedLabel();
}

// ---------------------------------------------------------------------------
// SARAN BUTIR WIKIDATA untuk input bertipe item (butuh searchWikidataItems
// dari wikidata.js). Pilihan disimpan di input.dataset.qid / .label.
// ---------------------------------------------------------------------------
function attachItemSuggest(input, list) {
  let timer = null;
  let ctrl  = null;

  input.addEventListener('input', () => {
    delete input.dataset.qid;
    delete input.dataset.label;
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) { list.classList.add('hidden'); return; }

    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const results = await searchWikidataItems(term, ctrl.signal);
        list.innerHTML = results.length
          ? results.map(it => `
              <li class="prop-suggest-item" role="option"
                  data-qid="${escHtml(it.id)}" data-label="${escHtml(it.label)}">
                <span class="prop-suggest-label">${escHtml(it.label)}</span>
                <span class="prop-suggest-qid">${escHtml(it.id)}</span>
                ${it.description ? `<span class="prop-suggest-desc">${escHtml(it.description)}</span>` : ''}
              </li>`).join('')
          : `<li class="prop-suggest-empty">${escHtml(msg('not-found'))}</li>`;
        list.classList.remove('hidden');
      } catch (err) {
        if (err.name !== 'AbortError') list.classList.add('hidden');
      }
    }, 250);
  });

  // mousedown (bukan click) agar input tidak kehilangan fokus sebelum pilihan tercatat
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.prop-suggest-item');
    if (!li) return;
    e.preventDefault();
    input.value         = li.dataset.label;
    input.dataset.qid   = li.dataset.qid;
    input.dataset.label = li.dataset.label;
    list.classList.add('hidden');
  });

  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
}

// ---------------------------------------------------------------------------
// DROPDOWN di top nav: profil & pilih bahasa
// ---------------------------------------------------------------------------
function initTopNavMenu(toggleId, menuId) {
  const toggle = $(toggleId);
  const menu   = $(menuId);
  if (!toggle || !menu) return;

  const setOpen = open => {
    menu.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => setOpen(menu.classList.contains('hidden')));
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setOpen(false); toggle.focus(); }
  });
}

// ---------------------------------------------------------------------------
// NOTIFIKASI SINGKAT (toast) — konfirmasi setelah menyimpan, hilang sendiri
// ---------------------------------------------------------------------------
/**
 * @param {string} text  teks polos
 * @param {{type?: 'success'|'error', link?: {href: string, label: string}}} opts
 */
function showToast(text, { type = 'success', link = null } = {}) {
  let wrap = $('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${type === 'success' ? '✓' : '!'}</span>
    <span class="toast-text">${escHtml(text)}</span>
    ${link ? `<a class="toast-link" href="${escHtml(link.href)}" target="_blank" rel="noopener">${escHtml(link.label)} ↗</a>` : ''}
    <button type="button" class="toast-close" aria-label="${escHtml(msg('button-close'))}">×</button>`;
  const remove = () => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-close').addEventListener('click', remove);
  wrap.appendChild(el);
  setTimeout(remove, 6000);
}

/** Konfirmasi tersimpan ke Wikidata, dengan tautan ke suntingannya bila revid diketahui. */
function toastSaved(attrLabel, itemLabel, revid) {
  showToast(msg('toast-saved', attrLabel, itemLabel), {
    link: revid ? { href: `https://www.wikidata.org/w/index.php?diff=${revid}`, label: msg('toast-view-edit') } : null,
  });
}

// ---------------------------------------------------------------------------
// KONTEKS PENCARIAN BERSAMA — wilayah & kategori terakhir dibawa antarhalaman
// (Jelajah ↔ Perkaya Data) lewat parameter URL yang sama:
// ?region=province|all|abroad|area&province=Q..&country=Q..&area=Q..&category=<slug>
// ---------------------------------------------------------------------------
const WJ_CONTEXT_KEY = 'wj-context';

// Nilai ?region= di URL ↔ nilai internal tipe wilayah
const REGION_FROM_PARAM = { province: 'provinsi', all: 'all', abroad: 'luar_negeri', area: 'qid' };
const REGION_TO_PARAM = Object.fromEntries(Object.entries(REGION_FROM_PARAM).map(([k, v]) => [v, k]));

function loadSearchContext() {
  try { return JSON.parse(localStorage.getItem(WJ_CONTEXT_KEY) || 'null'); } catch { return null; }
}

function saveSearchContext(ctx) {
  try { localStorage.setItem(WJ_CONTEXT_KEY, JSON.stringify(ctx)); } catch {}
  updateNavLinks();
}

function contextQuery(ctx) {
  if (!ctx?.category) return '';
  const q = new URLSearchParams();
  if (ctx.region) q.set('region', ctx.region);
  ['province', 'country', 'area'].forEach(k => { if (ctx[k]) q.set(k, ctx[k]); });
  q.set('category', ctx.category);
  return q.toString();
}

function contextUrl(path, ctx) {
  const q = contextQuery(ctx);
  return q ? `${path}?${q}` : path;
}

/** Tautan antarhalaman (logo, menu akun, dll.) membawa konteks terakhir, kecuali ke halaman yang sedang dibuka. */
function updateNavLinks() {
  const ctx = loadSearchContext();
  document.querySelectorAll('a[data-nav-context]').forEach(a => {
    if (a.pathname === location.pathname) return;
    a.dataset.basePath ||= a.pathname;
    a.href = contextUrl(a.dataset.basePath, ctx);
  });
}

// ---------------------------------------------------------------------------
// PANDUAN SINGKAT — terbuka otomatis sekali pada kunjungan pertama
// ---------------------------------------------------------------------------
const WJ_GUIDE_KEY = 'wj-guide-seen';

function openGuide() { $('guide-modal')?.classList.remove('hidden'); }

function closeGuide() {
  $('guide-modal')?.classList.add('hidden');
  try { localStorage.setItem(WJ_GUIDE_KEY, '1'); } catch {}
}

function initGuide() {
  const modal = $('guide-modal');
  if (!modal) return;
  document.querySelectorAll('.js-open-guide').forEach(b => b.addEventListener('click', openGuide));
  modal.querySelectorAll('.js-guide-close').forEach(b => b.addEventListener('click', closeGuide));
  modal.addEventListener('click', e => { if (e.target === modal) closeGuide(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeGuide();
  });
  let seen = true;
  try { seen = !!localStorage.getItem(WJ_GUIDE_KEY); } catch {}
  // Tautan yang sudah membawa pencarian (mis. dibagikan) langsung ke isinya, tanpa panduan
  if (!seen && !new URLSearchParams(location.search).has('category')) openGuide();
}

// ---------------------------------------------------------------------------
// INIT — dialog, preloader, menu
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('load', () => $('preloader')?.classList.add('hidden'));
  initTopNavMenu('top-nav-menu-toggle', 'top-nav-menu');
  initTopNavMenu('top-nav-lang-toggle', 'top-nav-lang-menu');
  initGuide();
  updateNavLinks();

  $('dialog-overlay')?.addEventListener('click', e => {
    if (!e.target.closest('.dialog-box')) $('dialog-overlay').classList.add('hidden');
  });
  $('dialog-btn-confirm')?.addEventListener('click', () => $('dialog-overlay')?.classList.add('hidden'));
  $('dialog-btn-cancel')?.addEventListener('click',  () => $('dialog-overlay')?.classList.add('hidden'));
});
