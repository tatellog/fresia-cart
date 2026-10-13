import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { money } from '../lib/format';
import { DemoBanner, Spinner, Stepper, StickyAction, TopBar } from '../components/ui';
import { minQtyFor, minimumMessage, priceCart } from '../../shared/pricing';
import { DEFAULT_RULES_CLIENT } from '../lib/rules';
import { LineDetails } from './parts';
import { GIFT_KEY, emptyGift } from '../components/GiftFields';
import { load as loadStored, save } from '../lib/storage';
import { groupCheckout } from '../lib/groupState';

export default function CartPage() {
  const cart = useCart();
  const { data } = useMenu();
  const navigate = useNavigate();
  const [giftStored, setGift] = useState(() => loadStored(GIFT_KEY, emptyGift).on);
  const repeatNotes = (useLocation().state as { repeatNotes?: string[] } | null)?.repeatNotes ?? [];

  if (cart.lines.length === 0) {
    return (
      <>
        <DemoBanner />
        <main className="page stack-lg">
          <TopBar back="/" step="Carrito" />
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center', paddingTop: 40 }}>
            <h1>Tu carrito está vacío</h1>
            {repeatNotes.length > 0 && <div className="notice warn" role="status">{repeatNotes.join(' ')}</div>}
            <p className="muted">Elige algo rico para ti o tu equipo.</p>
            <Link to="/" className="btn primary">Ver menú</Link>
          </div>
        </main>
      </>
    );
  }

  const hasProblems = cart.problems.size > 0;
  const rules = data?.rules ?? DEFAULT_RULES_CLIENT;
  const giftOn = !!data?.features?.fresigrama;
  const gift = giftOn && giftStored;
  // Fresigrama, pedido de equipo o pedido con combo: sin mínimo.
  const hasCombo = cart.lines.some((l) => data?.products.find((p) => p.id === l.productId)?.combo);
  const exempt = gift || !!groupCheckout() || hasCombo;
  const minMsg = data && !exempt ? minimumMessage(cart.count, rules) : null;
  const makeGift = () => {
    save(GIFT_KEY, { ...loadStored(GIFT_KEY, emptyGift), on: true });
    setGift(true);
  };

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/" />
        <div className="page-title">
          <h1>Tu pedido</h1>
          <span className="muted">{cart.count} producto{cart.count === 1 ? '' : 's'}</span>
        </div>
        {repeatNotes.length > 0 && (
          <div className="notice warn" role="status">
            <strong>Revisa tu pedido repetido:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: '1.2em' }}>{repeatNotes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
        {!data ? (
          <Spinner label="Cargando…" />
        ) : (
          <section aria-label="Productos" className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {cart.lines.map((l) => {
              const p = data.products.find((x) => x.id === l.productId);
              const priced = priceCart([l], data.products, data.toppings, rules).lines[0];
              const problem = cart.problems.get(l.lineId);
              return (
                <article key={l.lineId} className="line">
                  <img src={p?.image ?? '/brand/fresia-puerta.svg'} alt="" width={72} height={72} loading="lazy" />
                  <div className="details">
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <h2 style={{ fontSize: '1rem' }}>
                        {p?.name ?? 'Producto no disponible'} {priced && !priced.choices && <span className="muted" style={{ fontWeight: 400 }}>· {priced.sizeLabel}</span>}
                      </h2>
                      {priced && <span className="price">{money(priced.lineTotal)}</span>}
                    </div>
                    {priced && <LineDetails line={priced} />}
                    {problem && <p className="error-text" role="alert">{problem}</p>}
                    <div className="row between" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <Stepper value={l.qty} min={p ? minQtyFor(p, rules) : 1} onChange={(qty) => cart.update(l.lineId, { qty })} label={`Cantidad de ${p?.name ?? 'producto'}`} />
                      <div className="row" style={{ gap: 16 }}>
                        {p && (
                          <Link to={`/producto/${p.id}?linea=${l.lineId}`} className="linkbtn" style={{ display: 'inline-flex', alignItems: 'center' }}>
                            Editar
                          </Link>
                        )}
                        <button type="button" className="linkbtn" onClick={() => cart.remove(l.lineId)}>
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <section className="card summary-card" aria-label="Resumen">
          <div className="row between">
            <span>Subtotal</span>
            <span className="price big">{money(cart.subtotal)}</span>
          </div>
          {data?.delivery.deliveryEnabled && data.delivery.freeShippingFrom != null && (
            <FreeShipping subtotal={cart.subtotal} from={data.delivery.freeShippingFrom} />
          )}
          <p className="muted small">El envío se calcula con tu dirección en el siguiente paso.</p>
        </section>

        {data && rules.minFresias > 1 && minMsg && (
          <div className="notice warn stack" role="status" style={{ gap: 8 }}>
            <p>
              <strong>{minMsg}</strong> Llevas {cart.count} de {rules.minFresias}; cuenta cualquier producto del menú.
            </p>
            {giftOn && (
              <p className="small">
                ¿Es un regalo?{' '}
                <button type="button" className="linklike" onClick={makeGift}>Mándalo como Fresigrama</button>: los regalos no tienen mínimo.
              </p>
            )}
          </div>
        )}
        {data && rules.minFresias > 1 && gift && cart.count < rules.minFresias && (
          <p className="notice small" role="status">🎁 Es un Fresigrama: no tiene pedido mínimo. Al final escribes para quién es.</p>
        )}

        <Link to="/" className="linkbtn" style={{ alignSelf: 'center' }}>+ Agregar más productos</Link>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" disabled={hasProblems || !data || !!minMsg} onClick={() => navigate('/entrega')}>
          {hasProblems ? 'Revisa los productos marcados' : minMsg ? `Mínimo ${rules.minFresias} productos` : 'Continuar a la entrega'}
        </button>
      </StickyAction>
    </>
  );
}

/** Barra de avance hacia el envío gratis. */
function FreeShipping({ subtotal, from }: { subtotal: number; from: number }) {
  const done = subtotal >= from;
  const pct = Math.min(100, Math.round((subtotal / from) * 100));
  return (
    <div className="free-ship">
      <p className={`small ${done ? 'ok-text' : ''}`} style={{ margin: 0 }}>
        {done ? '🎉 Tu pedido tiene envío gratis.' : <>Te faltan <strong>{money(from - subtotal)}</strong> para el envío gratis.</>}
      </p>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avance al envío gratis">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

