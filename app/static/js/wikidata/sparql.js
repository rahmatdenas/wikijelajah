'use strict';

// Template SPARQL, klaster khusus, dan query builder.

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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}". }
}`;

const _T_ITEMS_ANY = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      <KURUNG_BUKA>
      <WILAYAH>
      ?s <FILTER_NEGARA_ANY> wdt:P625 [] ; wdt:P18 [] ; wdt:P131 ?l .
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}". }
}`;

const _T_ITEMS_NATIONAL = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l WHERE {
      <FILTER_NASIONAL>
      ?s <P31_MATCH> ?j .
      VALUES ?j { <JENIS> }
      OPTIONAL {
        ?p wdt:P31 wd:Q5098 .
        ?s wdt:<PROP_LOKASI> ?l .
        ?l wdt:P131* ?p .
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}". }
}`;

// Di sekitar lokasi pengguna: semua objek berkoordinat dalam radius, tanpa kategori.
// ?p diisi jenis objek (P31) agar filter hasil menjadi filter jenis; koordinat & jarak ikut diambil.
const _T_ITEMS_NEARBY = `SELECT DISTINCT ?SQ ?sLabel ?PQ ?pLabel ?LQ ?lLabel ?tM ?tP ?coord ?dist
WHERE {
  {
    SELECT DISTINCT ?s ?p ?l ?coord ?dist WHERE {
      SERVICE wikibase:around {
        ?s wdt:P625 ?coord .
        bd:serviceParam wikibase:center "Point(<LON> <LAT>)"^^geo:wktLiteral ;
                        wikibase:radius "<RADIUS>" ;
                        wikibase:distance ?dist .
      }
      OPTIONAL { ?s wdt:P31 ?p . }
      OPTIONAL { ?s wdt:P131 ?l . }
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}". }
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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${WD_LANGS.join(',')}". }
}`;

const _T_COORDS = `SELECT DISTINCT ?siteQid ?p131 ?coord WHERE {
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

const _T_MEDIA = `SELECT ?siteQid (SAMPLE(?img) AS ?image) (SAMPLE(?wikiTitle) AS ?wikipediaUrlTitle) WHERE {
  VALUES ?site { <QIDS> }
  OPTIONAL {
    ?site p:P18 ?imgStmt .
    ?imgStmt ps:P18 ?img .
    FILTER NOT EXISTS { ?imgStmt pq:P3831 wd:Q16189205 }
    FILTER NOT EXISTS { ?imgStmt pq:P180 wd:Q192630 }
  }
  OPTIONAL {
    ?wiki schema:about ?site ; schema:isPartOf <${WIKI_BASE}/> .
    BIND(STRAFTER(STR(?wiki), "/wiki/") AS ?wikiTitle)
  }
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
  'Peristiwa lainnya', 'Publikasi', 'Lukisan', 'Cagar alam',
]);

// ---------------------------------------------------------------------------
// QUERY BUILDER
// ---------------------------------------------------------------------------

/**
 * Bangun SPARQL query halaman tunggal dari parameter pencarian.
 * @param {Object}  p
 * @param {string}  p.jenis        - Q-IDs (e.g. "wd:Q32815 wd:Q56235676")
 * @param {string}  p.wilayah      - 'provinsi' | 'all' | 'luar_negeri' | 'sekitar'
 * @param {number}  p.lat, p.lon, p.radius - titik pusat & radius (km), hanya untuk 'sekitar'
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
    jenis, wilayah, provQid = '', negaraQid = '', wilayahNegaraQid = '',
    propLokasi = 'P131', propTahun = 'P571', klasterNama = 'Objek',
    useSubclass = false, lat, lon, radius,
    limit = WD_PAGE_SIZE, offset = 0,
  } = p;

  const p31Match = useSubclass ? 'wdt:P31/wdt:P279*' : 'wdt:P31';
  const isApapun = jenis === 'apapun';
  // "Semua Jenis Objek" wajib dibatasi negara agar tidak timeout: Indonesia, atau negara
  // dari Q-ID wilayah bebas (bisa di luar negeri)
  const filterNegaraAny = `wdt:P17 ${(wilayah === 'qid' && wilayahNegaraQid) || 'wd:Q252'} ;`;

  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(k, 'g'), v), tpl);

  // --- Di sekitar lokasi pengguna ---
  if (wilayah === 'sekitar') {
    return fill(_T_ITEMS_NEARBY, {
      '<LAT>': lat, '<LON>': lon, '<RADIUS>': radius,
      '<PROP_TAHUN>': propTahun,
      '<LIMIT>': limit, '<OFFSET>': offset,
    });
  }

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
      '<FILTER_NEGARA_ANY>': filterNegaraAny,
      '<JENIS>': jenis,
      '<PROP_LOKASI>': propLokasi,
      '<PROP_TAHUN>': propTahun,
      '<P31_MATCH>': p31Match,
      '<KURUNG_BUKA>': '', '<KURUNG_TUTUP>': '', '<UNION>': '',
      '<LIMIT>': limit, '<OFFSET>': offset,
    });
  }

  // --- Provinsi tertentu, atau Q-ID wilayah bebas (pola sama: sub-wilayah + wilayah itu sendiri) ---
  const unionBase = isApapun
    ? `?s ${filterNegaraAny} wdt:P625 [] ; wdt:P18 [] ; wdt:P131 ?l .`
    : `?s ${p31Match} ?j ; wdt:${propLokasi} ?l .`;
  const unionClause = `UNION { BIND(${provQid} AS ?p) BIND(${provQid} AS ?l) ${unionBase} }`;

  const tpl = isApapun ? _T_ITEMS_ANY : _T_ITEMS;
  return fill(tpl, {
    '<WILAYAH>': `?p wdt:P131 ${provQid}.`,
    '<FILTER_NEGARA_ANY>': filterNegaraAny,
    '<JENIS>': jenis,
    '<PROP_LOKASI>': propLokasi,
    '<PROP_TAHUN>': propTahun,
    '<P31_MATCH>': p31Match,
    '<KURUNG_BUKA>': '{', '<KURUNG_TUTUP>': '}',
    '<UNION>': unionClause,
    '<LIMIT>': limit, '<OFFSET>': offset,
  });
}
