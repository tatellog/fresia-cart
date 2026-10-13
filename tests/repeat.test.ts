import { describe, expect, it } from 'vitest';
import { repeatLines } from '../shared/repeat';
import { priceCart } from '../shared/pricing';
import { DEFAULT_RULES, DEMO_PRODUCTS, DEMO_TOPPINGS } from '../server/seed';

const before = priceCart(
  [
    { productId: 'clasica', sizeId: 'mediano', toppingIds: ['nuez', 'coco'], qty: 3, forWhom: 'Ana' },
    { productId: 'waffle', sizeId: 'pieza', toppingIds: [], qty: 1 },
  ],
  DEMO_PRODUCTS, DEMO_TOPPINGS, DEFAULT_RULES,
).lines;

describe('repetir pedido (FO-009)', () => {
  it('con el menú igual, repite todo tal cual', () => {
    const r = repeatLines(before, DEMO_PRODUCTS, DEMO_TOPPINGS, DEFAULT_RULES);
    expect(r.notes).toEqual([]);
    expect(r.lines).toEqual([
      { productId: 'clasica', sizeId: 'mediano', toppingIds: ['nuez', 'coco'], qty: 3, forWhom: 'Ana' },
      { productId: 'waffle', sizeId: 'pieza', toppingIds: [], qty: 1, forWhom: '' },
    ]);
  });

  it('lo descontinuado no se agrega y se avisa; el topping que ya no está se quita', () => {
    const products = DEMO_PRODUCTS.map((p) => (p.id === 'waffle' ? { ...p, available: false } : p));
    const toppings = DEMO_TOPPINGS.map((t) => (t.id === 'coco' ? { ...t, available: false } : t));
    const r = repeatLines(before, products, toppings, DEFAULT_RULES);
    expect(r.lines).toEqual([{ productId: 'clasica', sizeId: 'mediano', toppingIds: ['nuez'], qty: 3, forWhom: 'Ana' }]);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[1]).toMatch(/ya no está disponible/);
  });

  it('los precios son los de hoy (el carrito recalcula con el menú vigente)', () => {
    const products = DEMO_PRODUCTS.map((p) => (p.id === 'clasica' ? { ...p, sizes: p.sizes.map((s) => ({ ...s, price: s.price + 1000 })) } : p));
    const r = repeatLines(before, products, DEMO_TOPPINGS, DEFAULT_RULES);
    const now = priceCart(r.lines, products, DEMO_TOPPINGS, DEFAULT_RULES).lines[0];
    expect(now.unitPrice).toBe(before[0].unitPrice + 1000);
  });
});
