import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toLineInput } from '../shared/cart';
import type { CartLineInput } from '../shared/types';

type CartLine = CartLineInput & { lineId: string };
import { start } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

describe('del carrito del navegador al servidor', () => {
  it('un combo armado llega con todas sus piezas y toppings (resumen sin errores)', async () => {
    const panes = Array.from({ length: 5 }, (_, i) => ({ slotId: 'panes', productId: 'pan-relleno', sizeId: 'pieza', toppingIds: i === 0 ? ['nuez'] : [] }));
    const lines: CartLine[] = [
      { lineId: 'a', productId: 'dulce-tradicion', sizeId: 'combo', toppingIds: [], choices: panes, qty: 1, forWhom: 'Equipo' },
      { lineId: 'b', productId: 'clasica', sizeId: 'chico', toppingIds: ['coco'], qty: 3 },
    ];
    const items = lines.map(toLineInput);
    expect(items[0].choices).toHaveLength(5);
    const q = await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items });
    expect(q.status).toBe(200);
    expect(q.body.errors).toEqual([]);
    expect(q.body.lines[0].choices[0].toppings[0]).toMatchObject({ id: 'nuez', included: true });
  });
});
