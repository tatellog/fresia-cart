import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { distanceM } from '../../shared/coverage';

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
        api(`/api/admin/orders/${orderId}/tracking`, { body: { ...p, accuracyM: Math.round(pos.coords.accuracy) } }).then(
          () => setLastSent(Date.now()),
          () => setState('error'),
        );
      },
      (err) => {
        setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
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
  return (
    <section className="card stack" aria-labelledby="courier-title">
      <h2 id="courier-title">🛵 Ubicación para el cliente</h2>
      {state === 'sharing' ? (
        <>
          <p className="notice ok">
            Compartiendo tu ubicación con el cliente{ago != null ? ` · enviada hace ${ago} s` : ' · buscando GPS…'}. Deja esta pantalla abierta hasta entregar.
          </p>
          <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={stop}>Dejar de compartir</button>
        </>
      ) : (
        <>
          {state === 'denied' && <p className="error-text">No diste permiso de ubicación. Actívalo en el navegador para que el cliente te vea en el mapa.</p>}
          {state === 'error' && <p className="error-text">No se pudo enviar la ubicación. Revisa la señal y vuelve a intentar.</p>}
          <p className="muted">Si tú llevas el pedido, comparte tu ubicación desde este celular para que el cliente vea dónde vas.</p>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={start}>Compartir mi ubicación</button>
        </>
      )}
    </section>
  );
}
