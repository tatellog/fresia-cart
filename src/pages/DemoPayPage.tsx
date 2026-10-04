import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { Spinner } from '../components/ui';

type Pref = { title: string; amount: number; returnUrl: string };

/**
 * Simulador de la pantalla de pago. Solo existe en modo demostración: en
 * producción el cliente va a Mercado Pago. No imita la marca de Mercado Pago.
 */
export default function DemoPayPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [pref, setPref] = useState<Pref | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Pref>(`/api/demo/preferences/${encodeURIComponent(id)}`).then(setPref, (e: Error) => setError(e.message));
  }, [id]);

  async function choose(outcome: 'approved' | 'pending' | 'rejected') {
    setBusy(true);
    try {
      const r = await api<{ returnUrl: string }>(`/api/demo/preferences/${encodeURIComponent(id)}/pay`, { body: { outcome } });
      navigate(r.returnUrl, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="demo-banner" role="note">
        <strong>Demostración: no se realizan cobros.</strong> Esta pantalla reemplaza a Mercado Pago.
      </div>
      <main className="page stack-lg" style={{ paddingTop: 32 }}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="steps">Simulador de pago</p>
          <h1>¿Qué resultado quieres probar?</h1>
          <p className="muted">
            El servidor recibirá una notificación simulada y consultará el estado del pago, igual que lo hará con Mercado Pago.
          </p>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {!pref && !error && <Spinner label="Cargando…" />}
        {pref && (
          <>
            <div className="card row between">
              <span>{pref.title}</span>
              <span className="price">{money(pref.amount)}</span>
            </div>
            <div className="stack">
              <button className="btn primary block" disabled={busy} onClick={() => choose('approved')}>
                Simular pago aprobado
              </button>
              <button className="btn secondary block" disabled={busy} onClick={() => choose('pending')}>
                Simular pago pendiente (p. ej. efectivo)
              </button>
              <button className="btn secondary block" disabled={busy} onClick={() => choose('rejected')}>
                Simular pago rechazado
              </button>
              <button className="btn ghost block" disabled={busy} onClick={() => navigate(`${pref.returnUrl}${pref.returnUrl.includes('?') ? '&' : '?'}regreso=1`, { replace: true })}>
                Cancelar y volver a Frésia
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
