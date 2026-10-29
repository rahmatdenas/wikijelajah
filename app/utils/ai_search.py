"""Pencarian nilai atribut Wikidata dengan AI + verifikasi kutipan ke halaman sumber.

Alur: AI (Claude / OpenAI / Gemini, masing-masing dengan pencarian web bawaan)
diminta mencari satu nilai untuk satu butir & atribut, lalu menjawab JSON berisi
nilai, sumber, dan kutipan persis. Server kemudian membuka halaman sumber sendiri
untuk memastikan kutipan dan nilainya memang ada di sana — AI tidak dipercaya
begitu saja. Hasilnya tetap harus divalidasi manusia sebelum masuk ke Wikidata.
"""
import html
import ipaddress
import json
import re
import socket
import time
import unicodedata
from urllib.parse import urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError
from urllib3.util.connection import create_connection

from ..i18n import msg

# Model bawaan per penyedia; pengguna bisa menggantinya di pengaturan halaman.
DEFAULT_MODELS = {
    'claude': 'claude-opus-5-5',
    'openai': 'gpt-5',
    'gemini': 'gemini-2.5-flash',
    'groq': 'openai/gpt-oss-120b',
}

# Model Groq yang mendukung pencarian web (browser_search), urut prioritas.
# Bila model pilihan gagal (tidak tersedia, kuota habis, error server), model
# berikutnya dicoba otomatis. Model tanpa pencarian web sengaja tidak dipakai
# sebagai cadangan: tanpa pencarian, nilai & sumbernya hanya karangan.
GROQ_SEARCH_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']

FETCH_UA = 'Mozilla/5.0 (compatible; WikiJelajah/1.0; +https://www.wikidata.org/wiki/User:WikiJelajah)'
AI_TIMEOUT = 180  # detik — pencarian web + penalaran bisa lama
MAX_PAGE_BYTES = 5 * 1024 * 1024  # halaman sumber dibaca paling banyak 5 MB
MAX_REDIRECTS = 5

SYSTEM_PROMPT = """You are a research assistant for Wikidata editors in Indonesia.
Your job: find the value of ONE property of ONE Wikidata item, using web search.

Rules:
- Never guess or rely on memory. Only report a value that is stated in a web page you actually retrieved.
- For every source, copy an exact quote (one or two sentences, max ~300 characters) from that page that contains the value. Do not paraphrase or translate the quote.
- Prefer authoritative sources: Indonesian government sites (.go.id), official institution websites, academic publications, reputable news media. Avoid Wikipedia, Wikidata and their mirrors, social media, forums and travel blogs when better sources exist.
- Make sure each source is about the same entity (check name AND location).
- If several sources agree on the same value, list them all under that value (max 3 sources per value).
- If reliable sources disagree, report each distinct value separately with its own sources (max 3 values). Do not pick one and hide the other.
- If you cannot find a reliable source, answer with found=false. A missing value is far better than a wrong one.

Finish with ONLY a JSON object (no markdown, no extra text) in this shape:
{"found": true|false,
 "values": [
   {"value": "...",
    "sources": [{"title": "...", "url": "https://...", "quote": "...", "quote_language": "id"}]}
 ],
 "note": "..."}
- quote_language: ISO 639-1 code of the quote's language (e.g. "id", "en").
- note: one short sentence in {note_language} (e.g. why not found, why sources disagree, or a caveat)."""

# Nama bahasa (dalam bahasa Inggris) untuk catatan AI, mengikuti bahasa antarmuka pengguna
NOTE_LANGUAGES = {
    'id': 'Indonesian', 'en': 'English', 'jv': 'Javanese', 'su': 'Sundanese', 'min': 'Minangkabau',
    'ban': 'Balinese', 'bjn': 'Banjarese', 'ace': 'Acehnese', 'bug': 'Buginese', 'mad': 'Madurese',
    'ms': 'Malay', 'nl': 'Dutch', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'ja': 'Japanese',
}


def system_prompt(note_lang):
    name = NOTE_LANGUAGES.get(note_lang) or f'the language with code "{note_lang}"'
    return SYSTEM_PROMPT.replace('{note_language}', name)

VALUE_FORMAT = {
    'quantity': 'a plain number in {unit}, dot as decimal separator, no thousands separator (e.g. 2157 or 3.5)',
    'time': 'a date as YYYY, YYYY-MM or YYYY-MM-DD — only as precise as the source states',
    'item': 'the name of the entity (person, place, organisation or concept) exactly as written in the source',
    'url': 'the full URL of the official website, starting with https:// or http://',
    'string': 'the exact text/code as written in the source',
}


UNIT_NAMES = {'mdpl': 'metres above sea level', 'm': 'metres', 'km²': 'square kilometres'}
# Label satuan dari browser bisa sudah diterjemahkan; satuan dikenali juga dari QID-nya
UNIT_QID_NAMES = {'Q11573': 'metres', 'Q712226': 'square kilometres'}


class AISearchError(Exception):
    """Kegagalan pencarian AI; pesannya aman ditampilkan ke pengguna.

    fatal=True bila mengulang untuk butir lain pasti gagal juga (API key salah,
    tidak punya akses, kuota habis) sehingga antrean di browser dihentikan.
    """

    def __init__(self, message, fatal=False):
        super().__init__(message)
        self.fatal = fatal


# ---------------------------------------------------------------------------
# PROMPT
# ---------------------------------------------------------------------------

def build_prompt(item, attr):
    unit_label = attr.get('unit_label') or ''
    unit = (UNIT_NAMES.get(unit_label) or UNIT_QID_NAMES.get(attr.get('unit') or '') or unit_label
            or 'no unit (a plain count or number)')
    fmt = VALUE_FORMAT[attr['type']].format(unit=unit)

    lines = [
        f"Wikidata item: {item['label']} ({item['qid']})",
        f"Description: {item.get('description') or '-'}",
        f"Category: {item.get('kategori') or '-'}",
        f"Location: {item.get('lokasi') or '-'}",
        '',
        f"Find the value of the property \"{attr['label']}\" (Wikidata {attr['pid']}) for this item.",
        f"Value format: {fmt}.",
    ]
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# PENYEDIA AI
# ---------------------------------------------------------------------------

def search(provider, api_key, model, item, attr, note_lang='id'):
    """Jalankan pencarian AI. Kembalikan dict hasil (lihat _parse_answer) + 'model' yang dipakai.

    note_lang: bahasa catatan singkat AI (bahasa antarmuka pengguna).
    """
    if not api_key:
        raise AISearchError(msg('ai-key-missing'), fatal=True)
    prompt = build_prompt(item, attr)
    system = system_prompt(note_lang)
    model = model or DEFAULT_MODELS[provider]

    if provider == 'claude':
        text, citations = _search_claude(api_key, model, system, prompt)
    elif provider == 'openai':
        text, citations = _search_openai(api_key, model, system, prompt)
    elif provider == 'gemini':
        text, citations = _search_gemini(api_key, model, system, prompt)
    elif provider == 'groq':
        text, citations, model = _search_groq(api_key, model, system, prompt)
    else:
        raise AISearchError(msg('api-provider-invalid'))

    result = _parse_answer(text)

    # Bila AI tidak menuliskan URL sumber, pakai sitasi pertama dari pencarian web
    for opt in result['values']:
        for src in opt['sources']:
            if not src['url'] and citations:
                src['url'] = citations[0]['url']
                src['title'] = src['title'] or citations[0].get('title', '')
    result['model'] = model
    return result


# Model yang menerima fallbacks="default" (lihat dokumentasi Claude API)
_CLAUDE_FALLBACK_MODELS = {'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'}


def _search_claude(api_key, model, system, prompt):
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=AI_TIMEOUT)
    older = 'haiku' in model
    params = {
        'model': model,
        'max_tokens': 16000,
        'system': system,
        'tools': [{
            'type': 'web_search_20250305' if older else 'web_search_20260209',
            'name': 'web_search',
            'max_uses': 5,
        }],
    }
    if not older:
        params['output_config'] = {'effort': 'medium'}
    if model in _CLAUDE_FALLBACK_MODELS:
        params['betas'] = ['server-side-fallback-2026-07-01']
        params['fallbacks'] = 'default'

    messages = [{'role': 'user', 'content': prompt}]
    try:
        for _ in range(5):
            if 'betas' in params:
                resp = client.beta.messages.create(messages=messages, **params)
            else:
                resp = client.messages.create(messages=messages, **params)
            if resp.stop_reason != 'pause_turn':
                break
            # Pencarian panjang dijeda server — lanjutkan dengan mengirim balik isi respons
            messages = [{'role': 'user', 'content': prompt},
                        {'role': 'assistant', 'content': resp.content}]
    except anthropic.AuthenticationError:
        raise AISearchError(msg('ai-key-invalid', 'Claude'), fatal=True) from None
    except anthropic.PermissionDeniedError:
        raise AISearchError(msg('ai-no-access', 'Claude'), fatal=True) from None
    except anthropic.RateLimitError:
        raise AISearchError(msg('ai-rate-limited', 'Claude'), fatal=True) from None
    except anthropic.BadRequestError as e:
        raise AISearchError(msg('ai-request-rejected', 'Claude', e.message)) from None
    except anthropic.APIStatusError as e:
        raise AISearchError(msg('ai-status-error', 'Claude', e.status_code)) from None
    except anthropic.APIConnectionError:
        raise AISearchError(msg('ai-connection-failed', 'Claude')) from None

    if resp.stop_reason == 'refusal':
        raise AISearchError(msg('ai-refused', 'Claude'))

    text_parts, citations = [], []
    for block in resp.content:
        if block.type != 'text':
            continue
        text_parts.append(block.text)
        for c in getattr(block, 'citations', None) or []:
            if getattr(c, 'type', '') == 'web_search_result_location':
                citations.append({'url': c.url, 'title': c.title or '', 'quote': c.cited_text or ''})
    return ''.join(text_parts), citations


def _search_openai(api_key, model, system, prompt):
    import openai

    client = openai.OpenAI(api_key=api_key, timeout=AI_TIMEOUT)
    try:
        resp = client.responses.create(
            model=model,
            instructions=system,
            input=prompt,
            tools=[{'type': 'web_search'}],
        )
    except openai.AuthenticationError:
        raise AISearchError(msg('ai-key-invalid', 'OpenAI'), fatal=True) from None
    except openai.RateLimitError:
        raise AISearchError(msg('ai-rate-limited', 'OpenAI'), fatal=True) from None
    except openai.APIStatusError as e:
        raise AISearchError(msg('ai-request-rejected', 'OpenAI', f'{e.status_code}: {e.message}')) from None
    except openai.APIConnectionError:
        raise AISearchError(msg('ai-connection-failed', 'OpenAI')) from None

    citations = []
    for out in resp.output or []:
        if getattr(out, 'type', '') != 'message':
            continue
        for part in out.content or []:
            for a in getattr(part, 'annotations', None) or []:
                if getattr(a, 'type', '') == 'url_citation':
                    citations.append({'url': a.url, 'title': getattr(a, 'title', '') or ''})
    return resp.output_text or '', citations


def _search_gemini(api_key, model, system, prompt):
    from google import genai
    from google.genai import errors, types

    client = genai.Client(api_key=api_key)
    try:
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
    except errors.ClientError as e:
        if e.code in (401, 403) or 'API key' in str(e):
            raise AISearchError(msg('ai-key-invalid', 'Gemini'), fatal=True) from None
        if e.code == 429:
            raise AISearchError(msg('ai-rate-limited', 'Gemini'), fatal=True) from None
        raise AISearchError(msg('ai-request-rejected', 'Gemini', e.message)) from None
    except errors.APIError as e:
        raise AISearchError(msg('ai-status-error', 'Gemini', e.code)) from None

    citations = []
    cand = (resp.candidates or [None])[0]
    meta = getattr(cand, 'grounding_metadata', None)
    for chunk in getattr(meta, 'grounding_chunks', None) or []:
        if chunk.web and chunk.web.uri:
            citations.append({'url': chunk.web.uri, 'title': chunk.web.title or ''})
    return resp.text or '', citations


def _search_groq(api_key, model, system, prompt):
    """Groq + browser_search. Coba model pilihan, lalu model cadangan yang juga bisa mencari web."""
    import groq

    client = groq.Groq(api_key=api_key, timeout=AI_TIMEOUT)
    models = [model] + [m for m in GROQ_SEARCH_MODELS if m != model]
    failures = []

    for m in models:
        try:
            resp = client.chat.completions.create(
                model=m,
                messages=[
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': prompt},
                ],
                tools=[{'type': 'browser_search'}],
                tool_choice='required',
                reasoning_effort='medium',
                max_completion_tokens=8192,
            )
        except (groq.AuthenticationError, groq.PermissionDeniedError):
            raise AISearchError(msg('ai-key-invalid', 'Groq'), fatal=True) from None
        except groq.RateLimitError:
            failures.append(f"{m}: {msg('ai-groq-rate-limited')}")
            continue
        except (groq.NotFoundError, groq.BadRequestError) as e:
            # Model tidak ada / sudah dihentikan / tidak mendukung browser_search
            failures.append(f'{m}: {e.message}')
            continue
        except groq.APIStatusError as e:
            failures.append(f'{m}: error {e.status_code}')
            continue
        except groq.APIConnectionError:
            raise AISearchError(msg('ai-connection-failed', 'Groq')) from None

        msg = resp.choices[0].message
        if not (msg.content or '').strip():
            failures.append(f"{m}: {msg('ai-groq-empty')}")
            continue

        citations = []
        for tool in msg.executed_tools or []:
            for r in tool.browser_results or []:
                if r.url:
                    citations.append({'url': r.url, 'title': r.title or ''})
            for r in getattr(tool.search_results, 'results', None) or []:
                if r.url:
                    citations.append({'url': r.url, 'title': r.title or ''})
        return msg.content, citations, m

    raise AISearchError(msg('ai-groq-all-failed', '; '.join(failures)))


# ---------------------------------------------------------------------------
# PARSING JAWABAN
# ---------------------------------------------------------------------------

def _extract_json(text):
    """Objek JSON terakhir di teks (toleran terhadap markdown/teks di sekitarnya, termasuk JSON bersarang)."""
    decoder = json.JSONDecoder()
    found = None
    for i, ch in enumerate(text or ''):
        if ch != '{':
            continue
        try:
            obj, _end = decoder.raw_decode(text, i)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and 'found' in obj:
            found = obj
    return found


def _parse_source(src):
    src = src if isinstance(src, dict) else {}
    lang = str(src.get('quote_language') or '').strip().lower()
    return {
        'title': str(src.get('title') or '').strip()[:300],
        'url': str(src.get('url') or '').strip(),
        'quote': str(src.get('quote') or '').strip()[:1000],
        'quote_language': lang if re.fullmatch(r'[a-z]{2,3}', lang) else 'und',
    }


def _parse_answer(text):
    """Baca jawaban AI → {'found', 'values': [{'value', 'sources': [...]}], 'note'}."""
    data = _extract_json(text)
    if data is None:
        raise AISearchError(msg('ai-unreadable'))

    raw_values = data.get('values')
    if not isinstance(raw_values, list):
        # Format lama: satu nilai dengan satu sumber di tingkat atas
        raw_values = [{'value': data.get('value'), 'sources': [{
            'title': data.get('source_title'), 'url': data.get('source_url'),
            'quote': data.get('quote'), 'quote_language': data.get('quote_language'),
        }]}]

    values = []
    for opt in raw_values[:3]:
        if not isinstance(opt, dict) or not str(opt.get('value') or '').strip():
            continue
        sources = [_parse_source(s) for s in (opt.get('sources') or [])[:3]]
        values.append({'value': str(opt['value']).strip(), 'sources': [s for s in sources if s['url'] or s['quote']]})

    return {
        'found': bool(data.get('found')) and bool(values),
        'values': values,
        'note': str(data.get('note') or '').strip()[:500],
    }


def clean_value(datatype, value):
    """Rapikan nilai mentah dari AI sesuai datatype. Kembalikan None bila tidak bisa dipakai."""
    value = value.strip()
    if datatype == 'quantity':
        # Ambil angka di depan, buang satuan yang terbawa ("2910 m" → "2910")
        m = re.match(r'-?\d[\d.,\s]*', value)
        if not m:
            return None
        v = re.sub(r'\s', '', m.group(0)).rstrip('.,')
        # "2.157" / "2,157" sebagai pemisah ribuan → 2157
        if re.fullmatch(r'\d{1,3}([.,]\d{3})+', v):
            v = re.sub(r'[.,]', '', v)
        v = v.replace(',', '.')
        return v if re.fullmatch(r'-?\d+(\.\d+)?', v) else None
    if datatype == 'time':
        return value if re.fullmatch(r'\d{1,4}(-\d{2}(-\d{2})?)?', value) else None
    if datatype == 'url':
        return value if re.match(r'^https?://', value) else None
    return value[:400] or None


# ---------------------------------------------------------------------------
# VERIFIKASI KE HALAMAN SUMBER
# ---------------------------------------------------------------------------

def _normalize_text(s):
    s = unicodedata.normalize('NFKC', s or '').lower()
    s = re.sub(r'[‘’“”"\'`]', '', s)
    s = re.sub(r'[‐-―]', '-', s)
    return re.sub(r'\s+', ' ', s).strip()


def _html_to_text(raw):
    raw = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return html.unescape(raw)


def _is_public_ip(ip):
    ip = ipaddress.ip_address(ip)
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _is_public_url(url):
    """Tolak URL ke jaringan lokal/privat (server tidak boleh disuruh membuka alamat internal)."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    except (socket.gaierror, ValueError):
        return False
    return all(_is_public_ip(info[4][0]) for info in infos)


class _PublicOnlyMixin:
    """Koneksi hanya ke IP publik, dicek saat menyambung — bukan cuma saat URL diperiksa.

    Socket disambungkan ke IP yang sudah dicek, sedangkan SNI & sertifikat TLS
    tetap memakai nama host. Ini menutup celah DNS rebinding (nama host
    di-resolve ulang ke IP internal di antara pengecekan dan permintaan).
    """
    def _new_conn(self):
        try:
            infos = socket.getaddrinfo(self._dns_host, self.port, type=socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise NewConnectionError(self, f'Gagal me-resolve {self.host}: {e}') from e
        ips = [info[4][0] for info in infos]
        if not ips or not all(_is_public_ip(ip) for ip in ips):
            raise NewConnectionError(self, f'{self.host} mengarah ke alamat non-publik')
        # Jangan ubah self._dns_host: urllib3 memakainya juga sebagai self.host (SNI/sertifikat)
        try:
            return create_connection((ips[0], self.port), self.timeout,
                                     source_address=self.source_address, socket_options=self.socket_options)
        except socket.timeout as e:
            raise ConnectTimeoutError(self, f'Koneksi ke {self.host} timeout') from e
        except OSError as e:
            raise NewConnectionError(self, f'Gagal menyambung ke {self.host}: {e}') from e


class _PublicHTTPConnection(_PublicOnlyMixin, HTTPConnection):
    pass


class _PublicHTTPSConnection(_PublicOnlyMixin, HTTPSConnection):
    pass


class _PublicHTTPPool(HTTPConnectionPool):
    ConnectionCls = _PublicHTTPConnection


class _PublicHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _PublicHTTPSConnection


class _PublicOnlyAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {'http': _PublicHTTPPool, 'https': _PublicHTTPSPool}


class FetchError(Exception):
    """Halaman sumber gagal dibuka; `key` & `params` = pesan i18n untuk pengguna."""
    def __init__(self, key, *params):
        super().__init__(key)
        self.key, self.params = key, params


def _open_public(session, url, timeout):
    """Buka URL dengan mengikuti redirect sendiri: setiap lompatan dicek ulang harus publik."""
    for _ in range(MAX_REDIRECTS + 1):
        if not _is_public_url(url):
            raise FetchError('verify-bad-url')
        try:
            r = session.get(url, timeout=timeout, allow_redirects=False, stream=True)
        except requests.RequestException as e:
            raise FetchError('verify-unreachable') from e
        if not r.is_redirect:
            return r, url
        r.close()
        url = urljoin(url, r.headers['Location'])
    raise FetchError('verify-too-many-redirects')


def _public_session():
    session = requests.Session()
    session.trust_env = False  # jangan lewat proxy dari environment (bisa mengarah ke jaringan internal)
    session.headers['User-Agent'] = FETCH_UA
    adapter = _PublicOnlyAdapter(max_retries=0)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session


def _read_capped(r, timeout):
    """Isi respons paling banyak MAX_PAGE_BYTES, dengan batas waktu total (bukan per potongan)."""
    deadline = time.monotonic() + timeout
    chunks, size = [], 0
    try:
        for chunk in r.iter_content(64 * 1024):
            chunks.append(chunk)
            size += len(chunk)
            if size >= MAX_PAGE_BYTES or time.monotonic() > deadline:
                break
    except requests.RequestException as e:
        raise FetchError('verify-unreachable') from e
    return b''.join(chunks)[:MAX_PAGE_BYTES]


def _decode(body, ctype):
    """Teks halaman: charset dari header, lalu dari <meta>, bawaan UTF-8."""
    m = (re.search(r'charset=["\']?([\w.:-]+)', ctype, re.I)
         or re.search(rb'<meta[^>]+charset=["\']?([\w.:-]+)', body[:4096], re.I))
    charset = m.group(1) if m else 'utf-8'
    if isinstance(charset, bytes):
        charset = charset.decode('ascii', 'ignore')
    try:
        return body.decode(charset, errors='replace')
    except LookupError:
        return body.decode('utf-8', errors='replace')


def fetch_page(url, timeout=20):
    """Unduh halaman sumber dengan aman. Kembalikan (url_akhir, content_type, isi_bytes).

    Gagal → FetchError. Isi tidak dibaca bila jenis kontennya bukan teks/HTML.
    """
    session = _public_session()
    try:
        r, final_url = _open_public(session, url, timeout)
        with r:
            if r.status_code >= 400:
                raise FetchError('verify-http-error', r.status_code)
            ctype = r.headers.get('Content-Type', '')
            body = _read_capped(r, timeout) if ('html' in ctype or 'text' in ctype) else b''
        return final_url, ctype, body
    finally:
        session.close()


def resolve_url(url):
    """Ikuti redirect (mis. tautan grounding Gemini) dan kembalikan URL akhir."""
    session = _public_session()
    try:
        r, final_url = _open_public(session, url, 15)
        r.close()
        return final_url
    except FetchError:
        return url
    finally:
        session.close()


def _page_title(raw):
    m = re.search(r'(?is)<title[^>]*>(.*?)</title>', raw)
    return re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip()[:400] if m else ''


def _value_variants(datatype, value):
    """Bentuk-bentuk penulisan nilai yang mungkin muncul di halaman sumber."""
    v = value.strip()
    if datatype == 'quantity':
        try:
            num = float(v)
        except ValueError:
            return [v]
        if num.is_integer():
            n = int(num)
            plain = str(n)
            dotted = f'{n:,}'.replace(',', '.')
            return list({plain, dotted, f'{n:,}', dotted.replace('.', ' ')})
        return list({v, v.replace('.', ',')})
    if datatype == 'time':
        return [v.split('-')[0].lstrip('0') or '0']  # minimal tahunnya harus muncul
    if datatype == 'url':
        host = urlparse(v).hostname or v
        return [host.removeprefix('www.')]
    return [_normalize_text(v)]


VERIFICATION_RANK = {
    'terverifikasi': 4, 'nilai_di_halaman': 3, 'nilai_tidak_cocok': 2,
    'gagal_dibuka': 1, 'tidak_terverifikasi': 0,
}


def verify(source_url, quote, datatype, value, lang=None):
    """Periksa kutipan & nilai di halaman sumber.

    Kembalikan dict:
      verification — status:
        terverifikasi     — kutipan ada di halaman dan memuat nilainya
        nilai_tidak_cocok — kutipan ada di halaman tapi nilainya tidak tertulis di kutipan
        nilai_di_halaman  — kutipan tidak persis, tapi nilainya tertulis di halaman
        tidak_terverifikasi — kutipan maupun nilai tidak ditemukan di halaman
        gagal_dibuka      — halaman tidak bisa dibuka/dibaca otomatis
      verify_note — keterangan untuk pengguna
      quote_exact — kutipan tertulis persis di halaman (beda spasi/tanda kutip/huruf
                    besar saja); hanya kutipan seperti ini yang boleh jadi referensi
      page_title  — judul halaman (<title>) dari halaman itu sendiri, bukan dari AI

    lang: bahasa keterangan; wajib diisi bila dipanggil dari thread lain
    (di luar konteks permintaan Flask).
    """
    def result(status, key, *params, quote_exact=False, page_title=''):
        return {'verification': status, 'verify_note': msg(key, *params, lang=lang),
                'quote_exact': quote_exact, 'page_title': page_title}

    if not source_url:
        return result('gagal_dibuka', 'verify-no-url')
    try:
        _, ctype, body = fetch_page(source_url)
    except FetchError as e:
        return result('gagal_dibuka', e.key, *e.params)

    if 'pdf' in ctype:
        return result('gagal_dibuka', 'verify-pdf')
    if 'html' not in ctype and 'text' not in ctype:
        return result('gagal_dibuka', 'verify-unsupported', ctype or msg('unknown', lang=lang))

    raw = _decode(body, ctype)
    title = _page_title(raw)
    page = _normalize_text(_html_to_text(raw))
    q = _normalize_text(quote)
    variants = [_normalize_text(x) for x in _value_variants(datatype, value)]

    # Kutipan dibandingkan tanpa spasi: membuang tag HTML sering menyisipkan spasi
    # ("Merapi (bahasa" → "merapi ( bahasa") yang tidak ada di kutipan AI.
    page_compact = page.replace(' ', '')
    quote_exact = len(q) >= 15 and q.replace(' ', '') in page_compact
    quote_found = quote_exact
    if not quote_found and len(q) >= 15:
        # Toleransi beda format kecil: ≥70% potongan 5-kata kutipan ada di halaman
        words = q.split()
        shingles = [''.join(words[i:i + 5]) for i in range(max(1, len(words) - 4))]
        hits = sum(1 for sh in shingles if sh in page_compact)
        quote_found = hits / len(shingles) >= 0.7

    value_in_quote = any(v and v in q for v in variants)
    value_in_page = any(v and v in page for v in variants)

    found = {'quote_exact': quote_exact, 'page_title': title}
    if quote_found and value_in_quote:
        return result('terverifikasi', 'verify-ok', **found)
    if quote_found:
        return result('nilai_tidak_cocok', 'verify-value-mismatch', **found)
    if value_in_page:
        return result('nilai_di_halaman', 'verify-value-on-page', **found)
    return result('tidak_terverifikasi', 'verify-unverified', **found)
