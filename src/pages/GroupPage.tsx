import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { activeGroup, groupAdminToken, memberKey, setActiveGroup, setGroupCheckout } from '../lib/groupState';
import { useMenu } from '../lib/menu';
import { DemoBanner, Spinner, StickyAction, TopBar } from '../components/ui';
import { LineDetails } from './parts';
import { recentOrders } from '../lib/checkout';
import { deadlineText } from '../../shared/schedule';
import type { PricedLine } from '../../shared/types';

type GroupState = 'abierto' | 'cerrado' | 'pendiente_pago' | 'confirmado' | 'cancelado' | 'completado';
type GroupView = {
  code: string;
  name: string;
  organizerName: string;
  status: 'abierto' | 'cerrado' | 'pedido' | 'cancelado';
  state: GroupState;
  closesAt: string | null;
  closed: boolean;
  orderNumber: string | null;
  orderTotal: number | null;
  participants: { name: string; pieces: number; subtotal: number; mine: boolean }[];
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
    // Al volver a la pestaña (p. ej. desde WhatsApp) se actualiza al momento.
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Si este teléfono estaba agregando a un pedido que ya cerró, sale del modo equipo.
  useEffect(() => {
    if (g?.closed && activeGroup()?.code === g.code && !g.isOrganizer) setActiveGroup(null);
  }, [g]);

  if (error) return <main className="page stack"><TopBar back="/" /><div className="notice error">{error}</div></main>;
  if (!g) return <main className="page"><TopBar back="/" /><Spinner label="Cargando pedido de equipo…" /></main>;

  const deadline = g.closesAt ? deadlineText(new Date(g.closesAt)) : null;
  const shareText = `🍓 Pedido de equipo de Frésia para «${g.name}». Cada quien elige sus fresas con crema y llegan todas juntas a la oficina.${deadline ? ` Elige antes de ${deadline}` : ' Elige lo tuyo'}: ${link}`;
  const pending = g.participants.filter((p) => p.pieces === 0);
  const orderLink = g.isOrganizer && g.orderNumber ? recentOrders().find((o) => o.number === g.orderNumber) : undefined;
  const byMember = new Map<string, GroupView['items']>();
  g.items.forEach((i) => byMember.set(i.memberName, [...(byMember.get(i.memberName) ?? []), i]));

  const [joining, setJoining] = useState(false);
  async function join() {
    if (name.trim().length < 2 || joining) return;
    setJoining(true);
    try {
      await api(`/api/groups/${code}/join`, { body: { memberName: name.trim(), memberKey: memberKey() } });
      setActiveGroup({ code: g!.code, name: g!.name, memberName: name.trim() });
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setJoining(false);
    }
  }

  const [busy, setBusy] = useState(false);
  async function setOpen(open: boolean) {
    setBusy(true);
    await api(`/api/groups/${code}/${open ? 'reopen' : 'close'}`, { body: { adminToken: admin } }).catch((e: Error) => setError(e.message));
    await load();
    setBusy(false);
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
          <p className="muted">Organiza {g.organizerName}</p>
        </div>

        <StateNotice g={g} deadline={deadline} />
        {orderLink && <Link to={`/pedido/${orderLink.number}?t=${orderLink.token}`} className="btn secondary small" style={{ alignSelf: 'flex-start' }}>Ver el pedido {orderLink.number}</Link>}

        {(g.participants.length > 0 || g.state === 'abierto') && (
          <section className="card stack" aria-labelledby="who-title">
            <div className="row between">
              <h2 id="who-title">Quiénes van</h2>
              <span className="muted small">
                {g.participants.length} persona{g.participants.length === 1 ? '' : 's'} · {g.participants.length - pending.length} ya eligieron
              </span>
            </div>
            {g.participants.length === 0 ? (
              <p className="muted">Todavía nadie entra. Comparte el enlace con tu equipo.</p>
            ) : (
              <ul className="people">
                {g.participants.map((p, i) => (
                  <li key={i} className={p.pieces ? 'done' : ''}>
                    <span>{p.pieces ? '✓' : '…'} {p.name}{p.mine ? ' (tú)' : ''}</span>
                    <span className="muted small">{p.pieces ? `${p.pieces} pieza${p.pieces === 1 ? '' : 's'} · ${money(p.subtotal)}` : 'aún no elige'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!g.closed && (
          <section className="card stack">
            <h2>{params.get('nuevo') ? '¡Listo! Comparte el enlace' : 'Invita a tu equipo'}</h2>
            <p className="muted small">Cada quien entra con su nombre, elige lo suyo y llega todo junto.{deadline ? ` Se pueden agregar productos hasta ${deadline}.` : ''}</p>
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
            <button type="button" className="btn primary" disabled={name.trim().length < 2 || joining} onClick={join}>{joining ? 'Entrando…' : 'Elegir mi Frésia'}</button>
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
              <div className="row between">
                <strong>{member}</strong>
                <span className="price small">{money(items.reduce((s, i) => s + i.line.lineTotal, 0))}</span>
              </div>
              {items.map((i) => (
                <div key={i.id} className="line" style={{ gridTemplateColumns: '48px 1fr' }}>
                  <img src={productImage(i.line.productId) ?? '/brand/fresia-puerta.svg'} alt="" width={48} height={48} style={{ width: 48, height: 48 }} />
                  <div className="details">
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <span>{i.line.qty} × {i.line.name} {!i.line.choices && <span className="muted">· {i.line.sizeLabel}</span>}</span>
                      <span className="price">{money(i.line.lineTotal)}</span>
                    </div>
                    <LineDetails line={{ ...i.line, forWhom: '' }} />
                    {((i.mine && !g.closed) || (g.isOrganizer && (g.status === 'abierto' || g.status === 'cerrado'))) && (
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
          {!g.closed && <Link to="/" className="linkbtn">Ver el menú</Link>}
        </section>

        {g.isOrganizer && (g.status === 'abierto' || g.status === 'cerrado') && (
          <section className="card stack" aria-labelledby="org-title">
            <h2 id="org-title">Para quien organiza</h2>
            <p className="small">
              <strong>Tú pagas el pedido de todo el equipo</strong> en un solo pago; el envío y el total final los ves antes de pagar.
              Al tocar «Revisar y pagar» el pedido se cierra para que nadie lo cambie mientras pagas.
            </p>
            {g.status === 'abierto' ? (
              <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => setOpen(false)}>
                🔒 Cerrar el pedido (nadie más agrega)
              </button>
            ) : (
              <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => setOpen(true)}>
                Reabrir para que agreguen más
              </button>
            )}
          </section>
        )}
      </main>

      {g.isOrganizer && (g.status === 'abierto' || g.status === 'cerrado') && (
        <StickyAction>
          <button
            type="button"
            className="btn primary block"
            disabled={g.pieces < minPieces}
            onClick={async () => {
              // Al ir a pagar se cierra: el total que revisas es el que se cobra (se puede reabrir).
              if (g.status === 'abierto') await api(`/api/groups/${code}/close`, { body: { adminToken: admin } }).catch(() => undefined);
              setGroupCheckout({ code: g.code, token: admin!, name: g.name });
              navigate('/entrega');
            }}
          >
            {g.pieces < minPieces ? 'Agrega al menos 1 pieza' : `Revisar y pagar · ${money(g.subtotal)}`}
          </button>
        </StickyAction>
      )}
    </>
  );
}

/** Estado del pedido de equipo en palabras: abierto, cerrado, esperando pago, confirmado, entregado o cancelado. */
function StateNotice({ g, deadline }: { g: GroupView; deadline: string | null }) {
  switch (g.state) {
    case 'abierto':
      return <div className="notice">🟢 Abierto · {deadline ? `se pueden agregar productos hasta ${deadline}` : 'sin hora límite: cierra cuando quien organiza haga el pedido'}.</div>;
    case 'cerrado':
      return (
        <div className="notice warn">
          🔒 <strong>Cerrado.</strong> Ya no se aceptan selecciones nuevas. {g.isOrganizer ? 'Revisa y paga cuando estés listo.' : `${g.organizerName} está por hacer el pedido.`}
        </div>
      );
    case 'pendiente_pago':
      return <div className="notice warn">⏳ Pedido {g.orderNumber} creado: falta confirmar el pago{g.isOrganizer ? '.' : ` de ${g.organizerName}.`}</div>;
    case 'confirmado':
      return <div className="notice ok">✅ Pedido {g.orderNumber} confirmado{g.orderTotal != null ? ` · total ${money(g.orderTotal)}` : ''}. ¡Ya va para Frésia!</div>;
    case 'completado':
      return <div className="notice ok">🎉 Pedido {g.orderNumber} entregado. ¡Provecho!</div>;
    case 'cancelado':
      return <div className="notice error">Este pedido de equipo se canceló.</div>;
  }
}
