import { waitUntil } from '@vercel/functions';

/**
 * Tarea que debe terminar aunque ya se haya respondido (avisos, notificación
 * simulada). En Vercel la función se congela al responder salvo con waitUntil.
 */
export function background(task: Promise<unknown>) {
  const safe = task.catch((e) => console.error('[segundo plano]', e));
  if (process.env.VERCEL) waitUntil(safe);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
