'use strict';

// Commons: nama berkas kosong, kategori, dan metadata gambar (untuk unggah & lightbox).

// ---------------------------------------------------------------------------
// NAMA BERKAS COMMONS YANG MASIH KOSONG (untuk unggah)
// ---------------------------------------------------------------------------

/**
 * Nama berkas pertama yang belum dipakai di Commons: `base.ext`, lalu `base_2.ext` … `base_10.ext`.
 * Ekstensi yang hanya beda huruf besar-kecil (.jpg / .JPG) dianggap sudah dipakai, sama dengan
 * peringatan "exists-normalized" Commons.
 * @returns {Promise<string>} '' bila semuanya sudah dipakai
 */
async function fetchFreeCommonsName(base, ext, signal) {
  const names = [`${base}.${ext}`, ...Array.from({ length: 9 }, (_, i) => `${base}_${i + 2}.${ext}`)];
  const variants = n => [...new Set([n, n.replace(/\.[^.]+$/, e => e.toLowerCase()), n.replace(/\.[^.]+$/, e => e.toUpperCase())])];
  const norm = t => { const n = t.replace(/^File:/, '').replace(/_/g, ' ').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };

  const url = new URL(WD_COMMONS_API);
  Object.entries({
    action: 'query', format: 'json', formatversion: 2, origin: '*',
    titles: names.flatMap(variants).map(n => 'File:' + n).join('|'),
  }).forEach(([k, v]) => url.searchParams.append(k, v));

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('Commons HTTP ' + resp.status);
  const pages = (await resp.json()).query?.pages || [];
  const taken = new Set(pages.filter(p => !p.missing && !p.invalid).map(p => norm(p.title)));
  return names.find(n => !variants(n).some(v => taken.has(norm(v)))) || '';
}

// ---------------------------------------------------------------------------
// KATEGORI COMMONS (untuk unggah) — hanya kategori yang ada, tidak tersembunyi, bukan pengalihan
// ---------------------------------------------------------------------------

// Tersembunyi = pageprops hiddencat; pengalihan = anggota Category:Category redirects
const COMMONS_CAT_PROPS = {
  prop: 'pageprops|categories', ppprop: 'hiddencat',
  clcategories: 'Category:Category redirects', cllimit: 'max',
};

async function _commonsQuery(params, signal) {
  const url = new URL(WD_COMMONS_API);
  Object.entries({ action: 'query', format: 'json', formatversion: 2, origin: '*', ...params })
    .forEach(([k, v]) => url.searchParams.append(k, v));
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('Commons HTTP ' + resp.status);
  return resp.json();
}

/** Nama kategori (tanpa "Category:") dari halaman yang bisa dipakai, urut sesuai `index` hasil pencarian. */
function _usableCategories(pages) {
  return (pages || [])
    .filter(p => !p.missing && !p.invalid && !p.pageprops && !p.categories?.length)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(p => p.title.replace(/^Category:/, ''));
}

/** Cari kategori Commons: awalan nama dulu ("Mosques in Pangk…"), lalu pencarian teks ("masjid pangkalpinang"). */
async function searchCommonsCategories(text, signal, limit = 8) {
  const [prefix, search] = await Promise.all([
    _commonsQuery({ generator: 'prefixsearch', gpssearch: text, gpsnamespace: 14, gpslimit: limit, ...COMMONS_CAT_PROPS }, signal),
    _commonsQuery({ generator: 'search', gsrsearch: text, gsrnamespace: 14, gsrlimit: limit, ...COMMONS_CAT_PROPS }, signal),
  ]);
  const names = [..._usableCategories(prefix.query?.pages), ..._usableCategories(search.query?.pages)];
  return [...new Set(names)].slice(0, limit);
}

/**
 * Saran kategori untuk butir: kategori Commons butir itu sendiri (P373), lalu kategori wilayah
 * terdekat yang punya P373 — naik lewat P131 sampai 3 tingkat (kelurahan → kecamatan → kota).
 * Hanya yang bisa dipakai di Commons.
 */
async function fetchCategorySuggestions(qid, signal) {
  const values = (claims, pid) => (claims?.[pid] || []).filter(c => c.rank !== 'deprecated')
    .map(c => c.mainsnak.datavalue?.value).filter(Boolean);
  const p131  = claims => [...new Set(values(claims, 'P131').map(v => v.id).filter(Boolean))].slice(0, 10);
  const own   = (await _wbGet({ action: 'wbgetentities', ids: qid, props: 'claims' }, signal)).entities?.[qid]?.claims;
  const names = values(own, 'P373');

  let places = p131(own);
  for (let level = 0; level < 3 && places.length; level++) {
    const ents  = (await _wbGet({ action: 'wbgetentities', ids: places.join('|'), props: 'claims' }, signal)).entities || {};
    const place = places.map(id => values(ents[id]?.claims, 'P373')).find(list => list.length);
    if (place) { names.push(place[0]); break; }
    places = [...new Set(places.flatMap(id => p131(ents[id]?.claims)))].slice(0, 10);
  }
  if (!names.length) return [];
  const data = await _commonsQuery({ titles: names.map(n => 'Category:' + n).join('|'), ...COMMONS_CAT_PROPS }, signal);
  const usable = new Set(_usableCategories(data.query?.pages));
  return [...new Set(names.map(n => n.replace(/_/g, ' ')))].filter(n => usable.has(n.charAt(0).toUpperCase() + n.slice(1)))
    .map(n => n.charAt(0).toUpperCase() + n.slice(1));
}

// ---------------------------------------------------------------------------
// COMMONS IMAGE METADATA (caption/lisensi)
// ---------------------------------------------------------------------------

async function fetchImageCaption(encodedFilename, signal) {
  const url = new URL(WD_COMMONS_API);
  Object.entries({
    action: 'query', format: 'json', prop: 'imageinfo',
    iiprop: 'extmetadata', titles: 'File:' + decodeURIComponent(encodedFilename), origin: '*',
  }).forEach(([k, v]) => url.searchParams.append(k, v));

  const resp = await fetch(url, { signal });
  if (!resp.ok) return '';
  const data = await resp.json();
  const page = Object.values(data.query.pages)[0];
  const meta = page?.imageinfo?.[0]?.extmetadata;
  if (!meta) return escHtml(msg('detail-license-missing'));

  let artist = meta.Artist?.value?.trim()
    .replace(/<(?!\/?a ?)[^>]+>/g, '')
    .replace(/Unknown authorUnknown author|UnknownUnknown/gi, escHtml(msg('detail-author-unknown')))
    .replace(/AnonymousUnknown author/gi, escHtml(msg('detail-author-anonymous')))
    .replace(/href="(?:https?:)?\/\//g, 'href="https://')
    .replace(/<a /gi, '<a target="_blank" ') ?? '';

  let license = '';
  if (meta.AttributionRequired?.value === 'true') {
    const short = meta.LicenseShortName?.value?.replace(/ /g, ' ').replace(/-/g, '‑') ?? '';
    license = meta.LicenseUrl?.value
      ? ` <a href="${meta.LicenseUrl.value}" target="_blank">[${short}]</a>`
      : ` [${short}]`;
  }

  return artist + license;
}
