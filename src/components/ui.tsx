import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMenu } from '../lib/menu';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';

export function DemoBanner() {
  const { data } = useMenu();
  if (!data) return null;
  const pending = [
    data.products.some((p) => p.example) && 'menú',
    data.delivery.example && 'tarifa y tiempo de envío',
    data.business.example && 'datos de contacto',
  ].filter(Boolean) as string[];
  // «Demostración» solo si se ofrece el pago en línea simulado (nunca en la tienda pública).
  const demoPay = data.paymentsMode === 'demo' && data.delivery.onlinePayment;
  if (!demoPay && pending.length === 0) return null;
  const list = pending.length > 1 ? `${pending.slice(0, -1).join(', ')} y ${pending.at(-1)}` : pending[0];
  return (
    <div className="demo-banner" role="note">
      {demoPay && <strong>Demostración: el pago en línea es simulado.</strong>}{' '}
      {list && <span>{list[0].toUpperCase() + list.slice(1)} de ejemplo.</span>}
    </div>
  );
}

export function TopBar({ back, step }: { back?: string | (() => void); step?: string }) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button type="button" className="back" onClick={() => (typeof back === 'string' ? navigate(back) : back())}>
          <span aria-hidden="true">←</span> Volver
        </button>
      ) : (
        <span />
      )}
      {step && <span className="steps">{step}</span>}
      <Link to="/" className="logo-link" aria-label="Frésia, ir al menú">
        <img src="/brand/fresia-puerta.svg" alt="" className="logo-sm" width={30} height={44} />
      </Link>
    </header>
  );
}

export function CartBar() {
  const { count, subtotal } = useCart();
  if (count === 0) return null;
  return (
    <div className="cartbar">
      <div className="inner">
        <Link to="/carrito" className="btn primary">
          <span className="row" style={{ gap: 10 }}>
            <span className="count" aria-hidden="true">{count}</span>
            Ver carrito
          </span>
          <span className="price">
            <span className="sr-only">{count} productos, subtotal </span>
            {money(subtotal)}
          </span>
        </Link>
      </div>
    </div>
  );
}

export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="cartbar">
      <div className="inner">{children}</div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 50, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Quitar uno">
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Agregar uno">
        +
      </button>
    </div>
  );
}

export function Field({
  label, hint, error, optional, ...input
}: { label: string; hint?: string; error?: string; optional?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="muted small">(opcional)</span>}
      </label>
      <input
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        {...input}
      />
      {(error || hint) && (
        <span id={`${id}-d`} className={error ? 'error-text' : 'hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <Link to="/legal/privacidad">Aviso de privacidad</Link>
      <Link to="/legal/entregas">Entregas</Link>
      <Link to="/legal/cancelaciones">Cancelaciones y reembolsos</Link>
    </footer>
  );
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="notice error stack" role="alert">
      <p>{message}</p>
      <button type="button" className="btn secondary small" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}
