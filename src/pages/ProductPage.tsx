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
import { activeGroup, memberKey, setActiveGroup } from '../lib/groupState';
import { ApiError, api } from '../lib/api';
import { uuid } from '../lib/uuid';
import { GroupModeBanner } from '../components/ui';
import { track, trackGroupJoin } from '../lib/analytics';

export default function ProductPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editId = params.get('linea');
  const navigate = useNavigate();
  const { data, error, reload } = useMenu();
  const cart = useCart();
  const editing = editId ? cart.lines.find((l) => l.lineId === editId) : undefined;

  const product = data?.products.find((p) => p.id === id);
  const popular = product ? data?.popular?.[product.id] : undefined;
  const group = activeGroup();
  const [adding, setAdding] = useState(false);
  // Mismo id si se reintenta: el servidor no duplica el producto en el pedido de equipo.
  const [itemId] = useState(uuid);
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

  useEffect(() => {
    if (product && !editing) track('ver_producto', { productId: product.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

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
        await api(`/api/groups/${group.code}/items`, { body: { memberName: group.memberName, memberKey: memberKey(group.code), line, itemId } });
        trackGroupJoin(group.code);
        track('agregar_carrito', { mode: 'equipo', productId: product!.id });
        navigate(`/equipo/${group.code}`);
      } catch (e) {
        setAddError((e as Error).message);
        if (e instanceof ApiError && e.body.code === 'group_closed') setActiveGroup(null);
        setAdding(false);
      }
      return;
    }
    if (editing) {
      cart.update(editing.lineId, line);
      navigate('/carrito');
    } else {
      cart.add(line);
      track('agregar_carrito', { productId: product!.id });
      navigate('/', { state: { added: product!.name } });
    }
  }

  return (
    <>
      <DemoBanner />
      <main className="page">
        <TopBar back={editing ? '/carrito' : '/'} cart={!group} />
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
          <div className="product-title">
            {product.example && <span className="badge example">Ejemplo</span>}
            <h1>{product.name}</h1>
            <p className="from">{product.sizes.length > 1 ? 'Desde ' : ''}{money(Math.min(...product.sizes.map((s) => s.price)))}</p>
            {product.description && <p className="muted">{product.description}</p>}
          </div>

          <fieldset className="choice-group">
            <legend id="size-legend" className="choice-legend">
              <span>Tamaño</span>
              <span className={`req${size ? ' done' : ''}`}>{size ? '✓ Listo' : 'Elige uno'}</span>
            </legend>
            <div className={`size-grid cols-${Math.min(product.sizes.length, 3)}`}>
              {product.sizes.map((s) => {
                const [name, ...rest] = s.label.split(' ');
                return (
                  <label key={s.id} className="option size-card">
                    <input type="radio" name="size" value={s.id} checked={sizeId === s.id} onChange={() => setSizeId(s.id)} required />
                    {popular?.sizeId === s.id && <span className="pop-tag">⭐ Más pedido</span>}
                    <strong>{name}</strong>
                    {rest.length > 0 && <span className="muted small">{rest.join(' ')}</span>}
                    <span className="price">{money(s.price)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <ToppingPicker product={product} toppings={data.toppings} rules={rules} chosen={chosen} onChange={setChosen} popular={popular?.toppingIds} />

          {!group && <ForWhom value={forWhom} onChange={setForWhom} />}
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
        <button type="button" className="btn primary block" disabled={adding || !size} onClick={() => void submit()} style={{ justifyContent: 'space-between' }}>
          <span>{adding ? 'Agregando…' : size ? (editing ? 'Guardar cambios' : group ? 'Agregar al pedido del equipo' : 'Agregar al carrito') : 'Elige un tamaño'}</span>
          {size && <span className="price">{money(unit * Math.max(qty, minQty(product)))}</span>}
        </button>
      </StickyAction>
    </>
  );
}

/** «¿Para quién es?» plegado: útil para repartir, pero opcional. */
function ForWhom({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  if (!open) return <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ ¿Para quién es? (para repartirlo)</button>;
  return (
    <div className="field">
      <label htmlFor="for-whom">¿Para quién es? <span className="muted small">(opcional)</span></label>
      <input id="for-whom" className="input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={MAX_FOR_WHOM} placeholder="Ej. Laura, Diseño" autoComplete="off" autoFocus={value === ''} />
    </div>
  );
}

