import { money } from '../lib/format';
import type { Fulfillment, PricedLine, PricedTopping, Product } from '../../shared/types';

export const toppingText = (ts: PricedTopping[]) => ts.map((t) => `${t.name} ${t.included ? '(incluido)' : `+${money(t.price)}`}`).join(' · ');

/** Toppings, contenido del combo y destinatario de un renglón. */
export function LineDetails({ line }: { line: PricedLine }) {
  return (
    <>
      {line.choices ? (
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          {line.choices.map((c, i) => (
            <li key={i}>
              {c.name} · {c.sizeLabel}
              {c.toppings.length > 0 && <> — {toppingText(c.toppings)}</>}
            </li>
          ))}
        </ul>
      ) : (
        line.toppings.length > 0 && <p className="muted small">{toppingText(line.toppings)}</p>
      )}
      {line.forWhom && <p className="for-whom">Para: {line.forWhom}</p>}
    </>
  );
}

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
                  <strong>{l.qty} × {l.name}</strong> {!l.choices && <span className="muted">· {l.sizeLabel}</span>}
                </p>
                <span className="price">{money(l.lineTotal)}</span>
              </div>
              <LineDetails line={l} />
              {l.qty > 1 && <p className="muted small">{money(l.unitPrice)} c/u</p>}
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
        <span className="price">{fulfillment === 'pickup' ? 'Recoges en Frésia' : shippingFee == null ? 'Por confirmar' : shippingFee === 0 ? 'Gratis' : money(shippingFee)}</span>
      </div>
      <div className="row grand">
        <span>Total</span>
        <span className="price">{total == null ? 'Por confirmar' : money(total)}</span>
      </div>
    </section>
  );
}
