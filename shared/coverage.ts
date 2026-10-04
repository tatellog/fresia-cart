import type { DeliveryConfig, DeliveryQuote } from './types';

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

/**
 * Decide si una dirección está cubierta. Solo usa la configuración que el
 * negocio capturó: no hay cobertura ni tarifas implícitas.
 */
export function quoteDelivery(input: { postalCode: string; colonia: string }, config: DeliveryConfig): DeliveryQuote {
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
