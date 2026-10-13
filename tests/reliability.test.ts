import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NOW, TINY_JPEG, orderBody, start } from './helpers';
import { syncPayment } from '../server/payments/service';
import { sweep, MAX_REMINDERS } from '../server/sweep';

/** Auditoría de confiabilidad: cada escenario con base de prueba (PGlite) y pagos simulados. Nada real se cobra. */
let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const count = async (sql: string, p: unknown[] = []) => (await t.ctx.db.one<{ n: number }>(sql, p))!.n;
const cash = (over: object = {}) => orderBody({ paymentMethod: 'contra_entrega', ...over });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(t.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
const adminId = async (number: string) => (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((o: any) => o.number === number).id;
const item = (productId: string, sizeId: string) => ({ productId, sizeId, toppingIds: [], qty: 1 });

describe('creación de pedidos', () => {
  it('doble clic en «Confirmar»: dos solicitudes simultáneas → un solo pedido', async () => {
    const body = cash();
    const [a, b] = await Promise.all([post('/api/orders', body), post('/api/orders', body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.number).toBe(b.body.number);
    expect(await count('select count(*)::int n from office.orders')).toBe(1);
    // Un solo aviso al negocio y una sola «compra» medida.
    expect(t.ctx.notifier.sent.filter((s) => s.number === a.body.number)).toHaveLength(1);
    expect(await count("select count(*)::int n from office.analytics_events where event = 'compra'")).toBe(1);
  });

  it('reintento tras un timeout: misma llave → el mismo pedido, sin duplicar', async () => {
    const body = cash();
    const first = await post('/api/orders', body);
    const retry = await post('/api/orders', body);
    expect(retry).toMatchObject({ status: 200, body: { number: first.body.number, token: first.body.token } });
    expect(await count('select count(*)::int n from office.orders')).toBe(1);
  });

  it('se guardó pero se perdió la respuesta, y el reintento llega desde otro navegador/UA: sigue siendo el mismo pedido', async () => {
    const body = cash();
    const saved = await post('/api/orders', body, { 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile' });
    // El cliente nunca recibió esto. Reintenta con la misma llave y otro User-Agent (dato que deduce el servidor).
    const retry = await post('/api/orders', body, { 'User-Agent': 'Mozilla/5.0 (Macintosh)' });
    expect(retry.status).toBe(200);
    expect(retry.body.number).toBe(saved.body.number);
    expect(await count('select count(*)::int n from office.orders')).toBe(1);
  });

  it('misma llave con otro contenido: no crea otro; responde cuál pedido ya existe', async () => {
    const body = cash();
    const saved = await post('/api/orders', body);
    const changed = await post('/api/orders', { ...body, notes: 'otra cosa' });
    expect(changed).toMatchObject({ status: 409, body: { code: 'idempotency_mismatch', number: saved.body.number, token: saved.body.token } });
    expect(await count('select count(*)::int n from office.orders')).toBe(1);
  });

  it('precios: el navegador no decide; si el total cambió desde que lo vio, no se crea (409 con el nuevo total)', async () => {
    const q = (await t.api('POST', '/api/quote', cash())).body;
    const bad = await post('/api/orders', cash({ expectedTotal: q.total - 1000, subtotal: 1, total: 1 }));
    expect(bad).toMatchObject({ status: 409, body: { code: 'total_changed', total: q.total } });
    const ok = await post('/api/orders', cash({ expectedTotal: q.total }));
    expect(ok.status).toBe(201);
    expect(ok.body.order.total).toBe(q.total);
  });
});

describe('pagos', () => {
  async function onlineOrder() {
    const r = await post('/api/orders', orderBody());
    const id = (await t.ctx.db.one<{ id: string }>('select id from office.orders where number = $1', [r.body.number]))!.id;
    return { ...r.body, id };
  }
  const mp = (externalReference: string, status: string, amount: number, id = 'pay-1') => ({ id, status, statusDetail: status, amount, currency: 'MXN', externalReference, raw: { status } });

  it('avisos de Mercado Pago fuera de orden: un «pendiente» viejo no deshace un «aprobado» ni duplica el aviso', async () => {
    const o = await onlineOrder();
    await syncPayment(t.ctx, mp(o.id, 'approved', o.order.total), 'test');
    await syncPayment(t.ctx, mp(o.id, 'pending', o.order.total), 'test'); // llega tarde
    await syncPayment(t.ctx, mp(o.id, 'approved', o.order.total), 'test'); // repetido
    const row = await t.ctx.db.one<any>('select payment_status, order_status from office.orders where id = $1', [o.id]);
    expect(row).toEqual({ payment_status: 'aprobado', order_status: 'recibido' });
    expect(t.ctx.notifier.sent.filter((s) => s.kind === 'pedido_pagado')).toHaveLength(1);
  });

  it('cobro doble (dos pagos aprobados): queda en revisión y con reembolso pendiente', async () => {
    const o = await onlineOrder();
    await syncPayment(t.ctx, mp(o.id, 'approved', o.order.total, 'pay-1'), 'test');
    await syncPayment(t.ctx, mp(o.id, 'approved', o.order.total, 'pay-2'), 'test');
    const row = await t.ctx.db.one<any>('select needs_review, refund_status from office.orders where id = $1', [o.id]);
    expect(row.needs_review).toMatch(/2 pagos aprobados/);
    expect(row.refund_status).toBe('pendiente');
    // Un aviso posterior del mismo pago no borra la revisión.
    await syncPayment(t.ctx, mp(o.id, 'approved', o.order.total, 'pay-2'), 'test');
    expect((await t.ctx.db.one<any>('select needs_review from office.orders where id = $1', [o.id])).needs_review).toMatch(/2 pagos/);
  });

  it('registrar el mismo cobro en efectivo dos veces (doble toque / reintento): una sola vez', async () => {
    await login();
    const r = await post('/api/orders', cash());
    const id = await adminId(r.body.number);
    const [a, b] = await Promise.all([
      t.api('POST', `/api/admin/orders/${id}/collected`, { received: r.body.order.total + 1000, by: 'Lali' }),
      t.api('POST', `/api/admin/orders/${id}/collected`, { received: r.body.order.total + 1000, by: 'Lali' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await count("select count(*)::int n from office.order_events where order_id = $1 and type = 'pago' and detail like 'Cobrado%'", [id])).toBe(1);
  });
});

describe('estados del pedido', () => {
  it('transiciones inválidas se rechazan', async () => {
    await login();
    const c = await post('/api/orders', cash({ fulfillment: 'pickup', address: null }));
    const cid = await adminId(c.body.number);
    expect((await t.api('POST', `/api/admin/orders/${cid}/status`, { status: 'en_camino' })).status).toBe(409); // recoger no va en camino
    await t.api('POST', `/api/admin/orders/${cid}/status`, { status: 'cancelado' });
    expect((await t.api('POST', `/api/admin/orders/${cid}/status`, { status: 'recibido' })).status).toBe(409); // cancelado es final
    expect((await t.api('POST', `/api/admin/orders/${cid}/collect-pending`, { reason: 'Lo cobra recepción', by: 'Lali' })).status).toBe(409);
    const online = await post('/api/orders', orderBody());
    const oid = await adminId(online.body.number);
    expect((await t.api('POST', `/api/admin/orders/${oid}/status`, { status: 'en_preparacion' })).status).toBe(409); // sin pago
    const d = await post('/api/orders', cash());
    const did = await adminId(d.body.number);
    expect((await t.api('POST', `/api/admin/orders/${did}/status`, { status: 'entregado' })).body.code).toBe('photo_required');
    expect((await t.api('POST', `/api/admin/orders/${did}/status`, { status: 'volando' })).status).toBe(400);
  });

  it('se corta la red durante la entrega y se reintenta: sin eventos duplicados ni cobro doble', async () => {
    await login();
    const d = await post('/api/orders', cash());
    const id = await adminId(d.body.number);
    for (const s of ['en_preparacion', 'en_camino']) await t.api('POST', `/api/admin/orders/${id}/status`, { status: s });
    await t.upload(`/api/admin/orders/${id}/delivery-photo`, TINY_JPEG);
    await t.upload(`/api/admin/orders/${id}/delivery-photo`, TINY_JPEG); // reintento de la foto
    for (let i = 0; i < 3; i++) await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'entregado' }); // reintentos
    for (let i = 0; i < 2; i++) await t.api('POST', `/api/admin/orders/${id}/collected`, { by: 'Lali' });
    expect(await count("select count(*)::int n from office.order_events where order_id = $1 and type = 'estado' and detail = 'entregado'", [id])).toBe(1);
    expect(await count("select count(*)::int n from office.order_events where order_id = $1 and type = 'pago'", [id])).toBe(1);
    const o = (await t.api('GET', `/api/admin/orders/${id}`)).body.order;
    expect(o).toMatchObject({ orderStatus: 'entregado', paymentStatus: 'aprobado', collectedBy: 'Lali' });
  });
});

describe('pedido de equipo', () => {
  async function group() {
    return (await t.api('POST', '/api/groups', { name: 'Ventas', organizerName: 'Ana', closesInMinutes: null })).body as { code: string; adminToken: string };
  }

  it('20 participantes agregan al mismo tiempo: no se pierde ni duplica nada', async () => {
    const g = await group();
    const adds = Array.from({ length: 20 }, (_, i) =>
      post(`/api/groups/${g.code}/items`, { memberName: `P${i}`, memberKey: `key-participante-${i}`, line: item('clasica', 'chico'), itemId: randomUUID() }),
    );
    const res = await Promise.all(adds);
    expect(res.every((r) => r.status === 201)).toBe(true);
    const v = (await t.api('GET', `/api/groups/${g.code}`)).body;
    expect(v.items).toHaveLength(20);
    expect(v.participants).toHaveLength(20);
  });

  it('cierre mientras otro agrega: lo que entra después del cierre se rechaza; el pedido = exactamente lo del grupo', async () => {
    const g = await group();
    await post(`/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    const [late, closed] = await Promise.all([
      post(`/api/groups/${g.code}/items`, { memberName: 'Sofía', memberKey: 'key-sofi-123456', line: item('uvas', 'chico') }),
      post(`/api/groups/${g.code}/close`, { adminToken: g.adminToken }),
    ]);
    expect(closed.status).toBe(200);
    expect([201, 409]).toContain(late.status); // o entró antes del cierre, o se rechazó: nunca después
    const after = await post(`/api/groups/${g.code}/items`, { memberName: 'Tardío', memberKey: 'key-tarde-12345', line: item('clasica', 'chico') });
    expect(after).toMatchObject({ status: 409, body: { code: 'group_closed' } });
    const ref = { code: g.code, token: g.adminToken };
    const q = (await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items: [], group: ref })).body;
    const o = await post('/api/orders', cash({ fulfillment: 'pickup', address: null, items: [], group: ref, expectedTotal: q.total }));
    expect(o.status).toBe(201);
    const inGroup = (await t.api('GET', `/api/groups/${g.code}`)).body.items.length;
    expect(o.body.order.items.reduce((n: number, l: any) => n + l.qty, 0)).toBe(inGroup);
  });

  it('el organizador quita algo después de ver el total: no se cobra un total distinto', async () => {
    const g = await group();
    await post(`/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    await post(`/api/groups/${g.code}/items`, { memberName: 'Sofía', memberKey: 'key-sofi-123456', line: item('uvas', 'chico') });
    const ref = { code: g.code, token: g.adminToken };
    const q = (await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items: [], group: ref })).body;
    const [sofia] = (await t.api('GET', `/api/groups/${g.code}`)).body.items.filter((i: any) => i.memberName === 'Sofía');
    await post(`/api/groups/${g.code}/items/${sofia.id}/delete`, { adminToken: g.adminToken });
    const o = await post('/api/orders', cash({ fulfillment: 'pickup', address: null, items: [], group: ref, expectedTotal: q.total }));
    expect(o).toMatchObject({ status: 409, body: { code: 'total_changed' } });
  });

  it('un participante no puede cerrar, reabrir, cotizar ni pagar como organizador', async () => {
    const g = await group();
    await post(`/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    const fake = { code: g.code, token: 'key-luis-123456' };
    expect((await post(`/api/groups/${g.code}/close`, { adminToken: 'key-luis-123456' })).status).toBe(403);
    expect((await post(`/api/groups/${g.code}/reopen`, { adminToken: 'key-luis-123456' })).status).toBe(403);
    expect((await post('/api/quote', { fulfillment: 'pickup', address: null, items: [], group: fake })).status).toBe(403);
    expect((await post('/api/orders', cash({ fulfillment: 'pickup', address: null, items: [], group: fake }))).status).toBe(403);
    expect(await count('select count(*)::int n from office.orders')).toBe(0);
  });

  it('dos «pagar» del organizador al mismo tiempo (dos llaves): un solo pedido para el grupo', async () => {
    const g = await group();
    await post(`/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    const ref = { code: g.code, token: g.adminToken };
    const [a, b] = await Promise.all([
      post('/api/orders', cash({ fulfillment: 'pickup', address: null, items: [], group: ref })),
      post('/api/orders', cash({ fulfillment: 'pickup', address: null, items: [], group: ref })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await count('select count(*)::int n from office.orders')).toBe(1);
  });
});

describe('avisos: si falla la notificación, el barrido vuelve a avisar sin duplicar', () => {
  it('pedido sin abrir: recordatorio a los 3 min, no antes; uno cada 10 min; máximo 6', async () => {
    const r = await post('/api/orders', cash());
    // El reloj de la prueba está fijo: la hora del pedido se alinea con él.
    await t.ctx.db.query('update office.orders set created_at = $1 where number = $2', [NOW, r.body.number]);
    t.ctx.notifier.pushOutbox.length = 0; // el aviso original «se perdió»
    const at = (min: number) => (t.ctx.now = () => new Date(Date.parse(NOW) + min * 60000));
    at(1);
    expect((await sweep(t.ctx)).reminded).toBe(0);
    at(4);
    expect((await sweep(t.ctx)).reminded).toBe(1);
    const [a, b] = await Promise.all([sweep(t.ctx), sweep(t.ctx)]); // dos instancias a la vez
    expect(a.reminded + b.reminded).toBe(0);
    expect(t.ctx.notifier.pushOutbox.map((p) => p.title)).toEqual([`⏰ ${r.body.number} sin atender (4 min)`]);
    for (let m = 15; m < 200; m += 11) { at(m); await sweep(t.ctx); }
    expect(await count("select count(*)::int n from office.order_events where type = 'recordatorio'")).toBe(MAX_REMINDERS);
    // Al abrirlo en el panel, deja de recordar.
    await login();
    await t.api('POST', `/api/admin/orders/${await adminId(r.body.number)}/seen`, {});
    at(300);
    expect((await sweep(t.ctx)).reminded).toBe(0);
  });

  it('el endpoint del barrido externo exige la clave', async () => {
    expect((await t.api('GET', '/api/cron/sweep')).status).toBe(401);
  });
});
