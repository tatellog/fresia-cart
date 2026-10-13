import type { MenuRules, Product, Topping } from '../../shared/types';
import { money } from '../lib/format';

/**
 * Lista de toppings que muestra el costo de cada uno ANTES de elegirlo:
 * "Incluido" mientras queden incluidos, después el precio de adicional;
 * premium siempre con su precio (salvo los que el producto da sin cargo).
 */
export function ToppingPicker({
  product, toppings, rules, chosen, onChange, idPrefix = 't',
}: { product: Product; toppings: Topping[]; rules: MenuRules; chosen: string[]; onChange: (ids: string[]) => void; idPrefix?: string }) {
  const list = toppings.filter((t) => product.toppingIds.includes(t.id));
  if (list.length === 0) return null;
  const isPremium = (t: Topping) => t.premium && !product.freePremiumIds.includes(t.id);
  const usedIncluded = chosen.filter((id) => {
    const t = list.find((x) => x.id === id);
    return t && !isPremium(t);
  }).length;
  const includedLeft = Math.max(0, product.includedToppings - usedIncluded);
  const max = product.maxToppings;
  const atMax = max != null && chosen.length >= max;

  const regular = list.filter((t) => !isPremium(t));
  const premium = list.filter(isPremium);

  const priceFor = (t: Topping, on: boolean) => {
    if (isPremium(t)) return `+${money(t.price)}`;
    if (on) {
      // Los primeros elegidos son los incluidos.
      const idx = chosen.filter((id) => regular.some((r) => r.id === id)).indexOf(t.id);
      return idx < product.includedToppings ? 'Incluido' : `+${money(rules.extraToppingPrice)}`;
    }
    return includedLeft > 0 ? 'Incluido' : `+${money(rules.extraToppingPrice)}`;
  };

  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : atMax ? chosen : [...chosen, id]);

  const group = (title: string, items: Topping[]) =>
    items.length > 0 && (
      <div className="options">
        {title && <p className="muted small" style={{ marginTop: 4 }}>{title}</p>}
        {items.map((t) => {
          const on = chosen.includes(t.id);
          return (
            <label key={t.id} className="option">
              <input type="checkbox" checked={on} disabled={!t.available || (!on && atMax)} onChange={() => toggle(t.id)} name={`${idPrefix}-${t.id}`} />
              <span className="mark" aria-hidden="true" />
              <span className="grow">
                {t.name}
                {!t.available && <span className="muted small"> · agotado</span>}
              </span>
              <span className={`price ${priceFor(t, on) === 'Incluido' ? '' : 'muted'}`}>{priceFor(t, on)}</span>
            </label>
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
      {product.includedToppings > 0 && <p className="muted small" style={{ margin: '-6px 0 0' }}>Adicionales {money(rules.extraToppingPrice)} c/u.</p>}
      {group(premium.length ? 'Clásicos' : '', regular)}
      {group('Premium · no gastan tus incluidos', premium)}
    </fieldset>
  );
}
