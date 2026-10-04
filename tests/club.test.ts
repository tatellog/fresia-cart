import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { orderBody, start } from './helpers';

// Frésia Club falso: guarda los sellos por teléfono e ignora pedidos repetidos.
async function fakeClub() {
  const stamped = new Set<string>();
  const calls: { path: string; auth: string; body: any }[] = [];
  let visits = 3;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ path: req.url!, auth: req.headers.authorization ?? '', body });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer clave-club') return res.writeHead(401).end('{}');
      const key = String(body.phone).replace(/\D/g, '').slice(-10);
      if (key !== '5512345678') return res.end(JSON.stringify({ found: false, joinUrl: 'https://club.test' }));
      let extra = {};
      if (req.url!.endsWith('/online-order')) {
        if (stamped.has(body.orderNumber)) extra = { alreadyStamped: true };
        else { stamped.add(body.orderNumber); visits++; extra = { stamped: true }; }
      }
      res.end(JSON.stringify({ found: true, name: 'Ana', visits, goal: 10, rewardsPending: 0, cardUrl: 'https://club.test/c/x', ...extra }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let t: Awaited<ReturnType<typeof start>>;
let club: Awaited<ReturnType<typeof fakeClub>>;
afterEach(async () => { await t?.close(); await club?.close(); });

const pickup = (phone = '55 1234 5678') =>
  orderBody({ fulfillment: 'pickup', address: null, paymentMethod: 'contra_entrega', customer: { name: 'Ana Prueba', phone } });

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Frésia Club', () => {
  it('sin conectar: el pedido no muestra tarjeta', async () => {
    t = await start();
    const o = await t.api('POST', '/api/orders', pickup());
    const r = await t.api('GET', `/api/orders/${o.body.number}/club?t=${o.body.token}`);
    expect(r.status).toBe(200);
    expect(r.body.club).toBeNull();
  });

  it('el cliente ve sus sellos solo con el token del pedido', async () => {
    club = await fakeClub();
    t = await start({ clubUrl: club.url, clubSecret: 'clave-club' });
    const o = await t.api('POST', '/api/orders', pickup());
    expect((await t.api('GET', `/api/orders/${o.body.number}/club?t=otro`)).status).toBe(404);
    const r = await t.api('GET', `/api/orders/${o.body.number}/club?t=${o.body.token}`);
    expect(r.body, JSON.stringify(r.body)).toHaveProperty('club');
    expect(r.body.club).toMatchObject({ found: true, visits: 3, goal: 10 });
    expect(club.calls[0]).toMatchObject({ path: '/api/integrations/lookup', auth: 'Bearer clave-club' });

    const otro = await t.api('POST', '/api/orders', pickup('55 9999 0000'));
    const r2 = await t.api('GET', `/api/orders/${otro.body.number}/club?t=${otro.body.token}`);
    expect(r2.body.club).toEqual({ found: false, joinUrl: 'https://club.test' });
  });

  it('al entregar se suma un sello una sola vez y queda en el historial', async () => {
    club = await fakeClub();
    t = await start({ clubUrl: club.url, clubSecret: 'clave-club' });
    const o = await t.api('POST', '/api/orders', pickup());
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((x: any) => x.number === o.body.number).id;
    for (const s of ['en_preparacion', 'listo']) expect((await t.api('POST', `/api/admin/orders/${id}/status`, { status: s })).status).toBe(200);
    expect(club.calls.filter((c) => c.path.endsWith('/online-order'))).toHaveLength(0);

    expect((await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'entregado' })).status).toBe(200);
    const ev = await waitFor(async () => {
      const r = await t.api('GET', `/api/admin/orders/${id}`);
      return r.body.order.events.find((e: any) => e.type === 'club');
    });
    expect(ev.detail).toBe('Sello sumado (4/10)');
    // Repetir «entregado» no vuelve a sellar.
    await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'entregado' });
    await new Promise((r) => setTimeout(r, 150));
    const stamps = club.calls.filter((c) => c.path.endsWith('/online-order'));
    expect(stamps).toHaveLength(1);
    expect(stamps[0].body).toEqual({ phone: '5512345678', orderNumber: o.body.number });
  });

  it('si el club no responde, el pedido se entrega igual y queda anotado', async () => {
    t = await start({ clubUrl: 'http://127.0.0.1:1', clubSecret: 'clave-club' });
    const o = await t.api('POST', '/api/orders', pickup());
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((x: any) => x.number === o.body.number).id;
    const r = await t.api('POST', `/api/admin/orders/${id}/status`, { status: 'entregado' });
    expect(r.status).toBe(200);
    const ev = await waitFor(async () => {
      const a = await t.api('GET', `/api/admin/orders/${id}`);
      return a.body.order.events.find((e: any) => e.type === 'club');
    });
    expect(ev.detail).toMatch(/no respondió/);
  });
});
