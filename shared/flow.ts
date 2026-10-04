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

export type NextAction = { status: OrderStatus; label: string; collect: boolean } | null;

/** La siguiente acción de un pedido, lista para un solo botón. */
export function nextAction(o: FlowOrder): NextAction {
  if (o.orderStatus === 'cancelado' || o.orderStatus === 'entregado' || o.orderStatus === 'cotizando_envio') return null;
  const canAdvance = o.paymentStatus === 'aprobado' || o.paymentMethod === 'contra_entrega';
  if (!canAdvance) return null;
  const r = RANK[o.orderStatus] ?? 0;
  if (r === 0) return { status: 'en_preparacion', label: '👩‍🍳 Empezar a preparar', collect: false };
  if (r === 1) return o.fulfillment === 'delivery' ? { status: 'en_camino', label: '🛵 Salir a entregar', collect: false } : { status: 'listo', label: '🛍️ Listo para recoger', collect: false };
  const collect = o.paymentMethod === 'contra_entrega' && o.paymentStatus !== 'aprobado';
  return { status: 'entregado', label: collect ? `✅ Entregado y cobrado ${o.total != null ? money(o.total) : ''}` : '✅ Entregado', collect };
}

