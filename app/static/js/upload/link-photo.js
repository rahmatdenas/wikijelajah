'use strict';

// Modal tautkan foto Commons ke Wikidata.

// ---------------------------------------------------------------------------
// TAUTKAN FOTO COMMONS KE WIKIDATA (P18)
// ---------------------------------------------------------------------------

function parseCommonsFilename(val) {
  val = val.trim();
  const m = val.match(/[Ff]ile:([^?#&\n]+)/);
  if (m) return decodeURIComponent(m[1].trim());
  if (/\.(jpe?g|png|gif|webp|svg|tiff?)$/i.test(val)) return val;
  return null;
}

function setLinkPhotoStatus(type, msg) {
  const el = $('link-photo-status');
  if (!el) return;
  el.className = `upload-status upload-status--${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function initLinkPhotoModal() {
  const modal      = $('link-photo-modal');
  if (!modal) return;
  const input      = $('link-photo-input');
  const previewArea= $('link-photo-preview-area');
  const previewImg = $('link-photo-preview-img');
  const previewName= $('link-photo-preview-name');
  const submitBtn  = $('link-photo-btn-submit');
  const propSelect = $('link-photo-prop');

  const closeModal = () => {
    modal.classList.add('hidden');
    input.value = '';
    previewArea.classList.add('hidden');
    $('link-photo-status').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.remove('loading');
    $('link-photo-btn-label').textContent = msg('link-photo-submit');
    modal._qid = null;
  };

  $('link-photo-modal-close')?.addEventListener('click', closeModal);
  $('link-photo-btn-cancel')?.addEventListener('click',  closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  let previewTimer;
  input.addEventListener('input', () => {
    clearTimeout(previewTimer);
    $('link-photo-status').classList.add('hidden');
    const fname = parseCommonsFilename(input.value);
    if (!fname) { previewArea.classList.add('hidden'); submitBtn.disabled = true; return; }

    previewTimer = setTimeout(() => {
      previewImg.src = commonsFileUrl(fname, 320);
      previewName.textContent = fname;
      previewImg.onload  = () => { previewArea.classList.remove('hidden'); submitBtn.disabled = false; };
      previewImg.onerror = () => {
        previewArea.classList.add('hidden');
        submitBtn.disabled = true;
        setLinkPhotoStatus('error', msg('link-photo-not-found'));
      };
    }, 600);
  });

  submitBtn.addEventListener('click', async () => {
    const qid   = modal._qid;
    const fname = parseCommonsFilename(input.value);
    if (!fname || !qid) return;
    const prop = chosenImageProp(propSelect);
    if (!prop) return setLinkPhotoStatus('error', msg('image-type-required'));
    // Cek cepat di sisi tampilan; server tetap memeriksa ulang ke Wikidata
    if (imageAlreadyLinked(qid, prop, fname))
      return setLinkPhotoStatus('error', msg('image-already-linked', msg(`image-prop-${prop}`)));

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('link-photo-btn-label').textContent = msg('link-photo-linking');
    setLinkPhotoStatus('info', msg('link-photo-adding', msg(`image-prop-${prop}`)));

    try {
      const res  = await fetch(`/api/item/${qid}/set-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname, property: prop }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setLinkPhotoStatus('error', data.error || msg('link-photo-failed'));
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('link-photo-btn-label').textContent = msg('link-photo-submit');
        return;
      }

      afterImageSaved(qid, prop, data.filename);
      // Peringatan = tertaut di Wikidata, tapi data terstruktur Commons gagal; beri waktu membaca
      if (data.warning) setLinkPhotoStatus('warning', `✓ ${msg('link-photo-success', msg(`image-prop-${prop}`))} ${data.warning}`);
      else setLinkPhotoStatus('success', `✓ ${msg('link-photo-success', msg(`image-prop-${prop}`))}`);
      $('link-photo-btn-label').textContent = msg('button-done');

      setTimeout(() => { closeModal(); renderDetail(qid); }, data.warning ? 5000 : 1500);

    } catch (err) {
      setLinkPhotoStatus('error', msg('error-generic', err.message));
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('link-photo-btn-label').textContent = msg('link-photo-submit');
    }
  });
}

/**
 * `prop`: jenis gambar terpilih saat modal dibuka — P18 dari kotak foto utama, kosong dari Data Gambar.
 * `filename`: nama berkas yang langsung diisi (mis. dari unggahan yang ternyata duplikat).
 */
function openLinkPhotoModal(qid, title, prop = 'P18', filename = '') {
  const modal = $('link-photo-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  prepareImagePropSelect($('link-photo-prop'), qid, prop);
  const input = $('link-photo-input');
  input.value = filename;
  $('link-photo-preview-area').classList.add('hidden');
  $('link-photo-status').classList.add('hidden');
  $('link-photo-btn-submit').disabled = true;
  modal.classList.remove('hidden');
  if (filename) input.dispatchEvent(new Event('input'));  // tampilkan pratinjau
  setTimeout(() => input.focus(), 100);
}
