"""Endpoint Perkaya Data: pencarian nilai atribut dengan AI, antrean validasi, dan penulisan ke Wikidata."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests
from flask import current_app, jsonify, request, session

from . import api
from .routes import _get_authed_session, _get_csrf_token, _ua, login_required
from ..utils import ai_search
from ..utils.datavalue import DATATYPES, DataValueError, build_value, today_time_value
from ..utils.enrich_store import (
    get_candidate, list_candidates, reject_siblings, save_cell_candidates, update_candidate,
)

STATUS_GROUPS = {
    'open': ('pending', 'not_found'),
    'history': ('published', 'rejected'),
}


def _username():
    return session.get('user', {}).get('username', '')


def _clip(value, n):
    return str(value or '').strip()[:n]


# ---------------------------------------------------------------------------
# Cari nilai satu atribut untuk satu butir
# ---------------------------------------------------------------------------

@api.route('/perkaya/search', methods=['POST'])
@login_required
def perkaya_search():
    body = request.get_json(silent=True) or {}
    provider = body.get('provider', '')
    if provider not in ai_search.DEFAULT_MODELS:
        return jsonify({'error': 'Penyedia AI tidak valid'}), 400

    item = body.get('item') or {}
    attr = body.get('attr') or {}
    qid = _clip(item.get('qid'), 20).upper()
    pid = _clip(attr.get('pid'), 20).upper()
    datatype = attr.get('type', '')
    unit = _clip(attr.get('unit'), 20)
    if not re.fullmatch(r'Q\d+', qid) or not re.fullmatch(r'P\d+', pid):
        return jsonify({'error': 'Q-ID atau PID tidak valid'}), 400
    if datatype not in DATATYPES or (unit and not re.fullmatch(r'Q\d+', unit)):
        return jsonify({'error': 'Tipe data atau satuan tidak valid'}), 400

    item_data = {
        'qid': qid,
        'label': _clip(item.get('label'), 300) or qid,
        'description': _clip(item.get('description'), 300),
        'kategori': _clip(item.get('kategori'), 100),
        'lokasi': _clip(item.get('lokasi'), 300),
    }
    attr_data = {
        'pid': pid,
        'label': _clip(attr.get('label'), 100) or pid,
        'type': datatype,
        'unit_label': _clip(attr.get('unit_label'), 20),
    }
    model = _clip(body.get('model'), 100) or ai_search.DEFAULT_MODELS[provider]

    try:
        result = ai_search.search(provider, _clip(body.get('api_key'), 400), model, item_data, attr_data)
    except ai_search.AISearchError as e:
        return jsonify({'error': str(e)}), 502

    record = {
        'qid': qid, 'item_label': item_data['label'], 'kategori': item_data['kategori'],
        'pid': pid, 'attr_label': attr_data['label'], 'datatype': datatype,
        'unit': unit, 'unit_label': attr_data['unit_label'],
        # Model yang benar-benar dipakai (Groq bisa beralih ke model cadangan)
        'provider': provider, 'model': result.get('model') or model, 'note': result['note'],
    }

    # Rapikan setiap nilai; nilai yang sama setelah dirapikan digabung (sumbernya disatukan)
    options = {}
    invalid = []
    for opt in result['values'] if result['found'] else []:
        value = ai_search.clean_value(datatype, opt['value'])
        if not value:
            invalid.append(opt['value'][:80])
            continue
        options.setdefault(value, []).extend(opt['sources'])

    if not options:
        if invalid:
            record['note'] = f'AI memberi nilai "{invalid[0]}" yang formatnya tidak sesuai.'
        return jsonify(save_cell_candidates(_username(), [{**record, 'status': 'not_found'}]))

    # Verifikasi semua sumber sekaligus (paralel) ke halaman aslinya
    jobs = [(value, src) for value, sources in options.items() for src in sources[:3]]
    with ThreadPoolExecutor(max_workers=6) as pool:
        checked = list(pool.map(lambda job: _verify_source(datatype, *job), jobs))

    records = []
    for value in options:
        sources = [src for (v, _), src in zip(jobs, checked) if v == value]
        sources.sort(key=lambda src: -ai_search.VERIFICATION_RANK.get(src['verification'], 0))
        best = sources[0] if sources else {}
        records.append({
            **record,
            'value': value,
            'sources': sources,
            # Sumber terbaik juga disimpan di kolom ringkas (riwayat, kompatibilitas)
            'source_title': best.get('title', ''),
            'source_url': best.get('url', ''),
            'quote': best.get('quote', ''),
            'quote_lang': best.get('quote_language', 'und'),
            'verification': best.get('verification', 'gagal_dibuka'),
            'verify_note': best.get('verify_note', ''),
            'status': 'pending',
        })
    return jsonify(save_cell_candidates(_username(), records))


def _verify_source(datatype, value, src):
    url = src['url']
    if 'vertexaisearch.cloud.google.com' in url:
        url = ai_search.resolve_url(url)  # tautan grounding Gemini adalah redirect
    verification, verify_note = ai_search.verify(url, src['quote'], datatype, value)
    return {**src, 'url': url, 'verification': verification, 'verify_note': verify_note}


# ---------------------------------------------------------------------------
# Daftar kandidat milik pengguna
# ---------------------------------------------------------------------------

@api.route('/perkaya/candidates')
@login_required
def perkaya_candidates():
    statuses = STATUS_GROUPS.get(request.args.get('group', 'open'))
    if not statuses:
        return jsonify({'error': 'Grup tidak valid'}), 400
    return jsonify(list_candidates(_username(), statuses))


@api.route('/perkaya/candidates/<int:cand_id>/reject', methods=['POST'])
@login_required
def perkaya_reject(cand_id):
    cand = get_candidate(_username(), cand_id)
    if not cand or cand['status'] != 'pending':
        return jsonify({'error': 'Kandidat tidak ditemukan atau sudah diproses'}), 404
    return jsonify(update_candidate(_username(), cand_id, status='rejected'))


# ---------------------------------------------------------------------------
# Setujui kandidat → tulis klaim + referensi ke Wikidata atas nama pengguna
# ---------------------------------------------------------------------------

def _monolingual(prop, text, lang):
    return {
        'snaktype': 'value', 'property': prop,
        'datavalue': {'type': 'monolingualtext', 'value': {'text': text, 'language': lang}},
    }


def _build_reference(src):
    """Snak referensi satu sumber: URL (P854), tanggal diakses (P813), judul (P1476), kutipan (P1683)."""
    lang = src.get('quote_language') or 'und'
    snaks = {
        'P854': [{'snaktype': 'value', 'property': 'P854',
                  'datavalue': {'type': 'string', 'value': src['url']}}],
        'P813': [{'snaktype': 'value', 'property': 'P813',
                  'datavalue': {'type': 'time', 'value': today_time_value()}}],
    }
    if src.get('title'):
        snaks['P1476'] = [_monolingual('P1476', src['title'], lang)]
    if src.get('quote'):
        snaks['P1683'] = [_monolingual('P1683', src['quote'], lang)]
    return snaks


@api.route('/perkaya/candidates/<int:cand_id>/approve', methods=['POST'])
@login_required
def perkaya_approve(cand_id):
    user = _username()
    cand = get_candidate(user, cand_id)
    if not cand or cand['status'] != 'pending':
        return jsonify({'error': 'Kandidat tidak ditemukan atau sudah diproses'}), 404

    body = request.get_json(silent=True) or {}
    datatype = cand['datatype']
    if datatype == 'item':
        raw_value = _clip(body.get('value_qid'), 20)
        display_value = _clip(body.get('value_label'), 300) or raw_value
    else:
        raw_value = _clip(body.get('value'), 400)
        display_value = raw_value
    try:
        wd_value = build_value(datatype, raw_value, cand['unit'] or '')
    except DataValueError as e:
        return jsonify({'error': str(e)}), 400

    # Hanya satu referensi yang dikirim: sumber pilihan pengguna (bawaan: sumber terbaik)
    sources = cand.get('sources') or []
    try:
        src_index = int(body.get('source_index', 0))
    except (TypeError, ValueError):
        src_index = -1
    if sources and not 0 <= src_index < len(sources):
        return jsonify({'error': 'Referensi yang dipilih tidak valid'}), 400
    ref_source = sources[src_index] if sources and sources[src_index].get('url') else None

    api_url = current_app.config['WIKIMEDIA_API_BASE']
    headers = {'User-Agent': _ua()}
    qid, pid = cand['qid'], cand['pid']

    # Jangan menambah nilai kedua bila sementara itu sudah ada yang mengisi
    try:
        ent = requests.get(api_url, params={
            'action': 'wbgetentities', 'ids': qid, 'props': 'claims', 'format': 'json',
        }, headers=headers, timeout=15).json()
        existing = ent.get('entities', {}).get(qid, {}).get('claims', {}).get(pid)
    except (requests.RequestException, ValueError):
        return jsonify({'error': 'Gagal memeriksa butir di Wikidata, coba lagi'}), 502
    if existing:
        return jsonify({'error': f'{pid} pada {qid} sudah terisi di Wikidata. Tolak kandidat ini atau periksa butirnya.'}), 409

    oauth = _get_authed_session()
    chosen = ref_source or {}
    source = chosen.get('title') or urlparse(chosen.get('url') or '').hostname or 'sumber web'
    summary = f'Menambah {pid} dari "{source[:80]}" via WikiJelajah (Perkaya Data) #WikiJelajah'

    try:
        csrf = _get_csrf_token(oauth, api_url)
        created = oauth.post(api_url, data={
            'action': 'wbcreateclaim', 'entity': qid, 'snaktype': 'value',
            'property': pid, 'value': wd_value, 'token': csrf, 'format': 'json',
            'summary': summary,
        }, headers=headers, timeout=30).json()
    except (requests.RequestException, ValueError, KeyError) as e:
        return jsonify({'error': f'Gagal menulis ke Wikidata: {e}'}), 502
    if 'error' in created:
        return jsonify({'error': created['error'].get('info', 'Gagal menyimpan')}), 502

    claim_id = created.get('claim', {}).get('id')
    revid = created.get('pageinfo', {}).get('lastrevid')
    warning = None

    if claim_id and ref_source:
        try:
            ref = oauth.post(api_url, data={
                'action': 'wbsetreference', 'statement': claim_id,
                'snaks': json.dumps(_build_reference(ref_source)), 'token': csrf, 'format': 'json',
                'summary': 'Menambah referensi via WikiJelajah (Perkaya Data) #WikiJelajah',
            }, headers=headers, timeout=30).json()
        except (requests.RequestException, ValueError) as e:
            ref = {'error': {'info': str(e)}}
        if 'error' in ref:
            warning = f"Nilai tersimpan, tetapi referensi gagal ditambahkan: {ref['error'].get('info', '')}"
        else:
            revid = ref.get('pageinfo', {}).get('lastrevid', revid)

    # Kolom ringkas mencatat referensi yang benar-benar dikirim
    chosen_fields = {
        'source_title': chosen.get('title', ''), 'source_url': chosen.get('url', ''),
        'quote': chosen.get('quote', ''), 'quote_lang': chosen.get('quote_language', 'und'),
        'verification': chosen.get('verification'), 'verify_note': chosen.get('verify_note', ''),
    } if chosen else {}
    updated = update_candidate(user, cand_id, status='published', published_value=display_value,
                               claim_id=claim_id, revid=revid, **chosen_fields)
    # Pilihan nilai lain untuk sel yang sama tidak dipakai lagi
    updated['rejected_ids'] = reject_siblings(user, qid, pid, cand_id)
    if warning:
        updated['warning'] = warning
    return jsonify(updated)
