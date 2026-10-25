# Data statis referensi wilayah dan kategori untuk dropdown UI.
# Dipisah dari template agar template tetap bersih.
import time
from concurrent.futures import ThreadPoolExecutor

import requests

WILAYAH_PROVINSI = [
    ('wd:Q1823', 'Aceh'),
    ('wd:Q3125978', 'Bali'),
    ('wd:Q3540', 'Banten'),
    ('wd:Q1890', 'Bengkulu'),
    ('wd:Q5067', 'Gorontalo'),
    ('wd:Q3630', 'Jakarta'),
    ('wd:Q2051', 'Jambi'),
    ('wd:Q3724', 'Jawa Barat'),
    ('wd:Q3557', 'Jawa Tengah'),
    ('wd:Q3586', 'Jawa Timur'),
    ('wd:Q3916', 'Kalimantan Barat'),
    ('wd:Q3906', 'Kalimantan Selatan'),
    ('wd:Q3891', 'Kalimantan Tengah'),
    ('wd:Q3899', 'Kalimantan Timur'),
    ('wd:Q3903', 'Kalimantan Utara'),
    ('wd:Q1866', 'Kepulauan Bangka Belitung'),
    ('wd:Q2223', 'Kepulauan Riau'),
    ('wd:Q2110', 'Lampung'),
    ('wd:Q5093', 'Maluku'),
    ('wd:Q5094', 'Maluku Utara'),
    ('wd:Q5062', 'Nusa Tenggara Barat'),
    ('wd:Q5061', 'Nusa Tenggara Timur'),
    ('wd:Q5095', 'Papua'),
    ('wd:Q5096', 'Papua Barat'),
    ('wd:Q115253263', 'Papua Barat Daya'),
    ('wd:Q112810104', 'Papua Pegunungan'),
    ('wd:Q61439296', 'Papua Selatan'),
    ('wd:Q12486766', 'Papua Tengah'),
    ('wd:Q2175', 'Riau'),
    ('wd:Q5082', 'Sulawesi Barat'),
    ('wd:Q5078', 'Sulawesi Selatan'),
    ('wd:Q5065', 'Sulawesi Tengah'),
    ('wd:Q5075', 'Sulawesi Tenggara'),
    ('wd:Q5068', 'Sulawesi Utara'),
    ('wd:Q2772', 'Sumatera Barat'),
    ('wd:Q2271', 'Sumatera Selatan'),
    ('wd:Q2140', 'Sumatera Utara'),
    ('wd:Q3741', 'Yogyakarta'),
]

# Negara luar negeri dikelompokkan per benua
WILAYAH_LUAR_NEGERI = {
    'eropa': [
        ('wd:Q222', 'Albania'), ('wd:Q228', 'Andorra'), ('wd:Q40', 'Austria'),
        ('wd:Q184', 'Belarus'), ('wd:Q55', 'Belanda'), ('wd:Q31', 'Belgia'),
        ('wd:Q225', 'Bosnia dan Herzegovina'), ('wd:Q145', 'Britania Raya'),
        ('wd:Q219', 'Bulgaria'), ('wd:Q213', 'Ceko'), ('wd:Q35', 'Denmark'),
        ('wd:Q191', 'Estonia'), ('wd:Q33', 'Finlandia'), ('wd:Q28', 'Hungaria'),
        ('wd:Q189', 'Islandia'), ('wd:Q38', 'Italia'), ('wd:Q183', 'Jerman'),
        ('wd:Q224', 'Kroasia'), ('wd:Q211', 'Latvia'), ('wd:Q347', 'Liechtenstein'),
        ('wd:Q37', 'Lituania'), ('wd:Q32', 'Luksemburg'), ('wd:Q221', 'Makedonia Utara'),
        ('wd:Q233', 'Malta'), ('wd:Q217', 'Moldova'), ('wd:Q235', 'Monako'),
        ('wd:Q236', 'Montenegro'), ('wd:Q20', 'Norwegia'), ('wd:Q36', 'Polandia'),
        ('wd:Q45', 'Portugal'), ('wd:Q142', 'Prancis'), ('wd:Q27', 'Republik Irlandia'),
        ('wd:Q218', 'Rumania'), ('wd:Q159', 'Rusia'), ('wd:Q238', 'San Marino'),
        ('wd:Q403', 'Serbia'), ('wd:Q229', 'Siprus'), ('wd:Q214', 'Slowakia'),
        ('wd:Q215', 'Slovenia'), ('wd:Q29', 'Spanyol'), ('wd:Q34', 'Swedia'),
        ('wd:Q39', 'Swiss'), ('wd:Q43', 'Turki'), ('wd:Q212', 'Ukraina'),
        ('wd:Q237', 'Vatikan'), ('wd:Q41', 'Yunani'),
    ],
    'asia': [
        ('wd:Q889', 'Afganistan'), ('wd:Q851', 'Arab Saudi'), ('wd:Q399', 'Armenia'),
        ('wd:Q227', 'Azerbaijan'), ('wd:Q398', 'Bahrain'), ('wd:Q902', 'Bangladesh'),
        ('wd:Q917', 'Bhutan'), ('wd:Q921', 'Brunei'), ('wd:Q928', 'Filipina'),
        ('wd:Q230', 'Georgia'), ('wd:Q668', 'India'), ('wd:Q252', 'Indonesia'),
        ('wd:Q796', 'Irak'), ('wd:Q794', 'Iran'), ('wd:Q801', 'Israel'),
        ('wd:Q17', 'Jepang'), ('wd:Q424', 'Kamboja'), ('wd:Q232', 'Kazakhstan'),
        ('wd:Q813', 'Kirgizstan'), ('wd:Q884', 'Korea Selatan'), ('wd:Q423', 'Korea Utara'),
        ('wd:Q817', 'Kuwait'), ('wd:Q819', 'Laos'), ('wd:Q822', 'Lebanon'),
        ('wd:Q826', 'Maladewa'), ('wd:Q833', 'Malaysia'), ('wd:Q711', 'Mongolia'),
        ('wd:Q836', 'Myanmar'), ('wd:Q837', 'Nepal'), ('wd:Q842', 'Oman'),
        ('wd:Q843', 'Pakistan'), ('wd:Q846', 'Qatar'), ('wd:Q334', 'Singapura'),
        ('wd:Q854', 'Sri Lanka'), ('wd:Q858', 'Suriah'), ('wd:Q863', 'Tajikistan'),
        ('wd:Q869', 'Thailand'), ('wd:Q574', 'Timor Leste'), ('wd:Q148', 'Tiongkok'),
        ('wd:Q874', 'Turkmenistan'), ('wd:Q878', 'Uni Emirat Arab'),
        ('wd:Q265', 'Uzbekistan'), ('wd:Q881', 'Vietnam'), ('wd:Q805', 'Yaman'),
        ('wd:Q810', 'Yordania'),
    ],
    'afrika': [
        ('wd:Q258', 'Afrika Selatan'), ('wd:Q262', 'Aljazair'), ('wd:Q916', 'Angola'),
        ('wd:Q962', 'Benin'), ('wd:Q963', 'Botswana'), ('wd:Q965', 'Burkina Faso'),
        ('wd:Q967', 'Burundi'), ('wd:Q657', 'Chad'), ('wd:Q986', 'Eritrea'),
        ('wd:Q1050', 'Eswatini'), ('wd:Q115', 'Etiopia'), ('wd:Q1000', 'Gabon'),
        ('wd:Q1005', 'Gambia'), ('wd:Q117', 'Ghana'), ('wd:Q1006', 'Guinea'),
        ('wd:Q983', 'Guinea Khatulistiwa'), ('wd:Q1007', 'Guinea-Bissau'),
        ('wd:Q977', 'Jibuti'), ('wd:Q1009', 'Kamerun'), ('wd:Q114', 'Kenya'),
        ('wd:Q970', 'Komoro'), ('wd:Q1013', 'Lesotho'), ('wd:Q1014', 'Liberia'),
        ('wd:Q1016', 'Libya'), ('wd:Q1019', 'Madagaskar'), ('wd:Q1020', 'Malawi'),
        ('wd:Q912', 'Mali'), ('wd:Q1028', 'Maroko'), ('wd:Q1025', 'Mauritania'),
        ('wd:Q1027', 'Mauritius'), ('wd:Q79', 'Mesir'), ('wd:Q1029', 'Mozambik'),
        ('wd:Q1030', 'Namibia'), ('wd:Q1032', 'Niger'), ('wd:Q1033', 'Nigeria'),
        ('wd:Q1008', 'Pantai Gading'), ('wd:Q929', 'Republik Afrika Tengah'),
        ('wd:Q974', 'Republik Demokratik Kongo'), ('wd:Q971', 'Republik Kongo'),
        ('wd:Q1037', 'Rwanda'), ('wd:Q6250', 'Sahara Barat'),
        ('wd:Q1039', 'Sao Tome dan Principe'), ('wd:Q1041', 'Senegal'),
        ('wd:Q1042', 'Seychelles'), ('wd:Q1044', 'Sierra Leone'),
        ('wd:Q1045', 'Somalia'), ('wd:Q1049', 'Sudan'), ('wd:Q958', 'Sudan Selatan'),
        ('wd:Q1011', 'Tanjung Verde'), ('wd:Q924', 'Tanzania'), ('wd:Q945', 'Togo'),
        ('wd:Q948', 'Tunisia'), ('wd:Q1036', 'Uganda'), ('wd:Q953', 'Zambia'),
        ('wd:Q954', 'Zimbabwe'),
    ],
    'amerika': [
        ('wd:Q30', 'Amerika Serikat'), ('wd:Q781', 'Antigua dan Barbuda'),
        ('wd:Q414', 'Argentina'), ('wd:Q778', 'Bahama'), ('wd:Q244', 'Barbados'),
        ('wd:Q242', 'Belize'), ('wd:Q750', 'Bolivia'), ('wd:Q155', 'Brasil'),
        ('wd:Q298', 'Chili'), ('wd:Q784', 'Dominika'), ('wd:Q736', 'Ekuador'),
        ('wd:Q792', 'El Salvador'), ('wd:Q769', 'Grenada'), ('wd:Q774', 'Guatemala'),
        ('wd:Q734', 'Guyana'), ('wd:Q790', 'Haiti'), ('wd:Q783', 'Honduras'),
        ('wd:Q766', 'Jamaika'), ('wd:Q16', 'Kanada'), ('wd:Q739', 'Kolombia'),
        ('wd:Q800', 'Kosta Rika'), ('wd:Q241', 'Kuba'), ('wd:Q96', 'Meksiko'),
        ('wd:Q811', 'Nikaragua'), ('wd:Q804', 'Panama'), ('wd:Q733', 'Paraguay'),
        ('wd:Q419', 'Peru'), ('wd:Q786', 'Republik Dominika'),
        ('wd:Q763', 'Saint Kitts dan Nevis'), ('wd:Q760', 'Saint Lucia'),
        ('wd:Q757', 'Saint Vincent dan Grenadines'), ('wd:Q730', 'Suriname'),
        ('wd:Q754', 'Trinidad dan Tobago'), ('wd:Q77', 'Uruguay'),
        ('wd:Q717', 'Venezuela'),
    ],
    'oseania': [
        ('wd:Q408', 'Australia'), ('wd:Q712', 'Fiji'),
        ('wd:Q709', 'Kepulauan Marshall'), ('wd:Q685', 'Kepulauan Solomon'),
        ('wd:Q710', 'Kiribati'), ('wd:Q702', 'Mikronesia'), ('wd:Q697', 'Nauru'),
        ('wd:Q695', 'Palau'), ('wd:Q691', 'Papua Nugini'), ('wd:Q683', 'Samoa'),
        ('wd:Q664', 'Selandia Baru'), ('wd:Q678', 'Tonga'), ('wd:Q672', 'Tuvalu'),
        ('wd:Q686', 'Vanuatu'),
    ],
}

# Kategori data untuk dropdown — setiap butir adalah (value, klaster, kunci_pesan, attr_dict).
# klaster = nama kategori dalam bahasa Indonesia yang dipakai sebagai kunci internal
# (SKEMA_KATEGORI di wikidata.js, kolom kategori di DB Perkaya) — jangan diterjemahkan;
# teks tampilannya diambil dari kunci_pesan (i18n/*.json), begitu pula nama grup.
# attr_dict boleh kosong {} atau berisi data-* attributes tambahan
KATEGORI_DATA = [
    {
        'group': None,
        'items': [
            ('wd:Q3199141 wd:Q3191695', 'Kabupaten dan kota', 'category-regencies-cities', {}),
            ('wd:Q5', 'Tempat lahir tokoh', 'category-birthplaces', {'data-lokasi': 'P19', 'data-tahun': 'P569'}),
        ],
    },
    {
        'group': 'category-group-culture',
        'items': [
            ('wd:Q34770', 'Bahasa', 'category-languages', {'data-kategori': 'alam', 'data-lokasi': 'P2341'}),
            ('wd:Q36192', 'Budaya rakyat', 'category-folk-culture', {'data-kategori': 'alam', 'data-lokasi': 'P276'}),
            ('wd:Q19861951 wd:Q746549 wd:Q2095 wd:Q8195619', 'Hidangan', 'category-dishes', {'data-kategori': 'alam', 'data-lokasi': 'P276'}),
            ('wd:Q11460 wd:Q3172759 wd:Q28823', 'Pakaian', 'category-clothing', {'data-kategori': 'alam', 'data-lokasi': 'P276'}),
            ('wd:Q189819 wd:Q2627975', 'Ritual dan upacara', 'category-rituals', {'data-kategori': 'alam', 'data-lokasi': 'P276'}),
            ('wd:Q107357104 wd:Q184485', 'Tari dan pertunjukan', 'category-dances', {'data-kategori': 'alam', 'data-lokasi': 'P276'}),
        ],
    },
    {
        'group': 'category-group-worship',
        'items': [
            ('wd:Q32815 wd:Q56235676 wd:Q56235673 wd:Q1454820', 'Masjid', 'category-mosques', {}),
            ('wd:Q16970 wd:Q2977 wd:Q56242215', 'Gereja & katedral', 'category-churches', {}),
            ('wd:Q44539 wd:Q2736554 wd:Q842402 wd:Q3124902', 'Kuil & candi', 'category-temples', {}),
            ('wd:Q5393308 wd:Q2680845', 'Vihara & kelenteng', 'category-viharas', {}),
        ],
    },
    {
        'group': None,
        'items': [
            ('wd:Q11032 wd:Q41298', 'Media massa', 'category-mass-media', {'data-lokasi': 'P291', 'data-tahun': 'P577'}),
            ('wd:Q33506', 'Museum', 'category-museums', {}),
        ],
    },
    {
        'group': 'category-group-heritage',
        'items': [
            ('wd:Q220659 wd:Q860861 wd:Q193475', 'Artefak', 'category-artifacts', {'data-lokasi': 'P276'}),
            ('wd:Q57821 wd:Q1785071 wd:Q91122', 'Benteng dan bunker', 'category-forts', {}),
            ('wd:Q178743 wd:Q860861', 'Prasasti', 'category-inscriptions', {}),
            ('wd:Q839954 wd:Q193475', 'Situs arkeologi lainnya', 'category-archaeological-sites', {}),
            ('wd:Q4989906 wd:Q321053 wd:Q179700 wd:Q170980 wd:Q5003624', 'Monumen, patung, & memorial', 'category-monuments', {}),
            ('wd:Q137894610 wd:Q35112127 wd:Q4246737 wd:Q19860854 wd:Q109607', 'Bangunan bersejarah lainnya', 'category-historic-buildings', {}),
            ('wd:Q41176 wd:Q811979', 'Bangunan secara umum dan struktur arsitektur', 'category-buildings', {}),
        ],
    },
    {
        'group': 'category-group-places',
        'items': [
            ('wd:Q27686 wd:Q875157', 'Hotel dan resor', 'category-hotels', {}),
            ('wd:Q16560 wd:Q481289', 'Istana', 'category-palaces', {}),
            ('wd:Q43501 wd:Q167346', 'Kebun binatang & tanaman', 'category-zoos-gardens', {'data-kategori': 'alam'}),
            ('wd:Q570116', 'Objek wisata', 'category-tourist-attractions', {'data-kategori': 'alam', 'data-subclass': '1'}),
            ('wd:Q330284 wd:Q11315', 'Pasar dan mall', 'category-markets', {}),
            ('wd:Q7075', 'Perpustakaan', 'category-libraries', {}),
            ('wd:Q22746 wd:Q174782', 'Ruang terbuka hijau', 'category-parks', {'data-kategori': 'alam'}),
            ('wd:Q16917', 'Rumah sakit', 'category-hospitals', {}),
            ('wd:Q3914 wd:Q9842 wd:Q159334 wd:Q189004', 'Sekolah', 'category-schools', {}),
            ('wd:Q483110 wd:Q2310214', 'Stadion & lapangan olahraga', 'category-stadiums', {}),
            ('wd:Q3918 wd:Q38723', 'Universitas & kampus', 'category-universities', {}),
        ],
    },
    {
        'group': 'category-group-transport',
        'items': [
            ('wd:Q1248784', 'Bandar udara', 'category-airports', {}),
            ('wd:Q44782', 'Pelabuhan', 'category-ports', {}),
            ('wd:Q55488', 'Stasiun kereta api', 'category-train-stations', {}),
            ('wd:Q494829', 'Terminal bus', 'category-bus-terminals', {}),
        ],
    },
    {
        'group': 'category-group-nature',
        'items': [
            ('wd:Q34038', 'Air terjun', 'category-waterfalls', {'data-kategori': 'alam'}),
            ('wd:Q179049', 'Cagar alam', 'category-nature-reserves', {'data-kategori': 'alam'}),
            ('wd:Q23397 wd:Q204324 wd:Q159954', 'Danau & kaldera', 'category-lakes', {'data-kategori': 'alam'}),
            ('wd:Q35509', 'Gua', 'category-caves', {'data-kategori': 'alam'}),
            ('wd:Q8502', 'Gunung', 'category-mountains', {'data-kategori': 'alam'}),
            ('wd:Q40080', 'Pantai', 'category-beaches', {'data-kategori': 'alam'}),
            ('wd:Q23442', 'Pulau', 'category-islands', {'data-kategori': 'alam'}),
            ('wd:Q131681 wd:Q12323', 'Waduk, bendungan, & embung', 'category-reservoirs', {'data-kategori': 'alam'}),
        ],
    },
    {
        'group': 'category-group-events',
        'items': [
            ('wd:Q7944 wd:Q8070', 'Gempa bumi dan tsunami', 'category-earthquakes', {'data-lokasi': 'P276', 'data-tahun': 'P585'}),
            ('wd:Q8065 wd:Q3839081 wd:Q7692360 wd:Q8068', 'Bencana lainnya', 'category-other-disasters', {'data-lokasi': 'P276', 'data-tahun': 'P585'}),
            ('wd:Q1323212 wd:Q3199915 wd:Q198 wd:Q645883 wd:Q831663 wd:Q180684 wd:Q178561 wd:Q1261499', 'Perang & konflik', 'category-wars', {'data-lokasi': 'P276', 'data-tahun': 'P585'}),
            ('wd:Q1190554', 'Peristiwa lainnya', 'category-other-events', {'data-lokasi': 'P276', 'data-tahun': 'P585', 'data-subclass': '1'}),
        ],
    },
    {
        'group': 'category-group-works',
        'items': [
            ('wd:Q7725634', 'Latar karya sastra', 'category-literary-settings', {'data-lokasi': 'P840', 'data-tahun': 'P577'}),
            ('wd:Q3305213', 'Lukisan', 'category-paintings', {'data-lokasi': 'P276', 'data-tahun': 'P571'}),
            ('wd:Q1641020', 'Lontar', 'category-lontars', {'data-lokasi': 'P276'}),
            ('wd:Q87167', 'Naskah', 'category-manuscripts', {'data-lokasi': 'P276'}),
            ('wd:Q47461344 wd:Q7725634', 'Publikasi', 'category-publications', {'data-lokasi': 'P291', 'data-tahun': 'P577'}),
        ],
    },
    {
        'group': None,
        'items': [
            ('apapun', 'Semua Jenis Objek', 'category-any', {}),
            ('custom', 'Ketik Q-ID Sendiri…', 'category-custom', {}),
        ],
    },
]


# ---------------------------------------------------------------------------
# Nama provinsi & negara dalam bahasa antarmuka
# Nama di atas berbahasa Indonesia. Untuk bahasa lain, label diambil dari
# Wikidata (sekali per bahasa, disimpan di memori) sehingga semua bahasa
# translatewiki otomatis mendapat nama wilayah tanpa perlu diterjemahkan manual.
# ---------------------------------------------------------------------------
_LABEL_TTL = 7 * 24 * 3600  # nama wilayah jarang berubah
_LABEL_RETRY = 300       # bila Wikidata gagal, pakai nama Indonesia dan coba lagi 5 menit lagi
_label_cache = {}        # lang → (kedaluwarsa, {QID: label})


def _all_wilayah_qids():
    qids = [v for v, _ in WILAYAH_PROVINSI]
    qids += [v for negara in WILAYAH_LUAR_NEGERI.values() for v, _ in negara]
    return [q.removeprefix('wd:') for q in qids]


def _fetch_labels(lang, api_url, user_agent):
    qids = _all_wilayah_qids()
    chunks = [qids[i:i + 50] for i in range(0, len(qids), 50)]

    def fetch(chunk):
        resp = requests.get(api_url, params={
            'action': 'wbgetentities', 'ids': '|'.join(chunk), 'props': 'labels',
            'languages': lang, 'format': 'json',
        }, headers={'User-Agent': user_agent}, timeout=10)
        resp.raise_for_status()
        return {qid: e['labels'][lang]['value']
                for qid, e in resp.json().get('entities', {}).items() if lang in e.get('labels', {})}

    labels = {}
    with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        for part in pool.map(fetch, chunks):
            labels.update(part)
    return labels


def wilayah_labels(lang, api_url, user_agent):
    """{QID: label} wilayah dalam bahasa `lang`; kosong untuk bahasa Indonesia atau bila gagal."""
    if lang == 'id':
        return {}
    expires, labels = _label_cache.get(lang, (0, {}))
    if time.time() < expires:
        return labels
    try:
        labels, ttl = _fetch_labels(lang, api_url, user_agent), _LABEL_TTL
    except (requests.RequestException, ValueError, KeyError):
        ttl = _LABEL_RETRY
    _label_cache[lang] = (time.time() + ttl, labels)
    return labels


def localized_wilayah(lang, api_url, user_agent):
    """(provinsi, luar_negeri) seperti WILAYAH_*, dengan nama dalam bahasa `lang` dan urut ulang."""
    labels = wilayah_labels(lang, api_url, user_agent)
    if not labels:
        return WILAYAH_PROVINSI, WILAYAH_LUAR_NEGERI

    def relabel(pairs):
        out = [(v, labels.get(v.removeprefix('wd:'), label)) for v, label in pairs]
        return sorted(out, key=lambda p: p[1].casefold())

    return relabel(WILAYAH_PROVINSI), {benua: relabel(n) for benua, n in WILAYAH_LUAR_NEGERI.items()}
