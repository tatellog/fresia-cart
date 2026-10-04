import type { AdminOrder, OrderStatus } from '../../shared/types';
import { RANK, flowSteps, nextAction } from '../../shared/flow';
export { nextAction } from '../../shared/flow';

export function StatusFlow({ order, busy, onSet }: { order: AdminOrder; busy: boolean; onSet: (s: OrderStatus, collect: boolean) => void }) {
  const steps = flowSteps(order);
  const rank = RANK[order.orderStatus] ?? -1;
  const next = nextAction(order);
  const canAdvance = order.paymentStatus === 'aprobado' || order.paymentMethod === 'contra_entrega';
  return (
    <div className="stack">
      <ol className="flow" aria-label="Avance del pedido">
        {steps.map((s, i) => {
          const state = i < rank ? 'done' : i === rank ? 'current' : 'todo';
          return (
            <li key={s.key} className={`flow-step ${state}`}>
              <button
                type="button"
                disabled={busy || !canAdvance || order.orderStatus === 'cancelado' || i === rank}
                onClick={() => onSet(s.key, false)}
                aria-current={i === rank ? 'step' : undefined}
                title={i === rank ? 'Estado actual' : `Cambiar a «${s.label}»`}
              >
                <span className="flow-dot" aria-hidden="true">{i < rank ? '✓' : i + 1}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      {next && (
        <button type="button" className="btn primary block big-action" disabled={busy} onClick={() => onSet(next.status, next.collect)}>
          {next.label}
        </button>
      )}
      {!canAdvance && order.orderStatus !== 'cancelado' && order.orderStatus !== 'cotizando_envio' && (
        <p className="muted small">Espera a que se confirme el pago en línea para prepararlo.</p>
      )}
    </div>
  );
}
