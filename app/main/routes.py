from flask import render_template, session
from . import main
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
