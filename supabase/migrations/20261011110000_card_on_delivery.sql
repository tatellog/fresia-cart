-- Pagar al recibir con tarjeta (terminal de Mercado Pago que lleva el repartidor). Idempotente.
alter table office.orders add column if not exists pay_with_card boolean not null default false;
