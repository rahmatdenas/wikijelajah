"""Pembentuk nilai (datavalue) Wikidata dari input pengguna.

Dipakai oleh endpoint tambah klaim manual dan persetujuan kandidat Perkaya Data.
datatype yang didukung: item | quantity | time | url | string
"""
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation

DATATYPES = ('item', 'quantity', 'time', 'url', 'string')
CALENDAR_GREGORIAN = 'http://www.wikidata.org/entity/Q1985727'


class DataValueError(ValueError):
    """Nilai tidak valid; pesannya aman ditampilkan ke pengguna."""


def parse_time(val):
    """'1945', '1945-08', atau '1945-08-17' → datavalue time Wikidata, atau None jika tidak valid."""
    m = re.fullmatch(r'(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?', val)
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2) or 0)
    day = int(m.group(3) or 0)
    if not (1 <= year <= 2100):
        return None
    try:
        if day:
            date(year, month, day)
        elif month and not 1 <= month <= 12:
            return None
    except ValueError:
        return None
    precision = 11 if day else 10 if month else 9
    return {
        'time': f'+{year:04d}-{month:02d}-{day:02d}T00:00:00Z',
        'timezone': 0, 'before': 0, 'after': 0,
        'precision': precision,
        'calendarmodel': CALENDAR_GREGORIAN,
    }


def today_time_value():
    """Datavalue time untuk hari ini (dipakai sebagai 'tanggal diakses' P813)."""
    return {
        'time': f'+{date.today().isoformat()}T00:00:00Z',
        'timezone': 0, 'before': 0, 'after': 0,
        'precision': 11,
        'calendarmodel': CALENDAR_GREGORIAN,
    }


def build_value(datatype, val, unit_qid=''):
    """Kembalikan string JSON untuk parameter `value` wbcreateclaim.

    Raise DataValueError bila nilai tidak valid untuk datatype tersebut.
    """
    val = (val or '').strip()
    if not val:
        raise DataValueError('Nilai tidak boleh kosong')

    if datatype == 'item':
        if not re.fullmatch(r'Q\d+', val.upper()):
            raise DataValueError('Nilai harus berupa Q-ID butir Wikidata')
        return json.dumps({'entity-type': 'item', 'numeric-id': int(val[1:])})

    if datatype == 'quantity':
        try:
            num = Decimal(val)
            if not num.is_finite():
                raise InvalidOperation
        except InvalidOperation:
            raise DataValueError('Nilai harus berupa angka') from None
        if unit_qid and not re.fullmatch(r'Q\d+', unit_qid):
            raise DataValueError('Satuan tidak valid')
        unit_url = f'http://www.wikidata.org/entity/{unit_qid}' if unit_qid else '1'
        return json.dumps({'amount': f'{num.normalize():+f}', 'unit': unit_url})

    if datatype == 'url':
        if not re.match(r'^https?://', val):
            raise DataValueError('URL harus diawali https:// atau http://')
        return json.dumps(val)

    if datatype == 'time':
        time_value = parse_time(val)
        if not time_value:
            raise DataValueError('Tanggal tidak valid (format TTTT, TTTT-BB, atau TTTT-BB-HH; tahun 1–2100)')
        return json.dumps(time_value)

    if datatype == 'string':
        if len(val) > 400:
            raise DataValueError('Teks terlalu panjang (maks. 400 karakter)')
        return json.dumps(val)

    raise DataValueError(f'Tipe data "{datatype}" belum didukung')
