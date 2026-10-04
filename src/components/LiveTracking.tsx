import { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { distanceM, etaMinutes } from '../../shared/coverage';
import type { TrackingInfo } from '../../shared/types';
import { Spinner } from './ui';

const LiveMap = lazy(() => import('./LiveMap'));

/** Seguimiento del repartidor para el cliente, actualizado cada 5 s. */
export function LiveTracking({ number, token }: { number: string; token: string }) {
  const [info, setInfo] = useState<TrackingInfo | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<TrackingInfo>(`/api/orders/${encodeURIComponent(number)}/tracking?t=${encodeURIComponent(token)}`).then(
        (r) => alive && setInfo(r),
        () => undefined,
      );
    void load();
    const id = setInterval(load, 5000);
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(clock);
    };
  }, [number, token]);

  if (!info) return null;
  const c = info.courier;
  const left = c && info.destination ? Math.round(distanceM(c, info.destination)) : null;
  const mode = c?.mode ?? 'walk';
  const how = { walk: { icon: '🚶', text: 'a pie' }, bike: { icon: '🚲', text: 'en bici' }, moto: { icon: '🛵', text: 'en moto' } }[mode];
  const eta = left != null ? etaMinutes(left, mode) : null;
  const ago = c ? Math.max(0, Math.round((Date.now() - Date.parse(c.updatedAt)) / 1000)) : null;

  return (
    <section className="card stack" aria-labelledby="track-title">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h2 id="track-title">{how.icon} Tu pedido va en camino{c ? ` ${how.text}` : ''}</h2>
        {c && <span className="badge ok">En vivo</span>}
      </div>
      <p className="muted" aria-live="polite">
        {c
          ? left != null
            ? left < 40
              ? '¡Está llegando!'
              : `Llega en ~${eta} min · a unos ${left} m de tu entrega.`
            : 'Puedes ver al repartidor en el mapa.'
          : 'En cuanto el repartidor comparta su ubicación, la verás aquí.'}
        {ago != null && <span className="small"> · actualizado hace {ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`}</span>}
      </p>
      <Suspense fallback={<div className="live-map"><Spinner label="Cargando mapa…" /></div>}>
        <LiveMap store={info.store} courier={c} destination={info.destination} trail={info.trail} mode={mode} />
      </Suspense>
    </section>
  );
}
