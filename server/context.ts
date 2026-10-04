import type { DB } from './db';
import type { Config } from './env';
import type { PaymentProvider } from './payments/provider';
import type { Notifier } from './notify';

export type Ctx = { db: DB; config: Config; provider: PaymentProvider; notifier: Notifier };

/**
 * ¿Se puede ofrecer «Pagar en línea»? Con el simulador (sin Mercado Pago) solo fuera de
 * producción: en la tienda pública cualquiera podría «pagar» sin pagar.
 */
export function onlinePaymentReady(ctx: Pick<Ctx, 'config' | 'provider'>): boolean {
  return ctx.provider.name === 'mercadopago' || !ctx.config.production || process.env.ALLOW_DEMO_PAYMENTS === '1';
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
