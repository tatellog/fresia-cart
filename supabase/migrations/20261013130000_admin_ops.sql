-- Operación del panel: pedido visto, y cobro en efectivo separado de la entrega (importe recibido y cambio). Idempotente.
alter table office.orders add column if not exists seen_at timestamptz;
alter table office.orders add column if not exists cash_received integer;
alter table office.orders add column if not exists change_given integer;
