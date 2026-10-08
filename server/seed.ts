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

// Mínimo del pedido: 2 Frésias en total (combos cuentan sus Frésias; pan y waffle no). Sin mínimo por producto.
// No aplica a pedidos de equipo ni a Fresigramas.
export const DEFAULT_RULES: MenuRules = { extraToppingPrice: MXN(18), minFresias: 2, minQtyPerItem: 1 };

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
  // Tarifa de arranque decidida por Frésia (oct 2026): $15, gratis desde $400. Revisar tras 2–4 semanas.
  radiusFee: 1500,
  freeShippingFrom: 40000,
  // Tiempos: sin capturar hasta que Frésia los mida (no se muestra ningún tiempo inventado).
  prepMin: null,
  prepMax: null,
  handoffMin: 0,
  courierMode: 'walk',
  deliveryEnabled: true,
  pickupEnabled: true,
  outOfZone: 'reject',
  onlinePayment: true,
  cashOnDelivery: true,
  // Detalle opcional (p. ej. «Efectivo o tarjeta»); por definir con Frésia.
  cashOnDeliveryNote: '',
  example: false,
  zones: [
    { id: 'z-ejemplo-1', name: 'Zona de ejemplo A', postalCodes: ['03103'], colonias: [], fee: 3000, etaMin: 0, etaMax: 0, mode: 'auto', active: true },
    { id: 'z-ejemplo-2', name: 'Zona de ejemplo B', postalCodes: ['03100', '03104'], colonias: [], fee: 0, etaMin: 0, etaMax: 0, mode: 'manual', active: true },
  ],
};

const PENDING = '[Pendiente de completar por Frésia]';

export const LEGAL_DRAFTS: Record<LegalSlug, LegalDoc> = {
  privacidad: {
    slug: 'privacidad',
    title: 'Aviso de privacidad',
    approved: false,
    body: `Responsable: Tania Anahí Tello García (RFC TEGT900130SW9), quien opera Frésia, con domicilio para oír y recibir notificaciones en Av. Insurgentes Sur 612, local C, esq. Valle de Arizpe, col. Del Valle Norte, C.P. 03103, alcaldía Benito Juárez, Ciudad de México. Contacto: fresia12026@gmail.com.

Datos que recabamos: nombre, teléfono, dirección de entrega (incluida la ubicación del mapa si decides compartirla), los nombres opcionales que escribas en "¿Para quién es?", si mandas un regalo (Fresigrama) el nombre de quien lo recibe y el mensaje de la tarjeta, y, solo si pides factura, tus datos fiscales (RFC, nombre o razón social, régimen fiscal, código postal fiscal, uso del CFDI y correo). No recabamos datos sensibles.

Finalidades necesarias: preparar y entregar tu pedido, cobrarlo, contactarte sobre él, mostrarte su estado y la foto de entrega, emitir tu factura si la pides y sumar sellos a tu tarjeta de Frésia Club si tienes una registrada con el mismo teléfono. No usamos tus datos para publicidad.

Pagos: los procesa Mercado Pago. Frésia no recibe ni guarda datos de tarjetas.

Transferencias: no vendemos ni compartimos tus datos, salvo con Mercado Pago (para cobrar tu pedido) y con el SAT al emitir tu factura (solo si la pides), y cuando lo exija una autoridad.

En tu navegador: guardamos tu carrito y tus pedidos recientes en tu propio dispositivo para que no los pierdas. No usamos cookies de publicidad ni de rastreo.

Conservación: las fotos de entrega se borran automáticamente a los 30 días. Para los demás datos: ${PENDING}.

Derechos ARCO y revocación del consentimiento: para acceder, rectificar, cancelar u oponerte al uso de tus datos, o revocar tu consentimiento, escribe a fresia12026@gmail.com con tu nombre, teléfono y lo que solicitas. Te responderemos en un máximo de 20 días hábiles.

Cambios a este aviso: los publicaremos en esta misma página.`,
  },
  entregas: {
    slug: 'entregas',
    title: 'Política de entregas',
    approved: false,
    body: `Cobertura: entregamos a oficinas cercanas a Frésia (Av. Insurgentes Sur 612, local C, Del Valle Norte). Antes de pagar te mostramos si tu dirección está dentro de la zona, el costo de envío y el tiempo estimado.

Fuera de zona: si no podemos confirmar tu dirección automáticamente, te confirmamos el costo antes de cobrar.

Horario: lunes a jueves de 12:00 a 20:30, viernes y sábado de 12:00 a 20:00; domingo cerrado. Puedes programar tu pedido para más tarde o para otro día.

Tiempos estimados: se calculan para tu dirección (preparación, distancia desde Frésia y subida a tu oficina) y se muestran antes de pagar. Son aproximados.

Seguimiento: cuando tu pedido sale, puedes ver al repartidor en el mapa desde la página de tu pedido. Al entregarlo tomamos una foto como comprobante, que solo ve quien tiene el enlace del pedido.

Pago contra entrega: solo en efectivo; indícanos con cuánto pagas para llevar cambio.

Recepción en oficinas: ${PENDING} (p. ej. quién recibe en recepción, tiempo de espera del repartidor).`,
  },
  cancelaciones: {
    slug: 'cancelaciones',
    title: 'Cancelaciones y reembolsos',
    approved: false,
    body: `Antes de la preparación: puedes cancelar desde la página de tu pedido mientras no hayamos empezado a prepararlo. Si pagaste en línea, te devolvemos el pago.

Después de iniciar la preparación: ya no se puede cancelar, porque cada pedido se prepara al momento.

Reembolsos: se hacen al mismo medio de pago a través de Mercado Pago. Plazo: ${PENDING}.

Cancelar un pedido no significa que el reembolso ya se realizó; te avisaremos cuando se complete.`,
  },
};
