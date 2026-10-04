import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useMenu } from '../lib/menu';
import { toLineInput, useCart } from '../lib/cart';
import { recentOrders } from '../lib/checkout';
import { formatDate, money, whatsappLink } from '../lib/format';
import { DemoBanner, Footer, Spinner, TopBar } from '../components/ui';
import { OrderLines, Totals } from './parts';
import { PAYMENT_LABEL, REFUND_LABEL } from '../../shared/status';
import type { OrderStatus, PublicOrder } from '../../shared/types';

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
  const fast = verifying || order?.paymentStatus === 'pendiente';
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

        <section className="stack" style={{ gap: 8 }} aria-live="polite">
          <p className="muted small">Pedido</p>
          <p className="big-number">{order.number}</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className={`badge ${order.paymentStatus === 'aprobado' ? 'ok' : ['rechazado', 'cancelado'].includes(order.paymentStatus) ? 'example' : order.paymentStatus === 'por_cobrar' ? '' : 'warn'}`}>
              {PAYMENT_LABEL[order.paymentStatus]}
            </span>
            {order.demo && <span className="badge">Demostración · sin cobro real</span>}
          </div>
        </section>

        <section className="card stack">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {status.spinner && <span className="spinner" aria-hidden="true" style={{ marginTop: 4 }} />}
            <div className="stack" style={{ gap: 6 }}>
              <h1 style={{ fontSize: '1.35rem' }}>{status.title}</h1>
              <p className="muted">{status.body}</p>
            </div>
          </div>

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

        {(order.paymentStatus === 'aprobado' || (order.paymentMethod === 'contra_entrega' && order.orderStatus !== 'cotizando_envio' && order.orderStatus !== 'cancelado')) && (
          <Progress order={order} />
        )}

        <section className="card stack" aria-labelledby="sum-title">
          <h2 id="sum-title">Resumen</h2>
          <OrderLines lines={order.items} products={menu?.products ?? []} />
          <Totals subtotal={order.subtotal} shippingFee={order.shippingFee} total={order.total} fulfillment={order.fulfillment} />
        </section>

        <section className="card flat stack" aria-labelledby="dl-title">
          <h2 id="dl-title">{order.fulfillment === 'delivery' ? 'Entrega' : 'Recoger en Frésia'}</h2>
          <p>{order.customerName}</p>
          {order.address ? (
            <p className="muted">
              {order.address.street} {order.address.number}, {order.address.office}
              <br />
              {order.address.colonia}, CP {order.address.postalCode}
            </p>
          ) : (
            <p className="muted">{business?.address}</p>
          )}
          {order.deliveryQuote.status === 'quoted' && <p className="small">Tiempo estimado: {order.deliveryQuote.etaText}</p>}
          <p className="muted small">Hecho el {formatDate(order.createdAt)}</p>
        </section>

        {order.orderStatus !== 'cotizando_envio' && (
          <div className="stack" style={{ gap: 8 }}>
            <WhatsAppButton href={wa(`Hola Frésia, quiero consultar mi pedido ${order.number}.`)} label="Consultar mi pedido por WhatsApp" />
            <p className="muted small" style={{ textAlign: 'center' }}>
              Opcional. {order.paymentStatus === 'aprobado' || order.paymentMethod === 'contra_entrega' ? 'Tu pedido ya nos llegó; no necesitas escribirnos.' : ''}
            </p>
          </div>
        )}

        <p className="muted small">Guarda esta página para consultar el estado. Solo quien tenga este enlace puede verla.</p>
        <Link to="/" className="btn secondary block">Volver al menú</Link>
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
      title: o.paymentStatus === 'aprobado' ? 'Pagado' : o.orderStatus === 'recibido' ? 'Pedido recibido' : nextTitle(o.orderStatus),
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
  const steps: { key: OrderStatus; label: string }[] = [
    { key: 'recibido', label: order.paymentMethod === 'contra_entrega' ? 'Pedido recibido' : 'Pago recibido' },
    { key: 'confirmado', label: 'Pedido confirmado' },
    { key: 'en_preparacion', label: 'En preparación' },
    delivery ? { key: 'en_camino', label: 'En camino' } : { key: 'listo', label: 'Listo para recoger' },
    { key: 'entregado', label: 'Entregado' },
  ];
  const order_ = ['recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado'];
  const current = order_.indexOf(order.orderStatus);
  return (
    <section className="card" aria-label="Avance del pedido">
      <ol className="timeline">
        {steps.map((s) => {
          const idx = order_.indexOf(s.key);
          const state = idx < current || (idx === current && s.key === 'entregado') ? 'done' : idx === current ? 'done current' : idx < current ? 'done' : 'todo';
          return (
            <li key={s.key} className={state} aria-current={idx === current ? 'step' : undefined}>
              <span className="dot" aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
