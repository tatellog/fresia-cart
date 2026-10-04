import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { LoadError, Spinner } from '../components/ui';
import { ORDER_LABEL, PAYMENT_LABEL } from '../../shared/status';
import type { AdminOrder } from '../../shared/types';

type Filter = 'activos' | 'sin_pagar' | 'revision' | 'todos';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'activos', label: 'En curso' },
  { key: 'revision', label: 'Revisión' },
  { key: 'sin_pagar', label: 'Sin pagar' },
  { key: 'todos', label: 'Todos' },
];

export default function Orders() {
  const [filter, setFilter] = useState<Filter>('activos');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ nuevos: 0, cotizar: 0, revision: 0 });
  const prevNew = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        api<{ orders: AdminOrder[] }>(`/api/admin/orders?filter=${filter}`),
        api<typeof summary>('/api/admin/summary'),
      ]);
      setOrders(o.orders);
      setSummary(s);
      setError(null);
      if (prevNew.current != null && s.nuevos > prevNew.current) chime();
      prevNew.current = s.nuevos;
      document.title = s.nuevos ? `(${s.nuevos}) Nuevos · Frésia` : 'Panel · Frésia Office';
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    setOrders(null);
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="stack-lg">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1>Pedidos</h1>
        <p className="muted small" aria-live="polite">
          {summary.nuevos} nuevos · {summary.cotizar} por cotizar · {summary.revision} en revisión · se actualiza cada 15 s
        </p>
      </div>
      <div className="tabs" role="group" aria-label="Filtrar pedidos">
        {FILTERS.map((f) => (
          <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <LoadError message={error} retry={load} />}
      {!orders && !error && <Spinner label="Cargando pedidos…" />}
      {orders && orders.length === 0 && <p className="muted">No hay pedidos aquí.</p>}
      <div className="stack">
        {orders?.map((o) => (
          <Link key={o.id} to={`/admin/pedidos/${o.id}`} className={`order-row ${o.orderStatus === 'recibido' ? 'new' : ''}`}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <strong>{o.number}</strong>
              <span className={`badge ${o.paymentStatus === 'aprobado' ? 'ok' : 'warn'}`}>{PAYMENT_LABEL[o.paymentStatus]}</span>
              <span className={`badge ${o.orderStatus === 'recibido' ? 'red' : ''}`}>{ORDER_LABEL[o.orderStatus]}</span>
              {o.needsReview && <span className="badge example">Revisar</span>}
              {o.refundStatus === 'pendiente' && <span className="badge example">Reembolso pendiente</span>}
              {o.demo && <span className="badge">Demo</span>}
            </div>
            <span className="price">{o.total != null ? money(o.total) : 'Envío por cotizar'}</span>
            <span className="muted small">
              {o.customerName} · {o.fulfillment === 'delivery' ? `Domicilio · CP ${o.address?.postalCode}` : 'Recoge'} · {o.items.reduce((s, l) => s + l.qty, 0)} productos
            </span>
            <span className="muted small">{formatDate(o.createdAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* sin audio */
  }
}
