import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

/**
 * Acceso a Postgres. En producción: Supabase vía DATABASE_URL (conexión directa
 * o pooler en modo sesión). En pruebas o sin DATABASE_URL: PGlite, un Postgres
 * embebido que ejecuta exactamente la misma SQL.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined>;
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  /** Exclusión mutua entre instancias del servidor (pg_advisory_lock). */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type DB = Sql;

const MIGRATIONS = resolve('supabase/migrations');

export function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
}

// pg devuelve bigint/numeric como texto; nuestros importes son integer, así que basta.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Abre la base. Con Postgres (Supabase) NO aplica migraciones: eso lo hace
 * `npm run db:migrate` con el usuario administrador; el servidor usa un rol
 * de mínimo privilegio que no puede cambiar el esquema.
 */
export async function openDb(opts: { url?: string; pglitePath?: string; production?: boolean }): Promise<Sql> {
  if (!opts.url) {
    const sql = await pglite(opts.pglitePath ?? 'memory://');
    for (const m of migrationFiles()) await sql.query(m.sql);
    return sql;
  }
  const sql = postgres(opts.url);
  const exists = await sql.one<{ ok: boolean }>("select to_regclass('office.orders') is not null as ok");
  if (!exists?.ok) throw new Error('El esquema office no existe. Ejecuta `npm run db:migrate`.');
  const role = await sql.one<{ name: string; bypass: boolean; super: boolean }>(
    'select current_user as name, rolbypassrls as bypass, rolsuper as super from pg_roles where rolname = current_user',
  );
  if (role && (role.bypass || role.super)) {
    const msg = `[db] El servidor está conectado como "${role.name}", que se salta RLS. Usa el rol fresia_office_app (npm run db:setup).`;
    if (opts.production && process.env.ALLOW_ADMIN_DB !== '1') throw new Error(msg);
    console.warn(msg);
  }
  return sql;
}

/** TLS verificado contra la CA oficial de Supabase (server/certs). Nunca rejectUnauthorized: false. */
export function sslFor(url: string): pg.ConnectionConfig['ssl'] {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return undefined;
  const caFile = process.env.DATABASE_CA_FILE || resolve('server/certs/supabase-prod-ca-2021.crt');
  if (!existsSync(caFile)) throw new Error(`No encuentro el certificado de la base de datos: ${caFile}`);
  return { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
}

export function postgres(url: string): Sql {
  const pool = new pg.Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
    // Pocas conexiones por instancia: en Vercel hay varias instancias contra el pooler de Supabase.
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    ssl: sslFor(url),
  });
  pool.on('error', (e) => console.error('[db] error de conexión', e.message));

  const wrap = (c: pg.Pool | pg.PoolClient): Omit<Sql, 'tx' | 'withLock' | 'close'> => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await c.query(text, params)).rows as T[];
    },
    async one<T>(text: string, params: unknown[] = []) {
      return (await c.query(text, params)).rows[0] as T | undefined;
    },
  });

  const self: Sql = {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      const q: Sql = { ...wrap(client), tx: (f) => f(q), withLock: (_k, f) => f(), close: async () => undefined };
      try {
        await client.query('begin');
        const out = await fn(q);
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    // Candado dentro de una transacción (pg_advisory_xact_lock): se libera solo al terminar y
    // funciona igual con el pooler de Supabase en modo sesión o en modo transacción.
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
        const out = await fn();
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return self;
}

async function pglite(path: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (!path.startsWith('memory://')) mkdirSync(path, { recursive: true });
  const db = new PGlite(path);
  // Roles que Supabase ya trae y la migración referencia.
  await db.exec(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
                 do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
                 do $$ begin create role service_role; exception when duplicate_object then null; end $$;`);

  type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };
  const wrap = (c: Q): Omit<Sql, 'tx' | 'withLock' | 'close'> => ({
    async query<T>(text: string, params: unknown[] = []) {
      // Varias sentencias sin parámetros (migración) → exec.
      if (params.length === 0 && text.includes(';')) {
        await c.exec(text);
        return [] as T[];
      }
      return (await c.query(text, params)).rows as T[];
    },
    async one<T>(text: string, params: unknown[] = []) {
      return (await c.query(text, params)).rows[0] as T | undefined;
    },
  });

  return {
    ...wrap(db as unknown as Q),
    tx: (fn) =>
      db.transaction(async (t) => {
        const q: Sql = { ...wrap(t as unknown as Q), tx: (f) => f(q), withLock: (_k, f) => f(), close: async () => undefined };
        return fn(q);
      }),
    withLock: (_key, fn) => fn(), // una sola conexión y una sola instancia
    close: () => db.close(),
  };
}

export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
export const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
