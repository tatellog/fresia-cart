import type { BusinessInfo, DeliveryConfig, LegalDoc, LegalSlug, Product, Topping } from '../shared/types';

// ⚠️ CONTENIDO DE EJEMPLO. Nombres, precios, toppings, zonas y tiempos son
// marcadores para la demostración; el negocio debe reemplazarlos desde el panel.
// Las fotos sí son de Frésia (tomadas del sistema de punto de venta).

const sizes = (base: number) => [
  { id: 'chica', label: 'Chica', price: base },
  { id: 'mediana', label: 'Mediana', price: base + 2000 },
  { id: 'grande', label: 'Grande', price: base + 4000 },
];
const all = ['nuez', 'granola', 'coco', 'chocolate', 'oreo', 'lotus', 'cajeta', 'mazapan'];

export const DEMO_PRODUCTS: Product[] = [
  { id: 'clasica', name: 'Clásica', description: 'Fresas frescas con crema.', image: '/images/clasica.jpg', sizes: sizes(6000), toppingIds: all, maxToppings: 4, available: true, sort: 10, example: true },
  { id: 'balance', name: 'Balance', description: 'Fresas con crema en versión ligera.', image: '/images/balance.jpg', sizes: sizes(6500), toppingIds: all, maxToppings: 4, available: true, sort: 20, example: true },
  { id: 'chocolate', name: 'Chocolate', description: 'Fresas con crema y chocolate.', image: '/images/chocolate-mediano.jpg', sizes: sizes(7500), toppingIds: all, maxToppings: 4, available: true, sort: 30, example: true },
  { id: 'brulee', name: 'Brûlée', description: 'Fresas con crema y cubierta caramelizada.', image: '/images/brulee.jpg', sizes: sizes(8000).slice(1), toppingIds: ['nuez', 'granola'], maxToppings: 2, available: true, sort: 40, example: true },
  { id: 'mix', name: 'Mix de fruta', description: 'Fresas y uvas con crema.', image: '/images/mix.jpg', sizes: sizes(7000), toppingIds: all, maxToppings: 4, available: true, sort: 50, example: true },
  { id: 'granada', name: 'Granada', description: 'Fresas con crema y granada.', image: '/images/granada.jpg', sizes: sizes(7500), toppingIds: all, maxToppings: 4, available: false, sort: 60, example: true },
  { id: 'waffle', name: 'Waffle Frésia', description: 'Waffle con fresas y crema.', image: '/images/waffle.jpg', sizes: [{ id: 'unico', label: 'Pieza', price: 9500 }], toppingIds: ['nuez', 'chocolate', 'cajeta'], maxToppings: 3, available: true, sort: 70, example: true },
];

const top = (id: string, name: string, price: number, sort: number): Topping => ({ id, name, price, available: true, sort, example: true });
export const DEMO_TOPPINGS: Topping[] = [
  top('nuez', 'Nuez', 1500, 1),
  top('granola', 'Granola', 1000, 2),
  top('coco', 'Coco', 1000, 3),
  top('chocolate', 'Chocolate', 1500, 4),
  top('oreo', 'Oreo', 1500, 5),
  top('lotus', 'Lotus', 2000, 6),
  top('cajeta', 'Cajeta', 1500, 7),
  top('mazapan', 'Mazapán', 1000, 8),
];

export const DEMO_BUSINESS: BusinessInfo = {
  name: 'Frésia',
  address: 'Del Valle Norte, CDMX · dirección exacta pendiente',
  mapsUrl: '',
  hours: '',
  whatsapp: '',
  email: '',
  example: true,
};

export const DEMO_DELIVERY: DeliveryConfig = {
  deliveryEnabled: true,
  pickupEnabled: true,
  pickupPrepText: '15–20 min (ejemplo)',
  outOfZone: 'manual',
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
