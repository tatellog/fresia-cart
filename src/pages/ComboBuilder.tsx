import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMenu } from '../lib/menu';
import { useCart } from '../lib/cart';
import type { CartLine } from '../lib/cart';
import { money } from '../lib/format';
import { DEFAULT_RULES_CLIENT } from '../lib/rules';
import { DemoBanner, Stepper, StickyAction, TopBar } from '../components/ui';
import { ToppingPicker } from '../components/ToppingPicker';
import { COMBO_SIZE_ID, MAX_FOR_WHOM, priceCart } from '../../shared/pricing';
import { activeGroup, memberKey } from '../lib/groupState';
import { api } from '../lib/api';
import { GroupModeBanner } from '../components/ui';
import type { ComboChoiceInput, Product } from '../../shared/types';

type Pick = ComboChoiceInput & { key: string };

/** Arma un combo: para cada pieza el cliente elige sabor/tamaño permitido y sus toppings. */
export default function ComboBuilder({ product, editing }: { product: Product; editing?: CartLine }) {
  const { data } = useMenu();
  const cart = useCart();
  const navigate = useNavigate();
  const rules = data?.rules ?? DEFAULT_RULES_CLIENT;
  const slots = product.combo ?? [];

  const [picks, setPicks] = useState<Pick[]>(() =>
    slots.flatMap((slot) =>
      Array.from({ length: slot.qty }, (_, i) => {
        const prev = editing?.choices?.filter((c) => c.slotId === slot.id)[i];
        const only = slot.options.length === 1 ? slot.options[0] : null;
        return {
          key: `${slot.id}:${i}`,
          slotId: slot.id,
          productId: prev?.productId ?? only?.productId ?? '',
          sizeId: prev?.sizeId ?? only?.sizeId ?? '',
          toppingIds: prev?.toppingIds ?? [],
        };
      }),
    ),
  );
  const [qty, setQty] = useState(editing?.qty ?? 1);
  const [forWhom, setForWhom] = useState(editing?.forWhom ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const group = activeGroup();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const complete = picks.every((p) => p.productId && p.sizeId);
  const choices: ComboChoiceInput[] = picks.map(({ slotId, productId, sizeId, toppingIds }) => ({ slotId, productId, sizeId, toppingIds }));
  const unit = useMemo(() => {
    if (!data || !complete) return product.sizes[0]?.price ?? 0;
    const r = priceCart([{ productId: product.id, sizeId: COMBO_SIZE_ID, toppingIds: [], choices, qty: 1 }], data.products, data.toppings, rules);
    return r.lines[0]?.unitPrice ?? product.sizes[0]?.price ?? 0;
  }, [data, complete, choices, product, rules]);

  if (!data) return null;
  const byId = new Map(data.products.map((p) => [p.id, p]));
  const set = (key: string, patch: Partial<Pick>) => setPicks((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function submit() {
    if (!complete) {
      setShowErrors(true);
      document.querySelector('[data-incomplete="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const line = { productId: product.id, sizeId: COMBO_SIZE_ID, toppingIds: [], choices, qty, forWhom: forWhom.trim() };
    if (group && !editing) {
      setAdding(true);
      setAddError(null);
      api(`/api/groups/${group.code}/items`, { body: { memberName: group.memberName, memberKey: memberKey(), line } }).then(
        () => navigate(`/equipo/${group.code}`),
        (e: Error) => {
          setAddError(e.message);
          setAdding(false);
        },
      );
      return;
    }
    if (editing) {
      cart.update(editing.lineId, line);
      navigate('/carrito');
    } else {
      cart.add(line);
      navigate('/', { state: { added: product.name } });
    }
  }

  return (
    <>
      <DemoBanner />
      <main className="page">
        <TopBar back={editing ? '/carrito' : '/'} />
        <GroupModeBanner />
        {product.image && (
          <div className="product-hero">
            <img src={product.image} alt={product.name} width={600} height={600} />
          </div>
        )}
        <div className="stack-lg" style={{ marginTop: 24 }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row between">
              <h1>{product.name}</h1>
              {product.example && <span className="badge example">Ejemplo</span>}
            </div>
            <p className="muted">{product.description}</p>
            <p className="price">{money(product.sizes[0]?.price ?? 0)}</p>
          </div>

          {slots.map((slot) => {
            const mine = picks.filter((p) => p.slotId === slot.id);
            return mine.map((pick, i) => {
              const chosen = byId.get(pick.productId);
              const missing = showErrors && !pick.productId;
              return (
                <section key={pick.key} className="card stack" data-incomplete={missing || undefined} aria-labelledby={`h-${pick.key}`}>
                  <h2 id={`h-${pick.key}`} style={{ fontSize: '1.05rem' }}>
                    {slot.label} {slot.qty > 1 && <span className="muted">· {i + 1} de {slot.qty}</span>}
                  </h2>
                  {slot.options.length > 1 && (
                    <fieldset>
                      <legend className="sr-only">Elige para {slot.label} {i + 1}</legend>
                      <div className="options">
                        {slot.options.map((o) => {
                          const p = byId.get(o.productId);
                          const size = p?.sizes.find((z) => z.id === o.sizeId);
                          if (!p || !size) return null;
                          return (
                            <label key={`${o.productId}-${o.sizeId}`} className="option">
                              <input
                                type="radio"
                                name={pick.key}
                                checked={pick.productId === o.productId && pick.sizeId === o.sizeId}
                                disabled={!p.available}
                                onChange={() => set(pick.key, { productId: o.productId, sizeId: o.sizeId, toppingIds: [] })}
                              />
                              <span className="mark" aria-hidden="true" />
                              <span className="grow">
                                {p.name} <span className="muted small">· {size.label}</span>
                                {!p.available && <span className="muted small"> · agotado</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  {slot.options.length === 1 && chosen && (
                    <p>{chosen.name} <span className="muted">· {chosen.sizes.find((z) => z.id === pick.sizeId)?.label}</span></p>
                  )}
                  {missing && <p className="error-text" role="alert">Elige una opción.</p>}
                  {chosen && chosen.toppingIds.length > 0 && (
                    <details className="toppings-toggle">
                      <summary className="row between">
                        <span>
                          {pick.toppingIds.length
                            ? pick.toppingIds.map((id) => data.toppings.find((t) => t.id === id)?.name).filter(Boolean).join(', ')
                            : `Elegir toppings · ${chosen.includedToppings} incluido${chosen.includedToppings === 1 ? '' : 's'}`}
                        </span>
                        <span className="linkbtn" aria-hidden="true">{pick.toppingIds.length ? 'Cambiar' : 'Elegir'}</span>
                      </summary>
                      <div style={{ marginTop: 12 }}>
                        <ToppingPicker
                          product={chosen}
                          toppings={data.toppings}
                          rules={rules}
                          chosen={pick.toppingIds}
                          onChange={(toppingIds) => set(pick.key, { toppingIds })}
                          idPrefix={pick.key}
                        />
                      </div>
                    </details>
                  )}
                </section>
              );
            });
          })}

          <div className="field">
            <label htmlFor="for-whom">
              ¿Para quién es? <span className="muted small">(opcional)</span>
            </label>
            <input id="for-whom" className="input" value={forWhom} onChange={(e) => setForWhom(e.target.value)} maxLength={MAX_FOR_WHOM} placeholder="Ej. Equipo de Ventas" autoComplete="off" />
          </div>
          {addError && <p className="error-text" role="alert">{addError}</p>}
          <div className="row between">
            <span className="label">Cantidad de combos</span>
            <Stepper value={qty} onChange={setQty} label="Cantidad de combos" />
          </div>
        </div>
      </main>
      <StickyAction>
        <button type="button" className="btn primary block" onClick={submit} style={{ justifyContent: 'space-between' }}>
          <span>{adding ? 'Agregando…' : complete ? (editing ? 'Guardar cambios' : group ? 'Agregar al pedido del equipo' : 'Agregar al carrito') : 'Completa tu combo'}</span>
          <span className="price">{money(unit * qty)}</span>
        </button>
      </StickyAction>
    </>
  );
}
