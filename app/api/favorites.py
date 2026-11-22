"""Penjelajahan favorit untuk pengguna yang login (yang belum login memakai localStorage)."""
import re
from urllib.parse import parse_qsl

from flask import jsonify, request

from . import api
from ..i18n import msg
from .routes import login_required
from .enrich import _clip, _username
from ..utils.favorites_store import MAX_FAVORITES, add_favorites, list_favorites, remove_favorite

# Parameter pencarian yang boleh disimpan (sama dengan URL halaman Jelajah)
_REGIONS = {'province', 'all', 'abroad', 'area', 'nearby'}
_KEYS = {'region', 'province', 'country', 'area', 'category', 'radius'}
_VALUE = re.compile(r'^[A-Za-z0-9_-]{1,60}$')


def _clean_item(raw):
    """Favorit dari klien → {query, area_label}, atau None bila tidak valid."""
    if not isinstance(raw, dict):
        return None
    query = str(raw.get('query') or '')
    if not query or len(query) > 300:
        return None
    pairs = parse_qsl(query, keep_blank_values=True)
    params = dict(pairs)
    if (len(params) != len(pairs) or not set(params) <= _KEYS
            or params.get('region') not in _REGIONS
            or not all(_VALUE.match(v) for v in params.values())):
        return None
    if params['region'] != 'nearby' and 'category' not in params:
        return None
    return {'query': query, 'area_label': _clip(raw.get('area_label'), 200)}


@api.route('/favorites')
@login_required
def favorites_list():
    return jsonify({'favorites': list_favorites(_username()), 'max': MAX_FAVORITES})


@api.route('/favorites', methods=['POST'])
@login_required
def favorites_add():
    item = _clean_item(request.get_json(silent=True) or {})
    if not item:
        return jsonify({'error': msg('api-favorite-invalid')}), 400
    username = _username()
    add_favorites(username, [item])
    favorites = list_favorites(username)
    if not any(f['query'] == item['query'] for f in favorites):
        return jsonify({'error': msg('favorite-full', MAX_FAVORITES)}), 400
    return jsonify({'favorites': favorites})


@api.route('/favorites/delete', methods=['POST'])
@login_required
def favorites_delete():
    item = _clean_item(request.get_json(silent=True) or {})
    if not item:
        return jsonify({'error': msg('api-favorite-invalid')}), 400
    remove_favorite(_username(), item['query'])
    return jsonify({'favorites': list_favorites(_username())})


@api.route('/favorites/import', methods=['POST'])
@login_required
def favorites_import():
    """Pindahkan favorit lokal (localStorage) ke akun, sekali setelah login."""
    raw = (request.get_json(silent=True) or {}).get('favorites')
    items = [it for it in map(_clean_item, raw if isinstance(raw, list) else []) if it][:MAX_FAVORITES]
    username = _username()
    add_favorites(username, items)
    favorites = list_favorites(username)
    saved = {f['query'] for f in favorites}
    # Yang tidak masuk karena favorit akun sudah penuh
    return jsonify({'favorites': favorites, 'skipped': sum(it['query'] not in saved for it in items)})
