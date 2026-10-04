import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

// Carga .env sin dependencias (solo KEY=VALUE).
if (existsSync('.env')) {
  for (const raw of readFileSync('.env', 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export type Config = {
  port: number;
  publicUrl: string;
  /** Supabase/Postgres. Vacío → PGlite local (solo desarrollo y demostración). */
  databaseUrl: string;
  pglitePath: string;
  adminPassword: string;
  sessionSecret: string;
  production: boolean;
  mpAccessToken: string;
  mpWebhookSecret: string;
  notifyWebhookUrl: string;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 8787);
  const cfg: Config = {
    port,
    publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    databaseUrl: process.env.DATABASE_URL || '',
    pglitePath: process.env.PGLITE_PATH || './data/pglite',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    production,
    mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
    mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
    ...overrides,
  };
  if (!cfg.databaseUrl) {
    if (production && process.env.ALLOW_LOCAL_DB !== '1') throw new Error('Falta DATABASE_URL (Supabase).');
    console.warn(`[db] DATABASE_URL no está definida: usando Postgres local embebido (PGlite) en ${cfg.pglitePath}.`);
  }
  if (!cfg.sessionSecret) {
    if (production) throw new Error('Falta SESSION_SECRET.');
    cfg.sessionSecret = randomBytes(32).toString('hex');
  }
  if (!cfg.adminPassword) {
    if (production) throw new Error('Falta ADMIN_PASSWORD.');
    cfg.adminPassword = randomBytes(9).toString('base64url');
    console.warn(`[admin] ADMIN_PASSWORD no está definida. Contraseña temporal de esta sesión: ${cfg.adminPassword}`);
  }
  return cfg;
}
