import { money } from './money';
import type { OrderStatus, PublicOrder } from './types';

type FlowOrder = Pick<PublicOrder, 'fulfillment' | 'orderStatus' | 'paymentStatus' | 'paymentMethod' | 'total'>;

/** Pasos que ve el vendedor. «Confirmado» existe pero se salta: preparar ya implica confirmar. */
export function flowSteps(o: Pick<FlowOrder, 'fulfillment'>): { key: OrderStatus; label: string }[] {
  return o.fulfillment === 'delivery'
    ? [
        { key: 'recibido', label: 'Recibido' },
        { key: 'en_preparacion', label: 'Preparando' },
        { key: 'en_camino', label: 'En camino' },
        { key: 'entregado', label: 'Entregado' },
      ]
    : [
        { key: 'recibido', label: 'Recibido' },
        { key: 'en_preparacion', label: 'Preparando' },
        { key: 'listo', label: 'Listo para recoger' },
        { key: 'entregado', label: 'Entregado' },
      ];
}

export const RANK: Record<string, number> = { recibido: 0, confirmado: 0, en_preparacion: 1, listo: 2, en_camino: 2, entregado: 3 };

/**
 * Siguiente acción para un solo botón. Entregar y cobrar son pasos SEPARADOS:
 * marcar «Entregado» nunca registra el pago; el cobro se registra aparte (con lo recibido y el cambio).
 */
export type NextAction = { kind: 'status'; status: OrderStatus; label: string } | { kind: 'collect'; label: string } | null;

export const needsCollect = (o: Pick<FlowOrder, 'paymentMethod' | 'paymentStatus' | 'orderStatus'>) =>
  o.paymentMethod === 'contra_entrega' && o.paymentStatus !== 'aprobado' && o.orderStatus !== 'cancelado' && o.orderStatus !== 'cotizando_envio';

export function nextAction(o: FlowOrder): NextAction {
  if (o.orderStatus === 'cancelado' || o.orderStatus === 'cotizando_envio') return null;
  if (o.orderStatus === 'entregado') return needsCollect(o) ? { kind: 'collect', label: `💵 Registrar cobro ${o.total != null ? money(o.total) : ''}` } : null;
  const canAdvance = o.paymentStatus === 'aprobado' || o.paymentMethod === 'contra_entrega';
  if (!canAdvance) return null;
  const r = RANK[o.orderStatus] ?? 0;
  if (r === 0) return { kind: 'status', status: 'en_preparacion', label: '👩‍🍳 Empezar a preparar' };
  if (r === 1) return o.fulfillment === 'delivery' ? { kind: 'status', status: 'en_camino', label: '🛵 Iniciar entrega' } : { kind: 'status', status: 'listo', label: '🛍️ Listo para recoger' };
  return { kind: 'status', status: 'entregado', label: o.fulfillment === 'delivery' ? '✅ Confirmar entrega' : '✅ Entregado al cliente' };
}

