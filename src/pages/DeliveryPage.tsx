import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { useCheckoutForm } from '../lib/checkout';
import type { CheckoutForm } from '../lib/checkout';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { DemoBanner, Field, Spinner, StickyAction, TopBar } from '../components/ui';
import { etaText, isPostalCode } from '../../shared/coverage';
import type { DeliveryQuote } from '../../shared/types';

type Errors = Partial<Record<'name' | 'phone' | 'street' | 'number' | 'colonia' | 'postalCode' | 'office', string>>;

export function validate(f: CheckoutForm): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = 'Escribe tu nombre.';
  const digits = f.phone.replace(/\D/g, '');
  if (digits.length !== 10 && !(digits.length === 12 && digits.startsWith('52'))) e.phone = 'Escribe un teléfono de 10 dígitos.';
  if (f.fulfillment === 'delivery') {
    const a = f.address;
    if (a.street.trim().length < 2) e.street = 'Escribe la calle.';
    if (!a.number.trim()) e.number = 'Escribe el número.';
    if (a.colonia.trim().length < 2) e.colonia = 'Escribe la colonia.';
    if (!isPostalCode(a.postalCode)) e.postalCode = 'Debe tener 5 dígitos.';
    if (!a.office.trim()) e.office = 'Indica oficina o piso.';
  }
  return e;
}

export default function DeliveryPage() {
  const cart = useCart();
  const { data } = useMenu();
  const navigate = useNavigate();
  const [form, setForm] = useCheckoutForm();
  const [errors, setErrors] = useState<Errors>({});
  const [coverage, setCoverage] = useState<{ state: 'idle' | 'loading' | 'error' } | { state: 'done'; quote: DeliveryQuote }>({ state: 'idle' });

  const cp = form.address.postalCode.trim();
  const colonia = form.address.colonia.trim();

  useEffect(() => {
    if (form.fulfillment !== 'delivery' || !isPostalCode(cp)) {
      setCoverage({ state: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setCoverage({ state: 'loading' });
    const t = setTimeout(() => {
      api<DeliveryQuote>('/api/coverage', { body: { postalCode: cp, colonia }, signal: ctrl.signal }).then(
        (quote) => setCoverage({ state: 'done', quote }),
        (e) => e.name !== 'AbortError' && setCoverage({ state: 'error' }),
      );
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [cp, colonia, form.fulfillment]);

  // Si solo hay una modalidad disponible, selecciónala.
  useEffect(() => {
    if (!data) return;
    if (!data.delivery.deliveryEnabled && form.fulfillment === 'delivery' && data.delivery.pickupEnabled) setForm((f) => ({ ...f, fulfillment: 'pickup' }));
    if (!data.delivery.pickupEnabled && form.fulfillment === 'pickup' && data.delivery.deliveryEnabled) setForm((f) => ({ ...f, fulfillment: 'delivery' }));
  }, [data, form.fulfillment, setForm]);

  if (cart.lines.length === 0) return <Navigate to="/carrito" replace />;

  const set = (patch: Partial<CheckoutForm>) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (k: keyof CheckoutForm['address'], v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
  const notCovered = form.fulfillment === 'delivery' && coverage.state === 'done' && coverage.quote.status === 'not_covered';

  function next() {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
      first?.focus();
      return;
    }
    if (notCovered) return;
    navigate('/resumen');
  }

  return (
    <>
      <DemoBanner />
      <main className="page">
        <TopBar back="/carrito" step="Entrega" />
        <form
          className="stack-lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <h1>¿Cómo lo recibes?</h1>

          <fieldset>
            <legend className="sr-only">Tipo de entrega</legend>
            <div className="segmented">
              <label className="option">
                <input type="radio" name="f" checked={form.fulfillment === 'delivery'} disabled={data ? !data.delivery.deliveryEnabled : false} onChange={() => set({ fulfillment: 'delivery' })} />
                <strong>A domicilio</strong>
                <span className="muted small">En tu oficina</span>
              </label>
              <label className="option">
                <input type="radio" name="f" checked={form.fulfillment === 'pickup'} disabled={data ? !data.delivery.pickupEnabled : false} onChange={() => set({ fulfillment: 'pickup' })} />
                <strong>Recoger</strong>
                <span className="muted small">En Frésia</span>
              </label>
            </div>
          </fieldset>

          <section className="stack" aria-labelledby="contact-title">
            <h2 id="contact-title">Tus datos</h2>
            <Field label="Nombre" autoComplete="name" value={form.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} maxLength={80} />
            <Field
              label="Teléfono"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              error={errors.phone}
              hint="Solo para avisarte sobre tu pedido."
              maxLength={20}
            />
          </section>

          {form.fulfillment === 'delivery' ? (
            <section className="stack" aria-labelledby="addr-title">
              <h2 id="addr-title">Dirección de entrega</h2>
              <Field label="Calle" autoComplete="address-line1" value={form.address.street} onChange={(e) => setAddr('street', e.target.value)} error={errors.street} maxLength={120} />
              <div className="two">
                <Field label="Número" value={form.address.number} onChange={(e) => setAddr('number', e.target.value)} error={errors.number} maxLength={20} />
                <Field
                  label="Código postal"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={form.address.postalCode}
                  onChange={(e) => setAddr('postalCode', e.target.value.replace(/\D/g, '').slice(0, 5))}
                  error={errors.postalCode}
                />
              </div>
              <Field label="Colonia" autoComplete="address-level3" value={form.address.colonia} onChange={(e) => setAddr('colonia', e.target.value)} error={errors.colonia} maxLength={80} />
              <CoverageNotice coverage={coverage} />
              <Field label="Oficina o piso" placeholder="Ej. Piso 4, oficina 402" value={form.address.office} onChange={(e) => setAddr('office', e.target.value)} error={errors.office} maxLength={80} />
              <Field label="Referencias" optional placeholder="Ej. Dejar en recepción" value={form.address.references} onChange={(e) => setAddr('references', e.target.value)} maxLength={200} />
            </section>
          ) : (
            <section className="card flat stack" aria-labelledby="pickup-title">
              <h2 id="pickup-title">Recoger en Frésia</h2>
              <p>{data?.business.address || 'Dirección pendiente de confirmar'}</p>
              <p className="muted small">
                Tiempo de preparación: {data?.delivery.pickupPrepText || 'pendiente de confirmar'}. Te avisaremos cuando esté listo.
              </p>
            </section>
          )}

          <div className="field">
            <label htmlFor="notes">
              Notas del pedido <span className="muted small">(opcional)</span>
            </label>
            <textarea id="notes" className="textarea" maxLength={300} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </form>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" onClick={next} disabled={notCovered}>
          {notCovered ? 'Dirección fuera de cobertura' : 'Revisar pedido'}
        </button>
      </StickyAction>
    </>
  );
}

function CoverageNotice({ coverage }: { coverage: { state: string; quote?: DeliveryQuote } }) {
  if (coverage.state === 'idle') return <p className="hint muted small">Con tu código postal verificamos la cobertura y el costo de envío.</p>;
  if (coverage.state === 'loading') return <div className="notice"><Spinner label="Verificando cobertura…" /></div>;
  if (coverage.state === 'error') return <div className="notice error" role="alert">No pudimos verificar la cobertura. Revisa tu conexión.</div>;
  const q = coverage.quote!;
  if (q.status === 'covered') {
    return (
      <div className="notice ok" role="status">
        <strong>Sí llegamos.</strong> Envío {q.fee ? money(q.fee) : 'sin costo'} · {etaText(q.etaMin, q.etaMax)} aprox.
      </div>
    );
  }
  if (q.status === 'manual') {
    return (
      <div className="notice warn" role="status">
        <strong>Confirmaremos el envío.</strong> {q.reason} Guardaremos tu pedido y te diremos el costo antes de pagar.
      </div>
    );
  }
  return (
    <div className="notice error" role="alert">
      <strong>Por ahora no llegamos a esa dirección.</strong> Puedes elegir recoger en Frésia.
    </div>
  );
}
