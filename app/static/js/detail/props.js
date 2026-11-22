'use strict';

// Atribut di panel detail: skema kategori, tambah data lain, galeri, edit properti.

// ---------------------------------------------------------------------------
// DETAIL ATRIBUT PER KATEGORI (skema: SKEMA_KATEGORI di wikidata/schema.js)
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

  // "Di sekitar saya": provLabels berisi jenis objek (sudah tampil di baris Tipe), bukan wilayah
  const prov = State.params?.wilayah === 'sekitar' ? ''
    : r?.provLabels?.length ? r.provLabels.join(', ') : r?.provLabel;
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
