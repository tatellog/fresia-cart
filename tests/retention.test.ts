import { afterEach, describe, expect, it } from 'vitest';
import { start } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); });

describe('tarea diaria: latido y fotos de entrega', () => {
  it('sin la clave de Vercel Cron no se ejecuta', async () => {
    t = await start({ cronSecret: 'clave-cron' });
    expect((await t.api('GET', '/api/cron/daily')).status).toBe(401);
    t.close(); t = await start({ cronSecret: '' });
    expect((await t.api('GET', '/api/cron/daily')).status).toBe(401);
  });

  it('borra solo las fotos de más de 30 días', async () => {
    t = await start({ cronSecret: 'clave-cron' });
    const db = t.ctx.db;
    const mk = async (n: number, daysAgo: number) => {
      const id = crypto.randomUUID();
      await db.query(
        `insert into office.orders (id, number, access_token, idempotency_key, request_hash, customer_name, customer_phone, fulfillment, items, subtotal, total)
         values ($1, $2, 'tok', $1::text, 'h', 'Ana', '5512345678', 'delivery', '[]'::jsonb, 0, 0)`,
        [id, `FO-9${n}`],
      ).catch(() => undefined);
      await db.query(`insert into office.delivery_photos (order_id, image, content_type, created_at) values ($1, '\\xffd8ff'::bytea, 'image/jpeg', now() - ($2 || ' days')::interval)`, [id, String(daysAgo)]).catch(() => undefined);
      return id;
    };
    await mk(1, 31);
    await mk(2, 5);
    const before = await db.query('select order_id from office.delivery_photos');
    const r = await fetch(`${t.base}/api/cron/daily`, { headers: { Authorization: 'Bearer clave-cron' } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.purgedPhotos).toBe(before.length === 2 ? 1 : body.purgedPhotos);
    expect((await db.query('select 1 from office.delivery_photos')).length).toBe(before.length - body.purgedPhotos);
  });
});
