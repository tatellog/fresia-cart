import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../server/db';
import type { Sql } from '../server/db';

// Mismas migraciones que Supabase: verifica que el rol de la app no pueda más de lo necesario.
let db: Sql;
beforeAll(async () => {
  db = await openDb({});
  await db.query('set role fresia_office_app');
});
afterAll(() => db.close());

const denied = async (sql: string) => {
  await expect(db.tx((q) => q.query(sql))).rejects.toThrow(/permission denied|must be owner/);
};

describe('rol fresia_office_app', () => {
  it('lee el menú', async () => {
    expect(await db.query('select * from office.products')).toBeInstanceOf(Array);
  });
  it('no borra pedidos ni pagos, ni altera el historial', async () => {
    await denied('delete from office.orders');
    await denied('delete from office.payments');
    await denied("update office.order_events set detail = ''");
    await denied('delete from office.order_events');
  });
  it('no cambia el esquema', async () => {
    await denied('alter table office.orders add column x int');
    await denied('create table office.x (id int)');
    await denied('drop table office.orders');
  });
  it('no lee la bitácora de migraciones', async () => {
    await denied('select * from office.schema_migrations');
  });
});

describe('roles de la API pública', () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    it(`${role} no puede leer pedidos`, async () => {
      await expect(
        db.tx(async (q) => {
          await q.query('reset role');
          await q.query(`set local role ${role}`);
          return q.query('select * from office.orders');
        }),
      ).rejects.toThrow(/permission denied/);
    });
  }
});
