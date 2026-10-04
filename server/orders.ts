import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { iso, isoOrNull } from './db';
import type { DB } from './db';
import { HttpError } from './context';
import type { Ctx } from './context';
import { getDelivery, getRules, listProducts, listToppings, nextOrderNumber } from './store';
import { minimumMessage, priceCart } from '../shared/pricing';
import { quoteDelivery } from '../shared/coverage';
import type {
  Address, AdminOrder, CartLineInput, Quote, DeliveryQuote, Fulfillment, OrderStatus, PaymentMethod, PaymentStatus, PricedLine, PublicOrder, RefundStatus,
} from '../shared/types';

export type OrderInput = {
  customer: { name: string; phone: string };
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  cashTendered: number | null;
  address: Address | null;
  notes: string;
  items: CartLineInput[];
};

export type OrderRow = {
  id: string;
  number: string;
  access_token: string;
  idempotency_key: string;
  request_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
  customer_name: string;
  customer_phone: string;
  fulfillment: Fulfillment;
  address: Address | null;
  notes: string;
  items: PricedLine[];
  subtotal: number;
  shipping_fee: number | null;
  total: number | null;
  delivery_quote: DeliveryQuote;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  cash_tendered: number | null;
  order_status: OrderStatus;
  refund_status: RefundStatus;
  needs_review: string | null;
  demo: boolean;
  paid_at: Date | string | null;
  last_reconcile_at: Date | string | null;
};

/** Cotiza con el catálogo y la cobertura del servidor. Ignora cualquier importe del navegador. */
export async function quoteOrder(db: DB, input: Pick<OrderInput, 'fulfillment' | 'address' | 'items'>): Promise<Quote> {
  const [products, toppings, cfg, rules] = await Promise.all([listProducts(db), listToppings(db), getDelivery(db), getRules(db)]);
  const priced = priceCart(input.items, products, toppings, rules);
  const errors = priced.errors.map((e) => e.message);
  if (input.items.length === 0) errors.push('Tu carrito está vacío.');
  else if (!priced.errors.length) {
    const min = minimumMessage(priced.fresias, rules);
    if (min) errors.push(min);
  }

  let delivery: DeliveryQuote;
  if (input.fulfillment === 'pickup') {
    if (!cfg.pickupEnabled) errors.push('Por ahora no tenemos recolección en tienda.');
    delivery = { status: 'pickup' };
  } else {
    if (!cfg.deliveryEnabled) errors.push('Por ahora no tenemos entregas a domicilio.');
    if (!input.address) {
      errors.push('Falta la dirección de entrega.');
      delivery = { status: 'not_covered' };
    } else {
      delivery = quoteDelivery(input.address, cfg);
      if (delivery.status === 'not_covered') errors.push('Por ahora no llegamos a esa dirección.');
    }
  }

  const shippingFee = delivery.status === 'pickup' ? 0 : delivery.status === 'covered' ? delivery.fee : null;
  return {
    lines: priced.lines,
    subtotal: priced.subtotal,
    fresias: priced.fresias,
    delivery,
    shippingFee,
    total: shippingFee == null ? null : priced.subtotal + shippingFee,
    errors,
  };
}

function requestHash(input: OrderInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/**
 * Crea el pedido ANTES de cobrar. Con la misma llave de idempotencia devuelve
 * el mismo pedido (doble clic, reintentos de red, recarga de página). La
 * restricción UNIQUE de la base de datos lo garantiza aun entre instancias.
 */
export async function createOrder(ctx: Ctx, idempotencyKey: string, input: OrderInput): Promise<{ order: OrderRow; created: boolean }> {
  const { db } = ctx;
  const hash = requestHash(input);
  const existing = async () => {
    const row = await db.one<OrderRow>('select * from office.orders where idempotency_key = $1', [idempotencyKey]);
    if (row && row.request_hash !== hash) throw new HttpError(409, 'Este pedido cambió. Revisa el resumen e inténtalo de nuevo.', { code: 'idempotency_mismatch' });
    return row;
  };

  const prev = await existing();
  if (prev) return { order: prev, created: false };

  const quote = await quoteOrder(db, input);
  if (quote.errors.length) throw new HttpError(422, quote.errors[0], { errors: quote.errors });
  const cfg = await getDelivery(db);
  const cod = input.paymentMethod === 'contra_entrega';
  if (cod ? !cfg.cashOnDelivery : !cfg.onlinePayment) throw new HttpError(422, 'Ese método de pago no está disponible.');

  const cashTendered = cod && input.fulfillment === 'delivery' ? input.cashTendered : null;
  if (cashTendered != null && quote.total != null && cashTendered < quote.total) {
    throw new HttpError(422, 'El monto con el que pagas debe ser mayor o igual al total.');
  }

  const manual = quote.delivery.status === 'manual';
  // Contra entrega: el pedido entra directo a la cocina (no hay pago que esperar).
  const orderStatus: OrderStatus = manual ? 'cotizando_envio' : cod ? 'recibido' : 'esperando_pago';
  const id = randomUUID();
  const inserted = await db.tx(async (q) => {
    const number = await nextOrderNumber(q);
    const row = await q.one<OrderRow>(
      `insert into office.orders (id, number, access_token, idempotency_key, request_hash, customer_name, customer_phone,
         fulfillment, address, notes, items, subtotal, shipping_fee, total, delivery_quote, payment_method, payment_status, order_status, demo, cash_tendered)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15::jsonb, $18, $19, $16, $17, $20)
       on conflict (idempotency_key) do nothing
       returning *`,
      [
        id, number, randomBytes(24).toString('base64url'), idempotencyKey, hash, input.customer.name, input.customer.phone,
        input.fulfillment, input.address ? JSON.stringify(input.address) : null, input.notes, JSON.stringify(quote.lines),
        quote.subtotal, quote.shippingFee, quote.total, JSON.stringify(quote.delivery), orderStatus,
        ctx.provider.name === 'demo', input.paymentMethod, cod ? 'por_cobrar' : 'sin_pagar', cashTendered,
      ],
    );
    if (row) {
      await addEvent(q, id, 'creado', `${manual ? 'Requiere cotización de envío' : cod ? 'Recibido' : 'Esperando pago'} · ${cod ? 'paga al recibir' : 'pago en línea'}`, 'cliente');
    }
    return row;
  });

  if (!inserted) {
    // Otra solicitud con la misma llave ganó la carrera.
    return { order: (await existing())!, created: false };
  }
  if (manual) ctx.notifier.notify(ctx, 'cotizacion_envio', inserted);
  else if (cod) ctx.notifier.notify(ctx, 'pedido_contra_entrega', inserted);
  return { order: inserted, created: true };
}

export async function addEvent(db: DB, orderId: string, type: string, detail: string, actor: string) {
  await db.query('insert into office.order_events (order_id, type, detail, actor) values ($1, $2, $3, $4)', [orderId, type, detail, actor]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const getOrderById = (db: DB, id: string) =>
  UUID.test(id) ? db.one<OrderRow>('select * from office.orders where id = $1', [id]) : Promise.resolve(undefined);

/** Acceso del cliente: requiere número + token secreto (no se puede adivinar por número consecutivo). */
export async function getOrderForCustomer(db: DB, number: string, token: string): Promise<OrderRow> {
  const row = await db.one<OrderRow>('select * from office.orders where number = $1', [number]);
  if (!row || !safeEqual(row.access_token, token)) throw new HttpError(404, 'No encontramos ese pedido.');
  return row;
}

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return ha.equals(hb);
}

export function canPay(row: OrderRow): boolean {
  return row.payment_method === 'online' && row.order_status === 'esperando_pago' && row.total != null && ['sin_pagar', 'rechazado', 'cancelado'].includes(row.payment_status);
}

export function toPublic(row: OrderRow): PublicOrder {
  return {
    number: row.number,
    createdAt: iso(row.created_at),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    fulfillment: row.fulfillment,
    address: row.address,
    notes: row.notes,
    items: row.items,
    subtotal: row.subtotal,
    shippingFee: row.shipping_fee,
    total: row.total,
    deliveryQuote: row.delivery_quote,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    cashTendered: row.cash_tendered ?? null,
    orderStatus: row.order_status,
    refundStatus: row.refund_status,
    demo: row.demo,
    canPay: canPay(row),
  };
}

export async function toAdmin(db: DB, row: OrderRow): Promise<AdminOrder> {
  const [payments, events] = await Promise.all([
    db.query<{ provider: string; provider_payment_id: string; status: string; status_detail: string; amount: number; updated_at: Date }>(
      'select provider, provider_payment_id, status, status_detail, amount, updated_at from office.payments where order_id = $1 order by created_at',
      [row.id],
    ),
    db.query<{ at: Date; type: string; detail: string; actor: string }>('select at, type, detail, actor from office.order_events where order_id = $1 order by id', [row.id]),
  ]);
  return {
    ...toPublic(row),
    id: row.id,
    updatedAt: iso(row.updated_at),
    paidAt: isoOrNull(row.paid_at),
    needsReview: row.needs_review,
    payments: payments.map((p) => ({ provider: p.provider, id: p.provider_payment_id, status: p.status, statusDetail: p.status_detail, amount: p.amount, updatedAt: iso(p.updated_at) })),
    events: events.map((e) => ({ ...e, at: iso(e.at) })),
  };
}

// ── Acciones del negocio ─────────────────────────────────────────────────

const PAID_FLOW: OrderStatus[] = ['recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado'];

export async function setOrderStatus(ctx: Ctx, id: string, status: OrderStatus, actor: string): Promise<OrderRow> {
  return ctx.db.tx(async (q) => {
    const row = await q.one<OrderRow>('select * from office.orders where id = $1 for update', [id]);
    if (!row) throw new HttpError(404, 'Pedido no encontrado.');
    if (row.order_status === status) return row;
    if (row.order_status === 'cancelado') throw new HttpError(409, 'Este pedido ya está cancelado.');

    if (status === 'cancelado') {
      const paid = row.payment_status === 'aprobado';
      const refund = paid && row.refund_status === 'no_aplica' ? 'pendiente' : row.refund_status;
      await addEvent(q, id, 'estado', paid ? 'Cancelado · reembolso pendiente' : 'Cancelado', actor);
      return (await q.one<OrderRow>(
        "update office.orders set order_status = 'cancelado', refund_status = $2, updated_at = now() where id = $1 returning *",
        [id, refund],
      ))!;
    }

    if (!PAID_FLOW.includes(status)) throw new HttpError(400, 'Estado no válido.');
    const codReady = row.payment_method === 'contra_entrega' && row.order_status !== 'cotizando_envio';
    if (row.payment_status !== 'aprobado' && !codReady) throw new HttpError(409, 'Solo puedes avanzar pedidos con pago recibido.');
    if (status === 'en_camino' && row.fulfillment !== 'delivery') throw new HttpError(409, 'Este pedido es para recoger.');
    await addEvent(q, id, 'estado', status, actor);
    return (await q.one<OrderRow>('update office.orders set order_status = $2, updated_at = now() where id = $1 returning *', [id, status]))!;
  });
}

export async function setRefundStatus(ctx: Ctx, id: string, status: RefundStatus, actor: string): Promise<OrderRow> {
  return ctx.db.tx(async (q) => {
    const row = await q.one<OrderRow>('select * from office.orders where id = $1 for update', [id]);
    if (!row) throw new HttpError(404, 'Pedido no encontrado.');
    if (!['aprobado', 'devuelto'].includes(row.payment_status) && status !== 'no_aplica') {
      throw new HttpError(409, 'No hay un pago recibido que reembolsar.');
    }
    await addEvent(q, id, 'reembolso', status, actor);
    return (await q.one<OrderRow>('update office.orders set refund_status = $2, updated_at = now() where id = $1 returning *', [id, status]))!;
  });
}

/** El negocio cotizó el envío manualmente: el pedido queda listo para pagarse. */
export async function setShippingQuote(ctx: Ctx, id: string, fee: number, etaText: string, actor: string): Promise<OrderRow> {
  return ctx.db.tx(async (q) => {
    const row = await q.one<OrderRow>('select * from office.orders where id = $1 for update', [id]);
    if (!row) throw new HttpError(404, 'Pedido no encontrado.');
    if (row.order_status !== 'cotizando_envio') throw new HttpError(409, 'Este pedido no está esperando cotización.');
    const quote: DeliveryQuote = { status: 'quoted', fee, etaText };
    const next: OrderStatus = row.payment_method === 'contra_entrega' ? 'recibido' : 'esperando_pago';
    await addEvent(q, id, 'envio_cotizado', `${fee / 100} MXN · ${etaText}`, actor);
    return (await q.one<OrderRow>(
      'update office.orders set shipping_fee = $2, total = subtotal + $2, delivery_quote = $3::jsonb, order_status = $4, updated_at = now() where id = $1 returning *',
      [id, fee, JSON.stringify(quote), next],
    ))!;
  }).then((updated) => {
    if (updated.payment_method === 'contra_entrega') ctx.notifier.notify(ctx, 'pedido_contra_entrega', updated);
    return updated;
  });
}

/** Contra entrega: el negocio registra que ya cobró al entregar. */
export async function markCollected(ctx: Ctx, id: string, actor: string): Promise<OrderRow> {
  return ctx.db.tx(async (q) => {
    const row = await q.one<OrderRow>('select * from office.orders where id = $1 for update', [id]);
    if (!row) throw new HttpError(404, 'Pedido no encontrado.');
    if (row.payment_method !== 'contra_entrega') throw new HttpError(409, 'Este pedido se paga en línea.');
    if (row.payment_status === 'aprobado') return row;
    if (row.order_status === 'cancelado' || row.order_status === 'cotizando_envio') throw new HttpError(409, 'Este pedido no se puede cobrar.');
    await addEvent(q, id, 'pago', 'por_cobrar → aprobado (cobrado al entregar)', actor);
    return (await q.one<OrderRow>(
      "update office.orders set payment_status = 'aprobado', paid_at = now(), updated_at = now() where id = $1 returning *",
      [id],
    ))!;
  });
}

export function listOrders(db: DB, filter: 'activos' | 'sin_pagar' | 'todos' | 'revision'): Promise<OrderRow[]> {
  const where = {
    activos: "where ((payment_status = 'aprobado' or payment_method = 'contra_entrega') and order_status not in ('entregado', 'cancelado')) or order_status = 'cotizando_envio'",
    sin_pagar: "where payment_method = 'online' and order_status = 'esperando_pago' and payment_status <> 'aprobado'",
    revision: "where needs_review is not null or refund_status = 'pendiente'",
    todos: '',
  }[filter];
  return db.query<OrderRow>(`select * from office.orders ${where} order by created_at desc limit 200`);
}
