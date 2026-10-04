import type { DB } from './db';

export type PostalInfo = { cp: string; alcaldia: string; estado: string; colonias: { name: string; tipo: string }[] };

const loaded = new WeakSet<DB>();
/** ¿Se cargó el catálogo? Sin catálogo no se valida (el formulario funciona como antes). */
export async function postalCatalogLoaded(db: DB): Promise<boolean> {
  if (loaded.has(db)) return true;
  if (!(await db.one('select 1 from office.postal_codes limit 1'))) return false;
  loaded.add(db);
  return true;
}

export async function lookupPostalCode(db: DB, cp: string): Promise<PostalInfo | null> {
  if (!/^\d{5}$/.test(cp)) return null;
  const rows = await db.query<{ colonia: string; tipo: string; alcaldia: string; estado: string }>(
    'select colonia, tipo, alcaldia, estado from office.postal_codes where cp = $1 order by colonia',
    [cp],
  );
  if (!rows.length) return null;
  return { cp, alcaldia: rows[0].alcaldia, estado: rows[0].estado, colonias: rows.map((r) => ({ name: r.colonia, tipo: r.tipo })) };
}

/** Lee el archivo de SEPOMEX (separado por |; dos líneas de encabezado). */
export function parseSepomex(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.split('|'))
    .filter((c) => /^\d{5}$/.test(c[0]) && c.length >= 5)
    .map(([cp, colonia, tipo, alcaldia, estado]) => ({ cp, colonia: colonia.trim(), tipo: tipo.trim(), alcaldia: alcaldia.trim(), estado: estado.trim() }));
}
