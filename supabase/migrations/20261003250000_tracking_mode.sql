-- Cómo va el repartidor (a pie, bici o moto) para el ícono y el tiempo estimado. Idempotente.
alter table office.order_tracking add column if not exists mode text not null default 'walk';
alter table office.order_tracking drop constraint if exists order_tracking_mode_check;
alter table office.order_tracking add constraint order_tracking_mode_check check (mode in ('walk', 'bike', 'moto'));
