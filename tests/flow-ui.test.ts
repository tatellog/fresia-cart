import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextAction } from '../shared/flow';
import { orderBody, start } from './helpers';

const base = { fulfillment: 'delivery' as const, paymentMethod: 'contra_entrega' as const, paymentStatus: 'por_cobrar' as const, total: 33000 };

describe('un solo botón con la siguiente acción', () => {
  it('a domicilio: preparar → salir a entregar → entregado y cobrado', () => {
    expect(nextAction({ ...base, orderStatus: 'recibido' })?.label).toBe('👩‍🍳 Empezar a preparar');
    expect(nextAction({ ...base, orderStatus: 'confirmado' })?.status).toBe('en_preparacion');
    expect(nextAction({ ...base, orderStatus: 'en_preparacion' })?.label).toBe('🛵 Salir a entregar');
    expect(nextAction({ ...base, orderStatus: 'en_camino' })).toMatchObject({ status: 'entregado', label: '✅ Entregado y cobrado $330', collect: true });
    expect(nextAction({ ...base, orderStatus: 'entregado' })).toBeNull();
  });
  it('para recoger: preparar → listo → entregado', () => {
    const p = { ...base, fulfillment: 'pickup' as const };
    expect(nextAction({ ...p, orderStatus: 'en_preparacion' })?.label).toBe('🛍️ Listo para recoger');
    expect(nextAction({ ...p, orderStatus: 'listo' })?.status).toBe('entregado');
  });
  it('pagado en línea: entregado sin cobrar; pago pendiente: no se prepara', () => {
    const paid = { ...base, paymentMethod: 'online' as const, paymentStatus: 'aprobado' as const };
    expect(nextAction({ ...paid, orderStatus: 'en_camino' })).toMatchObject({ label: '✅ Entregado', collect: false });
    expect(nextAction({ ...paid, paymentStatus: 'sin_pagar', orderStatus: 'esperando_pago' })).toBeNull();
  });
});

describe('seguimiento en vivo', () => {
  let t: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { t = await start(); });
  afterEach(async () => { await t.close(); });

  it('el repartidor comparte ubicación solo en camino; el cliente la ve con su token; al entregar se borra', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders[0].id;
    const here = { lat: 19.3975, lng: -99.1712, accuracyM: 8 };

    expect((await t.api('POST', `/api/admin/orders/${id}/tracking`, here)).status).toBe(409);
    await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'en_camino' });
    expect((await t.api('POST', `/api/admin/orders/${id}/tracking`, here)).status).toBe(200);

    const tr = await t.api('GET', `/api/orders/${r.body.number}/tracking?t=${r.body.token}`);
    expect(tr.body).toMatchObject({ active: true, courier: { lat: 19.3975, lng: -99.1712, accuracyM: 8 }, store: { lat: 19.39725, lng: -99.1712 } });
    expect(tr.body.destination).toMatchObject({ lng: -99.1712 });
    expect((await t.api('GET', `/api/orders/${r.body.number}/tracking?t=otro`)).status).toBe(404);

    await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'entregado' });
    const after = await t.api('GET', `/api/orders/${r.body.number}/tracking?t=${r.body.token}`);
    expect(after.body).toMatchObject({ active: false, courier: null });
    const { n } = (await t.ctx.db.one<{ n: number }>('select count(*)::int as n from office.order_tracking'))!;
    expect(n).toBe(0);
  });

  it('el cliente no puede mandar ubicaciones del repartidor', async () => {
    expect((await t.api('POST', '/api/admin/orders/x/tracking', { lat: 1, lng: 1, accuracyM: 1 })).status).toBe(401);
  });
});
