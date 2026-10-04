import { useId } from 'react';
import { CFDI_USES, REGIMES, invoiceErrors } from '../../shared/invoice';
import type { InvoiceData } from '../../shared/invoice';

export const emptyInvoice: InvoiceData = { rfc: '', name: '', regime: '601', zip: '', use: 'G03', email: '' };

/** Datos fiscales (CFDI 4.0). Se muestran errores solo después de intentar continuar. */
export function InvoiceFields({ value, onChange, showErrors }: { value: InvoiceData; onChange: (v: InvoiceData) => void; showErrors: boolean }) {
  const id = useId();
  const e = showErrors ? invoiceErrors(value) : {};
  const set = (k: keyof InvoiceData, v: string) => onChange({ ...value, [k]: v });
  const field = (k: keyof InvoiceData, label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <input id={`${id}-${k}`} className="input" value={value[k]} onChange={(ev) => set(k, ev.target.value)} aria-invalid={e[k] ? true : undefined} {...props} />
      {e[k] && <span className="error-text">{e[k]}</span>}
    </div>
  );
  return (
    <div className="stack">
      <p className="muted small">Escribe los datos tal como aparecen en tu Constancia de Situación Fiscal. Te enviaremos la factura por correo.</p>
      {field('rfc', 'RFC', { autoCapitalize: 'characters', maxLength: 14, placeholder: 'ABC010101AB1' })}
      {field('name', 'Razón social', { autoCapitalize: 'characters', placeholder: 'EMPRESA EJEMPLO' })}
      <div className="field">
        <label htmlFor={`${id}-regime`}>Régimen fiscal</label>
        <select id={`${id}-regime`} className="select" value={value.regime} onChange={(ev) => set('regime', ev.target.value)} aria-invalid={e.regime ? true : undefined}>
          {REGIMES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        {e.regime && <span className="error-text">{e.regime}</span>}
      </div>
      <div className="two">
        {field('zip', 'CP fiscal', { inputMode: 'numeric', maxLength: 5 })}
        <div className="field">
          <label htmlFor={`${id}-use`}>Uso del CFDI</label>
          <select id={`${id}-use`} className="select" value={value.use} onChange={(ev) => set('use', ev.target.value)}>
            {CFDI_USES.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
          </select>
        </div>
      </div>
      {field('email', 'Correo para la factura', { type: 'email', inputMode: 'email', autoComplete: 'email' })}
    </div>
  );
}
