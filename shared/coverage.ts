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
  if (!location) {
    return { status: 'manual', reason: `Comparte tu ubicación para confirmar que estás a menos de ${config.radiusM} m de Frésia.`, needsLocation: true };
  }
  const d = Math.round(distanceM(config.origin, location));
  const acc = Math.max(0, location.accuracyM);
  if (acc > MAX_GPS_ACCURACY_M && d - acc <= config.radiusM) {
    return { status: 'manual', reason: 'Tu ubicación no es lo bastante precisa para confirmarlo automáticamente.', distanceM: d };
  }
  if (d + acc <= config.radiusM) {
    return { status: 'covered', zoneId: 'radio', zoneName: `A ${d} m de Frésia`, fee: config.radiusFee, etaMin: config.radiusEtaMin, etaMax: config.radiusEtaMax, distanceM: d };
  }
  if (d - acc > config.radiusM) {
    return config.outOfZone === 'manual'
      ? { status: 'manual', reason: `Estás a unos ${d} m; normalmente entregamos hasta ${config.radiusM} m.`, distanceM: d }
      : { status: 'not_covered', distanceM: d };
  }
  return { status: 'manual', reason: `Estás justo en el límite de ${config.radiusM} m.`, distanceM: d };
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
    return { status: 'covered', zoneId: zone.id, zoneName: zone.name, fee: zone.fee, etaMin: zone.etaMin, etaMax: zone.etaMax };
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

/** Velocidad aproximada en ciudad (m/min) y factor por calles vs. línea recta. */
const SPEED: Record<'walk' | 'bike' | 'moto', number> = { walk: 75, bike: 220, moto: 300 };

/** Minutos estimados de llegada a partir de la distancia en línea recta. */
export function etaMinutes(distance: number, mode: 'walk' | 'bike' | 'moto'): number {
  return Math.max(1, Math.round((distance * 1.3) / SPEED[mode]));
}
