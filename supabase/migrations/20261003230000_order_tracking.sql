-- Ubicación en vivo del repartidor mientras el pedido va en camino. Idempotente.
create table if not exists office.order_tracking (
  order_id uuid primary key references office.orders(id),
  lat double precision not null,
  lng double precision not null,
  accuracy_m integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table office.order_tracking enable row level security;
alter table office.order_tracking force row level security;
revoke all on office.order_tracking from anon, authenticated, service_role;
grant select, insert, update, delete on office.order_tracking to fresia_office_app;
drop policy if exists app_access on office.order_tracking;
create policy app_access on office.order_tracking for all to fresia_office_app using (true) with check (true);
