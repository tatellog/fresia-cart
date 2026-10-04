-- Efectivo al recibir: con cuánto paga el cliente, para llevar cambio. Idempotente.
alter table office.orders add column if not exists cash_tendered integer;
alter table office.orders drop constraint if exists orders_cash_tendered_check;
alter table office.orders add constraint orders_cash_tendered_check check (cash_tendered is null or cash_tendered >= 0);
