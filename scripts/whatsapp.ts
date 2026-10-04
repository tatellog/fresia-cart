/**
 * Reenvía el aviso de WhatsApp de un pedido al negocio (para probar la configuración).
 *   npm run whatsapp:avisar FO-1002
 */
import { loadConfig } from '../server/env';
import { openDb } from '../server/db';
import { addEvent, toAdmin } from '../server/orders';
import type { OrderRow } from '../server/orders';
import { buildWhatsApp } from '../server/notify';
import { getBusiness } from '../server/store';
import { sendWhatsApp, whatsappConfigured } from '../server/whatsapp';

const number = process.argv[2];
if (!number) {
  console.error('Uso: npm run whatsapp:avisar FO-1002');
  process.exit(1);
}
const config = loadConfig();
if (!whatsappConfigured(config)) {
  console.error('✗ WhatsApp no está configurado en .env (WHATSAPP_PROVIDER y credenciales).');
  process.exit(1);
}
const db = await openDb({ url: config.databaseUrl || undefined, pglitePath: config.pglitePath });
try {
  const row = await db.one<OrderRow>('select * from office.orders where number = $1', [number]);
  if (!row) throw new Error(`No existe el pedido ${number}`);
  const order = await toAdmin(db, row);
  const to = config.whatsappNotifyTo || (await getBusiness(db)).whatsapp;
  const kind = order.paymentMethod === 'contra_entrega' ? 'pedido_contra_entrega' : order.orderStatus === 'cotizando_envio' ? 'cotizacion_envio' : 'pedido_pagado';
  await sendWhatsApp(config, buildWhatsApp(kind, order, `${config.publicUrl}/admin/pedidos/${order.id}`, to));
  await addEvent(db, order.id, 'whatsapp', 'Aviso reenviado manualmente', 'script');
  console.log(`✓ Aviso de ${number} enviado a ${to.replace(/\d(?=\d{4})/g, '•')}`);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
