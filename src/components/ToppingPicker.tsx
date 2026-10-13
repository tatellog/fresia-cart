import type { MenuRules, Product, Topping } from '../../shared/types';
import { MAX_SAME_TOPPING } from '../../shared/pricing';
import { money } from '../lib/format';

/**
 * Lista de toppings que muestra el costo ANTES de elegir:
 * "Incluido" mientras queden incluidos, después el precio de adicional;
 * premium siempre con su precio (salvo los que el producto da sin cargo).
 * Un mismo topping se puede repetir (doble nuez) con − / +.
 */
export function ToppingPicker({
  product, toppings, rules, chosen, onChange, idPrefix = 't',
}: { product: Product; toppings: Topping[]; rules: MenuRules; chosen: string[]; onChange: (ids: string[]) => void; idPrefix?: string }) {
  const list = toppings.filter((t) => product.toppingIds.includes(t.id));
  if (list.length === 0) return null;
  const isPremium = (t: Topping) => t.premium && !product.freePremiumIds.includes(t.id);
  const regularIds = new Set(list.filter((t) => !isPremium(t)).map((t) => t.id));
  const regularChosen = chosen.filter((id) => regularIds.has(id));
  const includedLeft = Math.max(0, product.includedToppings - regularChosen.length);
  const max = product.maxToppings;
  const atMax = max != null && chosen.length >= max;
  const countOf = (id: string) => chosen.filter((x) => x === id).length;

  const regular = list.filter((t) => !isPremium(t));
  const premium = list.filter(isPremium);

  const add = (id: string) => !atMax && countOf(id) < MAX_SAME_TOPPING && onChange([...chosen, id]);
  const removeOne = (id: string) => {
    const i = chosen.lastIndexOf(id);
    if (i >= 0) onChange([...chosen.slice(0, i), ...chosen.slice(i + 1)]);
  };
  const removeAll = (id: string) => onChange(chosen.filter((x) => x !== id));

  /** Lo que cuesta lo elegido de este topping, o el siguiente si aún no se elige. */
  const priceFor = (t: Topping, n: number) => {
    if (isPremium(t)) return `+${money(t.price * Math.max(1, n))}`;
    if (n === 0) return includedLeft > 0 ? 'Incluido' : `+${money(rules.extraToppingPrice)}`;
    // Los primeros elegidos (en orden) son los incluidos.
    let included = 0;
    regularChosen.forEach((id, idx) => id === t.id && idx < product.includedToppings && included++);
    const extra = (n - included) * rules.extraToppingPrice;
    if (extra === 0) return n > 1 ? `${n} incluidos` : 'Incluido';
    return `+${money(extra)}`;
  };

  const group = (title: string, items: Topping[]) =>
    items.length > 0 && (
      <div className="options">
        {title && <p className="muted small" style={{ marginTop: 4 }}>{title}</p>}
        {items.map((t) => {
          const n = countOf(t.id);
          const on = n > 0;
          return (
            <div key={t.id} className={`option topping${on ? ' on' : ''}`}>
              <label className="topping-main">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!t.available || (!on && atMax)}
                  onChange={() => (on ? removeAll(t.id) : add(t.id))}
                  name={`${idPrefix}-${t.id}`}
                />
                <span className="mark" aria-hidden="true" />
                <span className="grow">
                  {t.name}
                  {!t.available && <span className="muted small"> · agotado</span>}
                </span>
              </label>
              {on && (
                <span className="topping-qty" role="group" aria-label={`Cantidad de ${t.name}`}>
                  <button type="button" onClick={() => removeOne(t.id)} aria-label={`Quitar una porción de ${t.name}`}>−</button>
                  <span aria-live="polite">×{n}</span>
                  <button type="button" onClick={() => add(t.id)} disabled={atMax || n >= MAX_SAME_TOPPING} aria-label={`Agregar otra porción de ${t.name}`}>+</button>
                </span>
              )}
              <span className={`price ${priceFor(t, n).startsWith('+') ? 'muted' : ''}`}>{priceFor(t, n)}</span>
            </div>
          );
        })}
      </div>
    );

  return (
    <fieldset className="stack" style={{ gap: 8 }}>
      <legend className="choice-legend">
        <span>Toppings</span>
        <span className={`req${product.includedToppings > 0 && includedLeft === 0 ? ' done' : ''}`}>
          {product.includedToppings > 0
            ? includedLeft === 0
              ? '✓ Incluidos elegidos'
              : `${includedLeft} incluido${includedLeft > 1 ? 's' : ''} por elegir`
            : 'Opcional'}
        </span>
      </legend>
      <p className="muted small" style={{ margin: '-6px 0 0' }}>
        {product.includedToppings > 0 ? `Adicionales ${money(rules.extraToppingPrice)} c/u. ` : ''}¿Doble porción? Elige el topping y toca +.
      </p>
      {group(premium.length ? 'Clásicos' : '', regular)}
      {group('Premium · no gastan tus incluidos', premium)}
    </fieldset>
  );
}
