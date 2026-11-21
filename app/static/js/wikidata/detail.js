'use strict';

// Detail atribut butir via wbgetentities.

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

/** Label (bahasa antarmuka → id → en → mul → QID) untuk banyak QID sekaligus. */
async function fetchLabels(qids, signal) {
  const labels = {};
  await Promise.all(chunkArray(qids, 50).map(async chunk => {
    const data = await _wbGet({
      action: 'wbgetentities', ids: chunk.join('|'), props: 'labels', languages: WD_LANGS.join('|'),
    }, signal);
    Object.entries(data.entities || {}).forEach(([id, e]) => {
      labels[id] = pickLang(e.labels) || id;
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
  const angka  = formatNumber(parseFloat(v.amount), { maximumFractionDigits: 2 });
  const unit   = _unitQid(v.unit);
  const satuan = !unit ? (attr.suffix || '')
    : unit === attr.unit && attr.unitLabel ? attr.unitLabel
    : UNIT_SIMBOL[unit] || labels[unit] || '';
  const tahun  = _qualifierYear(claim, 'P585');
  return [angka, satuan].filter(Boolean).join(' ') + (tahun ? ` (${tahun})` : '');
}

/** QID yang labelnya dibutuhkan untuk menampilkan nilai atribut skema (nilai item & satuan). */
function attrLabelIds(claims, skema) {
  const ids = new Set();
  skema.forEach(attr => bestRankClaims(claims[attr.pid]).forEach(c => {
    const v = c.mainsnak.datavalue?.value;
    if (!v) return;
    if (attr.type === 'item') { const id = _itemId(v); if (id) ids.add(id); }
    if (attr.type === 'quantity') {
      const u = _unitQid(v.unit);
      if (u && !UNIT_SIMBOL[u] && !(u === attr.unit && attr.unitLabel)) ids.add(u);
    }
  }));
  return ids;
}

/**
 * Teks tampilan untuk setiap atribut skema yang terisi.
 * @returns {Object<string,{text: string, url?: string}>} di-key dengan PID; atribut kosong tidak punya entri.
 */
function formatAttrValues(claims, skema, labels) {
  const values = {};
  skema.forEach(attr => {
    const list = bestRankClaims(claims[attr.pid]);
    if (!list.length) return;

    // "nilai tidak diketahui" / "tidak ada nilai" tetap dihitung terisi
    const withValue = list.filter(c => c.mainsnak.snaktype === 'value');
    if (!withValue.length) {
      values[attr.pid] = { text: msg(list[0].mainsnak.snaktype === 'novalue' ? 'value-none' : 'value-unknown') };
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
  return values;
}

/**
 * Ambil nilai semua atribut skema kategori untuk satu butir.
 * @returns {Promise<{tipe: string, values: Object<string,{text: string, url?: string}>, wikibooks: ?string}>}
 *          values di-key dengan PID; atribut kosong tidak punya entri.
 */
async function fetchDetailProps(qid, klasterNama, signal) {
  const skema = skemaKategori(klasterNama);
  const data = await _wbGet({
    action: 'wbgetentities', ids: qid, props: 'claims|sitelinks/urls', sitefilter: `${WIKI_LANG}wikibooks`,
  }, signal);
  const entity = data.entities?.[qid];
  if (!entity) throw new Error(msg('item-not-found'));

  const claims = entity.claims || {};
  const p31    = bestRankClaims(claims.P31);

  // Label untuk P31 + nilai item + satuan, diambil sekaligus
  const ids = attrLabelIds(claims, skema);
  p31.forEach(c => { const id = _itemId(c.mainsnak.datavalue?.value); if (id) ids.add(id); });
  const labels = ids.size ? await fetchLabels([...ids], signal) : {};

  const tipe = p31
    .map(c => labels[_itemId(c.mainsnak.datavalue?.value)])
    .filter(Boolean).join(', ');

  return {
    tipe,
    values: formatAttrValues(claims, skema, labels),
    wikibooks: entity.sitelinks?.[`${WIKI_LANG}wikibooks`]?.url || null,
    commonsCat: bestRankClaims(claims.P373)[0]?.mainsnak.datavalue?.value || null,
    claims,  // semua klaim mentah: untuk "Lihat semua data" & agar properti yang sudah ada tidak ditawarkan lagi
  };
}
