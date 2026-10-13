import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';
import { resetPopularCache } from '../server/store';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { resetPopularCache(); t = await start(); });
afterEach(async () => { await t.close(); });

const order = (sizeId: string, toppingIds: string[]) =>
  t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', items: [{ productId: 'clasica', sizeId, toppingIds, qty: 2 }] }));

describe('opciones populares con datos reales', () => {
  it('con pocos pedidos no destaca nada', async () => {
    await order('mediano', ['nuez']);
    expect((await t.api('GET', '/api/menu')).body.popular).toEqual({});
  });

  it('con 5 o más pedidos: el tamaño y los toppings más pedidos', async () => {
    for (let i = 0; i < 4; i++) await order('mediano', ['nuez', 'coco']);
    await order('grande', ['nuez', 'granola']);
    resetPopularCache();
    const p = (await t.api('GET', '/api/menu')).body.popular.clasica;
    expect(p.sizeId).toBe('mediano');
    expect(p.toppingIds.slice(0, 2)).toEqual(['nuez', 'coco']);
    expect(p.toppingIds).not.toContain('granola'); // pedido una sola vez
  });
});
