import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, TINY_JPEG, orderBody, start } from './helpers';
import { urgencyOf, urgencySort } from '../shared/urgency';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });
const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const cash = (over: object = {}) => orderBody({ paymentMethod: 'contra_entrega', ...over });
async function newOrder(body = cash()) {
  const r = await t.api('POST', '/api/orders', body);
  const all = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders;
  return all.find((o: any) => o.number === r.body.number);
}
const status = (id: string, s: string) => t.api('POST', `/api/admin/orders/${id}/status`, { status: s });

describe('entrega y cobro son independientes', () => {
  it('confirmar la entrega NO marca pagado; el pedido sigue en curso hasta registrar el cobro', async () => {
    await login();
    const o = await newOrder(cash({ cashTendered: 100000 }));
    for (const s of ['en_preparacion', 'en_camino']) await status(o.id, s);
    await t.upload(`/api/admin/orders/${o.id}/delivery-photo`, TINY_JPEG);
    const d = (await status(o.id, 'entregado')).body.order;
    expect(d).toMatchObject({ orderStatus: 'entregado', paymentStatus: 'por_cobrar' });
    const active = (await t.api('GET', '/api/admin/orders?filter=activos')).body.orders;
    expect(active.map((x: any) => x.id)).toContain(o.id);
  });

  it('el cobro guarda lo recibido y el cambio; menos del total se rechaza', async () => {
    await login();
    const o = await newOrder();
    const short = await t.api('POST', `/api/admin/orders/${o.id}/collected`, { received: o.total - 100 });
    expect(short.status).toBe(422);
    const r = (await t.api('POST', `/api/admin/orders/${o.id}/collected`, { received: o.total + 24400 })).body.order;
    expect(r).toMatchObject({ paymentStatus: 'aprobado', cashReceived: o.total + 24400, changeGiven: 24400 });
    expect(r.events.find((e: any) => e.type === 'pago').detail).toMatch(/recibió .* cambio \$244/);
    // Registrar el cobro no toca la entrega.
    expect(r.orderStatus).toBe('recibido');
  });
});

describe('recibido → visto → preparando', () => {
  it('abrir el pedido lo marca visto una sola vez; preparar es otro paso', async () => {
    await login();
    const o = await newOrder();
    expect(o.seenAt).toBeNull();
    expect((await t.api('GET', '/api/admin/summary')).body.sinVer).toBe(1);
    await t.api('POST', `/api/admin/orders/${o.id}/seen`, {});
    await t.api('POST', `/api/admin/orders/${o.id}/seen`, {});
    const seen = (await t.api('GET', `/api/admin/orders/${o.id}`)).body.order;
    expect(seen.seenAt).not.toBeNull();
    expect(seen.orderStatus).toBe('recibido');
    expect(seen.events.filter((e: any) => e.type === 'visto')).toHaveLength(1);
    expect((await t.api('GET', '/api/admin/summary')).body.sinVer).toBe(0);
  });
});

describe('urgencia con tiempos reales', () => {
  const base = { orderStatus: 'recibido' as const, fulfillment: 'delivery' as const, paymentMethod: 'contra_entrega' as const, paidAt: null };
  const covered = (etaMax: number) => ({ status: 'covered' as const, zoneId: 'z', zoneName: 'z', fee: 0, etaMin: etaMax - 5, etaMax });

  it('lo antes posible: listo = entrada + preparación; entrega = entrada + tiempo prometido', () => {
    const u = urgencyOf({ ...base, scheduledFor: null, createdAt: '2026-10-07T20:00:00Z', deliveryQuote: covered(25) }, { prepMax: 15 }, new Date('2026-10-07T20:12:00Z'));
    expect(u.readyBy).toBe('2026-10-07T20:15:00.000Z'); // 15 de preparación
    expect(u.dueAt).toBe('2026-10-07T20:25:00.000Z'); // 25 prometidos (10 de camino)
    expect(u).toMatchObject({ minutesLeft: 3, level: 'soon' });
  });

  it('programado a las 12:30 con 10 min de camino: debe estar listo 12:20; si ya pasó, atrasado', () => {
    const o = { ...base, scheduledFor: '2026-10-07T18:30:00Z', createdAt: '2026-10-07T16:00:00Z', deliveryQuote: covered(25) };
    expect(urgencyOf(o, { prepMax: 15 }, new Date('2026-10-07T18:00:00Z'))).toMatchObject({ readyBy: '2026-10-07T18:20:00.000Z', minutesLeft: 20, level: 'ok' });
    expect(urgencyOf(o, { prepMax: 15 }, new Date('2026-10-07T18:25:00Z'))).toMatchObject({ minutesLeft: -5, level: 'late' });
    // Ya va en camino: cuenta la hora de entrega.
    expect(urgencyOf({ ...o, orderStatus: 'en_camino' }, { prepMax: 15 }, new Date('2026-10-07T18:25:00Z'))).toMatchObject({ minutesLeft: 5, level: 'soon' });
  });

  it('sin tiempos de preparación capturados no inventa nada (salvo la hora programada)', () => {
    const asap = urgencyOf({ ...base, fulfillment: 'pickup', scheduledFor: null, createdAt: NOW, deliveryQuote: { status: 'pickup' } }, { prepMax: null }, new Date(NOW));
    expect(asap).toEqual({ dueAt: null, readyBy: null, minutesLeft: null, level: null });
    const sched = urgencyOf({ ...base, fulfillment: 'pickup', scheduledFor: '2026-10-07T21:00:00Z', createdAt: NOW, deliveryQuote: { status: 'pickup' } }, { prepMax: null }, new Date(NOW));
    expect(sched.minutesLeft).toBe(60);
  });

  it('orden de la lista: sin ver primero, después lo más urgente; sin hora al final', () => {
    const mk = (id: string, seen: boolean, left: number | null) => ({ id, orderStatus: 'recibido' as const, seenAt: seen ? NOW : null, createdAt: NOW, urgency: { dueAt: null, readyBy: null, minutesLeft: left, level: null } });
    const sorted = urgencySort([mk('sin-hora', true, null), mk('tarde', true, -5), mk('nuevo', false, 30), mk('luego', true, 40)]);
    expect(sorted.map((o) => o.id)).toEqual(['nuevo', 'tarde', 'luego', 'sin-hora']);
  });
});

describe('efectivo al entregar: recibido o pendiente', () => {
  it('recibido: guarda importe, cambio, quién y la hora', async () => {
    await login();
    const o = await newOrder();
    const r = (await t.api('POST', `/api/admin/orders/${o.id}/collected`, { received: o.total + 1000, by: 'Lali' })).body.order;
    expect(r).toMatchObject({ paymentStatus: 'aprobado', cashReceived: o.total + 1000, changeGiven: 1000, collectedBy: 'Lali' });
    expect(r.paidAt).not.toBeNull();
  });

  it('pendiente: no bloquea, queda destacado en curso hasta registrar el cobro', async () => {
    await login();
    const o = await newOrder();
    expect((await t.api('POST', `/api/admin/orders/${o.id}/collect-pending`, { reason: 'x', by: 'Lali' })).status).toBe(400); // sin motivo real
    const p = (await t.api('POST', `/api/admin/orders/${o.id}/collect-pending`, { reason: 'Lo cobra recepción', by: 'Lali' })).body.order;
    expect(p.collectPending).toMatchObject({ reason: 'Lo cobra recepción (Lali)' });
    expect(p.paymentStatus).toBe('por_cobrar');
    const done = (await t.api('POST', `/api/admin/orders/${o.id}/collected`, { by: 'Tania' })).body.order;
    expect(done).toMatchObject({ paymentStatus: 'aprobado', collectPending: null, collectedBy: 'Tania', changeGiven: 0 });
  });
});

describe('avisos verificados', () => {
  it('el dispositivo confirma que mostró el aviso y si el panel estaba cerrado', async () => {
    await login();
    const sub = { endpoint: 'https://push.example.com/abc123', keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(10) } };
    await t.api('POST', '/api/admin/push/subscribe', { subscription: sub, label: 'iPhone · Safari' });
    expect((await t.api('POST', '/api/push/ack', { endpoint: sub.endpoint, background: true })).status).toBe(204);
    const d = (await t.api('GET', '/api/admin/push')).body.devices[0];
    expect(d).toMatchObject({ label: 'iPhone · Safari', lastReceivedBackground: true });
    expect(d.lastReceivedAt).not.toBeNull();
    // Un endpoint desconocido no hace nada.
    expect((await t.api('POST', '/api/push/ack', { endpoint: 'https://push.example.com/otro', background: true })).status).toBe(204);
  });
});
