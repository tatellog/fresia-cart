import { money } from '../lib/format';
import type { Fulfillment, PricedLine, Product } from '../../shared/types';

export function OrderLines({ lines, products }: { lines: PricedLine[]; products: Product[] }) {
  return (
    <div>
      {lines.map((l, i) => {
        const p = products.find((x) => x.id === l.productId);
        return (
          <div key={i} className="line" style={{ gridTemplateColumns: p ? '56px 1fr' : '1fr' }}>
            {p && <img src={p.image} alt="" width={56} height={56} style={{ width: 56, height: 56 }} loading="lazy" />}
            <div className="details">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <p>
                  <strong>{l.qty} × {l.name}</strong> <span className="muted">· {l.sizeLabel}</span>
                </p>
                <span className="price">{money(l.lineTotal)}</span>
              </div>
              <p className="muted small">
                {money(l.basePrice)}
                {l.toppings.map((t) => ` · ${t.name} +${money(t.price)}`).join('')}
                {l.qty > 1 && ` · ${money(l.unitPrice)} c/u`}
              </p>
              {l.forWhom && <p className="for-whom">Para: {l.forWhom}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Totals({ subtotal, shippingFee, total, fulfillment }: { subtotal: number; shippingFee: number | null; total: number | null; fulfillment: Fulfillment }) {
  return (
    <section className="totals" aria-label="Total">
      <div className="row">
        <span>Subtotal</span>
        <span className="price">{money(subtotal)}</span>
      </div>
      <div className="row">
        <span>Envío</span>
        <span className="price">{fulfillment === 'pickup' ? 'Recoges en Frésia' : shippingFee == null ? 'Por confirmar' : shippingFee === 0 ? 'Sin costo' : money(shippingFee)}</span>
      </div>
      <div className="row grand">
        <span>Total</span>
        <span className="price">{total == null ? 'Por confirmar' : money(total)}</span>
      </div>
    </section>
  );
}
