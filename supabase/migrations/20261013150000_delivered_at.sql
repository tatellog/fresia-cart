-- Hora de entrega (para confirmarla al cliente). Se rellena desde el historial en pedidos ya entregados. Idempotente.
alter table office.orders add column if not exists delivered_at timestamptz;
update office.orders o set delivered_at = (
  select max(e.at) from office.order_events e where e.order_id = o.id and e.type = 'estado' and e.detail = 'entregado'
) where o.order_status = 'entregado' and o.delivered_at is null;
