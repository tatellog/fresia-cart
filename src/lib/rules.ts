import type { MenuRules } from '../../shared/types';
/** Solo por si el servidor aún no envía reglas; el servidor siempre recalcula. */
export const DEFAULT_RULES_CLIENT: MenuRules = { extraToppingPrice: 1800, minFresias: 2, minQtyPerItem: 1 };
