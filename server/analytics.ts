import type { DB } from './db';

export const EVENTS = ['visita', 'ver_producto', 'agregar_carrito', 'crear_equipo', 'unirse_equipo', 'iniciar_checkout', 'compra'] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
export type OrderMode = 'individual' | 'equipo' | 'regalo';
export type Attribution = { source: string | null; medium: string | null; campaign: string | null };

/** Tipo de dispositivo a partir del User-Agent (no se guarda el User-Agent). */
export function deviceOf(ua: string | undefined): 'movil' | 'tablet' | 'escritorio' {
  const s = ua ?? '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(s)) return 'movil';
  return 'escritorio';
}

/** Etiqueta UTM limpia: minúsculas, sin espacios ni símbolos raros. */
export function cleanTag(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_.-]/g, '').slice(0, 60);
  return s || null;
}

export async function recordEvent(
  db: DB,
  e: { event: AnalyticsEvent; visitor: string | null; attribution: Attribution | null; device: string; mode: OrderMode | null; productId: string | null },
) {
  const a = e.attribution;
  await db.query(
    `insert into office.analytics_events (event, visitor, utm_source, utm_medium, utm_campaign, device, mode, product_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.event, e.visitor, a?.source ?? null, a?.medium ?? null, a?.campaign ?? null, e.device, e.mode, e.productId],
  );
}

/** Compra completada: toma la atribución guardada en el pedido. Idempotente por pedido. */
export async function recordPurchase(db: DB, orderId: string) {
  await db.query(
    `insert into office.analytics_events (event, utm_source, utm_medium, utm_campaign, device, mode, order_id)
     select 'compra', utm_source, utm_medium, utm_campaign, device, order_mode, id from office.orders where id = $1
     on conflict (event, order_id) where order_id is not null do nothing`,
    [orderId],
  );
}

export type FunnelRow = {
  key: string;
  visitantes: number;
  vieronProducto: number;
  carrito: number;
  equiposCreados: number;
  checkout: number;
  compras: number;
  ventas: number;
};

const DIMENSIONS = {
  campana: `coalesce(e.utm_source, 'directo') || coalesce(' · ' || e.utm_campaign, '')`,
  dispositivo: `coalesce(e.device, 'desconocido')`,
  modalidad: `coalesce(e.mode, 'sin elegir')`,
} as const;
export type Dimension = keyof typeof DIMENSIONS;

/** Embudo por campaña, dispositivo o modalidad en los últimos N días. */
export async function funnel(db: DB, dimension: Dimension, days: number): Promise<FunnelRow[]> {
  return db.query<FunnelRow>(
    `select ${DIMENSIONS[dimension]} as key,
       count(distinct e.visitor) filter (where e.event = 'visita')::int as "visitantes",
       count(distinct e.visitor) filter (where e.event = 'ver_producto')::int as "vieronProducto",
       count(distinct e.visitor) filter (where e.event = 'agregar_carrito')::int as "carrito",
       count(*) filter (where e.event = 'crear_equipo')::int as "equiposCreados",
       count(distinct e.visitor) filter (where e.event = 'iniciar_checkout')::int as "checkout",
       count(*) filter (where e.event = 'compra')::int as "compras",
       coalesce(sum(o.total) filter (where e.event = 'compra'), 0)::int as "ventas"
     from office.analytics_events e
     left join office.orders o on o.id = e.order_id
     where e.at > now() - make_interval(days => $1)
     group by 1
     order by "compras" desc, "visitantes" desc`,
    [days],
  );
}

/** Los eventos sueltos se guardan un año; los pedidos conservan su atribución para siempre. */
export async function purgeOldEvents(db: DB) {
  const r = await db.query<{ id: number }>("delete from office.analytics_events where at < now() - interval '400 days' and order_id is null returning id");
  return r.length;
}
