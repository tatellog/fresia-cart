import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { parseMoney } from '../../shared/money';
import { LoadError, Spinner } from '../components/ui';
import { LineDetails } from '../pages/parts';
import { CollectBox } from './Collect';
import { StatusFlow } from './StatusFlow';
import { CourierShare } from './CourierShare';
import { ORDER_LABEL, PAYMENT_LABEL, REFUND_LABEL } from '../../shared/status';
import type { AdminOrder, OrderStatus, RefundStatus } from '../../shared/types';


export default function OrderDetail() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [params] = useSearchParams();
  const [shareNow, setShareNow] = useState(params.get('compartir') === '1');

  const load = useCallback(() => {
    api<{ order: AdminOrder }>(`/api/admin/orders/${id}`).then((r) => setOrder(r.order), (e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<{ order?: AdminOrder }>(`/api/admin/${path}`, { body });
      if (r.order) setOrder(r.order);
      else load();
    } catch (e) {
      setActionError((e as Error).message);
    }
    setBusy(false);
    setConfirmCancel(false);
  }

  async function setStatus(status: OrderStatus, collect: boolean) {
    if (status === 'en_camino') setShareNow(true);
    await act(`orders/${order!.id}/status`, { status });
    if (collect) await act(`orders/${order!.id}/collected`, {});
  }

  if (error) return <LoadError message={error} retry={load} />;
  if (!order) return <Spinner label="Cargando…" />;

  const paid = order.paymentStatus === 'aprobado';
  const cod = order.paymentMethod === 'contra_entrega';

  return (
    <div className="stack-lg">
      <Link to="/admin" className="back">← Pedidos</Link>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1>{order.number}</h1>
        <span className="price" style={{ fontSize: '1.25rem' }}>{order.total != null ? money(order.total) : 'Envío por cotizar'}</span>
      </div>

      <CollectBox order={order} />
      {order.demo && order.paymentMethod === 'online' && <div className="notice">Pago en línea simulado (demostración): no hubo cobro real.</div>}
      {order.needsReview && (
        <div className="notice error stack" role="alert">
          <p><strong>Requiere revisión:</strong> {order.needsReview}</p>
          <button className="btn secondary small" disabled={busy} onClick={() => act(`orders/${order.id}/review-clear`, {})}>Marcar como revisado</button>
        </div>
      )}
      {actionError && <div className="notice error" role="alert">{actionError}</div>}

      <section className="card stack">
        <h2>Estados</h2>
        <dl className="kv">
          <dt>Pago</dt>
          <dd>
            <span className={`badge ${paid ? 'ok' : 'warn'}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>{' '}
            <span className="muted small">{cod ? (order.fulfillment === 'pickup' ? 'paga al recoger' : 'paga al recibir') : 'en línea'}</span>
          </dd>
          <dt>Pedido</dt>
          <dd><span className="badge">{ORDER_LABEL[order.orderStatus]}</span></dd>
          <dt>Reembolso</dt>
          <dd>{REFUND_LABEL[order.refundStatus]}</dd>
        </dl>

        {order.orderStatus !== 'cancelado' && order.orderStatus !== 'cotizando_envio' && (
          <StatusFlow order={order} busy={busy} onSet={setStatus} />
        )}

        <div className="status-actions">
          {cod && !paid && order.orderStatus !== 'cotizando_envio' && order.orderStatus !== 'cancelado' && (
            <button className="btn secondary small" disabled={busy} onClick={() => act(`orders/${order.id}/collected`, {})}>
              {order.fulfillment === 'pickup' ? 'Solo marcar cobrado' : 'Solo marcar cobrado en efectivo'} {order.total != null && money(order.total)}
            </button>
          )}
          {order.orderStatus !== 'cancelado' && order.orderStatus !== 'entregado' && (!confirmCancel ? (
            <button className="linkbtn" disabled={busy} onClick={() => setConfirmCancel(true)}>
              Cancelar pedido
            </button>
          ) : (
            <div className="notice warn stack" style={{ width: '100%' }}>
              <p>
                {paid
                  ? 'Cancelar no reembolsa el pago. Deberás reembolsarlo en Mercado Pago y después marcarlo aquí como reembolsado.'
                  : '¿Seguro? El cliente verá su pedido como cancelado.'}
              </p>
              <div className="row">
                <button className="btn primary small" disabled={busy} onClick={() => act(`orders/${order.id}/status`, { status: 'cancelado' })}>Sí, cancelar</button>
                <button className="btn ghost small" onClick={() => setConfirmCancel(false)}>No</button>
              </div>
            </div>
          ))}
        </div>

        {(order.paymentStatus === 'aprobado' || order.paymentStatus === 'devuelto') && (
          <div className="field">
            <label htmlFor="refund">Estado del reembolso</label>
            <select id="refund" className="select" value={order.refundStatus} disabled={busy} onChange={(e) => act(`orders/${order.id}/refund`, { status: e.target.value as RefundStatus })}>
              <option value="no_aplica">Sin reembolso</option>
              <option value="pendiente">Reembolso pendiente</option>
              <option value="reembolsado">Reembolsado (ya se hizo en Mercado Pago)</option>
            </select>
          </div>
        )}
      </section>

      {order.orderStatus === 'en_camino' && order.fulfillment === 'delivery' && <CourierShare orderId={order.id} autoStart={shareNow} />}

      {order.orderStatus === 'cotizando_envio' && <ShippingQuoteForm order={order} busy={busy} onSubmit={(fee, etaText) => act(`orders/${order.id}/shipping`, { fee, etaText })} />}

      <section className="card stack">
        <h2>Productos</h2>
        <table>
          <tbody>
            {order.items.map((l, i) => (
              <tr key={i}>
                <td><strong>{l.qty}×</strong></td>
                <td>
                  {l.name} {!l.choices && <>· {l.sizeLabel}</>}
                  <LineDetails line={l} />
                </td>
                <td className="price" style={{ textAlign: 'right' }}>{money(l.lineTotal)}</td>
              </tr>
            ))}
            <tr><td /><td>Subtotal</td><td className="price" style={{ textAlign: 'right' }}>{money(order.subtotal)}</td></tr>
            <tr><td /><td>Envío</td><td className="price" style={{ textAlign: 'right' }}>{order.shippingFee == null ? 'Por cotizar' : money(order.shippingFee)}</td></tr>
          </tbody>
        </table>
        {order.notes && <p><strong>Notas:</strong> {order.notes}</p>}
      </section>

      <section className="card stack">
        <h2>{order.fulfillment === 'delivery' ? 'Entrega a domicilio' : 'Recoge en Frésia'}</h2>
        <dl className="kv">
          <dt>Cliente</dt>
          <dd>{order.customerName}</dd>
          <dt>Teléfono</dt>
          <dd><a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a></dd>
          {order.address && (
            <>
              <dt>Dirección</dt>
              <dd>{order.address.street} {order.address.number}, {order.address.colonia}, CP {order.address.postalCode}</dd>
              <dt>Oficina</dt>
              <dd>{order.address.office}</dd>
              {order.address.references && (<><dt>Referencias</dt><dd>{order.address.references}</dd></>)}
              <dt>Ubicación</dt>
              <dd>
                {order.address.location ? (
                  <>
                    GPS del cliente (±{order.address.location.accuracyM} m) ·{' '}
                    <a href={`https://www.google.com/maps?q=${order.address.location.lat},${order.address.location.lng}`} target="_blank" rel="noopener noreferrer">
                      Ver en mapa
                    </a>
                    <div className="muted small">Compárala con la dirección escrita antes de salir.</div>
                  </>
                ) : (
                  <span className="muted">No la compartió</span>
                )}
              </dd>
            </>
          )}
          <dt>Zona</dt>
          <dd>
            {order.deliveryQuote.status === 'covered' && `${order.deliveryQuote.zoneName} · ${order.deliveryQuote.etaMin}–${order.deliveryQuote.etaMax} min`}
            {order.deliveryQuote.status === 'quoted' && `Cotizado manualmente · ${order.deliveryQuote.etaText}`}
            {order.deliveryQuote.status === 'manual' && 'Requiere cotización'}
            {order.deliveryQuote.status === 'pickup' && 'Recoge en tienda'}
          </dd>
        </dl>
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Pagos</h2>
          <button className="btn ghost small" disabled={busy} onClick={() => act(`orders/${order.id}/reconcile`, {})}>Consultar estado</button>
        </div>
        {order.payments.length === 0 ? (
          <p className="muted">Sin pagos registrados.</p>
        ) : (
          <table>
            <thead><tr><th>Pago</th><th>Estado</th><th>Monto</th></tr></thead>
            <tbody>
              {order.payments.map((p) => (
                <tr key={p.id}>
                  <td className="small">{p.provider} · {p.id}<div className="muted">{formatDate(p.updatedAt)}</div></td>
                  <td>
                    {p.status}<div className="muted small">{p.statusDetail}</div>
                    {order.demo && p.status === 'pending' && (
                      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <button className="btn ghost small" disabled={busy} onClick={() => act(`demo/payments/${p.id}`, { status: 'approved' })}>Simular acreditado</button>
                        <button className="btn ghost small" disabled={busy} onClick={() => act(`demo/payments/${p.id}`, { status: 'rejected' })}>Simular rechazo</button>
                      </div>
                    )}
                  </td>
                  <td className="price">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Los reembolsos se hacen desde tu cuenta de Mercado Pago.</p>
      </section>

      <section className="card stack">
        <h2>Historial</h2>
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
          {order.events.map((e, i) => (
            <li key={i} className="small">
              <span className="muted">{formatDate(e.at)}</span> · <strong>{e.type}</strong> {e.detail} <span className="muted">({e.actor})</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ShippingQuoteForm({ order, busy, onSubmit }: { order: AdminOrder; busy: boolean; onSubmit: (fee: number, eta: string) => void }) {
  const [fee, setFee] = useState('');
  const [eta, setEta] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseMoney(fee);
        if (cents == null) return setErr('Escribe un importe válido, p. ej. 45 o 45.50');
        if (!eta.trim()) return setErr('Indica el tiempo estimado.');
        setErr(null);
        onSubmit(cents, eta.trim());
      }}
    >
      <h2>Cotizar envío</h2>
      <p className="muted small">CP {order.address?.postalCode}, {order.address?.colonia}. Al guardar, el cliente podrá pagar desde la página de su pedido.</p>
      <div className="two">
        <div className="field"><label htmlFor="fee">Costo de envío (MXN)</label><input id="fee" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
        <div className="field"><label htmlFor="eta">Tiempo estimado</label><input id="eta" className="input" placeholder="40–60 min" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
      </div>
      {err && <p className="error-text">{err}</p>}
      <button className="btn primary" disabled={busy}>Guardar cotización</button>
    </form>
  );
}
