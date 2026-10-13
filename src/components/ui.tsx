import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMenu } from '../lib/menu';
import { useCart } from '../lib/cart';
import { activeGroup, setActiveGroup } from '../lib/groupState';
import { useState } from 'react';
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

/** Barra superior de las pantallas internas: volver, la marca al centro y, si aplica, el carrito. */
export function TopBar({ back, cart }: { back?: string | (() => void); step?: string; cart?: boolean }) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button type="button" className="icon-btn" aria-label="Volver" onClick={() => (typeof back === 'string' ? navigate(back) : back())}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      ) : (
        <span className="icon-spacer" />
      )}
      <Link to="/" className="topbar-brand" aria-label="Frésia, ir al inicio">
        <Wordmark height={26} />
      </Link>
      {cart ? <CartIcon /> : <span className="icon-spacer" />}
    </header>
  );
}

/** Logotipo «Frésia» (versión de palabra). */
export function Wordmark({ height = 30 }: { height?: number }) {
  return <img src="/brand/fresia-wordmark.png" alt="Frésia" height={height} width={Math.round((height * 368) / 108)} className="wordmark-img" />;
}

export function CartIcon() {
  const { count } = useCart();
  return (
    <Link to="/carrito" className="icon-btn" aria-label={count ? `Carrito, ${count} producto${count === 1 ? '' : 's'}` : 'Carrito'}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8h12l-1 12H7L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      {count > 0 && <span className="dot-count" aria-hidden="true">{count}</span>}
    </Link>
  );
}

/** Pasos del checkout: Entrega y Datos en una pantalla, Pago (con revisión del total) en la siguiente. */
export function CheckoutSteps({ current }: { current: 'entrega' | 'pago' }) {
  const steps = [
    { label: 'Entrega', to: '/entrega' },
    { label: 'Datos', to: '/entrega' },
    { label: 'Pago', to: null },
  ];
  const at = current === 'entrega' ? 0 : 2;
  return (
    <nav aria-label="Pasos para pedir">
      <ol className="checkout-steps">
        {steps.map((s, i) => {
          const done = i < at;
          const active = current === 'entrega' ? i <= 1 : i === 2;
          return (
            <li key={s.label} className={active ? 'active' : done ? 'done' : ''} aria-current={active && i === at ? 'step' : undefined}>
              <span className="dot" aria-hidden="true">{done ? '✓' : i + 1}</span>
              {done && s.to ? <Link to={s.to}>{s.label}</Link> : s.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Aviso cuando este teléfono está agregando a un pedido de equipo. */
export function GroupModeBanner() {
  const [g, setG] = useState(activeGroup);
  if (!g) return null;
  return (
    <div className="group-banner" role="status">
      <span>
        👥 Agregando al pedido <strong>«{g.name}»</strong> como {g.memberName}
      </span>
      <span className="row" style={{ gap: 12 }}>
        <Link to={`/equipo/${g.code}`}>Ver pedido</Link>
        <button type="button" className="linkbtn" onClick={() => { setActiveGroup(null); setG(null); }}>Salir</button>
      </span>
    </div>
  );
}

export function CartBar() {
  const { count, subtotal } = useCart();
  const g = activeGroup();
  if (g) {
    return (
      <div className="cartbar">
        <div className="inner">
          <Link to={`/equipo/${g.code}`} className="btn primary" style={{ justifyContent: 'center' }}>👥 Ver pedido del equipo</Link>
        </div>
      </div>
    );
  }
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

export function SelectField({
  label, value, onChange, options, placeholder, error,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={options.includes(value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-d` : undefined}
      >
        <option value="" disabled>{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <span id={`${id}-d`} className="error-text">{error}</span>}
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
