import type { Ctx } from './context';
import { addEvent, toAdmin } from './orders';
import type { OrderRow } from './orders';

export type NotifyKind = 'pedido_pagado' | 'cotizacion_envio' | 'revision';

const TITLES: Record<NotifyKind, string> = {
  pedido_pagado: 'Nuevo pedido pagado',
  cotizacion_envio: 'Pedido esperando cotización de envío',
  revision: 'Pedido requiere revisión',
};

/**
 * Avisa al negocio desde el servidor, sin depender del navegador del cliente.
 * Siempre queda visible en el panel; si hay NOTIFY_WEBHOOK_URL, también se envía ahí.
 */
export class Notifier {
  sent: { kind: NotifyKind; number: string }[] = [];

  notify(ctx: Ctx, kind: NotifyKind, order: OrderRow) {
    this.sent.push({ kind, number: order.number });
    console.log(`[aviso] ${TITLES[kind]}: ${order.number}`);
    const url = ctx.config.notifyWebhookUrl;
    if (!url) return;
    void this.send(ctx, url, kind, order);
  }

  private async send(ctx: Ctx, url: string, kind: NotifyKind, order: OrderRow) {
    const full = await toAdmin(ctx.db, order);
    const payload = {
      kind,
      title: `${TITLES[kind]} · ${order.number}`,
      adminUrl: `${ctx.config.publicUrl}/admin/pedidos/${order.id}`,
      order: {
        number: full.number, total: full.total, fulfillment: full.fulfillment, customerName: full.customerName,
        customerPhone: full.customerPhone, address: full.address, items: full.items, notes: full.notes, needsReview: full.needsReview,
      },
    };
    const ok = await deliver(url, payload);
    await addEvent(ctx.db, order.id, 'aviso', ok ? `Aviso enviado (${kind})` : `Aviso falló (${kind})`, 'sistema').catch(() => undefined);
  }
}

async function deliver(url: string, payload: unknown, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
      if (res.ok) return true;
    } catch {
      /* reintenta */
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  return false;
}
