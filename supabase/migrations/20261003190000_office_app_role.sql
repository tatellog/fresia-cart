-- Rol de mínimo privilegio para el servidor de Frésia Office.
-- El servidor NO debe conectarse como "postgres" (que se salta RLS y puede
-- tocar auth, storage, vault…). La contraseña se asigna fuera de git con
-- `npm run db:setup`. Idempotente.

do $$ begin
  create role fresia_office_app nologin noinherit nocreatedb nocreaterole nobypassrls;
exception when duplicate_object then null;
end $$;

alter role fresia_office_app set statement_timeout = '15s';
alter role fresia_office_app set idle_in_transaction_session_timeout = '30s';
alter role fresia_office_app set search_path = office;
alter role fresia_office_app connection limit 20;

-- Solo puede usar el esquema office; nada en public.
revoke all on schema public from fresia_office_app;
grant usage on schema office to fresia_office_app;

-- Permisos por tabla: exactamente lo que el servidor necesita.
revoke all on all tables in schema office from fresia_office_app;
grant select, insert, update          on office.settings          to fresia_office_app;
grant select, insert, update, delete  on office.products          to fresia_office_app;
grant select, insert, update, delete  on office.toppings          to fresia_office_app;
grant select, insert, update          on office.orders            to fresia_office_app; -- los pedidos no se borran
grant select, insert                  on office.payment_attempts  to fresia_office_app;
grant select, insert, update          on office.payments          to fresia_office_app;
grant select, insert                  on office.order_events      to fresia_office_app; -- historial de solo agregar
grant select, insert                  on office.webhook_log       to fresia_office_app;
grant select, insert, update          on office.demo_preferences  to fresia_office_app;
grant select, insert, update          on office.demo_payments     to fresia_office_app;
grant select, insert, update          on office.qr_scans          to fresia_office_app;
grant usage on sequence office.order_number_seq to fresia_office_app;

-- RLS: el rol de la app solo ve filas a través de estas políticas; los roles
-- de la API pública (anon/authenticated) no tienen ninguna.
do $$
declare t text;
begin
  foreach t in array array['settings','products','toppings','orders','payment_attempts','payments','order_events','webhook_log','demo_preferences','demo_payments','qr_scans'] loop
    execute format('drop policy if exists app_access on office.%I', t);
    execute format('create policy app_access on office.%I for all to fresia_office_app using (true) with check (true)', t);
    execute format('alter table office.%I force row level security', t);
  end loop;
end $$;

-- Tablas o secuencias futuras en office nacen sin permisos para nadie más.
alter default privileges in schema office revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema office revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema office revoke all on functions from public, anon, authenticated, service_role;
revoke all on all sequences in schema office from anon, authenticated, service_role;
revoke all on all functions in schema office from public, anon, authenticated, service_role;
revoke all on schema office from service_role;

-- Bitácora de migraciones aplicadas por `npm run db:migrate`.
create table if not exists office.schema_migrations (name text primary key, applied_at timestamptz not null default now());
alter table office.schema_migrations enable row level security;
revoke all on office.schema_migrations from anon, authenticated, service_role, fresia_office_app;
