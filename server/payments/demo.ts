import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { PaymentProvider, PreferenceInput, ProviderPayment } from './provider';

/**
 * Proveedor de DEMOSTRACIÓN. Imita la forma en que funciona Mercado Pago
 * (preferencia → pago → notificación → consulta de estado) sin mover dinero.
 */
export class DemoProvider implements PaymentProvider {
  readonly name = 'demo' as const;
  constructor(private db: DB) {}

  async createPreference(input: PreferenceInput) {
    const id = `demo-pref-${randomUUID()}`;
    await this.db.query('insert into office.demo_preferences (id, external_reference, amount, title, return_url) values ($1, $2, $3, $4, $5)', [
      id, input.orderId, input.total, `Pedido ${input.orderNumber}`, input.returnUrl,
    ]);
    return { preferenceId: id, checkoutUrl: `/demo-pago/${id}` };
  }

  async getPayment(id: string): Promise<ProviderPayment | null> {
    const row = await this.db.one<MockRow>('select * from office.demo_payments where id = $1', [id]);
    return row ? toPayment(row) : null;
  }

  async searchByReference(ref: string): Promise<ProviderPayment[]> {
    const rows = await this.db.query<MockRow>('select * from office.demo_payments where external_reference = $1 order by created_at desc', [ref]);
    return rows.map(toPayment);
  }

  getPreference(id: string) {
    return this.db.one<{ id: string; external_reference: string; amount: number; title: string; return_url: string }>(
      'select * from office.demo_preferences where id = $1',
      [id],
    );
  }

  /** Simula que el cliente pagó en la plataforma. */
  async simulatePayment(preferenceId: string, status: 'approved' | 'pending' | 'rejected'): Promise<string> {
    const pref = await this.getPreference(preferenceId);
    if (!pref) throw new Error('Preferencia no encontrada');
    const id = `demo-pay-${randomUUID().slice(0, 8)}`;
    const detail = { approved: 'accredited', pending: 'pending_waiting_payment', rejected: 'cc_rejected_other_reason' }[status];
    await this.db.query(
      'insert into office.demo_payments (id, preference_id, external_reference, amount, status, status_detail) values ($1, $2, $3, $4, $5, $6)',
      [id, preferenceId, pref.external_reference, pref.amount, status, detail],
    );
    return id;
  }

  /** Simula que un pago pendiente cambió de estado (p. ej. pago en efectivo acreditado). */
  async setPaymentStatus(paymentId: string, status: 'approved' | 'rejected' | 'cancelled' | 'refunded') {
    await this.db.query('update office.demo_payments set status = $2, status_detail = $3 where id = $1', [paymentId, status, `demo_${status}`]);
  }
}

type MockRow = { id: string; external_reference: string; amount: number; status: string; status_detail: string };
const toPayment = (r: MockRow): ProviderPayment => ({
  id: r.id,
  status: r.status,
  statusDetail: r.status_detail,
  amount: r.amount,
  currency: 'MXN',
  externalReference: r.external_reference,
  raw: { ...r, demo: true },
});
