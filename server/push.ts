import webpush from 'web-push';
import type { DB } from './db';
import type { Config } from './env';

/**
 * Notificaciones push a los dispositivos del negocio (laptop del local, celular
 * con el panel agregado a la pantalla de inicio). Gratis y sin intermediarios
 * comerciales: el navegador entrega el aviso aunque el panel esté cerrado.
 */
export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = { title: string; body: string; url: string; tag: string };

export const pushConfigured = (cfg: Config) => Boolean(cfg.vapidPublicKey && cfg.vapidPrivateKey);

export async function saveSubscription(db: DB, sub: PushSubscriptionJSON, label: string) {
  await db.query(
    `insert into office.push_subscriptions (endpoint, keys, label) values ($1, $2::jsonb, $3)
     on conflict (endpoint) do update set keys = excluded.keys, label = excluded.label, failures = 0`,
    [sub.endpoint, JSON.stringify(sub.keys), label],
  );
}

export async function removeSubscription(db: DB, endpoint: string) {
  await db.query('delete from office.push_subscriptions where endpoint = $1', [endpoint]);
}

export async function listSubscriptions(db: DB) {
  return db.query<{ endpoint: string; keys: PushSubscriptionJSON['keys']; label: string; created_at: Date; last_success_at: Date | null }>(
    'select endpoint, keys, label, created_at, last_success_at from office.push_subscriptions order by created_at',
  );
}

/** Envía a todos los dispositivos; borra los que el navegador ya dio de baja. */
export async function sendPushToAll(cfg: Config, db: DB, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured(cfg)) return { sent: 0, failed: 0 };
  webpush.setVapidDetails(cfg.publicUrl.startsWith('https://') ? cfg.publicUrl : 'https://fresia-office.vercel.app', cfg.vapidPublicKey, cfg.vapidPrivateKey);
  const subs = await listSubscriptions(db);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 60 * 60, urgency: 'high', topic: payload.tag.slice(0, 32) });
        sent++;
        await db.query('update office.push_subscriptions set last_success_at = now(), failures = 0 where endpoint = $1', [s.endpoint]);
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await removeSubscription(db, s.endpoint);
        else await db.query('update office.push_subscriptions set failures = failures + 1 where endpoint = $1', [s.endpoint]);
      }
    }),
  );
  return { sent, failed };
}
