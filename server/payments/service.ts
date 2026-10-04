import { randomUUID } from 'node:crypto';
import { HttpError } from '../context';
import type { Ctx } from '../context';
import type { DB } from '../db';
import { addEvent, canPay, getOrderById } from '../orders';
import type { OrderRow } from '../orders';
import { IN_FLIGHT } from './provider';
import type { ProviderPayment } from './provider';
import type { OrderStatus, PaymentStatus, RefundStatus } from '../../shared/types';

const ATTEMPT_TTL_MS = 2 * 60 * 60 * 1000;
const RECONCILE_EVERY_MS = 10_000;
const locks = new Map<string, Promise<unknown>>();

/**
 * Serializa operaciones de pago por pedido para que dos clics no abran dos
 * cobros: candado en memoria (misma instancia) + pg_advisory_lock (varias).
 */
async function withOrderLock<T>(ctx: Ctx, orderId: string, fn: () => Promise<T>): Promise<T> {
  while (locks.has(orderId)) await locks.get(orderId)!.catch(() => undefined);
  const p = ctx.db.withLock(`checkout:${orderId}`, fn);
  locks.set(orderId, p);
  try {
    return await p;
  } finally {
    locks.delete(orderId);
  }
}

export type CheckoutResult = { kind: 'redirect'; checkoutUrl: string } | { kind: 'already_paid' };

export async function startCheckout(ctx: Ctx, orderId: string): Promise<CheckoutResult> {
  return withOrderLock(ctx, orderId, async () => {
    let order = await getOrderById(ctx.db, orderId);
    if (!order) throw new HttpError(404, 'No encontramos ese pedido.');

    // Antes de abrir otro cobro, pregunta a la plataforma si ya hay pagos de este pedido.
    try {
      await reconcile(ctx, order, { force: true });
    } catch (e) {
      console.error('[pagos] no se pudo verificar pagos previos', e);
      throw new HttpError(503, 'No pudimos verificar pagos anteriores. Intenta de nuevo en un momento.');
    }
    order = (await getOrderById(ctx.db, orderId))!;

    if (order.payment_status === 'aprobado') return { kind: 'already_paid' };
    if (order.payment_status === 'pendiente') {
      throw new HttpError(409, 'Ya tienes un pago en proceso. Te avisaremos aquí en cuanto se acredite.', { code: 'payment_pending' });
    }
    if (order.order_status === 'cotizando_envio') throw new HttpError(409, 'Primero confirmaremos el costo de envío.');
    if (!canPay(order)) throw new HttpError(409, 'Este pedido ya no se puede pagar.');

    const reusable = await ctx.db.one<{ checkout_url: string }>(
      `select checkout_url from office.payment_attempts
       where order_id = $1 and provider = $2 and amount = $3 and expires_at > now() + interval '10 minutes'
       order by created_at desc limit 1`,
      [order.id, ctx.provider.name, order.total],
    );
    if (reusable) return { kind: 'redirect', checkoutUrl: reusable.checkout_url };

    const attemptId = randomUUID();
    const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MS);
    const items = order.items.map((l, i) => ({
      id: `${l.productId}-${i}`,
      title: `${l.name} ${l.sizeLabel}${l.toppings.length ? ' + ' + l.toppings.map((t) => t.name).join(', ') : ''}`.slice(0, 250),
      quantity: l.qty,
      unitPrice: l.unitPrice,
    }));
    if (order.shipping_fee) items.push({ id: 'envio', title: 'Envío', quantity: 1, unitPrice: order.shipping_fee });

    const { publicUrl } = ctx.config;
    const pref = await ctx.provider.createPreference({
      attemptId,
      orderId: order.id,
      orderNumber: order.number,
      items,
      total: order.total!,
      returnUrl: `${publicUrl}/pedido/${order.number}?t=${order.access_token}`,
      notificationUrl: publicUrl.startsWith('https://') ? `${publicUrl}/api/webhooks/mercadopago` : null,
      payerName: order.customer_name,
      expiresAt,
    });

    const o = order;
    await ctx.db.tx(async (q) => {
      await q.query(
        'insert into office.payment_attempts (id, order_id, provider, preference_id, checkout_url, amount, expires_at) values ($1, $2, $3, $4, $5, $6, $7)',
        [attemptId, o.id, ctx.provider.name, pref.preferenceId, pref.checkoutUrl, o.total, expiresAt],
      );
      await addEvent(q, o.id, 'checkout', `Preferencia ${pref.preferenceId}`, 'cliente');
    });
    return { kind: 'redirect', checkoutUrl: pref.checkoutUrl };
  });
}

/** Notificación de la plataforma: solo dice "algo cambió"; el estado se consulta directamente. */
export async function handlePaymentNotification(ctx: Ctx, paymentId: string, source: string) {
  const payment = await ctx.provider.getPayment(paymentId);
  if (!payment) return 'pago no encontrado';
  return syncPayment(ctx, payment, source);
}

/** Respaldo por si la notificación tarda: consulta los pagos asociados al pedido. */
export async function reconcile(ctx: Ctx, order: OrderRow, opts: { force?: boolean } = {}) {
  const last = order.last_reconcile_at ? new Date(order.last_reconcile_at).getTime() : 0;
  if (!opts.force && Date.now() - last < RECONCILE_EVERY_MS) return;
  const row = await ctx.db.one<{ n: number }>('select count(*)::int as n from office.payment_attempts where order_id = $1', [order.id]);
  if (!row || row.n === 0) return;
  await ctx.db.query('update office.orders set last_reconcile_at = now() where id = $1', [order.id]);
  const payments = await ctx.provider.searchByReference(order.id);
  for (const p of payments) await syncPayment(ctx, p, `${ctx.provider.name}:consulta`);
}

/** El cliente volvió de la plataforma con un payment_id: se verifica contra la API, nunca se confía en la URL. */
export async function checkReturnedPayment(ctx: Ctx, order: OrderRow, paymentId: string) {
  const p = await ctx.provider.getPayment(paymentId);
  if (p && p.externalReference === order.id) await syncPayment(ctx, p, `${ctx.provider.name}:regreso`);
}

export async function syncPayment(ctx: Ctx, p: ProviderPayment, source: string): Promise<string> {
  const order = await getOrderById(ctx.db, p.externalReference);
  if (!order) return 'pedido no encontrado';

  const result = await ctx.db.tx(async (q) => {
    // Bloquea el pedido: notificaciones simultáneas se procesan una por una.
    await q.query('select id from office.orders where id = $1 for update', [order.id]);
    await q.query(
      `insert into office.payments (provider, provider_payment_id, order_id, status, status_detail, amount, currency, raw)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (provider, provider_payment_id) do update set status = excluded.status, status_detail = excluded.status_detail,
         amount = excluded.amount, raw = excluded.raw, updated_at = now()`,
      [ctx.provider.name, p.id, order.id, p.status, p.statusDetail, p.amount, p.currency, JSON.stringify(p.raw)],
    );
    return recompute(q, order.id, source);
  });

  const fresh = (await getOrderById(ctx.db, order.id))!;
  if (result.becamePaid) ctx.notifier.notify(ctx, 'pedido_pagado', fresh);
  if (result.newReview) ctx.notifier.notify(ctx, 'revision', fresh);
  return result.becamePaid ? 'pagado' : 'actualizado';
}

async function recompute(db: DB, orderId: string, source: string) {
  const order = (await db.one<OrderRow>('select * from office.orders where id = $1', [orderId]))!;
  const payments = await db.query<{ status: string; amount: number; currency: string }>(
    'select status, amount, currency from office.payments where order_id = $1 order by updated_at desc',
    [orderId],
  );

  const approved = payments.filter((p) => p.status === 'approved');
  let status: PaymentStatus = 'sin_pagar';
  if (approved.length) status = 'aprobado';
  else if (payments.some((p) => IN_FLIGHT.has(p.status))) status = 'pendiente';
  else if (payments.some((p) => p.status === 'refunded' || p.status === 'charged_back')) status = 'devuelto';
  else if (payments[0]?.status === 'rejected') status = 'rechazado';
  else if (payments[0]?.status === 'cancelled') status = 'cancelado';

  const reviews: string[] = [];
  if (approved.length > 1) reviews.push(`Hay ${approved.length} pagos aprobados: reembolsa el excedente.`);
  if (approved.length && (approved[0].amount !== order.total || approved[0].currency !== 'MXN')) reviews.push('El monto pagado no coincide con el total del pedido.');

  const becamePaid = status === 'aprobado' && order.payment_status !== 'aprobado';
  let orderStatus: OrderStatus = order.order_status;
  let refund: RefundStatus = order.refund_status;
  if (becamePaid && order.order_status === 'esperando_pago') orderStatus = 'recibido';
  if (becamePaid && order.order_status === 'cancelado') {
    reviews.push('Llegó un pago para un pedido cancelado: revisa el reembolso.');
    refund = 'pendiente';
  }
  if (status === 'devuelto') refund = 'reembolsado';

  const review = reviews.length ? reviews.join(' ') : null;
  const newReview = review != null && review !== order.needs_review;
  if (status !== order.payment_status || orderStatus !== order.order_status || refund !== order.refund_status || review !== order.needs_review) {
    await db.query(
      `update office.orders set payment_status = $2, order_status = $3, refund_status = $4, needs_review = $5,
         paid_at = coalesce(paid_at, case when $6 then now() end), updated_at = now() where id = $1`,
      [orderId, status, orderStatus, refund, review, becamePaid],
    );
    if (status !== order.payment_status) await addEvent(db, orderId, 'pago', `${order.payment_status} → ${status}`, source);
    if (orderStatus !== order.order_status) await addEvent(db, orderId, 'estado', orderStatus, 'sistema');
    if (newReview) await addEvent(db, orderId, 'revision', review!, 'sistema');
  }
  return { becamePaid, newReview };
}
