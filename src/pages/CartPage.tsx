import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useMenu } from '../lib/menu';
import { money } from '../lib/format';
import { DemoBanner, Spinner, Stepper, StickyAction, TopBar } from '../components/ui';

export default function CartPage() {
  const cart = useCart();
  const { data } = useMenu();
  const navigate = useNavigate();

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
              const size = p?.sizes.find((s) => s.id === l.sizeId);
              const tops = data.toppings.filter((t) => l.toppingIds.includes(t.id));
              const unit = (size?.price ?? 0) + tops.reduce((s, t) => s + t.price, 0);
              const problem = cart.problems.get(l.lineId);
              return (
                <article key={l.lineId} className="line">
                  <img src={p?.image ?? '/brand/fresia-puerta.svg'} alt="" width={72} height={72} loading="lazy" />
                  <div className="details">
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <h2 style={{ fontSize: '1rem' }}>
                        {p?.name ?? 'Producto no disponible'} {size && <span className="muted" style={{ fontWeight: 400 }}>· {size.label}</span>}
                      </h2>
                      <span className="price">{money(unit * l.qty)}</span>
                    </div>
                    {tops.length > 0 && (
                      <p className="muted small">
                        {tops.map((t) => `${t.name} +${money(t.price)}`).join(' · ')}
                      </p>
                    )}
                    {l.forWhom && <p className="for-whom">Para: {l.forWhom}</p>}
                    {problem && <p className="error-text" role="alert">{problem}</p>}
                    <div className="row between" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <Stepper value={l.qty} onChange={(qty) => cart.update(l.lineId, { qty })} label={`Cantidad de ${p?.name ?? 'producto'}`} />
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
        </div>

        <Link to="/" className="btn secondary block">Seguir comprando</Link>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" disabled={hasProblems || !data} onClick={() => navigate('/entrega')}>
          {hasProblems ? 'Revisa los productos marcados' : 'Continuar a la entrega'}
        </button>
      </StickyAction>
    </>
  );
}
