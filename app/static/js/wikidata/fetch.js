'use strict';

// Fetch ke SPARQL/API: timeout, paginasi, galat, dan jeda rate limit.

// ---------------------------------------------------------------------------
// FETCH UTILITIES
// ---------------------------------------------------------------------------

// Batas waktu menunggu jawaban (header HTTP) WQS; unduhan & parsing JSON tidak ikut dihitung.
// Data utama tidak diulang bila timeout: query daftar yang berat memang butuh hingga ±56 detik
// (Masjid se-Indonesia). Batas 60 detik WQS hanya untuk eksekusi query, belum antrean & jaringan,
// dan bila query melewatinya WQS sendiri mengirim galat timeout, jadi timer ini cadangan untuk
// koneksi macet saja → dibuat longgar. Koordinat & media (query VALUES kecil) biasanya selesai
// dalam hitungan detik, jadi 30 detik tanpa jawaban berarti server sedang sibuk → diulang.
const WD_TIMEOUT_MAIN  = 90000;
const WD_TIMEOUT_BATCH = 30000;
// Batch koordinat/media yang berjalan bersamaan (WQS membatasi query bersamaan per IP)
const WD_PARALLEL = 4;

/** Galat SPARQL beserta jenisnya: 'timeout' | 'rate' | 'http' | 'network'. */
class SparqlError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'SparqlError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = 0;
  }
}

async function sparqlPost(query, signal, timeout = WD_TIMEOUT_MAIN) {
  // Timer milik permintaan ini saja: dimatikan begitu header tiba, dan selalu dibersihkan di finally
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeout);
  try {
    const resp = await fetch(WD_SPARQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'Api-User-Agent': 'WikiJelajah/2.0 (teknologi@wikimedia.or.id)',
      },
      body: 'format=json&query=' + encodeURIComponent(query),
      signal: anySignal([signal, timeoutCtrl.signal]),
    });
    // WQS sudah menjawab: unduhan isi tidak dibatasi timer (internet lambat tidak membuang hasil
    // yang sudah jadi). Tombol Hentikan / pencarian baru tetap bisa membatalkannya lewat `signal`.
    clearTimeout(timer);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 429) {
        const err = new SparqlError('rate', msg('sparql-rate-limited'), 429);
        err.retryAfter = parseInt(resp.headers.get('Retry-After'), 10) || 0;
        throw err;
      }
      if (body.includes('TimeoutException')) throw new SparqlError('timeout', msg('sparql-timeout'), resp.status);
      throw new SparqlError('http', `SPARQL HTTP ${resp.status}`, resp.status);
    }
    // WQS kadang menjawab 200 lalu terhenti di tengah aliran hasil karena batas 60 detiknya
    // sendiri; JSON yang terpotong itu dilaporkan sebagai timeout, bukan galat parsing mentah.
    const text = await resp.text();
    try {
      return JSON.parse(text).results.bindings;
    } catch {
      throw new SparqlError('timeout', msg('sparql-timeout'), resp.status);
    }
  } catch (err) {
    // Dibatalkan pengguna (juga saat isi sedang diunduh) → selalu AbortError, bukan galat jaringan
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timeoutCtrl.signal.aborted) throw new SparqlError('timeout', msg('sparql-timeout'));
    if (err instanceof TypeError) throw new SparqlError('network', err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Jeda yang ikut batal bila signal dibatalkan. */
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Kirim query dengan percobaan ulang untuk galat sementara (429, 5xx, jaringan).
 * Timeout hanya diulang bila `retryTimeout` (batch kecil koordinat/media); query data utama
 * yang timeout hampir pasti timeout lagi.
 */
async function sparqlWithRetry(query, signal, { maxRetry = 3, timeout = WD_TIMEOUT_MAIN, retryTimeout = false } = {}) {
  for (let i = 1; i <= maxRetry; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // Jeda 429 bersama: bila satu permintaan diminta menunggu, yang lain ikut menunggu
    const cooldown = _rateLimitedUntil - Date.now();
    if (cooldown > 0) await _sleep(cooldown, signal);
    try {
      return await sparqlPost(query, signal, timeout);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const retryable = err.kind === 'rate' || err.kind === 'network' || (err.kind === 'http' && err.status >= 500)
        || (err.kind === 'timeout' && retryTimeout);
      if (!retryable || i === maxRetry) throw err;
      const wait = err.kind === 'rate' ? Math.min(err.retryAfter * 1000 || 5000 * i, 60000) : 1500 * i;
      if (err.kind === 'rate') _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + wait);
      await _sleep(wait, signal);
    }
  }
}

// Batas waktu jeda 429 bersama (lihat sparqlWithRetry)
let _rateLimitedUntil = 0;

/** Gabungan beberapa AbortSignal: batal bila salah satunya batal. */
function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (AbortSignal.any) return AbortSignal.any(list);
  const ctrl = new AbortController();
  list.forEach(s => s.aborted
    ? ctrl.abort(s.reason)
    : s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true }));
  return ctrl.signal;
}

/**
 * Jalankan worker untuk setiap batch, paling banyak WD_PARALLEL sekaligus.
 * Batch yang gagal dilewati agar hasil batch lain tetap terpakai. Batch yang tetap timeout setelah
 * jatah ulangnya habis dipecah dua dan dicoba sekali lagi: sering hanya sebagian butirnya yang berat.
 * @param {Array}       chunks
 * @param {Function}    worker - (chunk, signal, {maxRetry}) => Promise; menulis hasilnya sendiri setelah respons utuh
 * @param {AbortSignal} signal - batal total: melempar AbortError
 * @param {Object}      [opts]
 * @param {AbortSignal} [opts.stopSignal] - "Hentikan": berhenti, pertahankan batch yang sudah selesai
 * @param {Function}    [opts.onProgress] - persen butir yang selesai diproses (0–100)
 * @returns {Promise<{complete: boolean, reason?: 'stopped'|'error', error?: Error, missing: Array}>}
 *          `missing`: butir yang belum termuat (batchnya gagal atau belum sempat jalan)
 */
async function runBatches(chunks, worker, signal, { stopSignal = null, onProgress = null } = {}) {
  const reqSignal = stopSignal ? anySignal([signal, stopSignal]) : signal;
  const queue = chunks.map(chunk => ({ chunk, split: false }));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const loaded = new Set();
  let next = 0, processed = 0, stopped = false, lastError = null;
  onProgress?.(0);

  const lane = async () => {
    while (next < queue.length && !reqSignal?.aborted) {
      const { chunk, split } = queue[next++];
      try {
        // Belahan batch sudah melewati jatah ulang batch induknya: cukup sekali coba
        await worker(chunk, reqSignal, split ? { maxRetry: 1 } : {});
        chunk.forEach(q => loaded.add(q));
      } catch (err) {
        if (err.name === 'AbortError') { stopped = true; return; }
        if (err.kind === 'timeout' && !split && chunk.length > 1) {
          const half = Math.ceil(chunk.length / 2);
          queue.push({ chunk: chunk.slice(0, half), split: true }, { chunk: chunk.slice(half), split: true });
          continue;
        }
        lastError = err;
      }
      processed += chunk.length;
      onProgress?.(Math.round((processed / total) * 100));
    }
  };
  await Promise.all(Array.from({ length: Math.min(WD_PARALLEL, chunks.length) }, lane));

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const missing = chunks.flat().filter(q => !loaded.has(q));
  if (stopped || next < queue.length) return { complete: false, reason: 'stopped', missing };
  if (missing.length) return { complete: false, reason: 'error', error: lastError, missing };
  return { complete: true, missing };
}

/**
 * Fetch semua halaman dari query yang sudah punya LIMIT/OFFSET.
 * Data masuk per halaman utuh; halaman yang sedang ditarik saat berhenti/gagal tidak dipakai.
 * @param {Function} queryFn  - (limit, offset) => string query
 * @param {AbortSignal} signal - batal total (pencarian baru / Batalkan): melempar AbortError
 * @param {Function} onRow    - dipanggil per baris
 * @param {Function} onPage   - dipanggil per halaman dengan total akumulatif
 * @param {Object}  [opts]
 * @param {AbortSignal} [opts.stopSignal] - "Cukupkan": berhenti, pertahankan halaman yang sudah masuk
 * @param {boolean} [opts.keepPartial]    - bila sebuah halaman gagal, kembalikan yang sudah ada alih-alih melempar galat
 * @returns {Promise<{complete: boolean, reason?: 'stopped'|'error', error?: Error, total: number}>}
 */
async function fetchAllPages(queryFn, signal, onRow, onPage, opts = {}) {
  const { stopSignal = null, keepPartial = false } = opts;
  const pageSignal = stopSignal ? anySignal([signal, stopSignal]) : signal;
  let offset = 0, total = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (stopSignal?.aborted) return { complete: false, reason: 'stopped', total };

    let rows;
    try {
      rows = await sparqlWithRetry(queryFn(WD_PAGE_SIZE, offset), pageSignal);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (stopSignal?.aborted) return { complete: false, reason: 'stopped', total };
      if (keepPartial && total > 0) return { complete: false, reason: 'error', error: err, total };
      throw err;
    }
    rows.forEach(onRow);

    const unique = new Set(rows.map(r =>
      `${r.SQ?.value}|${r.PQ?.value ?? ''}|${r.LQ?.value ?? ''}`
    )).size;

    total += unique;
    onPage?.(total);

    if (unique < WD_PAGE_SIZE) return { complete: true, total };
    offset += WD_PAGE_SIZE;
  }
}
