import type { CartLineInput } from './types';

/**
 * Lo que se manda al servidor por cada renglón del carrito. Un solo lugar
 * para no olvidar campos (p. ej. las piezas de un combo).
 */
export function toLineInput(l: CartLineInput): CartLineInput {
  return {
    productId: l.productId,
    sizeId: l.sizeId,
    toppingIds: l.toppingIds,
    ...(l.choices ? { choices: l.choices.map(({ slotId, productId, sizeId, toppingIds }) => ({ slotId, productId, sizeId, toppingIds })) } : {}),
    qty: l.qty,
    forWhom: l.forWhom ?? '',
  };
}
