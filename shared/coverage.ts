import type { CustomerLocation, DeliveryConfig, DeliveryQuote, LatLng } from './types';

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPostalCode(cp: string): boolean {
  return /^\d{5}$/.test(cp.trim());
}

/** Distancia en metros entre dos puntos (fórmula del haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Precisión máxima aceptada del GPS para decidir automáticamente. */
export const MAX_GPS_ACCURACY_M = 80;

/**
 * Radio desde Frésia con la ubicación del dispositivo. Usa la precisión del GPS
 * a favor de la duda: solo es "dentro" si el peor caso está dentro, y solo es
 * "fuera" si el mejor caso está fuera; lo intermedio lo confirma una persona.
 */
function quoteByRadius(location: CustomerLocation | null | undefined, config: DeliveryConfig): DeliveryQuote {
  if (!config.origin) return { status: 'manual', reason: 'Aún no tenemos configurada la ubicación de Frésia.' };
  if (config.area && config.area.length >= 3) return quoteByArea(location, config, config.origin, config.area);
  if (!location) {
    return { status: 'manual', reason: `Comparte tu ubicación para confirmar que estás a menos de ${config.radiusM} m de Frésia.`, needsLocation: true };
  }
  const d = Math.round(distanceM(config.origin, location));
  const acc = Math.max(0, location.accuracyM);
  if (acc > MAX_GPS_ACCURACY_M && d - acc <= config.radiusM) {
    return { status: 'manual', reason: 'Tu ubicación no es lo bastante precisa para confirmarlo automáticamente.', distanceM: d };
  }
  if (d + acc <= config.radiusM) {
    return { status: 'covered', zoneId: 'radio', zoneName: `A ${d} m de Frésia`, fee: config.radiusFee, ...deliveryEta(config, d), distanceM: d };
  }
  if (d - acc > config.radiusM) {
    return config.outOfZone === 'manual'
      ? { status: 'manual', reason: `Estás a unos ${d} m; normalmente entregamos hasta ${config.radiusM} m.`, distanceM: d }
      : { status: 'not_covered', distanceM: d };
  }
  return { status: 'manual', reason: `Estás justo en el límite de ${config.radiusM} m.`, distanceM: d };
}

/** ¿El punto está dentro del polígono? (ray casting; lat/lng como plano, suficiente a escala de colonia). */
export function insideArea(p: LatLng, area: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = area[i];
    const b = area[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Distancia en metros del punto al borde más cercano del polígono. */
export function distanceToEdgeM(p: LatLng, area: LatLng[]): number {
  // Proyección local en metros alrededor del punto.
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const xy = (q: LatLng) => ({ x: (q.lng - p.lng) * mLng, y: (q.lat - p.lat) * mLat });
  let best = Infinity;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = xy(area[j]);
    const b = xy(area[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** Zona dibujada (polígono) con la misma regla de precisión del GPS que el radio. */
function quoteByArea(location: CustomerLocation | null | undefined, config: DeliveryConfig, origin: LatLng, area: LatLng[]): DeliveryQuote {
  if (!location) {
    return { status: 'manual', reason: 'Comparte tu ubicación para confirmar que estás dentro de nuestra zona de entrega.', needsLocation: true };
  }
  const d = Math.round(distanceM(origin, location));
  const acc = Math.max(0, location.accuracyM);
  const inside = insideArea(location, area);
  const edge = distanceToEdgeM(location, area);
  if (inside && edge >= acc) {
    if (acc > MAX_GPS_ACCURACY_M) return { status: 'manual', reason: 'Tu ubicación no es lo bastante precisa para confirmarlo automáticamente.', distanceM: d };
    return { status: 'covered', zoneId: 'zona', zoneName: `A ${d} m de Frésia`, fee: config.radiusFee, ...deliveryEta(config, d), distanceM: d };
  }
  if (!inside && edge > acc) {
    return config.outOfZone === 'manual'
      ? { status: 'manual', reason: 'Estás fuera de nuestra zona de entrega habitual.', distanceM: d }
      : { status: 'not_covered', distanceM: d };
  }
  return { status: 'manual', reason: 'Estás justo en el límite de nuestra zona de entrega.', distanceM: d };
}

/**
 * Decide si una dirección está cubierta. Solo usa la configuración que el
 * negocio capturó: no hay cobertura ni tarifas implícitas.
 */
export function quoteDelivery(input: { postalCode: string; colonia: string; location?: CustomerLocation | null }, config: DeliveryConfig): DeliveryQuote {
  if (config.mode === 'radius') return quoteByRadius(input.location, config);
  const cp = input.postalCode.trim();
  const colonia = normalizeText(input.colonia);
  const zones = config.zones.filter((z) => z.active && z.postalCodes.includes(cp));

  for (const zone of zones) {
    const coloniaOk = zone.colonias.length === 0 || zone.colonias.some((c) => normalizeText(c) === colonia);
    if (!coloniaOk) continue;
    if (zone.mode === 'manual') return { status: 'manual', reason: 'Esta zona requiere confirmar el costo de envío.', zoneName: zone.name };
    return { status: 'covered', zoneId: zone.id, zoneName: zone.name, fee: zone.fee, etaMin: zone.etaMax > 0 ? zone.etaMin : null, etaMax: zone.etaMax > 0 ? zone.etaMax : null };
  }

  if (zones.length > 0) {
    // El código postal está en una zona, pero la colonia no coincide: lo revisa una persona.
    return { status: 'manual', reason: 'No pudimos confirmar tu colonia automáticamente.' };
  }
  if (config.outOfZone === 'manual') {
    return { status: 'manual', reason: 'Tu dirección está fuera de nuestras zonas habituales.' };
  }
  return { status: 'not_covered' };
}

export function etaText(min: number, max: number): string {
  return min === max ? `${min} min` : `${min}–${max} min`;
}

/** Envío que se cobra: gratis si el subtotal alcanza el monto configurado. */
export function shippingFor(fee: number, subtotal: number, freeFrom: number | null): number {
  return freeFrom != null && subtotal >= freeFrom ? 0 : fee;
}

/** Texto del tiempo de una cotización cubierta, o null si Frésia aún no captura sus tiempos. */
export function quoteEtaText(q: { etaMin: number | null; etaMax: number | null }): string | null {
  return q.etaMin != null && q.etaMax != null ? etaText(q.etaMin, q.etaMax) : null;
}

/** Tiempo para recoger en tienda: solo la preparación. */
export function prepText(c: Pick<DeliveryConfig, 'prepMin' | 'prepMax'>): string | null {
  return c.prepMin != null && c.prepMax != null ? etaText(c.prepMin, c.prepMax) : null;
}

/**
 * Tiempo estimado de entrega: preparación + trayecto según la distancia real + subir a la oficina.
 * Sin preparación capturada no se estima nada.
 */
export function deliveryEta(
  c: Pick<DeliveryConfig, 'prepMin' | 'prepMax' | 'handoffMin' | 'courierMode'>,
  distance: number,
): { etaMin: number | null; etaMax: number | null } {
  if (c.prepMin == null || c.prepMax == null) return { etaMin: null, etaMax: null };
  const travel = etaMinutes(distance, c.courierMode) + Math.max(0, c.handoffMin);
  return { etaMin: c.prepMin + travel, etaMax: Math.max(c.prepMin, c.prepMax) + travel };
}

/** Velocidad aproximada en ciudad (m/min) y factor por calles vs. línea recta. */
const SPEED: Record<'walk' | 'bike' | 'moto', number> = { walk: 75, bike: 220, moto: 300 };

/** Minutos estimados de llegada a partir de la distancia en línea recta. */
export function etaMinutes(distance: number, mode: 'walk' | 'bike' | 'moto'): number {
  return Math.max(1, Math.round((distance * 1.3) / SPEED[mode]));
}
