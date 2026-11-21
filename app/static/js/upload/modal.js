'use strict';

// Modal unggah foto ke Commons.

// ---------------------------------------------------------------------------
// UPLOAD FOTO KE COMMONS
// ---------------------------------------------------------------------------

function initUploadModal() {
  const modal    = $('upload-modal');
  const fileInput = $('upload-file-input');
  const dropZone  = $('upload-drop-zone');
  const preview   = $('upload-preview-img');
  const dropLabel = $('upload-drop-label');
  const submitBtn = $('upload-btn-submit');
  if (!modal) return;
  const propSelect = $('upload-prop');

  // Tutup modal
  const closeModal = () => {
    modal.classList.add('hidden');
    fileInput.value = '';
    modal._file = null;
    resetPreview();
    $('upload-filename').value = '';
    $('upload-caption').value  = '';
    $('upload-status').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.remove('loading');
    $('upload-btn-label').textContent = msg('upload-submit');
    linkExistingBtn.classList.add('hidden');
    modal._qid = null;
    modal._pick = null;
    modal._exif = {};
    showUploadLocation({});
    resetUploadCategories(null);
  };
  initUploadCategories();

  // Foto yang sama sudah ada di Commons: pindah ke modal Tautkan dengan nama berkas itu
  const linkExistingBtn = $('upload-btn-link-existing');
  linkExistingBtn.addEventListener('click', () => {
    const { _qid: qid, _title: title, _existing: existing } = modal;
    const prop = propSelect.value;
    closeModal();
    openLinkPhotoModal(qid, title, prop, existing);
  });

  $('upload-modal-close')?.addEventListener('click', closeModal);
  $('upload-btn-cancel')?.addEventListener('click',  closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // File picker: input transparan menutupi seluruh drop zone, jadi ketukan sudah membuka pemilih.
  // Jangan panggil fileInput.click() lagi — di Safari iOS pemilih terbuka dua kali dan foto
  // yang dipilih (galeri / file / kamera) hilang tanpa event change.

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    fileInput.files = e.dataTransfer.files;  // tombol Upload membaca fileInput.files
    handleFileSelect(f);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
  });

  // Pratinjau: object URL (bukan data URL base64) agar hemat memori untuk foto HP besar
  const noPreview = $('upload-no-preview');
  function setPreview(url) {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.src = url;
    preview.classList.remove('hidden');
    dropLabel.classList.add('hidden');
    noPreview.classList.add('hidden');
  }
  function resetPreview() {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    noPreview.classList.add('hidden');
    dropLabel.classList.remove('hidden');
    modal._previewFile = null;
  }

  // Pratinjau gagal dimuat — mis. foto 50–200 MP di HP bermemori terbatas: coba versi kecil;
  // bila tetap gagal, tampilkan nama berkas (foto tetap bisa diunggah, Commons yang memprosesnya)
  preview.addEventListener('error', async () => {
    const file = modal._previewFile;
    if (!file || !preview.getAttribute('src')) return;
    if (!preview.dataset.small) {
      try {
        const bmp = await createImageBitmap(file, { resizeHeight: 400, resizeQuality: 'medium' });
        const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
        if (blob && modal._previewFile === file) {
          preview.dataset.small = '1';
          return setPreview(URL.createObjectURL(blob));
        }
      } catch { /* perangkat juga tidak bisa memperkecilnya */ }
    }
    if (modal._previewFile !== file) return;
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    $('upload-no-preview-name').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
    noPreview.classList.remove('hidden');
  });

  /** Foto ditolak: kosongkan pilihan agar tombol Upload tidak mengirim berkas ini. */
  function rejectFile(text) {
    modal._pick = null;
    modal._file = null;
    fileInput.value = '';
    resetPreview();
    submitBtn.disabled = true;
    setUploadStatus('error', text);
  }

  async function handleFileSelect(picked) {
    if (!picked.type.startsWith('image/')) return rejectFile(msg('upload-images-only'));
    if (picked.size > 10 * 1024 * 1024) return rejectFile(msg('upload-too-large', 10));
    const pick = modal._pick = {};  // pilihan foto terbaru; pilihan lama yang masih berjalan diabaikan

    // Salin isi foto ke memori sekarang. Di Chrome Android berkas dari Google Foto / Galeri / Drive
    // hanya rujukan ke aslinya; bila foto masih diunduh atau disinkronkan, membacanya belakangan
    // gagal (pratinjau jadi ikon rusak, unggahan ERR_UPLOAD_FILE_CHANGED). Maksimal 10 MB.
    let file;
    try {
      file = new File([await picked.arrayBuffer()], picked.name, { type: picked.type, lastModified: picked.lastModified });
    } catch {
      if (modal._pick === pick) rejectFile(msg('upload-read-failed'));
      return;
    }
    if (modal._pick !== pick) return;

    // Format dari isi berkas: HP Android bisa menyimpan HEIC (tidak diterima Commons, dan Chrome
    // tidak bisa menampilkannya); Safari iOS sudah mengubahnya ke JPEG sendiri
    const format = await photoFormat(file);
    if (format === 'heic') return rejectFile(msg('upload-heic'));
    if (!['jpeg', 'png', 'webp'].includes(format)) return rejectFile(msg('upload-format-unsupported'));

    modal._file = file;  // yang diunggah: salinan ini, bukan fileInput.files[0]
    modal._previewFile = file;
    delete preview.dataset.small;
    setPreview(URL.createObjectURL(file));
    linkExistingBtn.classList.add('hidden');
    $('upload-status').classList.add('hidden');

    // Auto-isi nama file: judul butir + tanggal foto (EXIF → tanggal file → hari ini)
    const title = modal._title || '';
    const ext   = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safe  = title.replace(/[^a-zA-Z0-9À-ɏ\s\-]/g, '').trim().replace(/\s+/g, '_');
    $('upload-caption').value = $('upload-caption').value || title;

    const exif = await exifInfo(file);
    if (modal._pick !== pick) return;
    modal._exif = exif;
    showUploadLocation(exif);
    const day  = exif.date || isoDate(new Date(file.lastModified || Date.now()));
    const base = safe ? `${safe}_${day}` : file.name.replace(/\.[^.]*$/, '').trim().replace(/\s+/g, '_');
    const suggested = `${base}.${ext}`;
    $('upload-filename').value = suggested;
    submitBtn.disabled = false;

    // Nama sudah dipakai di Commons? Ganti dengan _2, _3, … — kecuali pengguna sudah mengubahnya
    try {
      const free = await fetchFreeCommonsName(base, ext);
      if (modal._pick === pick && free && $('upload-filename').value === suggested) $('upload-filename').value = free;
    } catch { /* gagal mengecek: server tetap menolak nama yang sudah dipakai */ }
  }

  // Submit
  $('upload-btn-submit')?.addEventListener('click', async () => {
    const qid      = modal._qid;
    const file     = modal._file;
    const filename = $('upload-filename').value.trim();
    const caption  = $('upload-caption').value.trim();

    if (!file)     return setUploadStatus('error', msg('upload-choose-photo'));
    if (!filename) return setUploadStatus('error', msg('upload-filename-required'));
    const prop = chosenImageProp(propSelect);
    if (!prop)     return setUploadStatus('error', msg('image-type-required'));

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('upload-btn-label').textContent = msg('upload-uploading');
    setUploadStatus('info', msg('upload-in-progress'));

    const fd = new FormData();
    fd.append('file',     file);
    fd.append('filename', filename);
    fd.append('caption',  caption);
    fd.append('property', prop);
    // Data EXIF untuk halaman berkas: tanggal & jam pemotretan, lokasi kamera (bila dicentang)
    const exif = modal._exif || {};
    fd.append('date', exif.date || '');
    fd.append('time', exif.date && exif.time ? exif.time : '');
    if (exif.lat != null && $('upload-location-check').checked) {
      fd.append('lat', exif.lat);
      fd.append('lon', exif.lon);
      if (exif.heading != null) fd.append('heading', exif.heading);
    }
    fd.append('categories', JSON.stringify(UploadCats.chosen));

    try {
      const res  = await fetch(`/api/item/${qid}/upload-photo`, { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok || data.error) {
        setUploadStatus('error', data.error || msg('upload-failed'));
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        $('upload-btn-label').textContent = msg('upload-submit');
        if (data.code === 'duplicate' && data.existing) {
          // Unggah ulang foto yang sama tidak berguna; tawarkan menautkan berkas yang sudah ada
          modal._existing = data.existing;
          submitBtn.disabled = true;
          linkExistingBtn.classList.remove('hidden');
        } else if (data.code === 'exists') {
          $('upload-filename').focus();
          $('upload-filename').select();
        }
        return;
      }

      // Berhasil — perbarui state dan re-render detail
      afterImageSaved(qid, prop, data.filename);

      if (data.warning) {
        setUploadStatus('warning', `✓ ${msg('upload-success-warning', data.warning)}`);
      } else {
        setUploadStatus('success', `✓ ${msg('upload-success', msg(`image-prop-${prop}`))}`);
      }

      $('upload-btn-label').textContent = msg('button-done');

      // Tunggu sebentar lalu tutup dan refresh detail
      setTimeout(() => {
        closeModal();
        renderDetail(qid);
      }, data.warning ? 5000 : 1800);

    } catch (err) {
      setUploadStatus('error', msg('error-generic', err.message));
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('upload-btn-label').textContent = msg('upload-submit');
    }
  });
}

/** `prop`: jenis gambar terpilih saat modal dibuka — P18 dari kotak foto utama, kosong dari Data Gambar. */
function openUploadModal(qid, title, prop = 'P18') {
  const modal = $('upload-modal');
  if (!modal) return;
  modal._qid   = qid;
  modal._title = title || '';
  prepareImagePropSelect($('upload-prop'), qid, prop);
  $('upload-caption').value  = title || '';
  $('upload-filename').value = '';
  $('upload-status').classList.add('hidden');
  $('upload-btn-submit').disabled = true;
  resetUploadCategories(qid);
  modal.classList.remove('hidden');
}
