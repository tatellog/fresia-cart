import type { GiftInfo } from '../../shared/types';

export const GIFT_KEY = 'fo.gift.v1';
export const emptyGift: GiftInfo & { on: boolean } = { on: false, to: '', note: '', anonymous: false };
export const GIFT_NOTE_MAX = 160;

/** Fresigrama: «Es un regalo», para quién, tarjeta y si se manda anónimo. */
export function GiftFields({ value, onChange, showErrors }: { value: GiftInfo & { on: boolean }; onChange: (v: GiftInfo & { on: boolean }) => void; showErrors: boolean }) {
  const set = (p: Partial<GiftInfo & { on: boolean }>) => onChange({ ...value, ...p });
  const toError = showErrors && value.on && value.to.trim().length < 2 ? 'Escribe para quién es el regalo.' : undefined;
  return (
    <section className={`gift-box stack${value.on ? ' on' : ''}`} aria-labelledby="gift-title">
      <label className="gift-toggle">
        <span className="grow">
          <strong id="gift-title">🎁 Es un regalo</strong>
          <span className="muted small" style={{ display: 'block' }}>Fresigrama: llega con tarjeta a alguien de la oficina.</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={value.on} onChange={(e) => set({ on: e.target.checked })} />
      </label>
      {value.on && (
        <>
          <div className="field">
            <label htmlFor="gift-to">Para</label>
            <input
              id="gift-to"
              className="input"
              placeholder="Ej. Ana · Piso 7, área de diseño"
              value={value.to}
              maxLength={80}
              onChange={(e) => set({ to: e.target.value })}
              aria-invalid={toError ? true : undefined}
            />
            {toError ? <span className="error-text">{toError}</span> : <span className="hint">Su nombre y dónde encontrarle.</span>}
          </div>
          <div className="field">
            <label htmlFor="gift-note">Tarjeta <span className="muted small">(opcional)</span></label>
            <textarea
              id="gift-note"
              className="textarea"
              placeholder="Ej. Gracias por cubrirme en la junta."
              value={value.note}
              maxLength={GIFT_NOTE_MAX}
              onChange={(e) => set({ note: e.target.value })}
            />
            <span className="hint">{value.note.length}/{GIFT_NOTE_MAX}</span>
          </div>
          <label className="gift-toggle">
            <span className="grow">
              <strong>Enviar anónimo</strong>
              <span className="muted small" style={{ display: 'block' }}>La tarjeta dirá «De: ¿adivina quién?».</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={value.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} />
          </label>
        </>
      )}
    </section>
  );
}
