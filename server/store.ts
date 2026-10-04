import type { DB } from './db';
import type { BusinessInfo, DeliveryConfig, LegalDoc, LegalSlug, Product, Topping } from '../shared/types';
import { DEMO_BUSINESS, DEMO_DELIVERY, DEMO_PRODUCTS, DEMO_TOPPINGS, LEGAL_DRAFTS } from './seed';

// ── Ajustes (clave → JSON) ──────────────────────────────────────────────

async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const row = await db.one<{ value: T }>('select value from office.settings where key = $1', [key]);
  return row ? row.value : fallback;
}

async function setSetting(db: DB, key: string, value: unknown) {
  await db.query(
    'insert into office.settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

export const getBusiness = (db: DB) => getSetting<BusinessInfo>(db, 'business', DEMO_BUSINESS);
export const setBusiness = (db: DB, v: BusinessInfo) => setSetting(db, 'business', v);
export const getDelivery = (db: DB) => getSetting<DeliveryConfig>(db, 'delivery', DEMO_DELIVERY);
export const setDelivery = (db: DB, v: DeliveryConfig) => setSetting(db, 'delivery', v);

export const getLegal = (db: DB, slug: LegalSlug) => getSetting<LegalDoc>(db, `legal:${slug}`, LEGAL_DRAFTS[slug]);
export const setLegal = (db: DB, doc: LegalDoc) => setSetting(db, `legal:${doc.slug}`, doc);

/** Número de pedido consecutivo y legible: FO-1001, FO-1002… */
export async function nextOrderNumber(db: DB): Promise<string> {
  const row = await db.one<{ n: number }>("select nextval('office.order_number_seq')::int as n");
  return `FO-${row!.n}`;
}

// ── Catálogo ───────────────────────────────────────────────────────────

export async function listProducts(db: DB): Promise<Product[]> {
  const rows = await db.query<{ data: Product }>('select data from office.products');
  return rows.map((r) => r.data).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
export async function saveProduct(db: DB, p: Product) {
  await db.query('insert into office.products (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [p.id, JSON.stringify(p)]);
}
export async function deleteProduct(db: DB, id: string) {
  await db.query('delete from office.products where id = $1', [id]);
}

export async function listToppings(db: DB): Promise<Topping[]> {
  const rows = await db.query<{ data: Topping }>('select data from office.toppings');
  return rows.map((r) => r.data).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
export async function saveTopping(db: DB, t: Topping) {
  await db.query('insert into office.toppings (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [t.id, JSON.stringify(t)]);
}
export async function deleteTopping(db: DB, id: string) {
  await db.query('delete from office.toppings where id = $1', [id]);
}

/** Primera ejecución: carga contenido de ejemplo claramente marcado. */
export async function seedIfEmpty(db: DB) {
  const row = await db.one<{ n: number }>('select count(*)::int as n from office.products');
  if (row!.n > 0) return;
  for (const t of DEMO_TOPPINGS) await saveTopping(db, t);
  for (const p of DEMO_PRODUCTS) await saveProduct(db, p);
}
