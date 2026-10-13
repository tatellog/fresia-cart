-- Avisos verificados y cobro en efectivo al entregar. Idempotente.

-- El dispositivo confirma que MOSTRÓ el aviso (y si el panel estaba cerrado o en segundo plano).
alter table office.push_subscriptions add column if not exists last_received_at timestamptz;
alter table office.push_subscriptions add column if not exists last_received_background boolean;

-- Quién registró el cobro, y cobros que quedaron pendientes al entregar (con el motivo).
alter table office.orders add column if not exists collected_by text;
alter table office.orders add column if not exists collect_pending_at timestamptz;
alter table office.orders add column if not exists collect_pending_reason text;
