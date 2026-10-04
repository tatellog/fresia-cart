import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { address, orderBody, start, tick } from './helpers';

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
    for (const s of ['confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado']) {
      expect((await t.api('POST', `/api/admin/orders/${o.id}/status`, { status: s })).body.order.orderStatus).toBe(s);
    }
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

describe('aviso por WhatsApp al negocio', () => {
  it('pedido pagado al recibir: llega con productos, entrega, cliente y enlace al panel', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    await tick(50);
    const msg = t.ctx.notifier.whatsappOutbox.find((m) => m.text.includes(r.body.number))!;
    expect(msg.to).toBe('525582330124');
    expect(msg.text).toContain('💵 Paga al recibir: $756'); // $726 + $30 de envío
    expect(msg.text).toContain('*1) 3 × Frésia Clásica · Mediano 16 oz* — $414\n   Para: Ana\n   Toppings: nuez picada, coco rallado, granola artesanal');
    expect(msg.text).toContain('*2) 3 × Waffle Frésia* — $312\n   Toppings: chocolate Turín');
    expect(msg.text).toContain('🛵 *Entrega a domicilio* · 15–25 min\n   Calle de ejemplo 123, Piso 4, oficina 402\n   Del Valle Norte, CP 03103\n   Ref: Recepción\n   📍 https://maps.google.com/?q=');
    expect(msg.text).toContain('👤 Ana Prueba · 55 1234 5678');
    expect(msg.text).toContain('/admin/pedidos/');
    // Plantilla de Meta: 6 variables de una sola línea + id para el botón.
    expect(msg.params).toHaveLength(6);
    expect(msg.params.every((p) => !p.includes('\n'))).toBe(true);
    expect(msg.buttonParam).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('pedido pagado en línea: avisa cuando el pago se confirma, no antes', async () => {
    const c = await t.api('POST', '/api/orders', orderBody());
    await tick(50);
    expect(t.ctx.notifier.whatsappOutbox.some((m) => m.text.includes(c.body.number))).toBe(false);
    const co = await t.api('POST', `/api/orders/${c.body.number}/checkout`, { t: c.body.token });
    await t.api('POST', `/api/demo/preferences/${co.body.checkoutUrl.split('/').pop()}/pay`, { outcome: 'approved' });
    await tick(80);
    const msg = t.ctx.notifier.whatsappOutbox.find((m) => m.text.includes(c.body.number))!;
    expect(msg.text).toContain('✅ Pagado en línea: $');
  });

  it('los combos muestran qué lleva cada pieza', async () => {
    const pick = (slotId: string, productId: string, sizeId: string, n: number, toppingIds: string[] = []) => Array.from({ length: n }, () => ({ slotId, productId, sizeId, toppingIds }));
    const r = await t.api('POST', '/api/orders', orderBody({
      paymentMethod: 'contra_entrega', fulfillment: 'pickup', address: null,
      items: [{ productId: 'dulce-tradicion', sizeId: 'combo', toppingIds: [], choices: [...pick('panes', 'pan-relleno', 'pieza', 3, ['cajeta']), ...pick('panes', 'pan-relleno', 'pieza', 2)], qty: 1, forWhom: 'Equipo' }],
    }));
    await tick(50);
    const msg = t.ctx.notifier.whatsappOutbox.find((m) => m.text.includes(r.body.number))!;
    expect(msg.text).toContain('💵 Paga al recoger');
    expect(msg.text).toContain('🏪 *Recoge en Frésia*');
    expect(msg.text).toContain('*1) Combo Dulce Tradición* — $500\n   Para: Equipo\n   • 3 Pan relleno Frésia: cajeta\n   • 2 Pan relleno Frésia');
    expect(msg.text).not.toContain('Pieza');
    expect(msg.text).not.toContain('📍'); // recoge en tienda: sin ubicación
  });
});
