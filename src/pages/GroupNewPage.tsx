import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { rememberGroupAdmin, setActiveGroup } from '../lib/groupState';
import { Field, Spinner, TopBar } from '../components/ui';

const LIMITS: { label: string; minutes: number | null }[] = [
  { label: 'Sin límite', minutes: null },
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
];

/** Crea un pedido de equipo y lleva al enlace para compartir. */
export default function GroupNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [minutes, setMinutes] = useState<number | null>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const g = await api<{ code: string; adminToken: string }>('/api/groups', { body: { name: name.trim(), organizerName: organizer.trim(), closesInMinutes: minutes } });
      rememberGroupAdmin(g.code, g.adminToken);
      setActiveGroup({ code: g.code, name: name.trim(), memberName: organizer.trim() });
      navigate(`/equipo/${g.code}?nuevo=1`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page stack-lg">
      <TopBar back="/" step="Pedido de equipo" />
      <div className="stack" style={{ gap: 6 }}>
        <h1>👥 Pedido de equipo</h1>
        <p className="muted">Comparte un enlace con tu equipo: cada quien elige lo suyo y tú haces un solo pedido con todo.</p>
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Nombre del pedido" placeholder="Ej. Equipo de Ventas, Piso 4" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        <Field label="Tu nombre" autoComplete="given-name" value={organizer} onChange={(e) => setOrganizer(e.target.value)} maxLength={40} required />
        <fieldset>
          <legend className="label" style={{ marginBottom: 10 }}>¿Hasta cuándo pueden agregar?</legend>
          <div className="tabs" role="group">
            {LIMITS.map((l) => (
              <button key={l.label} type="button" aria-pressed={minutes === l.minutes} onClick={() => setMinutes(l.minutes)}>{l.label}</button>
            ))}
          </div>
        </fieldset>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || name.trim().length < 2 || organizer.trim().length < 2}>
          {busy ? <Spinner label="Creando…" /> : 'Crear y compartir'}
        </button>
      </form>
    </main>
  );
}
