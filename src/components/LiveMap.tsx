import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLng } from '../../shared/types';

// Estilo claro y minimalista (vectorial, nítido en pantallas retina). OpenFreeMap: gratis y sin llave.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const RED = '#D93A32';
const CHOC = '#3E2A25';

function el(className: string, html: string) {
  const d = document.createElement('div');
  d.className = className;
  d.innerHTML = html;
  return d;
}

const SCOOTER = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h6.5l2-6h-4"/><path d="M13 5h3l1.5 6"/><path d="M4 11h5l2 3"/></svg>`;
const PIN = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${CHOC}"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>`;

const lineOf = (pts: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: pts.map(([lat, lng]) => [lng, lat]) },
});

/** Mapa del seguimiento: Frésia, el repartidor (se desliza entre actualizaciones), su recorrido y el destino. */
export default function LiveMap({
  store, courier, destination, trail,
}: { store: LatLng | null; courier: LatLng | null; destination: LatLng | null; trail: [number, number][] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const courierMarker = useRef<Marker | null>(null);
  const shown = useRef<LatLng | null>(null);
  const anim = useRef<number | null>(null);
  const fitted = useRef(false);
  const latest = useRef({ store, courier, destination, trail });
  latest.current = { store, courier, destination, trail };

  // Crear el mapa una vez.
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: store ? [store.lng, store.lat] : [-99.1712, 19.39725],
      zoom: 16,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', (e) => console.error('[mapa]', e.error?.message ?? e));
    m.on('load', () => {
      m.addSource('trail', { type: 'geojson', data: lineOf([]) });
      m.addSource('remaining', { type: 'geojson', data: lineOf([]) });
      m.addLayer({ id: 'remaining', type: 'line', source: 'remaining', paint: { 'line-color': RED, 'line-width': 3, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1.5] }, layout: { 'line-cap': 'round' } });
      m.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', paint: { 'line-color': '#fff', 'line-width': 8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'trail', type: 'line', source: 'trail', paint: { 'line-color': RED, 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      const { store: s, destination: d } = latest.current;
      if (s) new maplibregl.Marker({ element: el('map-store', '<img src="/brand/fresia-puerta.svg" alt="" width="18" height="26">') }).setLngLat([s.lng, s.lat]).addTo(m);
      if (d) new maplibregl.Marker({ element: el('map-dest', PIN), anchor: 'bottom' }).setLngLat([d.lng, d.lat]).addTo(m);
      ready.current = true;
      update();
    });
    map.current = m;
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current);
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRemaining(from: LatLng | null) {
    const d = latest.current.destination;
    (map.current?.getSource('remaining') as GeoJSONSource | undefined)?.setData(lineOf(from && d ? [[from.lat, from.lng], [d.lat, d.lng]] : []));
  }

  function update() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { store: s, courier: c, destination: d, trail: t } = latest.current;
    (m.getSource('trail') as GeoJSONSource | undefined)?.setData(lineOf(c ? [...t, [c.lat, c.lng]] : t));

    if (c) {
      if (!courierMarker.current) {
        courierMarker.current = new maplibregl.Marker({ element: el('map-courier', `<span class="pulse"></span><span class="dot">${SCOOTER}</span>`) })
          .setLngLat([c.lng, c.lat])
          .addTo(m);
        shown.current = c;
        setRemaining(c);
      } else {
        // Desliza el marcador desde donde estaba hasta la nueva posición (1 s).
        const from = shown.current ?? c;
        const start = performance.now();
        if (anim.current) cancelAnimationFrame(anim.current);
        const step = (now: number) => {
          const k = Math.min(1, (now - start) / 1000);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          const p = { lat: from.lat + (c.lat - from.lat) * e, lng: from.lng + (c.lng - from.lng) * e };
          courierMarker.current!.setLngLat([p.lng, p.lat]);
          shown.current = p;
          setRemaining(p);
          if (k < 1) anim.current = requestAnimationFrame(step);
        };
        anim.current = requestAnimationFrame(step);
      }
    }

    const pts = [s, d, c].filter(Boolean) as LatLng[];
    if (!fitted.current && pts.length) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.lng, p.lat]));
      m.fitBounds(b, { padding: 56, maxZoom: 17.5, duration: 0 });
      fitted.current = true;
    } else if (c && !m.getBounds().contains([c.lng, c.lat])) {
      m.easeTo({ center: [c.lng, c.lat], duration: 800 });
    }
  }

  useEffect(update, [store, courier, destination, trail]);

  return <div ref={box} className="live-map" role="img" aria-label="Mapa con la ubicación del repartidor" />;
}
