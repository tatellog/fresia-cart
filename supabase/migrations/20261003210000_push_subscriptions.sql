-- Dispositivos del negocio suscritos a notificaciones push del panel. Idempotente.
create table if not exists office.push_subscriptions (
  endpoint text primary key,
  keys jsonb not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
alter table office.push_subscriptions enable row level security;
alter table office.push_subscriptions force row level security;
revoke all on office.push_subscriptions from anon, authenticated, service_role;
grant select, insert, update, delete on office.push_subscriptions to fresia_office_app;
drop policy if exists app_access on office.push_subscriptions;
create policy app_access on office.push_subscriptions for all to fresia_office_app using (true) with check (true);
