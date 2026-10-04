import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import type { Config } from '../server/env';

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0, publicUrl: 'http://localhost:9999', databaseUrl: '', pglitePath: 'memory://', adminPassword: 'secreto-de-prueba',
    sessionSecret: 'x'.repeat(32), production: false, mpAccessToken: '', mpWebhookSecret: '', notifyWebhookUrl: '', ...over,
  };
}

export async function start(over: Partial<Config> = {}) {
  const cfg = testConfig(over);
  // Igual que en producción: el servidor opera con el rol de mínimo privilegio.
  const db = await openDb({ pglitePath: cfg.pglitePath });
  await db.query('set role fresia_office_app');
  const { app, ctx } = await createApp(cfg, { demoWebhookDelayMs: 0, db });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any, headers: res.headers };
  }
  return { api, ctx, base, close: async () => { await new Promise<void>((r) => server.close(() => r())); await ctx.db.close(); } };
}

export const address = { street: 'Calle de ejemplo', number: '123', colonia: 'Del Valle Norte', postalCode: '03103', office: 'Piso 4, oficina 402', references: 'Recepción' };

export function orderBody(over: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    customer: { name: 'Ana Prueba', phone: '55 1234 5678' },
    fulfillment: 'delivery',
    address,
    notes: '',
    items: [
      { productId: 'clasica', sizeId: 'mediana', toppingIds: ['nuez', 'coco'], qty: 2, forWhom: 'Ana' },
      { productId: 'waffle', sizeId: 'unico', toppingIds: [], qty: 1 },
    ],
    ...over,
  };
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
