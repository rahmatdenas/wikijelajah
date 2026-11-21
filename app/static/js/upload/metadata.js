'use strict';

// Kategori Commons, format foto, dan EXIF untuk modal unggah.

// ---------------------------------------------------------------------------
// KATEGORI COMMONS di modal unggah — opsional; hanya dari saran (P373) atau hasil pencarian,
// tidak bisa diketik bebas. Server memeriksa ulang ke Commons sebelum menulis wikitext.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_CATEGORIES = 5;
const UploadCats = { chosen: [], suggested: [], qid: null };
const _catSuggestCache = new Map();  // qid → Promise<string[]>

function renderUploadCategories() {
  const chips = $('upload-cat-chips');
  const full  = UploadCats.chosen.length >= MAX_UPLOAD_CATEGORIES;

  chips.innerHTML = UploadCats.chosen.map(c => `
    <span class="cat-chip">${escHtml(c)}<button type="button" class="cat-chip-remove" data-cat="${escHtml(c)}"
      aria-label="${escHtml(msg('upload-category-remove', c))}">×</button></span>`).join('');
  chips.classList.toggle('hidden', !UploadCats.chosen.length);

  const input = $('upload-cat-input');
  input.disabled = full;
  input.placeholder = full ? msg('upload-category-too-many', MAX_UPLOAD_CATEGORIES) : msg('upload-categories-search');
}

function addUploadCategory(name) {
  if (UploadCats.chosen.includes(name) || UploadCats.chosen.length >= MAX_UPLOAD_CATEGORIES) return;
  UploadCats.chosen.push(name);
  renderUploadCategories();
}

/** Kosongkan pilihan; `qid` diisi saat modal dibuka → muat saran kategori butir itu. */
function resetUploadCategories(qid) {
  UploadCats.chosen = [];
  UploadCats.suggested = [];
  UploadCats.qid = qid;
  $('upload-cat-input').value = '';
  $('upload-cat-results').classList.add('hidden');
  renderUploadCategories();
  if (!qid) return;

  if (!_catSuggestCache.has(qid)) {
    _catSuggestCache.set(qid, fetchCategorySuggestions(qid).catch(() => { _catSuggestCache.delete(qid); return []; }));
  }
  _catSuggestCache.get(qid).then(list => {
    if (UploadCats.qid !== qid) return;  // modal sudah ditutup / butir lain
    UploadCats.suggested = list;
    // Saran datang saat kolom sudah difokus dan masih kosong: langsung tampilkan
    if (document.activeElement === $('upload-cat-input')) showUploadCategorySuggestions();
  });
}

/**
 * Kolom kategori difokus dan masih kosong: dropdown berisi saran untuk butir (P373 butir & wilayah).
 * Tidak ada saran → dropdown tidak dibuka.
 */
function showUploadCategorySuggestions() {
  const input = $('upload-cat-input');
  const list  = $('upload-cat-results');
  const open  = UploadCats.suggested.filter(c => !UploadCats.chosen.includes(c));
  if (input.value.trim() || input.disabled || !open.length) return;
  list.innerHTML = `<li class="cat-results-head">${escHtml(msg('upload-categories-suggested'))}</li>` +
    open.map(c => `<li class="prop-suggest-item" role="option" data-cat="${escHtml(c)}">
      <span class="prop-suggest-label">${escHtml(c)}</span></li>`).join('');
  list.classList.remove('hidden');
}

function initUploadCategories() {
  const input = $('upload-cat-input');
  const list  = $('upload-cat-results');
  if (!input) return;
  let timer = null;
  let ctrl  = null;

  $('upload-cat-chips').addEventListener('click', e => {
    const btn = e.target.closest('.cat-chip-remove');
    if (!btn) return;
    UploadCats.chosen = UploadCats.chosen.filter(c => c !== btn.dataset.cat);
    renderUploadCategories();
  });
  input.addEventListener('focus', showUploadCategorySuggestions);
  input.addEventListener('click', showUploadCategorySuggestions);  // sudah fokus, dropdown tertutup (Esc / pilih)

  const pick = li => {
    addUploadCategory(li.dataset.cat);
    input.value = '';
    list.classList.add('hidden');
    input.focus();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (!term) { list.classList.add('hidden'); showUploadCategorySuggestions(); return; }
    if (term.length < 2) { list.classList.add('hidden'); return; }

    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const results = (await searchCommonsCategories(term, ctrl.signal)).filter(c => !UploadCats.chosen.includes(c));
        list.innerHTML = results.length
          ? results.map(c => `<li class="prop-suggest-item" role="option" data-cat="${escHtml(c)}">
              <span class="prop-suggest-label">${escHtml(c)}</span></li>`).join('')
          : `<li class="prop-suggest-empty">${escHtml(msg('upload-categories-none'))}</li>`;
        list.classList.remove('hidden');
      } catch (err) {
        if (err.name !== 'AbortError') list.classList.add('hidden');
      }
    }, 250);
  });

  // Panah atas/bawah memilih, Enter menambahkan, Esc menutup daftar
  input.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('.prop-suggest-item')];
    if (list.classList.contains('hidden') || !items.length) return;
    const cur = items.findIndex(li => li.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault();
      pick(items[cur]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      list.classList.add('hidden');
    }
  });

  // mousedown (bukan click) agar input tidak kehilangan fokus sebelum pilihan tercatat
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.prop-suggest-item');
    if (!li) return;
    e.preventDefault();
    pick(li);
  });

  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
}

/** Pilihan "Sertakan lokasi kamera": hanya tampil bila foto punya GPS; bawaannya dicentang. */
function showUploadLocation(exif) {
  const group = $('upload-location-group');
  if (!group) return;
  const has = exif.lat != null;
  group.classList.toggle('hidden', !has);
  $('upload-location-check').checked = true;
  $('upload-location-coords').textContent = has ? `${exif.lat}, ${exif.lon}` : '';
}

/**
 * Format foto dari bita awal berkasnya ('jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'other'),
 * bukan dari nama atau tipe MIME yang di Android tidak selalu akurat.
 */
async function photoFormat(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const text = (from, to) => String.fromCharCode(...b.slice(from, to));
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (text(1, 4) === 'PNG') return 'png';
    if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
    if (text(4, 8) === 'ftyp') return /^avi[fs]$/.test(text(8, 12)) ? 'avif' : 'heic';
    return 'other';
  } catch {
    // Tidak terbaca: percaya tipe MIME-nya
    return { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'other';
  }
}

/** Tanggal lokal sebagai YYYY-MM-DD. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Info pemotretan dari EXIF foto JPEG: { date: 'YYYY-MM-DD', time: 'HH:MM:SS', lat, lon, heading }.
 * Bagian yang tidak ada / tidak terbaca dibiarkan kosong; berkas selain JPEG → {}.
 */
async function exifInfo(file) {
  if (!/jpe?g$/i.test(file.type)) return {};
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return {};
    // Cari segmen APP1 "Exif" di antara segmen-segmen awal JPEG
    for (let off = 2; off + 10 < v.byteLength; off += 2 + v.getUint16(off + 2)) {
      const marker = v.getUint16(off);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return exifTiffInfo(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;  // awal data gambar: tidak ada EXIF
    }
  } catch { /* berkas rusak / terpotong */ }
  return {};
}

/**
 * Dari blok TIFF EXIF: tanggal & jam DateTimeOriginal (0x9003) → DateTimeDigitized (0x9004) →
 * DateTime (0x0132), dan GPS (lintang/bujur 0x1–0x4, arah kamera 0x11).
 */
function exifTiffInfo(v, tiff) {
  const le  = v.getUint16(tiff) === 0x4949;  // "II" = little endian
  const u16 = o => v.getUint16(tiff + o, le);
  const u32 = o => v.getUint32(tiff + o, le);
  const tags = ifd => {
    const out = {};
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const e = ifd + 2 + i * 12;
      out[u16(e)] = { count: u32(e + 4), value: u32(e + 8), entry: e };
    }
    return out;
  };
  // Nilai ≤ 4 bita tersimpan langsung di entri, lebih dari itu di offset `value`
  const ascii = t => {
    if (!t || !t.count) return '';
    const start = t.count > 4 ? t.value : t.entry + 8;
    return String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + tiff + start, t.count)).replace(/\0.*$/s, '');
  };
  const rational = (t, i = 0) => {
    const den = u32(t.value + i * 8 + 4);
    return den ? u32(t.value + i * 8) / den : NaN;
  };

  const info = {};
  const ifd0 = tags(u32(4));
  const exif = ifd0[0x8769] ? tags(ifd0[0x8769].value) : {};
  for (const t of [exif[0x9003], exif[0x9004], ifd0[0x0132]]) {
    const m = ascii(t).match(/^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/);
    if (m && +m[1] >= 1840 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
      info.date = `${m[1]}-${m[2]}-${m[3]}`;
      if (m[4] && +m[4] < 24 && +m[5] < 60 && +m[6] < 60) info.time = `${m[4]}:${m[5]}:${m[6]}`;
      break;
    }
  }

  const gps = ifd0[0x8825] ? tags(ifd0[0x8825].value) : {};
  const deg = (t, ref, neg) => {
    if (!t || t.count !== 3) return NaN;
    const d = rational(t, 0) + rational(t, 1) / 60 + rational(t, 2) / 3600;
    return ascii(ref).trim().toUpperCase() === neg ? -d : d;
  };
  const lat = deg(gps[0x2], gps[0x1], 'S');
  const lon = deg(gps[0x4], gps[0x3], 'W');
  // 0,0 biasanya berarti GPS kosong, bukan benar-benar di Teluk Guinea
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) {
    info.lat = +lat.toFixed(6);
    info.lon = +lon.toFixed(6);
    const h = gps[0x11] ? rational(gps[0x11]) : NaN;
    if (h >= 0 && h <= 360) info.heading = +h.toFixed(2);
  }
  return info;
}

function setUploadStatus(type, msg) {
  const el = $('upload-status');
  if (!el) return;
  el.className = `upload-status upload-status--${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}
