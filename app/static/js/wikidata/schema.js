'use strict';

// Skema atribut per kategori (ATRIBUT, SKEMA_KATEGORI).

// ---------------------------------------------------------------------------
// SKEMA ATRIBUT PER KATEGORI
// Setiap kategori punya daftar atribut tetap. Atribut yang kosong tetap
// ditampilkan dan bisa diisi langsung. Untuk menambah atribut, cukup tambah
// entri di ATRIBUT lalu masukkan ke daftar kategori di SKEMA_KATEGORI.
//
// label/suffix/unitLabel diterjemahkan lewat i18n (attr-<kunci>, unit-*).
// type: 'item' | 'quantity' | 'time' | 'url' | 'string'
// unit: QID satuan default saat menambah nilai (quantity)
// unitLabel: teks satuan yang ditampilkan bila nilai memakai satuan default
// suffix: teks tambahan setelah angka (quantity tanpa satuan)
// ---------------------------------------------------------------------------

const Q_METER = 'Q11573';
const Q_KM2   = 'Q712226';

const ATRIBUT = {
  lokasi:          { pid: 'P131',  label: msg('attr-lokasi'),               type: 'item' },
  lokasiObjek:     { pid: 'P276',  label: msg('attr-lokasi-objek'),         type: 'item' },
  didirikan:       { pid: 'P571',  label: msg('attr-didirikan'),            type: 'time' },
  ditetapkan:      { pid: 'P571',  label: msg('attr-ditetapkan'),           type: 'time' },
  dibuat:          { pid: 'P571',  label: msg('attr-dibuat'),               type: 'time' },
  kapasitas:       { pid: 'P1083', label: msg('attr-kapasitas'),            type: 'quantity', suffix: msg('unit-people') },
  gaya:            { pid: 'P149',  label: msg('attr-gaya'),                 type: 'item' },
  arsitek:         { pid: 'P84',   label: msg('attr-arsitek'),              type: 'item' },
  agama:           { pid: 'P140',  label: msg('attr-agama'),                type: 'item' },
  denominasi:      { pid: 'P140',  label: msg('attr-denominasi'),           type: 'item' },
  warisan:         { pid: 'P1435', label: msg('attr-warisan'),              type: 'item' },
  laman:           { pid: 'P856',  label: msg('attr-laman'),                type: 'url' },
  koleksiJumlah:   { pid: 'P1436', label: msg('attr-koleksi-jumlah'),       type: 'quantity' },
  pengunjung:      { pid: 'P1174', label: msg('attr-pengunjung'),           type: 'quantity', suffix: msg('unit-people') },
  tempatTerbit:    { pid: 'P291',  label: msg('attr-tempat-terbit'),        type: 'item' },
  tanggalTerbit:   { pid: 'P577',  label: msg('attr-tanggal-terbit'),       type: 'time' },
  penerbit:        { pid: 'P123',  label: msg('attr-penerbit'),             type: 'item' },
  bahasa:          { pid: 'P407',  label: msg('attr-bahasa'),               type: 'item' },
  tempatTemu:      { pid: 'P189',  label: msg('attr-tempat-temu'),          type: 'item' },
  tanggalTemu:     { pid: 'P575',  label: msg('attr-tanggal-temu'),         type: 'time' },
  bahan:           { pid: 'P186',  label: msg('attr-bahan'),                type: 'item' },
  koleksi:         { pid: 'P195',  label: msg('attr-koleksi'),              type: 'item' },
  statusGuna:      { pid: 'P5817', label: msg('attr-status-guna'),          type: 'item' },
  aksara:          { pid: 'P282',  label: msg('attr-aksara'),               type: 'item' },
  periode:         { pid: 'P2348', label: msg('attr-periode'),              type: 'item' },
  memperingati:    { pid: 'P547',  label: msg('attr-memperingati'),         type: 'item' },
  pencipta:        { pid: 'P170',  label: msg('attr-pencipta'),             type: 'item' },
  pelukis:         { pid: 'P170',  label: msg('attr-pelukis'),              type: 'item' },
  tinggi:          { pid: 'P2048', label: msg('attr-tinggi'),               type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  jumlahKamar:     { pid: 'P8733', label: msg('attr-jumlah-kamar'),         type: 'quantity' },
  operator:        { pid: 'P137',  label: msg('attr-operator'),             type: 'item' },
  pengelola:       { pid: 'P137',  label: msg('attr-pengelola'),            type: 'item' },
  penghuni:        { pid: 'P466',  label: msg('attr-penghuni'),             type: 'item' },
  penghuniKlub:    { pid: 'P466',  label: msg('attr-penghuni-klub'),        type: 'item' },
  luas:            { pid: 'P2046', label: msg('attr-luas'),                 type: 'quantity', unit: Q_KM2, unitLabel: 'km²' },
  ranjang:         { pid: 'P6801', label: msg('attr-ranjang'),              type: 'quantity' },
  pelajar:         { pid: 'P2196', label: msg('attr-pelajar'),              type: 'quantity', suffix: msg('unit-people') },
  permukaan:       { pid: 'P765',  label: msg('attr-permukaan'),            type: 'item' },
  rektor:          { pid: 'P1037', label: msg('attr-rektor'),               type: 'item' },
  iata:            { pid: 'P238',  label: msg('attr-iata'),                 type: 'string' },
  icao:            { pid: 'P239',  label: msg('attr-icao'),                 type: 'string' },
  ketinggian:      { pid: 'P2044', label: msg('attr-ketinggian'),           type: 'quantity', unit: Q_METER, unitLabel: msg('unit-masl') },
  jalur:           { pid: 'P81',   label: msg('attr-jalur'),                type: 'item' },
  perairan:        { pid: 'P206',  label: msg('attr-perairan'),             type: 'item' },
  perairanSungai:  { pid: 'P206',  label: msg('attr-perairan-sungai'),      type: 'item' },
  iucn:            { pid: 'P814',  label: msg('attr-iucn'),                 type: 'item' },
  kedalaman:       { pid: 'P4511', label: msg('attr-kedalaman'),            type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  panjang:         { pid: 'P2043', label: msg('attr-panjang'),              type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  pegunungan:      { pid: 'P4552', label: msg('attr-pegunungan'),           type: 'item' },
  prominensi:      { pid: 'P2660', label: msg('attr-prominensi'),           type: 'quantity', unit: Q_METER, unitLabel: 'm' },
  bagianDari:      { pid: 'P361',  label: msg('attr-bagian-dari'),          type: 'item' },
  penduduk:        { pid: 'P1082', label: msg('attr-penduduk'),             type: 'quantity', suffix: msg('unit-inhabitants') },
  waktu:           { pid: 'P585',  label: msg('attr-waktu'),                type: 'time' },
  magnitudo:       { pid: 'P2527', label: msg('attr-magnitudo'),            type: 'quantity' },
  korban:          { pid: 'P1120', label: msg('attr-korban'),               type: 'quantity', suffix: msg('unit-inhabitants') },
  penyebab:        { pid: 'P828',  label: msg('attr-penyebab'),             type: 'item' },
  mulai:           { pid: 'P580',  label: msg('attr-mulai'),                type: 'time' },
  berakhir:        { pid: 'P582',  label: msg('attr-berakhir'),             type: 'time' },
  peserta:         { pid: 'P710',  label: msg('attr-peserta'),              type: 'item' },
  latar:           { pid: 'P840',  label: msg('attr-latar'),                type: 'item' },
  penulis:         { pid: 'P50',   label: msg('attr-penulis'),              type: 'item' },
  genre:           { pid: 'P136',  label: msg('attr-genre'),                type: 'item' },
  subjek:          { pid: 'P921',  label: msg('attr-subjek'),               type: 'item' },
  kepalaDaerah:    { pid: 'P6',    label: msg('attr-kepala-daerah'),        type: 'item' },
  tempatLahir:     { pid: 'P19',   label: msg('attr-tempat-lahir'),         type: 'item' },
  tanggalLahir:    { pid: 'P569',  label: msg('attr-tanggal-lahir'),        type: 'time' },
  pekerjaan:       { pid: 'P106',  label: msg('attr-pekerjaan'),            type: 'item' },
  tanggalWafat:    { pid: 'P570',  label: msg('attr-tanggal-wafat'),        type: 'time' },
  berasalDari:     { pid: 'P2341', label: msg('attr-berasal-dari'),         type: 'item' },
  penutur:         { pid: 'P1098', label: msg('attr-penutur'),              type: 'quantity', suffix: msg('unit-people') },
  statusUnesco:    { pid: 'P1999', label: msg('attr-status-unesco'),        type: 'item' },
  negaraAsal:      { pid: 'P495',  label: msg('attr-negara-asal'),          type: 'item' },
  caraBuat:        { pid: 'P2079', label: msg('attr-cara-buat'),            type: 'item' },
  waktuPelaksanaan:{ pid: 'P837',  label: msg('attr-waktu-pelaksanaan'),    type: 'item' },
};

// Kunci = nama klaster (bahasa Indonesia) di KATEGORI_DATA (app/utils/wikidata.py), bukan label terjemahan
const SKEMA_KATEGORI = (A => ({
  // Umum
  'Kabupaten dan kota':          [A.penduduk, A.luas, A.kepalaDaerah, A.didirikan, A.laman],
  'Tempat lahir tokoh':          [A.tempatLahir, A.tanggalLahir, A.pekerjaan, A.tanggalWafat],

  // Budaya
  'Bahasa':                      [A.berasalDari, A.penutur, A.aksara, A.statusUnesco],
  'Budaya rakyat':               [A.lokasiObjek, A.negaraAsal, A.bagianDari],
  'Hidangan':                    [A.lokasiObjek, A.bahan, A.caraBuat, A.negaraAsal],
  'Pakaian':                     [A.lokasiObjek, A.bahan, A.negaraAsal],
  'Ritual dan upacara':          [A.lokasiObjek, A.agama, A.waktuPelaksanaan],
  'Tari dan pertunjukan':        [A.lokasiObjek, A.genre, A.negaraAsal],

  // Tempat ibadah
  'Masjid':                      [A.lokasi, A.didirikan, A.kapasitas, A.gaya, A.arsitek],
  'Gereja & katedral':           [A.lokasi, A.didirikan, A.denominasi, A.kapasitas, A.gaya],
  'Kuil & candi':                [A.lokasi, A.didirikan, A.agama, A.gaya, A.warisan],
  'Vihara & kelenteng':          [A.lokasi, A.didirikan, A.agama, A.kapasitas, A.gaya],

  // Media & museum
  'Media massa':                 [A.tempatTerbit, A.tanggalTerbit, A.penerbit, A.bahasa, A.laman],
  'Museum':                      [A.lokasi, A.didirikan, A.koleksiJumlah, A.pengunjung, A.laman],

  // Peninggalan sejarah
  'Artefak':                     [A.lokasiObjek, A.tempatTemu, A.tanggalTemu, A.bahan, A.koleksi],
  'Benteng dan bunker':          [A.lokasi, A.didirikan, A.statusGuna, A.warisan],
  'Prasasti':                    [A.lokasiObjek, A.tanggalTemu, A.aksara, A.bahasa, A.bahan],
  'Situs arkeologi lainnya':     [A.lokasi, A.periode, A.agama, A.tanggalTemu, A.warisan],
  'Monumen, patung, & memorial': [A.lokasi, A.didirikan, A.memperingati, A.pencipta, A.bahan],
  'Bangunan bersejarah lainnya': [A.lokasi, A.didirikan, A.gaya, A.arsitek, A.warisan],
  'Bangunan secara umum dan struktur arsitektur':
                                 [A.lokasi, A.didirikan, A.gaya, A.arsitek, A.tinggi],

  // Bangunan/tempat
  'Hotel dan resor':             [A.lokasi, A.didirikan, A.jumlahKamar, A.operator, A.laman],
  'Istana':                      [A.lokasi, A.didirikan, A.gaya, A.penghuni, A.warisan],
  'Kebun binatang & tanaman':    [A.lokasi, A.didirikan, A.luas, A.pengelola, A.laman],
  'Objek wisata':                [A.lokasi, A.luas, A.pengelola, A.pengunjung, A.laman],
  'Pasar dan mall':              [A.lokasi, A.didirikan, A.luas, A.pengelola, A.laman],
  'Perpustakaan':                [A.lokasi, A.didirikan, A.koleksiJumlah, A.pengelola, A.laman],
  'Ruang terbuka hijau':         [A.lokasi, A.didirikan, A.luas, A.pengelola],
  'Rumah sakit':                 [A.lokasi, A.didirikan, A.ranjang, A.pengelola, A.laman],
  'Sekolah':                     [A.lokasi, A.didirikan, A.pelajar, A.pengelola, A.laman],
  'Stadion & lapangan olahraga': [A.lokasi, A.didirikan, A.kapasitas, A.penghuniKlub, A.permukaan],
  'Universitas & kampus':        [A.lokasi, A.didirikan, A.pelajar, A.rektor, A.laman],

  // Transportasi
  'Bandar udara':                [A.lokasi, A.iata, A.icao, A.operator, A.ketinggian],
  'Pelabuhan':                   [A.lokasi, A.didirikan, A.operator, A.laman],
  'Stasiun kereta api':          [A.lokasi, A.didirikan, A.jalur, A.operator, A.ketinggian],
  'Terminal bus':                [A.lokasi, A.didirikan, A.operator],

  // Bentang alam
  'Air terjun':                  [A.lokasi, A.tinggi, A.perairan, A.ketinggian],
  'Cagar alam':                  [A.lokasi, A.luas, A.ditetapkan, A.pengelola, A.iucn],
  'Danau & kaldera':             [A.lokasi, A.luas, A.ketinggian, A.kedalaman],
  'Gua':                         [A.lokasi, A.panjang, A.ketinggian],
  'Gunung':                      [A.lokasi, A.ketinggian, A.pegunungan, A.prominensi],
  'Pantai':                      [A.lokasi, A.panjang, A.perairan, A.pengelola],
  'Pulau':                       [A.lokasi, A.luas, A.bagianDari, A.penduduk],
  'Waduk, bendungan, & embung':  [A.lokasi, A.didirikan, A.perairanSungai, A.tinggi, A.luas],

  // Peristiwa
  'Gempa bumi dan tsunami':      [A.lokasiObjek, A.waktu, A.magnitudo, A.korban, A.kedalaman],
  'Bencana lainnya':             [A.lokasiObjek, A.waktu, A.penyebab, A.korban],
  'Perang & konflik':            [A.lokasiObjek, A.mulai, A.berakhir, A.peserta, A.korban],
  'Peristiwa lainnya':           [A.lokasiObjek, A.waktu, A.bagianDari, A.peserta],

  // Karya & literatur
  'Latar karya sastra':          [A.latar, A.tanggalTerbit, A.penulis, A.bahasa, A.genre],
  'Lukisan':                     [A.lokasiObjek, A.dibuat, A.pelukis, A.koleksi, A.bahan],
  'Lontar':                      [A.lokasiObjek, A.bahasa, A.aksara, A.koleksi, A.subjek],
  'Naskah':                      [A.lokasiObjek, A.penulis, A.bahasa, A.aksara, A.koleksi],
  'Publikasi':                   [A.tempatTerbit, A.tanggalTerbit, A.penulis, A.penerbit, A.bahasa],
}))(ATRIBUT);

// Dipakai untuk "Semua Jenis Objek", Q-ID sendiri, dan kategori yang belum punya skema
const SKEMA_DEFAULT = [ATRIBUT.lokasi, ATRIBUT.didirikan];

function skemaKategori(klasterNama) {
  return SKEMA_KATEGORI[klasterNama] || SKEMA_DEFAULT;
}
