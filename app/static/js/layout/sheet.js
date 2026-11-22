'use strict';

// Bottom-sheet di HP dan HTML popup peta.

// ---------------------------------------------------------------------------
// MOBILE BOTTOM-SHEET
// ---------------------------------------------------------------------------
// Tiga posisi panel di HP: terbuka penuh, sebagian (sampai bawah tombol Semua / Ada artikel / Ada foto,
// jadi pencarian & filter tetap bisa dipakai sambil melihat peta), dan tersembunyi (tinggal pegangan).
// Tinggi sebagian sama dengan responsive.css.
const SHEET_PEEK = 212;
let _setSheetOpen = null;

function initBottomSheet() {
  const handle = $('panel-handle');
  const panel  = $('panel');
  if (!handle || !panel) return;

  const STOPS = () => ({
    open:   0,
    peek:   panel.offsetHeight - SHEET_PEEK,
    hidden: panel.offsetHeight - handle.offsetHeight,
  });
  const SWIPE_MIN = 60;  // jarak tarik/usap (px) agar panel berpindah; kurang dari itu kembali ke posisi semula

  function getCurrentTranslateY() {
    const m = new DOMMatrix(getComputedStyle(panel).transform);
    return m.m42;
  }

  function snapTo(stop) {
    panel.classList.remove('dragging');
    panel.style.transform = `translateY(${STOPS()[stop]}px)`;
    panel.dataset.sheet = stop;
    // Ikon tombol peta / daftar mengikuti kelas ini (responsive.css)
    panel.classList.toggle('sheet-closed', stop !== 'open');
  }
  _setSheetOpen = open => snapTo(open ? 'open' : 'peek');
  // Posisi awal di CSS adalah sebagian (mis. jendela desktop yang dikecilkan jadi ukuran HP)
  panel.dataset.sheet = 'peek';
  panel.classList.add('sheet-closed');

  /** Geser panel mengikuti jari, dibatasi antara terbuka dan tersembunyi. */
  function dragTo(y) {
    panel.style.transform = `translateY(${Math.max(STOPS().open, Math.min(STOPS().hidden, y))}px)`;
  }

  /** Setelah ditarik: berhenti di posisi terdekat; tarikan pendek kembali ke posisi awal. */
  function settle(fromStop) {
    const stops = STOPS();
    const y = getCurrentTranslateY();
    const moved = y - stops[fromStop];
    if (Math.abs(moved) < SWIPE_MIN) return snapTo(fromStop);
    // Hanya posisi di arah tarikan; yang terdekat dengan posisi jari saat dilepas
    const ahead = Object.keys(stops).filter(k => moved > 0 ? stops[k] > stops[fromStop] : stops[k] < stops[fromStop]);
    snapTo(ahead.reduce((a, b) => Math.abs(stops[b] - y) < Math.abs(stops[a] - y) ? b : a));
  }

  // Setelah panel dipindah lewat pegangan / usapan, "click" bawaan sentuhan menyusul di titik jari, dan
  // karena panel sudah bergeser, yang kena adalah isi panel di titik itu (mis. foto → lightbox). Telan sekali.
  function swallowNextClick() {
    const block = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', block, { capture: true }), 400);
  }

  // Tombol di baris navigasi: pengguna awam belum tahu panel bisa ditarik untuk melihat peta
  document.addEventListener('click', e => {
    if (e.target.closest('.js-sheet-toggle')) _setSheetOpen(panel.dataset.sheet !== 'open');
  });

  // Pegangan: tarik ke posisi mana pun; ketuk = buka penuh, atau turun ke sebagian bila sudah terbuka
  let grab = null;  // { y, from, moved }
  handle.addEventListener('pointerdown', e => {
    grab = { y: e.clientY, from: panel.dataset.sheet, start: getCurrentTranslateY(), moved: false };
    panel.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!grab) return;
    const dy = e.clientY - grab.y;
    if (Math.abs(dy) > 5) grab.moved = true;
    dragTo(grab.start + dy);
  });

  handle.addEventListener('pointerup', () => {
    if (!grab) return;
    if (grab.moved) settle(grab.from);
    else snapTo(grab.from === 'open' ? 'peek' : 'open');
    grab = null;
    swallowNextClick();
  });

  // Usap isi panel: ke bawah saat gulirannya sudah mentok di atas → turun satu posisi;
  // ke atas saat belum terbuka penuh → naik. Selain itu usapan tetap menggulir isi panel seperti biasa.
  let swipe = null;  // { x, y, from, start, section, mode: null | 'drag' | 'scroll' }

  panel.addEventListener('touchstart', e => {
    if (!window.matchMedia('(max-width: 800px)').matches || e.touches.length !== 1) return;
    if (e.target.closest('#panel-handle')) return;  // pegangan punya penanganan sendiri
    const t = e.touches[0];
    swipe = { x: t.clientX, y: t.clientY, from: panel.dataset.sheet, start: getCurrentTranslateY(),
              section: e.target.closest('.panel-section'), mode: null };
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!swipe || swipe.mode === 'scroll') return;
    const t  = e.touches[0];
    const dy = t.clientY - swipe.y;
    if (!swipe.mode) {
      if (Math.abs(dy) < 6) return;
      const atTop    = !swipe.section || swipe.section.scrollTop <= 0;
      const vertical = Math.abs(dy) > Math.abs(t.clientX - swipe.x);
      const canDrag  = dy < 0 ? swipe.from !== 'open' : atTop && swipe.from !== 'hidden';
      swipe.mode = vertical && canDrag ? 'drag' : 'scroll';
      if (swipe.mode === 'scroll') return;
      panel.classList.add('dragging');
    }
    e.preventDefault();  // jangan ikut menggulir / memantul selama panel ditarik
    dragTo(swipe.start + dy);
  }, { passive: false });

  const endSwipe = () => {
    if (swipe?.mode === 'drag') { settle(swipe.from); swallowNextClick(); }
    swipe = null;
  };
  panel.addEventListener('touchend', endSwipe);
  panel.addEventListener('touchcancel', endSwipe);

  // Pengguna baru langsung melihat form, bukan hanya peta dengan pegangan kecil di bawah
  if (window.matchMedia('(max-width: 800px)').matches) snapTo('open');
}

// ---------------------------------------------------------------------------
// MAP POPUP HTML
// ---------------------------------------------------------------------------
function buildMapPopupHtml(r) {
  const sub = itemSub(r);
  const imgHtml = r.imageFilename
    ? `<img class="map-popup-img" src="${commonsFileUrl(r.imageFilename, 200)}" alt="" loading="lazy">`
    : '';
  const isMobile = window.innerWidth <= 800;
  const btnHtml  = isMobile
    ? `<button class="popup-lihat-detail" data-qid="${escHtml(r.id)}">${escHtml(msg('popup-view-detail'))} →</button>`
    : '';
  return `
    <div class="map-popup">
      ${imgHtml}
      <div class="map-popup-body">
        <strong class="map-popup-title">${escHtml(r.title)}</strong>
        ${sub ? `<div class="map-popup-sub">${escHtml(sub)}</div>` : ''}
        ${btnHtml}
      </div>
    </div>`;
}

function openBottomSheet() {
  _setSheetOpen?.(true);
}
