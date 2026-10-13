import type { AdminOrder, OrderStatus } from '../../shared/types';
import { RANK, flowSteps, nextAction } from '../../shared/flow';
export { nextAction } from '../../shared/flow';

export function StatusFlow({ order, busy, onSet, onCollect, hideNext }: { order: AdminOrder; busy: boolean; onSet: (s: OrderStatus) => void; onCollect: () => void; hideNext?: boolean }) {
  const steps = flowSteps(order);
  const done = order.orderStatus === 'entregado';
  const rank = RANK[order.orderStatus] ?? -1;
  const next = nextAction(order);
  const canAdvance = order.paymentStatus === 'aprobado' || order.paymentMethod === 'contra_entrega';
  return (
    <div className="stack">
      <ol className="flow" aria-label="Avance del pedido">
        {steps.map((s, i) => {
          const state = done || i < rank ? 'done' : i === rank ? 'current' : 'todo';
          return (
            <li key={s.key} className={`flow-step ${state}`}>
              <button
                type="button"
                disabled={busy || !canAdvance || order.orderStatus === 'cancelado' || i === rank}
                onClick={() => onSet(s.key)}
                aria-current={i === rank ? 'step' : undefined}
                title={i === rank ? 'Estado actual' : `Corregir a «${s.label}»`}
              >
                <span className="flow-dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
                {s.label}
                {state === 'current' && <span className="flow-now">Ahora</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {next && !hideNext && (
        <button type="button" className="btn primary block big-action" disabled={busy} onClick={() => (next.kind === 'collect' ? onCollect() : onSet(next.status))}>
          <span className="big-action-hint">Siguiente paso</span>
          <span>{next.label}</span>
        </button>
      )}
      {!canAdvance && order.orderStatus !== 'cancelado' && order.orderStatus !== 'cotizando_envio' && (
        <p className="muted small">Espera a que se confirme el pago en línea para prepararlo.</p>
      )}
    </div>
  );
}
