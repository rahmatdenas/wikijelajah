'use strict';

/* ==========================================================================
   wikidata.js — Lapisan data: SPARQL templates, query builder, fetch utils
   Tidak menyentuh DOM sama sekali.
   ========================================================================== */

const WD_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WD_COMMONS_URL = 'https://commons.wikimedia.org/wiki/';
const WD_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WD_WIKI_API = 'https://id.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_PAGE_SIZE = 5000;
const WD_COORD_BATCH = 1000;
const WD_MEDIA_BATCH = 200;

// ---------------------------------------------------------------------------
// SPARQL TEMPLATES (placeholder: <NAMA>)
// ---------------------------------------------------------------------------

const _T_ITEMS = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      VALUES ?j { <JENIS> }
      <KURUNG_BUKA>
      <WILAYAH>
      ?s <P31_MATCH> ?j ;
         wdt:<PROP_LOKASI> ?l .
      ?l wdt:P131* ?p .
      <KURUNG_TUTUP>
      <UNION>
    }
    ORDER BY ?s ?p ?l
    LIMIT <LIMIT> OFFSET <OFFSET>
  }
  OPTIONAL {
    ?s p:<PROP_TAHUN> ?iS .
    ?iS psv:<PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ; wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s),32) AS ?SQ)
  BIND(SUBSTR(STR(?p),32) AS ?PQ)
  BIND(SUBSTR(STR(?l),32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en,mul". }
}`;

const _T_ITEMS_ANY = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      <KURUNG_BUKA>
      <WILAYAH>
      ?s wdt:P17 wd:Q252 ; wdt:P625 [] ; wdt:P18 [] ; wdt:P131 ?l .
      ?l wdt:P131* ?p .
      <KURUNG_TUTUP>
      <UNION>
    }
    ORDER BY ?s ?p ?l
    LIMIT <LIMIT> OFFSET <OFFSET>
  }
  OPTIONAL {
    ?s p:<PROP_TAHUN> ?iS .
    ?iS psv:<PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ; wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s),32) AS ?SQ)
  BIND(SUBSTR(STR(?p),32) AS ?PQ)
  BIND(SUBSTR(STR(?l),32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en,mul". }
}`;

const _T_ITEMS_NATIONAL = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?lLabel ?tM ?tP
WHERE {
  <FILTER_NASIONAL>
  ?s <P31_MATCH> ?j .
  VALUES ?j { <JENIS> }
  OPTIONAL {
    ?p wdt:P31 wd:Q5098 .
    ?s wdt:<PROP_LOKASI> ?l .
    ?l wdt:P131* ?p .
  }
  OPTIONAL {
    ?s p:<PROP_TAHUN> ?iS .
    ?iS psv:<PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ; wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s),32) AS ?SQ)
  BIND(SUBSTR(STR(?p),32) AS ?PQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en,mul". }
  LIMIT <LIMIT> OFFSET <OFFSET>
}`;

const _T_ITEMS_ABROAD = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      VALUES ?j { <JENIS> }
      ?s wdt:P17 <NEGARA> ; <P31_MATCH> ?j ; wdt:<PROP_LOKASI> ?l .
      OPTIONAL {
        ?l wdt:P131* ?p .
        ?p wdt:P131 <NEGARA> .
      }
    }
    ORDER BY ?s ?p ?l
    LIMIT <LIMIT> OFFSET <OFFSET>
  }
  OPTIONAL {
    ?s p:<PROP_TAHUN> ?iS .
    ?iS psv:<PROP_TAHUN> ?iN .
    ?iN wikibase:timeValue ?tM ; wikibase:timePrecision ?tP .
  }
  BIND(SUBSTR(STR(?s),32) AS ?SQ)
  BIND(SUBSTR(STR(?p),32) AS ?PQ)
  BIND(SUBSTR(STR(?l),32) AS ?LQ)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en,mul". }
}`;

const _T_COORDS = `SELECT DISTINCT ?siteQid ?coord WHERE {
  VALUES ?site { <QIDS> }
  <KLAUSA_KOORDINAT>
  ?coordStatement ps:P625 ?coord .
  FILTER NOT EXISTS { ?coordStatement pq:P518 ?x }
  BIND(SUBSTR(STR(?site),32) AS ?siteQid)
}`;

const _T_COORDS_DIRECT = `SELECT ?siteQid ?coord WHERE {
  VALUES ?site { <QIDS> }
  ?site wdt:P625 ?coord .
  BIND(SUBSTR(STR(?site),32) AS ?siteQid)
}`;

const _T_MEDIA = `SELECT ?siteQid (SAMPLE(?img) AS ?image) (SAMPLE(?wikiTitle) AS ?wikipediaUrlTitle) (SAMPLE(?cat) AS ?commonsCat) WHERE {
  VALUES ?site { <QIDS> }
  OPTIONAL {
    ?site p:P18 ?imgStmt .
    ?imgStmt ps:P18 ?img .
    FILTER NOT EXISTS { ?imgStmt pq:P3831 wd:Q16189205 }
    FILTER NOT EXISTS { ?imgStmt pq:P180 wd:Q192630 }
  }
  OPTIONAL {
    ?wiki schema:about ?site ; schema:isPartOf <https://id.wikipedia.org/> .
    BIND(SUBSTR(STR(?wiki),31) AS ?wikiTitle)
  }
  OPTIONAL { ?site wdt:P373 ?cat . }
  BIND(SUBSTR(STR(?site),32) AS ?siteQid)
} GROUP BY ?siteQid`;

// ---------------------------------------------------------------------------
// KLASTER YANG KOORDINATNYA DIAMBIL VIA LOKASI (bukan langsung P625)
// ---------------------------------------------------------------------------
const KLASTER_TANPA_KOORDINAT_LANGSUNG = new Set([
  'Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara',
  'Artefak', 'Budaya rakyat', 'Lukisan', 'Lontar', 'Naskah',
  'Perang & konflik', 'Tempat lahir tokoh', 'Bahasa', 'Publikasi',
  'Media massa', 'Latar karya sastra',
]);

const KLASTER_KHUSUS_NASIONAL = new Set([
  'Kabupaten dan kota', 'Gempa bumi dan tsunami',
  'Peristiwa lainnya', 'Publikasi', 'Lukisan',
]);

// ---------------------------------------------------------------------------
// QUERY BUILDER
// ---------------------------------------------------------------------------

/**
 * Bangun SPARQL query halaman tunggal dari parameter pencarian.
 * @param {Object}  p
 * @param {string}  p.jenis        - Q-IDs (e.g. "wd:Q32815 wd:Q56235676")
 * @param {string}  p.wilayah      - 'provinsi' | 'all' | 'luar_negeri'
 * @param {string}  p.provQid      - QID provinsi (e.g. "wd:Q3724")
 * @param {string}  p.negaraQid    - QID negara (e.g. "wd:Q17")
 * @param {string}  p.propLokasi   - default 'P131'
 * @param {string}  p.propTahun    - default 'P571'
 * @param {string}  p.klasterNama  - nama klaster untuk kasus khusus
 * @param {number}  p.limit
 * @param {number}  p.offset
 * @returns {string} SPARQL query siap kirim
 */
function buildItemsQuery(p) {
  const {
    jenis, wilayah, provQid = '', negaraQid = '',
    propLokasi = 'P131', propTahun = 'P571', klasterNama = 'Objek',
    useSubclass = false,
    limit = WD_PAGE_SIZE, offset = 0,
  } = p;

  const p31Match = useSubclass ? 'wdt:P31/wdt:P279*' : 'wdt:P31';
  const isApapun = jenis === 'apapun';

  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(k, 'g'), v), tpl);

  // --- Luar negeri ---
  if (wilayah === 'luar_negeri') {
    return fill(_T_ITEMS_ABROAD, {
      '<JENIS>': isApapun ? '' : jenis,
      '<NEGARA>': negaraQid,
      '<PROP_LOKASI>': propLokasi,
      '<PROP_TAHUN>': propTahun,
      '<P31_MATCH>': p31Match,
      '<LIMIT>': limit,
      '<OFFSET>': offset,
    });
  }

  // --- Seluruh Indonesia (all) ---
  if (wilayah === 'all') {
    if (KLASTER_KHUSUS_NASIONAL.has(klasterNama) && !isApapun) {
      const filterNasional = klasterNama === 'Publikasi'
        ? '?s wdt:P407 wd:Q9240 .'
        : '?s wdt:P17 wd:Q252 .';
      return fill(_T_ITEMS_NATIONAL, {
        '<FILTER_NASIONAL>': filterNasional,
        '<JENIS>': jenis,
        '<PROP_LOKASI>': propLokasi,
        '<PROP_TAHUN>': propTahun,
        '<P31_MATCH>': p31Match,
        '<LIMIT>': limit,
        '<OFFSET>': offset,
      });
    }
    const tpl = isApapun ? _T_ITEMS_ANY : _T_ITEMS;
    return fill(tpl, {
      '<WILAYAH>': '?p wdt:P31 wd:Q5098 .',
      '<JENIS>': jenis,
      '<PROP_LOKASI>': propLokasi,
      '<PROP_TAHUN>': propTahun,
      '<P31_MATCH>': p31Match,
      '<KURUNG_BUKA>': '', '<KURUNG_TUTUP>': '', '<UNION>': '',
      '<LIMIT>': limit, '<OFFSET>': offset,
    });
  }

  // --- Provinsi tertentu ---
  const unionBase = isApapun
    ? `?s wdt:P17 wd:Q252 ; wdt:P625 [] ; wdt:P18 [] ; wdt:P131 ?l .`
    : `?s ${p31Match} ?j ; wdt:${propLokasi} ?l .`;
  const unionClause = `UNION { BIND(${provQid} AS ?p) BIND(${provQid} AS ?l) ${unionBase} }`;

  const tpl = isApapun ? _T_ITEMS_ANY : _T_ITEMS;
  return fill(tpl, {
    '<WILAYAH>': `?p wdt:P131 ${provQid}.`,
    '<JENIS>': jenis,
    '<PROP_LOKASI>': propLokasi,
    '<PROP_TAHUN>': propTahun,
    '<P31_MATCH>': p31Match,
    '<KURUNG_BUKA>': '{', '<KURUNG_TUTUP>': '}',
    '<UNION>': unionClause,
    '<LIMIT>': limit, '<OFFSET>': offset,
  });
}

// ---------------------------------------------------------------------------
// FETCH UTILITIES
// ---------------------------------------------------------------------------

async function sparqlPost(query, signal) {
  const resp = await fetch(WD_SPARQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'Api-User-Agent': 'WikiJelajah/2.0 (teknologi@wikimedia.or.id)',
    },
    body: 'format=json&query=' + encodeURIComponent(query),
    signal,
  });
  if (!resp.ok) throw new Error(`SPARQL HTTP ${resp.status}`);
  const data = await resp.json();
  return data.results.bindings;
}

async function sparqlWithRetry(query, signal, maxRetry = 3) {
  for (let i = 1; i <= maxRetry; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await sparqlPost(query, signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (i === maxRetry) throw err;
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

/**
 * Fetch semua halaman dari query yang sudah punya LIMIT/OFFSET.
 * @param {Function} queryFn  - (limit, offset) => string query
 * @param {AbortSignal} signal
 * @param {Function} onRow    - dipanggil per baris
 * @param {Function} onPage   - dipanggil per halaman dengan total akumulatif
 */
async function fetchAllPages(queryFn, signal, onRow, onPage) {
  let offset = 0, total = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const rows = await sparqlWithRetry(queryFn(WD_PAGE_SIZE, offset), signal);
    rows.forEach(onRow);

    const unique = new Set(rows.map(r =>
      `${r.SQ?.value}|${r.PQ?.value ?? ''}|${r.LQ?.value ?? ''}`
    )).size;

    total += unique;
    onPage?.(total);

    if (unique < WD_PAGE_SIZE) break;
    offset += WD_PAGE_SIZE;
  }
}

// ---------------------------------------------------------------------------
// KOORDINAT (batch parallel)
// ---------------------------------------------------------------------------

async function fetchCoordinates(qids, klasterNama, propLokasi, signal, onProgress) {
  const useLokasi = KLASTER_TANPA_KOORDINAT_LANGSUNG.has(klasterNama);

  const chunks = chunkArray(qids, WD_COORD_BATCH);
  const coords = {};
  let done = 0;

  const PARALLEL = 4;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    await Promise.all(chunks.slice(i, i + PARALLEL).map(async chunk => {
      let q;
      if (useLokasi) {
        const klausaKoordinat = `?site wdt:${propLokasi} ?p131 . FILTER(?p131 != wd:Q252) ?p131 p:P625 ?coordStatement .`;
        q = _T_COORDS
          .replace('<QIDS>', chunk.join(' '))
          .replace('<KLAUSA_KOORDINAT>', klausaKoordinat);
      } else {
        q = _T_COORDS_DIRECT.replace('<QIDS>', chunk.join(' '));
      }
      const rows = await sparqlWithRetry(q, signal);
      rows.forEach(r => {
        const bits = r.coord.value.split(/[() ]/);
        coords[r.siteQid.value] = { lon: parseFloat(bits[1]), lat: parseFloat(bits[2]) };
      });
    }));

    done += Math.min(PARALLEL, chunks.length - i);
    onProgress?.(Math.round((done / chunks.length) * 100));
  }

  return coords;
}

// ---------------------------------------------------------------------------
// MEDIA: gambar + artikel Wikipedia (batch parallel, toleran gagal)
// ---------------------------------------------------------------------------

async function fetchMedia(qids, signal) {
  const chunks = chunkArray(qids, WD_MEDIA_BATCH);
  const media = {};

  await Promise.allSettled(chunks.map(async chunk => {
    const q = _T_MEDIA.replace('<QIDS>', chunk.join(' '));
    const rows = await sparqlWithRetry(q, signal);
    rows.forEach(r => {
      const qid = r.siteQid.value.includes('entity/')
        ? r.siteQid.value.split('entity/')[1]
        : r.siteQid.value;
      // Explicit null = "loaded, absent"; undefined = "not yet loaded"
      media[qid] = {
        imageFilename: r.image ? extractFilename(r.image.value) : null,
        articleTitle:  r.wikipediaUrlTitle
          ? decodeURIComponent(r.wikipediaUrlTitle.value.split('/').pop())
          : null,
        commonsCat: r.commonsCat ? r.commonsCat.value : null,
      };
    });
  }));

  return media;
}

// ---------------------------------------------------------------------------
// SINGLE-ITEM MEDIA (cepat, via wbgetentities — dipakai saat batch belum selesai)
// ---------------------------------------------------------------------------
async function fetchSingleItemMedia(qid, signal) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|sitelinks&sitefilter=idwiki&format=json&origin=*`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const entity = data.entities?.[qid];
  if (!entity) throw new Error('Entity not found');

  const p18       = entity.claims?.P18;
  const p373      = entity.claims?.P373;
  const idwiki    = entity.sitelinks?.idwiki;

  return {
    imageFilename: p18?.[0]?.mainsnak?.datavalue?.value?.replace(/ /g, '_') ?? null,
    commonsCat:    p373?.[0]?.mainsnak?.datavalue?.value ?? null,
    articleTitle:  idwiki?.title ?? null,
  };
}

// ---------------------------------------------------------------------------
// WIKIPEDIA EXCERPT
// ---------------------------------------------------------------------------

async function fetchWikipediaExcerpt(title, signal) {
  const url = new URL(WD_WIKI_API);
  Object.entries({
    action: 'query', format: 'json', prop: 'extracts',
    exintro: 1, redirects: true, titles: title, origin: '*',
  }).forEach(([k, v]) => url.searchParams.append(k, v));

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('Wikipedia HTTP ' + resp.status);
  const data = await resp.json();
  const page = Object.values(data.query.pages)[0];
  const raw = page.extract || '';

  const paragraphs = raw.match(/<p[^>]*>[\s\S]+?<\/p>/g) ?? [];
  let pick = paragraphs.find(p => p.length > 50) ?? '<p>Ringkasan artikel belum memadai.</p>';
  pick = pick
    .replace(/^<p[^>]*>(\s|<br\s*\/?>)*/i, '<p>')
    .replace(/<[^>]*>[^<]*(is deprecated|Lua error|Script error)[^<]*<\/[^>]*>/gi, '');

  return pick;
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
  if (!meta) return 'Data lisensi tidak tersedia.';

  let artist = meta.Artist?.value?.trim()
    .replace(/<(?!\/?a ?)[^>]+>/g, '')
    .replace(/Unknown authorUnknown author|UnknownUnknown/gi, 'Tak diketahui')
    .replace(/AnonymousUnknown author/gi, 'Anonim')
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

// ---------------------------------------------------------------------------
// OVERPASS API (poligon bangunan)
// ---------------------------------------------------------------------------

async function fetchOsmShape(qid, signal) {
  const overpassQuery = `[out:json][timeout:25];
(way["wikidata"="${qid}"];relation["wikidata"="${qid}"];);
out body;>;out skel qt;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(overpassQuery);
  const resp = await fetch(url, { signal });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (typeof osmtogeojson !== 'function') return null;
  const geo = osmtogeojson(data);
  return geo?.features?.length ? geo : null;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractFilename(url) {
  return decodeURIComponent(url.replace(
    /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//i, ''
  ));
}

function formatDate(dateStr, precision) {
  if (!dateStr) return null;
  const clean = dateStr.replace(/^[+-]/, '');
  const year  = clean.slice(0, 4);
  const month = parseInt(clean.slice(5, 7));
  const day   = parseInt(clean.slice(8, 10));
  const prec  = parseInt(precision) || 9;
  const M = ['','Januari','Februari','Maret','April','Mei','Juni',
             'Juli','Agustus','September','Oktober','November','Desember'];

  if (prec >= 11) return `${day} ${M[month]} ${year}`;
  if (prec === 10) return `${M[month]} ${year}`;
  if (prec === 9)  return year;
  if (prec === 8)  return `${year}-an`;
  if (prec === 7)  return `Abad ke-${Math.ceil(parseInt(year) / 100)}`;
  return year;
}

function commonsFileUrl(filename, width = 500) {
  return `${WD_COMMONS_URL}Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

function commonsFilePageUrl(filename) {
  return `${WD_COMMONS_URL}File:${encodeURIComponent(filename)}`;
}

// ---------------------------------------------------------------------------
// SKEMA ATRIBUT PER KATEGORI
// Setiap kategori punya daftar atribut tetap. Atribut yang kosong tetap
// ditampilkan dan bisa diisi langsung. Untuk menambah atribut, cukup tambah
// entri di ATRIBUT lalu masukkan ke daftar kategori di SKEMA_KATEGORI.
//
// type: 'item' | 'quantity' | 'time' | 'url' | 'string'
// unit: QID satuan default saat menambah nilai (quantity)
// unitLabel: teks satuan yang ditampilkan bila nilai memakai satuan default
// suffix: teks tambahan setelah angka (quantity tanpa satuan)
// ---------------------------------------------------------------------------

const Q_METER = 'Q11573';
const Q_KM2   = 'Q712226';

const ATRIBUT = {
  lokasi:          { pid: 'P131',  label: 'Lokasi',             type: 'item' },
  lokasiObjek:     { pid: 'P276',  label: 'Lokasi',             type: 'item' },
  didirikan:       { pid: 'P571',  label: 'Didirikan',          type: 'time' },
  ditetapkan:      { pid: 'P571',  label: 'Ditetapkan',         type: 'time' },
  dibuat:          { pid: 'P571',  label: 'Dibuat',             type: 'time' },
  kapasitas:       { pid: 'P1083', label: 'Kapasitas',          type: 'quantity', suffix: 'orang' },
  gaya:            { pid: 'P149',  label: 'Gaya arsitektur',    type: 'item' },
  arsitek:         { pid: 'P84',   label: 'Arsitek',            type: 'item' },
  agama:           { pid: 'P140',  label: 'Agama',              type: 'item' },
  denominasi:      { pid: 'P140',  label: 'Agama/denominasi',   type: 'item' },
  warisan:         { pid: 'P1435', label: 'Status warisan',     type: 'item' },
  laman:           { pid: 'P856',  label: 'Laman resmi',        type: 'url' },
  koleksiJumlah:   { pid: 'P1436', label: 'Jumlah koleksi',     type: 'quantity' },
  pengunjung:      { pid: 'P1174', label: 'Pengunjung/tahun',   type: 'quantity', suffix: 'orang' },
  tempatTerbit:    { pid: 'P291',  label: 'Tempat terbit',      type: 'item' },
  tanggalTerbit:   { pid: 'P577',  label: 'Tanggal terbit',     type: 'time' },
  penerbit:        { pid: 'P123',  label: 'Penerbit',           type: 'item' },
  bahasa:          { pid: 'P407',  label: 'Bahasa',             type: 'item' },
  tempatTemu:      { pid: 'P189',  label: 'Tempat ditemukan',   type: 'item' },
  tanggalTemu:     { pid: 'P575',  label: 'Tanggal ditemukan',  type: 'time' },
  bahan:           { pid: 'P186',  label: 'Bahan',              type: 'item' },
  koleksi:         { pid: 'P195',  label: 'Koleksi',            type: 'item' },
  statusGuna:      { pid: 'P5817', label: 'Status penggunaan',  type: 'item' },
  aksara:          { pid: 'P282',  label: 'Aksara',             type: 'item' },
  periode:         { pid: 'P2348', label: 'Periode',            type: 'item' },
  memperingati:    { pid: 'P547',  label: 'Memperingati',       type: 'item' },
  pencipta:        { pid: 'P170',  label: 'Pencipta',           type: 'item' },
  pelukis:         { pid: 'P170',  label: 'Pelukis',            type: 'item' },
  tinggi:          { pid: 'P2048', label: 'Tinggi',             type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  jumlahKamar:     { pid: 'P8733', label: 'Jumlah kamar',       type: 'quantity' },
  operator:        { pid: 'P137',  label: 'Operator',           type: 'item' },
  pengelola:       { pid: 'P137',  label: 'Pengelola',          type: 'item' },
  penghuni:        { pid: 'P466',  label: 'Penghuni',           type: 'item' },
  penghuniKlub:    { pid: 'P466',  label: 'Penghuni/klub',      type: 'item' },
  luas:            { pid: 'P2046', label: 'Luas',               type: 'quantity', unit: Q_KM2, unitLabel: 'km²' },
  ranjang:         { pid: 'P6801', label: 'Jumlah ranjang',     type: 'quantity' },
  pelajar:         { pid: 'P2196', label: 'Jumlah pelajar',     type: 'quantity', suffix: 'orang' },
  permukaan:       { pid: 'P765',  label: 'Permukaan lapangan', type: 'item' },
  rektor:          { pid: 'P1037', label: 'Rektor/direktur',    type: 'item' },
  iata:            { pid: 'P238',  label: 'Kode IATA',          type: 'string' },
  icao:            { pid: 'P239',  label: 'Kode ICAO',          type: 'string' },
  ketinggian:      { pid: 'P2044', label: 'Ketinggian',         type: 'quantity', unit: Q_METER, unitLabel: 'mdpl' },
  jalur:           { pid: 'P81',   label: 'Jalur',              type: 'item' },
  perairan:        { pid: 'P206',  label: 'Perairan',           type: 'item' },
  perairanSungai:  { pid: 'P206',  label: 'Perairan/sungai',    type: 'item' },
  iucn:            { pid: 'P814',  label: 'Kategori IUCN',      type: 'item' },
  kedalaman:       { pid: 'P4511', label: 'Kedalaman',          type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  panjang:         { pid: 'P2043', label: 'Panjang',            type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  pegunungan:      { pid: 'P4552', label: 'Pegunungan',         type: 'item' },
  prominensi:      { pid: 'P2660', label: 'Prominensi',         type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  bagianDari:      { pid: 'P361',  label: 'Bagian dari',        type: 'item' },
  penduduk:        { pid: 'P1082', label: 'Jumlah penduduk',    type: 'quantity', suffix: 'jiwa' },
  waktu:           { pid: 'P585',  label: 'Waktu',              type: 'time' },
  magnitudo:       { pid: 'P2527', label: 'Magnitudo',          type: 'quantity' },
  korban:          { pid: 'P1120', label: 'Korban jiwa',        type: 'quantity', suffix: 'jiwa' },
  penyebab:        { pid: 'P828',  label: 'Penyebab',           type: 'item' },
  mulai:           { pid: 'P580',  label: 'Mulai',              type: 'time' },
  berakhir:        { pid: 'P582',  label: 'Berakhir',           type: 'time' },
  peserta:         { pid: 'P710',  label: 'Peserta',            type: 'item' },
  latar:           { pid: 'P840',  label: 'Latar tempat',       type: 'item' },
  penulis:         { pid: 'P50',   label: 'Penulis',            type: 'item' },
  genre:           { pid: 'P136',  label: 'Genre',              type: 'item' },
  subjek:          { pid: 'P921',  label: 'Subjek',             type: 'item' },
  kepalaDaerah:    { pid: 'P6',    label: 'Kepala daerah',      type: 'item' },
  tempatLahir:     { pid: 'P19',   label: 'Tempat lahir',       type: 'item' },
  tanggalLahir:    { pid: 'P569',  label: 'Tanggal lahir',      type: 'time' },
  pekerjaan:       { pid: 'P106',  label: 'Pekerjaan',          type: 'item' },
  tanggalWafat:    { pid: 'P570',  label: 'Tanggal wafat',      type: 'time' },
  berasalDari:     { pid: 'P2341', label: 'Berasal dari',       type: 'item' },
  penutur:         { pid: 'P1098', label: 'Jumlah penutur',     type: 'quantity', suffix: 'orang' },
  statusUnesco:    { pid: 'P1999', label: 'Status UNESCO',      type: 'item' },
  negaraAsal:      { pid: 'P495',  label: 'Negara asal',        type: 'item' },
  caraBuat:        { pid: 'P2079', label: 'Cara pembuatan',     type: 'item' },
  waktuPelaksanaan:{ pid: 'P837',  label: 'Waktu pelaksanaan',  type: 'item' },
};

// Nama kategori harus sama persis dengan label di KATEGORI_DATA (app/utils/wikidata.py)
const SKEMA_KATEGORI = (A => ({
  // Umum
  'Kabupaten dan kota':          [A.penduduk, A.luas, A.kepalaDaerah, A.didirikan, A.laman],
  'Tempat lahir tokoh':          [A.tempatLahir, A.tanggalLahir, A.pekerjaan, A.tanggalWafat],

  // Budaya
  'Bahasa':                      [A.berasalDari, A.penutur, A.aksara, A.statusUnesco],
  'Budaya rakyat':               [A.lokasiObjek, A.negaraAsal, A.bagianDari],
  'Hidangan':                    [A.lokasiObjek, A.bahan, A.caraBuat, A.negaraAsal],
  'Pakaian':                     [A.lokasiObjek, A.bahan, A.negaraAsal],
  'Ritual dan upacara':          [A.lokasiObjek, A.agama, A.waktuPelaksanaan],
  'Tari dan pertunjukan':        [A.lokasiObjek, A.genre, A.negaraAsal],

  // Tempat ibadah
  'Masjid':                      [A.lokasi, A.didirikan, A.kapasitas, A.gaya, A.arsitek],
  'Gereja & katedral':           [A.lokasi, A.didirikan, A.denominasi, A.kapasitas, A.gaya],
  'Kuil & candi':                [A.lokasi, A.didirikan, A.agama, A.gaya, A.warisan],
  'Vihara & kelenteng':          [A.lokasi, A.didirikan, A.agama, A.kapasitas, A.gaya],

  // Media & museum
  'Media massa':                 [A.tempatTerbit, A.tanggalTerbit, A.penerbit, A.bahasa, A.laman],
  'Museum':                      [A.lokasi, A.didirikan, A.koleksiJumlah, A.pengunjung, A.laman],

  // Peninggalan sejarah
  'Artefak':                     [A.lokasiObjek, A.tempatTemu, A.tanggalTemu, A.bahan, A.koleksi],
  'Benteng dan bunker':          [A.lokasi, A.didirikan, A.statusGuna, A.warisan],
  'Prasasti':                    [A.lokasiObjek, A.tanggalTemu, A.aksara, A.bahasa, A.bahan],
  'Situs arkeologi lainnya':     [A.lokasi, A.periode, A.agama, A.tanggalTemu, A.warisan],
  'Monumen, patung, & memorial': [A.lokasi, A.didirikan, A.memperingati, A.pencipta, A.bahan],
  'Bangunan bersejarah lainnya': [A.lokasi, A.didirikan, A.gaya, A.arsitek, A.warisan],
  'Bangunan secara umum dan struktur arsitektur':
                                 [A.lokasi, A.didirikan, A.gaya, A.arsitek, A.tinggi],

  // Bangunan/tempat
  'Hotel dan resor':             [A.lokasi, A.didirikan, A.jumlahKamar, A.operator, A.laman],
  'Istana':                      [A.lokasi, A.didirikan, A.gaya, A.penghuni, A.warisan],
  'Kebun binatang & tanaman':    [A.lokasi, A.didirikan, A.luas, A.pengelola, A.laman],
  'Objek wisata':                [A.lokasi, A.luas, A.pengelola, A.pengunjung, A.laman],
  'Pasar dan mall':              [A.lokasi, A.didirikan, A.luas, A.pengelola, A.laman],
  'Perpustakaan':                [A.lokasi, A.didirikan, A.koleksiJumlah, A.pengelola, A.laman],
  'Ruang terbuka hijau':         [A.lokasi, A.didirikan, A.luas, A.pengelola],
  'Rumah sakit':                 [A.lokasi, A.didirikan, A.ranjang, A.pengelola, A.laman],
  'Sekolah':                     [A.lokasi, A.didirikan, A.pelajar, A.pengelola, A.laman],
  'Stadion & lapangan olahraga': [A.lokasi, A.didirikan, A.kapasitas, A.penghuniKlub, A.permukaan],
  'Universitas & kampus':        [A.lokasi, A.didirikan, A.pelajar, A.rektor, A.laman],

  // Transportasi
  'Bandar udara':                [A.lokasi, A.iata, A.icao, A.operator, A.ketinggian],
  'Pelabuhan':                   [A.lokasi, A.didirikan, A.operator, A.laman],
  'Stasiun kereta api':          [A.lokasi, A.didirikan, A.jalur, A.operator, A.ketinggian],
  'Terminal bus':                [A.lokasi, A.didirikan, A.operator],

  // Bentang alam
  'Air terjun':                  [A.lokasi, A.tinggi, A.perairan, A.ketinggian],
  'Cagar alam':                  [A.lokasi, A.luas, A.ditetapkan, A.pengelola, A.iucn],
  'Danau & kaldera':             [A.lokasi, A.luas, A.ketinggian, A.kedalaman],
  'Gua':                         [A.lokasi, A.panjang, A.ketinggian],
  'Gunung':                      [A.lokasi, A.ketinggian, A.pegunungan, A.prominensi],
  'Pantai':                      [A.lokasi, A.panjang, A.perairan, A.pengelola],
  'Pulau':                       [A.lokasi, A.luas, A.bagianDari, A.penduduk],
  'Waduk, bendungan, & embung':  [A.lokasi, A.didirikan, A.perairanSungai, A.tinggi, A.luas],

  // Peristiwa
  'Gempa bumi dan tsunami':      [A.lokasiObjek, A.waktu, A.magnitudo, A.korban, A.kedalaman],
  'Bencana lainnya':             [A.lokasiObjek, A.waktu, A.penyebab, A.korban],
  'Perang & konflik':            [A.lokasiObjek, A.mulai, A.berakhir, A.peserta, A.korban],
  'Peristiwa lainnya':           [A.lokasiObjek, A.waktu, A.bagianDari, A.peserta],

  // Karya & literatur
  'Latar karya sastra':          [A.latar, A.tanggalTerbit, A.penulis, A.bahasa, A.genre],
  'Lukisan':                     [A.lokasiObjek, A.dibuat, A.pelukis, A.koleksi, A.bahan],
  'Lontar':                      [A.lokasiObjek, A.bahasa, A.aksara, A.koleksi, A.subjek],
  'Naskah':                      [A.lokasiObjek, A.penulis, A.bahasa, A.aksara, A.koleksi],
  'Publikasi':                   [A.tempatTerbit, A.tanggalTerbit, A.penulis, A.penerbit, A.bahasa],
}))(ATRIBUT);

// Dipakai untuk "Semua Jenis Objek", Q-ID sendiri, dan kategori yang belum punya skema
const SKEMA_DEFAULT = [ATRIBUT.lokasi, ATRIBUT.didirikan];

function skemaKategori(klasterNama) {
  return SKEMA_KATEGORI[klasterNama] || SKEMA_DEFAULT;
}

// ---------------------------------------------------------------------------
// DETAIL ATRIBUT (via wbgetentities — langsung dari Wikidata, tanpa jeda
// sinkronisasi SPARQL, sehingga nilai yang baru disimpan langsung terlihat)
// ---------------------------------------------------------------------------

const UNIT_SIMBOL = {
  Q11573: 'm', Q828224: 'km', Q174728: 'cm', Q174789: 'mm',
  Q712226: 'km²', Q25343: 'm²', Q35852: 'ha',
};

async function _wbGet(params, signal) {
  const url = new URL(WD_API);
  Object.entries({ ...params, format: 'json', origin: '*' })
    .forEach(([k, v]) => url.searchParams.append(k, v));
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('Wikidata HTTP ' + resp.status);
  return resp.json();
}

/** Label (id → en → mul → QID) untuk banyak QID sekaligus. */
async function fetchLabels(qids, signal) {
  const labels = {};
  await Promise.all(chunkArray(qids, 50).map(async chunk => {
    const data = await _wbGet({
      action: 'wbgetentities', ids: chunk.join('|'), props: 'labels', languages: 'id|en|mul',
    }, signal);
    Object.entries(data.entities || {}).forEach(([id, e]) => {
      labels[id] = e.labels?.id?.value || e.labels?.en?.value || e.labels?.mul?.value || id;
    });
  }));
  return labels;
}

/** Klaim peringkat terbaik: preferred bila ada, selain itu normal. Deprecated dibuang. */
function bestRankClaims(claims = []) {
  const preferred = claims.filter(c => c.rank === 'preferred');
  return preferred.length ? preferred : claims.filter(c => c.rank === 'normal');
}

function _itemId(v) {
  return v?.id || (v?.['numeric-id'] ? `Q${v['numeric-id']}` : null);
}

function _unitQid(unitUrl) {
  return unitUrl && unitUrl !== '1' ? unitUrl.split('/').pop() : null;
}

function _qualifierYear(claim, pid) {
  const t = claim.qualifiers?.[pid]?.[0]?.datavalue?.value?.time;
  return t ? t.replace(/^[+-]/, '').slice(0, 4) : null;
}

/** Format angka quantity + satuan + tahun (kualifikator P585) untuk tampilan. */
function formatQuantity(claim, attr, labels) {
  const v      = claim.mainsnak.datavalue.value;
  const angka  = parseFloat(v.amount).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const unit   = _unitQid(v.unit);
  const satuan = !unit ? (attr.suffix || '')
    : unit === attr.unit && attr.unitLabel ? attr.unitLabel
    : UNIT_SIMBOL[unit] || labels[unit] || '';
  const tahun  = _qualifierYear(claim, 'P585');
  return [angka, satuan].filter(Boolean).join(' ') + (tahun ? ` (${tahun})` : '');
}

/**
 * Ambil nilai semua atribut skema kategori untuk satu butir.
 * @returns {Promise<{tipe: string, values: Object<string,{text: string, url?: string}>, wikibooks: ?string}>}
 *          values di-key dengan PID; atribut kosong tidak punya entri.
 */
async function fetchDetailProps(qid, klasterNama, signal) {
  const skema = skemaKategori(klasterNama);
  const data = await _wbGet({
    action: 'wbgetentities', ids: qid, props: 'claims|sitelinks/urls', sitefilter: 'idwikibooks',
  }, signal);
  const entity = data.entities?.[qid];
  if (!entity) throw new Error('Butir tidak ditemukan');

  const claims  = entity.claims || {};
  const valueOf = pid => bestRankClaims(claims[pid]);

  // Kumpulkan QID yang perlu label: P31, nilai item, dan satuan quantity
  const ids = new Set();
  valueOf('P31').forEach(c => { const id = _itemId(c.mainsnak.datavalue?.value); if (id) ids.add(id); });
  skema.forEach(attr => valueOf(attr.pid).forEach(c => {
    const v = c.mainsnak.datavalue?.value;
    if (!v) return;
    if (attr.type === 'item') { const id = _itemId(v); if (id) ids.add(id); }
    if (attr.type === 'quantity') {
      const u = _unitQid(v.unit);
      if (u && !UNIT_SIMBOL[u] && !(u === attr.unit && attr.unitLabel)) ids.add(u);
    }
  }));
  const labels = ids.size ? await fetchLabels([...ids], signal) : {};

  const tipe = valueOf('P31')
    .map(c => labels[_itemId(c.mainsnak.datavalue?.value)])
    .filter(Boolean).join(', ');

  const values = {};
  skema.forEach(attr => {
    const list = valueOf(attr.pid);
    if (!list.length) return;

    // "nilai tidak diketahui" / "tidak ada nilai" tetap dihitung terisi
    const withValue = list.filter(c => c.mainsnak.snaktype === 'value');
    if (!withValue.length) {
      values[attr.pid] = { text: list[0].mainsnak.snaktype === 'novalue' ? 'tidak ada' : 'tidak diketahui' };
      return;
    }

    if (attr.type === 'item') {
      values[attr.pid] = {
        text: withValue.map(c => labels[_itemId(c.mainsnak.datavalue.value)] || _itemId(c.mainsnak.datavalue.value)).join(', '),
      };
    } else if (attr.type === 'quantity') {
      // Bila ada beberapa nilai (mis. penduduk per tahun), ambil yang terbaru
      const latest = withValue.slice().sort((a, b) =>
        (_qualifierYear(b, 'P585') || '').localeCompare(_qualifierYear(a, 'P585') || ''))[0];
      values[attr.pid] = { text: formatQuantity(latest, attr, labels) };
    } else if (attr.type === 'time') {
      const v = withValue[0].mainsnak.datavalue.value;
      values[attr.pid] = { text: formatDate(v.time, v.precision) || v.time };
    } else if (attr.type === 'url') {
      const url = withValue[0].mainsnak.datavalue.value;
      values[attr.pid] = { text: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), url };
    } else {
      values[attr.pid] = { text: withValue.map(c => c.mainsnak.datavalue.value).join(', ') };
    }
  });

  return { tipe, values, wikibooks: entity.sitelinks?.idwikibooks?.url || null };
}

/** Saran butir Wikidata untuk input atribut bertipe item. */
async function searchWikidataItems(term, signal) {
  const data = await _wbGet({
    action: 'wbsearchentities', search: term, language: 'id', uselang: 'id',
    type: 'item', limit: 7,
  }, signal);
  return (data.search || []).map(s => ({ id: s.id, label: s.label || s.id, description: s.description || '' }));
}
