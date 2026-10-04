import { randomBytes, randomUUID } from 'node:crypto';
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
  status: 'abierto' | 'pedido' | 'cancelado';
  closes_at: Date | string | null;
  order_id: string | null;
  created_at: Date | string;
};

export type GroupView = {
  code: string;
  name: string;
  organizerName: string;
  status: GroupRow['status'];
  closesAt: string | null;
  closed: boolean;
  orderNumber: string | null;
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
  const order = g.order_id ? await ctx.db.one<{ number: string }>('select number from office.orders where id = $1', [g.order_id]) : null;
  return {
    code: g.code,
    name: g.name,
    organizerName: g.organizer_name,
    status: g.status,
    closesAt: isoOrNull(g.closes_at),
    closed: isClosed(g, ctx.now()),
    orderNumber: order?.number ?? null,
    items: items
      .map((i, idx) => ({ id: i.id, memberName: i.member_name, mine: !!viewer.memberKey && viewer.memberKey === i.member_key, line: ok.get(idx)!, input: i.line }))
      .filter((i) => i.line),
    subtotal: priced.subtotal,
    pieces: priced.lines.reduce((s, l) => s + l.qty, 0),
    isOrganizer: !!viewer.adminToken && viewer.adminToken === g.admin_token,
  };
}

export async function addGroupItem(ctx: Ctx, code: string, input: { memberName: string; memberKey: string; line: CartLineInput }) {
  const g = await getGroupRow(ctx.db, code);
  if (isClosed(g, ctx.now())) throw new HttpError(409, 'Este pedido de equipo ya cerró.');
  const [products, toppings, rules] = await Promise.all([listProducts(ctx.db), listToppings(ctx.db), getRules(ctx.db)]);
  const line = { ...input.line, forWhom: input.memberName };
  const r = priceCart([line], products, toppings, rules, { ignoreMinQty: true });
  if (r.errors.length) throw new HttpError(422, r.errors[0].message);
  const { n } = (await ctx.db.one<{ n: number }>('select count(*)::int as n from office.group_items where group_id = $1', [g.id]))!;
  if (n >= MAX_ITEMS) throw new HttpError(409, 'Este pedido de equipo ya tiene demasiados productos.');
  await ctx.db.query('insert into office.group_items (id, group_id, member_name, member_key, line) values ($1, $2, $3, $4, $5::jsonb)', [
    randomUUID(), g.id, input.memberName, input.memberKey, JSON.stringify(line),
  ]);
}

export async function removeGroupItem(ctx: Ctx, code: string, itemId: string, who: { memberKey?: string; adminToken?: string }) {
  const g = await getGroupRow(ctx.db, code);
  if (g.status !== 'abierto') throw new HttpError(409, 'Este pedido de equipo ya se envió.');
  const item = await ctx.db.one<{ member_key: string }>('select member_key from office.group_items where id = $1 and group_id = $2', [itemId, g.id]);
  if (!item) throw new HttpError(404, 'Ese producto ya no está.');
  if (who.adminToken !== g.admin_token && who.memberKey !== item.member_key) throw new HttpError(403, 'Solo puedes quitar lo que tú agregaste.');
  await ctx.db.query('delete from office.group_items where id = $1', [itemId]);
}

/** Líneas del pedido de equipo para crear la orden (solo el organizador). */
export async function groupLinesForOrder(ctx: Ctx, code: string, adminToken: string) {
  const g = await getGroupRow(ctx.db, code);
  if (g.admin_token !== adminToken) throw new HttpError(403, 'Solo quien organizó el pedido de equipo puede enviarlo.');
  if (g.status !== 'abierto') throw new HttpError(409, 'Este pedido de equipo ya se envió.');
  const items = await ctx.db.query<{ line: CartLineInput }>('select line from office.group_items where group_id = $1 order by created_at', [g.id]);
  if (!items.length) throw new HttpError(422, 'El pedido de equipo está vacío.');
  return { group: g, lines: items.map((i) => i.line) };
}

export const groupCreatedAt = (g: GroupRow) => iso(g.created_at);
