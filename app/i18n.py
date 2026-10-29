"""Terjemahan antarmuka (i18n) dengan format pesan JSON MediaWiki/banana.

Pesan ada di folder i18n/ di akar repo: satu file per bahasa (i18n/id.json,
i18n/en.json, ...) ditambah i18n/qqq.json berisi penjelasan untuk penerjemah.
en.json adalah bahasa sumber untuk translatewiki.net; terjemahan dari sana
masuk sebagai file baru di folder yang sama tanpa perlu mengubah kode.

Sintaks pesan (sama dengan banana-i18n di browser):
  $1, $2            parameter
  {{PLURAL:$1|a|b}} bentuk tunggal/jamak
  {{formatnum:$1}}  angka dengan pemisah ribuan sesuai bahasa

Bahasa dipilih dari: ?uselang=xx → cookie wj_lang (tombol bahasa) → header
Accept-Language browser → bahasa Indonesia.
"""
import json
import os
import re
from urllib.parse import quote

from flask import current_app, g, has_app_context, has_request_context, request
from markupsafe import Markup, escape

I18N_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'i18n')
DEFAULT_LANG = 'id'
SOURCE_LANG = 'en'
COOKIE_NAME = 'wj_lang'

# Nama bahasa dalam bahasanya sendiri (autonim) untuk tombol pilih bahasa.
# Bahasa yang belum tercantum ditampilkan dengan kodenya saja.
AUTONYMS = {
    'id': 'Bahasa Indonesia', 'en': 'English', 'jv': 'Basa Jawa', 'su': 'Basa Sunda',
    'min': 'Baso Minangkabau', 'ban': 'Basa Bali', 'bjn': 'Bahasa Banjar', 'ace': 'Acèh',
    'bug': 'Basa Ugi', 'mad': 'Madhurâ', 'gor': 'Bahasa Hulontalo', 'bew': 'Betawi',
    'ms': 'Bahasa Melayu', 'nl': 'Nederlands', 'de': 'Deutsch', 'fr': 'Français',
    'es': 'Español', 'ja': '日本語', 'zh': '中文', 'ar': 'العربية',
}

# Bahasa daerah Indonesia jatuh ke bahasa Indonesia dulu sebelum bahasa Inggris
# (sama dengan rantai fallback MediaWiki)
FALLBACKS = {code: ['id'] for code in ('jv', 'su', 'min', 'ban', 'bjn', 'ace', 'bug', 'mad', 'gor', 'bew')}

RTL_LANGS = {'ar', 'fa', 'he', 'ur'}

# Bahasa tanpa bentuk jamak: {{PLURAL}} selalu memakai bentuk pertama
NO_PLURAL = {'id', 'ms', 'jv', 'su', 'min', 'ban', 'bjn', 'ace', 'bug', 'mad', 'gor', 'bew',
             'ja', 'zh', 'ko', 'th', 'vi'}

# Pemisah ribuan & desimal untuk {{formatnum:}} di sisi server
NUMBER_SEPARATORS = {'en': (',', '.'), 'ja': (',', '.'), 'zh': (',', '.')}

_cache = {'mtime': None, 'messages': {}}


def _load():
    """Muat semua file pesan; di mode debug dimuat ulang bila ada file yang berubah."""
    files = [f for f in os.listdir(I18N_DIR) if f.endswith('.json')]
    mtime = max((os.path.getmtime(os.path.join(I18N_DIR, f)) for f in files), default=0)
    debug = has_app_context() and current_app.debug
    if _cache['mtime'] is not None and (mtime == _cache['mtime'] or not debug):
        return _cache['messages']
    messages = {}
    for name in files:
        code = name[:-5]
        with open(os.path.join(I18N_DIR, name), encoding='utf-8') as fh:
            data = json.load(fh)
        data.pop('@metadata', None)
        messages[code] = data
    _cache.update(mtime=mtime, messages=messages)
    return messages


def available_languages():
    """Kode bahasa yang punya file terjemahan, urut: Indonesia, Inggris, lalu abjad."""
    codes = [c for c in _load() if c != 'qqq']
    return sorted(codes, key=lambda c: (c != DEFAULT_LANG, c != SOURCE_LANG, c))


def language_options():
    return [(code, AUTONYMS.get(code, code)) for code in available_languages()]


def fallback_chain(lang):
    chain = [lang, *FALLBACKS.get(lang, []), SOURCE_LANG, DEFAULT_LANG]
    return list(dict.fromkeys(chain))


def get_lang():
    """Bahasa antarmuka untuk permintaan saat ini."""
    if not has_request_context():
        return DEFAULT_LANG
    if 'lang' not in g:
        g.lang = _detect_lang()
    return g.lang


def _detect_lang():
    langs = available_languages()
    for candidate in (request.args.get('uselang'), request.cookies.get(COOKIE_NAME)):
        if candidate in langs:
            return candidate
    best = request.accept_languages.best_match(langs)
    if best:
        return best
    # Bahasa browser belum ada terjemahannya: pakai bahasa cadangannya bila ada
    # (mis. bahasa daerah Indonesia → Indonesia), selain itu bahasa Inggris, yang
    # paling umum dipahami pengguna dari negara mana pun
    for code, _ in request.accept_languages:
        for fallback in FALLBACKS.get(code.split('-')[0].lower(), []):
            if fallback in langs:
                return fallback
    return SOURCE_LANG


def messages_for(lang):
    """Semua pesan untuk satu bahasa, sudah dilengkapi dari bahasa fallback."""
    all_messages = _load()
    merged = {}
    for code in reversed(fallback_chain(lang)):
        merged.update(all_messages.get(code, {}))
    return merged


def _format_number(value, lang):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)
    thousands, decimal = NUMBER_SEPARATORS.get(lang, ('.', ','))
    text = f'{num:,.0f}' if num.is_integer() else f'{num:,}'
    return text.replace(',', '\0').replace('.', decimal).replace('\0', thousands)


def _plural_index(lang, value):
    if lang in NO_PLURAL:
        return 0
    try:
        return 0 if float(value) == 1 else 1
    except (TypeError, ValueError):
        return 1


def _render(lang, key, params):
    text = messages_for(lang).get(key)
    if text is None:
        return f'⧼{key}⧽'

    def param(token):
        m = re.fullmatch(r'\s*\$(\d+)\s*', token)
        if m and 0 < int(m.group(1)) <= len(params):
            return params[int(m.group(1)) - 1]
        return token.strip()

    def plural(m):
        forms = m.group(2).split('|')
        return forms[min(_plural_index(lang, param(m.group(1))), len(forms) - 1)]

    text = re.sub(r'\{\{PLURAL:([^|}]*)\|([^}]*)\}\}', plural, text)
    text = re.sub(r'\{\{formatnum:([^}]*)\}\}', lambda m: _format_number(param(m.group(1)), lang), text)
    return text


def _substitute(text, params):
    return re.sub(r'\$(\d+)', lambda m: str(params[int(m.group(1)) - 1])
                  if 0 < int(m.group(1)) <= len(params) else m.group(0), text)


def msg(key, *params, lang=None):
    """Teks pesan polos (di template Jinja tetap di-escape otomatis)."""
    return _substitute(_render(lang or get_lang(), key, params), params)


def msg_html(key, *params, lang=None):
    """Pesan sebagai HTML: teks pesan di-escape, parameter Markup disisipkan apa adanya."""
    text = escape(_render(lang or get_lang(), key, params))
    return Markup(_substitute(str(text), [escape(p) for p in params]))


def init_app(app):
    app.jinja_env.globals.update(msg=msg, msg_html=msg_html)

    @app.context_processor
    def inject_i18n():
        lang = get_lang()
        # Halaman saat ini tanpa ?uselang=, agar pilihan di tombol bahasa tidak tertimpa
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'uselang']
        query = '&'.join(f'{quote(k)}={quote(v)}' for k, v in args)
        return {
            'lang': lang,
            'lang_next': request.path + (f'?{query}' if query else ''),
            'lang_dir': 'rtl' if lang in RTL_LANGS else 'ltr',
            'language_options': language_options(),
            'i18n_messages': messages_for(lang),
        }
