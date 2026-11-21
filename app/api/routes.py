import json
import re
from datetime import date
from functools import wraps
import requests
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
        return jsonify({'error': msg('item-not-found')}), 404

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

# Properti yang boleh diberi nilai tambahan walau sudah terisi (sama dengan PROP_MULTI_VALUE di main.js):
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
# Properti gambar yang boleh diisi lewat unggah / tautkan (sama dengan IMAGE_PROPS di main.js)
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


def _shot_date(value):
    """Tanggal foto YYYY-MM-DD dari formulir; hari ini bila kosong, tidak sah, atau di masa depan."""
    today = date.today()
    try:
        shot = date.fromisoformat((value or '').strip())
    except ValueError:
        return today.isoformat()
    return shot.isoformat() if shot <= today else today.isoformat()


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

    return jsonify({'success': True, 'filename': filename})


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

    commons_api  = 'https://commons.wikimedia.org/w/api.php'
    wikidata_api = current_app.config['WIKIMEDIA_API_BASE']
    ua           = _ua()
    oauth        = _get_authed_session()

    # 1. CSRF token dari Commons
    try:
        csrf_commons = _get_csrf_token(oauth, commons_api)
    except WikimediaAuthError:
        raise
    except Exception as e:
        return jsonify({'error': msg('api-token-failed', e)}), 500

    # 2. Wikitext halaman file — tanggal pemotretan (EXIF, dikirim tampilan) bila ada, selain itu hari ini
    wikitext = (
        f"=={{{{int:filedesc}}}}==\n"
        f"{{{{Information\n"
        f"|description={{{{{get_lang()}|1={caption or filename}}}}}\n"
        f"|date={_shot_date(request.form.get('date'))}\n"
        f"|source={{{{own}}}}\n"
        f"|author=[[User:{author}|{author}]]\n"
        f"}}}}\n\n"
        f"=={{{{int:license-header}}}}==\n"
        f"{{{{self|cc-by-sa-4.0}}}}\n\n"
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

    # 4. CSRF token dari Wikidata
    try:
        csrf_wikidata = _get_csrf_token(oauth, wikidata_api)
    except Exception as e:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': msg('api-upload-p18-failed', e),
        })

    # 5. Tambah klaim gambar ke Wikidata
    try:
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
    except Exception as e:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': msg('api-upload-p18-failed', e),
        })

    if 'error' in wd:
        return jsonify({
            'success': True,
            'filename': final_filename,
            'warning': msg('api-upload-p18-failed', wd['error'].get('info', '')),
        })

    return jsonify({'success': True, 'filename': final_filename})
