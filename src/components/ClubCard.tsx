import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ClubCard } from '../../shared/types';

/** Frésia Club: sellos de la tarjeta con el mismo teléfono, o invitación a unirse. */
export function ClubCardView({ number, token, delivered }: { number: string; token: string; delivered: boolean }) {
  const [club, setClub] = useState<ClubCard | null>(null);

  useEffect(() => {
    let alive = true;
    // Al entregar, el sello se suma en segundo plano: se consulta de nuevo unos segundos después.
    const id = setTimeout(
      () => {
        api<{ club: ClubCard | null }>(`/api/orders/${encodeURIComponent(number)}/club?t=${encodeURIComponent(token)}`)
          .then((r) => { if (alive) setClub(r.club); })
          .catch(() => {});
      },
      delivered ? 2500 : 0,
    );
    return () => { alive = false; clearTimeout(id); };
  }, [number, token, delivered]);

  if (!club) return null;
  if (!club.found) {
    return (
      <section className="card flat stack club-card" aria-labelledby="club-title">
        <h2 id="club-title">🍓 Frésia Club</h2>
        <p className="small">Junta sellos con cada pedido y llévate una Frésia gratis. Regístrate con el mismo teléfono de este pedido.</p>
        <a className="btn block" href={club.joinUrl} target="_blank" rel="noopener">Unirme a Frésia Club</a>
      </section>
    );
  }
  const stamps = Array.from({ length: club.goal }, (_, i) => i < club.visits);
  return (
    <section className="card flat stack club-card" aria-labelledby="club-title">
      <h2 id="club-title">🍓 Frésia Club · {club.name}</h2>
      <div className="club-stamps" aria-label={`${club.visits} de ${club.goal} sellos`}>
        {stamps.map((on, i) => <span key={i} className={on ? 'on' : ''}>{on ? '🍓' : ''}</span>)}
      </div>
      <p className="small">
        {club.rewardsPending > 0
          ? `¡Tienes ${club.rewardsPending === 1 ? 'una Frésia gratis' : `${club.rewardsPending} Frésias gratis`}! Muestra tu tarjeta en la tienda.`
          : `${club.visits} de ${club.goal} sellos. ${delivered ? 'Este pedido ya suma.' : 'Este pedido suma un sello al entregarse.'}`}
      </p>
      <a className="btn block" href={club.cardUrl} target="_blank" rel="noopener">Ver mi tarjeta</a>
    </section>
  );
}
