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

**5. Jalankan server**
```bash
flask run
```

Buka browser di `http://localhost:5000` (atau port yang ditampilkan di terminal)

## Fitur

- Panduan singkat untuk pengguna baru (tombol **Panduan**, terbuka otomatis pada kunjungan pertama)
- Pencarian tempat berdasarkan kategori (museum, masjid, rumah sakit, dll) dan wilayah dalam dua langkah, dengan pintasan kategori populer
- Halaman Jelajah dan Perkaya Data saling terhubung: wilayah & kategori terakhir terbawa lewat URL
  (`?region=province&province=Q3125978&category=museums`), sehingga hasil pencarian juga bisa dibagikan
- Peta interaktif dengan marker cluster
- Detail item: deskripsi, foto, koordinat, tautan Wikipedia/Wikidata
- Edit label, deskripsi, dan properti langsung ke Wikidata (perlu login)
- Upload foto ke Wikimedia Commons
- Cache hasil pencarian di browser (sessionStorage)
- Antarmuka multibahasa (Indonesia & Inggris), tombol pilih bahasa di bilah atas

## Terjemahan (i18n)

Semua teks antarmuka ada di folder `i18n/` dengan format pesan JSON MediaWiki
(sama dengan [banana-i18n](https://github.com/wikimedia/banana-i18n) yang dipakai di browser):

| File | Isi |
|---|---|
| `i18n/en.json` | Bahasa sumber (untuk [translatewiki.net](https://translatewiki.net)) |
| `i18n/id.json` | Bahasa Indonesia (bahasa bawaan aplikasi) |
| `i18n/qqq.json` | Penjelasan setiap pesan untuk penerjemah |

- Di template Jinja: `{{ msg('kunci', param1, …) }}`; di JavaScript: `msg('kunci', …)`.
  Pesan memakai `$1`, `{{PLURAL:$1|satu|banyak}}`, dan `{{formatnum:$1}}`.
- Menambah pesan baru: tambahkan kuncinya ke `en.json`, `id.json`, dan `qqq.json` sekaligus.
- Bahasa baru cukup dengan menambah file `i18n/<kode>.json` — otomatis muncul di tombol bahasa.
  Pesan yang belum diterjemahkan jatuh ke bahasa Inggris (bahasa daerah Indonesia jatuh ke bahasa Indonesia dulu).
- Bahasa dipilih dari `?uselang=xx`, lalu cookie tombol bahasa, lalu bahasa browser, lalu bahasa Indonesia.
- Data dari Wikidata (label butir, nama provinsi/negara) dan ringkasan Wikipedia ikut bahasa yang dipilih.

## Deploy ke Toolforge

Aplikasi dijalankan dengan [Build Service](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Build_Service) (`Procfile` + gunicorn). Database Perkaya disimpan di `$TOOL_DATA_DIR` sehingga tetap ada antar-deploy.

**Sekali saja (setup awal):**
```bash
ssh <username>@login.toolforge.org
become <nama-tool>

toolforge envvars create FLASK_ENV                 # isi: production
toolforge envvars create SECRET_KEY                # string acak panjang
toolforge envvars create WIKIMEDIA_CLIENT_ID       # dari OAuth 2.0 consumer
toolforge envvars create WIKIMEDIA_CLIENT_SECRET
```
Callback OAuth consumer: `https://<nama-tool>.toolforge.org/oauth/callback`. Jangan isi `WIKIMEDIA_ACCESS_TOKEN` di Toolforge — itu hanya untuk pengembangan lokal.

**Setiap update:**
```bash
toolforge build start https://github.com/rahmatdenas/wikijelajah --ref main
toolforge webservice buildservice start --mount=all   # pertama kali
toolforge webservice restart                          # update berikutnya
toolforge webservice logs                             # bila ada masalah
```

## Lisensi

Dirilis di bawah [Lisensi MIT](LICENSE).
