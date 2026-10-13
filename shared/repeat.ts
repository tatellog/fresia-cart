import { priceCart } from './pricing';
import type { CartLineInput, MenuRules, PricedLine, Product, Topping } from './types';

export type RepeatResult = { lines: CartLineInput[]; notes: string[] };

/**
 * Convierte las líneas de un pedido anterior en líneas de carrito con el menú de HOY.
 * Lo que ya no existe se quita y se avisa; los toppings que ya no están se quitan de su pieza.
 * Los precios salen del menú vigente (el carrito siempre recalcula).
 */
export function repeatLines(items: PricedLine[], products: Product[], toppings: Topping[], rules: MenuRules): RepeatResult {
  const lines: CartLineInput[] = [];
  const notes: string[] = [];
  const valid = (l: CartLineInput) => priceCart([l], products, toppings, rules, { ignoreMinQty: true }).errors.length === 0;
  const okTopping = (productId: string) => (id: string) => {
    const p = products.find((x) => x.id === productId);
    return !!p && p.toppingIds.includes(id) && !!toppings.find((t) => t.id === id && t.available);
  };

  for (const l of items) {
    const line: CartLineInput = {
      productId: l.productId,
      sizeId: l.sizeId,
      toppingIds: l.toppings.map((t) => t.id),
      ...(l.choices ? { choices: l.choices.map((c) => ({ slotId: c.slotId, productId: c.productId, sizeId: c.sizeId, toppingIds: c.toppings.map((t) => t.id) })) } : {}),
      qty: l.qty,
      forWhom: l.forWhom,
    };
    if (valid(line)) {
      lines.push(line);
      continue;
    }
    // Segundo intento: sin los toppings que ya no están.
    const fixed: CartLineInput = {
      ...line,
      toppingIds: line.toppingIds.filter(okTopping(line.productId)),
      ...(line.choices ? { choices: line.choices.map((c) => ({ ...c, toppingIds: c.toppingIds.filter(okTopping(c.productId)) })) } : {}),
    };
    if (valid(fixed)) {
      lines.push(fixed);
      notes.push(`${l.name}: quitamos toppings que ya no tenemos. Revísalo.`);
    } else {
      notes.push(`${l.name} ya no está disponible; no se agregó.`);
    }
  }
  return { lines, notes };
}
