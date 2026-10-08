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
import unicodedata
from urllib.parse import urlparse

import requests

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
- note: one short sentence in Indonesian (e.g. why not found, why sources disagree, or a caveat)."""

VALUE_FORMAT = {
    'quantity': 'a plain number in {unit}, dot as decimal separator, no thousands separator (e.g. 2157 or 3.5)',
    'time': 'a date as YYYY, YYYY-MM or YYYY-MM-DD — only as precise as the source states',
    'item': 'the name of the entity (person, place, organisation or concept) exactly as written in the source',
    'url': 'the full URL of the official website, starting with https:// or http://',
    'string': 'the exact text/code as written in the source',
}


UNIT_NAMES = {'mdpl': 'metres above sea level', 'm': 'metres', 'km²': 'square kilometres'}


class AISearchError(Exception):
    """Kegagalan pencarian AI; pesannya aman ditampilkan ke pengguna."""


# ---------------------------------------------------------------------------
# PROMPT
# ---------------------------------------------------------------------------

def build_prompt(item, attr):
    unit_label = attr.get('unit_label') or ''
    unit = UNIT_NAMES.get(unit_label, unit_label) or 'no unit (a plain count or number)'
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

def search(provider, api_key, model, item, attr):
    """Jalankan pencarian AI. Kembalikan dict hasil (lihat _parse_answer) + 'model' yang dipakai."""
    if not api_key:
        raise AISearchError('API key belum diisi. Buka ⚙ Pengaturan AI.')
    prompt = build_prompt(item, attr)
    model = model or DEFAULT_MODELS[provider]

    if provider == 'claude':
        text, citations = _search_claude(api_key, model, prompt)
    elif provider == 'openai':
        text, citations = _search_openai(api_key, model, prompt)
    elif provider == 'gemini':
        text, citations = _search_gemini(api_key, model, prompt)
    elif provider == 'groq':
        text, citations, model = _search_groq(api_key, model, prompt)
    else:
        raise AISearchError(f'Penyedia AI "{provider}" tidak dikenal')

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


def _search_claude(api_key, model, prompt):
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=AI_TIMEOUT)
    older = 'haiku' in model
    params = {
        'model': model,
        'max_tokens': 16000,
        'system': SYSTEM_PROMPT,
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
        raise AISearchError('API key Claude tidak valid') from None
    except anthropic.PermissionDeniedError:
        raise AISearchError('API key Claude tidak punya akses ke model/fitur ini') from None
    except anthropic.RateLimitError:
        raise AISearchError('Batas pemakaian Claude tercapai, coba lagi sebentar') from None
    except anthropic.BadRequestError as e:
        raise AISearchError(f'Permintaan ke Claude ditolak: {e.message}') from None
    except anthropic.APIStatusError as e:
        raise AISearchError(f'Claude error {e.status_code}, coba lagi') from None
    except anthropic.APIConnectionError:
        raise AISearchError('Tidak bisa terhubung ke Claude') from None

    if resp.stop_reason == 'refusal':
        raise AISearchError('Claude menolak permintaan ini')

    text_parts, citations = [], []
    for block in resp.content:
        if block.type != 'text':
            continue
        text_parts.append(block.text)
        for c in getattr(block, 'citations', None) or []:
            if getattr(c, 'type', '') == 'web_search_result_location':
                citations.append({'url': c.url, 'title': c.title or '', 'quote': c.cited_text or ''})
    return ''.join(text_parts), citations


def _search_openai(api_key, model, prompt):
    import openai

    client = openai.OpenAI(api_key=api_key, timeout=AI_TIMEOUT)
    try:
        resp = client.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=prompt,
            tools=[{'type': 'web_search'}],
        )
    except openai.AuthenticationError:
        raise AISearchError('API key OpenAI tidak valid') from None
    except openai.RateLimitError:
        raise AISearchError('Batas pemakaian OpenAI tercapai, coba lagi sebentar') from None
    except openai.APIStatusError as e:
        raise AISearchError(f'OpenAI error {e.status_code}: {e.message}') from None
    except openai.APIConnectionError:
        raise AISearchError('Tidak bisa terhubung ke OpenAI') from None

    citations = []
    for out in resp.output or []:
        if getattr(out, 'type', '') != 'message':
            continue
        for part in out.content or []:
            for a in getattr(part, 'annotations', None) or []:
                if getattr(a, 'type', '') == 'url_citation':
                    citations.append({'url': a.url, 'title': getattr(a, 'title', '') or ''})
    return resp.output_text or '', citations


def _search_gemini(api_key, model, prompt):
    from google import genai
    from google.genai import errors, types

    client = genai.Client(api_key=api_key)
    try:
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
    except errors.ClientError as e:
        if e.code in (401, 403) or 'API key' in str(e):
            raise AISearchError('API key Gemini tidak valid') from None
        if e.code == 429:
            raise AISearchError('Batas pemakaian Gemini tercapai, coba lagi sebentar') from None
        raise AISearchError(f'Permintaan ke Gemini ditolak: {e.message}') from None
    except errors.APIError as e:
        raise AISearchError(f'Gemini error {e.code}, coba lagi') from None

    citations = []
    cand = (resp.candidates or [None])[0]
    meta = getattr(cand, 'grounding_metadata', None)
    for chunk in getattr(meta, 'grounding_chunks', None) or []:
        if chunk.web and chunk.web.uri:
            citations.append({'url': chunk.web.uri, 'title': chunk.web.title or ''})
    return resp.text or '', citations


def _search_groq(api_key, model, prompt):
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
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': prompt},
                ],
                tools=[{'type': 'browser_search'}],
                tool_choice='required',
                reasoning_effort='medium',
                max_completion_tokens=8192,
            )
        except (groq.AuthenticationError, groq.PermissionDeniedError):
            raise AISearchError('API key Groq tidak valid atau tidak punya akses') from None
        except groq.RateLimitError:
            failures.append(f'{m}: batas pemakaian tercapai')
            continue
        except (groq.NotFoundError, groq.BadRequestError) as e:
            # Model tidak ada / sudah dihentikan / tidak mendukung browser_search
            failures.append(f'{m}: {e.message}')
            continue
        except groq.APIStatusError as e:
            failures.append(f'{m}: error {e.status_code}')
            continue
        except groq.APIConnectionError:
            raise AISearchError('Tidak bisa terhubung ke Groq') from None

        msg = resp.choices[0].message
        if not (msg.content or '').strip():
            failures.append(f'{m}: jawaban kosong')
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

    raise AISearchError('Semua model Groq gagal — ' + '; '.join(failures))


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
        raise AISearchError('Jawaban AI tidak bisa dibaca (bukan JSON)')

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


def _is_public_url(url):
    """Tolak URL ke jaringan lokal/privat (server tidak boleh disuruh membuka alamat internal)."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def resolve_url(url):
    """Ikuti redirect (mis. tautan grounding Gemini) dan kembalikan URL akhir."""
    if not _is_public_url(url):
        return url
    try:
        r = requests.get(url, headers={'User-Agent': FETCH_UA}, timeout=15,
                         allow_redirects=True, stream=True)
        r.close()
        return r.url
    except requests.RequestException:
        return url


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


def verify(source_url, quote, datatype, value):
    """Periksa kutipan & nilai di halaman sumber.

    Kembalikan (status, keterangan). status:
      terverifikasi     — kutipan ada di halaman dan memuat nilainya
      nilai_tidak_cocok — kutipan ada di halaman tapi nilainya tidak tertulis di kutipan
      nilai_di_halaman  — kutipan tidak persis, tapi nilainya tertulis di halaman
      tidak_terverifikasi — kutipan maupun nilai tidak ditemukan di halaman
      gagal_dibuka      — halaman tidak bisa dibuka/dibaca otomatis
    """
    if not source_url:
        return 'gagal_dibuka', 'AI tidak menyertakan URL sumber.'
    if not _is_public_url(source_url):
        return 'gagal_dibuka', 'URL sumber tidak valid.'
    try:
        r = requests.get(source_url, headers={'User-Agent': FETCH_UA}, timeout=20)
    except requests.RequestException:
        return 'gagal_dibuka', 'Halaman sumber tidak bisa dibuka (timeout/koneksi).'
    if r.status_code >= 400:
        return 'gagal_dibuka', f'Halaman sumber merespons HTTP {r.status_code}.'

    ctype = r.headers.get('Content-Type', '')
    if 'pdf' in ctype:
        return 'gagal_dibuka', 'Sumber berupa PDF; periksa manual.'
    if 'html' not in ctype and 'text' not in ctype:
        return 'gagal_dibuka', f'Jenis konten tidak didukung ({ctype or "tidak diketahui"}).'

    page = _normalize_text(_html_to_text(r.text))
    q = _normalize_text(quote)
    variants = [_normalize_text(x) for x in _value_variants(datatype, value)]

    # Kutipan dibandingkan tanpa spasi: membuang tag HTML sering menyisipkan spasi
    # ("Merapi (bahasa" → "merapi ( bahasa") yang tidak ada di kutipan AI.
    page_compact = page.replace(' ', '')
    quote_found = len(q) >= 15 and q.replace(' ', '') in page_compact
    if not quote_found and len(q) >= 15:
        # Toleransi beda format kecil: ≥70% potongan 5-kata kutipan ada di halaman
        words = q.split()
        shingles = [''.join(words[i:i + 5]) for i in range(max(1, len(words) - 4))]
        hits = sum(1 for sh in shingles if sh in page_compact)
        quote_found = hits / len(shingles) >= 0.7

    value_in_quote = any(v and v in q for v in variants)
    value_in_page = any(v and v in page for v in variants)

    if quote_found and value_in_quote:
        return 'terverifikasi', 'Kutipan dan nilainya ditemukan di halaman sumber.'
    if quote_found:
        return 'nilai_tidak_cocok', 'Kutipan ada di halaman, tetapi nilainya tidak tertulis di kutipan.'
    if value_in_page:
        return 'nilai_di_halaman', 'Kutipan tidak persis sama, tetapi nilainya tertulis di halaman.'
    return 'tidak_terverifikasi', 'Kutipan maupun nilainya tidak ditemukan di halaman sumber.'
