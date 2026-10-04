import type { DB } from './db';
import type { BusinessInfo, DeliveryConfig, LegalDoc, LegalSlug, MenuRules, Product, Topping } from '../shared/types';
import { DEFAULT_SCHEDULE, scheduleText } from '../shared/schedule';
import type { Schedule } from '../shared/schedule';
import { DEFAULT_RULES, DEMO_BUSINESS, DEMO_DELIVERY, DEMO_PRODUCTS, DEMO_TOPPINGS, LEGAL_DRAFTS } from './seed';

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
export const getSchedule = async (db: DB): Promise<Schedule> => ({ ...DEFAULT_SCHEDULE, ...(await getSetting<Partial<Schedule>>(db, 'schedule', {})) });
/** Guarda el horario y actualiza el texto de horario que ve el cliente. */
export async function setSchedule(db: DB, s: Schedule) {
  await setSetting(db, 'schedule', s);
  const b = await getBusiness(db);
  await setSetting(db, 'business', { ...b, hours: scheduleText(s) });
}
export const setBusiness = (db: DB, v: BusinessInfo) => setSetting(db, 'business', v);
export const getRules = async (db: DB) => ({ ...DEFAULT_RULES, ...(await getSetting<Partial<MenuRules>>(db, 'rules', {})) });
export const setRules = (db: DB, v: MenuRules) => setSetting(db, 'rules', v);
export const getDelivery = async (db: DB): Promise<DeliveryConfig> => ({ ...DEMO_DELIVERY, ...(await getSetting<Partial<DeliveryConfig>>(db, 'delivery', {})) });
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
  return rows.map((r) => normalizeProduct(r.data)).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
export async function saveProduct(db: DB, p: Product) {
  await db.query('insert into office.products (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [p.id, JSON.stringify(p)]);
}
export async function deleteProduct(db: DB, id: string) {
  await db.query('delete from office.products where id = $1', [id]);
}

export async function listToppings(db: DB): Promise<Topping[]> {
  const rows = await db.query<{ data: Topping }>('select data from office.toppings');
  return rows.map((r) => ({ ...r.data, premium: r.data.premium ?? false })).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
export async function saveTopping(db: DB, t: Topping) {
  await db.query('insert into office.toppings (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data', [t.id, JSON.stringify(t)]);
}
export async function deleteTopping(db: DB, id: string) {
  await db.query('delete from office.toppings where id = $1', [id]);
}

/** Primera ejecución: carga el catálogo base. */
export async function seedIfEmpty(db: DB) {
  const row = await db.one<{ n: number }>('select count(*)::int as n from office.products');
  if (row!.n > 0) return;
  await loadBaseCatalog(db);
}

/**
 * Reemplaza el catálogo por el catálogo base de seed.ts (borra lo que no esté ahí).
 * Solo se usa con `npm run db:catalog`; los cambios del panel posteriores se respetan.
 */
export async function loadBaseCatalog(db: DB) {
  await db.tx(async (q) => {
    await q.query('delete from office.products where not (id = any($1))', [DEMO_PRODUCTS.map((p) => p.id)]);
    await q.query('delete from office.toppings where not (id = any($1))', [DEMO_TOPPINGS.map((t) => t.id)]);
    for (const t of DEMO_TOPPINGS) await saveTopping(q, t);
    for (const p of DEMO_PRODUCTS) await saveProduct(q, p);
  });
}

/** Normaliza productos guardados con el formato anterior. */
export function normalizeProduct(p: Partial<Product> & Pick<Product, 'id' | 'name'>): Product {
  return {
    description: '', image: '', section: 'Menú', sizes: [], toppingIds: [], includedToppings: 0, freePremiumIds: [], maxToppings: null,
    fresiaUnits: 0, combo: null, available: false, sort: 0, example: true, ...p,
  } as Product;
}
