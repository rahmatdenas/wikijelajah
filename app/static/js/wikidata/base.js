'use strict';

/* ==========================================================================
   wikidata/ — Lapisan data: SPARQL, fetch, Commons, skema atribut.
   Tidak menyentuh DOM sama sekali. base.js (file ini) berisi bahasa, alamat
   API, dan helper umum; dimuat paling awal di base.html.
   ========================================================================== */

// Bahasa data mengikuti bahasa antarmuka (I18N dari base.html): label Wikidata
// dicari dalam bahasa itu dulu lalu jatuh ke Indonesia/Inggris, dan artikel
// diambil dari Wikipedia bahasa itu.
const WD_LANGS = [...new Set([I18N.lang, 'id', 'en', 'mul'])];
const WIKI_LANG = I18N.lang;
const WIKI_BASE = `https://${WIKI_LANG}.wikipedia.org`;

/** Nilai multibahasa Wikidata ({lang: {value}}) dalam bahasa terbaik yang tersedia. */
function pickLang(values) {
  for (const l of WD_LANGS) if (values?.[l]?.value) return values[l].value;
  return '';
}

const WD_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WD_COMMONS_URL = 'https://commons.wikimedia.org/wiki/';
const WD_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WD_WIKI_API = `${WIKI_BASE}/w/api.php`;
const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_PAGE_SIZE = 5000; 
const WD_COORD_BATCH = 1000;
const WD_MEDIA_BATCH = 200;

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

/** Tanggal Wikidata (+YYYY-MM-DD…) sesuai presisinya, dalam bahasa antarmuka. */
/** Tahun (angka, negatif = SM) dari nilai waktu Wikidata; untuk pengurutan, bukan tampilan. */
function yearOf(dateStr) {
  const year = parseInt(dateStr, 10);  // '+1920-01-01T…' → 1920, '-0500-…' → -500
  return Number.isNaN(year) ? null : year;
}

function formatDate(dateStr, precision) {
  if (!dateStr) return null;
  const clean = dateStr.replace(/^[+-]/, '');
  const yearNum = parseInt(clean.slice(0, 4), 10);
  const year  = String(yearNum);  // '0601' → '601'
  const month = parseInt(clean.slice(5, 7));
  const day   = parseInt(clean.slice(8, 10));
  const prec  = parseInt(precision) || 9;

  if ((prec >= 10 && month) || prec >= 11) {
    // setUTCFullYear agar tahun < 100 tidak dianggap 19xx
    const d = new Date(Date.UTC(2000, (month || 1) - 1, day || 1));
    d.setUTCFullYear(yearNum);
    const opts = prec >= 11 && day
      ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { month: 'long', year: 'numeric', timeZone: 'UTC' };
    try { return new Intl.DateTimeFormat(I18N.lang, opts).format(d); } catch { return year; }
  }
  if (prec === 9)  return year;
  if (prec === 8)  return msg('date-decade', year);
  if (prec === 7)  return msg('date-century', Math.ceil(yearNum / 100));
  return year;
}

function commonsFileUrl(filename, width = 500) {
  return `${WD_COMMONS_URL}Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

function commonsFilePageUrl(filename) {
  return `${WD_COMMONS_URL}File:${encodeURIComponent(filename)}`;
}
