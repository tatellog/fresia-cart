import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

  if (cart.lines.length === 0) {
    return (
      <>
        <DemoBanner />
        <main className="page stack-lg">
          <TopBar back="/" step="Carrito" />
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center', paddingTop: 40 }}>
            <h1>Tu carrito está vacío</h1>
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
  const minMsg = data && !exempt ? minimumMessage(cart.fresias, rules) : null;
  const makeGift = () => {
    save(GIFT_KEY, { ...loadStored(GIFT_KEY, emptyGift), on: true });
    setGift(true);
  };

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/" step="Carrito" />
        <h1>Tu pedido</h1>
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

        <div className="totals">
          <div className="row">
            <span>Subtotal</span>
            <span className="price">{money(cart.subtotal)}</span>
          </div>
          <p className="muted small">El envío se calcula con tu dirección en el siguiente paso.</p>
          {data?.delivery.deliveryEnabled && data.delivery.freeShippingFrom != null && (
            <p className={`small ${cart.subtotal >= data.delivery.freeShippingFrom ? 'ok-text' : ''}`}>
              {cart.subtotal >= data.delivery.freeShippingFrom
                ? '🎉 Tu pedido tiene envío gratis.'
                : `Te faltan ${money(data.delivery.freeShippingFrom - cart.subtotal)} para el envío gratis.`}
            </p>
          )}
        </div>

        {data && rules.minFresias > 1 && minMsg && (
          <div className="notice warn stack" role="status" style={{ gap: 8 }}>
            <p>
              <strong>{minMsg}</strong> Llevas {cart.fresias} de {rules.minFresias}. El pan de muerto y el waffle no cuentan.
            </p>
            {giftOn && (
              <p className="small">
                ¿Es un regalo?{' '}
                <button type="button" className="linklike" onClick={makeGift}>Mándalo como Fresigrama</button>: los regalos no tienen mínimo.
              </p>
            )}
          </div>
        )}
        {data && rules.minFresias > 1 && gift && cart.fresias < rules.minFresias && (
          <p className="notice small" role="status">🎁 Es un Fresigrama: no tiene pedido mínimo. Al final escribes para quién es.</p>
        )}

        <Link to="/" className="btn secondary block">Seguir comprando</Link>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" disabled={hasProblems || !data || !!minMsg} onClick={() => navigate('/entrega')}>
          {hasProblems ? 'Revisa los productos marcados' : minMsg ? `Mínimo ${rules.minFresias} Frésias` : 'Continuar a la entrega'}
        </button>
      </StickyAction>
    </>
  );
}
