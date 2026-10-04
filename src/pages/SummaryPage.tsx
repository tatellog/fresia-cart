import { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../shared/types';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toLineInput, useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { idempotencyKeyFor, readCheckoutForm, rememberOrder, resetIdempotencyKey, useCheckoutForm } from '../lib/checkout';
import { api, ApiError } from '../lib/api';
import { money } from '../lib/format';
import { DemoBanner, LoadError, Spinner, StickyAction, TopBar } from '../components/ui';
import { validate } from './DeliveryPage';
import { etaText } from '../../shared/coverage';
import type { PublicOrder, Quote } from '../../shared/types';
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
  const setMethod = (m: PaymentMethod) => {
    setMethodState(m);
    setStoredForm((f) => ({ ...f, paymentMethod: m }));
  };
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => cart.lines.map(toLineInput), [cart.lines]);
  const address = form.fulfillment === 'delivery' ? { ...form.address, postalCode: form.address.postalCode.trim(), location: form.address.location ?? null } : null;
  const formInvalid = Object.keys(validate(form)).length > 0;

  const load = () => {
    setLoadError(null);
    api<Quote>('/api/quote', { body: { fulfillment: form.fulfillment, address, items } }).then(setQuote, (e: Error) => setLoadError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [items]);

  if (cart.lines.length === 0) return <Navigate to="/carrito" replace />;
  if (formInvalid) return <Navigate to="/entrega" replace />;

  const manual = quote?.delivery.status === 'manual';
  const online = data?.delivery.onlinePayment ?? true;
  const cod = data?.delivery.cashOnDelivery ?? false;
  const effective: PaymentMethod = !cod ? 'online' : !online ? 'contra_entrega' : method;
  const payLater = effective === 'contra_entrega';
  const blocked = !quote || quote.errors.length > 0;

  async function submit() {
    if (!quote || busy) return;
    setBusy(true);
    setError(null);
    const body = {
      customer: { name: form.name.trim(), phone: form.phone },
      fulfillment: form.fulfillment,
      paymentMethod: effective,
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
      rememberOrder({ number: created.number, token: created.token, at: new Date().toISOString(), cartFingerprint: fingerprint });

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
              {quote.delivery.status === 'covered' && (
                <p className="small">Tiempo estimado: {etaText(quote.delivery.etaMin, quote.delivery.etaMax)} después de confirmar el pago.</p>
              )}
              {quote.delivery.status === 'pickup' && data?.delivery.pickupPrepText && (
                <p className="small">Preparación: {data.delivery.pickupPrepText}.</p>
              )}
              {form.notes && <p className="small muted">Notas: {form.notes}</p>}
            </section>

            <Totals subtotal={quote.subtotal} shippingFee={quote.shippingFee} total={quote.total} fulfillment={form.fulfillment} />

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
                      <strong>{form.fulfillment === 'pickup' ? 'Pagar al recoger' : 'Pagar al recibir'}</strong>
                      <span className="muted small" style={{ display: 'block' }}>
                        {form.fulfillment === 'pickup' ? 'Pagas en Frésia al recoger tu pedido.' : 'Pagas al repartidor al recibir tu pedido.'}
                        {data?.delivery.cashOnDeliveryNote && ` ${data.delivery.cashOnDeliveryNote}`}
                      </span>
                    </span>
                  </label>
                </div>
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
                  <strong>Pagas {quote.total != null ? money(quote.total) : ''} {form.fulfillment === 'pickup' ? 'al recoger' : 'al recibir'}.</strong> Tu pedido entra a la cocina en cuanto lo confirmes.
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
            <>Confirmar pedido · {quote?.total != null ? money(quote.total) : ''}</>
          ) : (
            <>Pagar {quote?.total != null ? money(quote.total) : ''}</>
          )}
        </button>
      </StickyAction>
    </>
  );
}
