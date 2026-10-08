import { z } from 'zod';
import { isPostalCode } from '../shared/coverage';

const text = (max: number) => z.string().trim().max(max);

const choiceSchema = z.object({
  slotId: text(60).min(1),
  productId: text(60).min(1),
  sizeId: text(60).min(1),
  toppingIds: z.array(text(60)).max(20),
});

export const lineSchema = z.object({
  productId: text(60).min(1),
  sizeId: text(60).min(1),
  toppingIds: z.array(text(60)).max(20),
  choices: z.array(choiceSchema).max(30).optional(),
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
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100000) })
    .nullable()
    .optional(),
});

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 10 || (s.length === 12 && s.startsWith('52')), 'Escribe un teléfono de 10 dígitos.');

export const groupRefSchema = z.object({ code: z.string().regex(/^[a-z0-9]{6,12}$/), token: z.string().min(10).max(100) });

export const quoteSchema = z.object({
  fulfillment: z.enum(['delivery', 'pickup']),
  address: addressSchema.nullable(),
  // En pedidos de equipo los productos vienen del grupo (se ignoran estos).
  items: z.array(lineSchema).max(120),
  group: groupRefSchema.nullable().optional(),
  /** Fresigrama: sin pedido mínimo. */
  gift: z.boolean().optional(),
});

export const invoiceSchema = z.object({
  rfc: text(20).min(12, 'RFC inválido.'),
  name: text(200).min(2),
  regime: z.string().regex(/^\d{3}$/),
  zip: z.string().regex(/^\d{5}$/, 'El código postal fiscal tiene 5 dígitos.'),
  use: z.string().regex(/^[A-Z]\d{2}$/),
  email: z.string().trim().email('Correo inválido.').max(120),
});

export const giftSchema = z.object({
  to: text(80).min(2, 'Escribe para quién es el regalo.'),
  note: text(160).default(''),
  anonymous: z.boolean().default(false),
});

export const orderSchema = quoteSchema.extend({
  idempotencyKey: z.string().uuid(),
  paymentMethod: z.enum(['online', 'contra_entrega']).default('online'),
  source: z.string().regex(/^[a-z0-9-]{1,40}$/).nullable().optional(),
  invoice: invoiceSchema.nullable().optional(),
  gift: giftSchema.nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  /** Efectivo: billete con el que paga, en centavos (null = exacto). */
  cashTendered: z.number().int().min(0).max(5_000_000).nullable().default(null),
  customer: z.object({ name: text(80).min(2, 'Escribe tu nombre.'), phone: phoneSchema }),
  notes: text(300).default(''),
})
  .refine((o) => o.fulfillment === 'pickup' || o.address != null, { message: 'Falta la dirección de entrega.' })
  .refine((o) => o.items.length > 0 || o.group, { message: 'Tu carrito está vacío.' });

export const coverageSchema = z.object({
  postalCode: z.string().trim(),
  colonia: text(80),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100000) }).nullable().optional(),
});

// ── Panel ──
const money = z.number().int().min(0).max(10_000_00);
const id = z.string().trim().regex(/^[a-z0-9-]{1,60}$/, 'Usa minúsculas, números y guiones.');

export const productSchema = z.object({
  id,
  name: text(80).min(1),
  description: text(240),
  image: text(300),
  section: text(40).min(1, 'Indica la sección del menú.'),
  sizes: z.array(z.object({ id, label: text(40).min(1), price: money })).min(1, 'Agrega al menos un tamaño.'),
  toppingIds: z.array(id),
  includedToppings: z.number().int().min(0).max(10),
  freePremiumIds: z.array(id),
  maxToppings: z.number().int().min(0).max(20).nullable(),
  fresiaUnits: z.number().int().min(0).max(20),
  combo: z
    .array(
      z.object({
        id,
        label: text(60).min(1),
        qty: z.number().int().min(1).max(20),
        options: z.array(z.object({ productId: id, sizeId: id })).min(1, 'Cada parte del combo necesita al menos una opción.'),
      }),
    )
    .min(1, 'El combo necesita al menos una parte.')
    .nullable(),
  available: z.boolean(),
  sort: z.number().int(),
  example: z.boolean(),
});

export const toppingSchema = z.object({ id, name: text(60).min(1), price: money, premium: z.boolean(), available: z.boolean(), sort: z.number().int(), example: z.boolean() });

export const rulesSchema = z.object({ extraToppingPrice: money, minFresias: z.number().int().min(0).max(100), minQtyPerItem: z.number().int().min(1).max(50) });

export const deliverySchema = z.object({
  mode: z.enum(['radius', 'zones']),
  origin: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
  radiusM: z.number().int().min(50).max(20000),
  radiusFee: money,
  freeShippingFrom: money.nullable(),
  prepMin: z.number().int().min(0).max(600).nullable(),
  prepMax: z.number().int().min(0).max(600).nullable(),
  handoffMin: z.number().int().min(0).max(120),
  courierMode: z.enum(['walk', 'bike', 'moto']),
  deliveryEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  onlinePayment: z.boolean(),
  cashOnDelivery: z.boolean(),
  cashOnDeliveryNote: text(120),
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
export const orderFilter = z.enum(['activos', 'sin_pagar', 'revision', 'todos', 'programados']);
export const orderStatus = z.enum(['recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'cancelado']);
export const refundStatus = z.enum(['no_aplica', 'pendiente', 'reembolsado']);
export const shippingQuote = z.object({ fee: money, etaText: text(60).min(1, 'Indica el tiempo estimado.') });

export const pushEndpointSchema = z.object({ endpoint: z.string().url().startsWith('https://').max(1000) });
export const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().startsWith('https://').max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  label: text(80).default(''),
});

export const courierLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000),
  mode: z.enum(['walk', 'bike', 'moto']).default('walk'),
});

export const createGroupSchema = z.object({
  name: text(60).min(2, 'Ponle nombre al pedido (p. ej. «Equipo de Ventas»).'),
  organizerName: text(40).min(2, 'Escribe tu nombre.'),
  closesInMinutes: z.number().int().min(10).max(24 * 60).nullable().default(null),
});
export const groupItemSchema = z.object({
  memberName: text(40).min(2, 'Escribe tu nombre.'),
  memberKey: z.string().min(10).max(80),
  line: lineSchema,
});
export const qrSourceSchema = z.object({
  label: text(60).min(2, 'Escribe el nombre del edificio.'),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Usa minúsculas, números y guiones.'),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z.object({
  days: z.array(z.object({ open: hhmm, close: hhmm }).nullable()).length(7),
  leadMinutes: z.number().int().min(0).max(24 * 60),
  slotMinutes: z.number().int().min(10).max(120),
  maxDays: z.number().int().min(1).max(14),
});
export const invoiceStatusSchema = z.enum(['solicitada', 'emitida']);
