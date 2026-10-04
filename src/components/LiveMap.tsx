import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../../shared/types';

const pin = (emoji: string, label: string) =>
  L.divIcon({ className: 'map-pin', html: `<span aria-label="${label}">${emoji}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });

/** Mapa con Frésia, el repartidor y el destino. Se carga solo cuando hace falta. */
export default function LiveMap({ store, courier, destination }: { store: LatLng | null; courier: LatLng | null; destination: LatLng | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([19.3972, -99.1712], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // OpenStreetMap exige el origen (Referer) en sus mosaicos; el sitio usa same-origin por defecto.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layers.current) return;
    layers.current.clearLayers();
    const pts: L.LatLngExpression[] = [];
    if (store) {
      L.marker([store.lat, store.lng], { icon: pin('🍓', 'Frésia') }).addTo(layers.current);
      pts.push([store.lat, store.lng]);
    }
    if (destination) {
      L.marker([destination.lat, destination.lng], { icon: pin('📍', 'Tu entrega') }).addTo(layers.current);
      pts.push([destination.lat, destination.lng]);
    }
    if (courier) {
      if (destination) L.polyline([[courier.lat, courier.lng], [destination.lat, destination.lng]], { color: '#D93A32', weight: 4, dashArray: '6 8' }).addTo(layers.current);
      L.marker([courier.lat, courier.lng], { icon: pin('🛵', 'Repartidor'), zIndexOffset: 1000 }).addTo(layers.current);
      pts.push([courier.lat, courier.lng]);
    }
    if (pts.length && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
      fitted.current = true;
    } else if (courier) {
      map.current.panInside([courier.lat, courier.lng], { padding: [40, 40] });
    }
  }, [store, courier, destination]);

  return <div ref={el} className="live-map" role="img" aria-label="Mapa con la ubicación del repartidor" />;
}
