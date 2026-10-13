import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';
import { iso, isoOrNull } from './db';
import { HttpError } from './context';
import type { Ctx } from './context';
import { getRules, listProducts, listToppings } from './store';
import { priceCart } from '../shared/pricing';
import type { CartLineInput, PricedLine } from '../shared/types';

/**
 * Pedido de equipo: el organizador comparte un enlace; cada compañero agrega lo suyo
 * con su nombre; el organizador hace un solo pedido con todo.
 */
export type GroupRow = {
  id: string;
  code: string;
  name: string;
  organizer_name: string;
  admin_token: string;
  status: 'abierto' | 'cerrado' | 'pedido' | 'cancelado';
  closes_at: Date | string | null;
  order_id: string | null;
  created_at: Date | string;
};

/**
 * Estado del pedido de equipo para quien lo ve:
 * abierto → cerrado (no más selecciones) → pendiente_pago → confirmado → completado; o cancelado.
 */
export type GroupState = 'abierto' | 'cerrado' | 'pendiente_pago' | 'confirmado' | 'cancelado' | 'completado';

export type GroupView = {
  code: string;
  name: string;
  organizerName: string;
  status: GroupRow['status'];
  state: GroupState;
  closesAt: string | null;
  closed: boolean;
  orderNumber: string | null;
  /** Total del pedido ya hecho (con envío); null mientras no se pide. */
  orderTotal: number | null;
  /** Cada persona: lo que lleva y cuánto suma. Quien entró pero no ha elegido aparece con 0 piezas. */
  participants: { name: string; pieces: number; subtotal: number; mine: boolean }[];
  items: { id: string; memberName: string; mine: boolean; line: PricedLine; input: CartLineInput }[];
  subtotal: number;
  pieces: number;
  isOrganizer: boolean;
};

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
const MAX_ITEMS = 120;

export async function createGroup(db: DB, input: { name: string; organizerName: string; closesInMinutes: number | null }, now: Date) {
  const closesAt = input.closesInMinutes ? new Date(now.getTime() + input.closesInMinutes * 60000) : null;
  const row = await db.one<GroupRow>(
    `insert into office.group_orders (id, code, name, organizer_name, admin_token, closes_at)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [randomUUID(), newCode(), input.name, input.organizerName, randomBytes(24).toString('base64url'), closesAt],
  );
  return row!;
}

export async function getGroupRow(db: DB, code: string) {
  const row = await db.one<GroupRow>('select * from office.group_orders where code = $1', [code]);
  if (!row) throw new HttpError(404, 'Este pedido de equipo no existe.');
  return row;
}

const isClosed = (g: GroupRow, now: Date) => g.status !== 'abierto' || (g.closes_at != null && new Date(g.closes_at).getTime() < now.getTime());

function stateOf(g: GroupRow, now: Date, order: { order_status: string } | null): GroupState {
  if (g.status === 'cancelado') return 'cancelado';
  if (g.status === 'pedido' && order) {
    if (order.order_status === 'cancelado') return 'cancelado';
    if (order.order_status === 'entregado') return 'completado';
    if (order.order_status === 'esperando_pago' || order.order_status === 'cotizando_envio') return 'pendiente_pago';
    return 'confirmado';
  }
  return isClosed(g, now) ? 'cerrado' : 'abierto';
}

export async function groupView(ctx: Ctx, code: string, viewer: { memberKey?: string; adminToken?: string }): Promise<GroupView> {
  const g = await getGroupRow(ctx.db, code);
  const items = await ctx.db.query<{ id: string; member_name: string; member_key: string; line: CartLineInput }>(
    'select id, member_name, member_key, line from office.group_items where group_id = $1 order by created_at',
    [g.id],
  );
  const [products, toppings, rules] = await Promise.all([listProducts(ctx.db), listToppings(ctx.db), getRules(ctx.db)]);
  const priced = priceCart(items.map((i) => i.line), products, toppings, rules, { ignoreMinQty: true });
  const ok = new Map<number, PricedLine>();
  let k = 0;
  items.forEach((_, idx) => {
    if (!priced.errors.some((e) => e.index === idx)) ok.set(idx, priced.lines[k++]);
  });
  const order = g.order_id
    ? await ctx.db.one<{ number: string; order_status: string; total: number | null }>('select number, order_status, total from office.orders where id = $1', [g.order_id])
    : null;
  const members = await ctx.db.query<{ member_key: string; name: string }>('select member_key, name from office.group_members where group_id = $1 order by joined_at', [g.id]);

  // Participantes por llave del teléfono (dos «Ana» distintas no se mezclan); el orden es el de llegada.
  const people = new Map<string, { name: string; pieces: number; subtotal: number; mine: boolean }>();
  const person = (key: string, name: string) => {
    if (!people.has(key)) people.set(key, { name, pieces: 0, subtotal: 0, mine: !!viewer.memberKey && viewer.memberKey === key });
    return people.get(key)!;
  };
  members.forEach((m) => person(m.member_key, m.name));
  items.forEach((i, idx) => {
    const line = ok.get(idx);
    if (!line) return;
    const p = person(i.member_key, i.member_name);
    p.pieces += line.qty;
    p.subtotal += line.lineTotal;
  });
  const seen = new Map<string, number>();
  const participants = [...people.values()].map((p) => {
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return n > 1 ? { ...p, name: `${p.name} (${n})` } : p;
  });

  return {
    code: g.code,
    name: g.name,
    organizerName: g.organizer_name,
    status: g.status,
    state: stateOf(g, ctx.now(), order ?? null),
    closesAt: isoOrNull(g.closes_at),
    closed: isClosed(g, ctx.now()),
    orderNumber: order?.number ?? null,
    orderTotal: order?.total ?? null,
    participants,
    items: items
      .map((i, idx) => ({ id: i.id, memberName: i.member_name, mine: !!viewer.memberKey && viewer.memberKey === i.member_key, line: ok.get(idx)!, input: i.line }))
      .filter((i) => i.line),
    subtotal: priced.subtotal,
    pieces: priced.lines.reduce((s, l) => s + l.qty, 0),
    isOrganizer: tokenMatches(viewer.adminToken, g.admin_token),
  };
}

const CLOSED_MSG = 'Este pedido de equipo ya cerró: ya no se pueden agregar productos.';

/** Entrar al pedido con tu nombre (aunque aún no elijas). Repetirlo solo actualiza el nombre. */
export async function joinGroup(ctx: Ctx, code: string, input: { memberName: string; memberKey: string }) {
  await ctx.db.tx(async (q) => {
    // Con el grupo bloqueado: el cierre no se cruza con quien entra o se renombra.
    const g = await lockGroup(q, code);
    if (isClosed(g, ctx.now())) throw new HttpError(409, CLOSED_MSG, { code: 'group_closed' });
    await q.query(
      `insert into office.group_members (group_id, member_key, name) values ($1, $2, $3)
       on conflict (group_id, member_key) do update set name = excluded.name`,
      [g.id, input.memberKey, input.memberName],
    );
    await renameOwnItems(q, g.id, input.memberKey, input.memberName);
  });
}

/** Cambiar tu nombre renombra SOLO lo que agregaste con tu llave; nunca lo de otra persona. */
async function renameOwnItems(q: DB, groupId: string, key: string, name: string) {
  await q.query(
    `update office.group_items set member_name = $3, line = jsonb_set(line, '{forWhom}', to_jsonb($3::text))
     where group_id = $1 and member_key = $2 and member_name <> $3`,
    [groupId, key, name],
  );
}

/**
 * Agrega un producto. Con el mismo itemId (doble toque, reintento de red) no se duplica.
 * El grupo se bloquea mientras tanto para que el cierre y el tope de productos no se crucen.
 */
export async function addGroupItem(ctx: Ctx, code: string, input: { memberName: string; memberKey: string; line: CartLineInput; itemId?: string }) {
  const [products, toppings, rules] = await Promise.all([listProducts(ctx.db), listToppings(ctx.db), getRules(ctx.db)]);
  const line = { ...input.line, forWhom: input.memberName };
  const r = priceCart([line], products, toppings, rules, { ignoreMinQty: true });
  if (r.errors.length) throw new HttpError(422, r.errors[0].message);
  await ctx.db.tx(async (q) => {
    const g = await q.one<GroupRow>('select * from office.group_orders where code = $1 for update', [code]);
    if (!g) throw new HttpError(404, 'Este pedido de equipo no existe.');
    if (isClosed(g, ctx.now())) throw new HttpError(409, CLOSED_MSG, { code: 'group_closed' });
    const { n } = (await q.one<{ n: number }>('select count(*)::int as n from office.group_items where group_id = $1', [g.id]))!;
    if (n >= MAX_ITEMS) throw new HttpError(409, 'Este pedido de equipo ya tiene demasiados productos.');
    await q.query(
      `insert into office.group_members (group_id, member_key, name) values ($1, $2, $3)
       on conflict (group_id, member_key) do update set name = excluded.name`,
      [g.id, input.memberKey, input.memberName],
    );
    await renameOwnItems(q, g.id, input.memberKey, input.memberName);
    await q.query(
      'insert into office.group_items (id, group_id, member_name, member_key, line) values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing',
      [input.itemId ?? randomUUID(), g.id, input.memberName, input.memberKey, JSON.stringify(line)],
    );
  });
}

/** Cada quien quita lo suyo mientras está abierto; ya cerrado, solo el organizador ajusta antes de pagar. */
export async function removeGroupItem(ctx: Ctx, code: string, itemId: string, who: { memberKey?: string; adminToken?: string }) {
  await ctx.db.tx(async (q) => {
    // Bloqueado: no se puede quitar algo en el instante en que el organizador hace el pedido.
    const g = await lockGroup(q, code);
    const organizer = tokenMatches(who.adminToken, g.admin_token);
    if (g.status === 'pedido' || g.status === 'cancelado') throw new HttpError(409, 'Este pedido de equipo ya se envió.');
    if (isClosed(g, ctx.now()) && !organizer) throw new HttpError(409, 'El pedido ya cerró. Pídele a quien organiza que haga el cambio.');
    const item = await q.one<{ member_key: string }>('select member_key from office.group_items where id = $1 and group_id = $2', [itemId, g.id]);
    if (!item) throw new HttpError(404, 'Ese producto ya no está.');
    if (!organizer && who.memberKey !== item.member_key) throw new HttpError(403, 'Solo puedes quitar lo que tú agregaste.');
    await q.query('delete from office.group_items where id = $1', [itemId]);
  });
}

async function lockGroup(q: DB, code: string): Promise<GroupRow> {
  const g = await q.one<GroupRow>('select * from office.group_orders where code = $1 for update', [code]);
  if (!g) throw new HttpError(404, 'Este pedido de equipo no existe.');
  return g;
}

/** Compara la llave del organizador sin filtrar tiempos. */
function tokenMatches(given: string | undefined, real: string): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(real).digest();
  return timingSafeEqual(a, b);
}

/** El organizador cierra (nadie más agrega) o reabre antes de pagar. */
export async function setGroupOpen(ctx: Ctx, code: string, adminToken: string, open: boolean) {
  await ctx.db.tx(async (q) => {
    const g = await lockGroup(q, code);
    if (!tokenMatches(adminToken, g.admin_token)) throw new HttpError(403, 'Solo quien organiza puede cerrar o reabrir el pedido.');
    if (g.status === 'pedido') {
      // Si el pedido de este grupo se canceló, el organizador puede reabrir (el pedido cancelado queda como estaba).
      const o = g.order_id ? await q.one<{ order_status: string }>('select order_status from office.orders where id = $1', [g.order_id]) : null;
      if (!(open && o?.order_status === 'cancelado')) throw new HttpError(409, 'Este pedido de equipo ya se envió.');
      await q.query("update office.group_orders set status = 'abierto', order_id = null, closes_at = null where id = $1 and status = 'pedido'", [g.id]);
      return;
    }
    if (g.status === 'cancelado') throw new HttpError(409, 'Este pedido de equipo ya se envió.');
    if (open) {
      // Si ya pasó la hora límite, reabrir quita el límite. Nunca sobrescribe un pedido ya hecho.
      const expired = g.closes_at != null && new Date(g.closes_at).getTime() < ctx.now().getTime();
      await q.query(`update office.group_orders set status = 'abierto'${expired ? ', closes_at = null' : ''} where id = $1 and status in ('abierto', 'cerrado')`, [g.id]);
    } else {
      await q.query("update office.group_orders set status = 'cerrado' where id = $1 and status = 'abierto'", [g.id]);
    }
  });
}

/** Líneas del pedido de equipo para crear la orden (solo el organizador). */
export async function groupLinesForOrder(ctx: Ctx, code: string, adminToken: string) {
  const g = await getGroupRow(ctx.db, code);
  if (!tokenMatches(adminToken, g.admin_token)) throw new HttpError(403, 'Solo quien organizó el pedido de equipo puede enviarlo.');
  if (g.status !== 'abierto' && g.status !== 'cerrado') throw new HttpError(409, 'Este pedido de equipo ya se envió.');
  const items = await ctx.db.query<{ line: CartLineInput }>('select line from office.group_items where group_id = $1 order by created_at, id', [g.id]);
  if (!items.length) throw new HttpError(422, 'El pedido de equipo está vacío.');
  return { group: g, lines: items.map((i) => i.line) };
}

export const groupCreatedAt = (g: GroupRow) => iso(g.created_at);
