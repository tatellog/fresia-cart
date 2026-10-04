import type { BusinessInfo, DeliveryConfig, LegalDoc, LegalSlug, MenuRules, Product, Topping } from '../shared/types';

// Menú en línea para oficinas (precios definidos por Frésia, oct 2026). Las reglas
// de toppings son las de Frésia OS. La Frèsia Brûlée NO se incluye: solo se vende
// en el local. Los combos se dan de alta en el panel.

const MXN = (pesos: number) => pesos * 100;
const SIZES = {
  chico: { id: 'chico', label: 'Chico 12 oz' },
  mediano: { id: 'mediano', label: 'Mediano 16 oz' },
  grande: { id: 'grande', label: 'Grande 20 oz' },
};
const tres = (chico: number, mediano: number, grande: number) => [
  { ...SIZES.chico, price: MXN(chico) },
  { ...SIZES.mediano, price: MXN(mediano) },
  { ...SIZES.grande, price: MXN(grande) },
];

const REGULAR = ['granola', 'nuez', 'coco', 'almendra', 'arandano', 'cajeta', 'mazapan', 'oreo'];
const PREMIUM = ['fresa', 'turin', 'pistache', 'lotus', 'mermelada-fresa', 'mermelada-zarzamora'];
const ALL = [...REGULAR, ...PREMIUM];

const vaso = (id: string, name: string, description: string, image: string, sizes: Product['sizes'], sort: number, extra: Partial<Product> = {}): Product => ({
  id, name, description, image, section: 'Frésias', sizes, toppingIds: ALL, includedToppings: 2, freePremiumIds: [], maxToppings: null,
  fresiaUnits: 1, combo: null, available: true, sort, example: false, ...extra,
});
const pieza = (id: string, name: string, description: string, image: string, section: string, price: number, sort: number, extra: Partial<Product> = {}): Product => ({
  id, name, description, image, section, sizes: [{ id: 'pieza', label: 'Pieza', price: MXN(price) }], toppingIds: [], includedToppings: 0,
  freePremiumIds: [], maxToppings: null, fresiaUnits: 0, combo: null, available: true, sort, example: false, ...extra,
});

const slot = (id: string, label: string, qty: number, productId: string, sizeId: string) => ({ id, label, qty, options: [{ productId, sizeId }] });
const combo = (id: string, name: string, description: string, image: string, price: number, sort: number, slots: NonNullable<Product['combo']>): Product => ({
  id, name, description, image, section: 'Combos', sizes: [{ id: 'combo', label: 'Combo', price: MXN(price) }], toppingIds: [], includedToppings: 0,
  freePremiumIds: [], maxToppings: null, fresiaUnits: 0, combo: slots, available: true, sort, example: false,
});

export const DEMO_PRODUCTS: Product[] = [
  vaso('clasica', 'Frésia Clásica', 'Fresas frescas con crema Frèsia.', '/images/clasica.jpg', tres(100, 120, 140), 10),
  vaso('uvas', 'Uvas', 'Uva verde con crema Frèsia.', '/images/uvas.jpg', tres(100, 120, 140), 20),
  vaso('mix', 'Mix Frésia', 'Fresas y uva verde con crema Frèsia.', '/images/mix.jpg', tres(100, 120, 140), 30),
  vaso('balance', 'Frésia Balance', 'Fresas con yogurt griego.', '/images/balance.jpg', tres(110, 130, 150), 40),
  vaso('choco-crema', 'Frésia Choco Crema', 'Fresas, crema Frèsia y chocolate Turín.', '/images/chocolate-mediano.jpg', tres(120, 140, 160), 50),
  vaso('chocolate-sin-crema', 'Chocolate sin crema', 'Fresas con chocolate, sin crema. Solo tamaño chico.', '/images/chocolate-turin.jpg',
    [{ ...SIZES.chico, price: MXN(140) }], 60),
  pieza('waffle', 'Waffle Frésia', 'Waffle con crema Frèsia y 2 toppings incluidos; el Turín y las mermeladas entran como incluidos.', '/images/waffle.jpg', 'Waffle', 104, 80,
    { toppingIds: ALL, includedToppings: 2, freePremiumIds: ['turin', 'mermelada-fresa', 'mermelada-zarzamora'] }),
  pieza('pan-tradicional', 'Pan tradicional', 'Pan de muerto de temporada.', '/images/pan-tradicional.jpg', 'Pan de muerto', 45, 90),
  pieza('pan-relleno', 'Pan relleno Frésia', 'Pan de muerto relleno de fresas frescas y crema Frèsia. Incluye 1 topping.', '/images/pan-relleno.jpg', 'Pan de muerto', 100, 91,
    { toppingIds: ALL, includedToppings: 1 }),

  // ── Combos: 5 productos a precio fijo; cada pieza lleva sus toppings incluidos y los extras se cobran aparte ──
  combo('pausa-fresia', 'Pausa Frésia', '3 Frésias Clásicas medianas + 2 Chocolate sin crema chicos.', '/images/combo-pausa.jpg', 640, 1, [
    slot('clasicas', 'Frésia Clásica mediana', 3, 'clasica', 'mediano'),
    slot('chocolates', 'Chocolate sin crema chico', 2, 'chocolate-sin-crema', 'chico'),
  ]),
  combo('dulce-tradicion', 'Dulce Tradición', '5 panes de muerto rellenos Frésia.', '/images/combo-dulce-tradicion.jpg', 500, 2, [
    slot('panes', 'Pan relleno Frésia', 5, 'pan-relleno', 'pieza'),
  ]),
  combo('cumple-con-fresia', 'Cumple con Frésia', '1 Frésia Clásica mediana + 1 Chocolate sin crema chico + 2 panes rellenos Frésia + 1 Waffle Frésia.', '/images/combo-cumple.jpg', 564, 3, [
    slot('clasica', 'Frésia Clásica mediana', 1, 'clasica', 'mediano'),
    slot('chocolate', 'Chocolate sin crema chico', 1, 'chocolate-sin-crema', 'chico'),
    slot('panes', 'Pan relleno Frésia', 2, 'pan-relleno', 'pieza'),
    slot('waffle', 'Waffle Frésia', 1, 'waffle', 'pieza'),
  ]),
];

const top = (id: string, name: string, sort: number, premium = false): Topping => ({
  id, name, price: premium ? MXN(25) : 0, premium, available: true, sort, example: false,
});
export const DEMO_TOPPINGS: Topping[] = [
  top('granola', 'Granola artesanal', 1),
  top('nuez', 'Nuez picada', 2),
  top('coco', 'Coco rallado', 3),
  top('almendra', 'Almendra fileteada', 4),
  top('arandano', 'Arándano', 5),
  top('cajeta', 'Cajeta', 6),
  top('mazapan', 'Mazapán', 7),
  top('oreo', 'Oreo triturada', 8),
  top('fresa', 'Fresas extra', 20, true),
  top('turin', 'Chocolate Turín', 21, true),
  top('pistache', 'Pistache', 22, true),
  top('lotus', 'Lotus', 23, true),
  top('mermelada-fresa', 'Mermelada de fresa', 24, true),
  top('mermelada-zarzamora', 'Mermelada de zarzamora', 25, true),
];

// Mínimo 3 piezas por producto suelto (los combos desde 1); sin mínimo de Frésias por pedido.
export const DEFAULT_RULES: MenuRules = { extraToppingPrice: MXN(18), minFresias: 0, minQtyPerItem: 3 };

export const DEMO_BUSINESS: BusinessInfo = {
  name: 'Frésia',
  address: 'Av. Insurgentes Sur 612, local C, esq. Valle de Arizpe, Del Valle Norte, 03103, CDMX',
  mapsUrl: 'https://maps.app.goo.gl/L2mca4dBRjvwPf8R8',
  hours: 'Lunes a jueves: 12:00 – 20:30\nViernes y sábado: 12:00 – 20:00\nDomingo: cerrado',
  // Número temporal para confirmar pedidos por WhatsApp (cambiará).
  whatsapp: '525582330124',
  email: '',
  example: false,
};

// Frésia: Av. Insurgentes Sur 612, local C, esq. Valle de Arizpe, Del Valle Norte, 03103.
// Coordenadas del cruce según OpenStreetMap; ajústalas en el panel con el punto exacto de Google Maps.
export const FRESIA_LOCATION = { lat: 19.39725, lng: -99.1712 };

export const DEMO_DELIVERY: DeliveryConfig = {
  mode: 'radius',
  origin: FRESIA_LOCATION,
  radiusM: 300,
  // Tarifa y tiempos de ejemplo: el negocio debe confirmarlos.
  radiusFee: 3000,
  radiusEtaMin: 15,
  radiusEtaMax: 25,
  deliveryEnabled: true,
  pickupEnabled: true,
  pickupPrepText: '15–20 min (ejemplo)',
  outOfZone: 'reject',
  onlinePayment: true,
  cashOnDelivery: true,
  // Detalle opcional (p. ej. «Efectivo o tarjeta»); por definir con Frésia.
  cashOnDeliveryNote: '',
  example: true,
  zones: [
    { id: 'z-ejemplo-1', name: 'Zona de ejemplo A', postalCodes: ['03103'], colonias: [], fee: 3000, etaMin: 25, etaMax: 40, mode: 'auto', active: true },
    { id: 'z-ejemplo-2', name: 'Zona de ejemplo B', postalCodes: ['03100', '03104'], colonias: [], fee: 0, etaMin: 0, etaMax: 0, mode: 'manual', active: true },
  ],
};

const PENDING = '[Pendiente de completar por Frésia]';

export const LEGAL_DRAFTS: Record<LegalSlug, LegalDoc> = {
  privacidad: {
    slug: 'privacidad',
    title: 'Aviso de privacidad',
    approved: false,
    body: `Responsable: ${PENDING} (razón social, domicilio y contacto).

Datos que recabamos: nombre, teléfono, dirección de entrega y los nombres opcionales que escribas en "¿Para quién es?".

Finalidad: preparar y entregar tu pedido, y contactarte sobre él. No usamos tus datos para publicidad sin tu consentimiento.

Pagos: los realiza Mercado Pago. Frésia no recibe ni guarda datos de tarjetas.

Conservación: ${PENDING}.

Derechos ARCO: para acceder, rectificar, cancelar u oponerte al uso de tus datos, escribe a ${PENDING}.`,
  },
  entregas: {
    slug: 'entregas',
    title: 'Política de entregas',
    approved: false,
    body: `Zonas de cobertura y tarifas: se muestran antes de pagar, según tu código postal.

Direcciones fuera de zona: confirmamos el costo por WhatsApp antes de cobrar.

Tiempos estimados: ${PENDING}.

Recepción en oficinas: ${PENDING} (p. ej. quién recibe en recepción, tiempo de espera del repartidor).`,
  },
  cancelaciones: {
    slug: 'cancelaciones',
    title: 'Cancelaciones y reembolsos',
    approved: false,
    body: `Antes de la preparación: ${PENDING}.

Después de iniciar la preparación: ${PENDING}.

Reembolsos: se hacen al mismo medio de pago a través de Mercado Pago. Plazo: ${PENDING}.

Cancelar un pedido no significa que el reembolso ya se realizó; te avisaremos cuando se complete.`,
  },
};
