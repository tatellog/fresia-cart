import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TINY_JPEG, address, orderBody, start, tick } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const adminOrder = async (number: string) => (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((o: any) => o.number === number);

describe('pagar al recibir', () => {
  it('el pedido entra directo a la cocina, sin pasar por Mercado Pago', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({ paymentMethod: 'contra_entrega', paymentStatus: 'por_cobrar', orderStatus: 'recibido', canPay: false });
    expect((await t.api('POST', `/api/orders/${r.body.number}/checkout`, { t: r.body.token })).status).toBe(409);
    expect(t.ctx.notifier.sent).toContainEqual({ kind: 'pedido_contra_entrega', number: r.body.number });
  });

  it('el negocio lo avanza y registra el cobro al entregar', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    await login();
    const o = await adminOrder(r.body.number);
    for (const s of ['confirmado', 'en_preparacion', 'listo', 'en_camino']) {
      expect((await t.api('POST', `/api/admin/orders/${o.id}/status`, { status: s })).body.order.orderStatus).toBe(s);
    }
    expect((await t.upload(`/api/admin/orders/${o.id}/delivery-photo`, TINY_JPEG)).status).toBe(200);
    expect((await t.api('POST', `/api/admin/orders/${o.id}/status`, { status: 'entregado' })).body.order.orderStatus).toBe('entregado');
    const c = await t.api('POST', `/api/admin/orders/${o.id}/collected`, {});
    expect(c.body.order.paymentStatus).toBe('aprobado');
  });

  it('no se puede marcar cobrado un pedido pagado en línea', async () => {
    const r = await t.api('POST', '/api/orders', orderBody());
    await login();
    const o = await adminOrder(r.body.number);
    expect((await t.api('POST', `/api/admin/orders/${o.id}/collected`, {})).status).toBe(409);
  });

  it('con envío por confirmar: espera la cotización y luego entra a la cocina', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', address: { ...address, location: null } }));
    expect(r.body.order.orderStatus).toBe('cotizando_envio');
    await login();
    const o = await adminOrder(r.body.number);
    const q = await t.api('POST', `/api/admin/orders/${o.id}/shipping`, { fee: 2000, etaText: '20 min' });
    expect(q.body.order).toMatchObject({ orderStatus: 'recibido', paymentStatus: 'por_cobrar' });
    expect(t.ctx.notifier.sent).toContainEqual({ kind: 'pedido_contra_entrega', number: r.body.number });
  });

  it('el negocio puede desactivar un método de pago', async () => {
    await login();
    const d = (await t.api('GET', '/api/admin/delivery')).body;
    await t.api('PUT', '/api/admin/delivery', { ...d, cashOnDelivery: false });
    expect((await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }))).status).toBe(422);
    expect((await t.api('PUT', '/api/admin/delivery', { ...d, cashOnDelivery: false, onlinePayment: false })).status).toBe(400);
  });
});

describe('aviso al panel (push)', () => {
  const push = (number: string) => t.ctx.notifier.pushOutbox.find((m) => m.title.includes(number));

  it('pedido pagado al recibir: dice cuánto cobrar', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    await tick(50);
    expect(push(r.body.number)!.body).toContain('💵 COBRAR EN EFECTIVO $756 · Monto con el que paga: no indicado'); // $726 + $30 de envío
    expect(push(r.body.number)!.url).toMatch(/^\/admin\/pedidos\//);
  });

  it('pedido pagado en línea: avisa cuando el pago se confirma, no antes', async () => {
    const c = await t.api('POST', '/api/orders', orderBody());
    await tick(50);
    expect(push(c.body.number)).toBeUndefined();
    const co = await t.api('POST', `/api/orders/${c.body.number}/checkout`, { t: c.body.token });
    await t.api('POST', `/api/demo/preferences/${co.body.checkoutUrl.split('/').pop()}/pay`, { outcome: 'approved' });
    await tick(80);
    expect(push(c.body.number)!.body).toContain('✅ PAGADO en línea: $');
  });
});

describe('efectivo al recibir: ¿cobrar o ya está pagado?', () => {
  it('con cuánto paga y cuánto cambio llevar', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', cashTendered: 80000 }));
    expect(r.status).toBe(201);
    expect(r.body.order.cashTendered).toBe(80000);
    await tick(50);
    const msg = t.ctx.notifier.pushOutbox.find((m) => m.title.includes(r.body.number))!;
    expect(msg.body).toContain('💵 COBRAR EN EFECTIVO $756 · Paga con $800 → llevar $44 de cambio');
  });

  it('monto exacto', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', cashTendered: 75600 }));
    await tick(50);
    expect(t.ctx.notifier.pushOutbox.find((m) => m.title.includes(r.body.number))!.body).toContain('Paga con el monto exacto');
  });

  it('no acepta un billete menor al total', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', cashTendered: 50000 }));
    expect(r.status).toBe(422);
  });

  it('al recoger no se guarda billete (puede pagar con terminal en el local)', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', fulfillment: 'pickup', address: null, cashTendered: 100000 }));
    expect(r.body.order.cashTendered).toBeNull();
  });

  it('después de «Marcar cobrado» el panel dice COBRADO', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', cashTendered: 80000 }));
    await login();
    const o = await adminOrder(r.body.number);
    const { collectInfo } = await import('../shared/status');
    const { money } = await import('../shared/money');
    expect(collectInfo(o, money)).toMatchObject({ tone: 'collect', label: 'COBRAR EN EFECTIVO $756', change: 4400 });
    const c = (await t.api('POST', `/api/admin/orders/${o.id}/collected`, {})).body.order;
    expect(collectInfo(c, money)).toMatchObject({ tone: 'paid', label: 'COBRADO' });
  });
});

describe('producción sin Mercado Pago', () => {
  let p: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { p = await start({ production: true }); });
  afterEach(async () => { await p.close(); });

  it('no ofrece ni acepta el pago en línea simulado', async () => {
    const menu = (await p.api('GET', '/api/menu')).body;
    expect(menu.delivery.onlinePayment).toBe(false);
    expect(menu.delivery.cashOnDelivery).toBe(true);
    const r = await p.api('POST', '/api/orders', orderBody({ paymentMethod: 'online' }));
    expect(r.status).toBe(422);
    expect((await p.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }))).status).toBe(201);
  });

  it('no deja apagar el pago al recibir mientras no haya Mercado Pago', async () => {
    await p.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const d = (await p.api('GET', '/api/admin/delivery')).body;
    const r = await p.api('PUT', '/api/admin/delivery', { ...d, cashOnDelivery: false });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Mercado Pago/);
  });
});
