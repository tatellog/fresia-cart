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
    <fieldset className="stack" style={{ gap: 12 }}>
      <legend className="choice-legend"><span>¿Cuándo lo quieres?</span></legend>
      {open ? (
        <div className="segmented when">
          <label className="option">
            <input type="radio" name="when" checked={!programmed} onChange={() => onChange(null)} />
            <strong>⚡ Lo antes posible</strong>
            <span className="muted small">{asapLabel}</span>
          </label>
          <label className="option">
            <input type="radio" name="when" checked={programmed} onChange={() => onChange(current?.slots[0]?.iso ?? null)} />
            <strong>📅 Programar</strong>
            <span className="muted small">Para una junta o un cumpleaños</span>
          </label>
        </div>
      ) : (
        <p className="notice small" style={{ margin: 0 }}>Ahora estamos cerrados{nextOpening(now, schedule) ? `; abrimos ${nextOpening(now, schedule)!.replace(/\.$/, '')}` : ''}. Elige cuándo lo quieres.</p>
      )}
      {programmed && current && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="tabs" role="group" aria-label="Día">
            {days.map((d) => (
              <button key={d.key} type="button" aria-pressed={d.key === current.key} onClick={() => { setDay(d.key); onChange(d.slots[0].iso); }}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="field">
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
