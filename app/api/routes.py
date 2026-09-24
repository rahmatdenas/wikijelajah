import json
from datetime import date
from functools import wraps
import requests
from flask import current_app, jsonify, request, session
from requests_oauthlib import OAuth2Session
from . import api


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'oauth_token' not in session:
            return jsonify({'error': 'Autentikasi diperlukan'}), 401
        return f(*args, **kwargs)
    return decorated


def _get_authed_session():
    return OAuth2Session(
        client_id=current_app.config['WIKIMEDIA_CLIENT_ID'],
        token=session['oauth_token'],
    )


def _ua():
    return current_app.config.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0')


# ---------------------------------------------------------------------------
# Endpoint: ringkasan item Wikidata
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/summary')
def item_summary(qid):
    params = {
        'action': 'wbgetentities',
        'ids': qid.upper(),
        'languages': 'id|en',
        'props': 'labels|descriptions|claims|sitelinks/urls',
        'sitefilter': 'idwiki',
        'format': 'json',
    }
    resp = requests.get(current_app.config['WIKIMEDIA_API_BASE'], params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    entity = data.get('entities', {}).get(qid.upper(), {})
    if not entity:
        return jsonify({'error': 'Butir tidak ditemukan'}), 404

    return jsonify({
        'qid': qid.upper(),
        'label': (entity.get('labels', {}).get('id') or entity.get('labels', {}).get('en', {})).get('value', ''),
        'description': (entity.get('descriptions', {}).get('id') or entity.get('descriptions', {}).get('en', {})).get('value', ''),
        'wikipedia_url': next(
            (sl.get('url') for sl in entity.get('sitelinks', {}).values()), None
        ),
    })


# ---------------------------------------------------------------------------
# Endpoint: ubah label / deskripsi
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/label', methods=['POST'])
@login_required
def update_label(qid):
    body = request.get_json(silent=True) or {}
    new_label = body.get('label', '').strip()
    if not new_label:
        return jsonify({'error': 'Label tidak boleh kosong'}), 400

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    oauth = _get_authed_session()

    token_resp = oauth.get(wikidata_api, params={'action': 'query', 'meta': 'tokens', 'format': 'json'})
    csrf_token = token_resp.json()['query']['tokens']['csrftoken']

    edit_resp = oauth.post(wikidata_api, data={
        'action': 'wbsetlabel',
        'id': qid.upper(),
        'language': 'id',
        'value': new_label,
        'token': csrf_token,
        'format': 'json',
    })
    result = edit_resp.json()

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', 'Gagal menyimpan')}), 500

    return jsonify({'success': True, 'label': new_label})


@api.route('/item/<qid>/description', methods=['POST'])
@login_required
def update_description(qid):
    body = request.get_json(silent=True) or {}
    new_desc = body.get('description', '').strip()

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    oauth = _get_authed_session()

    token_resp = oauth.get(wikidata_api, params={'action': 'query', 'meta': 'tokens', 'format': 'json'})
    csrf_token = token_resp.json()['query']['tokens']['csrftoken']

    edit_resp = oauth.post(wikidata_api, data={
        'action': 'wbsetdescription',
        'id': qid.upper(),
        'language': 'id',
        'value': new_desc,
        'token': csrf_token,
        'format': 'json',
    })
    result = edit_resp.json()

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', 'Gagal menyimpan')}), 500

    return jsonify({'success': True, 'description': new_desc})


# ---------------------------------------------------------------------------
# Endpoint: tambah klaim baru ke butir Wikidata (quantity / url)
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/add-claim', methods=['POST'])
@login_required
def add_claim(qid):
    import re as _re
    qid  = qid.upper()
    body = request.get_json(silent=True) or {}

    prop     = body.get('property', '').strip()
    val      = body.get('value', '').strip()
    datatype = body.get('datatype', '').strip()
    unit_qid = body.get('unit', '').strip()

    if not prop or not _re.match(r'^P\d+$', prop):
        return jsonify({'error': 'Format property tidak valid'}), 400
    if not val:
        return jsonify({'error': 'Nilai tidak boleh kosong'}), 400

    if datatype == 'quantity':
        try:
            num = float(val)
        except ValueError:
            return jsonify({'error': 'Nilai harus berupa angka'}), 400
        amount = f'+{int(num)}' if num == int(num) else f'+{num}'
        unit_url = f'http://www.wikidata.org/entity/{unit_qid}' if unit_qid else '1'
        wd_value = json.dumps({'amount': amount, 'unit': unit_url})
    elif datatype == 'url':
        if not _re.match(r'^https?://', val):
            return jsonify({'error': 'URL harus diawali https:// atau http://'}), 400
        wd_value = json.dumps(val)
    elif datatype == 'year':
        try:
            year = int(val)
            if not (1 <= year <= 2100):
                raise ValueError
        except ValueError:
            return jsonify({'error': 'Tahun tidak valid (1–2100)'}), 400
        wd_value = json.dumps({
            'time': f'+{year:04d}-01-01T00:00:00Z',
            'timezone': 0, 'before': 0, 'after': 0,
            'precision': 9,
            'calendarmodel': 'http://www.wikidata.org/entity/Q1985727',
        })
    else:
        return jsonify({'error': f'Tipe data "{datatype}" belum didukung'}), 400

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua    = _ua()
    oauth = _get_authed_session()

    try:
        tok = oauth.get(
            wikidata_api,
            params={'action': 'query', 'meta': 'tokens', 'format': 'json'},
            headers={'User-Agent': ua},
        ).json()
        csrf = tok['query']['tokens']['csrftoken']
    except Exception as e:
        return jsonify({'error': f'Gagal ambil token: {e}'}), 500

    try:
        result = oauth.post(wikidata_api, data={
            'action':   'wbcreateclaim',
            'entity':   qid,
            'snaktype': 'value',
            'property': prop,
            'value':    wd_value,
            'token':    csrf,
            'format':   'json',
            'summary':  f'Menambah {prop} via WikiJelajah',
        }, headers={'User-Agent': ua}).json()
    except Exception as e:
        return jsonify({'error': f'Gagal menulis ke Wikidata: {e}'}), 500

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', 'Gagal menyimpan')}), 500

    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Endpoint: tautkan file Commons yang sudah ada ke P18 Wikidata
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/set-image', methods=['POST'])
@login_required
def set_image(qid):
    qid = qid.upper()
    body = request.get_json(silent=True) or {}
    filename = body.get('filename', '').strip()

    if not filename:
        return jsonify({'error': 'Nama file tidak boleh kosong'}), 400

    if filename.lower().startswith('file:'):
        filename = filename[5:]

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua = _ua()
    oauth = _get_authed_session()

    try:
        tok = oauth.get(
            wikidata_api,
            params={'action': 'query', 'meta': 'tokens', 'format': 'json'},
            headers={'User-Agent': ua},
        ).json()
        csrf_token = tok['query']['tokens']['csrftoken']
    except Exception as e:
        return jsonify({'error': f'Gagal ambil token: {e}'}), 500

    try:
        wd = oauth.post(
            wikidata_api,
            data={
                'action':   'wbcreateclaim',
                'entity':   qid,
                'snaktype': 'value',
                'property': 'P18',
                'value':    json.dumps(filename),
                'token':    csrf_token,
                'format':   'json',
                'summary':  'Menautkan gambar Commons via WikiJelajah',
            },
            headers={'User-Agent': ua},
        ).json()
    except Exception as e:
        return jsonify({'error': f'Gagal memperbarui Wikidata: {e}'}), 500

    if 'error' in wd:
        return jsonify({'error': wd['error'].get('info', 'Gagal menambah P18')}), 500

    return jsonify({'success': True, 'filename': filename})


# ---------------------------------------------------------------------------
# Endpoint: upload foto ke Commons + tambah P18 ke Wikidata
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/upload-photo', methods=['POST'])
@login_required
def upload_photo(qid):
    qid = qid.upper()

    if 'file' not in request.files:
        return jsonify({'error': 'Tidak ada file yang dikirim'}), 400

    file      = request.files['file']
    filename  = request.form.get('filename', '').strip()
    caption   = request.form.get('caption', '').strip()
    author    = session.get('user', {}).get('username', 'Unknown')

    if not filename:
        return jsonify({'error': 'Nama file wajib diisi'}), 400

    # Pastikan ekstensi ada
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'jpg'
    if not filename.lower().endswith(('.' + ext,)):
        filename = f'{filename}.{ext}'

    # Ganti spasi dengan underscore (standar Commons)
    filename = filename.replace(' ', '_')

    commons_api  = 'https://commons.wikimedia.org/w/api.php'
    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua           = _ua()
    oauth        = _get_authed_session()

    # 1. CSRF token dari Commons
    try:
        tok = oauth.get(
            commons_api,
            params={'action': 'query', 'meta': 'tokens', 'format': 'json'},
            headers={'User-Agent': ua},
        ).json()
        csrf_commons = tok['query']['tokens']['csrftoken']
    except Exception as e:
        return jsonify({'error': f'Gagal ambil token Commons: {e}'}), 500

    # 2. Wikitext halaman file
    today    = date.today().isoformat()
    wikitext = (
        f"=={{{{int:filedesc}}}}==\n"
        f"{{{{Information\n"
        f"|description={{{{id|1={caption or filename}}}}}\n"
        f"|date={today}\n"
        f"|source={{{{own}}}}\n"
        f"|author=[[User:{author}|{author}]]\n"
        f"}}}}\n\n"
        f"=={{{{int:license-header}}}}==\n"
        f"{{{{self|cc-by-sa-4.0}}}}\n\n"
        f"[[Category:Uploaded with WikiJelajah]]"
    )

    # 3. Upload ke Commons
    try:
        up = oauth.post(
            commons_api,
            data={
                'action':         'upload',
                'filename':       filename,
                'text':           wikitext,
                'comment':        f'Upload via WikiJelajah untuk {qid}',
                'token':          csrf_commons,
                'format':         'json',
                'ignorewarnings': '1',
            },
            files={'file': (filename, file.stream, file.content_type)},
            headers={'User-Agent': ua},
        ).json()
    except Exception as e:
        return jsonify({'error': f'Upload gagal: {e}'}), 500

    if 'error' in up:
        return jsonify({'error': up['error'].get('info', 'Upload ke Commons gagal')}), 500

    upload_info = up.get('upload', {})
    if upload_info.get('result') not in ('Success', 'Warning'):
        return jsonify({'error': f'Commons menolak upload: {up}'}), 500

    # Nama file final yang diterima Commons (bisa berbeda karena normalisasi)
    final_filename = upload_info.get('filename', filename)

    # 4. CSRF token dari Wikidata
    try:
        wdtok = oauth.get(
            wikidata_api,
            params={'action': 'query', 'meta': 'tokens', 'format': 'json'},
            headers={'User-Agent': ua},
        ).json()
        csrf_wikidata = wdtok['query']['tokens']['csrftoken']
    except Exception as e:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': f'Foto diupload ke Commons tapi gagal ambil token Wikidata: {e}',
        })

    # 5. Tambah klaim P18 ke Wikidata
    try:
        wd = oauth.post(
            wikidata_api,
            data={
                'action':   'wbcreateclaim',
                'entity':   qid,
                'snaktype': 'value',
                'property': 'P18',
                'value':    json.dumps(final_filename),
                'token':    csrf_wikidata,
                'format':   'json',
                'summary':  'Menambah gambar via WikiJelajah',
            },
            headers={'User-Agent': ua},
        ).json()
    except Exception as e:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': f'Foto diupload tapi gagal tambah P18: {e}',
        })

    if 'error' in wd:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': f'Foto diupload tapi P18 gagal: {wd["error"].get("info", "")}',
        })

    return jsonify({'success': True, 'filename': final_filename})
