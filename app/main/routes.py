from flask import current_app, redirect, render_template, request, session
from . import main
from ..auth.routes import _safe_next
from ..i18n import COOKIE_NAME, available_languages, get_lang
from ..utils.ai_search import DEFAULT_MODELS, GROQ_SEARCH_MODELS
from ..utils.wikidata import KATEGORI_DATA, localized_wilayah


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


@main.route('/perkaya')
def perkaya():
    provinsi, luar_negeri = _wilayah()
    return render_template(
        'perkaya.html',
        user=session.get('user'),
        wilayah_provinsi=provinsi,
        wilayah_luar_negeri=luar_negeri,
        kategori_data=KATEGORI_DATA,
        default_models=DEFAULT_MODELS,
        groq_search_models=GROQ_SEARCH_MODELS,
    )


@main.route('/lang/<code>')
def set_language(code):
    """Tombol pilih bahasa: simpan pilihan di cookie lalu kembali ke halaman asal."""
    resp = redirect(_safe_next(request.args.get('next', '')))
    if code in available_languages():
        resp.set_cookie(COOKIE_NAME, code, max_age=365 * 24 * 3600, samesite='Lax',
                        secure=request.is_secure)
    return resp
