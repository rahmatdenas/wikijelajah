'use strict';

// Data per butir: koordinat & media (batch), media tunggal, ringkasan Wikipedia, poligon Overpass.

// ---------------------------------------------------------------------------
// KOORDINAT (batch parallel)
// ---------------------------------------------------------------------------

/**
 * Koordinat per butir. Batch yang sudah selesai tetap dipakai bila dihentikan atau sebagian gagal.
 * Klaster via lokasi: koordinat hanya dipakai bila butir punya tepat satu lokasi.
 * @returns {Promise<{coords: Object, complete: boolean, reason?: string, error?: Error, missing: Array}>}
 */
async function fetchCoordinates(qids, klasterNama, propLokasi, signal, opts = {}) {
  const useLokasi = KLASTER_TANPA_KOORDINAT_LANGSUNG.has(klasterNama);
  const coords = {};
  const lokasiCount = {};  // QID → jumlah lokasi berbeda (klaster via lokasi)

  const status = await runBatches(chunkArray(qids, WD_COORD_BATCH), async (chunk, reqSignal, attempt) => {
    let q;
    if (useLokasi) {
      const klausaKoordinat = `?site wdt:${propLokasi} ?p131 . FILTER(?p131 != wd:Q252) ?p131 p:P625 ?coordStatement .`;
      q = _T_COORDS
        .replace('<QIDS>', chunk.join(' '))
        .replace('<KLAUSA_KOORDINAT>', klausaKoordinat);
    } else {
      q = _T_COORDS_DIRECT.replace('<QIDS>', chunk.join(' '));
    }
    const rows = await sparqlWithRetry(q, reqSignal, { timeout: WD_TIMEOUT_BATCH, retryTimeout: true, ...attempt });
    const lokasi = {};
    rows.forEach(r => {
      const qid = r.siteQid.value;
      if (r.p131) (lokasi[qid] ||= new Set()).add(r.p131.value);
      const bits = r.coord.value.split(/[() ]/);
      coords[qid] ??= { lon: parseFloat(bits[1]), lat: parseFloat(bits[2]) };
    });
    Object.entries(lokasi).forEach(([qid, set]) => { lokasiCount[qid] = set.size; });
  }, signal, opts);

  // Butir dengan beberapa lokasi (mis. songket di banyak provinsi) tidak diberi titik:
  // satu titik di salah satu lokasi akan menyesatkan. Wilayahnya tetap lengkap di filter.
  Object.entries(lokasiCount).forEach(([qid, n]) => { if (n > 1) delete coords[qid]; });

  return { coords, ...status };
}

// ---------------------------------------------------------------------------
// MEDIA: gambar + artikel Wikipedia (batch parallel, toleran gagal)
// ---------------------------------------------------------------------------

/**
 * Gambar dan artikel Wikipedia per butir; opsi sama dengan fetchCoordinates.
 * Kategori Commons tidak di sini: baru dibutuhkan saat detail dibuka (fetchDetailProps).
 * @returns {Promise<{media: Object, complete: boolean, reason?: string, error?: Error, missing: Array}>}
 */
async function fetchMedia(qids, signal, opts = {}) {
  const media = {};

  const status = await runBatches(chunkArray(qids, WD_MEDIA_BATCH), async (chunk, reqSignal, attempt) => {
    const q = _T_MEDIA.replace('<QIDS>', chunk.join(' '));
    const rows = await sparqlWithRetry(q, reqSignal, { timeout: WD_TIMEOUT_BATCH, retryTimeout: true, ...attempt });
    rows.forEach(r => {
      const qid = r.siteQid.value.includes('entity/')
        ? r.siteQid.value.split('entity/')[1]
        : r.siteQid.value;
      // Explicit null = "loaded, absent"; undefined = "not yet loaded"
      media[qid] = {
        imageFilename: r.image ? extractFilename(r.image.value) : null,
        articleTitle:  r.wikipediaUrlTitle ? decodeURIComponent(r.wikipediaUrlTitle.value) : null,
      };
    });
  }, signal, opts);

  return { media, ...status };
}

// ---------------------------------------------------------------------------
// SINGLE-ITEM MEDIA (cepat, via wbgetentities — dipakai saat batch belum selesai)
// ---------------------------------------------------------------------------
async function fetchSingleItemMedia(qid, signal) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|sitelinks&sitefilter=${WIKI_LANG}wiki&format=json&origin=*`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const entity = data.entities?.[qid];
  if (!entity) throw new Error('Entity not found');

  const p18       = entity.claims?.P18;
  const wiki      = entity.sitelinks?.[`${WIKI_LANG}wiki`];

  return {
    imageFilename: p18?.[0]?.mainsnak?.datavalue?.value?.replace(/ /g, '_') ?? null,
    articleTitle:  wiki?.title ?? null,
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
  let pick = paragraphs.find(p => p.length > 50) ?? `<p>${escHtml(msg('detail-excerpt-short'))}</p>`;
  pick = pick
    .replace(/^<p[^>]*>(\s|<br\s*\/?>)*/i, '<p>')
    .replace(/<[^>]*>[^<]*(is deprecated|Lua error|Script error)[^<]*<\/[^>]*>/gi, '');

  return pick;
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
