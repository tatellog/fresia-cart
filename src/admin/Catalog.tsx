import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { LoadError, Spinner } from '../components/ui';
import { MoneyInput, SaveBar, Toggle, slug } from './fields';
import type { ComboSlot, MenuRules, Product, Topping } from '../../shared/types';

type CatalogRes = { products: Product[]; toppings: Topping[]; images: string[] };

export default function Catalog() {
  const [data, setData] = useState<CatalogRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<CatalogRes>('/api/admin/catalog').then(setData, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  if (error) return <LoadError message={error} retry={load} />;
  if (!data) return <Spinner label="Cargando…" />;

  const nextSort = (data.products.at(-1)?.sort ?? 0) + 10;
  const blank = (combo: boolean): Product => ({
    id: `${combo ? 'combo' : 'producto'}-${Date.now().toString(36)}`, name: combo ? 'Nuevo combo' : 'Nuevo producto', description: '',
    image: data.images[0] ?? '', section: combo ? 'Combos' : 'Frésias', sizes: [{ id: combo ? 'combo' : 'pieza', label: combo ? 'Combo' : 'Pieza', price: 0 }],
    toppingIds: [], includedToppings: combo ? 0 : 2, freePremiumIds: [], maxToppings: null, fresiaUnits: combo ? 0 : 1,
    combo: combo ? [] : null, available: false, sort: combo ? 1 : nextSort, example: false,
  });
  const newTopping = (): Topping => ({ id: `topping-${Date.now().toString(36)}`, name: 'Nuevo topping', price: 0, premium: false, available: false, sort: (data.toppings.at(-1)?.sort ?? 0) + 1, example: false });

  const combos = data.products.filter((p) => p.combo);
  const items = data.products.filter((p) => !p.combo);

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Menú</h1>
        <p className="muted">Los cambios se ven en el menú al instante; el QR no cambia. Los precios se recalculan en el servidor al cobrar.</p>
      </div>

      <RulesEditor />

      <section className="stack">
        <div className="row between">
          <h2>Combos</h2>
          <button className="btn ghost small" onClick={() => setData({ ...data, products: [...data.products, blank(true)] })}>+ Agregar combo</button>
        </div>
        {combos.length === 0 && <p className="muted">Aún no hay combos.</p>}
        {combos.map((p) => (
          <ProductEditor key={p.id} initial={p} products={items} toppings={data.toppings} images={data.images} onDeleted={load} />
        ))}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Productos</h2>
          <button className="btn ghost small" onClick={() => setData({ ...data, products: [...data.products, blank(false)] })}>+ Agregar producto</button>
        </div>
        {items.map((p) => (
          <ProductEditor key={p.id} initial={p} products={items} toppings={data.toppings} images={data.images} onDeleted={load} />
        ))}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Toppings</h2>
          <button className="btn ghost small" onClick={() => setData({ ...data, toppings: [...data.toppings, newTopping()] })}>+ Agregar topping</button>
        </div>
        <p className="muted small">Los normales usan el precio de adicional de las reglas cuando ya no van incluidos. Los premium siempre cobran su precio.</p>
        <div className="card stack">
          {data.toppings.map((t) => (
            <ToppingEditor key={t.id} initial={t} onDeleted={load} />
          ))}
        </div>
      </section>
    </div>
  );
}

function useSaver<T>(initial: T, url: (v: T) => string) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(url(value), { method: 'PUT', body: value });
      setSaved(value);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return { value, setValue, busy, error, dirty, save, everSaved: saved !== initial };
}

function RulesEditor() {
  const [rules, setRules] = useState<MenuRules | null>(null);
  useEffect(() => void api<MenuRules>('/api/admin/rules').then(setRules), []);
  if (!rules) return null;
  return <RulesForm initial={rules} />;
}

function RulesForm({ initial }: { initial: MenuRules }) {
  const s = useSaver(initial, () => '/api/admin/rules');
  return (
    <section className="card stack">
      <h2>Reglas</h2>
      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="field" style={{ width: 200 }}>
          <label>Mínimo de Frésias por pedido (0 = sin mínimo)</label>
          <input className="input sm" inputMode="numeric" value={s.value.minFresias} onChange={(e) => s.setValue({ ...s.value, minFresias: parseInt(e.target.value, 10) || 0 })} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>Mínimo por producto</label>
          <input className="input sm" inputMode="numeric" value={s.value.minQtyPerItem} onChange={(e) => s.setValue({ ...s.value, minQtyPerItem: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>Topping adicional</label>
          <MoneyInput label="Topping adicional" value={s.value.extraToppingPrice} onChange={(extraToppingPrice) => s.setValue({ ...s.value, extraToppingPrice })} />
        </div>
      </div>
      <p className="muted small">Cuenta para el mínimo lo que indica «Frésias por pieza» de cada producto (vasos 1; pan y waffle 0). Un combo suma las Frésias que incluye. Los productos sueltos se piden desde el «mínimo por producto»; los combos desde 1.</p>
      <SaveBar busy={s.busy} saved={s.everSaved} error={s.error} dirty={s.dirty} onSave={s.save} />
    </section>
  );
}

function ProductEditor({ initial, products, toppings, images, onDeleted }: { initial: Product; products: Product[]; toppings: Topping[]; images: string[]; onDeleted: () => void }) {
  const s = useSaver(initial, (p) => `/api/admin/products/${p.id}`);
  const p = s.value;
  const set = (patch: Partial<Product>) => s.setValue({ ...p, ...patch });
  const [confirmDel, setConfirmDel] = useState(false);
  const isCombo = !!p.combo;
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  return (
    <details className="card editor">
      <summary className="row between">
        <span className="row">
          {p.image && <img src={p.image} alt="" width={48} height={48} style={{ borderRadius: 10, objectFit: 'cover', width: 48, height: 48 }} />}
          <span>
            <strong>{p.name}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              {p.section} · {isCombo ? money(p.sizes[0]?.price ?? 0) : p.sizes.map((z) => `${z.label} ${money(z.price)}`).join(' · ')}
            </span>
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {p.example && <span className="badge example">Ejemplo</span>}
          <span className={`badge ${p.available ? 'ok' : ''}`}>{p.available ? 'Disponible' : 'Oculto/agotado'}</span>
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <Toggle checked={p.available} onChange={(available) => set({ available })} label="Disponible" />
          <Toggle checked={p.example} onChange={(example) => set({ example })} label="Marcar como ejemplo" />
        </div>
        <div className="two">
          <div className="field"><label>Nombre</label><input className="input sm" value={p.name} onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="field"><label>Sección del menú</label><input className="input sm" value={p.section} onChange={(e) => set({ section: e.target.value })} /></div>
        </div>
        <div className="field"><label>Descripción</label><input className="input sm" value={p.description} maxLength={240} onChange={(e) => set({ description: e.target.value })} /></div>
        <div className="field">
          <label>Foto</label>
          <select className="select sm" value={p.image} onChange={(e) => set({ image: e.target.value })}>
            {!images.includes(p.image) && <option value={p.image}>{p.image || '— sin foto —'}</option>}
            {images.map((i) => <option key={i} value={i}>{i.replace('/images/', '')}</option>)}
          </select>
          <span className="hint">Para fotos nuevas, agrégalas a <code>public/images/</code>.</span>
        </div>

        {isCombo ? (
          <>
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Precio del combo</label>
              <MoneyInput label="Precio del combo" value={p.sizes[0]?.price ?? 0} onChange={(price) => set({ sizes: [{ id: 'combo', label: 'Combo', price }] })} />
              <span className="hint">Los toppings se cobran con las reglas de cada producto elegido.</span>
            </div>
            <ComboEditor slots={p.combo!} products={products} onChange={(combo) => set({ combo })} />
          </>
        ) : (
          <>
            <fieldset className="stack" style={{ gap: 8 }}>
              <legend className="label">Tamaños y precios</legend>
              {p.sizes.map((z, i) => (
                <div key={i} className="row">
                  <input aria-label="Nombre del tamaño" className="input sm" value={z.label} onChange={(e) => set({ sizes: p.sizes.map((x, j) => (j === i ? { ...x, label: e.target.value, id: x.id || slug(e.target.value) } : x)) })} />
                  <MoneyInput label="Precio" value={z.price} onChange={(price) => set({ sizes: p.sizes.map((x, j) => (j === i ? { ...x, price } : x)) })} />
                  <button type="button" className="linkbtn" disabled={p.sizes.length === 1} onClick={() => set({ sizes: p.sizes.filter((_, j) => j !== i) })}>Quitar</button>
                </div>
              ))}
              <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ sizes: [...p.sizes, { id: `t${Date.now().toString(36)}`, label: 'Nuevo', price: 0 }] })}>+ Tamaño</button>
            </fieldset>

            <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
              <div className="field" style={{ width: 170 }}>
                <label>Frésias por pieza</label>
                <input className="input sm" inputMode="numeric" value={p.fresiaUnits} onChange={(e) => set({ fresiaUnits: num(e.target.value) })} />
              </div>
              <div className="field" style={{ width: 170 }}>
                <label>Toppings incluidos</label>
                <input className="input sm" inputMode="numeric" value={p.includedToppings} onChange={(e) => set({ includedToppings: num(e.target.value) })} />
              </div>
              <div className="field" style={{ width: 170 }}>
                <label>Máximo de toppings</label>
                <input className="input sm" inputMode="numeric" placeholder="Sin límite" value={p.maxToppings ?? ''} onChange={(e) => set({ maxToppings: e.target.value === '' ? null : num(e.target.value) })} />
              </div>
            </div>

            <fieldset className="stack" style={{ gap: 4 }}>
              <legend className="label">Toppings permitidos</legend>
              <div className="row" style={{ flexWrap: 'wrap', gap: '0 16px' }}>
                {toppings.map((t) => (
                  <Toggle key={t.id} label={`${t.name}${t.premium ? ` (premium ${money(t.price)})` : ''}`} checked={p.toppingIds.includes(t.id)} onChange={(on) => set({ toppingIds: on ? [...p.toppingIds, t.id] : p.toppingIds.filter((x) => x !== t.id) })} />
                ))}
              </div>
            </fieldset>
            {toppings.some((t) => t.premium && p.toppingIds.includes(t.id)) && (
              <fieldset className="stack" style={{ gap: 4 }}>
                <legend className="label">Premium sin cargo en este producto <span className="muted small">(cuentan como incluidos)</span></legend>
                <div className="row" style={{ flexWrap: 'wrap', gap: '0 16px' }}>
                  {toppings.filter((t) => t.premium && p.toppingIds.includes(t.id)).map((t) => (
                    <Toggle key={t.id} label={t.name} checked={p.freePremiumIds.includes(t.id)} onChange={(on) => set({ freePremiumIds: on ? [...p.freePremiumIds, t.id] : p.freePremiumIds.filter((x) => x !== t.id) })} />
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}

        <div className="field" style={{ maxWidth: 160 }}>
          <label>Orden</label>
          <input className="input sm" inputMode="numeric" value={p.sort} onChange={(e) => set({ sort: parseInt(e.target.value, 10) || 0 })} />
        </div>

        <SaveBar busy={s.busy} saved={s.everSaved} error={s.error} dirty={s.dirty} onSave={s.save} />
        {!confirmDel ? (
          <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDel(true)}>Eliminar</button>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="small">¿Eliminar {p.name}? (Para ocultarlo temporalmente, desmarca «Disponible».)</span>
            <button type="button" className="btn primary small" onClick={async () => { await api(`/api/admin/products/${p.id}`, { method: 'DELETE' }); onDeleted(); }}>Eliminar</button>
            <button type="button" className="btn ghost small" onClick={() => setConfirmDel(false)}>No</button>
          </div>
        )}
      </div>
    </details>
  );
}

function ComboEditor({ slots, products, onChange }: { slots: ComboSlot[]; products: Product[]; onChange: (s: ComboSlot[]) => void }) {
  const setSlot = (i: number, patch: Partial<ComboSlot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const options = products.flatMap((p) => p.sizes.map((z) => ({ productId: p.id, sizeId: z.id, label: `${p.name} · ${z.label}` })));
  return (
    <fieldset className="stack">
      <legend className="label">Qué incluye</legend>
      {slots.map((slot, i) => (
        <div key={slot.id} className="card flat stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input aria-label="Nombre de la parte" className="input sm" style={{ flex: '1 1 200px' }} value={slot.label} placeholder="Ej. Frésias chicas" onChange={(e) => setSlot(i, { label: e.target.value })} />
            <div style={{ width: 110 }}>
              <input aria-label="Cantidad" className="input sm" inputMode="numeric" value={slot.qty} onChange={(e) => setSlot(i, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
            </div>
            <button type="button" className="linkbtn" onClick={() => onChange(slots.filter((_, j) => j !== i))}>Quitar</button>
          </div>
          <p className="muted small">El cliente elige {slot.qty} entre estas opciones:</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0 16px' }}>
            {options.map((o) => {
              const on = slot.options.some((x) => x.productId === o.productId && x.sizeId === o.sizeId);
              return (
                <Toggle
                  key={`${o.productId}-${o.sizeId}`}
                  label={o.label}
                  checked={on}
                  onChange={(v) =>
                    setSlot(i, {
                      options: v
                        ? [...slot.options, { productId: o.productId, sizeId: o.sizeId }]
                        : slot.options.filter((x) => !(x.productId === o.productId && x.sizeId === o.sizeId)),
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...slots, { id: `parte-${Date.now().toString(36)}`, label: 'Frésias', qty: 1, options: [] }])}>
        + Parte del combo
      </button>
    </fieldset>
  );
}

function ToppingEditor({ initial, onDeleted }: { initial: Topping; onDeleted: () => void }) {
  const s = useSaver(initial, (t) => `/api/admin/toppings/${t.id}`);
  const t = s.value;
  const set = (patch: Partial<Topping>) => s.setValue({ ...t, ...patch });
  return (
    <div className="stack" style={{ gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input aria-label="Nombre" className="input sm" style={{ flex: '1 1 160px' }} value={t.name} onChange={(e) => set({ name: e.target.value })} />
        <Toggle checked={t.premium} onChange={(premium) => set({ premium })} label="Premium" />
        {t.premium && <div style={{ width: 110 }}><MoneyInput label={`Precio de ${t.name}`} value={t.price} onChange={(price) => set({ price })} /></div>}
        <Toggle checked={t.available} onChange={(available) => set({ available })} label="Disponible" />
        <button type="button" className="btn primary small" disabled={s.busy || !s.dirty} onClick={s.save}>{s.busy ? '…' : 'Guardar'}</button>
        <button type="button" className="linkbtn" onClick={async () => { await api(`/api/admin/toppings/${t.id}`, { method: 'DELETE' }); onDeleted(); }}>Eliminar</button>
      </div>
      {s.error && <p className="error-text">{s.error}</p>}
    </div>
  );
}
