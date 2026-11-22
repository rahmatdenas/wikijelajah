'use strict';

// Panel detail butir: render, media/ringkasan, navigasi, lightbox.

// ---------------------------------------------------------------------------
// DETAIL PANEL
// ---------------------------------------------------------------------------
function openDetail(index) {
  const qid = State.visibleIds[index];
  if (!qid) return;
  State.currentIndex = index;
  renderDetail(qid);
  showSection('detail');
  mapFlyTo(State.records[qid]);
  updateDetailNav();
}

/** URL masuk yang kembali ke halaman ini (beserta pencariannya) setelah login. */
const loginUrl = () => `/oauth/login?next=${encodeURIComponent(location.pathname + location.search)}`;

const ICON_EXT = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';

function renderDetail(qid) {
  const r = State.records[qid];
  const el = DOM.sections.detail;
  if (!r || !el) return;

  const encodedFilename = r.imageFilename ? encodeURIComponent(r.imageFilename) : null;

  const mediaReady = r.imageFilename !== undefined;
  const imgFigure = r.imageFilename
    ? `<figure class="detail-figure">
        <img src="${commonsFileUrl(r.imageFilename, 800)}"
             alt="${escHtml(r.title)}"
             class="detail-img js-lightbox-trigger"
             loading="lazy">
        <figcaption id="img-caption-${escHtml(qid)}" class="detail-caption">${escHtml(msg('loading'))}</figcaption>
       </figure>`
    : !mediaReady
    ? `<div class="detail-media-skeleton">
         <div class="loader loader--small"></div>
       </div>`
    : `<div class="detail-no-image" id="no-image-zone-${escHtml(qid)}">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" opacity=".35" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        <span>${escHtml(msg('detail-no-photo'))}</span>
        ${APP_USER
          ? `<div class="no-image-btns">
               <button class="btn btn--primary btn--sm upload-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↑ ${escHtml(msg('detail-upload-photo'))}</button>
               <button class="btn btn--secondary btn--sm link-foto-btn" data-qid="${escHtml(qid)}" data-title="${escHtml(r.title)}">↗ ${escHtml(msg('detail-link-photo'))}</button>
             </div>`
          : `<a href="${loginUrl()}" class="btn btn--secondary btn--sm">${escHtml(msg('detail-login-to-upload'))}</a>`}
       </div>`;

  const kategoriNama  = State.params?.klasterLabel || '';
  const isRawQid      = /^Q\d+$/.test(r.title);
  const createWikiUrl = `${WIKI_BASE}/w/index.php?title=${encodeURIComponent(r.title)}&action=edit`;
  const sub = itemSub(r);

  // Catatan bila belum ada artikel Wikipedia / belum ada label
  const articleNote = r.articleTitle ? ''
    : isRawQid
    ? `<p class="detail-callout">
         ${escHtml(msg('detail-no-label'))}
         <a href="https://www.wikidata.org/wiki/${escHtml(r.id)}" target="_blank" rel="noopener">${escHtml(msg('detail-complete-wikidata'))} →</a>
       </p>`
    : r.articleTitle === null
    ? `<p class="detail-callout">
         ${msgHtml('detail-no-article', { html: `<em>${escHtml(kategoriNama || msg('detail-article'))}</em>` })}
         <a href="${createWikiUrl}" target="_blank" rel="noopener">${escHtml(msg('detail-add-article'))}</a>
       </p>`
    : '';

  const counter = State.currentIndex >= 0 ? `${State.currentIndex + 1} / ${State.visibleIds.length}` : '';

  el.innerHTML = `
    <div class="detail-panel">

      <div class="detail-nav panel-nav">
        <button class="back-link" id="btn-kembali-detail">← ${escHtml(msg('detail-back'))}</button>
        <div class="panel-nav-actions">
          ${counter ? `<div class="detail-pager">
            <button class="icon-btn" id="btn-prev" type="button" aria-label="${escHtml(msg('panel-previous'))}" title="${escHtml(msg('panel-previous'))}">‹</button>
            <span class="detail-back-counter">${counter}</span>
            <button class="icon-btn" id="btn-next" type="button" aria-label="${escHtml(msg('panel-next'))}" title="${escHtml(msg('panel-next'))}">›</button>
          </div>` : ''}
        </div>
      </div>

      <h2 class="detail-title${isRawQid ? ' detail-title--unlabeled' : ''}">
        ${isRawQid ? `<span class="detail-title-qid">${escHtml(r.id)}</span><span class="detail-title-nolabel"> — ${escHtml(msg('detail-unlabeled'))}</span>` : escHtml(r.title)}
      </h2>
      ${sub ? `<p class="detail-subtitle">${escHtml(sub)}</p>` : ''}

      <div class="detail-media">${imgFigure}</div>

      <div id="detail-excerpt-${escHtml(qid)}" class="detail-excerpt">
        ${(r.articleTitle || r.articleTitle === undefined) ? `<p class="detail-excerpt-loading">${escHtml(msg('detail-loading-excerpt'))}</p>` : ''}
      </div>
      ${articleNote}

      <div class="detail-links" id="detail-links-${escHtml(qid)}">${detailLinksHtml(qid)}</div>

      <section class="detail-section">
        <div class="detail-section-head">
          <h3>${escHtml(msg('detail-data-title'))}</h3>
        </div>
        <div id="detail-dynprops-${escHtml(qid)}">
          <p class="detail-excerpt-loading">${escHtml(msg('detail-loading'))}</p>
        </div>
      </section>

      <section class="detail-section hidden" id="detail-gallery-${escHtml(qid)}"></section>

    </div>`;

  const backToResults = () => { mapShowShape(null); showSection('hasil'); revealCurrentItem(); };
  el.querySelector('#btn-kembali-detail')?.addEventListener('click', backToResults);
  el.querySelector('#btn-prev')?.addEventListener('click', () => {
    if (State.currentIndex > 0) openDetail(State.currentIndex - 1);
  });
  el.querySelector('#btn-next')?.addEventListener('click', () => {
    if (State.currentIndex < State.visibleIds.length - 1) openDetail(State.currentIndex + 1);
  });

  el.querySelector('.js-lightbox-trigger')
    ?.addEventListener('click', () => openLightbox(r.imageFilename));

  el.querySelector('.upload-foto-btn')
    ?.addEventListener('click', e => openUploadModal(e.currentTarget.dataset.qid, e.currentTarget.dataset.title));

  el.querySelector('.link-foto-btn')
    ?.addEventListener('click', e => openLinkPhotoModal(e.currentTarget.dataset.qid, e.currentTarget.dataset.title));

  if (r.imageFilename) loadCaption(qid);
  if (r.articleTitle)  loadExcerpt(qid);
  loadDetailProps(qid);
  if (!mediaReady)     loadSingleItemMedia(qid);
  // Jenis gambar yang sesuai butir disiapkan lebih awal, sebelum modal unggah / tautkan dibuka
  if (APP_USER)        loadImageProps(qid).catch(() => {});

  // OSM shape
  if (!r._osmTriggered && r.lat) {
    r._osmTriggered = true;
    fetchOsmShape(qid, State.abortCtrl?.signal)
      .then(geo => mapShowShape(geo))
      .catch(() => {});
  } else {
    mapShowShape(null);
  }
}

/** Tautan ke proyek Wikimedia; galeri Commons & WikiBuku baru ada setelah data detail dimuat. */
function detailLinksHtml(qid) {
  const r = State.records[qid];
  const d = r._detail;
  const linkChip = (href, icon, label) =>
    `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="link-chip">
       <img src="/static/img/${icon}" alt="" width="16" height="16"><span>${escHtml(label)}</span>${ICON_EXT}
     </a>`;
  return [
    r.articleTitle && linkChip(`${WIKI_BASE}/wiki/${encodeURIComponent(r.articleTitle)}`, 'wikipedia_tiny_logo.png', msg('detail-read-wikipedia')),
    linkChip(`https://www.wikidata.org/wiki/${qid}`, 'wikidata_tiny_logo.png', msg('detail-view-wikidata')),
    d?.commonsCat && linkChip(`https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(d.commonsCat)}`, 'wikicommons_tiny_logo.png', msg('detail-gallery')),
    d?.wikibooks && linkChip(d.wikibooks, 'wikibook_tiny_logo.png', msg('detail-view-wikibooks')),
  ].filter(Boolean).join('');
}

async function loadSingleItemMedia(qid) {
  const r = State.records[qid];
  if (!r || r.imageFilename !== undefined) return;
  try {
    const media = await fetchSingleItemMedia(qid, State.abortCtrl?.signal);
    Object.assign(r, media);
    mapRefreshMarkerIcon(r);
    if (document.getElementById(`detail-excerpt-${qid}`)) renderDetail(qid);
  } catch (_) {}
}

async function loadCaption(qid) {
  const r = State.records[qid];
  if (!r?.imageFilename) return;
  try {
    const cap = await fetchImageCaption(r.imageFilename, State.abortCtrl?.signal);
    const el  = $(`img-caption-${qid}`);
    if (el) el.innerHTML = cap || '';
  } catch (_) {}
}

async function loadExcerpt(qid) {
  const r = State.records[qid];
  if (!r?.articleTitle) return;
  try {
    const html = await fetchWikipediaExcerpt(r.articleTitle, State.abortCtrl?.signal);
    const el   = $(`detail-excerpt-${qid}`);
    if (el) el.innerHTML = html;
  } catch (_) {}
}

function updateDetailNav() {
  const i = State.currentIndex;
  if ($('btn-prev')) $('btn-prev').disabled = i <= 0;
  if ($('btn-next')) $('btn-next').disabled = i >= State.visibleIds.length - 1;
}

// ---------------------------------------------------------------------------
// LIGHTBOX
// ---------------------------------------------------------------------------
function openLightbox(filename) {
  const overlay = $('lightbox-overlay');
  const img     = $('lightbox-img');
  if (!overlay || !img) return;
  img.src = commonsFileUrl(filename, 1200);
  img.dataset.file = filename;

  const title = $('lightbox-title');
  if (title) {
    title.href = commonsFilePageUrl(filename);
    title.innerHTML = `<span>${escHtml(filename.replace(/_/g, ' ').replace(/\.[^.]+$/, ''))}</span>${ICON_EXT}`;
  }
  const credit = $('lightbox-credit');
  if (credit) {
    credit.textContent = msg('loading');
    // Fotografer & lisensi sebagai teks biasa (tanpa tautan); <template> agar HTML dari Commons tidak dijalankan
    fetchImageCaption(filename, State.abortCtrl?.signal).then(html => {
      if (img.dataset.file !== filename) return;  // lightbox sudah berganti foto
      const tpl = document.createElement('template');
      tpl.innerHTML = html || '';
      credit.textContent = tpl.content.textContent.trim();
    }).catch(() => { credit.textContent = ''; });
  }
  overlay.classList.remove('hidden');
}

function closeLightbox() {
  $('lightbox-overlay')?.classList.add('hidden');
}
