import type { Schedule } from './schedule';
import type { InvoiceData } from './invoice';

// Modelo compartido entre navegador y servidor.
// Todos los importes van en centavos (enteros) para evitar errores de redondeo.

export type Size = { id: string; label: string; price: number };

export type Product = {
  id: string;
  name: string;
  description: string;
  image: string;
  /** Sección del menú (p. ej. "Frésias", "Pan de muerto"). */
  section: string;
  sizes: Size[];
  toppingIds: string[];
  /** Toppings normales incluidos en el precio; los demás se cobran a rules.extraToppingPrice. */
  includedToppings: number;
  /** Toppings premium que en este producto cuentan como normales (p. ej. Turín en el Waffle). */
  freePremiumIds: string[];
  maxToppings: number | null;
  /** Cuántas Frésias aporta cada pieza al pedido mínimo (vasos 1; pan, waffle, bebidas 0). */
  fresiaUnits: number;
  /** Solo para combos: qué incluye. */
  combo: ComboSlot[] | null;
  available: boolean;
  sort: number;
  /** Contenido de ejemplo (no aprobado por el negocio). */
  example: boolean;
};

/** Un hueco del combo: el cliente elige `qty` productos entre las opciones. */
export type ComboSlot = {
  id: string;
  label: string;
  qty: number;
  options: { productId: string; sizeId: string }[];
};

export type Topping = {
  id: string;
  name: string;
  /** Solo para premium: su precio fijo. Los normales usan rules.extraToppingPrice cuando no van incluidos. */
  price: number;
  premium: boolean;
  available: boolean;
  sort: number;
  example: boolean;
};

export type MenuRules = {
  /** Precio de cada topping normal después de los incluidos (centavos). */
  extraToppingPrice: number;
  /** Mínimo de Frésias por pedido en línea. */
  minFresias: number;
  /** Piezas mínimas por producto suelto (los combos se piden desde 1). */
  minQtyPerItem: number;
};

export type ComboChoiceInput = { slotId: string; productId: string; sizeId: string; toppingIds: string[] };

export type CartLineInput = {
  productId: string;
  sizeId: string;
  toppingIds: string[];
  /** Solo combos: una elección por cada pieza de cada hueco. */
  choices?: ComboChoiceInput[];
  qty: number;
  forWhom?: string;
};

export type PricedTopping = { id: string; name: string; price: number; included: boolean; premium: boolean };

export type PricedChoice = {
  slotId: string;
  slotLabel: string;
  productId: string;
  sizeId: string;
  name: string;
  sizeLabel: string;
  toppings: PricedTopping[];
  extras: number;
};

export type PricedLine = {
  productId: string;
  name: string;
  sizeId: string;
  sizeLabel: string;
  basePrice: number;
  toppings: PricedTopping[];
  choices?: PricedChoice[];
  unitPrice: number;
  qty: number;
  lineTotal: number;
  fresias: number;
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

export type LatLng = { lat: number; lng: number };

export type DeliveryConfig = {
  /** radius: distancia desde Frésia con la ubicación del cliente · zones: por código postal. */
  mode: 'radius' | 'zones';
  /** Ubicación de Frésia. */
  origin: LatLng | null;
  radiusM: number;
  radiusFee: number;
  /** Envío gratis cuando el subtotal llega a este monto (centavos). null = nunca. */
  freeShippingFrom: number | null;
  /** Minutos de preparación (desde–hasta). null = sin capturar: no se muestra ningún tiempo. */
  prepMin: number | null;
  prepMax: number | null;
  /** Minutos para subir a la oficina (recepción, elevador). */
  handoffMin: number;
  /** Cómo va el repartidor normalmente; define la velocidad del trayecto. */
  courierMode: CourierMode;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  outOfZone: 'reject' | 'manual';
  zones: Zone[];
  /** Métodos de pago disponibles para el cliente. */
  onlinePayment: boolean;
  cashOnDelivery: boolean;
  /** Texto que ve el cliente, p. ej. "Efectivo o tarjeta al recibir". */
  cashOnDeliveryNote: string;
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
  /** Ubicación del dispositivo del cliente en el lugar de entrega (GPS). */
  location?: CustomerLocation | null;
};

export type CustomerLocation = LatLng & { accuracyM: number };

export type CourierMode = 'walk' | 'bike' | 'moto';

/** Fresigrama: el pedido es un regalo para alguien de la oficina. */
export type GiftInfo = {
  /** Para quién y dónde encontrarle, p. ej. «Ana · Piso 7, área de diseño». */
  to: string;
  /** Mensaje de la tarjeta (opcional). */
  note: string;
  /** No decir quién lo manda. */
  anonymous: boolean;
};

/** Días que se guarda la foto de entrega (después se borra). */
export const PHOTO_RETENTION_DAYS = 30;

/** Seguimiento en vivo para el cliente (solo mientras va en camino). */
export type TrackingInfo = {
  active: boolean;
  courier: (LatLng & { accuracyM: number; updatedAt: string; mode: CourierMode }) | null;
  /** Recorrido del repartidor desde que salió, como [lat, lng]. */
  trail: [number, number][];
  destination: LatLng | null;
  store: LatLng | null;
};

export type Fulfillment = 'delivery' | 'pickup';

export type DeliveryQuote =
  | { status: 'pickup' }
  | { status: 'covered'; zoneId: string; zoneName: string; fee: number; etaMin: number | null; etaMax: number | null; distanceM?: number }
  | { status: 'manual'; reason: string; zoneName?: string; distanceM?: number; needsLocation?: boolean }
  | { status: 'not_covered'; distanceM?: number }
  | { status: 'quoted'; fee: number; etaText: string };

export type PaymentStatus = 'sin_pagar' | 'por_cobrar' | 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado' | 'devuelto';

/** online: Mercado Pago · contra_entrega: paga al recibir o al recoger. */
export type PaymentMethod = 'online' | 'contra_entrega';

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
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** Efectivo al recibir: billete con el que paga (centavos); null = exacto o no indicó. */
  cashTendered: number | null;
  /** Cuándo se subió la foto de entrega (comprobante); null si no hay. */
  deliveryPhotoAt: string | null;
  /** Hora para la que se programó (null = lo antes posible). */
  scheduledFor: string | null;
  invoice: InvoiceData | null;
  gift: GiftInfo | null;
  invoiceStatus: 'no_aplica' | 'solicitada' | 'emitida';
  /** Pedido de equipo del que salió, si aplica. */
  groupName: string | null;
  orderStatus: OrderStatus;
  refundStatus: RefundStatus;
  demo: boolean;
  canPay: boolean;
};

export type AdminOrder = PublicOrder & {
  id: string;
  /** QR / edificio que trajo al cliente. */
  source: string | null;
  updatedAt: string;
  paidAt: string | null;
  needsReview: string | null;
  payments: { provider: string; id: string; status: string; statusDetail: string; amount: number; updatedAt: string }[];
  events: { at: string; type: string; detail: string; actor: string }[];
};

export type MenuResponse = {
  products: Product[];
  toppings: Topping[];
  rules: MenuRules;
  schedule: Schedule;
  business: BusinessInfo;
  delivery: Omit<DeliveryConfig, 'zones'> & { zoneNames: string[] };
  paymentsMode: 'demo' | 'mercadopago';
};

export type Quote = {
  lines: PricedLine[];
  subtotal: number;
  fresias: number;
  delivery: DeliveryQuote;
  shippingFee: number | null;
  total: number | null;
  errors: string[];
};

/** Tarjeta de Frésia Club del teléfono de un pedido. */
export type ClubCard =
  | { found: true; name: string; visits: number; goal: number; rewardsPending: number; cardUrl: string; stamped?: boolean; alreadyStamped?: boolean }
  | { found: false; joinUrl: string };
