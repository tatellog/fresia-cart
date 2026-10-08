import { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../shared/types';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toLineInput, useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { idempotencyKeyFor, readCheckoutForm, rememberOrder, resetIdempotencyKey, useCheckoutForm } from '../lib/checkout';
import { api, ApiError } from '../lib/api';
import { money } from '../lib/format';
import { DemoBanner, LoadError, Spinner, StickyAction, TopBar } from '../components/ui';
import { InvoiceFields, emptyInvoice } from '../components/InvoiceFields';
import { WhenPicker } from '../components/WhenPicker';
import { currentSource } from '../lib/source';
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
  const [cash, setCashState] = useState<number | 'exacto' | null>(form.cashTendered ?? null);
  const [cashOther, setCashOther] = useState('');
  const setCash = (c: number | 'exacto' | null) => {
    setCashState(c);
    setStoredForm((f) => ({ ...f, cashTendered: c }));
  };
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
  const giftAllowed = form.fulfillment === 'delivery' && !group;
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
      rememberOrder({ number: created.number, token: created.token, at: new Date().toISOString(), cartFingerprint: fingerprint });
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

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/entrega" step="Resumen" />
        <h1>Revisa tu pedido</h1>

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

            <section className="card stack" aria-labelledby="items-title">
              <div className="row between">
                <h2 id="items-title">Productos</h2>
                <Link to="/carrito" className="linkbtn">Editar</Link>
              </div>
              <OrderLines lines={quote.lines} products={products} />
            </section>

            <section className="card stack" aria-labelledby="del-title">
              <div className="row between">
                <h2 id="del-title">{form.fulfillment === 'delivery' ? 'Entrega a domicilio' : 'Recoger en Frésia'}</h2>
                <Link to="/entrega" className="linkbtn">Editar</Link>
              </div>
              <p>
                {form.name} · {form.phone}
              </p>
              {form.fulfillment === 'delivery' ? (
                <p className="muted">
                  {form.address.street} {form.address.number}, {form.address.office}
                  <br />
                  {form.address.colonia}, CP {form.address.postalCode}
                  {form.address.references && (
                    <>
                      <br />
                      {form.address.references}
                    </>
                  )}
                </p>
              ) : (
                <p className="muted">{data?.business.address}</p>
              )}
              {quote.delivery.status === 'covered' && quoteEtaText(quote.delivery) && (
                <p className="small">Tiempo estimado: {quoteEtaText(quote.delivery)} después de confirmar {payLater ? 'tu pedido' : 'el pago'}.</p>
              )}
              {quote.delivery.status === 'pickup' && data && prepText(data.delivery) && (
                <p className="small">Preparación: {prepText(data.delivery)}.</p>
              )}
              {form.notes && <p className="small muted">Notas: {form.notes}</p>}
            </section>

            <Totals subtotal={quote.subtotal} shippingFee={quote.shippingFee} total={quote.total} fulfillment={form.fulfillment} />

            {data && (
              <WhenPicker
                schedule={data.schedule}
                value={scheduledFor}
                onChange={setScheduledFor}
                asapLabel={
                  form.fulfillment === 'pickup'
                    ? prepText(data.delivery) ? `Listo en ${prepText(data.delivery)}` : 'Lo antes posible'
                    : quote.delivery.status === 'covered'
                      ? quoteEtaText(quote.delivery) ? `Llega en ${quoteEtaText(quote.delivery)}` : 'Lo antes posible'
                      : 'En cuanto confirmemos el envío'
                }
              />
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

            {online && cod && (
              <fieldset>
                <legend className="label" style={{ marginBottom: 10 }}>¿Cómo quieres pagar?</legend>
                <div className="options">
                  <label className="option">
                    <input type="radio" name="pay" checked={effective === 'online'} onChange={() => setMethod('online')} />
                    <span className="mark" aria-hidden="true" />
                    <span className="grow">
                      <strong>Pagar en línea</strong>
                      <span className="muted small" style={{ display: 'block' }}>Mercado Pago: tarjeta de crédito o débito, saldo Mercado Pago u OXXO</span>
                    </span>
                  </label>
                  <label className="option">
                    <input type="radio" name="pay" checked={effective === 'contra_entrega'} onChange={() => setMethod('contra_entrega')} />
                    <span className="mark" aria-hidden="true" />
                    <span className="grow">
                      <strong>{form.fulfillment === 'pickup' ? 'Pagar al recoger' : 'Efectivo al recibir'}</strong>
                      <span className="muted small" style={{ display: 'block' }}>
                        {form.fulfillment === 'pickup' ? 'Efectivo o tarjeta en Frésia.' : 'Pagas en efectivo al repartidor; no lleva terminal.'}
                        {data?.delivery.cashOnDeliveryNote && ` ${data.delivery.cashOnDeliveryNote}`}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>
            )}

            {cashDelivery && total != null && (
              <fieldset className="stack" style={{ gap: 10 }}>
                <legend className="label" style={{ marginBottom: 10 }}>¿Con cuánto vas a pagar? <span className="muted small">· para llevarte cambio</span></legend>
                <div className="tabs" role="group" aria-label="Billete con el que pagas">
                  <button type="button" aria-pressed={cash === 'exacto'} onClick={() => setCash('exacto')}>Exacto</button>
                  {bills(total).map((b) => (
                    <button key={b} type="button" aria-pressed={cash === b} onClick={() => setCash(b)}>{money(b)}</button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={cash !== null && cash !== 'exacto' && !bills(total).includes(cash)}
                    onClick={() => setCash(cashOther ? Math.round(parseFloat(cashOther) * 100) || null : null)}
                  >
                    Otro
                  </button>
                </div>
                {cash !== 'exacto' && (cash === null || !bills(total).includes(cash)) && (
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
            ) : payLater ? (
              <div className="notice stack" style={{ gap: 6 }}>
                <p>
                  <strong>
                    {form.fulfillment === 'pickup' ? `Pagas ${quote.total != null ? money(quote.total) : ''} al recoger.` : `Pagas ${quote.total != null ? money(quote.total) : ''} en efectivo al recibir.`}
                  </strong>{' '}
                  {isGift ? 'El repartidor te cobra a ti primero y después entrega el regalo.' : 'Tu pedido entra a la cocina en cuanto lo confirmes.'}
                </p>
              </div>
            ) : (
              <div className="notice stack" style={{ gap: 6 }}>
                <p>
                  <strong>Continuarás a Mercado Pago</strong> para completar el pago de forma segura. Frésia no recibe ni guarda los datos de tu tarjeta.
                </p>
                {data?.paymentsMode === 'demo' && <p className="small"><strong>Demostración: no se realizan cobros.</strong> Verás un simulador en lugar de Mercado Pago.</p>}
              </div>
            )}

            <p className="muted small">
              Al continuar aceptas el <Link to="/legal/privacidad">aviso de privacidad</Link> y las políticas de{' '}
              <Link to="/legal/entregas">entrega</Link> y <Link to="/legal/cancelaciones">cancelación</Link>.
            </p>

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
