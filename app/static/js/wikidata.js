'use strict';

/* ==========================================================================
   wikidata.js — Lapisan data: SPARQL templates, query builder, fetch utils
   Tidak menyentuh DOM sama sekali.
   ========================================================================== */

const WD_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WD_COMMONS_URL = 'https://commons.wikimedia.org/wiki/';
const WD_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WD_WIKI_API = 'https://id.wikipedia.org/w/api.php';
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id". }
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id". }
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id". }
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
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
// DETAIL QUERY (Query 6) — data dinamis per klaster
// ---------------------------------------------------------------------------
function buildDetailQuery(qid, klasterNama) {
  const klaster = klasterNama || '';

  let sel = `SELECT ?siteQid (GROUP_CONCAT(DISTINCT ?tipeLabel; SEPARATOR=", ") AS ?tipeList) (SAMPLE(?ketVal) AS ?ketinggian) (SAMPLE(?luasData) AS ?luas) `;
  let whr = `
  VALUES ?site { wd:${qid} }
  OPTIONAL {
    ?site wdt:P31 ?tipeVal .
    OPTIONAL { ?tipeVal rdfs:label ?tipeLabelId . FILTER(LANG(?tipeLabelId) = "id") }
    BIND(COALESCE(?tipeLabelId, REPLACE(STR(?tipeVal), "^.*/", "")) AS ?tipeLabel)
  }
  OPTIONAL { ?site wdt:P2044 ?ketVal . }
  OPTIONAL {
    ?site p:P2046 ?luasStmt .
    ?luasStmt psv:P2046 ?luasNode .
    ?luasNode wikibase:quantityAmount ?luasVal .
    OPTIONAL { ?luasNode wikibase:quantityUnit ?luasUnitItem . ?luasUnitItem rdfs:label ?luasUnitLabel . FILTER(LANG(?luasUnitLabel) = "id") }
    OPTIONAL { ?luasStmt pq:P518 ?luasBagianItem . ?luasBagianItem rdfs:label ?luasBagianLabel . FILTER(LANG(?luasBagianLabel) = "id") }
    BIND(CONCAT(STR(?luasVal), "|", IF(BOUND(?luasUnitLabel), ?luasUnitLabel, ""), "|", IF(BOUND(?luasBagianLabel), ?luasBagianLabel, "")) AS ?luasData)
  }
  `;

  const KB = ['Masjid','Bangunan bersejarah','Gereja & katedral','Vihara & kelenteng',
    'Rumah sakit','Sekolah','Universitas & kampus','Perpustakaan','Istana','Bandar udara',
    'Terminal bus','Stadion & lapangan olahraga','Kuil & candi','Benteng dan bunker',
    'Bangunan secara umum dan struktur arsitektur','Pasar dan mall','Hotel dan resor',
    'Monumen, patung, & memorial','Museum','Stasiun kereta api'];

  if (KB.includes(klaster)) {
    sel += `(SAMPLE(?kapVal) AS ?kapasitas) (SAMPLE(?kondisiLabel) AS ?kondisi) (SAMPLE(?webVal) AS ?lamanResmi) (SAMPLE(?arsitekLabel) AS ?arsitek) (GROUP_CONCAT(DISTINCT ?fasilitasLabel; separator=", ") AS ?fasilitasList) (GROUP_CONCAT(DISTINCT ?gayaLabel; separator=", ") AS ?gayaList) `;
    whr += `
      OPTIONAL { ?site wdt:P1083 ?kapVal . }
      OPTIONAL { ?site wdt:P5817 ?kondisiItem . ?kondisiItem rdfs:label ?kondisiLabel . FILTER(LANG(?kondisiLabel) = "id") }
      OPTIONAL { ?site wdt:P856 ?webVal . }
      OPTIONAL { ?site wdt:P84 ?arsitekItem . ?arsitekItem rdfs:label ?arsitekLabel . FILTER(LANG(?arsitekLabel) = "id") }
      OPTIONAL { ?site wdt:P912 ?fasilitasItem . ?fasilitasItem rdfs:label ?fasilitasLabel . FILTER(LANG(?fasilitasLabel) = "id") }
      OPTIONAL { ?site wdt:P149 ?gayaItem . ?gayaItem rdfs:label ?gayaLabel . FILTER(LANG(?gayaLabel) = "id") }
    `;
  }

  if (klaster === 'Kabupaten dan kota') {
    sel += `(SAMPLE(?popData) AS ?populasi) (SAMPLE(?govData) AS ?kepalaDaerah) (SAMPLE(?webVal) AS ?lamanResmi) `;
    whr += `
      OPTIONAL { ?site wdt:P856 ?webVal . }
      OPTIONAL {
        ?site p:P1082 ?popStmt . ?popStmt ps:P1082 ?popVal .
        OPTIONAL { ?popStmt pq:P585 ?popDate . }
        BIND(CONCAT(STR(?popVal), "|", STR(YEAR(?popDate))) AS ?popData)
      }
      OPTIONAL {
        ?site p:P6 ?govStmt . ?govStmt ps:P6 ?govItem .
        ?govItem rdfs:label ?govLabel . FILTER(LANG(?govLabel) = "id")
        OPTIONAL { ?govStmt pq:P580 ?govDate . }
        OPTIONAL { ?govWiki schema:about ?govItem ; schema:isPartOf <https://id.wikipedia.org/> . }
        BIND(CONCAT(STR(?govLabel), "|", STR(YEAR(?govDate)), "|", IF(BOUND(?govWiki), STR(?govWiki), "kosong")) AS ?govData)
      }
    `;
  } else if (klaster === 'Stasiun kereta api') {
    sel += `(GROUP_CONCAT(DISTINCT ?jalurLabel; separator=", ") AS ?jalurList) `;
    whr += `OPTIONAL { ?site wdt:P81 ?jalurItem . ?jalurItem rdfs:label ?jalurLabel . FILTER(LANG(?jalurLabel) = "id") }`;
  } else if (klaster === 'Museum') {
    sel += `(SAMPLE(?koleksiData) AS ?jumlahKoleksi) (GROUP_CONCAT(DISTINCT ?spesialisasiLabel; separator=", ") AS ?spesialisasiList) `;
    whr += `
      OPTIONAL {
        ?site p:P1436 ?koleksiStmt . ?koleksiStmt psv:P1436 ?koleksiNode .
        ?koleksiNode wikibase:quantityAmount ?koleksiVal .
        OPTIONAL { ?koleksiNode wikibase:quantityUnit ?koleksiUnitItem . ?koleksiUnitItem rdfs:label ?koleksiUnitLabel . FILTER(LANG(?koleksiUnitLabel) = "id") }
        BIND(CONCAT(STR(?koleksiVal), "|", IF(BOUND(?koleksiUnitLabel), ?koleksiUnitLabel, "")) AS ?koleksiData)
      }
      OPTIONAL { ?site wdt:P101 ?spesialisasiItem . ?spesialisasiItem rdfs:label ?spesialisasiLabel . FILTER(LANG(?spesialisasiLabel) = "id") }
    `;
  }

  if (['Prasasti','Situs arkeologi lainnya','Artefak'].includes(klaster)) {
    sel += `(SAMPLE(?tglTemuData) AS ?tglTemu) (SAMPLE(?tempatTemuLabel) AS ?tempatTemu) `;
    whr += `
      OPTIONAL {
        ?site p:P575 ?tglTemuStmt . ?tglTemuStmt psv:P575 ?tglTemuNode .
        ?tglTemuNode wikibase:timeValue ?tglTemuVal ; wikibase:timePrecision ?tglTemuPrec .
        BIND(CONCAT(STR(?tglTemuVal), "|", STR(?tglTemuPrec)) AS ?tglTemuData)
      }
      OPTIONAL { ?site wdt:P189 ?tempatTemuItem . ?tempatTemuItem rdfs:label ?tempatTemuLabel . FILTER(LANG(?tempatTemuLabel) = "id") }
    `;
  }

  if (klaster === 'Situs arkeologi') {
    sel += `(GROUP_CONCAT(DISTINCT ?agamaLabel; separator=", ") AS ?agamaList) `;
    whr += `OPTIONAL { ?site wdt:P140 ?agamaItem . ?agamaItem rdfs:label ?agamaLabel . FILTER(LANG(?agamaLabel) = "id") }`;
  }

  if (['Pulau','Peristiwa lainnya','Perang & konflik','Bencana lainnya','Situs arkeologi','Prasasti','Artefak'].includes(klaster)) {
    sel += `(SAMPLE(?bagianDariLabel) AS ?bagianDari) `;
    whr += `OPTIONAL { ?site wdt:P361 ?bagianDariItem . ?bagianDariItem rdfs:label ?bagianDariLabel . FILTER(LANG(?bagianDariLabel) = "id") }`;
  }

  if (['Prasasti','Lontar','Naskah','Media massa','Publikasi','Latar karya sastra','Lukisan'].includes(klaster)) {
    sel += `(GROUP_CONCAT(DISTINCT ?bhsLabel; separator=", ") AS ?bahasaList) (GROUP_CONCAT(DISTINCT ?bentukLabel; separator=", ") AS ?bentukList) (GROUP_CONCAT(DISTINCT ?genreLabel; separator=", ") AS ?genreList) (GROUP_CONCAT(DISTINCT ?penulisLabel; separator=", ") AS ?penulisList) (GROUP_CONCAT(DISTINCT ?subjekLabel; separator=", ") AS ?subjekList) `;
    whr += `
      OPTIONAL { ?site wdt:P407 ?bhsItem . ?bhsItem rdfs:label ?bhsLabel . FILTER(LANG(?bhsLabel) = "id") }
      OPTIONAL { ?site wdt:P7937 ?bentukItem . ?bentukItem rdfs:label ?bentukLabel . FILTER(LANG(?bentukLabel) = "id") }
      OPTIONAL { ?site wdt:P136 ?genreItem . ?genreItem rdfs:label ?genreLabel . FILTER(LANG(?genreLabel) = "id") }
      OPTIONAL { ?site wdt:P50 ?penulisItem . ?penulisItem rdfs:label ?penulisLabel . FILTER(LANG(?penulisLabel) = "id") }
      OPTIONAL { ?site wdt:P921 ?subjekItem . ?subjekItem rdfs:label ?subjekLabel . FILTER(LANG(?subjekLabel) = "id") }
    `;
  }

  if (['Prasasti','Artefak','Lontar','Naskah','Lukisan'].includes(klaster)) {
    sel += `(GROUP_CONCAT(DISTINCT ?kolektorLabel; separator=", ") AS ?kolektorList) `;
    whr += `OPTIONAL { ?site wdt:P195 ?kolektorItem . ?kolektorItem rdfs:label ?kolektorLabel . FILTER(LANG(?kolektorLabel) = "id") }`;
  }

  if (['Prasasti','Situs arkeologi','Artefak','Lontar','Naskah','Lukisan'].includes(klaster)) {
    sel += `(SAMPLE(?penciptaLabel) AS ?pencipta) (SAMPLE(?panjangData) AS ?panjang) (SAMPLE(?lebarData) AS ?lebar) (SAMPLE(?tinggiData) AS ?tinggi) (GROUP_CONCAT(DISTINCT ?bahanLabel; separator=", ") AS ?bahanList) (GROUP_CONCAT(DISTINCT ?aksaraLabel; separator=", ") AS ?aksaraList) `;
    whr += `
      OPTIONAL { ?site wdt:P170 ?penciptaItem . ?penciptaItem rdfs:label ?penciptaLabel . FILTER(LANG(?penciptaLabel) = "id") }
      OPTIONAL {
        ?site p:P2043 ?pjgStmt . ?pjgStmt psv:P2043 ?pjgNode .
        ?pjgNode wikibase:quantityAmount ?pjgVal .
        OPTIONAL { ?pjgNode wikibase:quantityUnit ?pjgUnitItem . ?pjgUnitItem rdfs:label ?pjgUnitLabel . FILTER(LANG(?pjgUnitLabel) = "id") }
        BIND(CONCAT(STR(?pjgVal), "|", IF(BOUND(?pjgUnitLabel), ?pjgUnitLabel, "")) AS ?panjangData)
      }
      OPTIONAL {
        ?site p:P2049 ?lbrStmt . ?lbrStmt psv:P2049 ?lbrNode .
        ?lbrNode wikibase:quantityAmount ?lbrVal .
        OPTIONAL { ?lbrNode wikibase:quantityUnit ?lbrUnitItem . ?lbrUnitItem rdfs:label ?lbrUnitLabel . FILTER(LANG(?lbrUnitLabel) = "id") }
        BIND(CONCAT(STR(?lbrVal), "|", IF(BOUND(?lbrUnitLabel), ?lbrUnitLabel, "")) AS ?lebarData)
      }
      OPTIONAL {
        ?site p:P2048 ?tgStmt . ?tgStmt psv:P2048 ?tgNode .
        ?tgNode wikibase:quantityAmount ?tgVal .
        OPTIONAL { ?tgNode wikibase:quantityUnit ?tgUnitItem . ?tgUnitItem rdfs:label ?tgUnitLabel . FILTER(LANG(?tgUnitLabel) = "id") }
        BIND(CONCAT(STR(?tgVal), "|", IF(BOUND(?tgUnitLabel), ?tgUnitLabel, "")) AS ?tinggiData)
      }
      OPTIONAL { ?site wdt:P186 ?bahanItem . ?bahanItem rdfs:label ?bahanLabel . FILTER(LANG(?bahanLabel) = "id") }
      OPTIONAL { ?site wdt:P282 ?aksaraItem . ?aksaraItem rdfs:label ?aksaraLabel . FILTER(LANG(?aksaraLabel) = "id") }
    `;
  }

  if (klaster === 'Media massa') {
    sel += `(GROUP_CONCAT(DISTINCT ?pemredLabel; separator=", ") AS ?pemredList) (GROUP_CONCAT(DISTINCT ?pendiriLabel; separator=", ") AS ?pendiriList) (SAMPLE(?penerbitLabel) AS ?penerbit) (SAMPLE(?berakhirData) AS ?berakhirPada) `;
    whr += `
      OPTIONAL { ?site wdt:P5769 ?pemredItem . ?pemredItem rdfs:label ?pemredLabel . FILTER(LANG(?pemredLabel) = "id") }
      OPTIONAL { ?site wdt:P112 ?pendiriItem . ?pendiriItem rdfs:label ?pendiriLabel . FILTER(LANG(?pendiriLabel) = "id") }
      OPTIONAL { ?site wdt:P123 ?penerbitItem . ?penerbitItem rdfs:label ?penerbitLabel . FILTER(LANG(?penerbitLabel) = "id") }
      OPTIONAL {
        ?site p:P582 ?berakhirStmt . ?berakhirStmt psv:P582 ?berakhirNode .
        ?berakhirNode wikibase:timeValue ?berakhirVal ; wikibase:timePrecision ?berakhirPrec .
        BIND(CONCAT(STR(?berakhirVal), "|", STR(?berakhirPrec)) AS ?berakhirData)
      }
    `;
  } else if (klaster === 'Hidangan') {
    sel += `(GROUP_CONCAT(DISTINCT ?bahanLabel; separator=", ") AS ?bahanList) (GROUP_CONCAT(DISTINCT ?caraLabel; separator=", ") AS ?caraList) (SAMPLE(?wikibooksUrl) AS ?wikibooks) `;
    whr += `
      OPTIONAL { ?site wdt:P186 ?bahanItem . ?bahanItem rdfs:label ?bahanLabel . FILTER(LANG(?bahanLabel) = "id") }
      OPTIONAL { ?site wdt:P2079 ?caraItem . ?caraItem rdfs:label ?caraLabel . FILTER(LANG(?caraLabel) = "id") }
      OPTIONAL { ?wikibooksUrl schema:about ?site ; schema:isPartOf <https://id.wikibooks.org/> . }
    `;
  } else if (klaster === 'Bahasa') {
    sel += `(SAMPLE(?penuturData) AS ?penutur) `;
    whr += `
      OPTIONAL {
        ?site p:P1098 ?penuturStmt . ?penuturStmt ps:P1098 ?penuturVal .
        OPTIONAL { ?penuturStmt pq:P585 ?penuturDate . }
        BIND(CONCAT(STR(?penuturVal), "|", STR(YEAR(?penuturDate))) AS ?penuturData)
      }
    `;
  } else if (klaster === 'Tempat lahir tokoh') {
    sel += `(SAMPLE(?wafatData) AS ?tglWafat) (GROUP_CONCAT(DISTINCT ?kerjaLabel; separator=", ") AS ?pekerjaanList) (GROUP_CONCAT(DISTINCT ?ahliLabel; separator=", ") AS ?spesialisasiList) (GROUP_CONCAT(DISTINCT ?koleksiKaryaLabel; separator=", ") AS ?koleksiKaryaList) `;
    whr += `
      OPTIONAL {
        ?site p:P570 ?wafatStmt . ?wafatStmt psv:P570 ?wafatNode .
        ?wafatNode wikibase:timeValue ?wafatVal ; wikibase:timePrecision ?wafatPrec .
        BIND(CONCAT(STR(?wafatVal), "|", STR(?wafatPrec)) AS ?wafatData)
      }
      OPTIONAL { ?site wdt:P106 ?kerjaItem . ?kerjaItem rdfs:label ?kerjaLabel . FILTER(LANG(?kerjaLabel) = "id") }
      OPTIONAL { ?site wdt:P101 ?ahliItem . ?ahliItem rdfs:label ?ahliLabel . FILTER(LANG(?ahliLabel) = "id") }
      OPTIONAL { ?site wdt:P6379 ?koleksiKaryaItem . ?koleksiKaryaItem rdfs:label ?koleksiKaryaLabel . FILTER(LANG(?koleksiKaryaLabel) = "id") }
    `;
  } else if (klaster === 'Gunung') {
    sel += `(SAMPLE(?gunungLabel) AS ?pegunungan) `;
    whr += `OPTIONAL { ?site wdt:P4552 ?gunungItem . ?gunungItem rdfs:label ?gunungLabel . FILTER(LANG(?gunungLabel) = "id") }`;
  }

  if (['Gempa bumi dan tsunami','Bencana lainnya','Peristiwa lainnya','Perang & konflik'].includes(klaster)) {
    sel += `(SAMPLE(?korbanVal) AS ?korban) `;
    whr += `OPTIONAL { ?site wdt:P1120 ?korbanVal . }`;
  }

  return `${sel} WHERE { ${whr} BIND(SUBSTR(STR(?site), 32) AS ?siteQid) } GROUP BY ?siteQid`;
}

async function fetchDetailProps(qid, klasterNama, signal) {
  const q = buildDetailQuery(qid, klasterNama);
  const rows = await sparqlWithRetry(q, signal);
  if (!rows.length) return {};
  const props = {};
  const r = rows[0];
  Object.keys(r).forEach(k => {
    if (k !== 'siteQid' && r[k]?.value) props[k] = r[k].value;
  });
  return props;
}
