import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
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

function migrationSql() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

// pg devuelve bigint/numeric como texto; nuestros importes son integer, así que basta.
pg.types.setTypeParser(20, (v) => Number(v));

export async function openDb(opts: { url?: string; pglitePath?: string }): Promise<Sql> {
  const sql = opts.url ? postgres(opts.url) : await pglite(opts.pglitePath ?? 'memory://');
  await sql.query(migrationSql());
  return sql;
}

function postgres(url: string): Sql {
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
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
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        await client.query('select pg_advisory_lock(hashtext($1))', [key]);
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
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
                 do $$ begin create role authenticated; exception when duplicate_object then null; end $$;`);

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
