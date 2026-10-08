import type { OrderStatus, PaymentStatus, RefundStatus } from './types';

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  sin_pagar: 'Sin pagar',
  por_cobrar: 'Pago al recibir',
  pendiente: 'Pago pendiente',
  aprobado: 'Pago recibido',
  rechazado: 'Pago rechazado',
  cancelado: 'Pago cancelado',
  devuelto: 'Pago devuelto',
};

export const ORDER_LABEL: Record<OrderStatus, string> = {
  cotizando_envio: 'Confirmando envío',
  esperando_pago: 'Esperando pago',
  recibido: 'Pedido recibido',
  confirmado: 'Pedido confirmado',
  en_preparacion: 'En preparación',
  listo: 'Listo',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const REFUND_LABEL: Record<RefundStatus, string> = {
  no_aplica: 'Sin reembolso',
  pendiente: 'Reembolso pendiente',
  reembolsado: 'Reembolsado',
};

/** Estados que el negocio puede asignar desde el panel (después del pago). */
export const ADMIN_FLOW: OrderStatus[] = ['recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'cancelado'];

/**
 * Qué hacer con el cobro, en palabras del negocio. Lo usan el panel y los avisos.
 * Entregas a domicilio: solo efectivo (la terminal se queda en el local).
 */
export type CollectInfo = { tone: 'paid' | 'collect' | 'pending' | 'none'; label: string; change: number | null };

export function collectInfo(o: {
  paymentMethod: 'online' | 'contra_entrega';
  paymentStatus: PaymentStatus;
  fulfillment: 'delivery' | 'pickup';
  total: number | null;
  cashTendered: number | null;
  orderStatus: OrderStatus;
}, money: (c: number) => string): CollectInfo {
  const total = o.total != null ? money(o.total) : 'total por confirmar';
  if (o.paymentStatus === 'aprobado') return { tone: 'paid', label: o.paymentMethod === 'online' ? 'PAGADO en línea' : 'COBRADO', change: null };
  if (o.paymentStatus === 'devuelto') return { tone: 'none', label: 'Pago devuelto', change: null };
  if (o.orderStatus === 'cancelado') return { tone: 'none', label: 'Cancelado · no cobrar', change: null };
  if (o.paymentMethod === 'contra_entrega') {
    const change = o.cashTendered != null && o.total != null && o.cashTendered > o.total ? o.cashTendered - o.total : null;
    return o.fulfillment === 'pickup'
      ? { tone: 'collect', label: `COBRAR AL RECOGER ${total}`, change }
      : { tone: 'collect', label: `COBRAR EN EFECTIVO ${total}`, change };
  }
  return { tone: 'pending', label: 'Pago en línea pendiente · no entregar', change: null };
}

/** El cliente puede cancelar mientras no se empiece a preparar. */
export const CUSTOMER_CANCELABLE: OrderStatus[] = ['esperando_pago', 'cotizando_envio', 'recibido', 'confirmado'];
