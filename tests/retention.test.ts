import { afterEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';

// JPEG mínimo con cabecera válida (FF D8 FF).
const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); });

describe('tarea diaria: latido y fotos de entrega', () => {
  it('sin la clave de Vercel Cron no se ejecuta', async () => {
    t = await start({ cronSecret: 'clave-cron' });
    expect((await t.api('GET', '/api/cron/daily')).status).toBe(401);
    await t.close();
    t = await start({ cronSecret: '' });
    expect((await t.api('GET', '/api/cron/daily')).status).toBe(401);
  });

  it('borra solo las fotos de más de 30 días y el pedido deja de anunciarla', async () => {
    t = await start({ cronSecret: 'clave-cron' });
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    const orders: { id: string; number: string; token: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const o = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega' }));
      expect(o.status).toBe(201);
      const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((x: any) => x.number === o.body.number).id;
      expect((await t.upload(`/api/admin/orders/${id}/delivery-photo`, TINY_JPEG)).status).toBe(200);
      orders.push({ id, number: o.body.number, token: o.body.token });
    }
    // La primera foto se tomó hace 31 días.
    await t.ctx.db.query("update office.delivery_photos set created_at = now() - interval '31 days' where order_id = $1", [orders[0].id]);
    await t.ctx.db.query("update office.orders set delivery_photo_at = now() - interval '31 days' where id = $1", [orders[0].id]);

    const r = await fetch(`${t.base}/api/cron/daily`, { headers: { Authorization: 'Bearer clave-cron' } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, purgedPhotos: 1 });

    const old = await t.api('GET', `/api/orders/${orders[0].number}?t=${orders[0].token}`);
    expect(old.body.order.deliveryPhotoAt).toBeNull();
    expect((await t.api('GET', `/api/orders/${orders[0].number}/delivery-photo?t=${orders[0].token}`)).status).toBe(404);
    const recent = await t.api('GET', `/api/orders/${orders[1].number}?t=${orders[1].token}`);
    expect(recent.body.order.deliveryPhotoAt).not.toBeNull();
  });
});
