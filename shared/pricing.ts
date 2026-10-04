import type { CartLineInput, PricedLine, Product, Topping } from './types';

export const MAX_QTY = 50;
export const MAX_FOR_WHOM = 40;

export type PricingError = { index: number; message: string };

/**
 * Calcula precios a partir del catálogo. El navegador lo usa para mostrar
 * importes; el servidor lo vuelve a ejecutar con su propio catálogo y es el
 * único resultado que cuenta para cobrar.
 */
export function priceCart(
  lines: CartLineInput[],
  products: Product[],
  toppings: Topping[],
): { lines: PricedLine[]; subtotal: number; errors: PricingError[] } {
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const byTopping = new Map(toppings.map((t) => [t.id, t]));
  const priced: PricedLine[] = [];
  const errors: PricingError[] = [];

  lines.forEach((line, index) => {
    const product = byProduct.get(line.productId);
    if (!product || !product.available) {
      errors.push({ index, message: 'Este producto ya no está disponible.' });
      return;
    }
    const size = product.sizes.find((s) => s.id === line.sizeId);
    if (!size) {
      errors.push({ index, message: `Elige un tamaño para ${product.name}.` });
      return;
    }
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) {
      errors.push({ index, message: `La cantidad debe estar entre 1 y ${MAX_QTY}.` });
      return;
    }
    const ids = [...new Set(line.toppingIds)];
    if (product.maxToppings != null && ids.length > product.maxToppings) {
      errors.push({ index, message: `${product.name} admite hasta ${product.maxToppings} toppings.` });
      return;
    }
    const chosen: PricedLine['toppings'] = [];
    for (const id of ids) {
      const t = byTopping.get(id);
      if (!t || !t.available || !product.toppingIds.includes(id)) {
        errors.push({ index, message: `Un topping de ${product.name} ya no está disponible.` });
        return;
      }
      chosen.push({ id: t.id, name: t.name, price: t.price });
    }
    const unitPrice = size.price + chosen.reduce((s, t) => s + t.price, 0);
    priced.push({
      productId: product.id,
      name: product.name,
      sizeId: size.id,
      sizeLabel: size.label,
      basePrice: size.price,
      toppings: chosen,
      unitPrice,
      qty: line.qty,
      lineTotal: unitPrice * line.qty,
      forWhom: (line.forWhom ?? '').trim().slice(0, MAX_FOR_WHOM),
    });
  });

  return { lines: priced, subtotal: priced.reduce((s, l) => s + l.lineTotal, 0), errors };
}
