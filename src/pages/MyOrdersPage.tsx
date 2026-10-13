import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { money, formatDate } from '../lib/format';
import { recentOrders } from '../lib/checkout';
import { myGroups } from '../lib/groupState';
import { ORDER_LABEL } from '../../shared/status';
import { DemoBanner, Footer, Spinner, TopBar } from '../components/ui';
import type { PublicOrder } from '../../shared/types';

type Row = { number: string; token: string; at: string; groupName?: string | null; order: PublicOrder | null };

/** Pedidos hechos desde este teléfono (sin cuenta): verlos, repetirlos o armar otro pedido de equipo. */
export default function MyOrdersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const groups = myGroups();

  useEffect(() => {
    const recent = recentOrders();
    Promise.all(
      recent.map((r) =>
        api<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(r.number)}?t=${encodeURIComponent(r.token)}`).then(
          (x) => ({ ...r, order: x.order }),
          () => ({ ...r, order: null }),
        ),
      ),
    ).then(setRows);
  }, []);

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/" />
        <div className="stack" style={{ gap: 6 }}>
          <h1>Mis pedidos</h1>
          <p className="muted small">Los pedidos que hiciste desde este teléfono. Solo tú los ves aquí; no hace falta cuenta.</p>
        </div>

        {!rows ? (
          <Spinner label="Cargando tus pedidos…" />
        ) : rows.length === 0 && groups.length === 0 ? (
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 24 }}>
            <p className="muted">Todavía no tienes pedidos en este teléfono.</p>
            <Link to="/" className="btn primary">Ver el menú</Link>
          </div>
        ) : (
          <section className="stack" aria-label="Pedidos">
            {rows.map((r) => {
              const o = r.order;
              const team = o?.groupName ?? r.groupName;
              return (
                <article key={r.number} className="card stack" style={{ gap: 8 }}>
                  <div className="row between">
                    <strong>{r.number}{team ? ` · 👥 ${team}` : ''}</strong>
                    {o?.total != null && <span className="price">{money(o.total)}</span>}
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    {formatDate(o?.createdAt ?? r.at)}
                    {o ? ` · ${ORDER_LABEL[o.orderStatus]}` : ' · no pudimos cargarlo'}
                    {o ? ` · ${o.items.reduce((s, l) => s + l.qty, 0)} pieza(s)` : ''}
                  </p>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <Link to={`/pedido/${r.number}?t=${r.token}`} className="btn secondary small">Ver</Link>
                    {team && <Link to={`/equipo/nuevo?nombre=${encodeURIComponent(team)}`} className="btn ghost small">👥 Nuevo pedido de equipo</Link>}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {groups.length > 0 && (
          <section className="stack" aria-labelledby="teams-title">
            <h2 id="teams-title">Pedidos de equipo que organizaste</h2>
            {groups.map((g) => (
              <div key={g.code} className="row between card" style={{ padding: '10px 16px' }}>
                <span>👥 {g.name} <span className="muted small">· {formatDate(g.at)}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  <Link to={`/equipo/${g.code}`} className="linkbtn">Abrir</Link>
                  <Link to={`/equipo/nuevo?nombre=${encodeURIComponent(g.name)}`} className="linkbtn">Repetir</Link>
                </span>
              </div>
            ))}
          </section>
        )}
        <Footer />
      </main>
    </>
  );
}
