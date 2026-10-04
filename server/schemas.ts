import { z } from 'zod';
import { isPostalCode } from '../shared/coverage';

const text = (max: number) => z.string().trim().max(max);

export const lineSchema = z.object({
  productId: text(60).min(1),
  sizeId: text(60).min(1),
  toppingIds: z.array(text(60)).max(20),
  qty: z.number().int().min(1).max(50),
  forWhom: text(40).optional(),
});

export const addressSchema = z.object({
  street: text(120).min(2, 'Escribe la calle.'),
  number: text(20).min(1, 'Escribe el número.'),
  colonia: text(80).min(2, 'Escribe la colonia.'),
  postalCode: z.string().trim().refine(isPostalCode, 'El código postal debe tener 5 dígitos.'),
  office: text(80).min(1, 'Indica oficina o piso.'),
  references: text(200),
});

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 10 || (s.length === 12 && s.startsWith('52')), 'Escribe un teléfono de 10 dígitos.');

export const quoteSchema = z.object({
  fulfillment: z.enum(['delivery', 'pickup']),
  address: addressSchema.nullable(),
  items: z.array(lineSchema).min(1, 'Tu carrito está vacío.').max(30),
});

export const orderSchema = quoteSchema.extend({
  idempotencyKey: z.string().uuid(),
  customer: z.object({ name: text(80).min(2, 'Escribe tu nombre.'), phone: phoneSchema }),
  notes: text(300).default(''),
}).refine((o) => o.fulfillment === 'pickup' || o.address != null, { message: 'Falta la dirección de entrega.' });

export const coverageSchema = z.object({ postalCode: z.string().trim().refine(isPostalCode, 'El código postal debe tener 5 dígitos.'), colonia: text(80) });

// ── Panel ──
const money = z.number().int().min(0).max(10_000_00);
const id = z.string().trim().regex(/^[a-z0-9-]{1,60}$/, 'Usa minúsculas, números y guiones.');

export const productSchema = z.object({
  id,
  name: text(80).min(1),
  description: text(240),
  image: text(300),
  sizes: z.array(z.object({ id, label: text(40).min(1), price: money })).min(1, 'Agrega al menos un tamaño.'),
  toppingIds: z.array(id),
  maxToppings: z.number().int().min(0).max(20).nullable(),
  available: z.boolean(),
  sort: z.number().int(),
  example: z.boolean(),
});

export const toppingSchema = z.object({ id, name: text(60).min(1), price: money, available: z.boolean(), sort: z.number().int(), example: z.boolean() });

export const deliverySchema = z.object({
  deliveryEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  pickupPrepText: text(80),
  outOfZone: z.enum(['reject', 'manual']),
  example: z.boolean(),
  zones: z.array(
    z.object({
      id,
      name: text(60).min(1),
      postalCodes: z.array(z.string().refine(isPostalCode, 'Código postal inválido.')),
      colonias: z.array(text(80)),
      fee: money,
      etaMin: z.number().int().min(0).max(600),
      etaMax: z.number().int().min(0).max(600),
      mode: z.enum(['auto', 'manual']),
      active: z.boolean(),
    }),
  ),
});

export const businessSchema = z.object({
  name: text(60).min(1),
  address: text(200),
  mapsUrl: z.union([z.literal(''), z.string().url().startsWith('https://')]),
  hours: text(300),
  whatsapp: z.string().regex(/^(\d{12,13})?$/, 'Usa solo dígitos con lada de país, p. ej. 5215512345678.'),
  email: z.union([z.literal(''), z.string().email()]),
  example: z.boolean(),
});

export const legalSchema = z.object({ title: text(80).min(1), body: text(20000), approved: z.boolean() });

export const demoOutcome = z.enum(['approved', 'pending', 'rejected']);
export const demoPaymentStatus = z.enum(['approved', 'rejected', 'cancelled', 'refunded']);
export const orderFilter = z.enum(['activos', 'sin_pagar', 'revision', 'todos']);
export const orderStatus = z.enum(['recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'cancelado']);
export const refundStatus = z.enum(['no_aplica', 'pendiente', 'reembolsado']);
export const shippingQuote = z.object({ fee: money, etaText: text(60).min(1, 'Indica el tiempo estimado.') });
