import json
import re
import time
from datetime import date
from functools import wraps
from flask import current_app, jsonify, request, session
from requests_oauthlib import OAuth2Session
from . import api
from ..i18n import get_lang, msg
from ..utils.datavalue import DataValueError, build_value


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'oauth_token' not in session:
            return jsonify({'error': msg('pk-auth-required')}), 401
        return f(*args, **kwargs)
    return decorated


def _get_authed_session():
    return OAuth2Session(
        client_id=current_app.config['WIKIMEDIA_CLIENT_ID'],
        token=session['oauth_token'],
    )


def _get_session():
    """OAuth session pengguna. Semua endpoint tulis wajib login (@login_required): tanpa itu
    suntingan anonim akan tercatat atas IP server WikiJelajah, bukan IP pengunjung."""
    return _get_authed_session()


class WikimediaAuthError(Exception):
    """Wikimedia menolak token login pengguna (kedaluwarsa, dicabut, atau izin kurang)."""


def _get_csrf_token(http_session, api_url):
    """Token CSRF untuk menyunting atas nama pengguna.

    Bila API tidak memberi token (galat OAuth) atau hanya memberi token anonim "+\\",
    lempar WikimediaAuthError beserta pesan asli API agar pengguna diminta masuk lagi,
    alih-alih KeyError 'query' yang tidak jelas.
    """
    resp = http_session.get(
        api_url,
        params={'action': 'query', 'meta': 'tokens', 'format': 'json'},
        headers={'User-Agent': _ua()},
        timeout=10,
    )
    try:
        data = resp.json()
    except ValueError:
        data = {}
    token = (data.get('query') or {}).get('tokens', {}).get('csrftoken')
    if token and token != '+\\':
        return token
    err = data.get('error') or {}
    detail = err.get('info') or err.get('code') or ('anonymous token' if token else f'HTTP {resp.status_code}')
    current_app.logger.warning('Token CSRF ditolak (%s): %s', api_url, err or data or resp.status_code)
    raise WikimediaAuthError(detail)


@api.errorhandler(WikimediaAuthError)
def _login_expired(e):
    # Sesi login tidak berlaku lagi di Wikimedia: hapus agar tampilan kembali menawarkan "Masuk"
    session.pop('oauth_token', None)
    session.pop('user', None)
    return jsonify({'error': msg('api-login-expired', str(e)), 'relogin': True}), 401


def _ua():
    return current_app.config.get('WIKIMEDIA_USER_AGENT', 'WikiJelajah/1.0')


# ---------------------------------------------------------------------------
# Endpoint: ubah label / deskripsi
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/label', methods=['POST'])
@login_required
def update_label(qid):
    body = request.get_json(silent=True) or {}
    new_label = body.get('label', '').strip()
    if not new_label:
        return jsonify({'error': msg('api-label-empty')}), 400

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    http = _get_session()
    csrf_token = _get_csrf_token(http, wikidata_api)

    result = http.post(wikidata_api, data={
        'action': 'wbsetlabel',
        'id': qid.upper(),
        'language': 'id',
        'value': new_label,
        'token': csrf_token,
        'format': 'json',
    }, headers={'User-Agent': _ua()}).json()

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', msg('save-failed'))}), 500

    return jsonify({'success': True, 'label': new_label})


@api.route('/item/<qid>/description', methods=['POST'])
@login_required
def update_description(qid):
    body = request.get_json(silent=True) or {}
    new_desc = body.get('description', '').strip()

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    http = _get_session()
    csrf_token = _get_csrf_token(http, wikidata_api)

    result = http.post(wikidata_api, data={
        'action': 'wbsetdescription',
        'id': qid.upper(),
        'language': 'id',
        'value': new_desc,
        'token': csrf_token,
        'format': 'json',
    }, headers={'User-Agent': _ua()}).json()

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', msg('save-failed'))}), 500

    return jsonify({'success': True, 'description': new_desc})


# ---------------------------------------------------------------------------
# Endpoint: tambah klaim baru ke butir Wikidata
# datatype: item | quantity | time | url | string
# ---------------------------------------------------------------------------

# Properti yang boleh diberi nilai tambahan walau sudah terisi (sama dengan PROP_MULTI_VALUE di detail/props.js):
# terbuat dari, teknik pembuatan, bagian dari, status warisan budaya
MULTI_VALUE_PROPS = {'P186', 'P2079', 'P361', 'P1435'}


def _has_same_value(claims, new_value):
    """Apakah salah satu klaim sudah bernilai sama? Nilai lama boleh punya kunci tambahan (mis. 'id')."""
    for claim in claims:
        old = claim.get('mainsnak', {}).get('datavalue', {}).get('value')
        if isinstance(new_value, dict) and isinstance(old, dict):
            if all(old.get(k) == v for k, v in new_value.items()):
                return True
        elif old == new_value:
            return True
    return False


@api.route('/item/<qid>/add-claim', methods=['POST'])
@login_required
def add_claim(qid):
    qid  = qid.upper()
    body = request.get_json(silent=True) or {}

    prop     = body.get('property', '').strip()
    val      = body.get('value', '').strip()
    datatype = body.get('datatype', '').strip()
    unit_qid = body.get('unit', '').strip()

    if not prop or not re.match(r'^P\d+$', prop):
        return jsonify({'error': msg('api-property-invalid')}), 400
    try:
        wd_value = build_value(datatype, val, unit_qid)
    except DataValueError as e:
        return jsonify({'error': str(e)}), 400

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua   = _ua()
    http = _get_session()

    # Jangan menambah nilai kedua bila properti ini sudah terisi (mis. diisi orang lain sementara itu),
    # kecuali properti yang memang boleh punya beberapa nilai — tapi jangan nilai yang sama persis
    try:
        ent = http.get(wikidata_api, params={
            'action': 'wbgetentities', 'ids': qid, 'props': 'claims', 'format': 'json',
        }, headers={'User-Agent': ua}, timeout=15).json()
        existing = ent.get('entities', {}).get(qid, {}).get('claims', {}).get(prop)
    except Exception:
        return jsonify({'error': msg('api-check-failed')}), 502
    if existing and prop not in MULTI_VALUE_PROPS:
        return jsonify({'error': msg('api-already-has-value', prop, qid)}), 409
    if existing and _has_same_value(existing, json.loads(wd_value)):
        return jsonify({'error': msg('api-already-has-same-value', prop, qid)}), 409

    try:
        csrf = _get_csrf_token(http, wikidata_api)
    except WikimediaAuthError:
        raise
    except Exception as e:
        return jsonify({'error': msg('api-token-failed', e)}), 500

    try:
        result = http.post(wikidata_api, data={
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
        return jsonify({'error': msg('api-write-failed', e)}), 500

    if 'error' in result:
        return jsonify({'error': result['error'].get('info', msg('save-failed'))}), 500

    # revid dipakai tampilan untuk tautan "Lihat suntingan" di notifikasi berhasil
    return jsonify({'success': True, 'revid': result.get('pageinfo', {}).get('lastrevid')})


# ---------------------------------------------------------------------------
# Properti gambar yang boleh diisi lewat unggah / tautkan (sama dengan IMAGE_PROPS di detail/props.js)
IMAGE_PROPS = {'P18', 'P5775', 'P1442', 'P1766', 'P1801', 'P3451', 'P9721', 'P12565', 'P8592'}


def _image_prop(value):
    """Properti tujuan gambar; None bila bukan properti gambar yang diizinkan."""
    prop = (value or 'P18').strip().upper()
    return prop if prop in IMAGE_PROPS else None


def _commons_name(filename):
    """Nama berkas Commons yang sebanding: garis bawah = spasi, huruf pertama tidak peka besar-kecil."""
    name = (filename or '').replace('_', ' ').strip()
    return name[:1].upper() + name[1:]


def _image_already_linked(http, wikidata_api, ua, qid, prop, filename):
    """Apakah berkas ini sudah menjadi nilai `prop` di butir? Melempar galat bila gagal memeriksa."""
    claims = http.get(wikidata_api, params={
        'action': 'wbgetclaims', 'entity': qid, 'property': prop, 'format': 'json',
    }, headers={'User-Agent': ua}, timeout=15).json().get('claims', {}).get(prop, [])
    target = _commons_name(filename)
    return any(_commons_name(c.get('mainsnak', {}).get('datavalue', {}).get('value')) == target for c in claims)


# Peringatan unggah Commons yang boleh dilewati; peringatan lain menghentikan unggahan
# (mis. "exists" berarti file orang lain akan tertimpa, "duplicate" berarti foto yang sama sudah ada)
UPLOAD_SAFE_WARNINGS = {'badfilename', 'large-file'}
UPLOAD_NAME_TAKEN    = ('exists', 'exists-normalized', 'page-exists', 'nochange', 'duplicateversions')


def _upload_warning_response(warnings, filename):
    """Respons 409 untuk peringatan yang menghentikan unggahan; None bila semua peringatan ringan."""
    if warnings.get('duplicate'):
        existing = _commons_name(warnings['duplicate'][0])
        return jsonify({'error': msg('upload-duplicate', existing), 'code': 'duplicate',
                        'existing': existing}), 409
    if warnings.get('duplicate-archive'):
        return jsonify({'error': msg('upload-duplicate-deleted', _commons_name(warnings['duplicate-archive'])),
                        'code': 'duplicate-archive'}), 409
    if any(k in warnings for k in UPLOAD_NAME_TAKEN):
        # exists-normalized berisi nama berkas yang sudah ada (mis. .jpg untuk ketikan .jpeg)
        existing = warnings.get('exists-normalized') or filename
        existing = existing if isinstance(existing, str) else filename
        return jsonify({'error': msg('upload-name-exists', _commons_name(existing)), 'code': 'exists'}), 409
    if 'was-deleted' in warnings:
        return jsonify({'error': msg('upload-name-deleted', _commons_name(filename)), 'code': 'exists'}), 409
    other = set(warnings) - UPLOAD_SAFE_WARNINGS
    if other:
        return jsonify({'error': msg('api-upload-rejected', ', '.join(sorted(other)))}), 409
    return None


# Ekstensi yang sama bagi Commons (.jpeg = .jpg) dan ekstensi gambar yang dikenali di nama ketikan
EXT_ALIASES = {'jpeg': 'jpg', 'jpe': 'jpg', 'tif': 'tiff'}
IMAGE_EXTS  = {'jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'tif', 'tiff', 'heic', 'heif'}


def _upload_filename(name, device_filename):
    """Nama berkas Commons dengan tepat satu ekstensi, sesuai jenis file dari perangkat.

    Nama ketikan berakhiran .jpg untuk file .jpeg tetap .jpg; ekstensi gambar lain yang tidak cocok
    diganti (bukan ditambah) — Commons menolak ekstensi ganda seperti Nama.jpg.jpeg.
    """
    ext = device_filename.rsplit('.', 1)[-1].lower() if '.' in device_filename else 'jpg'
    stem, dot, typed = name.strip().rpartition('.')
    if dot and EXT_ALIASES.get(typed.lower(), typed.lower()) == EXT_ALIASES.get(ext, ext):
        pass
    elif dot and typed.lower() in IMAGE_EXTS:
        name = f'{stem}.{ext}'
    else:
        name = f'{name.strip()}.{ext}'
    return name.replace(' ', '_')  # standar Commons


def _commons_upload_error(error):
    """Pesan galat unggah Commons; galat TitleBlacklist datang sebagai kunci pesan ⧼…⧽ yang tak terbaca."""
    info = error.get('info', '')
    if error.get('code', '').startswith('titleblacklist') or 'titleblacklist' in info:
        key = re.sub(r'^⧼|⧽$', '', info).replace('titleblacklist-custom-', '')
        return msg('upload-name-blacklisted', key)
    return info or msg('upload-failed')


COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
MAX_UPLOAD_CATEGORIES = 5
_CATEGORY_BAD_CHARS = re.compile(r'[\[\]{}|<>#\n\r\t]')


def _upload_categories(raw, http, ua):
    """(nama kategori, pesan galat) dari isian JSON tampilan.

    Nama kategori disisipkan ke wikitext sebagai [[Category:…]], jadi karakter wikitext ditolak dan
    setiap kategori diperiksa ke Commons: harus ada, tidak tersembunyi, dan bukan pengalihan.
    """
    try:
        names = json.loads(raw or '[]')
    except ValueError:
        names = None
    if not isinstance(names, list):
        return [], msg('upload-category-invalid', raw)

    cleaned = []
    for n in names:
        n = re.sub(r'^category:', '', str(n).strip(), flags=re.I).replace('_', ' ').strip()
        if not n or len(n) > 200 or _CATEGORY_BAD_CHARS.search(n):
            return [], msg('upload-category-invalid', n)
        n = n[:1].upper() + n[1:]
        if n not in cleaned:
            cleaned.append(n)
    if len(cleaned) > MAX_UPLOAD_CATEGORIES:
        return [], msg('upload-category-too-many', MAX_UPLOAD_CATEGORIES)
    if not cleaned:
        return [], None

    try:
        data = http.get(COMMONS_API, params={
            'action': 'query', 'format': 'json', 'formatversion': 2,
            'titles': '|'.join(f'Category:{n}' for n in cleaned),
            'prop': 'pageprops|categories', 'ppprop': 'hiddencat',
            'clcategories': 'Category:Category redirects', 'cllimit': 'max',
        }, headers={'User-Agent': ua}, timeout=15).json()
    except Exception:
        return [], msg('api-check-failed')
    pages = {p['title']: p for p in data.get('query', {}).get('pages', [])}
    for n in cleaned:
        p = pages.get(f'Category:{n}')
        if not p or p.get('missing') or p.get('invalid'):
            return [], msg('upload-category-missing', n)
        if p.get('pageprops') or p.get('categories'):
            return [], msg('upload-category-unusable', n)
    return cleaned, None


# Jenis gambar yang memotret butir itu sendiri → berkasnya "menggambarkan" (P180) butir.
# Makam, plakat, dan papan nama memotret benda lain, jadi tidak diberi P180.
DEPICTS_PROPS = {'P18', 'P5775', 'P9721', 'P8592', 'P12565', 'P3451'}


def _commons_structured_data(http, ua, qid, filename, prop, caption='', extra=()):
    """Tambah "menggambarkan" (P180) = butir, keterangan (caption, bahasa antarmuka), dan pernyataan
    `extra` (lihat _upload_statements) ke data terstruktur berkas Commons. Properti yang sudah terisi
    tidak ditimpa. Kembalikan pesan peringatan bila gagal."""
    lang = get_lang()
    try:
        page = {}
        for attempt in range(2):  # berkas yang baru diunggah kadang belum terbaca di replika
            pages = http.get(COMMONS_API, params={
                'action': 'query', 'format': 'json', 'formatversion': 2,
                'titles': f'File:{filename}', 'prop': 'info',
            }, headers={'User-Agent': ua}, timeout=15).json().get('query', {}).get('pages', [])
            page = pages[0] if pages else {}
            if page.get('pageid'):
                break
            time.sleep(2)
        if not page.get('pageid'):
            return msg('api-structured-data-failed', f'File:{filename}')

        mid = f"M{page['pageid']}"
        ent = http.get(COMMONS_API, params={
            'action': 'wbgetentities', 'ids': mid, 'format': 'json',
        }, headers={'User-Agent': ua}, timeout=15).json().get('entities', {}).get(mid, {})

        data = {}
        statements = ent.get('statements') or ent.get('claims') or {}
        claims = [c for c in extra if not statements.get(c['mainsnak']['property'])]
        depicts = statements.get('P180', [])
        if prop in DEPICTS_PROPS and not any(
                (s.get('mainsnak', {}).get('datavalue', {}).get('value') or {}).get('id') == qid for s in depicts):
            claims.insert(0, _statement(_item_snak('P180', qid)))
        if claims:
            data['claims'] = claims
        caption = caption.strip()[:250]
        if caption and lang not in (ent.get('labels') or {}):
            data['labels'] = {lang: {'language': lang, 'value': caption}}
        if not data:
            return None

        token = _get_csrf_token(http, COMMONS_API)
        res = http.post(COMMONS_API, data={
            'action': 'wbeditentity', 'id': mid, 'data': json.dumps(data),
            'token': token, 'format': 'json',
            'summary': 'Data terstruktur via WikiJelajah: ' + ', '.join(
                [c['mainsnak']['property'] for c in data.get('claims', [])] + (['caption'] if 'labels' in data else [])),
        }, headers={'User-Agent': ua}, timeout=30).json()
        if 'error' in res:
            return msg('api-structured-data-failed', res['error'].get('info', ''))
    except WikimediaAuthError as e:
        return msg('api-structured-data-failed', e)
    except Exception as e:
        current_app.logger.warning('Data terstruktur %s gagal: %s', filename, e)
        return msg('api-structured-data-failed', e)
    return None


def _item_snak(prop, qid):
    return {'snaktype': 'value', 'property': prop,
            'datavalue': {'type': 'wikibase-entityid',
                          'value': {'entity-type': 'item', 'numeric-id': int(qid[1:]), 'id': qid}}}


def _statement(mainsnak, qualifiers=None):
    st = {'mainsnak': mainsnak, 'type': 'statement', 'rank': 'normal'}
    if qualifiers:
        st['qualifiers'] = {q['property']: [q] for q in qualifiers}
        st['qualifiers-order'] = [q['property'] for q in qualifiers]
    return st


def _upload_statements(author, shot, location):
    """Pernyataan data terstruktur untuk unggahan WikiJelajah (selalu karya sendiri, CC BY-SA 4.0),
    sama dengan isi wikitext {{Information}} / {{self}} / {{Location}}.

    `shot`: tanggal pemotretan (date) dari EXIF atau None; `location`: (lat, lon, heading|None) atau None.
    """
    user_url = f"https://commons.wikimedia.org/wiki/User:{author.replace(' ', '_')}"
    statements = [
        _statement(_item_snak('P6216', 'Q50423863')),   # status hak cipta: dilindungi hak cipta
        _statement(_item_snak('P275', 'Q18199165')),    # lisensi: CC BY-SA 4.0
        _statement(_item_snak('P7482', 'Q66458942')),   # sumber berkas: karya asli pengunggah
        # pembuat: tidak punya butir Wikidata → somevalue + nama, akun, dan tautan halaman pengguna
        _statement({'snaktype': 'somevalue', 'property': 'P170'}, [
            {'snaktype': 'value', 'property': 'P2093', 'datavalue': {'type': 'string', 'value': author}},
            {'snaktype': 'value', 'property': 'P4174', 'datavalue': {'type': 'string', 'value': author}},
            {'snaktype': 'value', 'property': 'P2699', 'datavalue': {'type': 'string', 'value': user_url}},
        ]),
    ]
    if shot:
        statements.append(_statement({'snaktype': 'value', 'property': 'P571', 'datavalue': {'type': 'time', 'value': {
            'time': f'+{shot.isoformat()}T00:00:00Z', 'timezone': 0, 'before': 0, 'after': 0,
            'precision': 11, 'calendarmodel': 'http://www.wikidata.org/entity/Q1985727'}}}))
    if location:
        lat, lon, heading = location
        quals = [{'snaktype': 'value', 'property': 'P7787', 'datavalue': {'type': 'quantity', 'value': {
            'amount': f'+{heading:g}', 'unit': 'http://www.wikidata.org/entity/Q28390'}}}] if heading is not None else None
        statements.append(_statement({'snaktype': 'value', 'property': 'P1259', 'datavalue': {
            'type': 'globecoordinate', 'value': {'latitude': lat, 'longitude': lon, 'altitude': None,
                                                 'precision': 1e-06, 'globe': 'http://www.wikidata.org/entity/Q2'}}}, quals))
    return statements


def _exif_date(value):
    """Tanggal pemotretan dari formulir (YYYY-MM-DD, EXIF); None bila kosong, tidak sah, atau di masa depan."""
    try:
        shot = date.fromisoformat((value or '').strip())
    except ValueError:
        return None
    return shot if shot <= date.today() else None


def _shot_date(value, time_value=''):
    """Isi |date= di {{Information}}: tanggal (dan jam) pemotretan EXIF bila ada, selain itu hari ini."""
    shot = _exif_date(value)
    if not shot:
        return date.today().isoformat()
    t = (time_value or '').strip()
    return f'{shot.isoformat()} {t}' if re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d:[0-5]\d', t) else shot.isoformat()


def _camera_location(form):
    """(lat, lon, heading|None) lokasi kamera dari GPS EXIF yang dikirim tampilan; None bila tidak ada / tidak sah."""
    try:
        lat, lon = float(form.get('lat', '')), float(form.get('lon', ''))
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    try:
        heading = float(form.get('heading', ''))
        heading = round(heading, 2) if 0 <= heading <= 360 else None
    except ValueError:
        heading = None
    return round(lat, 6), round(lon, 6), heading


# Endpoint: tautkan file Commons yang sudah ada ke properti gambar Wikidata (bawaan P18)
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/set-image', methods=['POST'])
@login_required
def set_image(qid):
    qid = qid.upper()
    body = request.get_json(silent=True) or {}
    filename = body.get('filename', '').strip()
    prop = _image_prop(body.get('property'))

    if not filename:
        return jsonify({'error': msg('upload-filename-required')}), 400
    if not prop:
        return jsonify({'error': msg('api-image-prop-invalid')}), 400

    if filename.lower().startswith('file:'):
        filename = filename[5:]

    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua   = _ua()
    http = _get_session()

    # Berkas yang sama jangan ditautkan dua kali ke properti yang sama
    try:
        if _image_already_linked(http, wikidata_api, ua, qid, prop, filename):
            return jsonify({'error': msg('image-already-linked', prop)}), 409
    except Exception:
        return jsonify({'error': msg('api-check-failed')}), 502

    try:
        csrf_token = _get_csrf_token(http, wikidata_api)
    except WikimediaAuthError:
        raise
    except Exception as e:
        return jsonify({'error': msg('api-token-failed', e)}), 500

    try:
        wd = http.post(
            wikidata_api,
            data={
                'action':   'wbcreateclaim',
                'entity':   qid,
                'snaktype': 'value',
                'property': prop,
                'value':    json.dumps(filename),
                'token':    csrf_token,
                'format':   'json',
                'summary':  'Menautkan gambar Commons via WikiJelajah',
            },
            headers={'User-Agent': ua},
        ).json()
    except Exception as e:
        return jsonify({'error': msg('api-write-failed', e)}), 500

    if 'error' in wd:
        return jsonify({'error': wd['error'].get('info', msg('link-photo-failed'))}), 500

    # Arah sebaliknya: berkas Commons "menggambarkan" butir ini (gagal = peringatan saja)
    warning = _commons_structured_data(http, _ua(), qid, filename, prop) if prop in DEPICTS_PROPS else None
    return jsonify({'success': True, 'filename': filename, **({'warning': warning} if warning else {})})


# ---------------------------------------------------------------------------
# Endpoint: upload foto ke Commons + tambah ke properti gambar Wikidata (bawaan P18)
# ---------------------------------------------------------------------------

@api.route('/item/<qid>/upload-photo', methods=['POST'])
@login_required
def upload_photo(qid):
    qid = qid.upper()

    if 'file' not in request.files:
        return jsonify({'error': msg('upload-choose-photo')}), 400

    file      = request.files['file']
    filename  = request.form.get('filename', '').strip()
    caption   = request.form.get('caption', '').strip()
    author    = session.get('user', {}).get('username', 'Unknown')
    prop      = _image_prop(request.form.get('property'))

    if not filename:
        return jsonify({'error': msg('upload-filename-required')}), 400
    if not prop:
        return jsonify({'error': msg('api-image-prop-invalid')}), 400

    filename = _upload_filename(filename, file.filename)

    commons_api  = COMMONS_API
    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua           = _ua()
    oauth        = _get_authed_session()

    categories, cat_error = _upload_categories(request.form.get('categories'), oauth, ua)
    if cat_error:
        return jsonify({'error': cat_error}), 400
    category_text = ''.join(f'[[Category:{c}]]\n' for c in categories)

    # 1. CSRF token dari Commons
    try:
        csrf_commons = _get_csrf_token(oauth, commons_api)
    except WikimediaAuthError:
        raise
    except Exception as e:
        return jsonify({'error': msg('api-token-failed', e)}), 500

    # 2. Wikitext halaman file — tanggal & jam pemotretan dan lokasi kamera dari EXIF (dikirim tampilan)
    location = _camera_location(request.form)
    location_text = ''
    if location:
        lat, lon, heading = location
        location_text = f"{{{{Location|{lat}|{lon}{f'|heading:{heading:g}' if heading is not None else ''}}}}}\n"
    wikitext = (
        f"=={{{{int:filedesc}}}}==\n"
        f"{{{{Information\n"
        f"|description={{{{{get_lang()}|1={caption or filename}}}}}\n"
        f"|date={_shot_date(request.form.get('date'), request.form.get('time'))}\n"
        f"|source={{{{own}}}}\n"
        f"|author=[[User:{author}|{author}]]\n"
        f"}}}}\n"
        f"{location_text}\n"
        f"=={{{{int:license-header}}}}==\n"
        f"{{{{self|cc-by-sa-4.0}}}}\n\n"
        f"{category_text}"
        f"[[Category:Uploaded with WikiJelajah]]"
    )

    # 3. Upload ke Commons — tanpa ignorewarnings: bila ada peringatan, Commons menyimpan file
    #    sementara (filekey) dan kita putuskan apakah boleh dilanjutkan
    upload_data = {
        'action':   'upload',
        'filename': filename,
        'text':     wikitext,
        'comment':  f'Upload via WikiJelajah untuk {qid}',
        'token':    csrf_commons,
        'format':   'json',
    }
    try:
        up = oauth.post(
            commons_api,
            data=upload_data,
            files={'file': (filename, file.stream, file.content_type)},
            headers={'User-Agent': ua},
        ).json()
    except Exception as e:
        return jsonify({'error': msg('api-upload-failed', e)}), 500

    if 'error' in up:
        return jsonify({'error': _commons_upload_error(up['error'])}), 500

    upload_info = up.get('upload', {})
    if upload_info.get('result') == 'Warning':
        warnings = upload_info.get('warnings', {})
        blocked = _upload_warning_response(warnings, filename)
        if blocked:
            return blocked
        # Hanya peringatan ringan: lanjutkan dari file sementara
        try:
            up = oauth.post(commons_api, data={
                **upload_data,
                'filename':       warnings.get('badfilename', filename),
                'filekey':        upload_info.get('filekey'),
                'ignorewarnings': '1',
            }, headers={'User-Agent': ua}).json()
        except Exception as e:
            return jsonify({'error': msg('api-upload-failed', e)}), 500
        if 'error' in up:
            return jsonify({'error': _commons_upload_error(up['error'])}), 500
        upload_info = up.get('upload', {})

    if upload_info.get('result') != 'Success':
        return jsonify({'error': msg('api-upload-rejected', up)}), 500

    # Nama file final yang diterima Commons (bisa berbeda karena normalisasi)
    final_filename = upload_info.get('filename', filename)
    warnings = []

    # 4. Data terstruktur berkas: menggambarkan (P180) = butir, keterangan = caption, serta lisensi,
    #    pembuat, tanggal, dan lokasi kamera (sama dengan wikitext; menghapus kategori "missing SDC …")
    sd_warning = _commons_structured_data(
        oauth, ua, qid, final_filename, prop, caption,
        extra=_upload_statements(author, _exif_date(request.form.get('date')), location))
    if sd_warning:
        warnings.append(sd_warning)

    # 5. Tambah klaim gambar ke Wikidata
    try:
        csrf_wikidata = _get_csrf_token(oauth, wikidata_api)
        wd = oauth.post(
            wikidata_api,
            data={
                'action':   'wbcreateclaim',
                'entity':   qid,
                'snaktype': 'value',
                'property': prop,
                'value':    json.dumps(final_filename),
                'token':    csrf_wikidata,
                'format':   'json',
                'summary':  'Menambah gambar via WikiJelajah',
            },
            headers={'User-Agent': ua},
        ).json()
        if 'error' in wd:
            warnings.insert(0, msg('api-upload-p18-failed', wd['error'].get('info', '')))
    except Exception as e:
        warnings.insert(0, msg('api-upload-p18-failed', e))

    result = {'success': True, 'filename': final_filename}
    if warnings:
        result['warning'] = ' · '.join(warnings)
    return jsonify(result)
