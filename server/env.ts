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
  /** Aviso de pedidos a tu WhatsApp: '', 'meta' o 'callmebot'. */
  whatsappProvider: '' | 'meta' | 'callmebot';
  /** Número que recibe los avisos; si está vacío se usa el WhatsApp del negocio (panel). */
  whatsappNotifyTo: string;
  callmebotApiKey: string;
  metaWhatsappToken: string;
  metaWhatsappPhoneNumberId: string;
  metaWhatsappTemplate: string;
  metaWhatsappTemplateLang: string;
  /** La plantilla tiene botón de URL dinámica (…/admin/pedidos/{{1}}). */
  metaWhatsappTemplateButton: boolean;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const port = Number(process.env.PORT ?? 8787);
  const cfg: Config = {
    port,
    publicUrl: (
      process.env.PUBLIC_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
      `http://localhost:${port}`
    ).replace(/\/$/, ''),
    databaseUrl: process.env.DATABASE_URL || '',
    pglitePath: process.env.PGLITE_PATH || './data/pglite',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    production,
    mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
    mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
    whatsappProvider: (['meta', 'callmebot'].includes(process.env.WHATSAPP_PROVIDER ?? '') ? process.env.WHATSAPP_PROVIDER : '') as Config['whatsappProvider'],
    whatsappNotifyTo: process.env.WHATSAPP_NOTIFY_TO || '',
    callmebotApiKey: process.env.CALLMEBOT_APIKEY || '',
    metaWhatsappToken: process.env.META_WHATSAPP_TOKEN || '',
    metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
    metaWhatsappTemplate: process.env.META_WHATSAPP_TEMPLATE || '',
    metaWhatsappTemplateLang: process.env.META_WHATSAPP_TEMPLATE_LANG || 'es_MX',
    metaWhatsappTemplateButton: process.env.META_WHATSAPP_TEMPLATE_BUTTON !== '0',
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
