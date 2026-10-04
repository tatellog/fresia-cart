-- Foto de entrega (comprobante) de pedidos a domicilio. Idempotente.
create table if not exists office.delivery_photos (
  order_id uuid primary key references office.orders(id),
  image bytea not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now()
);
alter table office.delivery_photos enable row level security;
alter table office.delivery_photos force row level security;
revoke all on office.delivery_photos from anon, authenticated, service_role;
grant select, insert, update on office.delivery_photos to fresia_office_app;
drop policy if exists app_access on office.delivery_photos;
create policy app_access on office.delivery_photos for all to fresia_office_app using (true) with check (true);

alter table office.orders add column if not exists delivery_photo_at timestamptz;
