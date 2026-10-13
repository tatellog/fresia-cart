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

/** Llave anónima de este teléfono (base). */
function deviceKey(): string {
  let k = load<string | null>(MEMBER, null);
  if (!k) {
    k = uuid();
    save(MEMBER, k);
  }
  return k;
}

/**
 * Identidad del participante en UN pedido de equipo: una llave aleatoria, no el nombre.
 * Solo con esta llave se quita o renombra lo propio; escribir el nombre de otro no da acceso a lo suyo.
 */
const KEYS = 'fo.group.keys.v1';
export function memberKey(code: string): string {
  const keys = load<Record<string, string>>(KEYS, {});
  return keys[code] ?? deviceKey();
}

/** Otra persona usa este mismo teléfono: identidad nueva para este pedido (lo anterior sigue siendo de quien lo agregó). */
export function newMemberKey(code: string): string {
  const k = uuid();
  save(KEYS, { ...load<Record<string, string>>(KEYS, {}), [code]: k });
  return k;
}

/** Token de organizador por grupo (solo en el teléfono de quien lo creó). */
export const groupAdminToken = (code: string) => load<Record<string, string>>(ADMIN, {})[code] ?? null;
export function rememberGroupAdmin(code: string, token: string, name?: string) {
  save(ADMIN, { ...load<Record<string, string>>(ADMIN, {}), [code]: token });
  if (name) save(MINE, [{ code, name, at: new Date().toISOString() }, ...myGroups().filter((g) => g.code !== code)].slice(0, 20));
}

/** Pedidos de equipo que organizaste desde este teléfono (para «Mis pedidos»). */
const MINE = 'fo.group.mine.v1';
export const myGroups = () => load<{ code: string; name: string; at: string }[]>(MINE, []);

/** El organizador está pagando el pedido de equipo (entrega → resumen). */
export const groupCheckout = () => load<{ code: string; token: string; name: string } | null>(CHECKOUT, null);
export const setGroupCheckout = (g: { code: string; token: string; name: string } | null) => (g ? save(CHECKOUT, g) : remove(CHECKOUT));
