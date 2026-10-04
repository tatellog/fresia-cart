import { load, remove, save } from './storage';
import { uuid } from './uuid';

/** Pedido de equipo en el que este teléfono está agregando cosas. */
export type ActiveGroup = { code: string; name: string; memberName: string };
const ACTIVE = 'fo.group.active.v1';
const ADMIN = 'fo.group.admin.v1';
const MEMBER = 'fo.group.member.v1';
const CHECKOUT = 'fo.group.checkout.v1';

export const activeGroup = () => load<ActiveGroup | null>(ACTIVE, null);
export const setActiveGroup = (g: ActiveGroup | null) => (g ? save(ACTIVE, g) : remove(ACTIVE));

/** Llave anónima de este teléfono: permite quitar solo lo que tú agregaste. */
export function memberKey(): string {
  let k = load<string | null>(MEMBER, null);
  if (!k) {
    k = uuid();
    save(MEMBER, k);
  }
  return k;
}

/** Token de organizador por grupo (solo en el teléfono de quien lo creó). */
export const groupAdminToken = (code: string) => load<Record<string, string>>(ADMIN, {})[code] ?? null;
export function rememberGroupAdmin(code: string, token: string) {
  save(ADMIN, { ...load<Record<string, string>>(ADMIN, {}), [code]: token });
}

/** El organizador está pagando el pedido de equipo (entrega → resumen). */
export const groupCheckout = () => load<{ code: string; token: string; name: string } | null>(CHECKOUT, null);
export const setGroupCheckout = (g: { code: string; token: string; name: string } | null) => (g ? save(CHECKOUT, g) : remove(CHECKOUT));
