import { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../shared/types';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toLineInput, useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { idempotencyKeyFor, readCheckoutForm, rememberOrder, resetIdempotencyKey, useCheckoutForm } from '../lib/checkout';
import { api, ApiError } from '../lib/api';
import { money } from '../lib/format';
import { CheckoutSteps, DemoBanner, LoadError, Spinner, StickyAction, TopBar } from '../components/ui';
import { InvoiceFields, emptyInvoice } from '../components/InvoiceFields';
import { WhenPicker } from '../components/WhenPicker';
import { currentSource } from '../lib/source';
import { attribution } from '../lib/analytics';
import { groupCheckout, setActiveGroup, setGroupCheckout } from '../lib/groupState';
import { load as loadStored, save } from '../lib/storage';
import { invoiceErrors } from '../../shared/invoice';
import type { InvoiceData } from '../../shared/invoice';
import { isOpenAt } from '../../shared/schedule';
import { validate } from './DeliveryPage';
import { prepText, quoteEtaText } from '../../shared/coverage';
import type { GiftInfo, PublicOrder, Quote } from '../../shared/types';
import { GiftFields, GIFT_KEY, emptyGift } from '../components/GiftFields';
import { OrderLines, Totals } from './parts';

type CreateRes = { number: string; token: string; order: PublicOrder };
type CheckoutRes = { kind: 'redirect'; checkoutUrl: string } | { kind: 'already_paid' };

export default function SummaryPage() {
  const cart = useCart();
  const { data } = useMenu();
  const navigate = useNavigate();
  const form = useMemo(readCheckoutForm, []);
  const [, setStoredForm] = useCheckoutForm();
  const [method, setMethodState] = useState<PaymentMethod>(form.paymentMethod ?? 'online');
  // Con cuánto paga se elige en CADA pedido (no se recuerda): el total cambia y el repartidor debe llevar el cambio correcto.
  const [cash, setCash] = useState<number | 'exacto' | null>(null);
  const [cashOther, setCashOther] = useState('');
  // «Otro monto» solo aparece si el cliente lo pide (o si ya había escrito uno).
  const [showOther, setShowOther] = useState(false);
  const setMethod = (m: PaymentMethod) => {
    setMethodState(m);
    setStoredForm((f) => ({ ...f, paymentMethod: m }));
  };
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pedido de equipo: los productos los arma el servidor desde el grupo.
  const group = useMemo(groupCheckout, []);
  const items = useMemo(() => (group ? [] : cart.lines.map(toLineInput)), [cart.lines, group]);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [wantInvoice, setWantInvoiceState] = useState(() => loadStored<boolean>('fo.invoice.on.v1', false));
  const [invoice, setInvoiceState] = useState<InvoiceData>(() => loadStored<InvoiceData>('fo.invoice.v1', emptyInvoice));
  const [invoiceTried, setInvoiceTried] = useState(false);
  const setWantInvoice = (v: boolean) => { setWantInvoiceState(v); save('fo.invoice.on.v1', v); };
  const setInvoice = (v: InvoiceData) => { setInvoiceState(v); save('fo.invoice.v1', v); };
  // Fresigrama: regalo con tarjeta (solo a domicilio, no en pedido de equipo).
  const giftAllowed = !!data?.features?.fresigrama && form.fulfillment === 'delivery' && !group;
  const [gift, setGiftState] = useState<GiftInfo & { on: boolean }>(() => loadStored(GIFT_KEY, emptyGift));
  const setGift = (g: GiftInfo & { on: boolean }) => { setGiftState(g); save(GIFT_KEY, g); };
  const isGift = giftAllowed && gift.on;
  const [giftTried, setGiftTried] = useState(false);
  const giftInvalid = isGift && gift.to.trim().length < 2;
  const invoiceInvalid = wantInvoice && Object.keys(invoiceErrors(invoice)).length > 0;
  const address = form.fulfillment === 'delivery' ? { ...form.address, postalCode: form.address.postalCode.trim(), location: form.address.location ?? null } : null;
  const formInvalid = Object.keys(validate(form)).length > 0;

  const load = () => {
    setLoadError(null);
    api<Quote>('/api/quote', { body: { fulfillment: form.fulfillment, address, items, gift: isGift, group: group ? { code: group.code, token: group.token } : null } }).then(
      setQuote,
      (e: Error) => setLoadError(e.message),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [items, isGift]);

  if (cart.lines.length === 0 && !group) return <Navigate to="/carrito" replace />;
  if (formInvalid) return <Navigate to="/entrega" replace />;

  const manual = quote?.delivery.status === 'manual';
  const online = data?.delivery.onlinePayment ?? true;
  const cod = data?.delivery.cashOnDelivery ?? false;
  const effective: PaymentMethod = !cod ? 'online' : !online ? 'contra_entrega' : method;
  const payLater = effective === 'contra_entrega';
  const cashDelivery = payLater && form.fulfillment === 'delivery' && !manual;
  const total = quote?.total ?? null;
  const cashValue = cash === 'exacto' ? total : cash;
  const cashInvalid = cashDelivery && (cashValue == null || (total != null && cashValue < total));
  const closedNow = data ? !isOpenAt(new Date(), data.schedule) : false;
  const needsSlot = closedNow && !scheduledFor;
  const blocked = !quote || quote.errors.length > 0 || cashInvalid || needsSlot;

  async function submit() {
    if (!quote || busy) return;
    setBusy(true);
    setError(null);
    if (giftInvalid) {
      setGiftTried(true);
      setBusy(false);
      document.getElementById('gift-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (invoiceInvalid) {
      setInvoiceTried(true);
      setBusy(false);
      document.getElementById('invoice-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const body = {
      source: currentSource(),
      attribution: attribution(),
      invoice: wantInvoice ? invoice : null,
      gift: isGift ? { to: gift.to.trim(), note: gift.note.trim(), anonymous: gift.anonymous } : null,
      scheduledFor,
      group: group ? { code: group.code, token: group.token } : null,
      customer: { name: form.name.trim(), phone: form.phone },
      fulfillment: form.fulfillment,
      paymentMethod: effective,
      cashTendered: cashDelivery ? cashValue : null,
      address,
      notes: form.notes.trim(),
      items,
    };
    const fingerprint = JSON.stringify(body);
    try {
      let created: CreateRes;
      try {
        created = await api<CreateRes>('/api/orders', { body: { ...body, idempotencyKey: idempotencyKeyFor(fingerprint) } });
      } catch (e) {
        if (e instanceof ApiError && e.body.code === 'idempotency_mismatch') {
          resetIdempotencyKey();
          created = await api<CreateRes>('/api/orders', { body: { ...body, idempotencyKey: idempotencyKeyFor(fingerprint) } });
        } else throw e;
      }
      if (isGift) setGift(emptyGift);
      rememberOrder({ number: created.number, token: created.token, at: new Date().toISOString(), cartFingerprint: fingerprint, groupName: group?.name ?? null });
      if (group) {
        setGroupCheckout(null);
        setActiveGroup(null);
      }

      if (!created.order.canPay) {
        navigate(`/pedido/${created.number}?t=${created.token}`);
        return;
      }
      const co = await api<CheckoutRes>(`/api/orders/${created.number}/checkout`, { body: { t: created.token } });
      if (co.kind === 'already_paid') navigate(`/pedido/${created.number}?t=${created.token}`);
      else if (co.checkoutUrl.startsWith('/')) navigate(co.checkoutUrl);
      else window.location.assign(co.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal.');
      setBusy(false);
    }
  }

  const products = data?.products ?? [];
  const pieces = quote?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/entrega" />
        <CheckoutSteps current="pago" />
        <h1>Confirma tu pedido</h1>

        {loadError && <LoadError message={loadError} retry={load} />}
        {!quote && !loadError && <Spinner label="Calculando total…" />}

        {quote && (
          <>
            {quote.errors.length > 0 && (
              <div className="notice error stack" role="alert">
                {quote.errors.map((e) => <p key={e}>{e}</p>)}
                <Link to="/carrito" className="btn secondary small">Corregir carrito</Link>
              </div>
            )}

            {group && <GroupBreakdown lines={quote.lines} name={group.name} />}

            <section className="card review" aria-label="Tu pedido">
              <details className="review-items">
                <summary>
                  <span className="thumbs" aria-hidden="true">
                    {quote.lines.slice(0, 4).map((l, i) => {
                      const img = products.find((p) => p.id === l.productId)?.image;
                      return img ? <img key={i} src={img} alt="" width={36} height={36} /> : null;
                    })}
                  </span>
                  <span className="grow">
                    <strong>{pieces} producto{pieces === 1 ? '' : 's'}</strong>
                    <span className="muted small"> · ver detalle</span>
                  </span>
                  <span className="price">{money(quote.subtotal)}</span>
                </summary>
                <OrderLines lines={quote.lines} products={products} />
                <Link to={group ? `/equipo/${group.code}` : '/carrito'} className="linkbtn small">Editar productos</Link>
              </details>
              <div className="review-row">
                <span className="icon" aria-hidden="true">{form.fulfillment === 'delivery' ? '🛵' : '🏪'}</span>
                <div className="grow">
                  <strong>{form.fulfillment === 'delivery' ? `${form.address.street} ${form.address.number}${form.address.office ? `, ${form.address.office}` : ''}` : 'Recoges en Frésia'}</strong>
                  <p className="muted small" style={{ margin: 0 }}>
                    {form.fulfillment === 'delivery' ? `${form.address.colonia} · ` : ''}{form.name} · {form.phone}
                    {quote.delivery.status === 'covered' && quoteEtaText(quote.delivery) ? ` · aprox. ${quoteEtaText(quote.delivery)}` : ''}
                    {quote.delivery.status === 'pickup' && data && prepText(data.delivery) ? ` · aprox. ${prepText(data.delivery)}` : ''}
                  </p>
                  {form.notes && <p className="muted small" style={{ margin: 0 }}>Nota: {form.notes}</p>}
                </div>
                <Link to="/entrega" className="linkbtn small">Editar</Link>
              </div>
            </section>

            {data && (
              <section className="card form-card">
              <WhenPicker
                schedule={data.schedule}
                value={scheduledFor}
                onChange={setScheduledFor}
                asapLabel={
                  form.fulfillment === 'pickup'
                    ? prepText(data.delivery) ? `Estimado: listo en ${prepText(data.delivery)}` : 'Lo antes posible'
                    : quote.delivery.status === 'covered'
                      ? quoteEtaText(quote.delivery) ? `Estimado: ${quoteEtaText(quote.delivery)} aprox.` : 'Lo antes posible'
                      : 'En cuanto confirmemos el envío'
                }
              />
              </section>
            )}

            {giftAllowed && <GiftFields value={gift} onChange={setGift} showErrors={giftTried} />}

            <section className="stack" aria-labelledby="invoice-title">
              <label className="option">
                <input type="checkbox" checked={wantInvoice} onChange={(e) => setWantInvoice(e.target.checked)} />
                <span className="mark" aria-hidden="true" />
                <span className="grow">
                  <strong id="invoice-title">🧾 Necesito factura</strong>
                  <span className="muted small" style={{ display: 'block' }}>Para gastos de la empresa (CFDI 4.0).</span>
                </span>
              </label>
              {wantInvoice && <InvoiceFields value={invoice} onChange={setInvoice} showErrors={invoiceTried} />}
            </section>

            <section className="card form-card" aria-labelledby="pay-title">
            <h2 id="pay-title">¿Cómo pagas?</h2>
            {online && cod ? (
              <fieldset>
                <legend className="sr-only">Forma de pago</legend>
                <div className="segmented fulfill">
                  <label className="option">
                    <input type="radio" name="pay" checked={effective === 'online'} onChange={() => setMethod('online')} />
                    <span className="icon" aria-hidden="true">💳</span>
                    <strong>En línea</strong>
                    <span className="muted small">Tarjeta, saldo Mercado Pago u OXXO</span>
                  </label>
                  <label className="option">
                    <input type="radio" name="pay" checked={effective === 'contra_entrega'} onChange={() => setMethod('contra_entrega')} />
                    <span className="icon" aria-hidden="true">💵</span>
                    <strong>{form.fulfillment === 'pickup' ? 'Al recoger' : 'Efectivo al recibir'}</strong>
                    <span className="muted small">
                      {form.fulfillment === 'pickup' ? 'Efectivo o tarjeta en Frésia' : 'Al repartidor; no lleva terminal'}
                      {data?.delivery.cashOnDeliveryNote && ` · ${data.delivery.cashOnDeliveryNote}`}
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{effective === 'online' ? '💳 En línea con Mercado Pago: tarjeta, saldo u OXXO.' : form.fulfillment === 'pickup' ? '💵 Pagas al recoger en Frésia.' : '💵 Pagas en efectivo al recibir.'}</p>
            )}

            {cashDelivery && total != null && (
              <fieldset className="stack" style={{ gap: 10 }}>
                <legend className="choice-legend">
                  <span>¿Con cuánto vas a pagar?</span>
                  <span className={`req${cashValue != null && cashValue >= total ? ' done' : ''}`}>{cashValue != null && cashValue >= total ? '✓ Listo' : 'Obligatorio'}</span>
                </legend>
                <p className="muted small" style={{ margin: '-6px 0 0' }}>Así el repartidor lleva el cambio exacto.</p>
                <div className="tabs" role="group" aria-label="Billete con el que pagas">
                  <button type="button" aria-pressed={cash === 'exacto'} onClick={() => { setShowOther(false); setCash('exacto'); }}>Exacto</button>
                  {bills(total).map((b) => (
                    <button key={b} type="button" aria-pressed={cash === b} onClick={() => { setShowOther(false); setCash(b); }}>{money(b)}</button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={cash !== null && cash !== 'exacto' && !bills(total).includes(cash)}
                    onClick={() => { setShowOther(true); setCash(cashOther ? Math.round(parseFloat(cashOther) * 100) || null : null); }}
                  >
                    Otro
                  </button>
                </div>
                {(showOther || (typeof cash === 'number' && !bills(total).includes(cash))) && cash !== 'exacto' && (cash === null || !bills(total).includes(cash)) && (
                  <div className="field" style={{ maxWidth: 220 }}>
                    <label htmlFor="cash-other">Otro monto</label>
                    <input
                      id="cash-other"
                      className="input"
                      inputMode="decimal"
                      placeholder={`Mínimo ${money(total)}`}
                      value={cashOther}
                      onChange={(e) => {
                        setCashOther(e.target.value);
                        const v = Math.round(parseFloat(e.target.value.replace(/[$,\s]/g, '')) * 100);
                        setCash(Number.isFinite(v) ? v : null);
                      }}
                    />
                  </div>
                )}
                {cashValue != null && total != null && cashValue >= total && (
                  <p className="small" role="status">{cashValue > total ? `Te llevamos ${money(cashValue - total)} de cambio.` : 'Pagas con el monto exacto.'}</p>
                )}
                {cashValue != null && total != null && cashValue < total && <p className="error-text">Debe ser al menos {money(total)}.</p>}
              </fieldset>
            )}
            {!manual && !payLater && (
              <p className="secure-note">
                🔒 <span>Continuarás a <strong>Mercado Pago</strong> para pagar de forma segura. Frésia no recibe ni guarda los datos de tu tarjeta.</span>
              </p>
            )}
            {!manual && !payLater && data?.paymentsMode === 'demo' && <p className="small" style={{ margin: 0 }}><strong>Demostración: no se realizan cobros.</strong> Verás un simulador en lugar de Mercado Pago.</p>}
            </section>

            {manual ? (
              <div className="notice warn stack">
                <p>
                  <strong>Necesitamos confirmar el costo de envío.</strong> {quote.delivery.status === 'manual' && quote.delivery.reason}
                </p>
                <p>
                  Guardaremos tu pedido sin cobrarte.{' '}
                  {payLater ? 'Cuando confirmemos el envío lo empezaremos a preparar.' : 'Cuando confirmemos el envío podrás pagarlo desde la página de tu pedido.'}
                </p>
              </div>
            ) : null}

            <div className="pay-total">
              <Totals subtotal={quote.subtotal} shippingFee={quote.shippingFee} total={quote.total} fulfillment={form.fulfillment} />
              {payLater && !manual && (
                <p className="small" style={{ margin: 0 }}>
                  {form.fulfillment === 'pickup' ? 'Pagas al recoger.' : 'Pagas en efectivo al recibir.'}{' '}
                  {isGift ? 'El repartidor te cobra a ti primero y después entrega el regalo.' : 'Tu pedido entra a la cocina en cuanto lo confirmes.'}
                </p>
              )}
              <p className="muted small" style={{ margin: 0 }}>
                Al continuar aceptas el <Link to="/legal/privacidad">aviso de privacidad</Link> y las políticas de{' '}
                <Link to="/legal/entregas">entrega</Link> y <Link to="/legal/cancelaciones">cancelación</Link>.
              </p>
            </div>

            {error && <div className="notice error" role="alert">{error}</div>}
          </>
        )}
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" onClick={submit} disabled={blocked || busy} aria-busy={busy}>
          {busy ? (
            <Spinner label={manual || payLater ? 'Guardando pedido…' : 'Preparando pago…'} />
          ) : manual ? (
            'Enviar pedido y confirmar envío'
          ) : cashDelivery && cashValue == null ? (
            'Elige con cuánto pagas'
          ) : payLater ? (
            <>{isGift ? 'Enviar bombón' : 'Confirmar pedido'} · {quote?.total != null ? money(quote.total) : ''}</>
          ) : (
            <>{isGift ? 'Pagar y enviar bombón' : 'Pagar'} {quote?.total != null ? money(quote.total) : ''}</>
          )}
        </button>
      </StickyAction>
    </>
  );
}

/** Billetes probables con los que se paga un total: siguiente múltiplo de 100, 200, 500 y 1,000. */
function bills(total: number): number[] {
  const out = new Set<number>();
  for (const step of [10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

/** Pedido de equipo: quién lleva qué y cuánto, y que paga quien organiza. */
function GroupBreakdown({ lines, name }: { lines: { forWhom?: string; qty: number; lineTotal: number }[]; name: string }) {
  const people = new Map<string, { pieces: number; total: number }>();
  for (const l of lines) {
    const who = l.forWhom?.trim() || 'Sin nombre';
    const p = people.get(who) ?? { pieces: 0, total: 0 };
    people.set(who, { pieces: p.pieces + l.qty, total: p.total + l.lineTotal });
  }
  return (
    <section className="card stack" aria-labelledby="team-title">
      <h2 id="team-title">👥 {name}</h2>
      <p className="small"><strong>Tú pagas el pedido de todo el equipo</strong> en un solo pago, con el envío incluido.</p>
      <ul className="people">
        {[...people].map(([who, p]) => (
          <li key={who} className="done">
            <span>{who}</span>
            <span className="small">{p.pieces} pieza{p.pieces === 1 ? '' : 's'} · {money(p.total)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Al confirmar, el pedido del equipo queda cerrado y nadie más puede agregar ni quitar productos.</p>
    </section>
  );
}
