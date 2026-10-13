import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { LoadError, Spinner } from '../components/ui';
import { nextAction } from '../../shared/flow';
import { KitchenTicket, ReceptionBadge } from './Ops';
import type { AdminOrder } from '../../shared/types';

const COOKING = ['recibido', 'confirmado', 'en_preparacion'];

/** Pantalla de cocina: solo lo que hay que preparar, como comandas, en orden de urgencia. */
export default function KitchenBoard() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ orders: AdminOrder[] }>('/api/admin/orders?filter=activos');
      // Pedidos para recoger o salir: los que todavía están en cocina.
      setOrders(r.orders.filter((o) => COOKING.includes(o.orderStatus) && (o.paymentStatus === 'aprobado' || o.paymentMethod === 'contra_entrega')));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function advance(o: AdminOrder) {
    const next = nextAction(o);
    if (!next || next.kind !== 'status') return;
    setBusy(o.id);
    try {
      if (!o.seenAt) await api(`/api/admin/orders/${o.id}/seen`, { body: {} });
      await api(`/api/admin/orders/${o.id}/status`, { body: { status: next.status } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <div className="stack-lg">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1>👩‍🍳 Cocina</h1>
        <p className="muted small">Solo lo que hay que preparar · lo más urgente primero · cada 15 s</p>
      </div>
      {error && <LoadError message={error} retry={load} />}
      {!orders && !error && <Spinner label="Cargando comandas…" />}
      {orders && orders.length === 0 && <p className="muted">No hay nada que preparar. 🍓</p>}
      <div className="ticket-board">
        {orders?.map((o) => {
          const next = nextAction(o);
          return (
            <div key={o.id} className={`ticket-card ${o.urgency?.level ?? ''}`}>
              <div className="row between" style={{ gap: 6 }}>
                <ReceptionBadge order={o} />
                {o.orderStatus === 'en_preparacion' && <span className="badge ok">Preparando</span>}
                <Link to={`/admin/pedidos/${o.id}`} className="linkbtn small">Ver pedido</Link>
              </div>
              <KitchenTicket order={o} compact />
              {next?.kind === 'status' && (
                <button type="button" className="btn primary block" disabled={busy === o.id} onClick={() => advance(o)}>
                  {busy === o.id ? '…' : next.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
