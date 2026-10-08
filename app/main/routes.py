from flask import render_template, session
from . import main
from ..utils.ai_search import DEFAULT_MODELS, GROQ_SEARCH_MODELS
from ..utils.wikidata import WILAYAH_PROVINSI, WILAYAH_LUAR_NEGERI, KATEGORI_DATA


@main.route('/')
def index():
    return render_template(
        'index.html',
        user=session.get('user'),
        wilayah_provinsi=WILAYAH_PROVINSI,
        wilayah_luar_negeri=WILAYAH_LUAR_NEGERI,
        kategori_data=KATEGORI_DATA,
    )


@main.route('/perkaya')
def perkaya():
    return render_template(
        'perkaya.html',
        user=session.get('user'),
        wilayah_provinsi=WILAYAH_PROVINSI,
        wilayah_luar_negeri=WILAYAH_LUAR_NEGERI,
        kategori_data=KATEGORI_DATA,
        default_models=DEFAULT_MODELS,
        groq_search_models=GROQ_SEARCH_MODELS,
    )
