import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { activeGroup, groupAdminToken, memberKey, setActiveGroup, setGroupCheckout } from '../lib/groupState';
import { useMenu } from '../lib/menu';
import { DemoBanner, Spinner, StickyAction, TopBar } from '../components/ui';
import { LineDetails } from './parts';
import type { PricedLine } from '../../shared/types';

type GroupView = {
  code: string;
  name: string;
  organizerName: string;
  status: 'abierto' | 'pedido' | 'cancelado';
  closesAt: string | null;
  closed: boolean;
  orderNumber: string | null;
  items: { id: string; memberName: string; mine: boolean; line: PricedLine }[];
  subtotal: number;
  pieces: number;
  isOrganizer: boolean;
};

/** Página compartida del pedido de equipo: quién pidió qué, el total y el botón del organizador. */
export default function GroupPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: menu } = useMenu();
  const [g, setG] = useState<GroupView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => (activeGroup()?.code === code ? activeGroup()!.memberName : ''));
  const [copied, setCopied] = useState(false);
  const admin = groupAdminToken(code);
  const link = `${window.location.origin}/equipo/${code}`;

  const load = useCallback(async () => {
    try {
      setG(await api<GroupView>(`/api/groups/${encodeURIComponent(code)}?k=${encodeURIComponent(memberKey())}${admin ? `&a=${encodeURIComponent(admin)}` : ''}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code, admin]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <main className="page stack"><TopBar back="/" /><div className="notice error">{error}</div></main>;
  if (!g) return <main className="page"><TopBar back="/" /><Spinner label="Cargando pedido de equipo…" /></main>;

  const closesText = g.closesAt ? new Date(g.closesAt).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) : null;
  const shareText = `🍓 ${g.organizerName} está armando un pedido de Frésia para «${g.name}». Elige lo tuyo aquí${closesText ? ` (antes de las ${closesText})` : ''}: ${link}`;
  const byMember = new Map<string, GroupView['items']>();
  g.items.forEach((i) => byMember.set(i.memberName, [...(byMember.get(i.memberName) ?? []), i]));

  function join() {
    if (name.trim().length < 2) return;
    setActiveGroup({ code: g!.code, name: g!.name, memberName: name.trim() });
    navigate('/');
  }

  async function remove(id: string) {
    await api(`/api/groups/${code}/items/${id}/delete`, { body: { memberKey: memberKey(), adminToken: admin ?? undefined } }).catch((e: Error) => setError(e.message));
    void load();
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: g!.name, text: shareText }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(shareText).catch(() => undefined);
      setCopied(true);
    }
  }

  const productImage = (id: string) => menu?.products.find((p) => p.id === id)?.image;
  // Pedido de equipo: sin mínimo de piezas.
  const minPieces = 1;

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back="/" step="Pedido de equipo" />
        <div className="stack" style={{ gap: 6 }}>
          <h1>👥 {g.name}</h1>
          <p className="muted">
            Organiza {g.organizerName}
            {g.closed ? ' · cerrado' : closesText ? ` · se cierra a las ${closesText}` : ''}
          </p>
        </div>

        {g.status === 'pedido' && (
          <div className="notice ok">✅ Pedido enviado ({g.orderNumber}). ¡Ya va para Frésia!</div>
        )}

        {!g.closed && (
          <section className="card stack">
            <h2>{params.get('nuevo') ? '¡Listo! Comparte el enlace' : 'Invita a tu equipo'}</h2>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <a className="btn primary small" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
              <button type="button" className="btn secondary small" onClick={share}>{copied ? 'Enlace copiado ✓' : 'Copiar enlace'}</button>
            </div>
            <code className="small" style={{ wordBreak: 'break-all' }}>{link}</code>
          </section>
        )}

        {!g.closed && (
          <section className="card stack">
            <h2>Agrega lo tuyo</h2>
            <div className="field">
              <label htmlFor="member">Tu nombre</label>
              <input id="member" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" />
            </div>
            <button type="button" className="btn primary" disabled={name.trim().length < 2} onClick={join}>Elegir mi Frésia</button>
            <p className="muted small">Sin mínimo: cada quien pide lo que quiera, desde 1 pieza.</p>
          </section>
        )}

        <section className="stack" aria-labelledby="group-items">
          <div className="row between">
            <h2 id="group-items">Lo que lleva el pedido</h2>
            <span className="muted small">{g.pieces} pieza{g.pieces === 1 ? '' : 's'}</span>
          </div>
          {g.items.length === 0 && <p className="muted">Todavía nadie agrega nada.</p>}
          {[...byMember].map(([member, items]) => (
            <div key={member} className="card" style={{ paddingTop: 12, paddingBottom: 4 }}>
              <strong>{member}</strong>
              {items.map((i) => (
                <div key={i.id} className="line" style={{ gridTemplateColumns: '48px 1fr' }}>
                  <img src={productImage(i.line.productId) ?? '/brand/fresia-puerta.svg'} alt="" width={48} height={48} style={{ width: 48, height: 48 }} />
                  <div className="details">
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <span>{i.line.qty} × {i.line.name} {!i.line.choices && <span className="muted">· {i.line.sizeLabel}</span>}</span>
                      <span className="price">{money(i.line.lineTotal)}</span>
                    </div>
                    <LineDetails line={{ ...i.line, forWhom: '' }} />
                    {(i.mine || g.isOrganizer) && g.status === 'abierto' && (
                      <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', minHeight: 32, padding: 0 }} onClick={() => remove(i.id)}>Quitar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="row between" style={{ fontWeight: 600 }}>
            <span>Subtotal del equipo</span>
            <span className="price">{money(g.subtotal)}</span>
          </div>
          <Link to="/" className="linkbtn">Ver el menú</Link>
        </section>
      </main>

      {g.isOrganizer && g.status === 'abierto' && (
        <StickyAction>
          <button
            type="button"
            className="btn primary block"
            disabled={g.pieces < minPieces}
            onClick={() => {
              setGroupCheckout({ code: g.code, token: admin!, name: g.name });
              navigate('/entrega');
            }}
          >
            {g.pieces < minPieces ? 'Agrega al menos 1 pieza' : `Hacer el pedido del equipo · ${money(g.subtotal)}`}
          </button>
        </StickyAction>
      )}
    </>
  );
}
