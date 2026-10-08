import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderBody, start } from './helpers';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });

const pickup = (items: object[]) => orderBody({ fulfillment: 'pickup', address: null, items });
const create = (items: object[]) => t.api('POST', '/api/orders', pickup(items));

describe('menú en línea', () => {
  it('tiene exactamente los productos y precios definidos por Frésia', async () => {
    const { products } = (await t.api('GET', '/api/menu')).body;
    const table = Object.fromEntries(products.map((p: any) => [p.name, p.sizes.map((z: any) => z.price / 100)]));
    expect(table).toEqual({
      'Frésia Clásica': [100, 120, 140],
      Uvas: [100, 120, 140],
      'Mix Frésia': [100, 120, 140],
      'Frésia Balance': [110, 130, 150],
      'Frésia Choco Crema': [120, 140, 160],
      'Chocolate sin crema': [140],
      'Pan tradicional': [45],
      'Pan relleno Frésia': [100],
      'Waffle Frésia': [104],
      'Pausa Frésia': [640],
      'Dulce Tradición': [500],
      'Cumple con Frésia': [564],
    });
    expect(products.find((p: any) => p.id === 'chocolate-sin-crema').sizes[0].label).toBe('Chico 12 oz');
    expect(products.find((p: any) => /br[uû]l[eé]e/i.test(p.name))).toBeUndefined();
  });
});

describe('mínimos', () => {
  it('mínimo de 2 Frésias por pedido en total, sin mínimo por producto', async () => {
    const one = await create([{ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 1 }]);
    expect(one.status).toBe(422);
    expect(one.body.error).toMatch(/mínimo es de 2 Frésias. Te falta 1/);
    // 1 Clásica + 1 Chocolate: 2 productos distintos de 1 pieza cada uno
    const two = await create([
      { productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 1 },
      { productId: 'chocolate-sin-crema', sizeId: 'chico', toppingIds: [], qty: 1 },
    ]);
    expect(two.status).toBe(201);
    expect(two.body.order.items.map((l: any) => l.qty)).toEqual([1, 1]);
  });

  it('el pan y el waffle no cuentan como Frésias', async () => {
    const r = await create([{ productId: 'pan-tradicional', sizeId: 'pieza', toppingIds: [], qty: 3 }]);
    expect(r.status).toBe(422);
  });

  it('el Fresigrama no tiene mínimo: un regalo de 1 Frésia sí se acepta', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({
      paymentMethod: 'contra_entrega',
      items: [{ productId: 'clasica', sizeId: 'mediano', toppingIds: [], qty: 1 }],
      gift: { to: 'Ana · Piso 7', note: '', anonymous: true },
    }));
    expect(r.status).toBe(201);
    const q = await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items: [{ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 1 }] });
    expect(q.body.errors[0]).toMatch(/mínimo es de 2 Frésias/);
  });

  it('el panel puede cambiar el mínimo por producto o activar un mínimo de Frésias', async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    await t.api('PUT', '/api/admin/rules', { extraToppingPrice: 1800, minFresias: 0, minQtyPerItem: 1 });
    expect((await create([{ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 1 }])).status).toBe(201);
    await t.api('PUT', '/api/admin/rules', { extraToppingPrice: 1800, minFresias: 3, minQtyPerItem: 1 });
    const r = await create([{ productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 2 }]);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/mínimo es de 3 Frésias/);
  });
});

describe('toppings', () => {
  const unit = async (item: object) => {
    const r = await create([{ ...item, qty: 3 }, { productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 3 }]);
    expect(r.status).toBe(201);
    return r.body.order.items[0];
  };

  it('2 incluidos, adicionales a $18 y premium a $25 sin gastar incluidos', async () => {
    const l = await unit({ productId: 'clasica', sizeId: 'chico', toppingIds: ['nuez', 'pistache', 'coco', 'oreo'], qty: 1 });
    // $100 + pistache $25 + oreo adicional $18 (nuez y coco incluidos)
    expect(l.unitPrice).toBe(10000 + 2500 + 1800);
    expect(l.toppings.map((x: any) => [x.id, x.included, x.price])).toEqual([
      ['nuez', true, 0], ['pistache', false, 2500], ['coco', true, 0], ['oreo', false, 1800],
    ]);
  });

  it('el pan relleno incluye solo 1', async () => {
    expect((await unit({ productId: 'pan-relleno', sizeId: 'pieza', toppingIds: ['nuez', 'coco'], qty: 1 })).unitPrice).toBe(10000 + 1800);
  });

  it('en el Waffle el Turín y las mermeladas cuentan como incluidos', async () => {
    expect((await unit({ productId: 'waffle', sizeId: 'pieza', toppingIds: ['turin', 'mermelada-fresa'], qty: 1 })).unitPrice).toBe(10400);
    expect((await unit({ productId: 'waffle', sizeId: 'pieza', toppingIds: ['turin', 'mermelada-fresa', 'lotus'], qty: 1 })).unitPrice).toBe(10400 + 2500);
  });

  it('el pan tradicional no lleva toppings', async () => {
    const r = await create([{ productId: 'pan-tradicional', sizeId: 'pieza', toppingIds: ['nuez'], qty: 3 }, { productId: 'clasica', sizeId: 'chico', toppingIds: [], qty: 3 }]);
    expect(r.status).toBe(422);
  });
});

describe('combos', () => {
  const combo = {
    id: 'combo-prueba', name: 'Combo prueba', description: '', image: '', section: 'Combos',
    sizes: [{ id: 'combo', label: 'Combo', price: 30000 }], toppingIds: [], includedToppings: 0, freePremiumIds: [], maxToppings: null, fresiaUnits: 0,
    combo: [
      { id: 'vasos', label: 'Frésias chicas', qty: 3, options: [{ productId: 'clasica', sizeId: 'chico' }, { productId: 'balance', sizeId: 'chico' }] },
      { id: 'pan', label: 'Pan de muerto', qty: 1, options: [{ productId: 'pan-tradicional', sizeId: 'pieza' }] },
    ],
    available: true, sort: 1, example: false,
  };
  beforeEach(async () => {
    await t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
    expect((await t.api('PUT', '/api/admin/products/combo-prueba', combo)).status).toBe(200);
  });
  const choices = (extra: object[] = []) => [
    { slotId: 'vasos', productId: 'clasica', sizeId: 'chico', toppingIds: ['nuez', 'coco', 'oreo'] },
    { slotId: 'vasos', productId: 'balance', sizeId: 'chico', toppingIds: ['pistache'] },
    { slotId: 'vasos', productId: 'clasica', sizeId: 'chico', toppingIds: [] },
    { slotId: 'pan', productId: 'pan-tradicional', sizeId: 'pieza', toppingIds: [] },
    ...extra,
  ];

  it('precio del combo + toppings extra, y sus Frésias cuentan para el mínimo', async () => {
    const r = await create([{ productId: 'combo-prueba', sizeId: 'combo', toppingIds: [], choices: choices(), qty: 1, forWhom: 'Ventas' }]);
    expect(r.status).toBe(201);
    const l = r.body.order.items[0];
    expect(l.unitPrice).toBe(30000 + 1800 + 2500);
    expect(l.fresias).toBe(3);
    expect(l.choices).toHaveLength(4);
  });

  it('rechaza combos incompletos u opciones no permitidas', async () => {
    const incompleto = choices().slice(1);
    expect((await create([{ productId: 'combo-prueba', sizeId: 'combo', toppingIds: [], choices: incompleto, qty: 1 }])).status).toBe(422);
    const ajeno = choices().map((c, i) => (i === 0 ? { ...c, productId: 'clasica', sizeId: 'grande' } : c));
    expect((await create([{ productId: 'combo-prueba', sizeId: 'combo', toppingIds: [], choices: ajeno, qty: 1 }])).status).toBe(422);
    const sobra = choices([{ slotId: 'pan', productId: 'pan-tradicional', sizeId: 'pieza', toppingIds: [] }]);
    expect((await create([{ productId: 'combo-prueba', sizeId: 'combo', toppingIds: [], choices: sobra, qty: 1 }])).status).toBe(422);
  });
});

describe('combos del menú', () => {
  const pick = (slotId: string, productId: string, sizeId: string, n: number, toppingIds: string[] = []) =>
    Array.from({ length: n }, () => ({ slotId, productId, sizeId, toppingIds }));
  const order = (productId: string, choices: object[], extra: object[] = []) =>
    create([{ productId, sizeId: 'combo', toppingIds: [], choices, qty: 1 }, ...extra]);

  it('un combo se pide desde 1 (el mínimo por producto no aplica)', async () => {
    const r = await order('pausa-fresia', [...pick('clasicas', 'clasica', 'mediano', 3), ...pick('chocolates', 'chocolate-sin-crema', 'chico', 2)]);
    expect(r.status).toBe(201);
  });

  it('Pausa Frésia: $640 y cuenta 5 Frésias', async () => {
    const r = await order('pausa-fresia', [...pick('clasicas', 'clasica', 'mediano', 3, ['nuez', 'coco']), ...pick('chocolates', 'chocolate-sin-crema', 'chico', 2)]);
    expect(r.status).toBe(201);
    expect(r.body.order.items[0]).toMatchObject({ unitPrice: 64000, fresias: 5 });
  });

  it('los toppings extra dentro del combo se cobran aparte', async () => {
    const r = await order('pausa-fresia', [
      ...pick('clasicas', 'clasica', 'mediano', 2), { slotId: 'clasicas', productId: 'clasica', sizeId: 'mediano', toppingIds: ['nuez', 'coco', 'oreo', 'lotus'] },
      ...pick('chocolates', 'chocolate-sin-crema', 'chico', 2),
    ]);
    expect(r.body.order.items[0].unitPrice).toBe(64000 + 1800 + 2500);
  });

  it('Cumple con Frésia: $564, se pide solo', async () => {
    const choices = [
      ...pick('clasica', 'clasica', 'mediano', 1), ...pick('chocolate', 'chocolate-sin-crema', 'chico', 1),
      ...pick('panes', 'pan-relleno', 'pieza', 2), ...pick('waffle', 'waffle', 'pieza', 1),
    ];
    const r = await order('cumple-con-fresia', choices);
    expect(r.status).toBe(201);
    expect(r.body.order.items[0]).toMatchObject({ unitPrice: 56400 });
  });

  it('Dulce Tradición: $500, se pide solo', async () => {
    const r = await order('dulce-tradicion', pick('panes', 'pan-relleno', 'pieza', 5));
    expect(r.status).toBe(201);
    expect(r.body.order.items[0]).toMatchObject({ unitPrice: 50000 });
  });

  it('no se puede cambiar el sabor ni el tamaño de un combo fijo', async () => {
    const r = await order('pausa-fresia', [...pick('clasicas', 'clasica', 'grande', 3), ...pick('chocolates', 'chocolate-sin-crema', 'chico', 2)]);
    expect(r.status).toBe(422);
  });
});

describe('datos del negocio', () => {
  it('horario y WhatsApp para confirmar pedidos', async () => {
    const { business } = (await t.api('GET', '/api/menu')).body;
    expect(business.whatsapp).toBe('525582330124');
    expect(business.hours).toContain('Domingo: cerrado');
  });
});
