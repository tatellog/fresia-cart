import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { address, orderBody, start, tick } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

// Precios de ejemplo del seed: Clásica mediana 80.00, nuez 15, coco 10, Waffle 95, envío zona A 30.
const EXPECTED_SUBTOTAL = (8000 + 1500 + 1000) * 2 + 9500; // 30,500
const EXPECTED_TOTAL = EXPECTED_SUBTOTAL + 3000;

async function createPaidReadyOrder(body = orderBody()) {
  const created = await t.api('POST', '/api/orders', body);
  const { number, token } = created.body;
  const co = await t.api('POST', `/api/orders/${number}/checkout`, { t: token });
  const prefId = co.body.checkoutUrl.split('/').pop();
  return { number, token, prefId, created };
}

describe('totales', () => {
  it('calcula en el servidor e ignora importes enviados por el navegador', async () => {
    const body = orderBody({ total: 1, subtotal: 1 }) as any;
    body.items[0].price = 1;
    body.items[0].unitPrice = 1;
    const r = await t.api('POST', '/api/orders', body);
    expect(r.status).toBe(201);
    expect(r.body.order.subtotal).toBe(EXPECTED_SUBTOTAL);
    expect(r.body.order.shippingFee).toBe(3000);
    expect(r.body.order.total).toBe(EXPECTED_TOTAL);
    expect(r.body.order.items[0].unitPrice).toBe(10500);
  });

  it('rechaza productos agotados, toppings no permitidos y exceso de toppings', async () => {
    let r = await t.api('POST', '/api/orders', orderBody({ items: [{ productId: 'granada', sizeId: 'chica', toppingIds: [], qty: 1 }] }));
    expect(r.status).toBe(422);
    r = await t.api('POST', '/api/orders', orderBody({ items: [{ productId: 'brulee', sizeId: 'mediana', toppingIds: ['oreo'], qty: 1 }] }));
    expect(r.status).toBe(422);
    r = await t.api('POST', '/api/orders', orderBody({ items: [{ productId: 'brulee', sizeId: 'mediana', toppingIds: ['nuez', 'granola', 'nuez'], qty: 1 }] }));
    expect(r.status).toBe(201); // duplicados se consolidan
    r = await t.api('POST', '/api/orders', orderBody({ items: [{ productId: 'clasica', sizeId: 'chica', toppingIds: [], qty: 0 }] }));
    expect(r.status).toBe(400);
  });

  it('recoger en tienda no cobra envío', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ fulfillment: 'pickup', address: null }));
    expect(r.body.order.total).toBe(EXPECTED_SUBTOTAL);
  });
});

describe('cobertura', () => {
  it('zona automática, zona manual y fuera de zona', async () => {
    expect((await t.api('POST', '/api/coverage', { postalCode: '03103', colonia: 'x' })).body).toMatchObject({ status: 'covered', fee: 3000, etaMin: 25, etaMax: 40 });
    expect((await t.api('POST', '/api/coverage', { postalCode: '03100', colonia: 'x' })).body.status).toBe('manual');
    expect((await t.api('POST', '/api/coverage', { postalCode: '99999', colonia: 'x' })).body.status).toBe('manual');
    expect((await t.api('POST', '/api/coverage', { postalCode: '123', colonia: 'x' })).status).toBe(400);
  });

  it('si el negocio rechaza fuera de zona, no se crea el pedido', async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const d = (await t.api('GET', '/api/admin/delivery')).body;
    await t.api('PUT', '/api/admin/delivery', { ...d, outOfZone: 'reject' });
    const r = await t.api('POST', '/api/orders', orderBody({ address: { ...address, postalCode: '99999' } }));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/no llegamos/i);
  });

  it('cotización manual: detiene el pago hasta que el negocio fija el envío', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ address: { ...address, postalCode: '03100' } }));
    expect(r.body.order.orderStatus).toBe('cotizando_envio');
    expect(r.body.order.total).toBeNull();
    expect(r.body.order.canPay).toBe(false);
    expect(t.ctx.notifier.sent).toContainEqual({ kind: 'cotizacion_envio', number: r.body.number });
    const blocked = await t.api('POST', `/api/orders/${r.body.number}/checkout`, { t: r.body.token });
    expect(blocked.status).toBe(409);

    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const id = (await t.api('GET', '/api/admin/orders?filter=activos')).body.orders[0].id;
    const q = await t.api('POST', `/api/admin/orders/${id}/shipping`, { fee: 4500, etaText: '40–60 min' });
    expect(q.body.order.total).toBe(EXPECTED_SUBTOTAL + 4500);
    const view = await t.api('GET', `/api/orders/${r.body.number}?t=${r.body.token}`);
    expect(view.body.order.canPay).toBe(true);
    expect((await t.api('POST', `/api/orders/${r.body.number}/checkout`, { t: r.body.token })).status).toBe(200);
  });
});

describe('duplicados', () => {
  it('la misma llave devuelve el mismo pedido, incluso en paralelo', async () => {
    const body = orderBody();
    const results = await Promise.all(Array.from({ length: 6 }, () => t.api('POST', '/api/orders', body)));
    const numbers = new Set(results.map((r) => r.body.number));
    expect(numbers.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const { n } = (await t.ctx.db.one<{ n: number }>('select count(*)::int as n from office.orders'))!;
    expect(n).toBe(1);
  });

  it('la misma llave con otro contenido es rechazada', async () => {
    const body = orderBody();
    await t.api('POST', '/api/orders', body);
    const r = await t.api('POST', '/api/orders', { ...body, notes: 'otro' });
    expect(r.status).toBe(409);
  });

  it('dos clics en Pagar reutilizan el mismo checkout', async () => {
    const c = await t.api('POST', '/api/orders', orderBody());
    const [a, b] = await Promise.all([
      t.api('POST', `/api/orders/${c.body.number}/checkout`, { t: c.body.token }),
      t.api('POST', `/api/orders/${c.body.number}/checkout`, { t: c.body.token }),
    ]);
    expect(a.body.checkoutUrl).toBe(b.body.checkoutUrl);
    const { n } = (await t.ctx.db.one<{ n: number }>('select count(*)::int as n from office.payment_attempts'))!;
    expect(n).toBe(1);
  });
});

describe('pagos', () => {
  it('regresar a la URL de éxito NO marca el pedido como pagado', async () => {
    const { number, token } = await createPaidReadyOrder();
    const r = await t.api('GET', `/api/orders/${number}?t=${token}&status=approved&collection_status=approved&payment_id=inventado`);
    expect(r.body.order.paymentStatus).toBe('sin_pagar');
    expect(r.body.order.orderStatus).toBe('esperando_pago');
  });

  it('pago aprobado → notificación → pedido recibido y negocio avisado', async () => {
    const { number, token, prefId } = await createPaidReadyOrder();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await tick();
    const r = await t.api('GET', `/api/orders/${number}?t=${token}`);
    expect(r.body.order.paymentStatus).toBe('aprobado');
    expect(r.body.order.orderStatus).toBe('recibido');
    expect(t.ctx.notifier.sent).toContainEqual({ kind: 'pedido_pagado', number });
    const again = await t.api('POST', `/api/orders/${number}/checkout`, { t: token });
    expect(again.body.kind).toBe('already_paid');
  });

  it('rechazado permite reintentar sin crear otro pedido', async () => {
    const { number, token, prefId } = await createPaidReadyOrder();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'rejected' });
    await tick();
    let r = await t.api('GET', `/api/orders/${number}?t=${token}`);
    expect(r.body.order.paymentStatus).toBe('rechazado');
    expect(r.body.order.canPay).toBe(true);
    const retry = await t.api('POST', `/api/orders/${number}/checkout`, { t: token });
    expect(retry.status).toBe(200);
    await t.api('POST', `/api/demo/preferences/${retry.body.checkoutUrl.split('/').pop()}/pay`, { outcome: 'approved' });
    await tick();
    r = await t.api('GET', `/api/orders/${number}?t=${token}`);
    expect(r.body.order.paymentStatus).toBe('aprobado');
    const { n } = (await t.ctx.db.one<{ n: number }>('select count(*)::int as n from office.orders'))!;
    expect(n).toBe(1);
  });

  it('pago pendiente bloquea un segundo cobro hasta que se resuelve', async () => {
    const { number, token, prefId } = await createPaidReadyOrder();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'pending' });
    await tick();
    expect((await t.api('GET', `/api/orders/${number}?t=${token}`)).body.order.paymentStatus).toBe('pendiente');
    const blocked = await t.api('POST', `/api/orders/${number}/checkout`, { t: token });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('payment_pending');

    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const order = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders[0];
    await t.api('POST', `/api/admin/demo/payments/${order.payments[0].id}`, { status: 'approved' });
    expect((await t.api('GET', `/api/orders/${number}?t=${token}`)).body.order.paymentStatus).toBe('aprobado');
  });

  it('dos pagos aprobados del mismo pedido quedan marcados para revisión', async () => {
    const { number, token, prefId } = await createPaidReadyOrder();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await tick();
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const o = (await t.api('GET', '/api/admin/orders?filter=revision')).body.orders[0];
    expect(o.number).toBe(number);
    expect(o.needsReview).toMatch(/2 pagos aprobados/);
    expect(token).toBeTruthy();
  });

  it('el cliente necesita el token para ver su pedido', async () => {
    const c = await t.api('POST', '/api/orders', orderBody());
    expect((await t.api('GET', `/api/orders/${c.body.number}?t=incorrecto`)).status).toBe(404);
    expect((await t.api('GET', `/api/orders/${c.body.number}`)).status).toBe(404);
  });
});

describe('panel', () => {
  it('protegido, con estados separados de pago, preparación y reembolso', async () => {
    expect((await t.api('GET', '/api/admin/orders')).status).toBe(401);
    expect((await t.api('POST', '/api/admin/login', { password: 'mal' })).status).toBe(401);
    expect((await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' })).status).toBe(200);

    const unpaid = await t.api('POST', '/api/orders', orderBody());
    const uid = (await t.api('GET', '/api/admin/orders?filter=sin_pagar')).body.orders[0].id;
    expect((await t.api('POST', `/api/admin/orders/${uid}/status`, { status: 'en_preparacion' })).status).toBe(409);
    expect(unpaid.status).toBe(201);

    const { number, prefId } = await createPaidReadyOrder();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await tick();
    const order = (await t.api('GET', '/api/admin/orders?filter=activos')).body.orders.find((o: any) => o.number === number);
    for (const s of ['confirmado', 'en_preparacion', 'listo', 'en_camino']) {
      const r = await t.api('POST', `/api/admin/orders/${order.id}/status`, { status: s });
      expect(r.body.order.orderStatus).toBe(s);
      expect(r.body.order.paymentStatus).toBe('aprobado');
    }
    const cancelled = await t.api('POST', `/api/admin/orders/${order.id}/status`, { status: 'cancelado' });
    expect(cancelled.body.order.orderStatus).toBe('cancelado');
    expect(cancelled.body.order.paymentStatus).toBe('aprobado'); // cancelar no reembolsa
    expect(cancelled.body.order.refundStatus).toBe('pendiente');
    const refunded = await t.api('POST', `/api/admin/orders/${order.id}/refund`, { status: 'reembolsado' });
    expect(refunded.body.order.refundStatus).toBe('reembolsado');
  });

  it('cambios de catálogo se reflejan en el menú y en el precio cobrado', async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const { products } = (await t.api('GET', '/api/admin/catalog')).body;
    const waffle = products.find((p: any) => p.id === 'waffle');
    await t.api('PUT', '/api/admin/products/waffle', { ...waffle, sizes: [{ id: 'unico', label: 'Pieza', price: 12000 }] });
    const r = await t.api('POST', '/api/orders', orderBody({ fulfillment: 'pickup', address: null, items: [{ productId: 'waffle', sizeId: 'unico', toppingIds: [], qty: 1 }] }));
    expect(r.body.order.total).toBe(12000);
  });

  it('el QR permanente redirige al menú y cuenta escaneos', async () => {
    const r = await t.api('GET', '/q/volante');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
  });
});

describe('persistencia', () => {
  it('los pedidos sobreviven a un reinicio del servidor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fresia-'));
    const path = join(dir, 'pg');
    const a = await start({ pglitePath: path });
    const c = await a.api('POST', '/api/orders', orderBody());
    await a.close();
    const b = await start({ pglitePath: path });
    const r = await b.api('GET', `/api/orders/${c.body.number}?t=${c.body.token}`);
    expect(r.status).toBe(200);
    expect(r.body.order.total).toBe(EXPECTED_TOTAL);
    const next = await b.api('POST', '/api/orders', orderBody());
    expect(next.body.number).not.toBe(c.body.number);
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
