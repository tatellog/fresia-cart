import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { iso, isoOrNull } from './db';
import type { DB } from './db';
import { HttpError, onlinePaymentReady } from './context';
import type { Ctx } from './context';
import { getDelivery, getFeatures, getRules, getSchedule, listProducts, listToppings, nextOrderNumber } from './store';
import { groupLinesForOrder } from './groups';
import { CUSTOMER_CANCELABLE } from '../shared/status';
import { PHOTO_RETENTION_DAYS } from '../shared/types';
import { isOpenAt, isValidSlot, nextOpening } from '../shared/schedule';
import { invoiceErrors, normalizeInvoice } from '../shared/invoice';
import type { InvoiceData } from '../shared/invoice';
import { minimumMessage, priceCart } from '../shared/pricing';
import { distanceM, normalizeText, quoteDelivery, shippingFor } from '../shared/coverage';
import { lookupPostalCode, postalCatalogLoaded } from './postal';
import type {
  Address, AdminOrder, CartLineInput, GiftInfo, Quote, DeliveryQuote, Fulfillment, OrderStatus, PaymentMethod, PaymentStatus, PricedLine, PublicOrder, RefundStatus, TrackingInfo,
} from '../shared/types';

export type OrderInput = {
  customer: { name: string; phone: string };
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  cashTendered: number | null;
  address: Address | null;
  notes: string;
  items: CartLineInput[];
  /** QR / edificio de origen (slug). */
  source?: string | null;
  invoice?: InvoiceData | null;
  gift?: GiftInfo | null;
  /** ISO de la hora programada; null = lo antes posible. */
  scheduledFor?: string | null;
  /** Pedido de equipo: el servidor toma los productos del grupo. */
  group?: { code: string; token: string } | null;
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
  delivery_photo_at: Date | string | null;
  source: string | null;
  invoice: InvoiceData | null;
  gift: GiftInfo | null;
  invoice_status: 'no_aplica' | 'solicitada' | 'emitida';
  scheduled_for: Date | string | null;
  group_name: string | null;
  order_status: OrderStatus;
  refund_status: RefundStatus;
  needs_review: string | null;
  demo: boolean;
  paid_at: Date | string | null;
  last_reconcile_at: Date | string | null;
};

/** Cotiza con el catálogo y la cobertura del servidor. Ignora cualquier importe del navegador. */
export async function quoteOrder(db: DB, input: Pick<OrderInput, 'fulfillment' | 'address' | 'items'>, opts: { group?: boolean; gift?: boolean } = {}): Promise<Quote> {
  const [products, toppings, cfg, rules] = await Promise.all([listProducts(db), listToppings(db), getDelivery(db), getRules(db)]);
  // En pedidos de equipo cada quien pide de a uno: el mínimo de piezas se revisa en el total.
  const priced = priceCart(input.items, products, toppings, rules, { ignoreMinQty: opts.group });
  const errors = priced.errors.map((e) => e.message);
  if (input.items.length === 0) errors.push('Tu carrito está vacío.');
  // El mínimo de Frésias no aplica a pedidos de equipo, regalos ni pedidos con combo.
  else if (!priced.errors.length && !opts.group && !opts.gift && !hasCombo(input.items, products)) {
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

  const shippingFee =
    delivery.status === 'pickup' ? 0 : delivery.status === 'covered' ? shippingFor(delivery.fee, priced.subtotal, cfg.freeShippingFrom) : null;
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

const hasCombo = (items: CartLineInput[], products: { id: string; combo: unknown }[]) =>
  items.some((i) => products.find((p) => p.id === i.productId)?.combo);

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

  // Pedido de equipo: los productos salen del grupo, no del navegador.
  let group: Awaited<ReturnType<typeof groupLinesForOrder>>['group'] | null = null;
  if (input.group) {
    const g = await groupLinesForOrder(ctx, input.group.code, input.group.token);
    group = g.group;
    input = { ...input, items: g.lines };
  }

  // Horario: programado en un horario válido, o «lo antes posible» solo si está abierto.
  const schedule = await getSchedule(db);
  const now = ctx.now();
  if (input.scheduledFor) {
    if (!isValidSlot(input.scheduledFor, now, schedule)) throw new HttpError(422, 'Ese horario ya no está disponible. Elige otro.', { code: 'slot_unavailable' });
  } else if (!isOpenAt(now, schedule)) {
    const when = nextOpening(now, schedule);
    throw new HttpError(422, `Ahora estamos cerrados${when ? `; abrimos ${when}` : ''}. Programa tu pedido.`, { code: 'closed' });
  }

  // Fresigrama: solo a domicilio y no en pedidos de equipo.
  const gift = input.gift ? { to: input.gift.to.trim(), note: input.gift.note.trim(), anonymous: input.gift.anonymous } : null;
  if (gift && !(await getFeatures(db)).fresigrama) throw new HttpError(422, 'Los regalos aún no están disponibles.', { code: 'gift_off' });
  if (gift && input.fulfillment !== 'delivery') throw new HttpError(422, 'Los regalos solo se envían a domicilio.', { code: 'gift' });
  if (gift && input.group) throw new HttpError(422, 'El pedido de equipo no puede ser un regalo.', { code: 'gift' });

  let invoice: InvoiceData | null = null;
  if (input.invoice) {
    const errs = Object.values(invoiceErrors(input.invoice));
    if (errs.length) throw new HttpError(422, errs[0]!, { code: 'invoice' });
    invoice = normalizeInvoice(input.invoice);
  }

  const source = input.source
    ? (await db.one<{ slug: string }>('select slug from office.qr_sources where slug = $1', [input.source]))?.slug ?? null
    : null;

  // Código postal y colonia contra el catálogo de SEPOMEX (si está cargado); se guarda el nombre oficial.
  if (input.fulfillment === 'delivery' && input.address && (await postalCatalogLoaded(db))) {
    const info = await lookupPostalCode(db, input.address.postalCode);
    if (!info) throw new HttpError(422, 'Ese código postal no existe en la Ciudad de México. Revísalo.', { code: 'postal_code' });
    const match = info.colonias.find((c) => normalizeText(c.name) === normalizeText(input.address!.colonia));
    if (!match) throw new HttpError(422, 'Esa colonia no corresponde al código postal. Elígela de la lista.', { code: 'colonia' });
    input = { ...input, address: { ...input.address, colonia: match.name } };
  }

  const quote = await quoteOrder(db, input, { group: !!group, gift: !!gift });
  if (quote.errors.length) throw new HttpError(422, quote.errors[0], { errors: quote.errors });
  const cfg = await getDelivery(db);
  const cod = input.paymentMethod === 'contra_entrega';
  if (cod ? !cfg.cashOnDelivery : !cfg.onlinePayment || !onlinePaymentReady(ctx)) throw new HttpError(422, 'Ese método de pago no está disponible.');

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
         fulfillment, address, notes, items, subtotal, shipping_fee, total, delivery_quote, payment_method, payment_status, order_status, demo, cash_tendered,
         source, invoice, invoice_status, scheduled_for, group_name, gift)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15::jsonb, $18, $19, $16, $17, $20,
         $21, $22::jsonb, $23, $24, $25, $26::jsonb)
       on conflict (idempotency_key) do nothing
       returning *`,
      [
        id, number, randomBytes(24).toString('base64url'), idempotencyKey, hash, input.customer.name, input.customer.phone,
        input.fulfillment, input.address ? JSON.stringify(input.address) : null, input.notes, JSON.stringify(quote.lines),
        quote.subtotal, quote.shippingFee, quote.total, JSON.stringify(quote.delivery), orderStatus,
        ctx.provider.name === 'demo', input.paymentMethod, cod ? 'por_cobrar' : 'sin_pagar', cashTendered,
        source, invoice ? JSON.stringify(invoice) : null, invoice ? 'solicitada' : 'no_aplica', input.scheduledFor ?? null, group?.name ?? null, gift ? JSON.stringify(gift) : null,
      ],
    );
    if (row && group) {
      const taken = await q.query<{ id: string }>(
        "update office.group_orders set status = 'pedido', order_id = $2 where id = $1 and status = 'abierto' returning id",
        [group.id, id],
      );
      if (!taken.length) throw new HttpError(409, 'Este pedido de equipo ya se envió.');
    }
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
    deliveryPhotoAt: photoStillStored(row.delivery_photo_at) ? isoOrNull(row.delivery_photo_at) : null,
    scheduledFor: isoOrNull(row.scheduled_for),
    invoice: row.invoice ?? null,
    gift: row.gift ?? null,
    invoiceStatus: row.invoice_status ?? 'no_aplica',
    groupName: row.group_name ?? null,
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
    source: row.source ?? null,
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
      await q.query('delete from office.order_tracking where order_id = $1', [id]);
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
    if (status === 'entregado' && row.fulfillment === 'delivery' && !row.delivery_photo_at) {
      throw new HttpError(409, 'Toma la foto de entrega antes de marcarlo como entregado.', { code: 'photo_required' });
    }
    // Al dejar de ir en camino, se borra la ubicación del repartidor (privacidad).
    if (status !== 'en_camino') await q.query('delete from office.order_tracking where order_id = $1', [id]);
    await addEvent(q, id, 'estado', status, actor);
    return (await q.one<OrderRow>('update office.orders set order_status = $2, updated_at = now() where id = $1 returning *', [id, status]))!;
  });
}

/** El cliente cancela desde la página de su pedido. Se revisa con el pedido bloqueado para no chocar con el panel. */
export async function cancelByCustomer(ctx: Ctx, number: string, token: string): Promise<OrderRow> {
  const found = await getOrderForCustomer(ctx.db, number, token);
  const { row, changed } = await ctx.db.tx(async (q) => {
    const cur = (await q.one<OrderRow>('select * from office.orders where id = $1 for update', [found.id]))!;
    if (cur.order_status === 'cancelado') return { row: cur, changed: false };
    if (!CUSTOMER_CANCELABLE.includes(cur.order_status)) {
      throw new HttpError(409, 'Tu pedido ya se está preparando y no se puede cancelar.', { code: 'too_late' });
    }
    const paid = cur.payment_status === 'aprobado';
    const refund = paid && cur.refund_status === 'no_aplica' ? 'pendiente' : cur.refund_status;
    await q.query('delete from office.order_tracking where order_id = $1', [cur.id]);
    await addEvent(q, cur.id, 'estado', paid ? 'Cancelado por el cliente · reembolso pendiente' : 'Cancelado por el cliente', 'cliente');
    const updated = (await q.one<OrderRow>(
      "update office.orders set order_status = 'cancelado', refund_status = $2, updated_at = now() where id = $1 returning *",
      [cur.id, refund],
    ))!;
    return { row: updated, changed: true };
  });
  // Solo se avisa si el pedido ya le había llegado al negocio.
  if (changed && found.order_status !== 'esperando_pago') ctx.notifier.notify(ctx, 'cancelado_cliente', row);
  return row;
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

export function listOrders(db: DB, filter: 'activos' | 'sin_pagar' | 'todos' | 'revision' | 'programados'): Promise<OrderRow[]> {
  if (filter === 'programados') {
    return db.query<OrderRow>(
      "select * from office.orders where scheduled_for is not null and order_status not in ('entregado', 'cancelado') order by scheduled_for limit 200",
    );
  }
  const where = {
    activos: "where ((payment_status = 'aprobado' or payment_method = 'contra_entrega') and order_status not in ('entregado', 'cancelado')) or order_status = 'cotizando_envio'",
    sin_pagar: "where payment_method = 'online' and order_status = 'esperando_pago' and payment_status <> 'aprobado'",
    revision: "where needs_review is not null or refund_status = 'pendiente'",
    todos: '',
  }[filter];
  return db.query<OrderRow>(`select * from office.orders ${where} order by created_at desc limit 200`);
}

// ── Seguimiento en vivo ─────────────────────────────────────────────────

const TRACKING_STALE_MS = 10 * 60 * 1000;

export async function saveCourierLocation(ctx: Ctx, id: string, loc: { lat: number; lng: number; accuracyM: number; mode: 'walk' | 'bike' | 'moto' }) {
  const row = await getOrderById(ctx.db, id);
  if (!row) throw new HttpError(404, 'Pedido no encontrado.');
  if (row.order_status !== 'en_camino') throw new HttpError(409, 'Solo se comparte la ubicación mientras el pedido va en camino.');
  await ctx.db.tx(async (q) => {
    const cur = await q.one<{ trail: [number, number][] }>('select trail from office.order_tracking where order_id = $1 for update', [id]);
    const trail = cur?.trail ?? [];
    const lastPt = trail.at(-1);
    // Agrega un punto al recorrido si se movió más de 10 m (y con GPS razonable); máximo 300 puntos.
    if (loc.accuracyM <= 60 && (!lastPt || distanceM({ lat: lastPt[0], lng: lastPt[1] }, loc) > 10)) {
      trail.push([Number(loc.lat.toFixed(6)), Number(loc.lng.toFixed(6))]);
    }
    await q.query(
      `insert into office.order_tracking (order_id, lat, lng, accuracy_m, trail, mode, updated_at) values ($1, $2, $3, $4, $5::jsonb, $6, now())
       on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, trail = excluded.trail,
         mode = excluded.mode, updated_at = now()`,
      [id, loc.lat, loc.lng, Math.round(loc.accuracyM), JSON.stringify(trail.slice(-300)), loc.mode],
    );
  });
}

export async function trackingFor(ctx: Ctx, row: OrderRow): Promise<TrackingInfo> {
  const store = (await getDelivery(ctx.db)).origin;
  const destination = row.address?.location ? { lat: row.address.location.lat, lng: row.address.location.lng } : null;
  if (row.order_status !== 'en_camino') return { active: false, courier: null, trail: [], destination, store };
  const t = await ctx.db.one<{ lat: number; lng: number; accuracy_m: number; updated_at: Date; trail: [number, number][]; mode: 'walk' | 'bike' | 'moto' }>(
    'select lat, lng, accuracy_m, updated_at, trail, mode from office.order_tracking where order_id = $1',
    [row.id],
  );
  const fresh = t && Date.now() - new Date(t.updated_at).getTime() < TRACKING_STALE_MS;
  return {
    active: true,
    courier: fresh ? { lat: t!.lat, lng: t!.lng, accuracyM: t!.accuracy_m, updatedAt: iso(t!.updated_at), mode: t!.mode } : null,
    trail: fresh ? t!.trail : [],
    destination,
    store,
  };
}

// ── Foto de entrega ─────────────────────────────────────────────────────

const RETENTION_MS = PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Pasado el plazo la foto ya se borró: no se anuncia. */
function photoStillStored(at: Date | string | null): boolean {
  return at != null && Date.now() - new Date(at).getTime() < RETENTION_MS;
}

/** Borra las fotos de entrega de más de 30 días. Devuelve cuántas borró. */
export async function purgeOldDeliveryPhotos(db: DB): Promise<number> {
  // Con el reloj de la base: el mismo con el que se guardó created_at.
  const rows = await db.query<{ order_id: string }>(
    `delete from office.delivery_photos where created_at < now() - make_interval(days => $1) returning order_id`,
    [PHOTO_RETENTION_DAYS],
  );
  return rows.length;
}

const PHOTO_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export async function saveDeliveryPhoto(ctx: Ctx, id: string, image: Buffer, contentType: string) {
  const row = await getOrderById(ctx.db, id);
  if (!row) throw new HttpError(404, 'Pedido no encontrado.');
  if (row.fulfillment !== 'delivery') throw new HttpError(409, 'Solo los pedidos a domicilio llevan foto de entrega.');
  if (row.order_status === 'cancelado') throw new HttpError(409, 'Este pedido está cancelado.');
  const type = contentType.split(';')[0].trim();
  // Se revisan los primeros bytes: no basta con lo que diga el encabezado.
  if (!PHOTO_TYPES[type] || !PHOTO_TYPES[type](image)) throw new HttpError(415, 'La foto debe ser JPG, PNG o WebP.');
  await ctx.db.tx(async (q) => {
    await q.query(
      `insert into office.delivery_photos (order_id, image, content_type) values ($1, $2, $3)
       on conflict (order_id) do update set image = excluded.image, content_type = excluded.content_type, created_at = now()`,
      [id, image, type],
    );
    await q.query('update office.orders set delivery_photo_at = now(), updated_at = now() where id = $1', [id]);
    await addEvent(q, id, 'foto_entrega', `${Math.round(image.length / 1024)} KB`, 'panel');
  });
}

export async function getDeliveryPhoto(db: DB, id: string) {
  return db.one<{ image: Buffer | Uint8Array; content_type: string }>('select image, content_type from office.delivery_photos where order_id = $1', [id]);
}

export async function setInvoiceStatus(ctx: Ctx, id: string, status: 'solicitada' | 'emitida', actor: string): Promise<OrderRow> {
  return ctx.db.tx(async (q) => {
    const row = await q.one<OrderRow>('select * from office.orders where id = $1 for update', [id]);
    if (!row) throw new HttpError(404, 'Pedido no encontrado.');
    if (!row.invoice) throw new HttpError(409, 'Este pedido no pidió factura.');
    await addEvent(q, id, 'factura', status, actor);
    return (await q.one<OrderRow>('update office.orders set invoice_status = $2, updated_at = now() where id = $1 returning *', [id, status]))!;
  });
}
