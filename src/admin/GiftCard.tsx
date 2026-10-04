import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { LoadError, Spinner } from '../components/ui';
import { hourPhrase } from '../../shared/schedule';
import type { AdminOrder } from '../../shared/types';

/** Aviso en el detalle del pedido: para quién, tarjeta y cómo cobrar. */
export function GiftNotice({ order }: { order: AdminOrder }) {
  if (!order.gift) return null;
  const g = order.gift;
  const collectFirst = order.paymentMethod === 'contra_entrega' && order.paymentStatus !== 'aprobado';
  return (
    <section className="card stack gift-admin">
      <h2>🎁 Fresigrama</h2>
      <p><strong>Para:</strong> {g.to}</p>
      {g.note && <p><strong>Tarjeta:</strong> «{g.note}»</p>}
      {g.anonymous ? (
        <p className="notice warn small"><strong>Anónimo:</strong> no digas quién lo manda.</p>
      ) : (
        <p className="small muted">De: {order.customerName}</p>
      )}
      {collectFirst && (
        <p className="notice small">💵 Cobra primero a <strong>{order.customerName}</strong> (quien lo envía, tel. {order.customerPhone}) y después entrega el regalo.</p>
      )}
      <Link className="btn secondary small" to={`/admin/pedidos/${order.id}/tarjeta`}>🖨 Imprimir tarjeta</Link>
    </section>
  );
}

/** Tarjeta para imprimir (10 × 7 cm) con el QR «¿Quieres mandar uno?». */
export function GiftCardPrint() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    api<{ order: AdminOrder }>(`/api/admin/orders/${id}`).then((r) => setOrder(r.order), (e: Error) => setError(e.message));
    fetch('/api/admin/qr-sources/fresigrama/svg', { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : '')).then(setQr, () => setQr(''));
  }, [id]);
  if (error) return <LoadError message={error} retry={() => window.location.reload()} />;
  if (!order) return <Spinner label="Cargando tarjeta…" />;
  if (!order.gift) return <p>Este pedido no es un regalo.</p>;
  const g = order.gift;
  return (
    <div className="stack">
      <div className="row no-print" style={{ justifyContent: 'space-between' }}>
        <Link to={`/admin/pedidos/${order.id}`} className="btn ghost small">← Volver al pedido</Link>
        <button type="button" className="btn primary small" onClick={() => window.print()}>🖨 Imprimir</button>
      </div>
      <article className="print-card" aria-label="Tarjeta del regalo">
        <h1>♥ <em>Para mi bombón</em></h1>
        <p className="print-to">{g.to}</p>
        <p className="print-note">{g.note || `Alguien de esta oficina pensó en ti a ${hourPhrase(new Date())}.`}</p>
        <p className="print-from">De: {g.anonymous ? '¿adivina quién?' : order.customerName}</p>
        <div className="print-foot">
          <span>¿Quieres mandar uno?</span>
          {qr && <span className="print-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
        </div>
      </article>
      <p className="muted small no-print">Tamaño 10 × 7 cm. El QR lleva a la tienda y cuenta los pedidos que salen de las tarjetas (QR y sistema → «fresigrama»).</p>
    </div>
  );
}
