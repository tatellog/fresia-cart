import type { Ctx } from './context';
import { addEvent, type OrderRow } from './orders';
import { reconcile } from './payments/service';
import { sendPushToAll } from './push';

/**
 * Barrido de recuperación (sin colas ni servicios nuevos): lo corre el cron, un ping externo
 * opcional y, de forma oportunista, el tráfico del panel y de la tienda.
 *
 * 1. Pedidos sin atender: si un pedido nuevo lleva más de REMIND_AFTER sin que nadie lo abra, se
 *    vuelve a avisar (máximo MAX_REMINDERS veces, cada REMIND_EVERY). Cubre también el aviso que
 *    nunca salió (función congelada, push caído).
 * 2. Pagos en línea sin confirmar: si el webhook se perdió y el cliente cerró la página, se consulta
 *    a Mercado Pago (la fuente de verdad) para los pedidos recientes en «esperando pago».
 */
export const REMIND_AFTER_MIN = 3;
export const REMIND_EVERY_MIN = 10;
export const MAX_REMINDERS = 6;

export async function sweep(ctx: Ctx): Promise<{ reminded: number; reconciled: number }> {
  const { db } = ctx;
  let reminded = 0;
  const unseen = await db.query<OrderRow & { reminders: number }>(
    `select o.*, (select count(*)::int from office.order_events e where e.order_id = o.id and e.type = 'recordatorio') as reminders
     from office.orders o
     where o.order_status in ('recibido', 'cotizando_envio') and o.seen_at is null
       and o.created_at < $1::timestamptz - make_interval(mins => $2)
       and o.created_at > $1::timestamptz - interval '1 day'
     order by o.created_at limit 20`,
    [ctx.now().toISOString(), REMIND_AFTER_MIN],
  );
  for (const o of unseen) {
    if (o.reminders >= MAX_REMINDERS) continue;
    // «Reclama» el recordatorio con un evento: dos barridos a la vez no avisan dos veces.
    const claimed = await db.query<{ id: number }>(
      `insert into office.order_events (order_id, type, detail, actor, at)
       select $1, 'recordatorio', 'Pedido sin atender: se volvió a avisar', 'sistema', $2::timestamptz
       where not exists (select 1 from office.order_events where order_id = $1 and type = 'recordatorio' and at > $2::timestamptz - make_interval(mins => $3))
       returning id`,
      [o.id, ctx.now().toISOString(), REMIND_EVERY_MIN],
    );
    if (!claimed.length) continue;
    reminded++;
    const mins = Math.round((ctx.now().getTime() - new Date(o.created_at).getTime()) / 60000);
    const payload = { title: `⏰ ${o.number} sin atender (${mins} min)`, body: `${o.customer_name} · nadie lo ha abierto en el panel.`, url: `/admin/pedidos/${o.id}`, tag: `pedido-${o.number}` };
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) ctx.notifier.pushOutbox.push(payload);
    else await sendPushToAll(ctx.config, db, payload).catch((e) => console.error('[barrido] push falló', e));
  }

  let reconciled = 0;
  const waiting = await db.query<OrderRow>(
    `select o.* from office.orders o
     where o.order_status = 'esperando_pago' and o.payment_method = 'online'
       and o.created_at > $1::timestamptz - interval '2 days'
       and exists (select 1 from office.payment_attempts a where a.order_id = o.id)
     order by o.created_at desc limit 10`,
    [ctx.now().toISOString()],
  );
  for (const o of waiting) {
    try {
      await reconcile(ctx, o);
      reconciled++;
    } catch (e) {
      console.error(`[barrido] no se pudo consultar el pago de ${o.number}`, e);
      await addEvent(db, o.id, 'pago', 'Consulta automática del pago falló; se reintenta en el siguiente barrido', 'sistema').catch(() => undefined);
    }
  }
  return { reminded, reconciled };
}

/** Barrido oportunista: como máximo una vez por minuto por instancia, sin bloquear la respuesta. */
let lastRun = 0;
export function maybeSweep(ctx: Ctx, run: (p: Promise<unknown>) => void) {
  const now = Date.now();
  if (now - lastRun < 60_000) return;
  lastRun = now;
  run(sweep(ctx).catch((e) => console.error('[barrido]', e)));
}
