import { useEffect, useMemo, useState } from 'react';
import { availableSlots, isOpenAt, nextOpening } from '../../shared/schedule';
import type { Schedule } from '../../shared/schedule';

/** «Lo antes posible» o un día y hora dentro del horario de Frésia. */
export function WhenPicker({ schedule, value, onChange, asapLabel }: { schedule: Schedule; value: string | null; onChange: (iso: string | null) => void; asapLabel: string }) {
  const now = new Date();
  const open = isOpenAt(now, schedule);
  const days = useMemo(() => availableSlots(new Date(), schedule), [schedule]);
  const [day, setDay] = useState(() => days.find((d) => d.slots.some((s) => s.iso === value))?.key ?? days[0]?.key ?? '');
  const programmed = value != null || !open;
  const current = days.find((d) => d.key === day) ?? days[0];
  // Cerrado: «Programar» es la única opción; deja elegida la primera hora disponible.
  useEffect(() => {
    if (!open && value == null && days[0]?.slots[0]) onChange(days[0].slots[0].iso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, days]);

  return (
    <fieldset className="stack" style={{ gap: 10 }}>
      <legend className="label" style={{ marginBottom: 10 }}>¿Cuándo lo quieres?</legend>
      <div className="options">
        <label className="option">
          <input type="radio" name="when" checked={!programmed} disabled={!open} onChange={() => onChange(null)} />
          <span className="mark" aria-hidden="true" />
          <span className="grow">
            <strong>Lo antes posible</strong>
            <span className="muted small" style={{ display: 'block' }}>{open ? asapLabel : `Ahora estamos cerrados; abrimos ${nextOpening(now, schedule) ?? 'pronto'}`}</span>
          </span>
        </label>
        <label className="option">
          <input type="radio" name="when" checked={programmed} onChange={() => onChange(current?.slots[0]?.iso ?? null)} />
          <span className="mark" aria-hidden="true" />
          <span className="grow">
            <strong>Programar</strong>
            <span className="muted small" style={{ display: 'block' }}>Elige el día y la hora (ideal para juntas y cumpleaños).</span>
          </span>
        </label>
      </div>
      {programmed && current && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="tabs" role="group" aria-label="Día">
            {days.map((d) => (
              <button key={d.key} type="button" aria-pressed={d.key === current.key} onClick={() => { setDay(d.key); onChange(d.slots[0].iso); }}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="when-time">Hora</label>
            <select id="when-time" className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
              {current.slots.map((s) => <option key={s.iso} value={s.iso}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}
      {!days.length && <p className="error-text">No hay horarios disponibles por ahora.</p>}
    </fieldset>
  );
}
