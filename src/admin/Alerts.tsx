import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { load, save } from '../lib/storage';

// ── Notificaciones push en este dispositivo ─────────────────────────────

export type PushDevice = { endpoint: string; label: string; lastSuccessAt: string | null; lastReceivedAt: string | null; lastReceivedBackground: boolean | null };
type PushInfo = { configured: boolean; publicKey: string; devices: PushDevice[] };

/** Un dispositivo está verificado si mostró un aviso con el panel cerrado o en segundo plano en los últimos 14 días. */
export const verified = (d: PushDevice) => !!d.lastReceivedAt && d.lastReceivedBackground === true && Date.now() - Date.parse(d.lastReceivedAt) < 14 * 86400_000;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ` · ${br}` : ''}`;
}

export function PushSetup() {
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    setInfo(await api<PushInfo>('/api/admin/push'));
    if (supported()) {
      const reg = await navigator.serviceWorker.getRegistration('/admin/');
      const sub = await reg?.pushManager.getSubscription();
      setMine(sub?.endpoint ?? null);
    }
  };
  useEffect(() => void refresh().catch(() => undefined), []);
  // Al volver al panel (p. ej. después de la prueba con el panel cerrado) se ve si llegó el aviso.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh().catch(() => undefined);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!info) return null;
  const subscribed = mine && info.devices.some((d) => d.endpoint === mine);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('No diste permiso de notificaciones. Actívalo en la configuración del navegador.');
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/admin/' });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(info!.publicKey) }));
      await api('/api/admin/push/subscribe', { body: { subscription: sub.toJSON(), label: deviceLabel() } });
      await refresh();
      setMsg('Listo. Te mandamos una prueba.');
      await api('/api/admin/push/test', { body: {} });
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration('/admin/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/api/admin/push/unsubscribe', { body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    await refresh();
    setBusy(false);
  }

  async function test(delaySeconds = 0) {
    setBusy(true);
    const r = await api<{ sent?: number; scheduled?: boolean }>('/api/admin/push/test', { body: { delaySeconds } });
    setMsg(
      r.scheduled
        ? `Listo: en ${delaySeconds} s llega un aviso de PRUEBA. Cierra el panel o bloquea el teléfono ahora y espera a que suene. Al volver verás aquí si llegó.`
        : r.sent
          ? `Prueba enviada a ${r.sent} dispositivo(s).`
          : 'No hay dispositivos activos.',
    );
    setBusy(false);
    // Revisa los acuses durante un minuto (si el panel sigue abierto) y otra vez al volver.
    const until = Date.now() + 60_000;
    const poll = setInterval(() => (Date.now() > until ? clearInterval(poll) : void refresh().catch(() => undefined)), 5000);
  }


  return (
    <section className="card stack" aria-labelledby="push-title">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h2 id="push-title">🔔 Avisos de pedidos nuevos</h2>
        <span className="muted small">{info.devices.length} dispositivo(s) activo(s)</span>
      </div>
      {!info.configured ? (
        <p className="notice warn">Faltan las claves VAPID en el servidor.</p>
      ) : !supported() ? (
        isIOS() && !isStandalone() ? (
          <p className="notice">
            En iPhone, primero instala el panel: toca <strong>Compartir</strong> → <strong>Agregar a inicio</strong>, abre <strong>Frésia Panel</strong> desde el ícono e inicia sesión. Ahí aparecerá el botón para activar avisos.
          </p>
        ) : (
          <p className="notice warn">Este navegador no admite notificaciones. Usa Chrome, Edge, Firefox o Safari reciente.</p>
        )
      ) : subscribed ? (
        <>
          <p className="notice ok">Este dispositivo está suscrito a los avisos de pedidos nuevos.</p>
          <ol className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>Toca «Probar con el panel cerrado».</li>
            <li>Cierra el panel o bloquea el teléfono en menos de 20 s.</li>
            <li>Debe sonar y aparecer «🔔 PRUEBA · Pedido nuevo». Al volver, aquí dirá si llegó.</li>
          </ol>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary small" disabled={busy} onClick={() => test(20)}>Probar con el panel cerrado (20 s)</button>
            <button className="btn secondary small" disabled={busy} onClick={() => test(0)}>Probar ahora</button>
            <button className="linkbtn" disabled={busy} onClick={disable}>Desactivar en este dispositivo</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Recibe una notificación en este dispositivo cada vez que entre un pedido, aunque tengas el panel cerrado.</p>
          <button className="btn primary small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={enable}>
            {busy ? 'Activando…' : 'Activar avisos en este dispositivo'}
          </button>
        </>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
      {info.devices.length > 0 && (
        <ul className="device-list">
          {info.devices.map((d) => (
            <li key={d.endpoint}>
              <strong>{d.label || 'Dispositivo'}{mine === d.endpoint ? ' (este)' : ''}</strong>
              <span className={`small ${verified(d) ? 'ok-text' : 'warn-text'}`}>
                {verified(d)
                  ? `✅ Verificado: recibió un aviso con el panel cerrado ${ago(d.lastReceivedAt!)}`
                  : d.lastReceivedAt
                    ? `⚠️ Recibió un aviso ${ago(d.lastReceivedAt)}, pero con el panel abierto. Falta probar con el panel cerrado.`
                    : '⚠️ Aún no confirma haber recibido ningún aviso.'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Si los avisos no llegan: deja el panel abierto en una tablet o laptop del local con «Activar sonido» y «Mantener pantalla encendida»; suena con cada pedido y repite el aviso cada 45 s.
      </p>
    </section>
  );
}

// ── Sonido y pantalla encendida (laptop del local) ──────────────────────

let audio: AudioContext | null = null;

/** Una nota suave tipo marimba: fundamental + armónico tenue con caída larga (suena a madera, no a alarma). */
function note(ctx: AudioContext, freq: number, at: number, length = 1.1, peak = 0.22) {
  [[freq, peak], [freq * 4, peak / 9]].forEach(([f, p]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(p, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + length + 0.05);
  });
}

/** Pedido nuevo: dos frases ascendentes (~2.5 s), alegre y sin estridencia. */
export function chime() {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.05;
  // sol–si–re … si–re–sol (agudo, sostenido)
  [[784, 0], [988, 0.18], [1175, 0.36], [988, 0.9], [1175, 1.08], [1568, 1.26]].forEach(([f, d], i, all) =>
    note(audio!, f, t0 + d, i === all.length - 1 ? 1.4 : 0.9),
  );
}

/** Pedido cancelado: dos notas descendentes, más graves, para distinguirlo sin mirar. */
export function cancelChime() {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.05;
  note(audio, 659, t0, 0.9, 0.2);
  note(audio, 523, t0 + 0.3, 1.3, 0.2);
}

type WakeLock = { release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void };

export function DeskControls() {
  const [sound, setSound] = useState(() => load('fo.admin.sound', false) && audio?.state === 'running');
  const [awake, setAwake] = useState(false);
  const lock = useRef<WakeLock | null>(null);
  const wantAwake = useRef(load('fo.admin.awake', false));
  const canWake = 'wakeLock' in navigator;

  async function requestWake() {
    try {
      lock.current = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<WakeLock> } }).wakeLock.request('screen');
      setAwake(true);
      lock.current.addEventListener('release', () => setAwake(false));
    } catch {
      setAwake(false);
    }
  }

  useEffect(() => {
    if (wantAwake.current && canWake) void requestWake();
    // La pantalla se vuelve a bloquear al cambiar de pestaña: reintenta al volver.
    const onVis = () => document.visibilityState === 'visible' && wantAwake.current && canWake && void requestWake();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleSound() {
    if (sound) {
      setSound(false);
      save('fo.admin.sound', false);
      return;
    }
    audio ??= new AudioContext();
    await audio.resume();
    setSound(true);
    save('fo.admin.sound', true);
    chime();
  }

  async function toggleAwake() {
    if (awake) {
      wantAwake.current = false;
      save('fo.admin.awake', false);
      await lock.current?.release();
      return;
    }
    wantAwake.current = true;
    save('fo.admin.awake', true);
    await requestWake();
  }

  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button className={`btn small ${sound ? 'ghost' : 'secondary'}`} onClick={toggleSound} aria-pressed={sound}>
        {sound ? '🔊 Sonido activo' : '🔇 Activar sonido'}
      </button>
      {canWake && (
        <button className={`btn small ${awake ? 'ghost' : 'secondary'}`} onClick={toggleAwake} aria-pressed={awake}>
          {awake ? '☀️ Pantalla siempre encendida' : '🌙 Mantener pantalla encendida'}
        </button>
      )}
    </div>
  );
}
