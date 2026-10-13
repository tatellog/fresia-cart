import { describe, expect, it } from 'vitest';
import { recommendedAssortment } from '../shared/assortment';
import { COMBO_SIZE_ID, priceCart } from '../shared/pricing';
import { DEFAULT_RULES, DEMO_PRODUCTS, DEMO_TOPPINGS } from '../server/seed';

const combos = DEMO_PRODUCTS.filter((p) => p.combo);

describe('surtido recomendado (FO-007)', () => {
  it.each(combos.map((c) => [c.name, c] as const))('%s: completo, válido y al precio del combo (sin extras con cargo)', (_name, combo) => {
    const choices = recommendedAssortment(combo, DEMO_PRODUCTS, DEMO_TOPPINGS)!;
    expect(choices).toHaveLength(combo.combo!.reduce((s, slot) => s + slot.qty, 0));
    const r = priceCart([{ productId: combo.id, sizeId: COMBO_SIZE_ID, toppingIds: [], choices, qty: 1 }], DEMO_PRODUCTS, DEMO_TOPPINGS, DEFAULT_RULES);
    expect(r.errors).toEqual([]);
    expect(r.lines[0].unitPrice).toBe(combo.sizes[0].price);
    const premium = new Set(DEMO_TOPPINGS.filter((t) => t.premium).map((t) => t.id));
    for (const c of choices) {
      const p = DEMO_PRODUCTS.find((x) => x.id === c.productId)!;
      expect(c.toppingIds.length).toBeLessThanOrEqual(p.includedToppings);
      expect(c.toppingIds.filter((id) => premium.has(id) && !p.freePremiumIds.includes(id))).toEqual([]);
    }
  });

  it('las piezas iguales no salen todas con los mismos toppings', () => {
    const pausa = combos.find((c) => c.id === 'pausa-fresia')!;
    const clasicas = recommendedAssortment(pausa, DEMO_PRODUCTS, DEMO_TOPPINGS)!.filter((c) => c.slotId === 'clasicas');
    expect(new Set(clasicas.map((c) => c.toppingIds.join())).size).toBeGreaterThan(1);
  });

  it('sin opciones disponibles no recomienda nada', () => {
    const pausa = combos.find((c) => c.id === 'pausa-fresia')!;
    const agotado = DEMO_PRODUCTS.map((p) => (p.id === 'clasica' ? { ...p, available: false } : p));
    expect(recommendedAssortment(pausa, agotado, DEMO_TOPPINGS)).toBeNull();
  });
});
