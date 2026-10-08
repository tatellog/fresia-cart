import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { load, save } from '../lib/storage';

// ── Notificaciones push en este dispositivo ─────────────────────────────

type PushInfo = { configured: boolean; publicKey: string; devices: { endpoint: string; label: string; lastSuccessAt: string | null }[] };

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

  async function test() {
    setBusy(true);
    const r = await api<{ sent: number; failed: number }>('/api/admin/push/test', { body: {} });
    setMsg(r.sent ? `Prueba enviada a ${r.sent} dispositivo(s).` : 'No hay dispositivos activos.');
    setBusy(false);
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
          <p className="notice ok">Este dispositivo recibe un aviso con cada pedido nuevo, aunque el panel esté cerrado.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn secondary small" disabled={busy} onClick={test}>Enviar prueba</button>
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
        <p className="muted small">Activos: {info.devices.map((d) => d.label || 'Dispositivo').join(' · ')}</p>
      )}
    </section>
  );
}

// ── Sonido y pantalla encendida (laptop del local) ──────────────────────

let audio: AudioContext | null = null;
export const soundOn = () => audio?.state === 'running';

/** Melodía suave tipo marimba (sol–si–re, ~1.5 s): se nota sin ser estridente. */
export function chime() {
  if (!audio || audio.state !== 'running') return;
  const ctx = audio;
  const t0 = ctx.currentTime + 0.05;
  [784, 988, 1175].forEach((f, i) => {
    const at = t0 + i * 0.2;
    // Fundamental + un armónico suave, con caída larga: suena a madera, no a alarma.
    [[f, 0.22], [f * 4, 0.025]].forEach(([freq, peak]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 1.15);
    });
  });
}

// Voces naturales primero (Paulina en Mac/iPhone, Google en Android/Chrome); se evitan las de juguete de macOS.
const NOVELTY = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/;
function spanishVoice(): SpeechSynthesisVoice | null {
  const voices = (window.speechSynthesis?.getVoices() ?? []).filter((v) => !NOVELTY.test(v.name));
  return (
    voices.find((v) => /Paulina/.test(v.name)) ??
    voices.find((v) => v.lang === 'es-MX') ??
    voices.find((v) => v.lang === 'es-US') ??
    voices.find((v) => v.lang.startsWith('es')) ??
    null
  );
}

/** Melodía y, al terminar, una voz tranquila que dice qué pasó. */
export function announce(text: string) {
  if (!soundOn()) return;
  chime();
  const synth = window.speechSynthesis;
  if (!synth) return;
  window.setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    const v = spanishVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'es-MX';
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 0.9;
    synth.cancel();
    synth.speak(u);
  }, 1100);
}

export const newOrdersText = (n: number) => (n === 1 ? 'Tienes un pedido nuevo.' : `Tienes ${n} pedidos nuevos.`);

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
    // Algunos navegadores cargan las voces después: se piden ya para la primera vez.
    window.speechSynthesis?.getVoices();
    announce('Listo. Así te avisaré de cada pedido nuevo.');
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
