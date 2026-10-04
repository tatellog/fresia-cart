import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { LoadError, Spinner } from '../components/ui';
import { MoneyInput, SaveBar, Toggle, slug } from './fields';
import type { Product, Topping } from '../../shared/types';

type CatalogRes = { products: Product[]; toppings: Topping[]; images: string[] };

export default function Catalog() {
  const [data, setData] = useState<CatalogRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<CatalogRes>('/api/admin/catalog').then(setData, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  if (error) return <LoadError message={error} retry={load} />;
  if (!data) return <Spinner label="Cargando…" />;

  const newProduct = (): Product => ({
    id: `producto-${Date.now().toString(36)}`, name: 'Nuevo producto', description: '', image: data.images[0] ?? '',
    sizes: [{ id: 'unico', label: 'Pieza', price: 0 }], toppingIds: [], maxToppings: null, available: false, sort: (data.products.at(-1)?.sort ?? 0) + 10, example: false,
  });
  const newTopping = (): Topping => ({ id: `topping-${Date.now().toString(36)}`, name: 'Nuevo topping', price: 0, available: false, sort: (data.toppings.at(-1)?.sort ?? 0) + 1, example: false });

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Menú</h1>
        <p className="muted">Los cambios se ven en el menú al instante; el QR no cambia. Los precios se recalculan en el servidor al cobrar.</p>
      </div>

      <section className="stack">
        <div className="row between">
          <h2>Productos</h2>
          <button className="btn ghost small" onClick={() => setData({ ...data, products: [...data.products, newProduct()] })}>+ Agregar producto</button>
        </div>
        {data.products.map((p) => (
          <ProductEditor key={p.id} initial={p} toppings={data.toppings} images={data.images} onDeleted={load} />
        ))}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Toppings y extras</h2>
          <button className="btn ghost small" onClick={() => setData({ ...data, toppings: [...data.toppings, newTopping()] })}>+ Agregar topping</button>
        </div>
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
  return { value, setValue, saved, busy, error, dirty, save, everSaved: saved !== initial };
}

function ProductEditor({ initial, toppings, images, onDeleted }: { initial: Product; toppings: Topping[]; images: string[]; onDeleted: () => void }) {
  const s = useSaver(initial, (p) => `/api/admin/products/${p.id}`);
  const p = s.value;
  const set = (patch: Partial<Product>) => s.setValue({ ...p, ...patch });
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <details className="card editor">
      <summary className="row between">
        <span className="row">
          {p.image && <img src={p.image} alt="" width={48} height={48} style={{ borderRadius: 10, objectFit: 'cover', width: 48, height: 48 }} />}
          <span>
            <strong>{p.name}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              {p.sizes.map((z) => `${z.label} ${money(z.price)}`).join(' · ')}
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
        <div className="field"><label>Nombre</label><input className="input sm" value={p.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label>Descripción</label><input className="input sm" value={p.description} maxLength={240} onChange={(e) => set({ description: e.target.value })} /></div>
        <div className="field">
          <label>Foto</label>
          <select className="select sm" value={p.image} onChange={(e) => set({ image: e.target.value })}>
            {!images.includes(p.image) && <option value={p.image}>{p.image || '— sin foto —'}</option>}
            {images.map((i) => <option key={i} value={i}>{i.replace('/images/', '')}</option>)}
          </select>
          <span className="hint">Para fotos nuevas, agrégalas a <code>public/images/</code>.</span>
        </div>

        <fieldset className="stack" style={{ gap: 8 }}>
          <legend className="label">Tamaños y precios</legend>
          {p.sizes.map((z, i) => (
            <div key={i} className="row">
              <input aria-label="Nombre del tamaño" className="input sm" value={z.label} onChange={(e) => set({ sizes: p.sizes.map((x, j) => (j === i ? { ...x, label: e.target.value, id: x.id || slug(e.target.value) } : x)) })} />
              <MoneyInput label="Precio" value={z.price} onChange={(price) => set({ sizes: p.sizes.map((x, j) => (j === i ? { ...x, price } : x)) })} />
              <button type="button" className="linkbtn" disabled={p.sizes.length === 1} onClick={() => set({ sizes: p.sizes.filter((_, j) => j !== i) })}>Quitar</button>
            </div>
          ))}
          <button type="button" className="btn ghost small" onClick={() => set({ sizes: [...p.sizes, { id: `t${Date.now().toString(36)}`, label: 'Nuevo', price: 0 }] })}>+ Tamaño</button>
        </fieldset>

        <fieldset className="stack" style={{ gap: 4 }}>
          <legend className="label">Toppings permitidos</legend>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0 16px' }}>
            {toppings.map((t) => (
              <Toggle key={t.id} label={`${t.name} (+${money(t.price)})`} checked={p.toppingIds.includes(t.id)} onChange={(on) => set({ toppingIds: on ? [...p.toppingIds, t.id] : p.toppingIds.filter((x) => x !== t.id) })} />
            ))}
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Máximo de toppings</label>
            <input className="input sm" inputMode="numeric" placeholder="Sin límite" value={p.maxToppings ?? ''} onChange={(e) => set({ maxToppings: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          </div>
        </fieldset>

        <div className="field" style={{ maxWidth: 160 }}>
          <label>Orden</label>
          <input className="input sm" inputMode="numeric" value={p.sort} onChange={(e) => set({ sort: parseInt(e.target.value, 10) || 0 })} />
        </div>

        <SaveBar busy={s.busy} saved={s.everSaved} error={s.error} dirty={s.dirty} onSave={s.save} />
        {!confirmDel ? (
          <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDel(true)}>Eliminar producto</button>
        ) : (
          <div className="row">
            <span className="small">¿Eliminar {p.name}? (Para ocultarlo temporalmente, desmarca «Disponible».)</span>
            <button type="button" className="btn primary small" onClick={async () => { await api(`/api/admin/products/${p.id}`, { method: 'DELETE' }); onDeleted(); }}>Eliminar</button>
            <button type="button" className="btn ghost small" onClick={() => setConfirmDel(false)}>No</button>
          </div>
        )}
      </div>
    </details>
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
        <div style={{ width: 110 }}><MoneyInput label={`Precio de ${t.name}`} value={t.price} onChange={(price) => set({ price })} /></div>
        <Toggle checked={t.available} onChange={(available) => set({ available })} label="Disponible" />
        <Toggle checked={t.example} onChange={(example) => set({ example })} label="Ejemplo" />
        <button type="button" className="btn primary small" disabled={s.busy || !s.dirty} onClick={s.save}>{s.busy ? '…' : 'Guardar'}</button>
        <button type="button" className="linkbtn" onClick={async () => { await api(`/api/admin/toppings/${t.id}`, { method: 'DELETE' }); onDeleted(); }}>Eliminar</button>
      </div>
      {s.error && <p className="error-text">{s.error}</p>}
    </div>
  );
}
