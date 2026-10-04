import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { LoadError, Spinner } from '../components/ui';
import { ORDER_LABEL } from '../../shared/status';
import type { AdminOrder } from '../../shared/types';
import { DeskControls, PushSetup, chime } from './Alerts';
import { CollectPill } from './Collect';
import { nextAction } from './StatusFlow';

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
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<AdminOrder[]>([]);

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        api<{ orders: AdminOrder[] }>(`/api/admin/orders?filter=${filter}`),
        api<typeof summary>('/api/admin/summary'),
      ]);
      setOrders(o.orders);
      setSummary(s);
      setError(null);
      // Pedidos que entraron desde la última revisión (no al abrir el panel).
      const incoming = o.orders.filter((x) => x.orderStatus === 'recibido' || x.orderStatus === 'cotizando_envio');
      if (seen.current) {
        const added = incoming.filter((x) => !seen.current!.has(x.id));
        if (added.length) {
          setFresh((f) => [...added, ...f.filter((y) => !added.some((a) => a.id === y.id))]);
          chime();
        }
        incoming.forEach((x) => seen.current!.add(x.id));
      } else if (filter === 'activos') {
        seen.current = new Set(incoming.map((x) => x.id));
      }
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
      {fresh.length > 0 && (
        <div className="new-order-alert" role="alert">
          <div className="stack" style={{ gap: 4 }}>
            <strong>🔔 {fresh.length === 1 ? 'Pedido nuevo' : `${fresh.length} pedidos nuevos`}</strong>
            {fresh.map((o) => (
              <Link key={o.id} to={`/admin/pedidos/${o.id}`} onClick={() => setFresh((f) => f.filter((x) => x.id !== o.id))}>
                {o.number} · {o.customerName} · {o.total != null ? money(o.total) : 'envío por cotizar'} →
              </Link>
            ))}
          </div>
          <button className="btn ghost small" onClick={() => setFresh([])}>Entendido</button>
        </div>
      )}
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1>Pedidos</h1>
        <p className="muted small" aria-live="polite">
          {summary.nuevos} nuevos · {summary.cotizar} por cotizar · {summary.revision} en revisión · se actualiza cada 15 s
        </p>
      </div>
      <DeskControls />
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
          <OrderRow key={o.id} o={o} onChanged={load} />
        ))}
      </div>
      <PushSetup />
    </div>
  );
}


function OrderRow({ o, onChanged }: { o: AdminOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  const next = nextAction(o);
  async function advance() {
    if (!next) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/orders/${o.id}/status`, { body: { status: next.status } });
      if (next.collect) await api(`/api/admin/orders/${o.id}/collected`, { body: {} });
      // Al salir a entregar, abre el pedido y empieza a compartir la ubicación desde este celular.
      if (next.status === 'en_camino') return navigate(`/admin/pedidos/${o.id}?compartir=1`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className={`order-card ${o.orderStatus === 'recibido' ? 'new' : ''}`}>
      <Link to={`/admin/pedidos/${o.id}`} className="order-row">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong>{o.number}</strong>
          <span className={`badge ${o.orderStatus === 'recibido' ? 'red' : ''}`}>{ORDER_LABEL[o.orderStatus]}</span>
          {o.needsReview && <span className="badge example">Revisar</span>}
          {o.refundStatus === 'pendiente' && <span className="badge example">Reembolso pendiente</span>}
          {o.demo && o.paymentMethod === 'online' && <span className="badge">Demo</span>}
        </div>
        <span className="price">{o.total != null ? money(o.total) : 'Envío por cotizar'}</span>
        <span style={{ gridColumn: '1 / -1' }}><CollectPill order={o} /></span>
        <span className="muted small">
          {o.customerName} · {o.fulfillment === 'delivery' ? 'A domicilio' : 'Recoge'} · {o.items.reduce((s, l) => s + l.qty, 0)} productos
        </span>
        <span className="muted small">{formatDate(o.createdAt)}</span>
      </Link>
      {next && (
        <div className="order-card-actions">
          <button className="btn primary small" disabled={busy} onClick={advance}>{busy ? '…' : next.label}</button>
          {err && <span className="error-text small">{err}</span>}
        </div>
      )}
    </div>
  );
}
