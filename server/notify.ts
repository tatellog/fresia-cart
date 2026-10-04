import type { Ctx } from './context';
import { addEvent, toAdmin } from './orders';
import type { OrderRow } from './orders';
import { getBusiness } from './store';
import { sendWhatsApp, whatsappConfigured } from './whatsapp';
import type { WhatsAppMessage } from './whatsapp';
import { money } from '../shared/money';
import { background } from './background';
import type { AdminOrder } from '../shared/types';

export type NotifyKind = 'pedido_pagado' | 'pedido_contra_entrega' | 'cotizacion_envio' | 'revision';

const TITLES: Record<NotifyKind, string> = {
  pedido_pagado: 'Nuevo pedido pagado',
  pedido_contra_entrega: 'Nuevo pedido · paga al recibir',
  cotizacion_envio: 'Pedido esperando cotización de envío',
  revision: 'Pedido requiere revisión',
};

/**
 * Avisa al negocio desde el servidor, sin depender del navegador del cliente:
 * - siempre queda visible en el panel;
 * - por WhatsApp si está configurado (WHATSAPP_PROVIDER);
 * - y por NOTIFY_WEBHOOK_URL si existe.
 */
export class Notifier {
  sent: { kind: NotifyKind; number: string }[] = [];
  /** Solo pruebas: mensajes de WhatsApp que se habrían enviado. */
  whatsappOutbox: WhatsAppMessage[] = [];

  notify(ctx: Ctx, kind: NotifyKind, order: OrderRow) {
    this.sent.push({ kind, number: order.number });
    console.log(`[aviso] ${TITLES[kind]}: ${order.number}`);
    background(this.deliverAll(ctx, kind, order));
  }

  private async deliverAll(ctx: Ctx, kind: NotifyKind, order: OrderRow) {
    const full = await toAdmin(ctx.db, order);
    const adminUrl = `${ctx.config.publicUrl}/admin/pedidos/${order.id}`;
    await Promise.all([this.whatsapp(ctx, kind, full, adminUrl), this.webhook(ctx, kind, full, adminUrl)]);
  }

  private async whatsapp(ctx: Ctx, kind: NotifyKind, order: AdminOrder, adminUrl: string) {
    const to = ctx.config.whatsappNotifyTo || (await getBusiness(ctx.db)).whatsapp;
    const msg = buildWhatsApp(kind, order, adminUrl, to);
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      this.whatsappOutbox.push(msg);
      return;
    }
    if (!whatsappConfigured(ctx.config) || !to) {
      await addEvent(ctx.db, order.id, 'whatsapp', 'No enviado: WhatsApp no configurado', 'sistema').catch(() => undefined);
      return;
    }
    for (let i = 0; i < 3; i++) {
      try {
        await sendWhatsApp(ctx.config, msg);
        await addEvent(ctx.db, order.id, 'whatsapp', `Aviso enviado a ${mask(to)}`, 'sistema').catch(() => undefined);
        return;
      } catch (e) {
        if (i === 2) {
          console.error('[whatsapp]', (e as Error).message);
          await addEvent(ctx.db, order.id, 'whatsapp', `Falló el aviso: ${(e as Error).message.slice(0, 120)}`, 'sistema').catch(() => undefined);
        }
        await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
      }
    }
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

const mask = (n: string) => n.replace(/\d(?=\d{4})/g, '•');

/** Texto del aviso: lo que la cocina y el repartidor necesitan, sin datos de pago. */
export function buildWhatsApp(kind: NotifyKind, o: AdminOrder, adminUrl: string, to: string): WhatsAppMessage {
  const total = o.total != null ? money(o.total) : 'envío por cotizar';
  const cod = o.paymentMethod === 'contra_entrega';
  const pay = cod
    ? `${o.paymentStatus === 'aprobado' ? '✅ Cobrado' : '💵 Paga ' + (o.fulfillment === 'pickup' ? 'al recoger' : 'al recibir')}: ${total}`
    : o.paymentStatus === 'aprobado'
      ? `✅ Pagado en línea: ${total}`
      : `⏳ Pago en línea pendiente: ${total}`;

  const a = o.address;
  const eta =
    o.deliveryQuote.status === 'covered' ? ` · ${o.deliveryQuote.etaMin}–${o.deliveryQuote.etaMax} min`
    : o.deliveryQuote.status === 'quoted' ? ` · ${o.deliveryQuote.etaText}`
    : o.deliveryQuote.status === 'manual' ? ' · ⚠️ confirmar envío' : '';
  const map = a?.location ? `https://maps.google.com/?q=${a.location.lat.toFixed(6)},${a.location.lng.toFixed(6)}` : '';
  const deliveryLines =
    o.fulfillment === 'pickup'
      ? ['🏪 *Recoge en Frésia*']
      : [
          `🛵 *Entrega a domicilio*${eta}`,
          `   ${a?.street} ${a?.number}, ${a?.office}`,
          ...(a?.colonia ? [`   ${a.colonia}${a.postalCode ? `, CP ${a.postalCode}` : ''}`] : []),
          ...(a?.references ? [`   Ref: ${a.references}`] : []),
          ...(map ? [`   📍 ${map}`] : []),
        ];
  const phone = o.customerPhone.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3');

  const size = (label: string) => (label === 'Pieza' || label === 'Combo' ? '' : ` · ${label}`);
  const tops = (ts: { name: string }[]) => (ts.length ? `: ${ts.map((t) => t.name.charAt(0).toLowerCase() + t.name.slice(1)).join(', ')}` : '');
  const blocks = o.items.map((l, i) => {
    const head = `*${i + 1}) ${l.qty > 1 ? `${l.qty} × ` : ''}${l.choices ? 'Combo ' : ''}${l.name}${l.choices ? '' : size(l.sizeLabel)}* — ${money(l.lineTotal)}`;
    const who = l.forWhom ? [`   Para: ${l.forWhom}`] : [];
    if (!l.choices) return [head, ...who, ...(l.toppings.length ? [`   Toppings${tops(l.toppings)}`] : ['   Sin toppings'])];
    const groups = new Map<string, number>();
    for (const c of l.choices) {
      const key = `${c.name}${size(c.sizeLabel)}${tops(c.toppings)}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [head, ...who, ...[...groups].map(([k, n]) => `   • ${n} ${k}`)];
  });

  const text = [
    `🍓 *NUEVO PEDIDO ${o.number}*${kind === 'cotizacion_envio' ? ' — confirmar envío' : kind === 'revision' ? ' — revisar' : ''}`,
    '',
    pay,
    ...deliveryLines,
    `👤 ${o.customerName} · ${phone}`,
    '',
    `🧾 *PRODUCTOS*`,
    ...blocks.flatMap((b) => ['', ...b]),
    ...(o.notes ? ['', `📝 Notas: ${o.notes}`] : []),
    ...(o.needsReview ? ['', `⚠️ ${o.needsReview}`] : []),
    '',
    `Ver en el panel: ${adminUrl}`,
  ].join('\n');

  // Plantilla de Meta: las variables no admiten saltos de línea, así que cada dato va en
  // su propio renglón fijo de la plantilla y los productos se separan con « ┃ ».
  const flat = (lines: string[]) => lines.map((x) => x.trim()).filter(Boolean).join(' · ').replace(/\*/g, '');
  const products = blocks
    .map((b) => {
      const [head, ...rest] = b.map((x) => x.trim().replace(/\*/g, ''));
      const who = rest.find((x) => x.startsWith('Para: '));
      const detail = rest.filter((x) => x !== who).map((x) => x.replace(/^• /, '')).join('; ');
      return `${head}${who ? ` (${who})` : ''}: ${detail}`;
    })
    .join('  ┃  ');
  return {
    to,
    text,
    params: [
      o.number,
      pay.replace(/^\S+\s/, ''),
      flat(deliveryLines).replace(/^\S+\s/, ''),
      `${o.customerName} · ${phone}`,
      products,
      o.notes || 'Sin notas',
    ],
    buttonParam: o.id,
  };
}
