-- Medición (FO-001): eventos anónimos del embudo y atribución del pedido. Idempotente.
-- Sin datos personales: visitante = id aleatorio del navegador; nada de nombre, teléfono ni dirección.

alter table office.orders add column if not exists utm_source text;
alter table office.orders add column if not exists utm_medium text;
alter table office.orders add column if not exists utm_campaign text;
alter table office.orders add column if not exists device text;
alter table office.orders add column if not exists order_mode text;
alter table office.orders drop constraint if exists orders_order_mode_check;
alter table office.orders add constraint orders_order_mode_check check (order_mode is null or order_mode in ('individual', 'equipo', 'regalo'));

create table if not exists office.analytics_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('visita', 'ver_producto', 'agregar_carrito', 'crear_equipo', 'unirse_equipo', 'iniciar_checkout', 'compra')),
  visitor text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device text,
  mode text,
  product_id text,
  order_id uuid references office.orders(id)
);
create index if not exists analytics_events_at_idx on office.analytics_events (at);
-- Una compra se cuenta una sola vez aunque llegue el aviso de pago varias veces.
create unique index if not exists analytics_events_order_once on office.analytics_events (event, order_id) where order_id is not null;

alter table office.analytics_events enable row level security;
alter table office.analytics_events force row level security;
revoke all on office.analytics_events from anon, authenticated, service_role;
grant select, insert, delete on office.analytics_events to fresia_office_app;
grant usage on sequence office.analytics_events_id_seq to fresia_office_app;
drop policy if exists app_access on office.analytics_events;
create policy app_access on office.analytics_events for all to fresia_office_app using (true) with check (true);
