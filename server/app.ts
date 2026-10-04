import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';
import { ZodError } from 'zod';
import { openDb, iso } from './db';
import type { DB } from './db';
import type { Config } from './env';
import { HttpError, onlinePaymentReady } from './context';
import type { Ctx } from './context';
import { Notifier } from './notify';
import { DemoProvider } from './payments/demo';
import { MercadoPagoProvider, verifyMercadoPagoSignature } from './payments/mercadopago';
import { checkReturnedPayment, handlePaymentNotification, reconcile, startCheckout } from './payments/service';
import {
  createOrder, purgeOldDeliveryPhotos, setInvoiceStatus, getDeliveryPhoto, getOrderById, getOrderForCustomer, listOrders, markCollected, quoteOrder, saveCourierLocation, saveDeliveryPhoto, setOrderStatus, setRefundStatus, setShippingQuote, toAdmin, toPublic, trackingFor,
} from './orders';
import * as store from './store';
import * as S from './schemas';
import { clearSession, isAdmin, passwordMatches, secretMatches, rateLimit, requireAdmin, setSession } from './auth';
import { whatsappConfigured } from './whatsapp';
import { addGroupItem, createGroup, groupLinesForOrder, groupView, removeGroupItem } from './groups';
import { background, sleep } from './background';
import { clubCardFor, stampClub } from './club';
import { lookupPostalCode, postalCatalogLoaded } from './postal';
import { listSubscriptions, pushConfigured, removeSubscription, saveSubscription, sendPushToAll } from './push';
import type { LegalSlug, MenuResponse } from '../shared/types';
import { ADMIN_FLOW } from '../shared/status';

const LEGAL: LegalSlug[] = ['privacidad', 'entregas', 'cancelaciones'];

export async function createApp(config: Config, opts: { demoWebhookDelayMs?: number; db?: DB; now?: () => Date } = {}) {
  const db = opts.db ?? (await openDb({ url: config.databaseUrl || undefined, pglitePath: config.pglitePath, production: config.production }));
  await store.seedIfEmpty(db);
  const provider = config.mpAccessToken ? new MercadoPagoProvider(config.mpAccessToken) : new DemoProvider(db);
  const ctx: Ctx = { db, config, provider, notifier: new Notifier(), now: opts.now ?? (() => new Date()) };
  const demoDelay = opts.demoWebhookDelayMs ?? 1500;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  // ── Público ──────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => res.json({ ok: true, payments: provider.name }));

  app.get('/api/menu', async (_req, res) => {
    const [delivery, products, toppings, business, rules, schedule] = await Promise.all([
      store.getDelivery(db), store.listProducts(db), store.listToppings(db), store.getBusiness(db), store.getRules(db), store.getSchedule(db),
    ]);
    const { zones, ...rest } = delivery;
    const body: MenuResponse = {
      products,
      toppings,
      rules,
      schedule,
      business,
      delivery: { ...rest, onlinePayment: rest.onlinePayment && onlinePaymentReady(ctx), zoneNames: zones.filter((z) => z.active).map((z) => z.name) },
      paymentsMode: provider.name,
    };
    res.json(body);
  });

  // Tarea diaria (Vercel Cron): mantiene activa la base del plan gratis y borra fotos de entrega viejas.
  app.get('/api/cron/daily', async (req, res) => {
    const got = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!secretMatches(got, config.cronSecret)) throw new HttpError(401, 'No autorizado.');
    const purged = await purgeOldDeliveryPhotos(db, ctx.now());
    console.log(`[cron] latido ok · ${purged} foto(s) de entrega borradas`);
    res.json({ ok: true, purgedPhotos: purged });
  });

  // Código postal → colonias y alcaldía (catálogo de SEPOMEX) para autollenar la dirección.
  app.get('/api/postal-codes/:cp', rateLimit(60, 60_000), async (req, res) => {
    const cp = String(req.params.cp);
    if (!/^\d{5}$/.test(cp)) throw new HttpError(400, 'El código postal debe tener 5 dígitos.');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (!(await postalCatalogLoaded(db))) return res.json({ found: false, catalog: false });
    const info = await lookupPostalCode(db, cp);
    res.json(info ? { found: true, catalog: true, ...info } : { found: false, catalog: true });
  });

  app.post('/api/coverage', rateLimit(60, 60_000), async (req, res) => {
    const input = S.coverageSchema.parse(req.body);
    res.json((await quoteOrder(db, { fulfillment: 'delivery', address: { ...input, street: '', number: '', office: '', references: '' }, items: [] })).delivery);
  });

  app.post('/api/quote', rateLimit(120, 60_000), async (req, res) => {
    const input = S.quoteSchema.parse(req.body);
    if (input.group) {
      const { lines } = await groupLinesForOrder(ctx, input.group.code, input.group.token);
      return res.json(await quoteOrder(db, { ...input, items: lines }, { group: true }));
    }
    res.json(await quoteOrder(db, input));
  });

  // ── Pedido de equipo ─────────────────────────────────────────────
  app.post('/api/groups', rateLimit(10, 60_000), async (req, res) => {
    const g = await createGroup(db, S.createGroupSchema.parse(req.body), ctx.now());
    res.status(201).json({ code: g.code, adminToken: g.admin_token });
  });
  app.get('/api/groups/:code', rateLimit(240, 60_000), async (req, res) => {
    res.json(await groupView(ctx, String(req.params.code), { memberKey: String(req.query.k ?? ''), adminToken: String(req.query.a ?? '') }));
  });
  app.post('/api/groups/:code/items', rateLimit(60, 60_000), async (req, res) => {
    await addGroupItem(ctx, String(req.params.code), S.groupItemSchema.parse(req.body));
    res.status(201).json({ ok: true });
  });
  app.post('/api/groups/:code/items/:id/delete', rateLimit(60, 60_000), async (req, res) => {
    await removeGroupItem(ctx, String(req.params.code), String(req.params.id), { memberKey: req.body?.memberKey, adminToken: req.body?.adminToken });
    res.json({ ok: true });
  });

  app.post('/api/orders', rateLimit(20, 60_000), async (req, res) => {
    const { idempotencyKey, ...input } = S.orderSchema.parse(req.body);
    const { order, created } = await createOrder(ctx, idempotencyKey, {
      customer: input.customer,
      fulfillment: input.fulfillment,
      paymentMethod: input.paymentMethod,
      cashTendered: input.cashTendered,
      source: input.source ?? null,
      invoice: input.invoice ?? null,
      gift: input.gift ?? null,
      scheduledFor: input.scheduledFor ?? null,
      group: input.group ?? null,
      address: input.fulfillment === 'delivery' ? input.address : null,
      notes: input.notes,
      items: input.items,
    });
    res.status(created ? 201 : 200).json({ number: order.number, token: order.access_token, order: toPublic(order) });
  });

  app.get('/api/orders/:number', rateLimit(120, 60_000), async (req, res) => {
    const token = String(req.query.t ?? '');
    let order = await getOrderForCustomer(db, String(req.params.number), token);
    try {
      const pid = req.query.payment_id ?? req.query.collection_id;
      if (typeof pid === 'string' && /^[\w-]{1,64}$/.test(pid)) await checkReturnedPayment(ctx, order, pid);
      if (['sin_pagar', 'pendiente', 'rechazado', 'cancelado'].includes(order.payment_status)) await reconcile(ctx, order);
    } catch (e) {
      console.error('[pagos] consulta de estado falló', e);
    }
    order = (await getOrderById(db, order.id))!;
    res.json({ order: toPublic(order) });
  });

  // Foto de entrega: el cliente la ve con el token de su pedido.
  app.get('/api/orders/:number/delivery-photo', rateLimit(60, 60_000), async (req, res) => {
    const order = await getOrderForCustomer(db, String(req.params.number), String(req.query.t ?? ''));
    const photo = await getDeliveryPhoto(db, order.id);
    if (!photo) throw new HttpError(404, 'Sin foto de entrega.');
    res.setHeader('Content-Type', photo.content_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(photo.image));
  });

  // Seguimiento en vivo: solo con el token del pedido y solo mientras va en camino.
  app.get('/api/orders/:number/tracking', rateLimit(240, 60_000), async (req, res) => {
    const order = await getOrderForCustomer(db, String(req.params.number), String(req.query.t ?? ''));
    res.json(await trackingFor(ctx, order));
  });

  // Frésia Club: sellos de la tarjeta con el teléfono del pedido.
  app.get('/api/orders/:number/club', rateLimit(30, 60_000), async (req, res) => {
    const order = await getOrderForCustomer(db, String(req.params.number), String(req.query.t ?? ''));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ club: await clubCardFor(ctx, order) });
  });

  app.post('/api/orders/:number/checkout', rateLimit(20, 60_000), async (req, res) => {
    const order = await getOrderForCustomer(db, String(req.params.number), String(req.body?.t ?? ''));
    res.json(await startCheckout(ctx, order.id));
  });

  app.get('/api/legal/:slug', async (req, res) => {
    const slug = req.params.slug as LegalSlug;
    if (!LEGAL.includes(slug)) throw new HttpError(404, 'No encontrado');
    res.json(await store.getLegal(db, slug));
  });

  // Enlace permanente del QR del volante: siempre apunta al menú vigente.
  app.get(['/q', '/q/:source'], async (req, res) => {
    const source = String(req.params.source ?? 'volante').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'volante';
    await db.query('insert into office.qr_scans (day, source, count) values (current_date, $1, 1) on conflict (day, source) do update set count = office.qr_scans.count + 1', [source]);
    // El slug viaja en la URL para atribuir el pedido al edificio (la tienda lo guarda en el teléfono).
    res.redirect(302, source === 'volante' ? '/' : `/?src=${encodeURIComponent(source)}`);
  });

  // ── Notificaciones de Mercado Pago ─────────────────────────────────
  app.post('/api/webhooks/mercadopago', async (req, res) => {
    const type = String(req.query.type ?? req.body?.type ?? req.query.topic ?? '');
    const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? req.query.id ?? '');
    let verified = false;
    if (config.mpWebhookSecret) {
      const check = verifyMercadoPagoSignature({
        secret: config.mpWebhookSecret,
        signatureHeader: req.header('x-signature'),
        requestId: req.header('x-request-id'),
        dataId,
      });
      if (!check.ok) {
        await logWebhook(false, req.body, `rechazada: ${check.reason}`);
        return res.status(401).json({ error: 'firma inválida' });
      }
      verified = true;
    }
    if (provider.name !== 'mercadopago' || type !== 'payment' || !dataId) {
      await logWebhook(verified, req.body, 'ignorada');
      return res.sendStatus(200);
    }
    try {
      // Aun con firma válida, el estado se obtiene consultando la API de Mercado Pago.
      const result = await handlePaymentNotification(ctx, dataId, 'mercadopago:webhook');
      await logWebhook(verified, req.body, result);
      res.sendStatus(200);
    } catch (e) {
      await logWebhook(verified, req.body, `error: ${(e as Error).message}`).catch(() => undefined);
      res.sendStatus(500); // Mercado Pago reintentará
    }
  });

  async function logWebhook(verified: boolean, payload: unknown, result: string) {
    const body = payload && typeof payload === 'object' ? payload : {};
    await db.query('insert into office.webhook_log (provider, verified, payload, result) values ($1, $2, $3::jsonb, $4)', [
      'mercadopago', verified, JSON.stringify(body), result,
    ]);
  }

  // ── Demostración: simula la pantalla de Mercado Pago ────────────────
  if (provider instanceof DemoProvider) {
    app.get('/api/demo/preferences/:id', async (req, res) => {
      const pref = await provider.getPreference(String(req.params.id));
      if (!pref) throw new HttpError(404, 'No encontrado');
      res.json({ title: pref.title, amount: pref.amount, returnUrl: pref.return_url.replace(config.publicUrl, '') });
    });

    app.post('/api/demo/preferences/:id/pay', async (req, res) => {
      const outcome = S.demoOutcome.parse(req.body?.outcome);
      const pref = await provider.getPreference(String(req.params.id));
      if (!pref) throw new HttpError(404, 'No encontrado');
      const paymentId = await provider.simulatePayment(pref.id, outcome);
      // Igual que en producción: la plataforma avisa al servidor por su cuenta, un momento después.
      background(sleep(demoDelay).then(() => handlePaymentNotification(ctx, paymentId, 'demo:webhook')));
      const url = new URL(pref.return_url);
      url.searchParams.set('regreso', '1');
      res.json({ returnUrl: url.pathname + url.search });
    });
  }

  // ── Panel ──────────────────────────────────────────────────────────

  app.post('/api/admin/login', rateLimit(8, 5 * 60_000), (req, res) => {
    if (!passwordMatches(config, String(req.body?.password ?? ''))) throw new HttpError(401, 'Contraseña incorrecta.');
    setSession(config, res);
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(config, req), payments: provider.name, onlinePaymentReady: onlinePaymentReady(ctx) }));

  const admin = express.Router();
  admin.use(requireAdmin(config));
  app.use('/api/admin', admin);

  admin.get('/orders', async (req, res) => {
    const filter = S.orderFilter.parse(req.query.filter ?? 'activos');
    const rows = await listOrders(db, filter);
    res.json({ orders: await Promise.all(rows.map((o) => toAdmin(db, o))) });
  });
  admin.get('/summary', async (_req, res) => {
    const r = await db.one<{ nuevos: number; cotizar: number; revision: number }>(
      `select count(*) filter (where order_status = 'recibido')::int as nuevos,
              count(*) filter (where order_status = 'cotizando_envio')::int as cotizar,
              count(*) filter (where needs_review is not null or refund_status = 'pendiente')::int as revision
       from office.orders`,
    );
    res.json(r);
  });
  const orderOr404 = async (id: string) => {
    const o = await getOrderById(db, id);
    if (!o) throw new HttpError(404, 'Pedido no encontrado.');
    return o;
  };
  admin.get('/orders/:id', async (req, res) => res.json({ order: await toAdmin(db, await orderOr404(String(req.params.id))) }));
  admin.post('/orders/:id/status', async (req, res) => {
    const status = S.orderStatus.parse(req.body?.status);
    if (!ADMIN_FLOW.includes(status)) throw new HttpError(400, 'Estado no válido.');
    const before = await orderOr404(String(req.params.id));
    const row = await setOrderStatus(ctx, before.id, status, 'panel');
    if (status === 'entregado' && before.order_status !== 'entregado') background(stampClub(ctx, row));
    res.json({ order: await toAdmin(db, row) });
  });
  admin.post('/orders/:id/refund', async (req, res) => {
    const status = S.refundStatus.parse(req.body?.status);
    await orderOr404(String(req.params.id));
    res.json({ order: await toAdmin(db, await setRefundStatus(ctx, String(req.params.id), status, 'panel')) });
  });
  admin.post('/orders/:id/shipping', async (req, res) => {
    const { fee, etaText } = S.shippingQuote.parse(req.body);
    await orderOr404(String(req.params.id));
    res.json({ order: await toAdmin(db, await setShippingQuote(ctx, String(req.params.id), fee, etaText, 'panel')) });
  });
  admin.post('/orders/:id/delivery-photo', express.raw({ type: 'image/*', limit: '3mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Falta la foto.');
    await saveDeliveryPhoto(ctx, String(req.params.id), req.body, req.header('content-type') ?? '');
    res.json({ order: await toAdmin(db, (await getOrderById(db, String(req.params.id)))!) });
  });
  admin.get('/orders/:id/delivery-photo', async (req, res) => {
    const photo = await getDeliveryPhoto(db, String(req.params.id));
    if (!photo) throw new HttpError(404, 'Sin foto de entrega.');
    res.setHeader('Content-Type', photo.content_type);
    res.send(Buffer.from(photo.image));
  });
  admin.post('/orders/:id/tracking', async (req, res) => {
    await saveCourierLocation(ctx, String(req.params.id), S.courierLocationSchema.parse(req.body));
    res.json({ ok: true });
  });
  admin.post('/orders/:id/invoice', async (req, res) => {
    await orderOr404(String(req.params.id));
    res.json({ order: await toAdmin(db, await setInvoiceStatus(ctx, String(req.params.id), S.invoiceStatusSchema.parse(req.body?.status), 'panel')) });
  });
  admin.post('/orders/:id/collected', async (req, res) => {
    await orderOr404(String(req.params.id));
    res.json({ order: await toAdmin(db, await markCollected(ctx, String(req.params.id), 'panel')) });
  });
  admin.post('/orders/:id/review-clear', async (req, res) => {
    const o = await orderOr404(String(req.params.id));
    await db.query('update office.orders set needs_review = null, updated_at = now() where id = $1', [o.id]);
    res.json({ order: await toAdmin(db, (await getOrderById(db, o.id))!) });
  });
  admin.post('/orders/:id/reconcile', async (req, res) => {
    const o = await orderOr404(String(req.params.id));
    await reconcile(ctx, o, { force: true });
    res.json({ order: await toAdmin(db, (await getOrderById(db, o.id))!) });
  });
  if (provider instanceof DemoProvider) {
    admin.post('/demo/payments/:paymentId', async (req, res) => {
      const status = S.demoPaymentStatus.parse(req.body?.status);
      await provider.setPaymentStatus(String(req.params.paymentId), status);
      await handlePaymentNotification(ctx, String(req.params.paymentId), 'demo:webhook');
      res.json({ ok: true });
    });
  }

  // ── Notificaciones push de los dispositivos del negocio ──
  admin.get('/push', async (_req, res) => {
    const subs = await listSubscriptions(db);
    res.json({
      configured: pushConfigured(config),
      publicKey: config.vapidPublicKey,
      devices: subs.map((s) => ({ endpoint: s.endpoint, label: s.label, createdAt: iso(s.created_at), lastSuccessAt: s.last_success_at ? iso(s.last_success_at) : null })),
    });
  });
  admin.post('/push/subscribe', async (req, res) => {
    const { subscription, label } = S.pushSubscribeSchema.parse(req.body);
    await saveSubscription(db, subscription, label);
    res.json({ ok: true });
  });
  admin.post('/push/unsubscribe', async (req, res) => {
    await removeSubscription(db, S.pushEndpointSchema.parse(req.body).endpoint);
    res.json({ ok: true });
  });
  admin.post('/push/test', async (_req, res) => {
    res.json(await sendPushToAll(config, db, { title: '🍓 Prueba de Frésia Office', body: 'Así te llegarán los pedidos nuevos.', url: '/admin', tag: 'prueba' }));
  });

  admin.get('/catalog', async (_req, res) => res.json({ products: await store.listProducts(db), toppings: await store.listToppings(db), images: listImages() }));
  admin.put('/products/:id', async (req, res) => {
    const p = S.productSchema.parse(req.body);
    if (p.id !== req.params.id) throw new HttpError(400, 'El identificador no coincide.');
    if (p.combo) {
      const all = await store.listProducts(db);
      for (const slot of p.combo) {
        for (const o of slot.options) {
          const target = all.find((x) => x.id === o.productId);
          if (!target || target.combo || !target.sizes.some((z) => z.id === o.sizeId)) throw new HttpError(400, `Opción inválida en «${slot.label}».`);
        }
      }
    }
    await store.saveProduct(db, p);
    res.json({ ok: true });
  });
  admin.delete('/products/:id', async (req, res) => {
    await store.deleteProduct(db, String(req.params.id));
    res.json({ ok: true });
  });
  admin.put('/toppings/:id', async (req, res) => {
    const t = S.toppingSchema.parse(req.body);
    if (t.id !== req.params.id) throw new HttpError(400, 'El identificador no coincide.');
    await store.saveTopping(db, t);
    res.json({ ok: true });
  });
  admin.delete('/toppings/:id', async (req, res) => {
    await store.deleteTopping(db, String(req.params.id));
    res.json({ ok: true });
  });
  admin.get('/rules', async (_req, res) => res.json(await store.getRules(db)));
  admin.put('/rules', async (req, res) => {
    await store.setRules(db, S.rulesSchema.parse(req.body));
    res.json({ ok: true });
  });
  admin.get('/schedule', async (_req, res) => res.json(await store.getSchedule(db)));
  admin.put('/schedule', async (req, res) => {
    const s = S.scheduleSchema.parse(req.body);
    if (s.days.some((d) => d && d.close <= d.open)) throw new HttpError(400, 'La hora de cierre debe ser después de la de apertura.');
    await store.setSchedule(db, s);
    res.json({ ok: true });
  });

  // ── QR por edificio: escaneos, pedidos y ventas de cada uno ──
  admin.get('/qr-sources', async (_req, res) => {
    const rows = await db.query<{ slug: string; label: string; scans: number; orders: number; sales: number }>(
      `select s.slug, s.label,
         coalesce((select sum(count)::int from office.qr_scans q where q.source = s.slug), 0) as scans,
         coalesce((select count(*)::int from office.orders o where o.source = s.slug and o.order_status <> 'cancelado'), 0) as orders,
         coalesce((select sum(total)::int from office.orders o where o.source = s.slug and o.order_status = 'entregado'), 0) as sales
       from office.qr_sources s order by s.created_at`,
    );
    res.json({ sources: rows.map((r) => ({ ...r, url: `${config.publicUrl}/q/${r.slug}` })) });
  });
  admin.post('/qr-sources', async (req, res) => {
    const s = S.qrSourceSchema.parse(req.body);
    if (s.slug === 'volante') throw new HttpError(400, 'Ese nombre está reservado.');
    await db.query('insert into office.qr_sources (slug, label) values ($1, $2) on conflict (slug) do update set label = excluded.label', [s.slug, s.label]);
    res.json({ ok: true });
  });
  admin.delete('/qr-sources/:slug', async (req, res) => {
    await db.query('delete from office.qr_sources where slug = $1', [String(req.params.slug)]);
    res.json({ ok: true });
  });
  admin.get('/qr-sources/:slug/svg', async (req, res) => {
    const slug = String(req.params.slug).replace(/[^a-z0-9-]/g, '');
    const svg = await QRCode.toString(`${config.publicUrl}/q/${slug}`, { type: 'svg', margin: 1, color: { dark: '#3E2A25', light: '#FFFFFF' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  });

  admin.get('/delivery', async (_req, res) => res.json(await store.getDelivery(db)));
  admin.put('/delivery', async (req, res) => {
    const d = S.deliverySchema.parse(req.body);
    if ((d.prepMin == null) !== (d.prepMax == null)) throw new HttpError(400, 'Captura el tiempo de preparación completo (desde y hasta) o déjalo vacío.');
    if (d.zones.some((z) => z.etaMax < z.etaMin) || (d.prepMin != null && d.prepMax != null && d.prepMax < d.prepMin)) throw new HttpError(400, 'El tiempo máximo debe ser mayor o igual al mínimo.');
    if (!d.cashOnDelivery && (!d.onlinePayment || !onlinePaymentReady(ctx))) {
      throw new HttpError(400, onlinePaymentReady(ctx) ? 'Activa al menos un método de pago.' : 'Mientras no esté configurado Mercado Pago, deja activo el pago al recibir.');
    }
    await store.setDelivery(db, d);
    res.json({ ok: true });
  });
  admin.get('/business', async (_req, res) => res.json(await store.getBusiness(db)));
  admin.put('/business', async (req, res) => {
    await store.setBusiness(db, S.businessSchema.parse(req.body));
    res.json({ ok: true });
  });
  admin.get('/legal', async (_req, res) => res.json(await Promise.all(LEGAL.map((s) => store.getLegal(db, s)))));
  admin.put('/legal/:slug', async (req, res) => {
    const slug = req.params.slug as LegalSlug;
    if (!LEGAL.includes(slug)) throw new HttpError(404, 'No encontrado');
    await store.setLegal(db, { slug, ...S.legalSchema.parse(req.body) });
    res.json({ ok: true });
  });
  admin.get('/qr', async (_req, res) => {
    const url = `${config.publicUrl}/q/volante`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#3E2A25', light: '#FFFFFF' } });
    const scans = (await db.query<{ day: Date; source: string; count: number }>('select day, source, count from office.qr_scans order by day desc limit 30')).map((s) => ({ ...s, day: iso(s.day).slice(0, 10) }));
    res.json({ url, svg, scans });
  });
  admin.get('/system', async (_req, res) => {
    res.json({
      payments: provider.name,
      onlinePaymentReady: onlinePaymentReady(ctx),
      webhookSecret: Boolean(config.mpWebhookSecret),
      notifyWebhook: Boolean(config.notifyWebhookUrl),
      whatsapp: whatsappConfigured(config) ? config.whatsappProvider : '',
      publicUrl: config.publicUrl,
      httpsPublicUrl: config.publicUrl.startsWith('https://'),
      database: config.databaseUrl ? 'postgres' : 'pglite',
      lastWebhooks: (await db.query<{ at: Date; verified: boolean; result: string }>('select at, verified, result from office.webhook_log order by id desc limit 10')).map((w) => ({ ...w, at: iso(w.at) })),
    });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No encontrado')));

  // ── Archivos estáticos (producción) ────────────────────────────────
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message ?? 'Datos inválidos.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details as object) });
    if ((err as { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud inválida.' });
    if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
    console.error(err);
    res.status(500).json({ error: 'Algo salió mal. Intenta de nuevo.' });
  });

  return { app, ctx };
}

function listImages() {
  for (const dir of [resolve('public/images'), resolve('dist/images')]) {
    if (existsSync(dir)) return readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => `/images/${f}`);
  }
  return [];
}
