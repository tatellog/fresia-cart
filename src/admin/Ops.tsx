import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { toppingSummary } from '../../shared/pricing';
import { timeLabel } from '../../shared/schedule';
import type { AdminOrder, PricedLine } from '../../shared/types';
import { verified, type PushDevice } from './Alerts';

// ── Urgencia ──────────────────────────────────────────────────────────

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return timeLabel(h * 60 + m);
};

/** «Listo a las 12:15 · faltan 6 min» con color según urgencia. Sin tiempos reales no muestra nada. */
export function UrgencyChip({ order, big }: { order: AdminOrder; big?: boolean }) {
  const u = order.urgency;
  if (!u || u.minutesLeft == null || !u.level) return null;
  const cooking = ['recibido', 'confirmado', 'en_preparacion'].includes(order.orderStatus);
  const kitchen = cooking && !!u.readyBy;
  const at = kitchen ? u.readyBy! : u.dueAt!;
  const what = kitchen ? (order.fulfillment === 'delivery' ? 'Debe salir' : 'Listo') : order.fulfillment === 'delivery' ? 'Entregar' : 'Lo recogen';
  const left = u.minutesLeft < 0 ? `atrasado ${-u.minutesLeft} min` : u.minutesLeft === 0 ? 'ahora' : `faltan ${u.minutesLeft} min`;
  return (
    <span className={`urgency ${u.level}${big ? ' big' : ''}`} title={`Cliente lo espera a las ${hhmm(u.dueAt!)}`}>
      {u.level === 'late' ? '⏰' : u.level === 'soon' ? '⏳' : '🕒'} {what} {hhmm(at)} · <strong>{left}</strong>
    </span>
  );
}

/** Recibido → visto → preparando: tres momentos distintos. */
export function ReceptionBadge({ order }: { order: AdminOrder }) {
  if (order.orderStatus !== 'recibido' && order.orderStatus !== 'confirmado' && order.orderStatus !== 'cotizando_envio') return null;
  return order.seenAt ? <span className="badge">👀 Visto {hhmm(order.seenAt)}</span> : <span className="badge red">🆕 Sin ver</span>;
}

// ── Comanda de cocina ─────────────────────────────────────────────────

function Toppings({ ts }: { ts: PricedLine['toppings'] }) {
  if (!ts.length) return <span className="muted">Sin toppings</span>;
  // En cocina no importan los precios: solo qué y cuántas porciones.
  return <>{toppingSummary(ts).map((t) => t.replace(/ \(.*\)$/, '').replace(/ \+\$[\d.,]+$/, '')).join(' · ')}</>;
}

function TicketLine({ l }: { l: PricedLine }) {
  return (
    <li className="ticket-line">
      <span className="qty">{l.qty}×</span>
      <div>
        <strong>{l.name}</strong>
        {!l.choices && <span className="size"> {l.sizeLabel}</span>}
        {l.choices ? (
          <ul className="pieces">
            {l.choices.map((c, i) => (
              <li key={i}>
                {c.name} <span className="size">{c.sizeLabel}</span> — <Toppings ts={c.toppings} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="tops"><Toppings ts={l.toppings} /></div>
        )}
      </div>
    </li>
  );
}

/**
 * Lo que necesita quien prepara, sin dirección ni facturación: producto, tamaño,
 * toppings (con porciones dobles), cantidades, nota y, en equipo, para quién es.
 */
export function KitchenTicket({ order, compact, dense }: { order: AdminOrder; compact?: boolean; dense?: boolean }) {
  const team = !!order.groupName;
  const byPerson = new Map<string, PricedLine[]>();
  order.items.forEach((l) => {
    const who = team ? l.forWhom || 'Sin nombre' : '';
    byPerson.set(who, [...(byPerson.get(who) ?? []), l]);
  });
  const pieces = order.items.reduce((s, l) => s + l.qty, 0);
  return (
    <section className={`ticket${compact ? ' compact' : ''}${dense ? ' dense' : ''}`} aria-label={`Comanda ${order.number}`}>
      <header className="ticket-head">
        <span className="ticket-num">{order.number}</span>
        <span>{order.fulfillment === 'delivery' ? '🛵 A domicilio' : '🏪 Recoge'} · {pieces} pieza{pieces === 1 ? '' : 's'}</span>
      </header>
      <UrgencyChip order={order} big />
      {order.gift && <p className="ticket-flag">🎁 Fresigrama: incluir tarjeta impresa</p>}
      {[...byPerson].map(([who, lines]) => (
        <div key={who || '_'} className="ticket-group">
          {who && <p className="ticket-who">👤 {who}</p>}
          <ul className="ticket-lines">{lines.map((l, i) => <TicketLine key={i} l={l} />)}</ul>
          {!team && lines.some((l) => l.forWhom) && (
            <p className="muted small">Para: {[...new Set(lines.map((l) => l.forWhom).filter(Boolean))].join(', ')}</p>
          )}
        </div>
      ))}
      {order.notes && <p className="ticket-note">📝 {order.notes}</p>}
    </section>
  );
}

// ── Cobro (separado de la entrega) ────────────────────────────────────

const billsFor = (total: number) => {
  const out = new Set<number>();
  for (const step of [10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
};

/** Registrar el cobro en efectivo: cuánto dio el cliente y el cambio. No cambia el estado de entrega. */
export function CollectCash({ order, onDone }: { order: AdminOrder; onDone: (o: AdminOrder) => void }) {
  const total = order.total ?? 0;
  const said = order.cashTendered;
  const [received, setReceived] = useState<number | null>(said ?? null);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = [...new Set([total, ...(said ? [said] : []), ...billsFor(total)])].sort((a, b) => a - b);
  const change = received != null ? received - total : null;

  async function save() {
    if (received == null || received < total) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: AdminOrder }>(`/api/admin/orders/${order.id}/collected`, { body: { received } });
      onDone(r.order);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="card stack collect-card" aria-labelledby="collect-title">
      <h2 id="collect-title">💵 Registrar cobro · {money(total)}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {order.fulfillment === 'delivery'
          ? said != null
            ? `El cliente dijo que paga con ${money(said)}${said > total ? ` (cambio ${money(said - total)})` : ' (exacto)'}.`
            : 'El cliente no dijo con cuánto paga.'
          : 'Efectivo o terminal en el local.'}{' '}
        Esto es aparte de la entrega.
      </p>
      <div className="tabs" role="group" aria-label="¿Cuánto te dio?">
        {options.map((v) => (
          <button key={v} type="button" aria-pressed={received === v} onClick={() => { setReceived(v); setOther(''); }}>
            {v === total ? `Exacto ${money(v)}` : money(v)}
          </button>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="cash-in">Otro monto recibido</label>
        <input
          id="cash-in"
          className="input sm"
          inputMode="decimal"
          placeholder="$0"
          value={other}
          onChange={(e) => {
            setOther(e.target.value);
            const v = Math.round(parseFloat(e.target.value.replace(/[$,\s]/g, '')) * 100);
            setReceived(Number.isFinite(v) ? v : null);
          }}
        />
      </div>
      {change != null && (change < 0 ? <p className="error-text">Falta {money(-change)} para el total.</p> : <p className="change-line">Cambio a entregar: <strong>{money(change)}</strong></p>)}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="button" className="btn primary block" disabled={busy || received == null || received < total} onClick={save}>
        {busy ? 'Guardando…' : `Registrar cobro de ${money(total)}`}
      </button>
    </section>
  );
}

// ── Avisos: que alguien del local reciba los pedidos aunque no mire el panel ──

export function PushWarning() {
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [configured, setConfigured] = useState(true);
  useEffect(() => {
    api<{ configured: boolean; devices: PushDevice[] }>('/api/admin/push').then((r) => { setDevices(r.devices); setConfigured(r.configured); }, () => undefined);
  }, []);
  if (!devices) return null;
  const go = (e: React.MouseEvent) => { e.preventDefault(); document.getElementById('push-title')?.scrollIntoView({ behavior: 'smooth' }); };
  if (devices.length === 0) {
    return (
      <div className="notice error push-warning" role="alert">
        <strong>🔕 Nadie recibe avisos de pedidos nuevos.</strong> Si no estás mirando el panel, un pedido puede pasar desapercibido.{' '}
        {configured ? <a href="#push-title" onClick={go}>Activar avisos en este dispositivo ↓</a> : 'Faltan las llaves de notificaciones en el servidor.'}
      </div>
    );
  }
  if (!devices.some(verified)) {
    return (
      <div className="notice warn push-warning" role="status">
        <strong>⚠️ Falta comprobar que los avisos llegan con el panel cerrado.</strong> {devices.length} dispositivo(s) suscrito(s), ninguno verificado.{' '}
        <a href="#push-title" onClick={go}>Hacer la prueba ↓</a>
      </div>
    );
  }
  return null;
}

// ── Repartidor: tres acciones ─────────────────────────────────────────

export function routeUrl(order: AdminOrder): string | null {
  const a = order.address;
  if (!a) return null;
  if (a.location) return `https://www.google.com/maps/dir/?api=1&destination=${a.location.lat},${a.location.lng}&travelmode=walking`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${a.street} ${a.number}, ${a.colonia}, ${a.postalCode}, Ciudad de México`)}`;
}

/**
 * Lo que hace el repartidor, en orden: abrir ruta, iniciar entrega y confirmar entrega.
 * La ubicación en vivo y la foto van dentro de esos pasos.
 */
export function CourierPanel({ order, busy, onStart, onConfirm, children }: {
  order: AdminOrder;
  busy: boolean;
  onStart: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const route = routeUrl(order);
  const onTheWay = order.orderStatus === 'en_camino';
  const canStart = order.orderStatus === 'en_preparacion' || order.orderStatus === 'listo' || order.orderStatus === 'recibido' || order.orderStatus === 'confirmado';
  const a = order.address;
  return (
    <section className="card stack courier" aria-labelledby="courier-panel-title">
      <h2 id="courier-panel-title">🛵 Entrega</h2>
      {a && (
        <p style={{ margin: 0 }}>
          <strong>{a.street} {a.number}{a.office ? `, ${a.office}` : ''}</strong>
          <br />
          <span className="muted small">{a.colonia} · {order.customerName} · <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>{a.references ? ` · ${a.references}` : ''}</span>
        </p>
      )}
      <ol className="courier-steps">
        <li>
          <a className={`btn ${onTheWay ? 'secondary' : 'secondary'} block`} href={route ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!route}>
            🗺️ Abrir ruta
          </a>
        </li>
        <li>
          <button type="button" className={`btn ${canStart ? 'primary' : 'secondary'} block`} disabled={busy || !canStart} onClick={onStart}>
            {onTheWay ? '✓ Entrega iniciada' : '🛵 Iniciar entrega'}
          </button>
        </li>
        <li>
          <button type="button" className={`btn ${onTheWay ? 'primary' : 'secondary'} block`} disabled={busy || !onTheWay} onClick={onConfirm}>
            ✅ Confirmar entrega
          </button>
        </li>
      </ol>
      {children}
      {!route && <p className="muted small" style={{ margin: 0 }}>Sin dirección para la ruta.</p>}
      <p className="muted small" style={{ margin: 0 }}>
        Confirmar entrega pide la foto. {order.paymentMethod === 'contra_entrega' && order.paymentStatus !== 'aprobado' ? 'El cobro se registra aparte.' : 'Ya está pagado: no cobres nada.'}
      </p>
      <Link to="/admin" className="linkbtn small">← Volver a pedidos</Link>
    </section>
  );
}

// ── Efectivo al entregar: recibido (importe, quién) o pendiente (motivo) ──

export type CashDecision = { mode: 'received'; received: number; by: string } | { mode: 'pending'; reason: string; by: string };
const STAFF = 'fo.staff.name';
const REASONS = ['El cliente paga después', 'Lo cobra recepción', 'Autorizado por encargado'];

/** Pregunta obligatoria al entregar un pedido con efectivo sin registrar. No bloquea: «pendiente» es una opción válida. */
export function CashHandoff({ order, onChange }: { order: AdminOrder; onChange: (d: CashDecision | null) => void }) {
  const total = order.total ?? 0;
  const said = order.cashTendered;
  const [mode, setMode] = useState<'received' | 'pending' | null>(null);
  const [received, setReceived] = useState<number | null>(said ?? null);
  const [other, setOther] = useState('');
  const [reason, setReason] = useState('');
  const [by, setBy] = useState(() => localStorage.getItem(STAFF) ?? '');
  const options = [...new Set([total, ...(said ? [said] : []), ...billsFor(total)])].sort((a, b) => a - b);

  useEffect(() => {
    const who = by.trim();
    if (who.length >= 2) localStorage.setItem(STAFF, who);
    if (who.length < 2 || !mode) return onChange(null);
    if (mode === 'received') onChange(received != null && received >= total ? { mode, received, by: who } : null);
    else onChange(reason.trim().length >= 3 ? { mode, reason: reason.trim(), by: who } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, received, reason, by]);

  return (
    <div className="cash-handoff" role="group" aria-labelledby="cash-q">
      <p id="cash-q" className="choice-legend" style={{ margin: 0 }}>
        <span>💵 ¿Recibiste el efectivo? · {money(total)}</span>
        <span className={`req${mode ? ' done' : ''}`}>{mode ? '✓' : 'Obligatorio'}</span>
      </p>
      <div className="segmented">
        <label className="option"><input type="radio" name="cash-mode" checked={mode === 'received'} onChange={() => setMode('received')} /><strong>✅ Sí, lo recibí</strong><span className="muted small">Registra cuánto y el cambio</span></label>
        <label className="option"><input type="radio" name="cash-mode" checked={mode === 'pending'} onChange={() => setMode('pending')} /><strong>⏳ Queda pendiente</strong><span className="muted small">Excepción: queda destacado</span></label>
      </div>
      {mode === 'received' && (
        <>
          <div className="tabs" role="group" aria-label="¿Cuánto te dio?">
            {options.map((v) => (
              <button key={v} type="button" aria-pressed={received === v} onClick={() => { setReceived(v); setOther(''); }}>{v === total ? `Exacto ${money(v)}` : money(v)}</button>
            ))}
          </div>
          <input className="input sm" style={{ maxWidth: 200 }} inputMode="decimal" placeholder="Otro monto" aria-label="Otro monto recibido" value={other}
            onChange={(e) => { setOther(e.target.value); const v = Math.round(parseFloat(e.target.value.replace(/[$,\s]/g, '')) * 100); setReceived(Number.isFinite(v) ? v : null); }} />
          {received != null && (received < total ? <p className="error-text" style={{ margin: 0 }}>Falta {money(total - received)}.</p> : <p className="change-line" style={{ margin: 0 }}>Cambio a entregar: <strong>{money(received - total)}</strong></p>)}
        </>
      )}
      {mode === 'pending' && (
        <>
          <div className="tabs" role="group" aria-label="Motivo">
            {REASONS.map((r) => <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <input className="input sm" placeholder="Otro motivo" aria-label="Motivo del cobro pendiente" value={REASONS.includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
        </>
      )}
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="staff">¿Quién entrega?</label>
        <input id="staff" className="input sm" value={by} onChange={(e) => setBy(e.target.value)} maxLength={40} placeholder="Tu nombre" autoComplete="given-name" />
      </div>
    </div>
  );
}

/** Aplica la decisión de efectivo después de marcar entregado. */
export async function applyCash(orderId: string, d: CashDecision) {
  if (d.mode === 'received') return api<{ order: AdminOrder }>(`/api/admin/orders/${orderId}/collected`, { body: { received: d.received, by: d.by } });
  return api<{ order: AdminOrder }>(`/api/admin/orders/${orderId}/collect-pending`, { body: { reason: d.reason, by: d.by } });
}
