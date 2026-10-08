"""Penyimpanan kandidat Perkaya Data (SQLite di folder instance/).

Setiap kandidat milik satu pengguna (username Wikimedia); pengguna hanya
melihat dan memvalidasi kandidat hasil pencarian AI miliknya sendiri.

Satu pencarian (butir × atribut = satu "sel") bisa menghasilkan beberapa
kandidat bila sumber-sumbernya berbeda pendapat. Setiap kandidat = satu nilai
beserta daftar sumbernya (kolom `sources`, JSON). Kolom source_* menyimpan
sumber pertama agar tampilan ringkas (riwayat) tetap sederhana.

status:
  pending    — menunggu validasi
  not_found  — AI tidak menemukan nilai (disimpan agar tidak dicari ulang tanpa sengaja)
  published  — disetujui dan sudah ditulis ke Wikidata
  rejected   — ditolak pengguna
"""
import json
import os
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    qid           TEXT NOT NULL,
    item_label    TEXT,
    kategori      TEXT,
    pid           TEXT NOT NULL,
    attr_label    TEXT,
    datatype      TEXT NOT NULL,
    unit          TEXT,
    unit_label    TEXT,
    value         TEXT,
    source_title  TEXT,
    source_url    TEXT,
    quote         TEXT,
    quote_lang    TEXT,
    verification  TEXT,
    verify_note   TEXT,
    note          TEXT,
    provider      TEXT,
    model         TEXT,
    status        TEXT NOT NULL,
    sources       TEXT,
    published_value TEXT,
    claim_id      TEXT,
    revid         INTEGER,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_user_status ON candidates (username, status);
CREATE INDEX IF NOT EXISTS idx_candidates_user_cell ON candidates (username, qid, pid);
"""

COLUMNS = (
    'qid', 'item_label', 'kategori', 'pid', 'attr_label', 'datatype', 'unit', 'unit_label',
    'value', 'source_title', 'source_url', 'quote', 'quote_lang', 'verification',
    'verify_note', 'note', 'provider', 'model', 'status', 'sources',
)
UPDATABLE = ('status', 'value', 'published_value', 'claim_id', 'revid', 'note')


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def get_db():
    if 'enrich_db' not in g:
        os.makedirs(current_app.instance_path, exist_ok=True)
        conn = sqlite3.connect(os.path.join(current_app.instance_path, 'wikijelajah.db'))
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        _migrate(conn)
        g.enrich_db = conn
    return g.enrich_db


def _migrate(conn):
    """Tambah kolom baru pada database lama tanpa menghapus data."""
    cols = {row[1] for row in conn.execute('PRAGMA table_info(candidates)')}
    if 'sources' not in cols:
        conn.execute('ALTER TABLE candidates ADD COLUMN sources TEXT')
        conn.commit()


def _row_to_dict(row):
    d = dict(row)
    try:
        d['sources'] = json.loads(d.get('sources') or '[]')
    except ValueError:
        d['sources'] = []
    # Kandidat lama (sebelum ada kolom sources): bentuk dari kolom source_*
    if not d['sources'] and (d.get('source_url') or d.get('quote')):
        d['sources'] = [{
            'title': d.get('source_title') or '', 'url': d.get('source_url') or '',
            'quote': d.get('quote') or '', 'quote_language': d.get('quote_lang') or 'und',
            'verification': d.get('verification'), 'verify_note': d.get('verify_note'),
        }]
    return d


def close_db(_exc=None):
    conn = g.pop('enrich_db', None)
    if conn is not None:
        conn.close()


def save_cell_candidates(username, records):
    """Simpan hasil pencarian baru untuk satu sel (butir × atribut).

    Kandidat lama yang belum divalidasi untuk sel yang sama diganti. `records`
    berisi satu atau lebih kandidat (satu per nilai berbeda).
    """
    db = get_db()
    first = records[0]
    db.execute(
        "DELETE FROM candidates WHERE username = ? AND qid = ? AND pid = ? AND status IN ('pending', 'not_found')",
        (username, first['qid'], first['pid']),
    )
    now = _now()
    cols = ('username',) + COLUMNS + ('created_at', 'updated_at')
    ids = []
    for data in records:
        data = {**data, 'sources': json.dumps(data.get('sources') or [], ensure_ascii=False)}
        values = (username,) + tuple(data.get(c) for c in COLUMNS) + (now, now)
        cur = db.execute(
            f"INSERT INTO candidates ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            values,
        )
        ids.append(cur.lastrowid)
    db.commit()
    return [get_candidate(username, i) for i in ids]


def reject_siblings(username, qid, pid, keep_id):
    """Tolak kandidat lain di sel yang sama (dipakai setelah satu nilai disetujui)."""
    db = get_db()
    rows = db.execute(
        "SELECT id FROM candidates WHERE username = ? AND qid = ? AND pid = ? AND status = 'pending' AND id != ?",
        (username, qid, pid, keep_id),
    ).fetchall()
    ids = [r['id'] for r in rows]
    if ids:
        db.execute(
            f"UPDATE candidates SET status = 'rejected', updated_at = ? WHERE id IN ({', '.join('?' * len(ids))})",
            (_now(), *ids),
        )
        db.commit()
    return ids


def get_candidate(username, cand_id):
    row = get_db().execute(
        'SELECT * FROM candidates WHERE id = ? AND username = ?', (cand_id, username)
    ).fetchone()
    return _row_to_dict(row) if row else None


def list_candidates(username, statuses, limit=500):
    marks = ', '.join('?' * len(statuses))
    rows = get_db().execute(
        f'SELECT * FROM candidates WHERE username = ? AND status IN ({marks}) '
        'ORDER BY updated_at DESC, id DESC LIMIT ?',
        (username, *statuses, limit),
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_candidate(username, cand_id, **fields):
    fields = {k: v for k, v in fields.items() if k in UPDATABLE}
    if not fields:
        return get_candidate(username, cand_id)
    sets = ', '.join(f'{k} = ?' for k in fields)
    db = get_db()
    db.execute(
        f'UPDATE candidates SET {sets}, updated_at = ? WHERE id = ? AND username = ?',
        (*fields.values(), _now(), cand_id, username),
    )
    db.commit()
    return get_candidate(username, cand_id)
