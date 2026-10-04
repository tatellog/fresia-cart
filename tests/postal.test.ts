import { afterEach, describe, expect, it } from 'vitest';
import { address, orderBody, start } from './helpers';
import { parseSepomex } from '../server/postal';

let t: Awaited<ReturnType<typeof start>>;
afterEach(async () => { await t?.close(); });

// Filas con el formato del TXT de SEPOMEX (dos líneas de encabezado).
const SAMPLE = [
  'El Catálogo Nacional de Códigos Postales…',
  'd_codigo|d_asenta|d_tipo_asenta|D_mnpio|d_estado|d_ciudad|d_CP',
  '03100|Del Valle Centro|Colonia|Benito Juárez|Ciudad de México|Ciudad de México|03101',
  '03100|Insurgentes San Borja|Colonia|Benito Juárez|Ciudad de México|Ciudad de México|03101',
  '03103|Del Valle Norte|Colonia|Benito Juárez|Ciudad de México|Ciudad de México|03101',
].join('\r\n');

async function load() {
  for (const r of parseSepomex(SAMPLE)) {
    await t.ctx.db.query('insert into office.postal_codes (cp, colonia, tipo, alcaldia, estado) values ($1, $2, $3, $4, $5)', [r.cp, r.colonia, r.tipo, r.alcaldia, r.estado]);
  }
}
const withAddr = (over: object) => orderBody({ paymentMethod: 'contra_entrega', address: { ...address, ...over } });

describe('código postal (SEPOMEX)', () => {
  it('lee el archivo de SEPOMEX', () => {
    expect(parseSepomex(SAMPLE)).toHaveLength(3);
  });

  it('sin catálogo cargado no valida (como antes)', async () => {
    t = await start();
    expect((await t.api('GET', '/api/postal-codes/03103')).body).toEqual({ found: false, catalog: false });
    expect((await t.api('POST', '/api/orders', withAddr({ postalCode: '99999', colonia: 'Inventada' }))).status).toBe(201);
  });

  it('devuelve colonias y alcaldía para autollenar', async () => {
    t = await start();
    await load();
    const r = await t.api('GET', '/api/postal-codes/03100');
    expect(r.body).toMatchObject({ found: true, alcaldia: 'Benito Juárez', estado: 'Ciudad de México' });
    expect(r.body.colonias.map((c: any) => c.name)).toEqual(['Del Valle Centro', 'Insurgentes San Borja']);
    expect((await t.api('GET', '/api/postal-codes/99999')).body).toEqual({ found: false, catalog: true });
    expect((await t.api('GET', '/api/postal-codes/12')).status).toBe(400);
  });

  it('el pedido rechaza un CP inexistente o una colonia de otro CP, y guarda el nombre oficial', async () => {
    t = await start();
    await load();
    const bad = await t.api('POST', '/api/orders', withAddr({ postalCode: '99999' }));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('postal_code');
    const wrong = await t.api('POST', '/api/orders', withAddr({ postalCode: '03103', colonia: 'Del Valle Centro' }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('colonia');
    const ok = await t.api('POST', '/api/orders', withAddr({ postalCode: '03103', colonia: 'del valle  NORTE' }));
    expect(ok.status).toBe(201);
    expect(ok.body.order.address.colonia).toBe('Del Valle Norte');
  });
});
