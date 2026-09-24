# WikiJelajah

Aplikasi web untuk menjelajahi tempat-tempat di Indonesia berdasarkan data Wikidata. Dilengkapi peta interaktif, pencarian berdasarkan kategori dan wilayah, serta kemampuan mengedit data langsung ke Wikidata via akun Wikipedia.

## Prasyarat

- Python 3.10+
- Akun Wikimedia untuk OAuth (login dan edit data)

## Instalasi

**1. Clone repo**
```bash
git clone https://github.com/rahmatdenas/wikijelajah.git
cd wikijelajah
```

**2. Buat virtual environment**
```bash
python -m venv .venv
source .venv/bin/activate        # Mac/Linux
.venv\Scripts\activate           # Windows
```

**3. Install dependensi**
```bash
pip install -r requirements.txt
```

**4. Konfigurasi environment**
```bash
cp .env.example .env
```
Buka `.env` lalu isi:

| Variabel | Keterangan |
|---|---|
| `SECRET_KEY` | String acak panjang untuk keamanan sesi Flask |
| `WIKIMEDIA_CLIENT_ID` | Client ID dari Wikimedia OAuth |
| `WIKIMEDIA_CLIENT_SECRET` | Client Secret dari Wikimedia OAuth |

Untuk mendapatkan `CLIENT_ID` dan `CLIENT_SECRET`, daftarkan OAuth consumer di:
https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration

Saat pendaftaran, gunakan callback URL: `http://localhost:5001/auth/callback`

**5. Jalankan server**
```bash
flask run --port 5001
```

Buka browser di `http://localhost:5001`

## Fitur

- Pencarian tempat berdasarkan kategori (museum, masjid, rumah sakit, dll) dan wilayah
- Peta interaktif dengan marker cluster
- Detail item: deskripsi, foto, koordinat, tautan Wikipedia/Wikidata
- Edit label, deskripsi, dan properti langsung ke Wikidata (perlu login)
- Upload foto ke Wikimedia Commons
- Cache hasil pencarian di browser (sessionStorage)
