import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMenu } from '../lib/menu';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import { DemoBanner, LoadError, Spinner, Stepper, StickyAction, TopBar } from '../components/ui';
import { MAX_FOR_WHOM } from '../../shared/pricing';

export default function ProductPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editId = params.get('linea');
  const navigate = useNavigate();
  const { data, error, reload } = useMenu();
  const cart = useCart();
  const editing = editId ? cart.lines.find((l) => l.lineId === editId) : undefined;

  const product = data?.products.find((p) => p.id === id);
  const toppings = useMemo(
    () => (product && data ? data.toppings.filter((t) => product.toppingIds.includes(t.id)) : []),
    [product, data],
  );

  const [sizeId, setSizeId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [forWhom, setForWhom] = useState('');

  useEffect(() => {
    if (!product) return;
    if (editing) {
      setSizeId(editing.sizeId);
      setChosen(editing.toppingIds);
      setQty(editing.qty);
      setForWhom(editing.forWhom ?? '');
    } else {
      setSizeId(product.sizes.length === 1 ? product.sizes[0].id : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, editing?.lineId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (error) return <main className="page"><TopBar back="/" /><LoadError message={error} retry={reload} /></main>;
  if (!data) return <main className="page"><TopBar back="/" /><Spinner label="Cargando…" /></main>;
  if (!product) {
    return (
      <main className="page stack">
        <TopBar back="/" />
        <p>No encontramos este producto.</p>
      </main>
    );
  }

  const size = product.sizes.find((s) => s.id === sizeId);
  const extras = toppings.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + t.price, 0);
  const unit = (size?.price ?? 0) + extras;
  const max = product.maxToppings;
  const atMax = max != null && chosen.length >= max;

  function toggle(tid: string) {
    setChosen((c) => (c.includes(tid) ? c.filter((x) => x !== tid) : atMax ? c : [...c, tid]));
  }

  function submit() {
    if (!size) {
      document.getElementById('size-legend')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const line = { productId: product!.id, sizeId: size.id, toppingIds: chosen, qty, forWhom: forWhom.trim() };
    if (editing) {
      cart.update(editing.lineId, line);
      navigate('/carrito');
    } else {
      cart.add(line);
      navigate('/', { state: { added: product!.name } });
    }
  }

  return (
    <>
      <DemoBanner />
      <main className="page">
        <TopBar back={editing ? '/carrito' : '/'} />
        <div className="product-hero">
          <img src={product.image} alt={product.name} width={600} height={600} />
        </div>
        <form
          className="stack-lg"
          style={{ marginTop: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="stack" style={{ gap: 6 }}>
            <div className="row between">
              <h1>{product.name}</h1>
              {product.example && <span className="badge example">Ejemplo</span>}
            </div>
            <p className="muted">{product.description}</p>
          </div>

          <fieldset>
            <legend id="size-legend" className="label">
              Tamaño {!size && <span className="muted small">· elige uno</span>}
            </legend>
            <div className="options">
              {product.sizes.map((s) => (
                <label key={s.id} className="option">
                  <input type="radio" name="size" value={s.id} checked={sizeId === s.id} onChange={() => setSizeId(s.id)} required />
                  <span className="mark" aria-hidden="true" />
                  <span className="grow">{s.label}</span>
                  <span className="price">{money(s.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {toppings.length > 0 && (
            <fieldset>
              <legend className="label">
                Toppings <span className="muted small">(opcional{max != null ? ` · hasta ${max}` : ''})</span>
              </legend>
              <div className="options">
                {toppings.map((t) => {
                  const on = chosen.includes(t.id);
                  const disabled = !t.available || (!on && atMax);
                  return (
                    <label key={t.id} className="option">
                      <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(t.id)} />
                      <span className="mark" aria-hidden="true" />
                      <span className="grow">
                        {t.name}
                        {!t.available && <span className="muted small"> · agotado</span>}
                      </span>
                      <span className="price muted">{t.price ? `+${money(t.price)}` : 'Sin costo'}</span>
                    </label>
                  );
                })}
              </div>
              {atMax && <p className="hint muted small" style={{ marginTop: 8 }} role="status">Llegaste al máximo de toppings.</p>}
            </fieldset>
          )}

          <div className="field">
            <label htmlFor="for-whom">
              ¿Para quién es? <span className="muted small">(opcional)</span>
            </label>
            <input
              id="for-whom"
              className="input"
              value={forWhom}
              onChange={(e) => setForWhom(e.target.value)}
              maxLength={MAX_FOR_WHOM}
              placeholder="Ej. Laura, Diseño"
              autoComplete="off"
            />
            <span className="hint">Te ayuda a repartir los pedidos del equipo.</span>
          </div>

          <div className="row between">
            <span className="label">Cantidad</span>
            <Stepper value={qty} onChange={setQty} label="Cantidad" />
          </div>
        </form>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" onClick={submit} style={{ justifyContent: 'space-between' }}>
          <span>{size ? (editing ? 'Guardar cambios' : 'Agregar al carrito') : 'Elige un tamaño'}</span>
          {size && <span className="price">{money(unit * qty)}</span>}
        </button>
      </StickyAction>
    </>
  );
}
