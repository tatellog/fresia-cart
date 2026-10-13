import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LoadError, Spinner } from '../components/ui';

type Row = { key: string; visitantes: number; vieronProducto: number; carrito: number; equiposCreados: number; checkout: number; compras: number; ventas: number };
type Res = { days: number; campana: Row[]; dispositivo: Row[]; modalidad: Row[] };
type Dim = 'campana' | 'dispositivo' | 'modalidad';

const DIMS: { key: Dim; label: string }[] = [
  { key: 'campana', label: 'Campaña' },
  { key: 'dispositivo', label: 'Dispositivo' },
  { key: 'modalidad', label: 'Modalidad' },
];
const NAMES: Record<string, string> = { movil: 'Celular', tablet: 'Tablet', escritorio: 'Computadora', individual: 'Individual', equipo: 'Equipo', regalo: 'Regalo (Fresigrama)', 'sin elegir': 'Sin elegir aún', directo: 'Directo (sin campaña)' };
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** Embudo anónimo: de visita a compra, por campaña (UTM), dispositivo y modalidad. */
export function Conversion() {
  const [days, setDays] = useState(30);
  const [dim, setDim] = useState<Dim>('campana');
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api<Res>(`/api/admin/analytics?days=${days}`).then(setData, (e: Error) => setError(e.message));
  };
  useEffect(load, [days]);

  const rows = data?.[dim] ?? [];
  return (
    <section className="card stack">
      <h2>Conversión</h2>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="tabs" role="group" aria-label="Ver por">
          {DIMS.map((d) => (
            <button key={d.key} aria-pressed={dim === d.key} onClick={() => setDim(d.key)}>{d.label}</button>
          ))}
        </div>
        <select className="select sm" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periodo">
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>
      {error ? <LoadError message={error} retry={load} /> : !data ? <Spinner label="Cargando…" /> : rows.length === 0 ? (
        <p className="muted">Aún no hay visitas registradas en este periodo.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>{DIMS.find((d) => d.key === dim)!.label}</th><th>Visitas</th><th>Vieron producto</th><th>Carrito</th><th>Checkout</th><th>Compras</th><th>Conversión</th><th>Ventas</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{NAMES[r.key] ?? r.key}{r.equiposCreados > 0 && <div className="muted small">{r.equiposCreados} equipo(s) creados</div>}</td>
                  <td>{r.visitantes || '—'}</td>
                  <td>{r.vieronProducto}</td>
                  <td>{r.carrito}</td>
                  <td>{r.checkout}</td>
                  <td>{r.compras}</td>
                  <td>{pct(r.compras, r.visitantes || r.checkout)}</td>
                  <td className="price">${(r.ventas / 100).toLocaleString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Personas distintas por paso (anónimas, sin nombre ni teléfono). «Compras» son pedidos pagados en línea o confirmados para pagar al recibir.
        La campaña sale de <code>utm_source</code> y <code>utm_campaign</code> del enlace, o del QR; se guarda en el pedido.
        En «Modalidad», la conversión es compras ÷ checkout (se elige la modalidad después de entrar).
      </p>
    </section>
  );
}
