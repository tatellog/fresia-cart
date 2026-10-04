-- Crecimiento: QR por edificio, factura, pedidos programados y pedidos de equipo. Idempotente.

-- QR por edificio: cada código atribuye escaneos y pedidos.
create table if not exists office.qr_sources (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  label text not null,
  created_at timestamptz not null default now()
);
alter table office.orders add column if not exists source text;

-- Factura (CFDI 4.0): datos fiscales que dio el cliente y estado de la factura.
alter table office.orders add column if not exists invoice jsonb;
alter table office.orders add column if not exists invoice_status text not null default 'no_aplica';
alter table office.orders drop constraint if exists orders_invoice_status_check;
alter table office.orders add constraint orders_invoice_status_check check (invoice_status in ('no_aplica', 'solicitada', 'emitida'));

-- Pedido programado: hora para la que lo quiere (null = lo antes posible).
alter table office.orders add column if not exists scheduled_for timestamptz;
create index if not exists orders_scheduled_idx on office.orders (scheduled_for) where scheduled_for is not null;

-- Pedido de equipo: un enlace compartido donde cada quien agrega lo suyo.
create table if not exists office.group_orders (
  id uuid primary key,
  code text not null unique,
  name text not null,
  organizer_name text not null,
  admin_token text not null,
  status text not null default 'abierto' check (status in ('abierto', 'pedido', 'cancelado')),
  closes_at timestamptz,
  order_id uuid references office.orders(id),
  created_at timestamptz not null default now()
);
create table if not exists office.group_items (
  id uuid primary key,
  group_id uuid not null references office.group_orders(id) on delete cascade,
  member_name text not null,
  member_key text not null,
  line jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists group_items_group_idx on office.group_items (group_id);

do $$
declare t text;
begin
  foreach t in array array['qr_sources','group_orders','group_items'] loop
    execute format('alter table office.%I enable row level security', t);
    execute format('alter table office.%I force row level security', t);
    execute format('revoke all on office.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on office.%I to fresia_office_app', t);
    execute format('drop policy if exists app_access on office.%I', t);
    execute format('create policy app_access on office.%I for all to fresia_office_app using (true) with check (true)', t);
  end loop;
end $$;

-- Nombre del pedido de equipo copiado al pedido (para mostrarlo sin otra consulta).
alter table office.orders add column if not exists group_name text;
