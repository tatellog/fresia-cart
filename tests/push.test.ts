import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderBody, start, tick } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' } };

describe('notificaciones push del panel', () => {
  it('cada pedido nuevo genera un aviso corto con lo esencial', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
    await tick(50);
    const p = t.ctx.notifier.pushOutbox.find((x) => x.title.includes(r.body.number))!;
    expect(p.title).toBe(`🍓 Nuevo pedido · paga al recibir · ${r.body.number}`);
    expect(p.body).toBe('Paga al recibir $756 · A domicilio · 6 piezas · Ana Prueba');
    expect(p.url).toMatch(/^\/admin\/pedidos\/[0-9a-f-]{36}$/);
  });

  it('solo el panel con sesión puede registrar dispositivos', async () => {
    expect((await t.api('POST', '/api/admin/push/subscribe', { subscription: sub, label: 'Mac' })).status).toBe(401);
    await login();
    expect((await t.api('POST', '/api/admin/push/subscribe', { subscription: sub, label: 'Mac · Chrome' })).status).toBe(200);
    // Repetir no duplica.
    await t.api('POST', '/api/admin/push/subscribe', { subscription: sub, label: 'Mac · Chrome' });
    const info = (await t.api('GET', '/api/admin/push')).body;
    expect(info.devices).toHaveLength(1);
    expect(info.devices[0].label).toBe('Mac · Chrome');
    await t.api('POST', '/api/admin/push/unsubscribe', { endpoint: sub.endpoint });
    expect((await t.api('GET', '/api/admin/push')).body.devices).toHaveLength(0);
  });

  it('rechaza suscripciones que no son de un servicio push con https', async () => {
    await login();
    const bad = { ...sub, endpoint: 'http://ejemplo.com/x' };
    expect((await t.api('POST', '/api/admin/push/subscribe', { subscription: bad })).status).toBe(400);
  });
});
