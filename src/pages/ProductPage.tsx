import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMenu } from '../lib/menu';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import { DemoBanner, LoadError, Spinner, Stepper, StickyAction, TopBar } from '../components/ui';
import { MAX_FOR_WHOM, minQtyFor, priceToppings } from '../../shared/pricing';
import { ToppingPicker } from '../components/ToppingPicker';
import { DEFAULT_RULES_CLIENT } from '../lib/rules';
import ComboBuilder from './ComboBuilder';
import { activeGroup, memberKey } from '../lib/groupState';
import { api } from '../lib/api';
import { GroupModeBanner } from '../components/ui';

export default function ProductPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editId = params.get('linea');
  const navigate = useNavigate();
  const { data, error, reload } = useMenu();
  const cart = useCart();
  const editing = editId ? cart.lines.find((l) => l.lineId === editId) : undefined;

  const product = data?.products.find((p) => p.id === id);
  const group = activeGroup();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // En pedido de equipo cada quien pide desde 1 pieza.
  const minQty = (p: NonNullable<typeof product>) => (group ? 1 : minQtyFor(p, rules));
  const rules = data?.rules ?? DEFAULT_RULES_CLIENT;
  const byTopping = useMemo(() => new Map((data?.toppings ?? []).map((t) => [t.id, t])), [data]);

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
      setQty(minQty(product));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, editing?.lineId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (error) return <main className="page"><TopBar back="/" /><LoadError message={error} retry={reload} /></main>;
  if (!data) return <main className="page"><TopBar back="/" /><Spinner label="Cargando…" /></main>;
  if (!product || !product.available) {
    return (
      <main className="page stack">
        <TopBar back="/" />
        <p>{product ? 'Este producto está agotado por hoy.' : 'No encontramos este producto.'}</p>
      </main>
    );
  }
  if (product.combo) return <ComboBuilder product={product} editing={editing} />;

  const size = product.sizes.find((s) => s.id === sizeId);
  let extras = 0;
  try {
    extras = priceToppings(product, chosen, byTopping, rules).reduce((s, t) => s + t.price, 0);
  } catch {
    extras = 0;
  }
  const unit = (size?.price ?? 0) + extras;

  async function submit() {
    if (!size) {
      document.getElementById('size-legend')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const line = { productId: product!.id, sizeId: size.id, toppingIds: chosen, qty: Math.max(qty, minQty(product!)), forWhom: forWhom.trim() };
    if (group && !editing) {
      setAdding(true);
      setAddError(null);
      try {
        await api(`/api/groups/${group.code}/items`, { body: { memberName: group.memberName, memberKey: memberKey(), line } });
        navigate(`/equipo/${group.code}`);
      } catch (e) {
        setAddError((e as Error).message);
        setAdding(false);
      }
      return;
    }
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
        <GroupModeBanner />
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
              {product.sizes.length === 1 && product.fresiaUnits > 0 && <p className="muted small">Solo disponible en este tamaño.</p>}
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

          <ToppingPicker product={product} toppings={data.toppings} rules={rules} chosen={chosen} onChange={setChosen} />

          {!group && <div className="field">
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
          </div>}
          {addError && <p className="error-text" role="alert">{addError}</p>}

          <div className="row between">
            <span className="label">
              Cantidad {minQty(product) > 1 && <span className="muted small">· mínimo {minQty(product)}</span>}
            </span>
            <Stepper value={Math.max(qty, minQty(product))} onChange={setQty} min={minQty(product)} label="Cantidad" />
          </div>
        </form>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" disabled={adding} onClick={() => void submit()} style={{ justifyContent: 'space-between' }}>
          <span>{adding ? 'Agregando…' : size ? (editing ? 'Guardar cambios' : group ? 'Agregar al pedido del equipo' : 'Agregar al carrito') : 'Elige un tamaño'}</span>
          {size && <span className="price">{money(unit * Math.max(qty, minQty(product)))}</span>}
        </button>
      </StickyAction>
    </>
  );
}
