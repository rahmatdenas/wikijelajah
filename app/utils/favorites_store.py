"""Penjelajahan favorit pengguna yang login (SQLite yang sama dengan Perkaya Data).

Favorit = pintasan pencarian, bukan hasilnya: yang disimpan hanya parameter URL
pencarian (`query`, mis. "region=province&province=Q3125978&category=mosques")
dan nama wilayah bebas (`area_label`) yang tidak bisa dibaca ulang dari formulir.
Pengguna yang belum login menyimpan favoritnya di localStorage browser.
"""
from datetime import datetime, timezone

from flask import g

from .enrich_store import get_db

MAX_FAVORITES = 10

SCHEMA = """
CREATE TABLE IF NOT EXISTS favorites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL,
    query       TEXT NOT NULL,
    area_label  TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE (username, query)
);
"""


def _db():
    db = get_db()
    if 'favorites_schema' not in g:
        db.executescript(SCHEMA)
        g.favorites_schema = True
    return db


def list_favorites(username):
    rows = _db().execute(
        'SELECT query, area_label, created_at FROM favorites WHERE username = ? '
        'ORDER BY created_at DESC, id DESC',
        (username,),
    ).fetchall()
    return [dict(r) for r in rows]


def add_favorites(username, items):
    """Tambah favorit (yang sudah ada dilewati) sampai batas MAX_FAVORITES.
    `items` urut terbaru dulu. Mengembalikan jumlah yang benar-benar ditambahkan."""
    db = _db()
    existing = {r['query'] for r in db.execute('SELECT query FROM favorites WHERE username = ?', (username,))}
    room = MAX_FAVORITES - len(existing)
    new = [it for it in items if it['query'] not in existing][:max(room, 0)]
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    # Disisipkan dari yang terlama: waktunya sama, jadi urutan tampil mengikuti id (lihat list_favorites)
    for it in reversed(new):
        db.execute(
            'INSERT INTO favorites (username, query, area_label, created_at) VALUES (?, ?, ?, ?)',
            (username, it['query'], it.get('area_label') or None, now),
        )
    db.commit()
    return len(new)


def remove_favorite(username, query):
    db = _db()
    db.execute('DELETE FROM favorites WHERE username = ? AND query = ?', (username, query))
    db.commit()
