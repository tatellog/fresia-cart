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
