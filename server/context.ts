import type { DB } from './db';
import type { Config } from './env';
import type { PaymentProvider } from './payments/provider';
import type { Notifier } from './notify';

export type Ctx = { db: DB; config: Config; provider: PaymentProvider; notifier: Notifier };

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
