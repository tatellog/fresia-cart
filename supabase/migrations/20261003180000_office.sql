-- Frésia Office: pedidos en línea.
-- Todo vive en el esquema "office", que NO está expuesto por la API REST de
-- Supabase: solo el servidor (conexión directa a Postgres) puede leerlo.
-- Es idempotente: el servidor también lo ejecuta al arrancar.

create schema if not exists office;
revoke all on schema office from public, anon, authenticated;

create table if not exists office.settings (key text primary key, value jsonb not null);
create table if not exists office.products (id text primary key, data jsonb not null);
create table if not exists office.toppings (id text primary key, data jsonb not null);

create sequence if not exists office.order_number_seq start 1001;

create table if not exists office.orders (
  id uuid primary key,
  number text not null unique,
  access_token text not null,
  idempotency_key uuid not null unique,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  customer_name text not null,
  customer_phone text not null,
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  address jsonb,
  notes text not null default '',
  items jsonb not null,
  subtotal integer not null check (subtotal >= 0),
  shipping_fee integer check (shipping_fee >= 0),
  total integer check (total >= 0),
  delivery_quote jsonb not null,
  payment_status text not null check (payment_status in ('sin_pagar', 'pendiente', 'aprobado', 'rechazado', 'cancelado', 'devuelto')),
  order_status text not null check (order_status in ('cotizando_envio', 'esperando_pago', 'recibido', 'confirmado', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'cancelado')),
  refund_status text not null default 'no_aplica' check (refund_status in ('no_aplica', 'pendiente', 'reembolsado')),
  needs_review text,
  demo boolean not null,
  paid_at timestamptz,
  last_reconcile_at timestamptz
);
create index if not exists orders_created_idx on office.orders (created_at desc);

create table if not exists office.payment_attempts (
  id uuid primary key,
  order_id uuid not null references office.orders(id),
  provider text not null,
  preference_id text not null,
  checkout_url text not null,
  amount integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists payment_attempts_order_idx on office.payment_attempts (order_id);

create table if not exists office.payments (
  provider text not null,
  provider_payment_id text not null,
  order_id uuid not null references office.orders(id),
  status text not null,
  status_detail text not null default '',
  amount integer not null,
  currency text not null,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_payment_id)
);
create index if not exists payments_order_idx on office.payments (order_id);

create table if not exists office.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references office.orders(id),
  at timestamptz not null default now(),
  type text not null,
  detail text not null default '',
  actor text not null
);
create index if not exists order_events_order_idx on office.order_events (order_id);

create table if not exists office.webhook_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  provider text not null,
  verified boolean not null,
  payload jsonb not null,
  result text not null
);

-- Solo modo demostración: simula el lado de Mercado Pago.
create table if not exists office.demo_preferences (
  id text primary key,
  external_reference uuid not null,
  amount integer not null,
  title text not null,
  return_url text not null,
  created_at timestamptz not null default now()
);
create table if not exists office.demo_payments (
  id text primary key,
  preference_id text not null,
  external_reference uuid not null,
  amount integer not null,
  status text not null,
  status_detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists office.qr_scans (
  day date not null,
  source text not null,
  count integer not null,
  primary key (day, source)
);

-- Defensa adicional: RLS activo y sin políticas → anon/authenticated no ven nada
-- aunque el esquema llegara a exponerse por error.
do $$
declare t text;
begin
  foreach t in array array['settings','products','toppings','orders','payment_attempts','payments','order_events','webhook_log','demo_preferences','demo_payments','qr_scans'] loop
    execute format('alter table office.%I enable row level security', t);
    execute format('revoke all on office.%I from anon, authenticated', t);
  end loop;
end $$;
