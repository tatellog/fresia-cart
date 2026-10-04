// Modelo compartido entre navegador y servidor.
// Todos los importes van en centavos (enteros) para evitar errores de redondeo.

export type Size = { id: string; label: string; price: number };

export type Product = {
  id: string;
  name: string;
  description: string;
  image: string;
  sizes: Size[];
  toppingIds: string[];
  maxToppings: number | null;
  available: boolean;
  sort: number;
  /** Contenido de ejemplo (no aprobado por el negocio). */
  example: boolean;
};

export type Topping = {
  id: string;
  name: string;
  price: number;
  available: boolean;
  sort: number;
  example: boolean;
};

export type CartLineInput = {
  productId: string;
  sizeId: string;
  toppingIds: string[];
  qty: number;
  forWhom?: string;
};

export type PricedLine = {
  productId: string;
  name: string;
  sizeId: string;
  sizeLabel: string;
  basePrice: number;
  toppings: { id: string; name: string; price: number }[];
  unitPrice: number;
  qty: number;
  lineTotal: number;
  forWhom: string;
};

export type Zone = {
  id: string;
  name: string;
  postalCodes: string[];
  /** Si está vacío, cualquier colonia del código postal está cubierta. */
  colonias: string[];
  fee: number;
  etaMin: number;
  etaMax: number;
  /** auto: tarifa fija · manual: requiere cotización por WhatsApp. */
  mode: 'auto' | 'manual';
  active: boolean;
};

export type DeliveryConfig = {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  /** Texto libre, p. ej. "Listo en 20–30 min". Vacío = pendiente. */
  pickupPrepText: string;
  outOfZone: 'reject' | 'manual';
  zones: Zone[];
  example: boolean;
};

export type BusinessInfo = {
  name: string;
  address: string;
  mapsUrl: string;
  hours: string;
  whatsapp: string; // solo dígitos con lada de país, p. ej. 5215512345678
  email: string;
  example: boolean;
};

export type LegalDoc = { slug: LegalSlug; title: string; body: string; approved: boolean };
export type LegalSlug = 'privacidad' | 'entregas' | 'cancelaciones';

export type Address = {
  street: string;
  number: string;
  colonia: string;
  postalCode: string;
  office: string;
  references: string;
};

export type Fulfillment = 'delivery' | 'pickup';

export type DeliveryQuote =
  | { status: 'pickup' }
  | { status: 'covered'; zoneId: string; zoneName: string; fee: number; etaMin: number; etaMax: number }
  | { status: 'manual'; reason: string; zoneName?: string }
  | { status: 'not_covered' }
  | { status: 'quoted'; fee: number; etaText: string };

export type PaymentStatus = 'sin_pagar' | 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado' | 'devuelto';

export type OrderStatus =
  | 'cotizando_envio'
  | 'esperando_pago'
  | 'recibido'
  | 'confirmado'
  | 'en_preparacion'
  | 'listo'
  | 'en_camino'
  | 'entregado'
  | 'cancelado';

export type RefundStatus = 'no_aplica' | 'pendiente' | 'reembolsado';

export type PublicOrder = {
  number: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  fulfillment: Fulfillment;
  address: Address | null;
  notes: string;
  items: PricedLine[];
  subtotal: number;
  shippingFee: number | null;
  total: number | null;
  deliveryQuote: DeliveryQuote;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  refundStatus: RefundStatus;
  demo: boolean;
  canPay: boolean;
};

export type AdminOrder = PublicOrder & {
  id: string;
  updatedAt: string;
  paidAt: string | null;
  needsReview: string | null;
  payments: { provider: string; id: string; status: string; statusDetail: string; amount: number; updatedAt: string }[];
  events: { at: string; type: string; detail: string; actor: string }[];
};

export type MenuResponse = {
  products: Product[];
  toppings: Topping[];
  business: BusinessInfo;
  delivery: Omit<DeliveryConfig, 'zones'> & { zoneNames: string[] };
  paymentsMode: 'demo' | 'mercadopago';
};

export type Quote = {
  lines: PricedLine[];
  subtotal: number;
  delivery: DeliveryQuote;
  shippingFee: number | null;
  total: number | null;
  errors: string[];
};
