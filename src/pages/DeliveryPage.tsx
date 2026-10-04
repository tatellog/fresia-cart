import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { useCheckoutForm } from '../lib/checkout';
import type { CheckoutForm } from '../lib/checkout';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { DemoBanner, Field, SelectField, Spinner, StickyAction, TopBar } from '../components/ui';
import { groupCheckout } from '../lib/groupState';
import { isPostalCode, normalizeText, prepText, quoteEtaText } from '../../shared/coverage';
import { POSTAL_NOT_FOUND, usePostalCode } from '../lib/postal';
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
  const radiusMode = data?.delivery.mode === 'radius';
  const location = form.address.location ?? null;
  const [locating, setLocating] = useState<'idle' | 'busy' | 'denied' | 'unavailable'>('idle');
  const postal = usePostalCode(cp);

  // Al reconocer el código postal: si tiene una sola colonia se llena sola; si la escrita no es de ese CP, se borra.
  useEffect(() => {
    if (postal.state !== 'found') return;
    const names = postal.info.colonias.map((c) => c.name);
    setForm((f) => {
      const current = names.find((n) => normalizeText(n) === normalizeText(f.address.colonia));
      const next = current ?? (names.length === 1 ? names[0] : '');
      return next === f.address.colonia ? f : { ...f, address: { ...f.address, colonia: next } };
    });
    setErrors((e) => ({ ...e, postalCode: undefined, colonia: undefined }));
  }, [postal, setForm]);

  function locate() {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setLocating('unavailable');
      return;
    }
    setLocating('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          address: { ...f.address, location: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) } },
        }));
        setLocating('idle');
      },
      (err) => setLocating(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    if (form.fulfillment !== 'delivery' || !data || (!radiusMode && !isPostalCode(cp))) {
      setCoverage({ state: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setCoverage({ state: 'loading' });
    const t = setTimeout(() => {
      api<DeliveryQuote>('/api/coverage', { body: { postalCode: cp, colonia, location }, signal: ctrl.signal }).then(
        (quote) => setCoverage({ state: 'done', quote }),
        (e) => e.name !== 'AbortError' && setCoverage({ state: 'error' }),
      );
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp, colonia, form.fulfillment, data, radiusMode, location?.lat, location?.lng, location?.accuracyM]);

  // Si solo hay una modalidad disponible, selecciónala.
  useEffect(() => {
    if (!data) return;
    if (!data.delivery.deliveryEnabled && form.fulfillment === 'delivery' && data.delivery.pickupEnabled) setForm((f) => ({ ...f, fulfillment: 'pickup' }));
    if (!data.delivery.pickupEnabled && form.fulfillment === 'pickup' && data.delivery.deliveryEnabled) setForm((f) => ({ ...f, fulfillment: 'delivery' }));
  }, [data, form.fulfillment, setForm]);

  if (cart.lines.length === 0 && !groupCheckout()) return <Navigate to="/carrito" replace />;

  const set = (patch: Partial<CheckoutForm>) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (k: Exclude<keyof CheckoutForm['address'], 'location'>, v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
  const notCovered = form.fulfillment === 'delivery' && coverage.state === 'done' && coverage.quote.status === 'not_covered';

  function next() {
    const e = validate(form);
    if (form.fulfillment === 'delivery' && postal.state === 'not_found') e.postalCode = POSTAL_NOT_FOUND;
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

          {form.fulfillment === 'delivery' && radiusMode && data && (
            <section className="card stack" aria-labelledby="loc-title">
              <h2 id="loc-title">¿Estás cerca?</h2>
              <p className="muted">
                Entregamos a oficinas a menos de {data.delivery.radiusM} m de Frésia. Comparte tu ubicación <strong>desde el lugar de entrega</strong> para confirmarlo.
              </p>
              <button type="button" className={`btn ${location ? 'secondary' : 'primary'} block`} onClick={locate} disabled={locating === 'busy'}>
                {locating === 'busy' ? <Spinner label="Buscando tu ubicación…" /> : location ? 'Actualizar mi ubicación' : 'Usar mi ubicación'}
              </button>
              {locating === 'denied' && (
                <p className="small error-text" role="alert">No diste permiso de ubicación. Puedes activarlo en tu navegador, o seguir y confirmaremos el envío por WhatsApp.</p>
              )}
              {locating === 'unavailable' && (
                <p className="small error-text" role="alert">No pudimos obtener tu ubicación. Puedes seguir y confirmaremos el envío por WhatsApp.</p>
              )}
              <CoverageNotice coverage={coverage} freeFrom={data?.delivery.freeShippingFrom ?? null} />
              <p className="muted small">Solo usamos tu ubicación para calcular la distancia; la verá Frésia junto con tu pedido.</p>
            </section>
          )}

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
                  error={errors.postalCode ?? (postal.state === 'not_found' ? POSTAL_NOT_FOUND : undefined)}
                  hint={postal.state === 'loading' ? 'Buscando…' : postal.state === 'found' ? `${postal.info.alcaldia}, ${postal.info.estado}` : undefined}
                />
              </div>
              {postal.state === 'found' && postal.info.colonias.length > 1 ? (
                <SelectField
                  label="Colonia"
                  value={form.address.colonia}
                  onChange={(v) => setAddr('colonia', v)}
                  error={errors.colonia}
                  placeholder="Elige tu colonia"
                  options={postal.info.colonias.map((c) => c.name)}
                />
              ) : (
                <Field
                  label="Colonia"
                  autoComplete="address-level3"
                  value={form.address.colonia}
                  onChange={(e) => setAddr('colonia', e.target.value)}
                  error={errors.colonia}
                  maxLength={80}
                  readOnly={postal.state === 'found'}
                  hint={postal.state === 'found' ? 'Según tu código postal.' : postal.state === 'idle' && !isPostalCode(cp) ? 'Se llena sola con tu código postal.' : undefined}
                />
              )}
              {!radiusMode && <CoverageNotice coverage={coverage} freeFrom={data?.delivery.freeShippingFrom ?? null} />}
              <Field label="Oficina o piso" placeholder="Ej. Piso 4, oficina 402" value={form.address.office} onChange={(e) => setAddr('office', e.target.value)} error={errors.office} maxLength={80} />
              <Field label="Referencias" optional placeholder="Ej. Dejar en recepción" value={form.address.references} onChange={(e) => setAddr('references', e.target.value)} maxLength={200} />
            </section>
          ) : (
            <section className="card flat stack" aria-labelledby="pickup-title">
              <h2 id="pickup-title">Recoger en Frésia</h2>
              <p>{data?.business.address || 'Dirección pendiente de confirmar'}</p>
              <p className="muted small">
                {data && prepText(data.delivery) ? `Tiempo de preparación: ${prepText(data.delivery)}. ` : ''}Te avisaremos cuando esté listo.
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

function CoverageNotice({ coverage, freeFrom }: { coverage: { state: string; quote?: DeliveryQuote }; freeFrom: number | null }) {
  if (coverage.state === 'idle') return <p className="hint muted small">Verificamos la cobertura y el costo de envío antes de pagar.</p>;
  if (coverage.state === 'loading') return <div className="notice"><Spinner label="Verificando cobertura…" /></div>;
  if (coverage.state === 'error') return <div className="notice error" role="alert">No pudimos verificar la cobertura. Revisa tu conexión.</div>;
  const q = coverage.quote!;
  if (q.status === 'covered') {
    return (
      <div className="notice ok" role="status">
        <strong>Sí llegamos{q.distanceM != null ? ` · estás a ${q.distanceM} m` : ''}.</strong> Envío {q.fee ? money(q.fee) : 'sin costo'}{q.fee && freeFrom != null ? ` (gratis desde ${money(freeFrom)})` : ''}{quoteEtaText(q) ? ` · llega en ${quoteEtaText(q)} aprox.` : '.'}
      </div>
    );
  }
  if (q.status === 'manual' && q.needsLocation) {
    return <p className="small muted">Sin tu ubicación, guardaremos tu pedido y confirmaremos el envío por WhatsApp antes de cobrar.</p>;
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
      <strong>Por ahora no llegamos ahí{q.status === 'not_covered' && q.distanceM ? ` (estás a unos ${q.distanceM} m)` : ''}.</strong> Puedes elegir recoger en Frésia.
    </div>
  );
}
