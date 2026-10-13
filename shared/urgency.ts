import type { DeliveryQuote, Fulfillment, OrderStatus, PaymentMethod } from './types';

export type UrgencyLevel = 'late' | 'soon' | 'ok';
export type Urgency = {
  /** Hora a la que el cliente lo espera (entrega o recolección). */
  dueAt: string | null;
  /** Hora a la que debe estar LISTO en cocina (a domicilio: antes de salir). */
  readyBy: string | null;
  /** Minutos para el siguiente límite que importa según la etapa (negativo = atrasado). */
  minutesLeft: number | null;
  level: UrgencyLevel | null;
};

type UrgencyOrder = {
  orderStatus: OrderStatus;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  scheduledFor: string | null;
  createdAt: string;
  paidAt: string | null;
  deliveryQuote: DeliveryQuote;
};

/** «Pronto» = quedan 10 minutos o menos. */
export const SOON_MIN = 10;

/**
 * Tiempos reales del pedido, con la preparación capturada en Entrega (prepMax) y el
 * trayecto que ya se le prometió al cliente (etaMax − prepMax). Sin tiempos capturados
 * no se inventa nada: solo cuenta la hora programada.
 */
export function urgencyOf(o: UrgencyOrder, cfg: { prepMax: number | null }, now: Date): Urgency {
  const none: Urgency = { dueAt: null, readyBy: null, minutesLeft: null, level: null };
  if (o.orderStatus === 'entregado' || o.orderStatus === 'cancelado' || o.orderStatus === 'cotizando_envio' || o.orderStatus === 'esperando_pago') return none;

  const q = o.deliveryQuote;
  const etaMax = q.status === 'covered' ? q.etaMax : null;
  const travel = o.fulfillment === 'pickup' ? 0 : etaMax != null && cfg.prepMax != null ? Math.max(0, etaMax - cfg.prepMax) : null;
  const min = 60_000;

  let dueAt: number | null = null;
  if (o.scheduledFor) dueAt = Date.parse(o.scheduledFor);
  else {
    // Lo antes posible: desde que entró a la cocina (pago confirmado o pedido para pagar al recibir).
    const start = Date.parse(o.paymentMethod === 'online' ? o.paidAt ?? o.createdAt : o.createdAt);
    const total = o.fulfillment === 'pickup' ? cfg.prepMax : etaMax;
    if (total != null) dueAt = start + total * min;
  }
  if (dueAt == null) return none;
  const readyBy = travel != null ? dueAt - travel * min : o.fulfillment === 'pickup' ? dueAt : null;

  // Antes de estar listo importa la hora de cocina; después, la hora de entrega.
  const cooking = o.orderStatus === 'recibido' || o.orderStatus === 'confirmado' || o.orderStatus === 'en_preparacion';
  const deadline = cooking && readyBy != null ? readyBy : dueAt;
  const minutesLeft = Math.round((deadline - now.getTime()) / min);
  return {
    dueAt: new Date(dueAt).toISOString(),
    readyBy: readyBy != null ? new Date(readyBy).toISOString() : null,
    minutesLeft,
    level: minutesLeft < 0 ? 'late' : minutesLeft <= SOON_MIN ? 'soon' : 'ok',
  };
}

/**
 * Orden de la lista: primero lo nuevo sin ver, después lo más urgente
 * (lo atrasado arriba); lo que no tiene hora va al final por antigüedad.
 */
export function urgencySort<T extends { orderStatus: OrderStatus; seenAt: string | null; createdAt: string; urgency: Urgency }>(list: T[]): T[] {
  const unseen = (o: T) => (o.orderStatus === 'recibido' || o.orderStatus === 'cotizando_envio') && !o.seenAt;
  return [...list].sort((a, b) => {
    if (unseen(a) !== unseen(b)) return unseen(a) ? -1 : 1;
    const ma = a.urgency.minutesLeft;
    const mb = b.urgency.minutesLeft;
    if (ma != null && mb != null && ma !== mb) return ma - mb;
    if ((ma == null) !== (mb == null)) return ma == null ? 1 : -1;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}
