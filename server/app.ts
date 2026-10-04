import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';
import { ZodError } from 'zod';
import { openDb, iso } from './db';
import type { DB } from './db';
import type { Config } from './env';
import { HttpError } from './context';
import type { Ctx } from './context';
import { Notifier } from './notify';
import { DemoProvider } from './payments/demo';
import { MercadoPagoProvider, verifyMercadoPagoSignature } from './payments/mercadopago';
import { checkReturnedPayment, handlePaymentNotification, reconcile, startCheckout } from './payments/service';
import {
  createOrder, getOrderById, getOrderForCustomer, listOrders, markCollected, quoteOrder, setOrderStatus, setRefundStatus, setShippingQuote, toAdmin, toPublic,
} from './orders';
import * as store from './store';
import * as S from './schemas';
import { clearSession, isAdmin, passwordMatches, rateLimit, requireAdmin, setSession } from './auth';
import { whatsappConfigured } from './whatsapp';
import { background, sleep } from './background';
import type { LegalSlug, MenuResponse } from '../shared/types';
import { ADMIN_FLOW } from '../shared/status';

const LEGAL: LegalSlug[] = ['privacidad', 'entregas', 'cancelaciones'];

export async function createApp(config: Config, opts: { demoWebhookDelayMs?: number; db?: DB } = {}) {
  const db = opts.db ?? (await openDb({ url: config.databaseUrl || undefined, pglitePath: config.pglitePath, production: config.production }));
  await store.seedIfEmpty(db);
  const provider = config.mpAccessToken ? new MercadoPagoProvider(config.mpAccessToken) : new DemoProvider(db);
  const ctx: Ctx = { db, config, provider, notifier: new Notifier() };
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
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
    const [delivery, products, toppings, business, rules] = await Promise.all([
      store.getDelivery(db), store.listProducts(db), store.listToppings(db), store.getBusiness(db), store.getRules(db),
    ]);
    const { zones, ...rest } = delivery;
    const body: MenuResponse = {
      products,
      toppings,
      rules,
      business,
      delivery: { ...rest, zoneNames: zones.filter((z) => z.active).map((z) => z.name) },
      paymentsMode: provider.name,
    };
    res.json(body);
  });

  app.post('/api/coverage', rateLimit(60, 60_000), async (req, res) => {
    const input = S.coverageSchema.parse(req.body);
    res.json((await quoteOrder(db, { fulfillment: 'delivery', address: { ...input, street: '', number: '', office: '', references: '' }, items: [] })).delivery);
  });

  app.post('/api/quote', rateLimit(120, 60_000), async (req, res) => {
    res.json(await quoteOrder(db, S.quoteSchema.parse(req.body)));
  });

  app.post('/api/orders', rateLimit(20, 60_000), async (req, res) => {
    const { idempotencyKey, ...input } = S.orderSchema.parse(req.body);
    const { order, created } = await createOrder(ctx, idempotencyKey, {
      customer: input.customer,
      fulfillment: input.fulfillment,
      paymentMethod: input.paymentMethod,
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
    res.redirect(302, '/');
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
  app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(config, req), payments: provider.name }));

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
    await orderOr404(String(req.params.id));
    res.json({ order: await toAdmin(db, await setOrderStatus(ctx, String(req.params.id), status, 'panel')) });
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
  admin.get('/delivery', async (_req, res) => res.json(await store.getDelivery(db)));
  admin.put('/delivery', async (req, res) => {
    const d = S.deliverySchema.parse(req.body);
    if (d.zones.some((z) => z.etaMax < z.etaMin) || d.radiusEtaMax < d.radiusEtaMin) throw new HttpError(400, 'El tiempo máximo debe ser mayor o igual al mínimo.');
    if (!d.onlinePayment && !d.cashOnDelivery) throw new HttpError(400, 'Activa al menos un método de pago.');
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
