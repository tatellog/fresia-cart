import type { ComboChoiceInput, Product, Topping } from './types';

/**
 * «Surtido recomendado» de un combo: cada pieza con una opción disponible y solo
 * sus toppings incluidos (sin cargo), rotando para que no salgan todas iguales.
 * Nunca agrega premium con cargo ni toppings extra: el precio queda en el del combo.
 * Devuelve null si alguna pieza no tiene ninguna opción disponible.
 */
export function recommendedAssortment(combo: Product, products: Product[], toppings: Topping[]): ComboChoiceInput[] | null {
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const sorted = [...toppings].sort((a, b) => a.sort - b.sort);
  const out: ComboChoiceInput[] = [];
  let piece = 0;
  for (const slot of combo.combo ?? []) {
    const options = slot.options.filter((o) => {
      const p = byProduct.get(o.productId);
      return p?.available && p.sizes.some((s) => s.id === o.sizeId);
    });
    if (!options.length) return null;
    for (let i = 0; i < slot.qty; i++, piece++) {
      const o = options[i % options.length];
      const p = byProduct.get(o.productId)!;
      // Solo toppings normales (o premium que este producto da sin cargo), hasta los incluidos.
      const free = sorted.filter((t) => t.available && p.toppingIds.includes(t.id) && (!t.premium || p.freePremiumIds.includes(t.id)));
      const n = Math.min(p.includedToppings, free.length);
      const toppingIds = Array.from({ length: n }, (_, k) => free[(piece + k) % free.length].id);
      out.push({ slotId: slot.id, productId: o.productId, sizeId: o.sizeId, toppingIds: [...new Set(toppingIds)] });
    }
  }
  return out;
}
