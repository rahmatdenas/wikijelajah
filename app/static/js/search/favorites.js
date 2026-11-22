'use strict';

// Penjelajahan favorit: pintasan ke pencarian (kategori + wilayah), bukan hasilnya.
// Belum login → localStorage browser; login → akun (server), favorit lokal dipindahkan sekali.

const FAV_LOCAL_KEY = 'wj-favorites';
const FAV_MAX = 10;
const Favorites = { items: [] };  // [{ query, area_label }], terbaru dulu

function _loadLocalFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_LOCAL_KEY) || '[]'); } catch { return []; }
}

function _saveLocalFavorites(items) {
  try { localStorage.setItem(FAV_LOCAL_KEY, JSON.stringify(items)); } catch {}
}

async function _favoritesApi(path, body) {
  const res = await fetch(`/api/favorites${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Favorit dari pencarian yang sedang tampil, atau null (mis. kategori Q-ID bebas). */
function currentFavorite() {
  const p = State.params;
  if (!p) return null;
  if (p.wilayah === 'sekitar') return { query: `region=nearby&radius=${p.radius}`, area_label: '' };
  const ctx = searchContext(p);
  if (!ctx) return null;
  return { query: contextQuery(ctx), area_label: ctx.area ? p.wilayahNama : '' };
}

/** [kategori, wilayah], mis. ["Masjid", "Papua"] — dibaca dari formulir agar mengikuti bahasa antarmuka. */
function favoriteParts(fav) {
  const q = new URLSearchParams(fav.query);
  const optText = (select, value) => [...(select?.options || [])].find(o => o.value === value)?.textContent.trim();
  if (q.get('region') === 'nearby') return [ucFirst(msg('nearby-all-objects')), ucFirst(msg('nearby-area', q.get('radius')))];
  const kategori = [...DOM.selectKategori.options].find(o => o.dataset.slug === q.get('category'))?.textContent.trim()
    || q.get('category');
  const wilayah = {
    province: () => optText(DOM.selectProvinsi, `wd:${q.get('province')}`) || q.get('province'),
    all:      () => msg('region-opt-all'),
    abroad:   () => optText(DOM.selectNegara, `wd:${q.get('country')}`) || q.get('country'),
    area:     () => fav.area_label || q.get('area'),
  }[q.get('region')]?.() || '';
  return [kategori, wilayah];
}

function renderFavorites() {
  const wrap = $('favorit-wrap'), list = $('favorit-list');
  if (!wrap || !list) return;
  wrap.classList.toggle('hidden', !Favorites.items.length);
  list.innerHTML = Favorites.items.map((f, i) => {
    const [kategori, wilayah] = favoriteParts(f);
    return `
    <li class="favorite-item">
      <button type="button" class="last-results favorite-open" data-index="${i}">
        ${escHtml([kategori, wilayah].filter(Boolean).join(' · '))} →
      </button>
      <button type="button" class="favorite-remove" data-index="${i}"
              title="${escHtml(msg('favorite-remove'))}" aria-label="${escHtml(msg('favorite-remove'))}">×</button>
    </li>`;
  }).join('');
}

/** Bintang di panel hasil: tersembunyi bila pencarian tidak bisa difavoritkan. */
function updateFavoriteButton() {
  const btn = $('btn-favorit');
  if (!btn) return;
  const fav = currentFavorite();
  const on = !!fav && Favorites.items.some(f => f.query === fav.query);
  btn.classList.toggle('hidden', !fav);
  btn.classList.toggle('is-favorite', on);
  btn.setAttribute('aria-pressed', String(on));
  const label = msg(on ? 'favorite-remove' : 'favorite-add');
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function _setFavorites(items) {
  Favorites.items = items.map(({ query, area_label }) => ({ query, area_label: area_label || '' }));
  if (!APP_USER) _saveLocalFavorites(Favorites.items);
  renderFavorites();
  updateFavoriteButton();
}

async function toggleFavorite() {
  const fav = currentFavorite();
  if (!fav) return;
  const exists = Favorites.items.some(f => f.query === fav.query);
  if (!exists && Favorites.items.length >= FAV_MAX) {
    showToast(msg('favorite-full', FAV_MAX), { type: 'error' });
    return;
  }
  try {
    if (APP_USER) {
      _setFavorites((await _favoritesApi(exists ? '/delete' : '', fav)).favorites);
    } else {
      _setFavorites(exists ? Favorites.items.filter(f => f.query !== fav.query) : [fav, ...Favorites.items]);
    }
    showToast(msg(exists ? 'favorite-removed' : 'favorite-saved'));
  } catch (err) {
    showToast(msg('favorite-error', err.message), { type: 'error' });
  }
}

async function removeFavorite(index) {
  const fav = Favorites.items[index];
  if (!fav) return;
  try {
    if (APP_USER) _setFavorites((await _favoritesApi('/delete', fav)).favorites);
    else _setFavorites(Favorites.items.filter(f => f.query !== fav.query));
  } catch (err) {
    showToast(msg('favorite-error', err.message), { type: 'error' });
  }
}

/** Buka favorit: isi formulir dari parameternya lalu cari (hasil di cache sesi langsung tampil). */
function openFavorite(index) {
  const fav = Favorites.items[index];
  if (!fav) return;
  const q = new URLSearchParams(fav.query);
  if (fav.area_label) q.set('area_label', fav.area_label);
  history.replaceState(null, '', `${location.pathname}?${q}`);
  if (applyQueryParams()) startSearch();
}

async function initFavorites() {
  $('btn-favorit')?.addEventListener('click', toggleFavorite);
  $('favorit-list')?.addEventListener('click', e => {
    const open = e.target.closest('.favorite-open'), del = e.target.closest('.favorite-remove');
    if (open) openFavorite(+open.dataset.index);
    if (del) removeFavorite(+del.dataset.index);
  });

  const local = _loadLocalFavorites();
  if (!APP_USER) { _setFavorites(local); return; }
  try {
    // Login pertama kali sejak menyimpan favorit lokal: pindahkan ke akun
    if (local.length) {
      const data = await _favoritesApi('/import', { favorites: local });
      _saveLocalFavorites([]);
      if (data.skipped) showToast(msg('favorite-import-skipped', data.skipped, FAV_MAX), { type: 'error' });
      _setFavorites(data.favorites);
    } else {
      _setFavorites((await _favoritesApi('')).favorites);
    }
  } catch (err) {
    console.warn('Favorit gagal dimuat:', err);
  }
}
