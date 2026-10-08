'use strict';

/* ==========================================================================
   ui.js — Helper UI bersama untuk semua halaman (Jelajah & Perkaya):
   escaping, dialog, combobox, dan saran butir Wikidata.
   ========================================================================== */

const $ = id => document.getElementById(id);

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// DIALOG — global agar map.js bisa akses
// ---------------------------------------------------------------------------
function appShowDialog(html, type = 'alert', title = 'Pesan') {
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

// ---------------------------------------------------------------------------
// SELECT YANG BISA DIKETIK (combobox)
// <select> asli tetap jadi sumber kebenaran (disembunyikan): nilai dipilih
// lewat select.selectedIndex lalu event 'change' dikirim, sehingga kode lain
// tetap membaca option terpilih beserta data-* seperti biasa.
// ---------------------------------------------------------------------------
function _normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function enhanceSearchableSelect(select, placeholder = 'Ketik atau pilih…') {
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
      : '<li class="combo-empty">Tidak ditemukan</li>';
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
          : '<li class="prop-suggest-empty">Tidak ditemukan</li>';
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
// DROPDOWN PROFIL di top nav (mobile)
// ---------------------------------------------------------------------------
function initTopNavMenu() {
  const toggle = $('top-nav-menu-toggle');
  const menu   = $('top-nav-menu');
  if (!toggle || !menu) return;

  const setOpen = open => {
    menu.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(menu.classList.contains('hidden'));
  });
  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setOpen(false); toggle.focus(); }
  });
}

// ---------------------------------------------------------------------------
// INIT — dialog, preloader, menu
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('load', () => $('preloader')?.classList.add('hidden'));
  initTopNavMenu();

  $('dialog-overlay')?.addEventListener('click', e => {
    if (!e.target.closest('.dialog-box')) $('dialog-overlay').classList.add('hidden');
  });
  $('dialog-btn-confirm')?.addEventListener('click', () => $('dialog-overlay')?.classList.add('hidden'));
  $('dialog-btn-cancel')?.addEventListener('click',  () => $('dialog-overlay')?.classList.add('hidden'));
});
