import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, orderBody, start } from './helpers';
import { DEFAULT_SCHEDULE, availableSlots, isOpenAt, scheduleText, slotLabel } from '../shared/schedule';
import { invoiceErrors } from '../shared/invoice';

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); });
const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const pickup = (over: object = {}) => orderBody({ fulfillment: 'pickup', address: null, paymentMethod: 'contra_entrega', ...over });

describe('horario y pedidos programados (hora de CDMX)', () => {
  it('abierto miércoles 2 p.m.; cerrado domingo y a las 8:20 p.m.', () => {
    expect(isOpenAt(new Date(NOW), DEFAULT_SCHEDULE)).toBe(true);
    expect(isOpenAt(new Date('2026-10-11T20:00:00Z'), DEFAULT_SCHEDULE)).toBe(false); // domingo
    expect(isOpenAt(new Date('2026-10-08T02:20:00Z'), DEFAULT_SCHEDULE)).toBe(false); // mié 8:20 p.m. (15 min antes de cerrar)
  });

  it('horarios disponibles: 45 min de anticipación, cada 30 min, sin domingos', () => {
    const days = availableSlots(new Date(NOW), DEFAULT_SCHEDULE);
    expect(days[0].label).toBe('Hoy');
    expect(days[0].slots[0].label).toBe('3:00 p.m.');
    expect(days[0].slots.at(-1)!.label).toBe('8:30 p.m.');
    expect(days.map((d) => d.label)).not.toContain('Dom 11 oct');
    expect(slotLabel(days[1].slots[0].iso, new Date(NOW))).toBe('Mañana · 12:30 p.m.');
  });

  it('texto del horario', () => {
    expect(scheduleText(DEFAULT_SCHEDULE)).toBe('Lunes a jueves: 12:00 p.m. – 8:30 p.m.\nViernes a sábado: 12:00 p.m. – 8:00 p.m.\nDomingo: cerrado');
  });

  it('cerrado: «lo antes posible» no se acepta y pide programar; programado sí', async () => {
    t = await start({ now: '2026-10-11T20:00:00.000Z' }); // domingo
    const r = await t.api('POST', '/api/orders', pickup());
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('closed');
    expect(r.body.error).toMatch(/abrimos mañana a las 12:00 p\.m\./);
    const slot = availableSlots(new Date('2026-10-11T20:00:00Z'), DEFAULT_SCHEDULE)[0].slots[2].iso;
    const ok = await t.api('POST', '/api/orders', pickup({ scheduledFor: slot }));
    expect(ok.status).toBe(201);
    expect(ok.body.order.scheduledFor).toBe(slot);
  });

  it('rechaza horarios fuera de lo permitido', async () => {
    t = await start();
    expect((await t.api('POST', '/api/orders', pickup({ scheduledFor: '2026-10-08T04:00:00.000Z' }))).status).toBe(422); // 10 p.m.
    expect((await t.api('POST', '/api/orders', pickup({ scheduledFor: '2026-10-07T20:30:00.000Z' }))).status).toBe(422); // en 30 min (< 45)
  });

  it('el panel cambia el horario y se actualiza el texto que ve el cliente', async () => {
    t = await start();
    await login();
    const s = (await t.api('GET', '/api/admin/schedule')).body;
    s.days[0] = { open: '11:00', close: '15:00' };
    expect((await t.api('PUT', '/api/admin/schedule', s)).status).toBe(200);
    const menu = (await t.api('GET', '/api/menu')).body;
    expect(menu.business.hours).toContain('Domingo: 11:00 a.m. – 3:00 p.m.');
    expect(menu.schedule.days[0]).toEqual({ open: '11:00', close: '15:00' });
  });
});

describe('factura', () => {
  const invoice = { rfc: 'abc-010101-ab1', name: 'Empresa Ejemplo SA de CV', regime: '601', zip: '03100', use: 'G03', email: 'Pagos@Empresa.mx' };
  beforeEach(async () => { t = await start(); });

  it('valida RFC, régimen según tipo de persona y correo', () => {
    expect(invoiceErrors(invoice)).toEqual({});
    expect(invoiceErrors({ ...invoice, rfc: 'XXX' }).rfc).toBeTruthy();
    expect(invoiceErrors({ ...invoice, regime: '612' }).regime).toMatch(/personas físicas/);
    expect(invoiceErrors({ ...invoice, email: 'no' }).email).toBeTruthy();
  });

  it('se guarda normalizada como solicitada y el panel la marca emitida', async () => {
    const r = await t.api('POST', '/api/orders', pickup({ invoice }));
    expect(r.status).toBe(201);
    expect(r.body.order.invoice).toEqual({ rfc: 'ABC010101AB1', name: 'EMPRESA EJEMPLO SA DE CV', regime: '601', zip: '03100', use: 'G03', email: 'pagos@empresa.mx' });
    expect(r.body.order.invoiceStatus).toBe('solicitada');
    await login();
    const id = (await t.api('GET', '/api/admin/orders?filter=todos')).body.orders[0].id;
    expect((await t.api('POST', `/api/admin/orders/${id}/invoice`, { status: 'emitida' })).body.order.invoiceStatus).toBe('emitida');
  });

  it('datos inválidos no crean el pedido', async () => {
    expect((await t.api('POST', '/api/orders', pickup({ invoice: { ...invoice, regime: '612' } }))).status).toBe(422);
  });
});

describe('QR por edificio', () => {
  beforeEach(async () => { t = await start(); });

  it('cada QR cuenta escaneos, pedidos y ventas', async () => {
    await login();
    await t.api('POST', '/api/admin/qr-sources', { label: 'Torre Insurgentes', slug: 'torre-insurgentes' });
    const q = await t.api('GET', '/q/torre-insurgentes');
    expect(q.headers.get('location')).toBe('/?src=torre-insurgentes');
    await t.api('GET', '/q/torre-insurgentes');
    const r = await t.api('POST', '/api/orders', pickup({ source: 'torre-insurgentes' }));
    expect(r.status).toBe(201);
    await t.api('POST', '/api/orders', pickup({ source: 'no-existe' })); // origen desconocido: se ignora
    const { sources } = (await t.api('GET', '/api/admin/qr-sources')).body;
    expect(sources.filter((s: any) => s.slug !== 'fresigrama')).toEqual([expect.objectContaining({ slug: 'torre-insurgentes', label: 'Torre Insurgentes', scans: 2, orders: 1, sales: 0 })]);
    const svg = await fetch(`${t.base}/api/admin/qr-sources/torre-insurgentes/svg`, { headers: { cookie: '' } });
    expect(svg.status).toBe(401);
  });
});

describe('pedido de equipo', () => {
  beforeEach(async () => { t = await start(); });
  const item = (productId: string, sizeId: string, toppingIds: string[] = []) => ({ productId, sizeId, toppingIds, qty: 1 });

  async function group() {
    const g = (await t.api('POST', '/api/groups', { name: 'Equipo de Ventas', organizerName: 'Ana', closesInMinutes: null })).body;
    const add = (memberName: string, memberKey: string, line: object) => t.api('POST', `/api/groups/${g.code}/items`, { memberName, memberKey, line });
    return { ...g, add };
  }

  it('cada quien agrega lo suyo (de a 1 pieza) y ve el total del equipo', async () => {
    const g = await group();
    expect((await g.add('Ana', 'key-ana-123456', item('clasica', 'chico', ['nuez']))).status).toBe(201);
    expect((await g.add('Luis', 'key-luis-123456', item('choco-crema', 'mediano'))).status).toBe(201);
    expect((await g.add('Sofía', 'key-sofi-123456', item('pan-relleno', 'pieza', ['cajeta']))).status).toBe(201);
    const v = (await t.api('GET', `/api/groups/${g.code}?k=key-luis-123456`)).body;
    expect(v.items.map((i: any) => [i.memberName, i.line.forWhom, i.mine])).toEqual([['Ana', 'Ana', false], ['Luis', 'Luis', true], ['Sofía', 'Sofía', false]]);
    expect(v.subtotal).toBe(10000 + 14000 + 10000);
    expect(v.isOrganizer).toBe(false);
    expect((await t.api('GET', `/api/groups/${g.code}?a=${g.adminToken}`)).body.isOrganizer).toBe(true);
  });

  it('solo quitas lo tuyo (el organizador puede quitar cualquiera)', async () => {
    const g = await group();
    await g.add('Ana', 'key-ana-123456', item('clasica', 'chico'));
    await g.add('Luis', 'key-luis-123456', item('clasica', 'chico'));
    const [ana, luis] = (await t.api('GET', `/api/groups/${g.code}`)).body.items;
    expect((await t.api('POST', `/api/groups/${g.code}/items/${ana.id}/delete`, { memberKey: 'key-luis-123456' })).status).toBe(403);
    expect((await t.api('POST', `/api/groups/${g.code}/items/${luis.id}/delete`, { memberKey: 'key-luis-123456' })).status).toBe(200);
    expect((await t.api('POST', `/api/groups/${g.code}/items/${ana.id}/delete`, { adminToken: g.adminToken })).status).toBe(200);
  });

  it('el organizador hace un solo pedido con todo; después ya no se puede agregar', async () => {
    const g = await group();
    await g.add('Ana', 'key-ana-123456', item('clasica', 'chico'));
    await g.add('Luis', 'key-luis-123456', item('clasica', 'chico'));
    await g.add('Sofía', 'key-sofi-123456', item('uvas', 'chico'));
    const ref = { code: g.code, token: g.adminToken };
    const q = await t.api('POST', '/api/quote', { fulfillment: 'pickup', address: null, items: [], group: ref });
    expect(q.body.errors).toEqual([]);
    expect(q.body.total).toBe(30000);
    const r = await t.api('POST', '/api/orders', pickup({ items: [], group: ref }));
    expect(r.status).toBe(201);
    expect(r.body.order.groupName).toBe('Equipo de Ventas');
    expect(r.body.order.items.map((l: any) => l.forWhom)).toEqual(['Ana', 'Luis', 'Sofía']);
    const v = (await t.api('GET', `/api/groups/${g.code}`)).body;
    expect(v).toMatchObject({ status: 'pedido', closed: true, orderNumber: r.body.number });
    expect((await g.add('Tardío', 'key-tarde-12345', item('clasica', 'chico'))).status).toBe(409);
    expect((await t.api('POST', '/api/orders', pickup({ items: [], group: ref }))).status).toBe(409);
  });

  it('sin mínimo de piezas (basta 1) y solo el organizador lo envía', async () => {
    const empty = await group();
    expect((await t.api('POST', '/api/orders', pickup({ items: [], group: { code: empty.code, token: empty.adminToken } }))).status).toBe(422);
    const g = await group();
    await g.add('Ana', 'key-ana-123456', item('clasica', 'chico'));
    expect((await t.api('POST', '/api/orders', pickup({ items: [], group: { code: g.code, token: 'token-que-no-es-0000' } }))).status).toBe(403);
    expect((await t.api('POST', '/api/orders', pickup({ items: [], group: { code: g.code, token: g.adminToken } }))).status).toBe(201);
  });

  it('respeta la hora límite', async () => {
    const g = (await t.api('POST', '/api/groups', { name: 'Junta', organizerName: 'Ana', closesInMinutes: 10 })).body;
    const add = () => t.api('POST', `/api/groups/${g.code}/items`, { memberName: 'Luis', memberKey: 'key-luis-123456', line: item('clasica', 'chico') });
    expect((await add()).status).toBe(201);
    t.ctx.now = () => new Date(Date.parse(NOW) + 11 * 60000); // 11 min después
    expect((await add()).status).toBe(409);
    expect((await t.api('GET', `/api/groups/${g.code}`)).body.closed).toBe(true);
  });
});
