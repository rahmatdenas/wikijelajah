from flask import current_app, redirect, render_template, request, session, url_for
from . import main
from ..auth.routes import _safe_next
from ..i18n import COOKIE_NAME, available_languages, get_lang
from ..utils.ai_search import DEFAULT_MODELS, GROQ_SEARCH_MODELS
from ..utils.wikidata import KATEGORI_DATA, kategori_slug, localized_wilayah


def _wilayah():
    return localized_wilayah(get_lang(), current_app.config['WIKIMEDIA_API_BASE'],
                             current_app.config['WIKIMEDIA_USER_AGENT'])


@main.route('/')
def index():
    provinsi, luar_negeri = _wilayah()
    return render_template(
        'index.html',
        user=session.get('user'),
        wilayah_provinsi=provinsi,
        wilayah_luar_negeri=luar_negeri,
        kategori_data=KATEGORI_DATA,
    )


@main.route('/enrich')
def enrich():
    provinsi, luar_negeri = _wilayah()
    return render_template(
        'enrich.html',
        user=session.get('user'),
        wilayah_provinsi=provinsi,
        wilayah_luar_negeri=luar_negeri,
        kategori_data=KATEGORI_DATA,
        default_models=DEFAULT_MODELS,
        groq_search_models=GROQ_SEARCH_MODELS,
    )


# Nilai ?tipe= lama (bahasa Indonesia) → ?region= baru
_LEGACY_REGION = {'provinsi': 'province', 'all': 'all', 'luar_negeri': 'abroad'}


@main.route('/perkaya')
def perkaya_legacy():
    """URL lama halaman Perkaya Data: alihkan permanen ke /enrich beserta parameternya."""
    args = request.args
    params = {
        'region': _LEGACY_REGION.get(args.get('tipe', '')),
        'province': args.get('prov', '').removeprefix('wd:') or None,
        'country': args.get('negara', '').removeprefix('wd:') or None,
        'category': kategori_slug(args.get('kategori', '')),
        'uselang': args.get('uselang'),
    }
    return redirect(url_for('main.enrich', **{k: v for k, v in params.items() if v}), code=301)


@main.route('/lang/<code>')
def set_language(code):
    """Tombol pilih bahasa: simpan pilihan di cookie lalu kembali ke halaman asal."""
    resp = redirect(_safe_next(request.args.get('next', '')))
    if code in available_languages():
        resp.set_cookie(COOKIE_NAME, code, max_age=365 * 24 * 3600, samesite='Lax',
                        secure=request.is_secure)
    return resp
