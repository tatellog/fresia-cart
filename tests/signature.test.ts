import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMercadoPagoSignature } from '../server/payments/mercadopago';
import { start } from './helpers';

const secret = 'clave-webhook';
function sign(dataId: string, requestId: string, ts: number) {
  const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('firma de Mercado Pago', () => {
  const ts = Math.floor(Date.now() / 1000);
  it('acepta una firma válida', () => {
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: sign('123', 'req-1', ts), requestId: 'req-1', dataId: '123' }).ok).toBe(true);
  });
  it('rechaza firma alterada, id distinto o notificación vieja', () => {
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: sign('123', 'req-1', ts), requestId: 'req-1', dataId: '999' }).ok).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: undefined, requestId: 'req-1', dataId: '123' }).ok).toBe(false);
    const old = ts - 3600;
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: sign('123', 'req-1', old), requestId: 'req-1', dataId: '123' }).ok).toBe(false);
  });
  it('el endpoint responde 401 a notificaciones sin firma válida', async () => {
    const t = await start({ mpWebhookSecret: secret });
    const r = await t.api('POST', '/api/webhooks/mercadopago?data.id=123&type=payment', { type: 'payment', data: { id: '123' } });
    expect(r.status).toBe(401);
    await t.close();
  });
});
