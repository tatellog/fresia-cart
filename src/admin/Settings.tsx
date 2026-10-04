import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { LoadError, Spinner } from '../components/ui';
import { MoneyInput, SaveBar, Toggle, splitList } from './fields';
import type { BusinessInfo, DeliveryConfig, LegalDoc, Zone } from '../../shared/types';
import type { Schedule } from '../../shared/schedule';
import { scheduleText } from '../../shared/schedule';

function useResource<T>(url: string) {
  const [value, setValue] = useState<T | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [everSaved, setEverSaved] = useState(false);
  const load = () =>
    api<T>(url).then(
      (v) => {
        setValue(v);
        setSaved(JSON.stringify(v));
      },
      (e: Error) => setError(e.message),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [url]);
  const save = async (putUrl = url, body: unknown = value) => {
    setBusy(true);
    setSaveError(null);
    try {
      await api(putUrl, { method: 'PUT', body });
      setSaved(JSON.stringify(value));
      setEverSaved(true);
    } catch (e) {
      setSaveError((e as Error).message);
    }
    setBusy(false);
  };
  return { value, setValue, error, load, save, busy, saveError, everSaved, dirty: value != null && JSON.stringify(value) !== saved };
}

// ── Entrega y cobertura ───────────────────────────────────────────────

export function DeliverySettings() {
  const r = useResource<DeliveryConfig>('/api/admin/delivery');
  if (r.error) return <LoadError message={r.error} retry={r.load} />;
  if (!r.value) return <Spinner label="Cargando…" />;
  const d = r.value;
  const set = (patch: Partial<DeliveryConfig>) => r.setValue({ ...d, ...patch });
  const setZone = (i: number, patch: Partial<Zone>) => set({ zones: d.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Entrega y cobertura</h1>
      </div>
      <section className="card stack">
        <div className="field">
          <label htmlFor="mode">Cómo se valida la cobertura</label>
          <select id="mode" className="select sm" value={d.mode} onChange={(e) => set({ mode: e.target.value as DeliveryConfig['mode'] })}>
            <option value="radius">Radio desde Frésia (ubicación del celular del cliente)</option>
            <option value="zones">Por código postal / colonia</option>
          </select>
        </div>
        {d.mode === 'radius' && <RadiusFields d={d} set={set} />}
      </section>
      <section className="card stack">
        <Toggle checked={d.deliveryEnabled} onChange={(deliveryEnabled) => set({ deliveryEnabled })} label="Entrega a domicilio activa" />
        <Toggle checked={d.pickupEnabled} onChange={(pickupEnabled) => set({ pickupEnabled })} label="Recoger en Frésia activo" />
        <div className="field">
          <label htmlFor="prep">Tiempo de preparación para recoger</label>
          <input id="prep" className="input sm" value={d.pickupPrepText} placeholder="Ej. 15–20 min" onChange={(e) => set({ pickupPrepText: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ooz">Direcciones fuera de zona</label>
          <select id="ooz" className="select sm" value={d.outOfZone} onChange={(e) => set({ outOfZone: e.target.value as DeliveryConfig['outOfZone'] })}>
            <option value="reject">No aceptar (ofrecer recoger)</option>
            <option value="manual">Guardar pedido y cotizar por WhatsApp</option>
          </select>
        </div>
        <Toggle checked={d.example} onChange={(example) => set({ example })} label="Mostrar como datos de ejemplo" />
      </section>

      <section className="card stack">
        <h2>Métodos de pago</h2>
        <Toggle checked={d.onlinePayment} onChange={(onlinePayment) => set({ onlinePayment })} label="Pagar en línea (Mercado Pago)" />
        <OnlineNote />
        <Toggle checked={d.cashOnDelivery} onChange={(cashOnDelivery) => set({ cashOnDelivery })} label="Pagar al recibir / al recoger" />
        <div className="field">
          <label htmlFor="codnote">Detalle para «pagar al recibir» <span className="muted small">(opcional)</span></label>
          <input id="codnote" className="input sm" value={d.cashOnDeliveryNote} maxLength={120} placeholder="Ej. Efectivo o tarjeta al recibir" onChange={(e) => set({ cashOnDeliveryNote: e.target.value })} />
        </div>
        {!d.onlinePayment && !d.cashOnDelivery && <p className="error-text">Activa al menos un método de pago.</p>}
      </section>

      {d.mode === 'zones' && <section className="stack">
        <p className="muted">Solo se entrega a las zonas capturadas aquí. Cada zona usa códigos postales; si agregas colonias, solo esas quedan cubiertas.</p>
        <div className="row between">
          <h2>Zonas</h2>
          <button className="btn ghost small" onClick={() => set({ zones: [...d.zones, { id: `zona-${Date.now().toString(36)}`, name: 'Nueva zona', postalCodes: [], colonias: [], fee: 0, etaMin: 30, etaMax: 45, mode: 'auto', active: false }] })}>
            + Agregar zona
          </button>
        </div>
        {d.zones.map((z, i) => (
          <div key={z.id} className="card stack">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input aria-label="Nombre de la zona" className="input sm" style={{ flex: '1 1 200px' }} value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} />
              <Toggle checked={z.active} onChange={(active) => setZone(i, { active })} label="Activa" />
              <button className="linkbtn" onClick={() => set({ zones: d.zones.filter((_, j) => j !== i) })}>Quitar</button>
            </div>
            <ListInput label="Códigos postales (separados por coma)" value={z.postalCodes} onChange={(postalCodes) => setZone(i, { postalCodes })} />
            <ListInput label="Colonias (opcional, separadas por coma)" value={z.colonias} onChange={(colonias) => setZone(i, { colonias })} />
            <div className="field">
              <label>Tipo</label>
              <select className="select sm" value={z.mode} onChange={(e) => setZone(i, { mode: e.target.value as Zone['mode'] })}>
                <option value="auto">Tarifa fija (se paga en línea)</option>
                <option value="manual">Cotización manual por WhatsApp</option>
              </select>
            </div>
            {z.mode === 'auto' && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="field" style={{ width: 140 }}><label>Envío (MXN)</label><MoneyInput label="Envío" value={z.fee} onChange={(fee) => setZone(i, { fee })} /></div>
                <div className="field" style={{ width: 120 }}><label>Mín. (min)</label><input className="input sm" inputMode="numeric" value={z.etaMin} onChange={(e) => setZone(i, { etaMin: parseInt(e.target.value, 10) || 0 })} /></div>
                <div className="field" style={{ width: 120 }}><label>Máx. (min)</label><input className="input sm" inputMode="numeric" value={z.etaMax} onChange={(e) => setZone(i, { etaMax: parseInt(e.target.value, 10) || 0 })} /></div>
              </div>
            )}
          </div>
        ))}
      </section>}
      <SaveBar busy={r.busy} saved={r.everSaved} error={r.saveError} dirty={r.dirty} onSave={() => r.save()} />
    </div>
  );
}

function RadiusFields({ d, set }: { d: DeliveryConfig; set: (p: Partial<DeliveryConfig>) => void }) {
  const [coords, setCoords] = useState(d.origin ? `${d.origin.lat}, ${d.origin.lng}` : '');
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <div className="field">
        <label htmlFor="origin">Ubicación de Frésia (latitud, longitud)</label>
        <input
          id="origin"
          className="input sm"
          value={coords}
          placeholder="19.39725, -99.1712"
          onChange={(e) => setCoords(e.target.value)}
          onBlur={() => {
            const m = coords.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
            if (!m) return setErr('Pega las coordenadas como «19.39725, -99.1712».');
            setErr(null);
            set({ origin: { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } });
          }}
        />
        {err ? <span className="error-text">{err}</span> : (
          <span className="hint">
            En Google Maps, mantén presionado el punto exacto de la tienda y copia las coordenadas que aparecen.{' '}
            {d.origin && <a href={`https://www.google.com/maps?q=${d.origin.lat},${d.origin.lng}`} target="_blank" rel="noreferrer">Ver punto actual</a>}
          </span>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 140 }}><label>Radio (m)</label><input className="input sm" inputMode="numeric" value={d.radiusM} onChange={(e) => set({ radiusM: parseInt(e.target.value, 10) || 0 })} /></div>
        <div className="field" style={{ width: 140 }}><label>Envío (MXN)</label><MoneyInput label="Envío" value={d.radiusFee} onChange={(radiusFee) => set({ radiusFee })} /></div>
        <div className="field" style={{ width: 120 }}><label>Mín. (min)</label><input className="input sm" inputMode="numeric" value={d.radiusEtaMin} onChange={(e) => set({ radiusEtaMin: parseInt(e.target.value, 10) || 0 })} /></div>
        <div className="field" style={{ width: 120 }}><label>Máx. (min)</label><input className="input sm" inputMode="numeric" value={d.radiusEtaMax} onChange={(e) => set({ radiusEtaMax: parseInt(e.target.value, 10) || 0 })} /></div>
      </div>
      <p className="muted small">
        Se acepta automáticamente solo si el GPS confirma que está dentro del radio aun con su margen de error (máx. 80 m).
        Si el cliente no comparte su ubicación, está en el límite o el GPS es impreciso, el pedido se guarda y se confirma por WhatsApp.
      </p>
    </>
  );
}

function ListInput({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitList(text))} />
    </div>
  );
}

// ── Datos del negocio ─────────────────────────────────────────────────

export function BusinessSettings() {
  const r = useResource<BusinessInfo>('/api/admin/business');
  if (r.error) return <LoadError message={r.error} retry={r.load} />;
  if (!r.value) return <Spinner label="Cargando…" />;
  const b = r.value;
  const set = (patch: Partial<BusinessInfo>) => r.setValue({ ...b, ...patch });
  return (
    <div className="stack-lg">
      <h1>Datos del negocio</h1>
      <section className="card stack">
        <div className="field"><label>Nombre</label><input className="input sm" value={b.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label>Dirección</label><input className="input sm" value={b.address} onChange={(e) => set({ address: e.target.value })} /></div>
        <div className="field"><label>Enlace de Google Maps</label><input className="input sm" value={b.mapsUrl} placeholder="https://maps.app.goo.gl/…" onChange={(e) => set({ mapsUrl: e.target.value })} /></div>
        <div className="field">
          <label>Horario que ven los clientes</label>
          <p className="legal-body muted small">{b.hours || '—'}</p>
          <span className="hint">Se actualiza solo al guardar el horario de abajo.</span>
        </div>
        <div className="field">
          <label>WhatsApp</label>
          <input className="input sm" inputMode="numeric" value={b.whatsapp} placeholder="5215512345678" onChange={(e) => set({ whatsapp: e.target.value.replace(/\D/g, '') })} />
          <span className="hint">Solo dígitos con lada de país (52) — así funciona el enlace wa.me.</span>
        </div>
        <div className="field"><label>Correo</label><input className="input sm" type="email" value={b.email} onChange={(e) => set({ email: e.target.value })} /></div>
        <Toggle checked={b.example} onChange={(example) => set({ example })} label="Mostrar como datos por confirmar" />
      </section>
      <SaveBar busy={r.busy} saved={r.everSaved} error={r.saveError} dirty={r.dirty} onSave={() => r.save()} />
      <ScheduleEditor onSaved={r.load} />
    </div>
  );
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Horario por día: decide cuándo se acepta «lo antes posible» y qué horas se pueden programar. */
function ScheduleEditor({ onSaved }: { onSaved: () => void }) {
  const r = useResource<Schedule>('/api/admin/schedule');
  if (!r.value) return null;
  const s = r.value;
  const setDay = (d: number, v: Schedule['days'][number]) => r.setValue({ ...s, days: s.days.map((x, i) => (i === d ? v : x)) });
  return (
    <section className="card stack">
      <h2>Horario de pedidos</h2>
      <p className="muted small">Fuera de este horario la tienda solo deja programar pedidos.</p>
      {ORDER.map((d) => {
        const h = s.days[d];
        return (
          <div key={d} className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span style={{ width: 96, fontWeight: 600 }}>{DAYS[d]}</span>
            <Toggle checked={!!h} onChange={(on) => setDay(d, on ? { open: '12:00', close: '20:00' } : null)} label={h ? 'Abierto' : 'Cerrado'} />
            {h && (
              <>
                <input aria-label={`Abre ${DAYS[d]}`} type="time" className="input sm" style={{ width: 130 }} value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} />
                <span>a</span>
                <input aria-label={`Cierra ${DAYS[d]}`} type="time" className="input sm" style={{ width: 130 }} value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} />
              </>
            )}
          </div>
        );
      })}
      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="field" style={{ width: 200 }}>
          <label>Anticipación mínima (min)</label>
          <input className="input sm" inputMode="numeric" value={s.leadMinutes} onChange={(e) => r.setValue({ ...s, leadMinutes: parseInt(e.target.value, 10) || 0 })} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>Programar hasta (días)</label>
          <input className="input sm" inputMode="numeric" value={s.maxDays} onChange={(e) => r.setValue({ ...s, maxDays: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
        </div>
      </div>
      <p className="legal-body muted small">{scheduleText(s)}</p>
      <SaveBar busy={r.busy} saved={r.everSaved} error={r.saveError} dirty={r.dirty} onSave={() => r.save().then(onSaved)} />
    </section>
  );
}

// ── Textos legales ────────────────────────────────────────────────────

export function LegalSettings() {
  const r = useResource<LegalDoc[]>('/api/admin/legal');
  if (r.error) return <LoadError message={r.error} retry={r.load} />;
  if (!r.value) return <Spinner label="Cargando…" />;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Textos legales</h1>
        <p className="muted">Son borradores. Revísalos con tu asesor y márcalos como aprobados para quitar el aviso de «borrador» en la tienda.</p>
      </div>
      {r.value.map((doc, i) => (
        <LegalEditor key={doc.slug} doc={doc} onChange={(d) => r.setValue(r.value!.map((x, j) => (j === i ? d : x)))} />
      ))}
    </div>
  );
}

function LegalEditor({ doc, onChange }: { doc: LegalDoc; onChange: (d: LegalDoc) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card stack">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h2>{doc.title}</h2>
        <a href={`/legal/${doc.slug}`} target="_blank" rel="noreferrer" className="small">Ver en la tienda</a>
      </div>
      <textarea className="textarea" style={{ minHeight: 220 }} value={doc.body} onChange={(e) => onChange({ ...doc, body: e.target.value })} aria-label={doc.title} />
      <Toggle checked={doc.approved} onChange={(approved) => onChange({ ...doc, approved })} label="Aprobado por el negocio" />
      <div className="row">
        <button
          className="btn primary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await api(`/api/admin/legal/${doc.slug}`, { method: 'PUT', body: { title: doc.title, body: doc.body, approved: doc.approved } });
              setMsg('Guardado ✓');
            } catch (e) {
              setMsg((e as Error).message);
            }
            setBusy(false);
          }}
        >
          Guardar
        </button>
        {msg && <span className="small" role="status">{msg}</span>}
      </div>
    </section>
  );
}

// ── QR y estado del sistema ──────────────────────────────────────────

type SystemRes = { payments: string; onlinePaymentReady: boolean; webhookSecret: boolean; notifyWebhook: boolean; whatsapp: string; publicUrl: string; httpsPublicUrl: boolean; lastWebhooks: { at: string; verified: number; result: string }[] };
type QrRes = { url: string; svg: string; scans: { day: string; source: string; count: number }[] };

export function SystemSettings() {
  const [sys, setSys] = useState<SystemRes | null>(null);
  const [qr, setQr] = useState<QrRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => Promise.all([api<SystemRes>('/api/admin/system'), api<QrRes>('/api/admin/qr')]).then(([s, q]) => { setSys(s); setQr(q); }, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (error) return <LoadError message={error} retry={load} />;
  if (!sys || !qr) return <Spinner label="Cargando…" />;

  const download = () => {
    const url = URL.createObjectURL(new Blob([qr.svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fresia-office-qr.svg';
    a.click();
    URL.revokeObjectURL(url);
  };
  const check = (ok: boolean, yes: string, no: string) => <span className={`badge ${ok ? 'ok' : 'warn'}`}>{ok ? yes : no}</span>;

  return (
    <div className="stack-lg">
      <h1>QR y sistema</h1>
      <section className="card stack">
        <h2>QR permanente</h2>
        <p className="muted">Imprime este QR una sola vez: siempre abre el menú vigente, aunque cambies productos o precios.</p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
        <code className="small">{qr.url}</code>
        {!sys.httpsPublicUrl && <p className="notice warn small">PUBLIC_URL aún no es tu dominio definitivo con https. Configúralo antes de imprimir.</p>}
        <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={download}>Descargar SVG</button>
        {qr.scans.length > 0 && (
          <table>
            <thead><tr><th>Día</th><th>Origen</th><th>Escaneos</th></tr></thead>
            <tbody>{qr.scans.map((s) => <tr key={s.day + s.source}><td>{s.day}</td><td>{s.source}</td><td>{s.count}</td></tr>)}</tbody>
          </table>
        )}
      </section>
      <QrSources />

      <section className="card stack">
        <h2>Configuración</h2>
        <dl className="kv">
          <dt>Pago en línea</dt>
          <dd>{check(sys.payments === 'mercadopago', 'Mercado Pago activo', 'Falta configurar Mercado Pago · la tienda solo ofrece pago al recibir')}</dd>
          <dt>Firma de notificaciones</dt>
          <dd>{check(sys.webhookSecret, 'Configurada', 'Falta MP_WEBHOOK_SECRET')}</dd>
          <dt>URL pública</dt>
          <dd>{check(sys.httpsPublicUrl, sys.publicUrl, `${sys.publicUrl} (sin https: Mercado Pago no podrá notificar)`)}</dd>
          <dt>Aviso por WhatsApp</dt>
          <dd>{check(!!sys.whatsapp, `Activo (${sys.whatsapp})`, 'Falta configurar WHATSAPP_PROVIDER')}</dd>
          <dt>Avisos externos</dt>
          <dd>{check(sys.notifyWebhook, 'NOTIFY_WEBHOOK_URL configurado', 'Solo en este panel')}</dd>
        </dl>
        {sys.lastWebhooks.length > 0 && (
          <>
            <h3>Últimas notificaciones de Mercado Pago</h3>
            <table>
              <tbody>{sys.lastWebhooks.map((w, i) => <tr key={i}><td className="small">{formatDate(w.at)}</td><td>{w.verified ? 'Firmada' : 'Sin firma'}</td><td className="small">{w.result}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

/** Aviso si «Pagar en línea» está marcado pero aún no se puede ofrecer (falta Mercado Pago). */
function OnlineNote() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    void api<{ onlinePaymentReady: boolean }>('/api/admin/me').then((r) => setReady(r.onlinePaymentReady));
  }, []);
  if (ready !== false) return null;
  return <p className="muted small">Se mostrará a los clientes cuando configures Mercado Pago. Mientras tanto solo ven «pago al recibir».</p>;
}

type Source = { slug: string; label: string; scans: number; orders: number; sales: number; url: string };

/** Un QR por edificio: cuántos lo escanean, cuántos piden y cuánto venden. */
function QrSources() {
  const [list, setList] = useState<Source[] | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ sources: Source[] }>('/api/admin/qr-sources').then((r) => setList(r.sources), (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const slugOf = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  async function add() {
    setError(null);
    try {
      await api('/api/admin/qr-sources', { body: { label: label.trim(), slug: slugOf(label) } });
      setLabel('');
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download(s: Source) {
    const svg = await (await fetch(`/api/admin/qr-sources/${s.slug}/svg`, { credentials: 'same-origin' })).text();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fresia-qr-${s.slug}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card stack">
      <h2>QR por edificio</h2>
      <p className="muted">Imprime un QR distinto para cada edificio o empresa y ve cuál trae más pedidos.</p>
      <form className="row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="input sm" style={{ flex: '1 1 220px' }} placeholder="Ej. Torre Insurgentes 600" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nombre del edificio" />
        <button className="btn primary small" disabled={label.trim().length < 2}>Crear QR</button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {list && list.length > 0 && (
        <table>
          <thead><tr><th>Edificio</th><th>Escaneos</th><th>Pedidos</th><th>Ventas</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.slug}>
                <td>{s.label}<div className="muted small" style={{ wordBreak: 'break-all' }}>{s.url}</div></td>
                <td>{s.scans}</td>
                <td>{s.orders}</td>
                <td className="price">${(s.sales / 100).toLocaleString('es-MX')}</td>
                <td><button className="btn ghost small" onClick={() => download(s)}>QR</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">«Ventas» cuenta pedidos entregados. Los pedidos se atribuyen al último QR escaneado en los 30 días previos.</p>
    </section>
  );
}
