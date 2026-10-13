import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderBody, start, tick } from './helpers';
import { deviceOf } from '../server/analytics';

let t: Awaited<ReturnType<typeof start>>;
beforeEach(async () => { t = await start(); });
afterEach(async () => { await t.close(); });
const login = () => t.api('POST', '/api/admin/login', { password: 'secreto-de-prueba' });
const visitor = 'v-1234567890abcdef';
const ev = (event: string, over: object = {}) => t.api('POST', '/api/events', { event, visitor, ...over });
const campaign = { source: 'instagram', medium: 'social', campaign: 'Octubre WTC' };

describe('medición y atribución (FO-001)', () => {
  it('acepta solo eventos conocidos y nunca una «compra» desde el navegador', async () => {
    expect((await ev('visita', { attribution: campaign })).status).toBe(204);
    expect((await ev('compra')).status).toBe(400);
    expect((await ev('borrar_todo')).status).toBe(400);
    // Sin datos personales: un campo de más (p. ej. teléfono) no se guarda.
    expect((await ev('ver_producto', { productId: 'clasica', phone: '5512345678' })).status).toBe(204);
    const cols = await t.ctx.db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'office' and table_name = 'analytics_events'");
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['phone']));
  });

  it('el pedido conserva su campaña, dispositivo y modalidad', async () => {
    const r = await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', attribution: campaign }));
    const row = await t.ctx.db.one<any>('select utm_source, utm_medium, utm_campaign, device, order_mode from office.orders where number = $1', [r.body.number]);
    expect(row).toEqual({ utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'octubre-wtc', device: 'escritorio', order_mode: 'individual' });
  });

  it('la compra se cuenta una sola vez (reintentos y avisos de pago repetidos)', async () => {
    const body = orderBody({ paymentMethod: 'contra_entrega', attribution: campaign });
    await t.api('POST', '/api/orders', body);
    await t.api('POST', '/api/orders', body); // doble clic: mismo pedido
    const online = await t.api('POST', '/api/orders', orderBody({ attribution: campaign }));
    const count = async () => (await t.ctx.db.one<{ n: number }>("select count(*)::int as n from office.analytics_events where event = 'compra'"))!.n;
    expect(await count()).toBe(1); // el pago en línea aún no se aprueba
    const co = await t.api('POST', `/api/orders/${online.body.number}/checkout`, { t: online.body.token });
    const prefId = co.body.checkoutUrl.split('/').pop();
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await t.api('POST', `/api/demo/preferences/${prefId}/pay`, { outcome: 'approved' });
    await tick(50);
    expect(await count()).toBe(2);
  });

  it('conversión por campaña, dispositivo y modalidad en el panel', async () => {
    await ev('visita', { attribution: campaign, mode: null });
    await ev('ver_producto', { attribution: campaign, productId: 'clasica' });
    await ev('iniciar_checkout', { attribution: campaign, mode: 'individual' });
    await ev('visita', { visitor: 'v-otro-visitante-01' });
    await t.api('POST', '/api/orders', orderBody({ paymentMethod: 'contra_entrega', attribution: campaign }));
    expect((await t.api('GET', '/api/admin/analytics')).status).toBe(401);
    await login();
    const r = (await t.api('GET', '/api/admin/analytics?days=30')).body;
    expect(r.campana.find((x: any) => x.key === 'instagram · octubre-wtc')).toMatchObject({ visitantes: 1, vieronProducto: 1, checkout: 1, compras: 1 });
    expect(r.campana.find((x: any) => x.key === 'directo')).toMatchObject({ visitantes: 1, compras: 0 });
    expect(r.modalidad.find((x: any) => x.key === 'individual')).toMatchObject({ checkout: 1, compras: 1 });
    expect(r.dispositivo.find((x: any) => x.key === 'escritorio').compras).toBe(1);
  });

  it('tipo de dispositivo sin guardar el User-Agent', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('movil');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('movil');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('escritorio');
  });
});
