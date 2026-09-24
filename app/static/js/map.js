'use strict';

/* ==========================================================================
   map.js — Lapisan peta Leaflet. Tidak tahu soal state app atau DOM panel.
   ========================================================================== */

const MAP_ICON = L.divIcon({
  className: '',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -13 412 538" width="28" height="38">
    <ellipse cx="192" cy="510" rx="60" ry="15" fill="rgba(0,0,0,0.35)"/>
    <path fill="var(--color-primary,#7b0d0c)" fill-rule="evenodd"
      d="M172.3 501.7C27 291 0 269.4 0 192 0 86 86 0 192 0s192 86 192 192c0 77.4-27 99-172.3 309.7-9.5 13.8-29.9 13.8-39.5 0z
         M192,132 a60,60 0 1,0 0,120 a60,60 0 1,0 0,-120z"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 37],
  popupAnchor: [0, -36],
});

let _map = null;
let _cluster = null;
let _shapeLayer = null;
let _flyToSeq = 0;

/**
 * @param {function(qid: string)} onMarkerClick - dipanggil saat popup terbuka
 */
function mapInit(onMarkerClick) {
  _map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    zoomDelta: 2,
    zoomSnap: 2,
  });

  _map.fitBounds([[-11, 141], [6, 95]]);

  const cartoTiles = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png?key=cb1_2xq9_1_82a33e4057c84236e108e347',
    { attribution: 'Peta © <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM contributors</a>, <a href="https://carto.com/" target="_blank">CARTO</a>', maxZoom: 18 }
  ).addTo(_map);

  const osmTiles = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: 'Peta © <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM contributors</a>', maxZoom: 18 }
  );

  L.control.layers(
    { 'CARTO Voyager': cartoTiles, 'OpenStreetMap': osmTiles },
    null,
    { position: 'topright' }
  ).addTo(_map);

  L.control.attribution({ position: 'bottomleft' }).addTo(_map);
  L.control.zoom({ position: 'bottomright' }).addTo(_map);

  // GPS locate
  if (L.control.locate) {
    L.control.locate({
      position: 'bottomright',
      showCompass: false,
      showPopup: false,
      strings: { title: 'Lokasi saya' },
      icon: 'icon-gps',
    }).addTo(_map);
  }

  // "Powered by Wikidata" logo
  const logo = L.control({ position: 'bottomleft' });
  logo.onAdd = () => {
    const el = L.DomUtil.create('div', 'powered-by');
    el.innerHTML = `<img src="/static/img/powered_by_wikidata.png" alt="Powered by Wikidata">`;
    return el;
  };
  logo.addTo(_map);

  // Cluster
  _cluster = L.markerClusterGroup({
    maxClusterRadius: zoom => zoom <= 15 ? 50 : zoom === 16 ? 35 : zoom === 17 ? 20 : 10,
    zoomToBoundsOnClick: false,
    spiderfyOnMaxZoom: false,
  }).addTo(_map);

  _cluster.on('clusterclick', ev => {
    const c = ev.layer;
    const bounds = c.getBounds();
    const isSamePoint = bounds.getSouthWest().equals(bounds.getNorthEast());
    if (_map.getZoom() >= 18 || isSamePoint) {
      c.getChildCount() > 60
        ? appShowDialog(`Terdapat <b>${c.getChildCount()} item</b> di satu titik. Persempit wilayah pencarian.`, 'alert', 'Titik Padat')
        : c.spiderfy();
    } else {
      _map.fitBounds(bounds);
    }
  });

  _map.on('popupopen', ev => {
    const qid = ev.popup._qid;
    if (qid) onMarkerClick(qid);
  });

  return _map;
}

function mapClear() {
  _cluster.clearLayers();
  if (_shapeLayer) {
    _map.removeLayer(_shapeLayer);
    _shapeLayer = null;
  }
}

function mapBuildMarker(record) {
  if (!record.lat || !record.lon) return null;
  const marker = L.marker([record.lat, record.lon], { icon: MAP_ICON });
  const popup  = marker.bindPopup(record.title || record.id, {
    closeButton: true,
    maxWidth: 260,
    className: 'wj-popup',
  }).getPopup();
  popup._qid    = record.id;
  record.marker = marker;
  record.popup  = popup;
  return marker;
}

function mapAddMarkers(markers) {
  if (markers.length) _cluster.addLayers(markers);
}

function mapFlyTo(record) {
  if (!record?.marker) return;
  const seq = ++_flyToSeq;
  _cluster.zoomToShowLayer(record.marker, () => {
    if (seq !== _flyToSeq) return; // dibatalkan oleh mapFlyTo yang lebih baru
    if (!record.popup?.isOpen()) record.marker.openPopup();
  });
}

function mapFitAll() {
  if (_cluster.getLayers().length) {
    _map.flyToBounds(_cluster.getBounds(), { duration: 0.5, maxZoom: 12 });
  }
}

function mapShowShape(geojson) {
  if (_shapeLayer) _map.removeLayer(_shapeLayer);
  if (!geojson) { _shapeLayer = null; return; }
  _shapeLayer = L.geoJSON(geojson, {
    style: { color: 'var(--color-primary,#7b0d0c)', weight: 2.5, fillOpacity: 0.08 },
  }).addTo(_map);
}
