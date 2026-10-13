import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { distanceM } from '../../shared/coverage';
import type { CourierMode } from '../../shared/types';
import { load, save } from '../lib/storage';

const MODES: { key: CourierMode; label: string }[] = [
  { key: 'walk', label: '🚶 A pie' },
  { key: 'bike', label: '🚲 Bici' },
  { key: 'moto', label: '🛵 Moto' },
];

type WakeLock = { release: () => Promise<void> };

/**
 * El repartidor comparte su ubicación con el cliente mientras el pedido va en camino.
 * Solo funciona con esta página abierta y la pantalla encendida (límite de la web).
 */
export function CourierShare({ orderId, autoStart }: { orderId: string; autoStart: boolean }) {
  const [state, setState] = useState<'idle' | 'sharing' | 'denied' | 'error'>('idle');
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [, tick] = useState(0);
  const watch = useRef<number | null>(null);
  const last = useRef<{ t: number; lat: number; lng: number } | null>(null);
  const lock = useRef<WakeLock | null>(null);
  const [mode, setModeState] = useState<CourierMode>(() => load<CourierMode>('fo.courier.mode', 'walk'));
  const modeRef = useRef(mode);
  const setMode = (m: CourierMode) => {
    setModeState(m);
    modeRef.current = m;
    save('fo.courier.mode', m);
    last.current = null; // manda el cambio en la siguiente lectura del GPS
  };

  function stop() {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    void lock.current?.release().catch(() => undefined);
    lock.current = null;
    setState('idle');
  }

  function start() {
    if (!('geolocation' in navigator)) return setState('error');
    setState('sharing');
    void (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock.current = l))
      .catch(() => undefined);
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const prev = last.current;
        // Envía cada 8 s o si se movió más de 15 m.
        if (prev && now - prev.t < 8000 && distanceM(prev, p) < 15) return;
        last.current = { t: now, ...p };
        // Sin señal no se detiene: se sigue intentando con la siguiente lectura del GPS.
        api(`/api/admin/orders/${orderId}/tracking`, { body: { ...p, accuracyM: Math.round(pos.coords.accuracy), mode: modeRef.current } }).then(
          () => setLastSent(Date.now()),
          () => (last.current = null),
        );
      },
      (err) => {
        // Permiso negado: se detiene. Sin señal o tiempo agotado: sigue intentando.
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setState('denied');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  useEffect(() => {
    if (autoStart) start();
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const ago = lastSent ? Math.round((Date.now() - lastSent) / 1000) : null;
  const stale = ago != null && ago > 30;
  return (
    <div className="gps-box" aria-labelledby="courier-title">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong id="courier-title">📍 Ubicación en vivo para el cliente</strong>
        {state === 'sharing' && (
          <span className={`badge ${stale ? 'warn' : ago != null ? 'ok' : ''}`}>{ago == null ? 'Buscando GPS…' : stale ? 'Sin señal' : 'En vivo'}</span>
        )}
      </div>
      {state === 'sharing' ? (
        <>
          <p className="small" style={{ margin: 0 }}>
            {ago == null
              ? 'Buscando tu ubicación. Si tarda, sal a un lugar abierto.'
              : stale
                ? `Sin señal desde hace ${ago} s: se reintenta solo. Puedes seguir con la entrega.`
                : `Enviada hace ${ago} s. Deja esta pantalla abierta hasta entregar.`}
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <details className="more">
              <summary>Voy {MODES.find((m) => m.key === mode)?.label.toLowerCase()}</summary>
              <div className="tabs" role="group" aria-label="¿Cómo vas?" style={{ marginTop: 8 }}>
                {MODES.map((m) => (
                  <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>
                ))}
              </div>
            </details>
            <button className="linkbtn small" onClick={stop}>Dejar de compartir</button>
          </div>
        </>
      ) : (
        <>
          {state === 'denied' && <p className="error-text small" style={{ margin: 0 }}>No diste permiso de ubicación. Actívalo en el navegador; la entrega puede seguir sin él.</p>}
          {state === 'error' && <p className="error-text small" style={{ margin: 0 }}>Este celular no tiene GPS disponible. La entrega puede seguir sin él.</p>}
          <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={start}>Compartir mi ubicación</button>
        </>
      )}
    </div>
  );
}
