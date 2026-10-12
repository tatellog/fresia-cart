import type { Ctx } from './context';
import { addEvent, toAdmin } from './orders';
import type { OrderRow } from './orders';
import { money } from '../shared/money';
import { background } from './background';
import { sendPushToAll } from './push';
import type { PushPayload } from './push';
import type { AdminOrder } from '../shared/types';
import { collectInfo } from '../shared/status';
import { slotLabel } from '../shared/schedule';

export type NotifyKind = 'pedido_pagado' | 'pedido_contra_entrega' | 'cotizacion_envio' | 'revision' | 'cancelado_cliente';

const TITLES: Record<NotifyKind, string> = {
  pedido_pagado: 'Nuevo pedido pagado',
  pedido_contra_entrega: 'Nuevo pedido · paga al recibir',
  cotizacion_envio: 'Pedido esperando cotización de envío',
  revision: 'Pedido requiere revisión',
  cancelado_cliente: 'El cliente canceló su pedido',
};

/**
 * Avisa al negocio desde el servidor, sin depender del navegador del cliente:
 * - siempre queda visible en el panel;
 * - y por NOTIFY_WEBHOOK_URL si existe.
 */
export class Notifier {
  sent: { kind: NotifyKind; number: string }[] = [];
  /** Solo pruebas: notificaciones push que se habrían enviado. */
  pushOutbox: PushPayload[] = [];

  notify(ctx: Ctx, kind: NotifyKind, order: OrderRow) {
    this.sent.push({ kind, number: order.number });
    console.log(`[aviso] ${TITLES[kind]}: ${order.number}`);
    background(this.deliverAll(ctx, kind, order));
  }

  private async deliverAll(ctx: Ctx, kind: NotifyKind, order: OrderRow) {
    const full = await toAdmin(ctx.db, order);
    const adminUrl = `${ctx.config.publicUrl}/admin/pedidos/${order.id}`;
    // Una cancelación solo avisa al panel y al celular.
    if (kind === 'cancelado_cliente') return this.push(ctx, kind, full);
    await Promise.all([this.push(ctx, kind, full), this.webhook(ctx, kind, full, adminUrl)]);
  }

  private async push(ctx: Ctx, kind: NotifyKind, order: AdminOrder) {
    const payload = buildPush(kind, order);
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      this.pushOutbox.push(payload);
      return;
    }
    const r = await sendPushToAll(ctx.config, ctx.db, payload);
    if (r.sent || r.failed) await addEvent(ctx.db, order.id, 'push', `Notificación a ${r.sent} dispositivo(s)${r.failed ? `, ${r.failed} fallaron` : ''}`, 'sistema').catch(() => undefined);
  }

  private async webhook(ctx: Ctx, kind: NotifyKind, order: AdminOrder, adminUrl: string) {
    const url = ctx.config.notifyWebhookUrl;
    if (!url) return;
    const payload = {
      kind,
      title: `${TITLES[kind]} · ${order.number}`,
      adminUrl,
      order: {
        number: order.number, total: order.total, paymentMethod: order.paymentMethod, fulfillment: order.fulfillment,
        customerName: order.customerName, customerPhone: order.customerPhone, address: order.address, items: order.items, notes: order.notes,
        needsReview: order.needsReview,
      },
    };
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          await addEvent(ctx.db, order.id, 'aviso', `Webhook enviado (${kind})`, 'sistema').catch(() => undefined);
          return;
        }
      } catch {
        /* reintenta */
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
    await addEvent(ctx.db, order.id, 'aviso', `Webhook falló (${kind})`, 'sistema').catch(() => undefined);
  }
}

/** Notificación corta para el celular o la laptop: lo esencial para decidir si atender ya. */
export function buildPush(kind: NotifyKind, o: AdminOrder): PushPayload {
  const lines = paymentLines(o);
  const when = `${o.gift ? '🎁 ' : ''}${o.scheduledFor ? `🗓 ${slotLabel(o.scheduledFor)} · ` : ''}`;
  const pay = when + lines.map((l) => l.trim()).join(' · ');
  const where = o.fulfillment === 'pickup' ? 'Recoge en Frésia' : 'A domicilio';
  const pieces = o.items.reduce((n, l) => n + l.qty * (l.choices?.length ?? 1), 0);
  if (kind === 'cancelado_cliente') {
    return {
      title: `❌ ${o.customerName} canceló ${o.number}`,
      body: o.refundStatus === 'pendiente' ? 'Ya estaba pagado: queda el reembolso pendiente.' : 'No lo prepares. No había cobro.',
      url: `/admin/pedidos/${o.id}`,
      tag: `pedido-${o.number}`,
    };
  }
  return {
    title: `🍓 ${TITLES[kind]} · ${o.number}`,
    body: `${pay} · ${where} · ${pieces} pieza${pieces === 1 ? '' : 's'} · ${o.customerName}`,
    url: `/admin/pedidos/${o.id}`,
    tag: `pedido-${o.number}`,
  };
}

/** «¿Ya está pagado o hay que cobrar?» en una o dos líneas, igual que en el panel. */
export function paymentLines(o: AdminOrder): string[] {
  const c = collectInfo(o, money);
  if (c.tone === 'paid') return [`✅ ${c.label}: ${o.total != null ? money(o.total) : ''}`.trim()];
  if (c.tone === 'pending') return [`⏳ ${c.label}`];
  if (c.tone === 'none') return [`— ${c.label}`];
  const extra =
    o.fulfillment === 'pickup'
      ? 'Efectivo o terminal en el local'
      : o.payWithCard
        ? 'Lleva la terminal'
        : o.cashTendered == null
          ? 'Monto con el que paga: no indicado'
          : c.change
            ? `Paga con ${money(o.cashTendered)} → llevar ${money(c.change)} de cambio`
            : 'Paga con el monto exacto';
  return [`${o.payWithCard ? '💳' : '💵'} ${c.label}`, `   ${extra}`];
}
