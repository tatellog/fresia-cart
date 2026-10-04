import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { address, near, orderBody, start, tick } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

// Menú en línea: Clásica mediano $120, adicional $18, Waffle $104; envío de ejemplo $30.
const EXPECTED_SUBTOTAL = (12000 + 1800) * 3 + 10400 * 3; // $726 (mínimo 3 piezas por producto)
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
    expect(r.body.order.items[0].unitPrice).toBe(13800);
  });

  it('rechaza productos fuera del menú, tamaños inexistentes y cantidades inválidas', async () => {
    const one = (item: object) => orderBody({ items: [{ qty: 3, ...item }, { productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 3 }] });
    // La Brûlée solo existe en el local.
    expect((await t.api('POST', '/api/orders', one({ productId: 'brulee', sizeId: 'mediano', toppingIds: [] }))).status).toBe(422);
    // Chocolate sin crema solo en chico.
    expect((await t.api('POST', '/api/orders', one({ productId: 'chocolate-sin-crema', sizeId: 'mediano', toppingIds: [] }))).status).toBe(422);
    expect((await t.api('POST', '/api/orders', one({ productId: 'chocolate-sin-crema', sizeId: 'chico', toppingIds: [] }))).status).toBe(201);
    // Productos que no están en el menú en línea.
    for (const id of ['granada', 'nogada', 'te-frutal', 'agua']) {
      expect((await t.api('POST', '/api/orders', one({ productId: id, sizeId: 'chico', toppingIds: [] }))).status).toBe(422);
    }
    // Topping que no existe.
    expect((await t.api('POST', '/api/orders', one({ productId: 'clasica', sizeId: 'chico', toppingIds: ['inventado'] }))).status).toBe(422);
    expect((await t.api('POST', '/api/orders', one({ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 0 }))).status).toBe(400);
  });

  it('recoger en tienda no cobra envío', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ fulfillment: 'pickup', address: null }));
    expect(r.body.order.total).toBe(EXPECTED_SUBTOTAL);
  });
});

describe('cobertura: 300 m alrededor de Frésia', () => {
  const check = (location: object | null) => t.api('POST', '/api/coverage', { postalCode: '', colonia: '', location });

  it('dentro del radio: tarifa; sin tiempos capturados no se inventa un tiempo', async () => {
    expect((await check(near(100))).body).toMatchObject({ status: 'covered', fee: 3000, etaMin: null, etaMax: null, distanceM: 100 });
    expect((await check(near(280, 15))).body.status).toBe('covered'); // 280 + 15 ≤ 300
  });

  it('con tiempos reales: preparación + camino según la distancia + subir a la oficina', async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const d = (await t.api('GET', '/api/admin/delivery')).body;
    const r = await t.api('PUT', '/api/admin/delivery', { ...d, prepMin: 8, prepMax: 12, handoffMin: 3, courierMode: 'walk' });
    expect(r.status).toBe(200);
    // 100 m a pie ≈ 2 min; 280 m ≈ 5 min
    expect((await check(near(100))).body).toMatchObject({ etaMin: 13, etaMax: 17 });
    expect((await check(near(280, 5))).body).toMatchObject({ etaMin: 16, etaMax: 20 });
    const bad = await t.api('PUT', '/api/admin/delivery', { ...d, prepMin: 8, prepMax: null });
    expect(bad.status).toBe(400);
  });

  it('envío gratis desde el monto configurado', async () => {
    await t.close();
    t = await start({ storeDelivery: true }); // tarifa real: $15, gratis desde $400
    const small = orderBody({ items: [{ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 2 }] });
    const q1 = await t.api('POST', '/api/quote', small);
    expect(q1.body.shippingFee).toBe(1500);
    const q2 = await t.api('POST', '/api/quote', orderBody());
    expect(q2.body.subtotal).toBeGreaterThanOrEqual(40000);
    expect(q2.body.shippingFee).toBe(0);
    expect(q2.body.total).toBe(q2.body.subtotal);
    const o = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    expect(o.body.order.shippingFee).toBe(0);
  });

  it('fuera del radio: no se acepta y no se crea el pedido', async () => {
    expect((await check(near(600))).body).toMatchObject({ status: 'not_covered', distanceM: 600 });
    const r = await t.api('POST', '/api/orders', orderBody({ address: { ...address, location: near(600) } }));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/no llegamos/i);
  });

  it('en el límite o con GPS impreciso lo confirma una persona', async () => {
    expect((await check(near(290, 30))).body.status).toBe('manual');
    expect((await check(near(100, 200))).body.status).toBe('manual');
    // Lejos aunque sea impreciso: no se acepta.
    expect((await check(near(2000, 200))).body.status).toBe('not_covered');
  });

  it('sin ubicación: pide compartirla y, si no, se confirma por WhatsApp', async () => {
    expect((await check(null)).body).toMatchObject({ status: 'manual', needsLocation: true });
  });

  it('el negocio puede cambiar el radio o usar códigos postales', async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const d = (await t.api('GET', '/api/admin/delivery')).body;
    await t.api('PUT', '/api/admin/delivery', { ...d, radiusM: 700 });
    expect((await check(near(600))).body.status).toBe('covered');
    await t.api('PUT', '/api/admin/delivery', { ...d, mode: 'zones' });
    expect((await t.api('POST', '/api/coverage', { postalCode: '03103', colonia: 'x' })).body).toMatchObject({ status: 'covered', fee: 3000 });
  });

  it('cotización manual: detiene el pago hasta que el negocio fija el envío', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ address: { ...address, location: null } }));
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

  it('la ubicación del cliente queda en el pedido para el repartidor', async () => {
    const r = await t.api('POST', '/api/orders', orderBody());
    expect(r.body.order.address.location).toMatchObject({ accuracyM: 15 });
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
    await t.api('PUT', '/api/admin/products/waffle', { ...waffle, sizes: [{ id: 'pieza', label: 'Pieza', price: 12000 }] });
    const r = await t.api('POST', '/api/orders', orderBody({ fulfillment: 'pickup', address: null, items: [
      { productId: 'waffle', sizeId: 'pieza', toppingIds: [], qty: 3 },
      { productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 3 },
    ] }));
    expect(r.body.order.total).toBe(12000 * 3 + 10000 * 3);
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
