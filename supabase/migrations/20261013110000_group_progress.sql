-- Pedido de equipo (FO-005/006): cierre manual, lista de participantes. Idempotente.

-- «cerrado»: ya no se aceptan selecciones nuevas, pero aún no se paga.
alter table office.group_orders drop constraint if exists group_orders_status_check;
alter table office.group_orders add constraint group_orders_status_check check (status in ('abierto', 'cerrado', 'pedido', 'cancelado'));

-- Quién entró al pedido (aunque todavía no agregue nada). Solo el nombre que escribió; sin teléfono.
create table if not exists office.group_members (
  group_id uuid not null references office.group_orders(id) on delete cascade,
  member_key text not null,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, member_key)
);

alter table office.group_members enable row level security;
alter table office.group_members force row level security;
revoke all on office.group_members from anon, authenticated, service_role;
grant select, insert, update, delete on office.group_members to fresia_office_app;
drop policy if exists app_access on office.group_members;
create policy app_access on office.group_members for all to fresia_office_app using (true) with check (true);
