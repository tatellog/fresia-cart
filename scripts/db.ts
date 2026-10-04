/**
 * Administración de la base de datos de Supabase.
 *
 *   npm run db:migrate   aplica supabase/migrations con el usuario administrador
 *   npm run db:setup     migra y crea/rota la contraseña del rol fresia_office_app,
 *                        y escribe DATABASE_URL (rol de la app) en .env
 *   npm run db:check     comprueba que los permisos sean los esperados
 *   npm run db:catalog   reemplaza el menú por el catálogo base de server/seed.ts
 *   npm run db:cp        carga los códigos postales de SEPOMEX (data/sepomex/cdmx.txt, UTF-8)
 *
 * El usuario administrador se toma de DATABASE_ADMIN_URL (o SESSION_POOLER).
 * Solo se usa desde tu computadora; el servidor nunca lo necesita.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import '../server/env';
import { migrationFiles, openDb, sslFor } from '../server/db';
import { listProducts, loadBaseCatalog } from '../server/store';
import { parseSepomex } from '../server/postal';

const APP_ROLE = 'fresia_office_app';
const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.SESSION_POOLER || '';
const mask = (u: string) => u.replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@');

async function client(url: string) {
  const c = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await c.connect();
  return c;
}

async function migrate() {
  if (!adminUrl) throw new Error('Falta DATABASE_ADMIN_URL (o SESSION_POOLER) en .env');
  const c = await client(adminUrl);
  try {
    await c.query('create schema if not exists office');
    await c.query('create table if not exists office.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    // Las migraciones son idempotentes: se reaplican todas para corregir cualquier desviación de permisos.
    for (const m of migrationFiles()) {
      await c.query('begin');
      try {
        await c.query(m.sql);
        await c.query('insert into office.schema_migrations (name) values ($1) on conflict do nothing', [m.name]);
        await c.query('commit');
        console.log(`✓ ${m.name}`);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`${m.name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
}

async function setup() {
  await migrate();
  const password = randomBytes(24).toString('base64url');
  const c = await client(adminUrl);
  try {
    await c.query(`alter role ${APP_ROLE} with login password '${password}'`);
  } finally {
    await c.end();
  }
  // Mismo host/puerto/base que el admin; el pooler de Supabase usa "rol.proyecto".
  const u = new URL(adminUrl);
  const ref = u.username.includes('.') ? u.username.split('.')[1] : u.hostname.split('.')[1];
  u.username = u.hostname.includes('pooler.supabase.com') ? `${APP_ROLE}.${ref}` : APP_ROLE;
  // El servidor usa el pooler en modo transacción (6543): aguanta muchas conexiones de funciones serverless.
  if (u.hostname.includes('pooler.supabase.com')) u.port = '6543';
  u.password = password;
  const appUrl = u.toString();

  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const line = `DATABASE_URL=${appUrl}`;
  const next = /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, line) : `${env.trimEnd()}\n\n# Rol de mínimo privilegio para el servidor (generado por npm run db:setup)\n${line}\n`;
  writeFileSync('.env', next);
  console.log(`✓ Rol ${APP_ROLE} con contraseña nueva. DATABASE_URL actualizado en .env → ${mask(appUrl)}`);
  console.log('  Usa ese mismo DATABASE_URL en las variables de tu hosting. No subas .env a git.');
  await check();
}

type Check = { name: string; ok: boolean; detail?: string };

async function check() {
  const results: Check[] = [];
  const appUrl = process.env.DATABASE_URL || readEnv('DATABASE_URL');
  if (!adminUrl || !appUrl) throw new Error('Faltan DATABASE_ADMIN_URL/SESSION_POOLER y DATABASE_URL en .env');

  const admin = await client(adminUrl);
  try {
    const tables = (await admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'office' and relkind = 'r'")).rows;
    for (const t of tables) results.push({ name: `RLS activo en office.${t.relname}`, ok: t.relrowsecurity });
    const apiGrants = (await admin.query("select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'office' and grantee in ('anon','authenticated','service_role','PUBLIC')")).rows;
    results.push({ name: 'anon/authenticated/service_role sin permisos en tablas office', ok: apiGrants.length === 0, detail: JSON.stringify(apiGrants) });
    for (const r of ['anon', 'authenticated', 'service_role']) {
      const u = (await admin.query("select has_schema_privilege($1, 'office', 'USAGE') u", [r])).rows[0].u;
      results.push({ name: `${r} sin acceso al esquema office`, ok: !u });
    }
    const exposed = (await admin.query("select table_schema, table_name from information_schema.tables where table_schema = 'public'")).rows;
    results.push({ name: 'Sin tablas en public (expuestas por la API)', ok: exposed.length === 0, detail: JSON.stringify(exposed) });
    const role = (await admin.query('select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = $1', [APP_ROLE])).rows[0];
    results.push({ name: `${APP_ROLE} sin superusuario/bypassrls/createdb/createrole`, ok: !!role && !role.rolsuper && !role.rolbypassrls && !role.rolcreatedb && !role.rolcreaterole });
  } finally {
    await admin.end();
  }

  const app = await client(appUrl);
  const denied = async (name: string, sql: string) => {
    try {
      await app.query('begin');
      await app.query(sql);
      results.push({ name, ok: false, detail: 'se permitió' });
    } catch (e) {
      results.push({ name, ok: /permission denied|must be owner|not allowed|violates row-level/i.test((e as Error).message), detail: (e as Error).message });
    } finally {
      await app.query('rollback').catch(() => undefined);
    }
  };
  try {
    const who = (await app.query('select current_user u')).rows[0].u;
    results.push({ name: 'El servidor se conecta como fresia_office_app', ok: who === APP_ROLE, detail: who });
    const tls = (app as unknown as { connection: { stream: { encrypted?: boolean; authorized?: boolean } } }).connection.stream;
    results.push({ name: 'Conexión cifrada y certificado verificado', ok: !!tls.encrypted && !!tls.authorized });
    const read = await app.query('select count(*)::int n from office.products');
    results.push({ name: 'La app puede leer el menú', ok: read.rows.length === 1 });
    await denied('La app NO puede leer auth.users', 'select * from auth.users limit 1');
    await denied('La app NO puede leer vault.secrets', 'select * from vault.secrets limit 1');
    await denied('La app NO puede borrar pedidos', 'delete from office.orders');
    await denied('La app NO puede borrar pagos', 'delete from office.payments');
    await denied('La app NO puede alterar el historial', 'update office.order_events set detail = detail');
    await denied('La app NO puede cambiar el esquema', 'alter table office.orders add column x int');
    await denied('La app NO puede crear tablas en office', 'create table office.x (id int)');
    await denied('La app NO puede crear tablas en public', 'create table public.x (id int)');
    await denied('La app NO puede borrar tablas', 'drop table office.orders');
    await denied('La app NO puede leer la bitácora de migraciones', 'select * from office.schema_migrations');
  } finally {
    await app.end();
  }

  // La API pública de Supabase no debe ver el esquema.
  const restUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (restUrl && anonKey) {
    const r = await fetch(`${restUrl}/rest/v1/orders?select=*&limit=1`, { headers: { apikey: anonKey, 'Accept-Profile': 'office' } });
    results.push({ name: 'La API REST pública no expone office', ok: r.status >= 400, detail: String(r.status) });
  }

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${!r.ok && r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(failed ? `\n${failed} comprobaciones fallaron.` : `\nTodo en orden (${results.length} comprobaciones).`);
  if (failed) process.exitCode = 1;
}

function readEnv(key: string) {
  if (!existsSync('.env')) return '';
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : '';
}

async function catalog() {
  const appUrl = process.env.DATABASE_URL || readEnv('DATABASE_URL');
  if (!appUrl) throw new Error('Falta DATABASE_URL en .env');
  const db = await openDb({ url: appUrl });
  try {
    await loadBaseCatalog(db);
    const products = await listProducts(db);
    console.log(`✓ Catálogo cargado: ${products.length} productos`);
    for (const p of products) console.log(`  · [${p.section}] ${p.name}: ${p.sizes.map((z) => `${z.label} $${z.price / 100}`).join(', ')}`);
  } finally {
    await db.close();
  }
}

/** Descarga: correosdemexico.gob.mx → Consulta CP → Descarga → Ciudad de México, formato TXT. */
async function postalCodes() {
  const file = process.argv[3] || 'data/sepomex/cdmx.txt';
  if (!existsSync(file)) throw new Error(`No encuentro ${file}`);
  const rows = parseSepomex(readFileSync(file, 'utf8'));
  if (rows.length < 100) throw new Error(`El archivo solo tiene ${rows.length} filas; ¿es el TXT de SEPOMEX en UTF-8?`);
  const appUrl = process.env.DATABASE_URL || readEnv('DATABASE_URL');
  const db = appUrl ? await openDb({ url: appUrl }) : await openDb({ pglitePath: process.env.PGLITE_PATH || './data/pglite' });
  try {
    await db.tx(async (q) => {
      await q.query('delete from office.postal_codes');
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const params = chunk.flatMap((r) => [r.cp, r.colonia, r.tipo, r.alcaldia, r.estado]);
        const values = chunk.map((_, j) => `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`).join(', ');
        await q.query(`insert into office.postal_codes (cp, colonia, tipo, alcaldia, estado) values ${values} on conflict do nothing`, params);
      }
    });
    const n = await db.one<{ n: number }>('select count(*)::int as n from office.postal_codes');
    console.log(`✓ ${n?.n} colonias cargadas (${new Set(rows.map((r) => r.cp)).size} códigos postales)`);
  } finally {
    await db.close();
  }
}

const cmd = process.argv[2];
const run = { migrate, setup, check, catalog, cp: postalCodes }[cmd as 'migrate' | 'setup' | 'check' | 'catalog' | 'cp'];
if (!run) {
  console.error('Uso: tsx scripts/db.ts migrate|setup|check|catalog|cp');
  process.exit(1);
}
run().catch((e) => {
  console.error(`✗ ${(e as Error).message.replace(/postgres(ql)?:\/\/\S+/g, (u) => mask(u))}`);
  process.exit(1);
});
