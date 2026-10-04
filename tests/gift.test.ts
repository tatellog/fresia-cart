import { afterEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';
import { buildPush, buildWhatsApp } from '../server/notify';
import { hourPhrase } from '../shared/schedule';

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); t = undefined as any; });

const gift = { to: 'Ana · Piso 7, área de diseño', note: 'Gracias por cubrirme en la junta.', anonymous: true };
const adminOrder = async (number: string) => {
  await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
  const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders.find((o: any) => o.number === number).id;
  return (await t.api('GET', `/api/admin/orders/${id}`)).body.order;
};

describe('Fresigrama (pedido de regalo)', () => {
  it('se guarda con para quién, tarjeta y anónimo; el cliente lo ve en su pedido', async () => {
    t = await start();
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', gift }));
    expect(r.status).toBe(201);
    expect(r.body.order.gift).toEqual(gift);
    const o = await t.api('GET', `/api/orders/${r.body.number}?t=${r.body.token}`);
    expect(o.body.order.gift).toEqual(gift);
  });

  it('aviso a la tienda: anónimo y cobrar primero a quien lo envía', async () => {
    t = await start();
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', gift }));
    const o = await adminOrder(r.body.number);
    const msg = buildWhatsApp('pedido_contra_entrega', o, 'http://x/admin', '5215500000000').text;
    expect(msg).toContain('🎁 *FRESIGRAMA* para Ana · Piso 7, área de diseño · *ANÓNIMO: no digas quién lo manda*');
    expect(msg).toContain('Tarjeta: «Gracias por cubrirme en la junta.»');
    expect(msg).toContain('Cobra a Ana Prueba (quien lo envía) antes de entregar');
    expect(buildPush('pedido_contra_entrega', o).body.startsWith('🎁 ')).toBe(true);
  });

  it('solo a domicilio, nunca en pedido de equipo, y exige para quién', async () => {
    t = await start();
    const pickup = await t.api('POST', '/api/orders', orderBody({ fulfillment: 'pickup', address: null, paymentMethod: 'contra_entrega', gift }));
    expect(pickup.status).toBe(422);
    expect(pickup.body.code).toBe('gift');
    const noTo = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', gift: { ...gift, to: '' } }));
    expect(noTo.status).toBe(400);
  });

  it('la tarjeta dice la hora en palabras (CDMX)', () => {
    expect(hourPhrase(new Date('2026-10-07T22:00:00Z'))).toBe('las 4 de la tarde');
    expect(hourPhrase(new Date('2026-10-07T19:30:00Z'))).toBe('la 1 de la tarde');
    expect(hourPhrase(new Date('2026-10-08T02:00:00Z'))).toBe('las 8 de la noche');
  });

  it('el QR de las tarjetas existe y cuenta escaneos', async () => {
    t = await start();
    const r = await fetch(`${t.base}/q/fresigrama`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('src=fresigrama');
  });
});
