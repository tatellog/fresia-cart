export type ProviderPayment = {
  id: string;
  /** Estado tal como lo reporta la plataforma (approved, pending, rejected…). */
  status: string;
  statusDetail: string;
  amount: number; // centavos
  currency: string;
  externalReference: string;
  raw: unknown;
};

export type PreferenceInput = {
  attemptId: string;
  orderId: string;
  orderNumber: string;
  items: { id: string; title: string; quantity: number; unitPrice: number }[];
  total: number;
  returnUrl: string;
  notificationUrl: string | null;
  payerName: string;
  expiresAt: Date;
};

export interface PaymentProvider {
  readonly name: 'mercadopago' | 'demo';
  createPreference(input: PreferenceInput): Promise<{ preferenceId: string; checkoutUrl: string }>;
  /** Consulta directa a la plataforma: es la única fuente de verdad del estado. */
  getPayment(id: string): Promise<ProviderPayment | null>;
  searchByReference(externalReference: string): Promise<ProviderPayment[]>;
}

/** Estados de Mercado Pago que significan "dinero en camino, no cobres otra vez". */
export const IN_FLIGHT = new Set(['pending', 'in_process', 'authorized', 'in_mediation']);
