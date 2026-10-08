import { afterEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); t = undefined as any; });

const create = () => t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
const adminId = async (number: string) => {
  await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
  return (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((o: any) => o.number === number).id;
};

describe('el cliente cancela su pedido', () => {
  it('antes de prepararse: se cancela, queda en el historial y el panel recibe aviso', async () => {
    t = await start();
    const o = await create();
    const r = await t.api('POST', `/api/orders/${o.body.number}/cancel`, { t: o.body.token });
    expect(r.status).toBe(200);
    expect(r.body.order.orderStatus).toBe('cancelado');
    const id = await adminId(o.body.number);
    const detail = (await t.api('GET', `/api/admin/orders/${id}`)).body.order;
    expect(detail.events.some((e: any) => e.actor === 'cliente' && e.detail === 'Cancelado por el cliente')).toBe(true);
    const summary = (await t.api('GET', '/api/admin/summary')).body;
    expect(summary.canceladosCliente.map((c: any) => c.number)).toContain(o.body.number);
    const push = t.ctx.notifier.pushOutbox.find((p) => p.title.startsWith('❌'));
    expect(push?.title).toBe(`❌ Ana Prueba canceló ${o.body.number}`);
    // Repetir no vuelve a avisar.
    await t.api('POST', `/api/orders/${o.body.number}/cancel`, { t: o.body.token });
    expect(t.ctx.notifier.pushOutbox.filter((p) => p.title.startsWith('❌'))).toHaveLength(1);
  });

  it('ya en preparación no se puede cancelar', async () => {
    t = await start();
    const o = await create();
    const id = await adminId(o.body.number);
    expect((await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'en_preparacion' })).status).toBe(200);
    const r = await t.api('POST', `/api/orders/${o.body.number}/cancel`, { t: o.body.token });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('too_late');
    expect(r.body.error).toMatch(/ya se está preparando/);
  });

  it('sin el token del pedido no se puede cancelar', async () => {
    t = await start();
    const o = await create();
    expect((await t.api('POST', `/api/orders/${o.body.number}/cancel`, { t: 'otro-token' })).status).toBe(404);
  });
});
