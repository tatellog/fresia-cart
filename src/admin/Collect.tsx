import { collectInfo } from '../../shared/status';
import { money } from '../lib/format';
import type { PublicOrder } from '../../shared/types';

/** ¿Ya está pagado o hay que cobrar? Lo primero que debe ver quien entrega. */
export function CollectPill({ order }: { order: PublicOrder }) {
  const c = collectInfo(order, money);
  return (
    <span className={`collect collect-${c.tone}`}>
      {c.tone === 'paid' ? '✅' : c.tone === 'collect' ? '💵' : c.tone === 'pending' ? '⏳' : '—'} {c.label}
    </span>
  );
}

export function CollectBox({ order }: { order: PublicOrder }) {
  const c = collectInfo(order, money);
  const detail =
    c.tone === 'collect'
      ? order.fulfillment === 'pickup'
        ? 'Efectivo o terminal en el local.'
        : order.cashTendered == null
          ? 'Solo efectivo. El cliente no indicó con cuánto paga: lleva cambio.'
          : c.change
            ? `Paga con ${money(order.cashTendered)} → lleva ${money(c.change)} de cambio.`
            : 'Paga con el monto exacto.'
      : c.tone === 'paid'
        ? 'No cobres nada al entregar.'
        : c.tone === 'pending'
          ? 'El cliente aún no termina de pagar en línea. No lo prepares todavía.'
          : '';
  return (
    <div className={`collect-box collect-${c.tone}`} role="status">
      <strong>
        {c.tone === 'paid' ? '✅' : c.tone === 'collect' ? '💵' : c.tone === 'pending' ? '⏳' : '—'} {c.label}
      </strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}
