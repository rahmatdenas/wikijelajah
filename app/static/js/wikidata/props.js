'use strict';

// Properti gambar yang sesuai butir dan properti di luar skema kategori.

// ---------------------------------------------------------------------------
// JENIS GAMBAR YANG SESUAI BUTIR (batasan "jenis subjek" properti gambar di Wikidata)
// ---------------------------------------------------------------------------

let _imagePropClassesP = null;

/**
 * Kelas yang diizinkan per properti menurut batasan jenis subjek (Q21503250) di Wikidata.
 * Properti tanpa batasan tidak ada di hasil (boleh untuk butir apa pun). Diambil sekali per kunjungan.
 * @returns {Promise<Object<string, string[]>>} pid → daftar QID kelas
 */
function fetchImagePropClasses(pids) {
  _imagePropClassesP ||= _wbGet({ action: 'wbgetentities', ids: pids.join('|'), props: 'claims' })
    .then(data => {
      const out = {};
      pids.forEach(pid => {
        const classes = (data.entities?.[pid]?.claims?.P2302 || [])
          .filter(c => c.mainsnak.datavalue?.value?.id === 'Q21503250')
          .flatMap(c => (c.qualifiers?.P2308 || []).map(q => q.datavalue?.value?.id).filter(Boolean));
        if (classes.length) out[pid] = classes;
      });
      return out;
    })
    .catch(err => { _imagePropClassesP = null; throw err; });  // coba lagi lain kali
  return _imagePropClassesP;
}

// Cakupan dari sisi aplikasi: batasan Wikidata ada yang sangat luas (mis. "gerbang" juga boleh untuk
// peristiwa, "langit malam" untuk banyak hal) atau tidak ada sama sekali ("dari udara", "pembangunan",
// "plakat"), sehingga tarian, hidangan, atau kain ikut ditawari. Selain P18, jenis gambar hanya untuk
// tempat / bangunan; makam & plakat juga untuk tokoh.
const _PLACE = ['Q2221906', 'Q811979'];  // lokasi geografis, struktur arsitektur
const IMAGE_PROP_SCOPE = {
  P5775: _PLACE, P1766: _PLACE, P3451: _PLACE, P9721: _PLACE, P8592: _PLACE,
  P12565: ['Q811979'],  // pembangunan: hanya bangunan / struktur, bukan pulau atau gunung
  P1801: [..._PLACE, 'Q5'],
  P1442: ['Q5'],  // manusia
};

/**
 * Properti gambar yang sesuai untuk butir: memenuhi batasan jenis subjek di Wikidata (bila ada) dan
 * cakupan aplikasi (IMAGE_PROP_SCOPE). Mis. "gambar makam" (P1442) hanya untuk tokoh, bukan masjid;
 * tarian atau hidangan hanya P18.
 * @returns {Promise<string[]>} urutan sama dengan `pids`
 */
async function fetchAllowedImageProps(qid, pids, signal) {
  const byProp = await fetchImagePropClasses(pids);
  const classes = [...new Set([...Object.values(byProp), ...Object.values(IMAGE_PROP_SCOPE)].flat())];
  const rows = await sparqlWithRetry(`SELECT DISTINCT ?c WHERE {
    VALUES ?c { ${classes.map(c => `wd:${c}`).join(' ')} }
    { wd:${qid} wdt:P31/wdt:P279* ?c } UNION { wd:${qid} wdt:P279* ?c }
  }`, signal, { maxRetry: 2, timeout: WD_TIMEOUT_BATCH });
  const matched = new Set(rows.map(r => r.c.value.split('/').pop()));
  const fits = list => !list || list.some(c => matched.has(c));
  return pids.filter(pid => fits(byProp[pid]) && fits(IMAGE_PROP_SCOPE[pid]));
}

/** Saran butir Wikidata untuk input atribut bertipe item. */
/**
 * Cari wilayah administratif (kota, kabupaten, kecamatan, desa, … di mana pun) berdasarkan nama.
 * Hasil pencarian Wikidata disaring ke turunan "administrative territorial entity" (Q56061).
 * @returns {Promise<Array<{id, label, description, negara}>>} urut relevansi pencarian
 */
async function searchWilayah(term, signal) {
  const q = `SELECT ?item ?itemLabel ?itemDescription ?negara WHERE {
    SERVICE wikibase:mwapi {
      bd:serviceParam wikibase:api "EntitySearch" ; wikibase:endpoint "www.wikidata.org" ;
                      mwapi:search ${JSON.stringify(term)} ; mwapi:language ${JSON.stringify(I18N.lang)} ; mwapi:limit "30" .
      ?item wikibase:apiOutputItem mwapi:item .
      ?ordinal wikibase:apiOrdinal true .
    }
    ?item wdt:P31/wdt:P279* wd:Q56061 .
    OPTIONAL { ?item wdt:P17 ?negara . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}" . }
  } ORDER BY ?ordinal`;
  const rows = await sparqlPost(q, signal);
  const seen = new Set();
  return rows.reduce((out, r) => {
    const id = r.item.value.split('/').pop();
    if (!seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        label: r.itemLabel?.value || id,
        description: r.itemDescription?.value || '',
        negara: r.negara ? r.negara.value.split('/').pop() : '',
      });
    }
    return out;
  }, []).slice(0, 10);
}

async function searchWikidataItems(term, signal) {
  const data = await _wbGet({
    action: 'wbsearchentities', search: term, language: I18N.lang, uselang: I18N.lang,
    type: 'item', limit: 7,
  }, signal);
  return (data.search || []).map(s => ({ id: s.id, label: s.label || s.id, description: s.description || '' }));
}

// ---------------------------------------------------------------------------
// PROPERTI DI LUAR SKEMA KATEGORI — "Tambah data lain" & "Lihat semua data"
// ---------------------------------------------------------------------------

// Tipe data Wikidata → tipe isian yang didukung datavalue.py; tipe lain belum bisa disunting di sini
const WD_DATATYPE_MAP = {
  'wikibase-item': 'item', quantity: 'quantity', time: 'time', url: 'url', string: 'string', 'external-id': 'string',
};

function _propResult(id, label, description, datatype) {
  return { id, label: label || id, description: description || '', type: WD_DATATYPE_MAP[datatype] || null };
}

/** Saran properti untuk butir ini (PropertySuggester Wikidata); properti yang sudah ada tidak disarankan. */
async function suggestProperties(qid, signal) {
  const data = await _wbGet({ action: 'wbsgetsuggestions', entity: qid, language: I18N.lang, limit: 15 }, signal);
  const ids = (data.search || []).map(s => s.id);
  if (!ids.length) return [];
  const ents = await _wbGet({
    action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|datatype', languages: WD_LANGS.join('|'),
  }, signal);
  return ids.map(id => {
    const e = ents.entities?.[id] || {};
    return _propResult(id, pickLang(e.labels), pickLang(e.descriptions), e.datatype);
  });
}

/** Cari properti Wikidata berdasarkan nama (bahasa antarmuka). */
async function searchProperties(term, signal) {
  const data = await _wbGet({
    action: 'wbsearchentities', search: term, language: I18N.lang, uselang: I18N.lang, type: 'property', limit: 10,
  }, signal);
  return (data.search || []).map(s => _propResult(s.id, s.label, s.description, s.datatype));
}

/** Satuan yang diizinkan batasan properti (P2302 "allowed units" Q21514353, kualifikator P2305). */
async function fetchPropertyUnits(pid, signal) {
  const data = await _wbGet({ action: 'wbgetclaims', entity: pid, property: 'P2302' }, signal);
  const ids = [];
  (data.claims?.P2302 || [])
    .filter(c => _itemId(c.mainsnak.datavalue?.value) === 'Q21514353')
    .forEach(c => (c.qualifiers?.P2305 || []).forEach(q => {
      const id = _itemId(q.datavalue?.value);
      if (id && !ids.includes(id)) ids.push(id);
    }));
  if (!ids.length) return [];
  const labels = await fetchLabels(ids.slice(0, 15), signal);
  return ids.slice(0, 15).map(id => ({ id, label: UNIT_SIMBOL[id] || labels[id] || id }));
}

/** Teks tampilan satu snak dengan tipe apa pun (untuk "Lihat semua data"). */
function formatAnySnak(snak, labels) {
  if (snak.snaktype !== 'value') return { text: msg(snak.snaktype === 'novalue' ? 'value-none' : 'value-unknown') };
  const v = snak.datavalue?.value;
  switch (snak.datavalue?.type) {
    case 'wikibase-entityid': { const id = _itemId(v) || v.id; return { text: labels[id] || id }; }
    case 'quantity': {
      const unit = _unitQid(v.unit);
      const angka = formatNumber(parseFloat(v.amount), { maximumFractionDigits: 2 });
      return { text: [angka, unit ? UNIT_SIMBOL[unit] || labels[unit] || '' : ''].filter(Boolean).join(' ') };
    }
    case 'time': return { text: formatDate(v.time, v.precision) || v.time };
    case 'monolingualtext': return { text: v.text };
    case 'globecoordinate': return { text: `${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}` };
    case 'string':
      if (snak.datatype === 'url') return { text: v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), url: v };
      if (snak.datatype === 'commons-media') return { text: v, url: commonsFilePageUrl(v) };
      return { text: v };
    default: return { text: '' };
  }
}

/** Semua properti butir beserta nilainya, dalam urutan klaim dari Wikidata. */
async function fetchAllClaimsView(claims, signal) {
  const ids = new Set(Object.keys(claims));
  Object.values(claims).forEach(list => bestRankClaims(list).forEach(c => {
    const v = c.mainsnak.datavalue?.value;
    const id = c.mainsnak.datavalue?.type === 'wikibase-entityid' ? _itemId(v) || v?.id : null;
    if (id) ids.add(id);
    const unit = c.mainsnak.datavalue?.type === 'quantity' ? _unitQid(v.unit) : null;
    if (unit && !UNIT_SIMBOL[unit]) ids.add(unit);
  }));
  const labels = ids.size ? await fetchLabels([...ids], signal) : {};
  return Object.entries(claims)
    .map(([pid, list]) => ({
      pid, label: labels[pid] || pid,
      values: bestRankClaims(list).map(c => formatAnySnak(c.mainsnak, labels)).filter(v => v.text),
    }))
    .filter(row => row.values.length);
}
