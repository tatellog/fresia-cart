import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });
const item = (productId: string, sizeId: string) => ({ productId, sizeId, toppingIds: [], qty: 1 });
const pickup = (over: object = {}) => orderBody({ fulfillment: 'pickup', address: null, paymentMethod: 'contra_entrega', ...over });

describe('regresión de la auditoría', () => {
  it('equipo: si alguien agrega después de que el organizador vio el total, NO se cobra otro total (409)', async () => {
    const g = (await t.api('POST', '/api/groups', { name: 'Ventas', organizerName: 'Ana', closesInMinutes: null })).body;
    await t.api('POST', `/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    const ref = { code: g.code, token: g.adminToken };
    const quoted = (await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items: [], group: ref })).body.total;
    await t.api('POST', `/api/groups/${g.code}/items`, { memberName: 'Sofía', memberKey: 'key-sofi-123456', line: item('uvas', 'grande') });
    const r = await t.api('POST', '/api/orders', pickup({ items: [], group: ref, expectedTotal: quoted }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'total_changed', total: 23000 });
    expect((await t.ctx.db.one<any>('select count(*)::int n from office.orders')).n).toBe(0);
  });

  it('equipo: reabrir no deshace un pedido ya hecho; si el pedido se canceló, sí se puede reabrir', async () => {
    const g = (await t.api('POST', '/api/groups', { name: 'Ventas', organizerName: 'Ana', closesInMinutes: null })).body;
    await t.api('POST', `/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    const o = await t.api('POST', '/api/orders', pickup({ items: [], group: { code: g.code, token: g.adminToken } }));
    expect((await t.api('POST', `/api/groups/${g.code}/reopen`, { adminToken: g.adminToken })).status).toBe(409);
    expect((await t.ctx.db.one<any>('select status from office.group_orders where code = $1', [g.code])).status).toBe('pedido');
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((x: any) => x.number === o.body.number).id;
    await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'cancelado' });
    expect((await t.api('POST', `/api/groups/${g.code}/reopen`, { adminToken: g.adminToken })).status).toBe(200);
    expect((await t.api('GET', `/api/groups/${g.code}`)).body.state).toBe('abierto');
  });
});
