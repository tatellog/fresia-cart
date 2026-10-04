import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider, PreferenceInput, ProviderPayment } from './provider';

const API = 'https://api.mercadopago.com';

/**
 * Mercado Pago Checkout Pro. Solo corre en el servidor: el access token nunca
 * llega al navegador. Docs: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro
 */
export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  constructor(private accessToken: string) {}

  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Mercado Pago ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return body as Record<string, unknown>;
  }

  async createPreference(input: PreferenceInput) {
    const body = {
      items: input.items.map((i) => ({ id: i.id, title: i.title, quantity: i.quantity, unit_price: i.unitPrice / 100, currency_id: 'MXN' })),
      external_reference: input.orderId,
      metadata: { order_number: input.orderNumber },
      back_urls: { success: input.returnUrl, failure: input.returnUrl, pending: input.returnUrl },
      auto_return: 'approved',
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      expires: true,
      expiration_date_to: input.expiresAt.toISOString(),
      statement_descriptor: 'FRESIA',
      payer: { name: input.payerName },
    };
    const pref = await this.call('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-Idempotency-Key': input.attemptId },
    });
    return { preferenceId: String(pref.id), checkoutUrl: String(pref.init_point) };
  }

  async getPayment(id: string): Promise<ProviderPayment | null> {
    try {
      return toPayment(await this.call(`/v1/payments/${encodeURIComponent(id)}`));
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async searchByReference(ref: string): Promise<ProviderPayment[]> {
    const r = await this.call(`/v1/payments/search?external_reference=${encodeURIComponent(ref)}&sort=date_created&criteria=desc&limit=50`);
    return ((r.results as Record<string, unknown>[]) ?? []).map(toPayment);
  }
}

function toPayment(p: Record<string, unknown>): ProviderPayment {
  return {
    id: String(p.id),
    status: String(p.status),
    statusDetail: String(p.status_detail ?? ''),
    amount: Math.round(Number(p.transaction_amount) * 100),
    currency: String(p.currency_id ?? ''),
    externalReference: String(p.external_reference ?? ''),
    raw: {
      id: p.id, status: p.status, status_detail: p.status_detail, transaction_amount: p.transaction_amount,
      currency_id: p.currency_id, payment_method_id: p.payment_method_id, payment_type_id: p.payment_type_id,
      date_created: p.date_created, date_approved: p.date_approved, external_reference: p.external_reference,
    }, // sin datos de tarjeta ni del pagador
  };
}

/**
 * Valida el encabezado x-signature de las notificaciones de Mercado Pago.
 * https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
 */
export function verifyMercadoPagoSignature(opts: {
  secret: string;
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  toleranceSeconds?: number;
  nowMs?: number;
}): { ok: boolean; reason?: string } {
  if (!opts.signatureHeader) return { ok: false, reason: 'sin x-signature' };
  const parts = Object.fromEntries(
    opts.signatureHeader.split(',').map((kv) => {
      const [k, ...v] = kv.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, reason: 'x-signature incompleto' };

  let manifest = '';
  if (opts.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac('sha256', opts.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'firma inválida' };

  const tolerance = opts.toleranceSeconds ?? 600;
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs((opts.nowMs ?? Date.now()) - tsMs) > tolerance * 1000) return { ok: false, reason: 'notificación expirada' };
  return { ok: true };
}
