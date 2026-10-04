import type { Ctx } from './context';
import { addEvent, type OrderRow } from './orders';
import type { ClubCard } from '../shared/types';

export const clubEnabled = (ctx: Ctx) => Boolean(ctx.config.clubUrl && ctx.config.clubSecret);

async function call(ctx: Ctx, path: string, body: object): Promise<ClubCard> {
  const res = await fetch(`${ctx.config.clubUrl}/api/integrations/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.config.clubSecret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Frésia Club respondió ${res.status}`);
  return (await res.json()) as ClubCard;
}

/** Al entregar un pedido: suma un sello a la tarjeta con ese teléfono (el club evita duplicados). */
export async function stampClub(ctx: Ctx, row: OrderRow) {
  if (!clubEnabled(ctx)) return;
  try {
    const r = await call(ctx, 'online-order', { phone: row.customer_phone, orderNumber: row.number });
    const detail = !r.found
      ? 'Sin tarjeta con ese teléfono'
      : r.alreadyStamped
        ? 'Sello ya registrado'
        : `Sello sumado (${r.visits}/${r.goal}${r.rewardsPending ? ` · ${r.rewardsPending} recompensa(s)` : ''})`;
    await addEvent(ctx.db, row.id, 'club', detail, 'sistema');
  } catch (e) {
    console.error('[club] no se pudo sumar el sello', e);
    await addEvent(ctx.db, row.id, 'club', 'No se pudo sumar el sello (Frésia Club no respondió)', 'sistema').catch(() => {});
  }
}

/** Tarjeta del cliente para mostrar en su pedido. null si el club no está conectado o no respondió. */
export async function clubCardFor(ctx: Ctx, row: OrderRow): Promise<ClubCard | null> {
  if (!clubEnabled(ctx)) return null;
  try {
    return await call(ctx, 'lookup', { phone: row.customer_phone });
  } catch (e) {
    console.error('[club] consulta falló', e);
    return null;
  }
}
