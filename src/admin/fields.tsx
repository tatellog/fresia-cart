import { useEffect, useState } from 'react';

/** Importe en pesos; guarda centavos. */
export function MoneyInput({ value, onChange, label, id }: { value: number; onChange: (cents: number) => void; label: string; id?: string }) {
  const [text, setText] = useState(String(value / 100));
  useEffect(() => {
    setText(String(value / 100));
  }, [value]);
  return (
    <input
      id={id}
      aria-label={label}
      className="input sm"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Math.round(parseFloat(text.replace(/[$,\s]/g, '')) * 100);
        if (Number.isFinite(n) && n >= 0) onChange(n);
        else setText(String(value / 100));
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function SaveBar({ busy, saved, error, onSave, dirty }: { busy: boolean; saved: boolean; error: string | null; onSave: () => void; dirty: boolean }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={onSave}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {saved && !dirty && <span className="muted small" role="status">Guardado ✓</span>}
      </div>
    </div>
  );
}

export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'item';

export const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
