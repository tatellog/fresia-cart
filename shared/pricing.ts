import type { CartLineInput, ComboChoiceInput, MenuRules, PricedChoice, PricedLine, PricedTopping, Product, Topping } from './types';

export const MAX_QTY = 50;
export const MAX_FOR_WHOM = 40;
export const COMBO_SIZE_ID = 'combo';

export type PricingError = { index: number; message: string };

class LineError extends Error {}

/**
 * Cargo de toppings de UNA pieza, con las reglas de Frésia:
 * - los premium siempre cobran su precio y no gastan incluidos
 *   (salvo los que el producto marca como sin cargo, p. ej. Turín en el Waffle);
 * - de los normales, los primeros `includedToppings` van incluidos y el resto
 *   se cobra a `rules.extraToppingPrice`.
 */
export function priceToppings(product: Product, toppingIds: string[], byTopping: Map<string, Topping>, rules: MenuRules): PricedTopping[] {
  const ids = [...new Set(toppingIds)];
  if (product.maxToppings != null && ids.length > product.maxToppings) {
    throw new LineError(`${product.name} admite hasta ${product.maxToppings} toppings.`);
  }
  let includedLeft = product.includedToppings;
  return ids.map((id) => {
    const t = byTopping.get(id);
    if (!t || !t.available || !product.toppingIds.includes(id)) throw new LineError(`Un topping de ${product.name} ya no está disponible.`);
    const premium = t.premium && !product.freePremiumIds.includes(id);
    if (premium) return { id, name: t.name, price: t.price, included: false, premium: true };
    if (includedLeft > 0) {
      includedLeft--;
      return { id, name: t.name, price: 0, included: true, premium: false };
    }
    return { id, name: t.name, price: rules.extraToppingPrice, included: false, premium: false };
  });
}

const sum = (ts: { price: number }[]) => ts.reduce((s, t) => s + t.price, 0);

function priceCombo(combo: Product, choices: ComboChoiceInput[], byProduct: Map<string, Product>, byTopping: Map<string, Topping>, rules: MenuRules) {
  const slots = combo.combo ?? [];
  const priced: PricedChoice[] = [];
  let fresias = 0;
  for (const slot of slots) {
    const mine = choices.filter((c) => c.slotId === slot.id);
    if (mine.length !== slot.qty) throw new LineError(`Completa «${slot.label}» en ${combo.name}.`);
    for (const c of mine) {
      if (!slot.options.some((o) => o.productId === c.productId && o.sizeId === c.sizeId)) throw new LineError(`Una opción de ${combo.name} no es válida.`);
      const p = byProduct.get(c.productId);
      const size = p?.sizes.find((s) => s.id === c.sizeId);
      if (!p || !p.available || !size) throw new LineError(`Una opción de ${combo.name} ya no está disponible.`);
      const toppings = priceToppings(p, c.toppingIds, byTopping, rules);
      fresias += p.fresiaUnits;
      priced.push({ slotId: slot.id, slotLabel: slot.label, productId: p.id, sizeId: size.id, name: p.name, sizeLabel: size.label, toppings, extras: sum(toppings) });
    }
  }
  if (choices.some((c) => !slots.some((s) => s.id === c.slotId))) throw new LineError(`Una opción de ${combo.name} no es válida.`);
  return { priced, fresias };
}

/**
 * Calcula precios a partir del catálogo. El navegador lo usa para mostrar
 * importes; el servidor lo vuelve a ejecutar con su propio catálogo y es el
 * único resultado que cuenta para cobrar.
 */
export function priceCart(
  lines: CartLineInput[],
  products: Product[],
  toppings: Topping[],
  rules: MenuRules,
  /** Pedido de equipo: cada quien pide de a uno; el mínimo se revisa en el total. */
  opts: { ignoreMinQty?: boolean } = {},
): { lines: PricedLine[]; subtotal: number; fresias: number; errors: PricingError[] } {
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const byTopping = new Map(toppings.map((t) => [t.id, t]));
  const priced: PricedLine[] = [];
  const errors: PricingError[] = [];

  lines.forEach((line, index) => {
    try {
      const product = byProduct.get(line.productId);
      if (!product || !product.available) throw new LineError('Este producto ya no está disponible.');
      if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) throw new LineError(`La cantidad debe estar entre 1 y ${MAX_QTY}.`);
      const forWhom = (line.forWhom ?? '').trim().slice(0, MAX_FOR_WHOM);
      const minQty = minQtyFor(product, rules);
      if (!opts.ignoreMinQty && line.qty < minQty) throw new LineError(`${product.name}: el mínimo es de ${minQty} piezas.`);

      if (product.combo) {
        const base = product.sizes[0]?.price ?? 0;
        const { priced: choices, fresias } = priceCombo(product, line.choices ?? [], byProduct, byTopping, rules);
        const unitPrice = base + choices.reduce((s, c) => s + c.extras, 0);
        priced.push({
          productId: product.id, name: product.name, sizeId: COMBO_SIZE_ID, sizeLabel: 'Combo', basePrice: base, toppings: [], choices,
          unitPrice, qty: line.qty, lineTotal: unitPrice * line.qty, fresias: fresias * line.qty, forWhom,
        });
        return;
      }

      const size = product.sizes.find((s) => s.id === line.sizeId);
      if (!size) throw new LineError(`Elige un tamaño para ${product.name}.`);
      const tops = priceToppings(product, line.toppingIds, byTopping, rules);
      const unitPrice = size.price + sum(tops);
      priced.push({
        productId: product.id, name: product.name, sizeId: size.id, sizeLabel: size.label, basePrice: size.price, toppings: tops,
        unitPrice, qty: line.qty, lineTotal: unitPrice * line.qty, fresias: product.fresiaUnits * line.qty, forWhom,
      });
    } catch (e) {
      if (!(e instanceof LineError)) throw e;
      errors.push({ index, message: e.message });
    }
  });

  return {
    lines: priced,
    subtotal: priced.reduce((s, l) => s + l.lineTotal, 0),
    fresias: priced.reduce((s, l) => s + l.fresias, 0),
    errors,
  };
}

/** Piezas mínimas para un renglón: los combos desde 1; lo demás según las reglas. */
export function minQtyFor(product: Pick<Product, 'combo'>, rules: MenuRules): number {
  return product.combo ? 1 : Math.max(1, rules.minQtyPerItem ?? 1);
}

export function minimumMessage(fresias: number, rules: MenuRules): string | null {
  if (fresias >= rules.minFresias) return null;
  const left = rules.minFresias - fresias;
  return `El pedido mínimo es de ${rules.minFresias} Frésias. ${left === 1 ? 'Te falta 1' : `Te faltan ${left}`}.`;
}
