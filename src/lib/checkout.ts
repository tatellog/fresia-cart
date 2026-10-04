import { uuid } from './uuid';
import { useEffect, useState } from 'react';
import type { Address, Fulfillment, PaymentMethod } from '../../shared/types';
import { load, remove, save } from './storage';

export type CheckoutForm = {
  fulfillment: Fulfillment;
  name: string;
  phone: string;
  address: Address;
  notes: string;
  paymentMethod: PaymentMethod;
  /** Efectivo: billete con el que paga (centavos); 'exacto' = el total. */
  cashTendered: number | 'exacto' | null;
};

const KEY = 'fo.checkout.v1';
export const emptyCheckout: CheckoutForm = {
  fulfillment: 'delivery',
  name: '',
  phone: '',
  address: { street: '', number: '', colonia: '', postalCode: '', office: '', references: '' },
  notes: '',
  paymentMethod: 'online',
  cashTendered: null,
};

export function useCheckoutForm() {
  const [form, setForm] = useState<CheckoutForm>(() => ({ ...emptyCheckout, ...load<Partial<CheckoutForm>>(KEY, {}) }));
  useEffect(() => save(KEY, form), [form]);
  return [form, setForm] as const;
}

export function forgetCheckoutForm() {
  remove(KEY);
}

export function readCheckoutForm(): CheckoutForm {
  return { ...emptyCheckout, ...load<Partial<CheckoutForm>>(KEY, {}) };
}

// ── Llave de idempotencia: la misma mientras el pedido no cambie ──
const IKEY = 'fo.idem.v1';
export function idempotencyKeyFor(fingerprint: string): string {
  const prev = load<{ fp: string; key: string } | null>(IKEY, null);
  if (prev && prev.fp === fingerprint) return prev.key;
  const key = uuid();
  save(IKEY, { fp: fingerprint, key });
  return key;
}
export function resetIdempotencyKey() {
  remove(IKEY);
}

// ── Pedidos recientes del cliente (solo en este dispositivo) ──
export type RecentOrder = { number: string; token: string; at: string; cartFingerprint?: string };
const OKEY = 'fo.orders.v1';
export const recentOrders = () => load<RecentOrder[]>(OKEY, []);
export function rememberOrder(o: RecentOrder) {
  save(OKEY, [o, ...recentOrders().filter((x) => x.number !== o.number)].slice(0, 5));
}
