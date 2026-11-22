'use strict';

// Cari nilai atribut dengan AI di panel detail.

// ---------------------------------------------------------------------------
// ✨ AI DI PANEL DETAIL — cari satu atribut kosong, periksa sumbernya, lalu simpan.
// Memakai endpoint & antrean yang sama dengan Perkaya Data (ai.js): kandidat yang
// belum diputuskan di sini tetap muncul di langkah Validasi Perkaya Data.
// ---------------------------------------------------------------------------
let _aiOpen = null;  // kandidat terbuka milik pengguna (dimuat sekali, lalu diperbarui lokal)

async function aiOpenList() {
  if (_aiOpen === null) {
    try { _aiOpen = await aiOpenCandidates(); } catch { _aiOpen = []; }
  }
  return _aiOpen;
}

/** Tampilkan kandidat menunggu validasi yang sudah ada untuk atribut-atribut kosong butir ini. */
async function aiShowExisting(qid, container) {
  const open = await aiOpenList();
  container.querySelectorAll('.detail-prop-empty-row').forEach(li => {
    const cands = sortCandidates(open.filter(c => c.qid === qid && c.pid === li.dataset.pid && c.status === 'pending'));
    if (cands.length && li.isConnected) aiRenderCandidates(qid, li, cands);
  });
}

function aiAttr(qid, li) {
  const attr = detailAttrs(qid).find(a => a.pid === li.dataset.pid);
  if (attr) applyUnitChoice(attr, li);
  return attr;
}

function aiSetSlot(li, html) {
  const slot = li.querySelector('.ai-slot');
  slot.innerHTML = html;
  slot.classList.toggle('hidden', !html);
  return slot;
}

/** Cari nilai satu atribut dengan AI lalu tampilkan kandidatnya di bawah baris itu. */
async function aiSearchRow(qid, li) {
  const attr = aiAttr(qid, li);
  const r = State.records[qid];
  if (!attr || !r) return true;
  if (!aiReady()) {
    openSettings(() => aiSearchRow(qid, li));  // isi API key dulu, lalu langsung mencari
    return false;
  }
  const btn = li.querySelector('.js-prop-ai');
  btn.disabled = true;
  aiSetSlot(li, `<p class="ai-status"><span class="loader loader--small"></span>${escHtml(msg('detail-ai-searching'))}</p>`);

  try {
    const { ok, status, data } = await aiSearch({
      qid, label: r.title, description: r._detail?.description || '',
      kategori: State.params?.klasterNama || '',
      // "Di sekitar saya": provLabels berisi jenis objek, bukan wilayah
      lokasi: [r.lokLabel, ...(State.params?.wilayah === 'sekitar' ? [] : r.provLabels || [r.provLabel])]
        .filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
    }, attr);
    if (!li.isConnected) return true;
    btn.disabled = false;
    if (!ok) {
      aiSetSlot(li, `<p class="ai-status ai-status--error">${escHtml(data.error || msg('pk-failed-http', status))}</p>`);
      return !(status === 401 || data.fatal);
    }
    // Simpan ke daftar lokal agar konsisten bila detail dibuka ulang
    if (_aiOpen) _aiOpen = _aiOpen.filter(c => !(c.qid === qid && c.pid === attr.pid)).concat(data);
    if (data[0]?.status !== 'pending') {
      aiSetSlot(li, `<p class="ai-status">${escHtml(msg('detail-ai-not-found'))}${data[0]?.note ? ` <span class="ai-note">${escHtml(data[0].note)}</span>` : ''}</p>`);
      return true;
    }
    aiRenderCandidates(qid, li, sortCandidates(data));
  } catch (err) {
    btn.disabled = false;
    aiSetSlot(li, `<p class="ai-status ai-status--error">${escHtml(msg('error-generic', err.message))}</p>`);
  }
  return true;
}

function aiCandidateHtml(c, multi) {
  const src = (c.sources || [])[0] || {};
  const v = VERIF_VIEW_DETAIL[src.verification || c.verification] || VERIF_VIEW_DETAIL.gagal_dibuka;
  let host = '';
  try { host = new URL(src.url).hostname.replace(/^www\./, ''); } catch {}
  const value = `${c.value}${c.unit_label ? ' ' + c.unit_label : ''}`;
  return `<div class="ai-cand" data-id="${c.id}">
    <div class="ai-cand-head">
      <strong class="ai-cand-value">${escHtml(value)}</strong>
      <span class="pk-source-verif pk-source-verif--${v.cls}" title="${escHtml(src.verify_note || '')}">${escHtml(v.label)}</span>
    </div>
    ${src.url ? `<a class="ai-cand-src" href="${escHtml(src.url)}" target="_blank" rel="noopener">${escHtml(src.title || host)} ↗</a>` : ''}
    ${src.quote ? `<blockquote class="ai-cand-quote">${escHtml(src.quote)}</blockquote>` : ''}
    ${c.datatype === 'item' ? `<div class="ai-item-choices"><span class="loader loader--small"></span></div>` : ''}
    <div class="ai-cand-actions">
      <button type="button" class="btn btn--primary btn--sm js-ai-approve"${c.datatype === 'item' ? ' disabled' : ''}>✓ ${escHtml(msg('detail-ai-save'))}</button>
      ${multi ? '' : `<button type="button" class="btn btn--secondary btn--sm js-ai-reject">${escHtml(msg('pk-reject'))}</button>`}
    </div>
  </div>`;
}

const VERIF_VIEW_DETAIL = {
  terverifikasi:       { cls: 'ok',    label: msg('pk-verif-ok') },
  nilai_tidak_cocok:   { cls: 'warn',  label: msg('pk-verif-value-mismatch') },
  nilai_di_halaman:    { cls: 'warn',  label: msg('pk-verif-value-on-page') },
  tidak_terverifikasi: { cls: 'bad',   label: msg('pk-verif-unverified') },
  gagal_dibuka:        { cls: 'muted', label: msg('pk-verif-unchecked') },
};

/** Kandidat AI di bawah baris atribut: Simpan langsung ke Wikidata, atau Tolak. */
function aiRenderCandidates(qid, li, cands) {
  const attr = aiAttr(qid, li);
  const multi = cands.length > 1;
  const slot = aiSetSlot(li, `
    ${multi ? `<p class="ai-status ai-status--warn">${escHtml(msg('pk-disagree-title', cands.length))}</p>` : ''}
    ${cands.map(c => aiCandidateHtml(c, multi)).join('')}
    ${multi ? `<div class="ai-cand-actions"><button type="button" class="btn btn--secondary btn--sm js-ai-reject">${escHtml(msg('pk-reject-all'))}</button></div>` : ''}
    <p class="ai-msg hidden"></p>`);
  const setMsg = (cls, text) => {
    const el = slot.querySelector('.ai-msg');
    el.className = `ai-msg ai-status ai-status--${cls}`;
    el.textContent = text;
  };
  const busy = on => slot.querySelectorAll('button').forEach(b => { b.disabled = on || b.dataset.locked === '1'; });

  // Atribut bertipe butir: AI memberi nama, pengguna memilih butir Wikidata yang tepat
  cands.filter(c => c.datatype === 'item').forEach(async c => {
    const box = slot.querySelector(`.ai-cand[data-id="${c.id}"] .ai-item-choices`);
    let results = [];
    try { results = await searchWikidataItems(c.value); } catch {}
    if (!box.isConnected) return;
    box.innerHTML = results.length
      ? `<span class="ai-item-label">${escHtml(msg('detail-ai-choose-item'))}</span>` + results.slice(0, 3).map((it, i) => `
          <label class="ai-item-choice">
            <input type="radio" name="ai-item-${c.id}" value="${escHtml(it.id)}" data-label="${escHtml(it.label)}"${i === 0 ? ' checked' : ''}>
            <span><strong>${escHtml(it.label)}</strong> <span class="pk-choice-qid">${escHtml(it.id)}</span>
            ${it.description ? `<span class="pk-choice-desc">${escHtml(it.description)}</span>` : ''}</span>
          </label>`).join('')
      : `<span class="ai-item-label">${escHtml(msg('pk-item-none'))}</span>`;
    const approve = box.closest('.ai-cand').querySelector('.js-ai-approve');
    approve.disabled = !results.length;
    approve.dataset.locked = results.length ? '' : '1';
  });

  slot.querySelectorAll('.js-ai-approve').forEach(btn => btn.addEventListener('click', async () => {
    const c = cands.find(x => String(x.id) === btn.closest('.ai-cand').dataset.id);
    const picked = slot.querySelector(`input[name="ai-item-${c.id}"]:checked`);
    const body = c.datatype === 'item'
      ? { value_qid: picked?.value || '', value_label: picked?.dataset.label || '' }
      : { value: c.value };
    body.source_index = 0;
    busy(true);
    setMsg('info', msg('pk-saving'));
    try {
      const { ok, status, data } = await aiApprove(c.id, body);
      if (!ok) { busy(false); setMsg('error', data.error || msg('pk-failed-http', status)); return; }
      if (data.warning) appShowDialog(escHtml(data.warning), 'alert', msg('pk-saved-with-warning'));
      if (_aiOpen) _aiOpen = _aiOpen.filter(x => !(x.qid === qid && x.pid === c.pid));
      const r = State.records[qid];
      if (r?._detail && attr) {
        r._detail.values[attr.pid] = formatNilaiBaru(attr, body.value_qid || c.value, body.value_label);
        renderDetailProps(qid);
        flashSavedRow(qid, attr.label);
      }
      toastSaved(attr?.label || c.pid, r?.title || c.item_label, data.revid);
    } catch (err) {
      busy(false);
      setMsg('error', msg('error-generic', err.message));
    }
  }));

  slot.querySelectorAll('.js-ai-reject').forEach(btn => btn.addEventListener('click', async () => {
    busy(true);
    try {
      for (const c of cands) {
        const { ok, data } = await aiReject(c.id);
        if (!ok) { busy(false); setMsg('error', data.error || msg('pk-cell-error')); return; }
      }
      if (_aiOpen) _aiOpen = _aiOpen.filter(x => !(x.qid === qid && x.pid === cands[0].pid));
      aiSetSlot(li, '');
    } catch (err) {
      busy(false);
      setMsg('error', msg('error-generic', err.message));
    }
  }));
}
