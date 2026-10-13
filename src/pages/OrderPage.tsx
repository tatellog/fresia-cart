import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useMenu } from '../lib/menu';
import { toLineInput, useCart } from '../lib/cart';
import { recentOrders } from '../lib/checkout';
import { formatDate, money, whatsappLink } from '../lib/format';
import { DemoBanner, Footer, Spinner, TopBar } from '../components/ui';
import { LineDetails, Totals } from './parts';
import { LiveTracking } from '../components/LiveTracking';
import { ClubCardView } from '../components/ClubCard';
import { slotLabel } from '../../shared/schedule';
import { CUSTOMER_CANCELABLE, PAYMENT_LABEL, REFUND_LABEL } from '../../shared/status';
import type { OrderStatus, PublicOrder } from '../../shared/types';
import { repeatLines } from '../../shared/repeat';

const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 20000;
const VERIFY_WINDOW_MS = 90_000;

export default function OrderPage() {
  const { number = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const returned = params.has('regreso') || params.has('payment_id') || params.has('collection_id');
  const { data: menu } = useMenu();
  const cart = useCart();
  const navigate = useNavigate();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  const fetchOrder = useCallback(async () => {
    const q = new URLSearchParams({ t: token });
    const pid = params.get('payment_id') ?? params.get('collection_id');
    if (pid) q.set('payment_id', pid);
    try {
      const r = await api<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(number)}?${q}`);
      setOrder(r.order);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'No encontramos este pedido. Revisa el enlace.' : (e as Error).message);
    }
    setNow(Date.now());
  }, [number, token, params]);

  const verifying = returned && order?.paymentStatus === 'sin_pagar' && now - startedAt.current < VERIFY_WINDOW_MS;
  const fast = verifying || order?.paymentStatus === 'pendiente' || order?.orderStatus === 'en_camino' || order?.orderStatus === 'en_preparacion';
  const finished = order && (order.orderStatus === 'entregado' || order.orderStatus === 'cancelado');

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);
  useEffect(() => {
    if (finished || error) return;
    const id = setTimeout(fetchOrder, fast ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearTimeout(id);
  }, [order, fast, finished, error, fetchOrder]);

  // Al confirmarse el pago (o guardarse para cotizar envío), vacía el carrito de este pedido.
  useEffect(() => {
    if (!order || !(order.paymentStatus === 'aprobado' || order.orderStatus === 'cotizando_envio')) return;
    const mine = recentOrders().find((o) => o.number === order.number);
    const items = JSON.stringify(cart.lines.map(toLineInput));
    if (mine?.cartFingerprint && cart.lines.length && mine.cartFingerprint.includes(items)) cart.clear();
  }, [order, cart]);

  /** Carga los mismos productos a TU carrito con los precios de hoy; avisa lo que ya no está. No cobra nada. */
  function repeat() {
    if (!menu) return;
    const r = repeatLines(order!.items, menu.products, menu.toppings, menu.rules);
    r.lines.forEach((l) => cart.add(l));
    navigate('/carrito', { state: { repeatNotes: r.notes } });
  }

  async function pay() {
    setPaying(true);
    setPayError(null);
    try {
      const r = await api<{ kind: 'redirect'; checkoutUrl: string } | { kind: 'already_paid' }>(`/api/orders/${number}/checkout`, { body: { t: token } });
      if (r.kind === 'already_paid') {
        await fetchOrder();
        setPaying(false);
      } else if (r.checkoutUrl.startsWith('/')) navigate(r.checkoutUrl);
      else window.location.assign(r.checkoutUrl);
    } catch (e) {
      setPayError((e as Error).message);
      setPaying(false);
      void fetchOrder();
    }
  }

  if (error) {
    return (
      <main className="page stack">
        <TopBar back="/" />
        <div className="notice error" role="alert">{error}</div>
      </main>
    );
  }
  if (!order) {
    return (
      <main className="page">
        <TopBar back="/" />
        <Spinner label="Cargando tu pedido…" />
      </main>
    );
  }

  const business = menu?.business;
  const wa = (text: string) => (business ? whatsappLink(business, text) : null);
  const status = headline(order, !!verifying);

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/" />

        <section className="card order-hero" aria-live="polite">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="eyebrow">Pedido {order.number}</span>
            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {order.demo && order.paymentMethod === 'online' && <span className="badge">Simulado</span>}
              <span className={`badge ${order.paymentStatus === 'aprobado' ? 'ok' : ['rechazado', 'cancelado'].includes(order.paymentStatus) ? 'example' : order.paymentStatus === 'por_cobrar' ? '' : 'warn'}`}>
                {PAYMENT_LABEL[order.paymentStatus]}
              </span>
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            {status.spinner && <span className="spinner" aria-hidden="true" style={{ marginTop: 6 }} />}
            <h1>{status.title}</h1>
          </div>
          <p className="muted" style={{ margin: 0 }}>{status.body}</p>
          <TimePromise order={order} />
          {(order.paymentStatus === 'aprobado' || (order.paymentMethod === 'contra_entrega' && order.orderStatus !== 'cotizando_envio' && order.orderStatus !== 'cancelado')) && (
            <Progress order={order} />
          )}

          {order.canPay && !verifying && (
            <button type="button" className="btn primary block" onClick={pay} disabled={paying}>
              {paying ? <Spinner label="Abriendo pago…" /> : order.paymentStatus === 'sin_pagar' ? `Pagar ${money(order.total!)}` : `Intentar de nuevo · ${money(order.total!)}`}
            </button>
          )}
          {payError && <div className="notice error" role="alert">{payError}</div>}

          {order.orderStatus === 'cotizando_envio' && (
            <WhatsAppButton
              href={wa(`Hola Frésia, hice el pedido ${order.number} y quiero confirmar el costo de envío a CP ${order.address?.postalCode ?? ''}.`)}
              label="Confirmar envío por WhatsApp"
              primary
            />
          )}
        </section>

        {order.orderStatus === 'en_camino' && order.fulfillment === 'delivery' && <LiveTracking number={order.number} token={token} />}

        {order.orderStatus === 'entregado' && order.deliveryPhotoAt && (
          <section className="card stack" aria-labelledby="proof-title">
            <h2 id="proof-title">📷 Foto de entrega</h2>
            <img
              src={`/api/orders/${encodeURIComponent(order.number)}/delivery-photo?t=${encodeURIComponent(token)}`}
              alt="Foto de tu pedido entregado"
              style={{ width: '100%', borderRadius: 'var(--radius-sm)', background: 'var(--cream)' }}
              loading="lazy"
            />
          </section>
        )}

        {order.orderStatus === 'entregado' && (
          <>
            <AfterDelivery order={order} onRepeat={repeat} canRepeat={!!menu} />
            <ClubCardView number={order.number} token={token} delivered />
          </>
        )}
        {order.orderStatus === 'cancelado' &&
          (order.groupName ? (
            <Link to={`/equipo/nuevo?nombre=${encodeURIComponent(order.groupName)}`} className="btn primary block">👥 Nuevo pedido de equipo «{order.groupName}»</Link>
          ) : (
            <button type="button" className="btn primary block" onClick={repeat} disabled={!menu}>🔁 Volver a pedirlo</button>
          ))}

        <section className="card review" aria-label="Tu pedido">
          <OrderSummary order={order} products={menu?.products ?? []} />
          <div className="review-row">
            <span className="icon" aria-hidden="true">{order.fulfillment === 'delivery' ? '🛵' : '🏪'}</span>
            <div className="grow">
              <strong>{order.address ? `${order.address.street} ${order.address.number}${order.address.office ? `, ${order.address.office}` : ''}` : 'Recoges en Frésia'}</strong>
              <p className="muted small" style={{ margin: 0 }}>
                {order.address ? `${order.address.colonia} · ` : business?.address ? `${business.address} · ` : ''}{order.customerName} · hecho el {formatDate(order.createdAt)}
              </p>
            </div>
          </div>
          {order.gift && (
            <div className="review-row">
              <span className="icon" aria-hidden="true">🎁</span>
              <div className="grow">
                <strong>Fresigrama para {order.gift.to}{order.gift.anonymous ? ' · anónimo' : ''}</strong>
                {order.gift.note && <p className="muted small" style={{ margin: 0 }}>«{order.gift.note}»</p>}
              </div>
            </div>
          )}
          {order.groupName && (
            <div className="review-row"><span className="icon" aria-hidden="true">👥</span><div className="grow"><strong>Pedido de equipo «{order.groupName}»</strong></div></div>
          )}
          {order.invoice && (
            <div className="review-row">
              <span className="icon" aria-hidden="true">🧾</span>
              <div className="grow">
                <strong>Factura {order.invoiceStatus === 'emitida' ? 'emitida' : 'solicitada'}</strong>
                <p className="muted small" style={{ margin: 0 }}>RFC {order.invoice.rfc} · se envía a {order.invoice.email}</p>
              </div>
            </div>
          )}
        </section>

        {!['cancelado', 'cotizando_envio', 'entregado'].includes(order.orderStatus) && (
          <ClubCardView number={order.number} token={token} delivered={false} />
        )}

        <section className="order-help" aria-label="Ayuda">
          {order.orderStatus !== 'cotizando_envio' && wa('') && (
            <a href={wa(`Hola Frésia, quiero consultar mi pedido ${order.number}.`)!} target="_blank" rel="noopener noreferrer" className="linkbtn">💬 ¿Dudas? Escríbenos por WhatsApp</a>
          )}
          {CUSTOMER_CANCELABLE.includes(order.orderStatus) && (
            <CancelOrder number={order.number} token={token} paid={order.paymentStatus === 'aprobado'} onDone={setOrder} />
          )}
          <p className="muted small" style={{ margin: 0 }}>Guarda esta página para ver el estado; solo quien tenga este enlace puede verla.</p>
          <Link to="/" className="linkbtn">Volver al menú</Link>
        </section>
        <Footer />
      </main>
    </>
  );
}

function WhatsAppButton({ href, label, primary }: { href: string | null; label: string; primary?: boolean }) {
  if (!href) {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <button type="button" className={`btn ${primary ? 'primary' : 'secondary'} block`} disabled>
          {label}
        </button>
        <p className="muted small" style={{ textAlign: 'center' }}>WhatsApp del negocio pendiente de configurar.</p>
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`btn ${primary ? 'primary' : 'secondary'} block`}>
      {label}
    </a>
  );
}

function headline(o: PublicOrder, verifying: boolean): { title: string; body: string; spinner?: boolean } {
  if (o.orderStatus === 'cancelado') {
    return {
      title: 'Pedido cancelado',
      body: o.paymentStatus === 'aprobado' || o.paymentStatus === 'devuelto' ? `Estado del reembolso: ${REFUND_LABEL[o.refundStatus]}.` : 'Este pedido no se cobró.',
    };
  }
  if (o.orderStatus === 'cotizando_envio') {
    return { title: 'Pedido guardado', body: 'Confirmaremos el costo de envío y te avisaremos. Podrás pagar desde esta página; aún no te cobramos nada.' };
  }
  if (o.paymentMethod === 'contra_entrega') {
    const when = o.fulfillment === 'pickup' ? 'al recoger (efectivo o tarjeta)' : 'en efectivo al recibir';
    const change = o.cashTendered != null && o.total != null && o.cashTendered > o.total ? ` Te llevamos ${money(o.cashTendered - o.total)} de cambio.` : '';
    return {
      title: o.orderStatus === 'entregado' ? '¡Entregado!' : o.orderStatus === 'recibido' ? 'Pedido recibido' : nextTitle(o.orderStatus),
      body: `${nextStep(o.orderStatus, o.fulfillment === 'delivery')} ${o.paymentStatus === 'aprobado' ? '' : `Pagas ${o.total != null ? money(o.total) : ''} ${when}.${change}`}`.trim(),
    };
  }
  switch (o.paymentStatus) {
    case 'aprobado':
      return { title: 'Pago recibido', body: nextStep(o.orderStatus, o.fulfillment === 'delivery') };
    case 'pendiente':
      return { title: 'Pago pendiente', body: 'Mercado Pago aún no confirma tu pago. Si pagaste en efectivo puede tardar un poco. Esta página se actualiza sola.', spinner: true };
    case 'rechazado':
      return { title: 'Tu pago no se completó', body: 'No se hizo ningún cargo. Puedes intentar de nuevo con otro medio de pago; tu pedido sigue guardado.' };
    case 'cancelado':
      return { title: 'Pago cancelado', body: 'No se hizo ningún cargo. Tu pedido sigue guardado por si quieres pagarlo.' };
    case 'devuelto':
      return { title: 'Pago devuelto', body: 'El pago fue devuelto a tu medio de pago.' };
    default:
      return verifying
        ? { title: 'Verificando tu pago…', body: 'Estamos confirmando con Mercado Pago. No cierres ni pagues de nuevo.', spinner: true }
        : { title: 'Pendiente de pago', body: 'Tu pedido está guardado. Completa el pago para que empecemos a prepararlo.' };
  }
}

function nextTitle(s: OrderStatus): string {
  return { confirmado: 'Pedido confirmado', en_preparacion: 'En preparación', listo: 'Listo', en_camino: 'En camino', entregado: 'Entregado' }[s as string] ?? 'Pedido recibido';
}

function nextStep(s: OrderStatus, delivery: boolean): string {
  switch (s) {
    case 'recibido':
      return 'Tu pedido nos llegó. En cuanto lo revisemos lo confirmaremos aquí.';
    case 'confirmado':
      return 'Confirmamos tu pedido. Pronto empezaremos a prepararlo.';
    case 'en_preparacion':
      return 'Estamos preparando tu pedido.';
    case 'listo':
      return delivery ? 'Tu pedido está listo y saldrá en breve.' : 'Tu pedido está listo. Puedes pasar por él.';
    case 'en_camino':
      return 'Tu pedido va en camino.';
    case 'entregado':
      return '¡Entregado! Gracias por tu pedido.';
    default:
      return '';
  }
}

function Progress({ order }: { order: PublicOrder }) {
  const delivery = order.fulfillment === 'delivery';
  const first = order.paymentMethod === 'contra_entrega' ? 'Pedido recibido' : 'Pago recibido';
  const steps: { key: OrderStatus; label: string }[] = [
    { key: 'recibido', label: first },
    { key: 'en_preparacion', label: 'En preparación' },
    delivery ? { key: 'en_camino', label: 'En camino' } : { key: 'listo', label: 'Listo para recoger' },
    { key: 'entregado', label: 'Entregado' },
  ];
  const rank: Record<string, number> = { recibido: 0, confirmado: 0, en_preparacion: 1, listo: 2, en_camino: 2, entregado: 3 };
  const current = rank[order.orderStatus] ?? 0;
  return (
    <div aria-label="Avance del pedido">
      <ol className="track">
        {steps.map((s, i) => {
          const state = i < current || order.orderStatus === 'entregado' ? 'done' : i === current ? 'done current' : 'todo';
          return (
            <li key={s.key} className={state} aria-current={i === current ? 'step' : undefined}>
              <span className="dot" aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Cancelar mientras no se empiece a preparar: pide confirmación en la misma página. */
function CancelOrder({ number, token, paid, onDone }: { number: string; token: string; paid: boolean; onDone: (o: PublicOrder) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(number)}/cancel`, { body: { t: token } });
      onDone(r.order);
    } catch (e) {
      setError((e as Error).message);
      setAsking(false);
    }
    setBusy(false);
  }
  if (!asking) {
    return (
      <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
        <button type="button" className="linkbtn danger" onClick={() => setAsking(true)}>Cancelar pedido</button>
        <p className="muted small" style={{ margin: 0 }}>Puedes cancelar mientras no empecemos a prepararlo.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <div className="notice warn stack" role="alertdialog" aria-labelledby="cancel-q">
      <p id="cancel-q"><strong>¿Cancelar el pedido {number}?</strong> {paid ? 'Te devolvemos tu pago por Mercado Pago.' : 'No se te cobra nada.'}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary small" onClick={cancel} disabled={busy}>{busy ? 'Cancelando…' : 'Sí, cancelar'}</button>
        <button type="button" className="btn ghost small" onClick={() => setAsking(false)} disabled={busy}>No, mantenerlo</button>
      </div>
    </div>
  );
}

const clock = (d: Date) => d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' });

/**
 * Qué tan firme es la hora: solicitada (aún no la confirmamos), confirmada (ya se está preparando
 * para esa hora) o una estimación en rango. Nunca una hora exacta sin un cálculo confiable.
 */
function TimePromise({ order: o }: { order: PublicOrder }) {
  if (['cancelado', 'entregado', 'cotizando_envio', 'esperando_pago'].includes(o.orderStatus)) return null;
  const delivery = o.fulfillment === 'delivery';
  if (o.scheduledFor) {
    const confirmed = ['en_preparacion', 'listo', 'en_camino'].includes(o.orderStatus);
    return (
      <div className="when-chip">
        {confirmed ? (
          <>✅ {delivery ? 'Entrega programada' : 'Recolección programada'}: <strong>{slotLabel(o.scheduledFor)}</strong></>
        ) : (
          <>
            🗓 Horario solicitado: <strong>{slotLabel(o.scheduledFor)}</strong>
            <span className="muted small" style={{ display: 'block' }}>Lo confirmamos cuando empecemos a prepararlo.</span>
          </>
        )}
      </div>
    );
  }
  const q = o.deliveryQuote;
  if (q.status === 'quoted' && q.etaText) {
    return <div className="when-chip">⏱ Estimación: <strong>{q.etaText}</strong> <span className="muted small">· puede variar</span></div>;
  }
  if (q.status === 'covered' && q.etaMin != null && q.etaMax != null) {
    const start = Date.parse(o.createdAt);
    const from = new Date(start + q.etaMin * 60_000);
    const to = new Date(start + q.etaMax * 60_000);
    return (
      <div className="when-chip">
        ⏱ Estimación de {delivery ? 'llegada' : 'entrega'}: <strong>entre {clock(from)} y {clock(to)}</strong>
        <span className="muted small" style={{ display: 'block' }}>Es un cálculo aproximado; te avisamos aquí si cambia.</span>
      </div>
    );
  }
  return null;
}

/** Qué se pidió y cuánto se paga, a la vista: tamaño, toppings/extras, cantidades y para quién. */
function OrderSummary({ order, products }: { order: PublicOrder; products: { id: string; image: string }[] }) {
  const team = !!order.groupName;
  const groups = new Map<string, typeof order.items>();
  order.items.forEach((l) => {
    const who = team ? l.forWhom || 'Sin nombre' : '';
    groups.set(who, [...(groups.get(who) ?? []), l]);
  });
  return (
    <div className="order-summary">
      {[...groups].map(([who, lines]) => (
        <div key={who || '_'} className="sum-group">
          {who && (
            <p className="sum-who">
              👤 {who} <span className="muted small">· {money(lines.reduce((s, l) => s + l.lineTotal, 0))}</span>
            </p>
          )}
          {lines.map((l, i) => {
            const img = products.find((p) => p.id === l.productId)?.image;
            return (
              <div key={i} className="sum-line">
                {img ? <img src={img} alt="" width={44} height={44} /> : <span />}
                <div className="grow">
                  <strong>{l.qty}× {l.name}</strong>
                  {!l.choices && <span className="muted"> · {l.sizeLabel}</span>}
                  <LineDetails line={team ? { ...l, forWhom: '' } : l} />
                </div>
                <span className="price">{money(l.lineTotal)}</span>
              </div>
            );
          })}
        </div>
      ))}
      <Totals subtotal={order.subtotal} shippingFee={order.shippingFee} total={order.total} fulfillment={order.fulfillment} />
      {order.paymentMethod === 'contra_entrega' && order.paymentStatus !== 'aprobado' && order.total != null && (
        <p className="small" style={{ margin: 0 }}>
          💵 Pagas {money(order.total)} {order.fulfillment === 'pickup' ? 'al recoger' : 'al recibir'}
          {order.cashTendered != null && order.cashTendered > order.total ? ` · llevamos ${money(order.cashTendered - order.total)} de cambio` : ''}.
        </p>
      )}
    </div>
  );
}

/**
 * Después de entregar (momento de alta intención): repetir, y compartir con el equipo.
 * Una sola tarjeta; Frésia Club va justo debajo con los sellos.
 */
function AfterDelivery({ order, onRepeat, canRepeat }: { order: PublicOrder; onRepeat: () => void; canRepeat: boolean }) {
  const [shared, setShared] = useState(false);
  const link = `${window.location.origin}/?utm_source=referido&utm_medium=pedido&utm_campaign=post-entrega`;
  async function share() {
    const text = '🍓 Pedimos fresas con crema de Frésia a la oficina. Cada quien elige lo suyo y llega todo junto:';
    if (navigator.share) await navigator.share({ title: 'Frésia Office', text, url: link }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(`${text} ${link}`).catch(() => undefined);
      setShared(true);
    }
  }
  return (
    <section className="card stack after-delivery" aria-labelledby="after-title">
      <h2 id="after-title">¿Se antoja otra vez?</h2>
      {order.groupName ? (
        <Link to={`/equipo/nuevo?nombre=${encodeURIComponent(order.groupName)}`} className="btn primary block">👥 Nuevo pedido de equipo «{order.groupName}»</Link>
      ) : (
        <button type="button" className="btn primary block" onClick={onRepeat} disabled={!canRepeat}>🔁 Repetir este pedido</button>
      )}
      <button type="button" className="linkbtn" style={{ justifySelf: 'center' }} onClick={share}>
        {shared ? '✓ Enlace copiado' : '📣 Comparte Frésia Office con tu equipo'}
      </button>
    </section>
  );
}

