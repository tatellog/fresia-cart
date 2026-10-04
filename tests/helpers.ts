import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import type { Config } from '../server/env';

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0, publicUrl: 'http://localhost:9999', databaseUrl: '', pglitePath: 'memory://', adminPassword: 'secreto-de-prueba',
    sessionSecret: 'x'.repeat(32), production: false, mpAccessToken: '', mpWebhookSecret: '', notifyWebhookUrl: '',
    whatsappProvider: '', whatsappNotifyTo: '', callmebotApiKey: '', metaWhatsappToken: '', metaWhatsappPhoneNumberId: '', metaWhatsappTemplate: '', metaWhatsappTemplateLang: 'es_MX', metaWhatsappTemplateButton: true, vapidPublicKey: '', vapidPrivateKey: '', clubUrl: '', clubSecret: '',
    ...over,
  };
}

export const NOW = '2026-10-07T20:00:00.000Z';

export async function start(over: Partial<Config> & { now?: string } = {}) {
  const { now: _now, ...cfgOver } = over;
  const cfg = testConfig(cfgOver);
  // Igual que en producción: el servidor opera con el rol de mínimo privilegio.
  const db = await openDb({ pglitePath: cfg.pglitePath });
  await db.query('set role fresia_office_app');
  // Reloj fijo: miércoles 7 oct 2026, 2:00 p.m. en CDMX (abierto).
  const { app, ctx } = await createApp(cfg, { demoWebhookDelayMs: 0, db, now: () => new Date(over.now ?? NOW) });
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
  /** Sube una imagen como lo hace el panel (cuerpo binario). */
  async function upload(path: string, bytes: Uint8Array, type = 'image/jpeg') {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': type, ...(cookie ? { cookie } : {}) }, body: bytes });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  return { api, upload, ctx, base, close: async () => { await new Promise<void>((r) => server.close(() => r())); await ctx.db.close(); } };
}

// Frésia está en 19.39725, -99.1712. 1 m de latitud ≈ 1/111195 grados.
export const near = (meters: number, accuracyM = 15) => ({ lat: 19.39725 + meters / 111195, lng: -99.1712, accuracyM });
export const address = {
  street: 'Calle de ejemplo', number: '123', colonia: 'Del Valle Norte', postalCode: '03103', office: 'Piso 4, oficina 402', references: 'Recepción',
  location: near(100),
};

export function orderBody(over: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    customer: { name: 'Ana Prueba', phone: '55 1234 5678' },
    fulfillment: 'delivery',
    address,
    notes: '',
    items: [
      // 2 incluidos + granola adicional ($18): $120 + $18 = $138 c/u
      { productId: 'clasica', sizeId: 'mediano', toppingIds: ['nuez', 'coco', 'granola'], qty: 3, forWhom: 'Ana' },
      // Waffle $104: el Turín (premium) entra como incluido
      { productId: 'waffle', sizeId: 'pieza', toppingIds: ['turin'], qty: 3 },
    ],
    ...over,
  };
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** JPEG mínimo válido (cabecera FF D8 FF … FF D9). */
export const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
