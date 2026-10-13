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

/**
 * Regla del programa: un sello por pedido ENTREGADO, para el teléfono de quien pidió y pagó
 * (en pedidos de equipo, el organizador). Si después se cancela o se reembolsa, el sello se retira.
 */
export const earnsStamp = (o: Pick<OrderRow, 'order_status' | 'refund_status' | 'payment_status'>) =>
  // Entregado Y pagado: un pedido en efectivo suma su sello cuando se registra el cobro.
  o.order_status === 'entregado' && o.payment_status === 'aprobado' && o.refund_status !== 'reembolsado';

/** Deja la tarjeta del cliente de acuerdo con el estado del pedido: suma o retira su sello, una sola vez. */
export async function syncClub(ctx: Ctx, orderId: string) {
  if (!clubEnabled(ctx)) return;
  const row = await ctx.db.one<OrderRow>('select * from office.orders where id = $1', [orderId]);
  if (!row) return;
  const want = earnsStamp(row);
  if (want === row.club_stamped) return;
  try {
    if (want) {
      const r = await call(ctx, 'online-order', { phone: row.customer_phone, orderNumber: row.number });
      if (r.found) await ctx.db.query('update office.orders set club_stamped = true where id = $1', [row.id]);
      const detail = !r.found
        ? 'Sin tarjeta con ese teléfono'
        : r.alreadyStamped
          ? 'Sello ya registrado'
          : `Sello sumado (${r.visits}/${r.goal}${r.rewardsPending ? ` · ${r.rewardsPending} recompensa(s)` : ''})`;
      await addEvent(ctx.db, row.id, 'club', detail, 'sistema');
    } else {
      const r = await call(ctx, 'online-order-revert', { phone: row.customer_phone, orderNumber: row.number });
      await ctx.db.query('update office.orders set club_stamped = false where id = $1', [row.id]);
      const detail = !r.found || r.alreadyReverted
        ? 'Sello ya retirado'
        : r.rewardRedeemed
          ? 'No se retiró el sello: la recompensa ya se canjeó'
          : `Sello retirado por cancelación o reembolso (${r.visits}/${r.goal})`;
      await addEvent(ctx.db, row.id, 'club', detail, 'sistema');
    }
  } catch (e) {
    console.error('[club] no se pudo actualizar la tarjeta', e);
    await addEvent(ctx.db, row.id, 'club', `No se pudo ${want ? 'sumar' : 'retirar'} el sello (Frésia Club no respondió)`, 'sistema').catch(() => {});
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
