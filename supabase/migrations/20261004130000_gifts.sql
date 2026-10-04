-- Fresigrama: pedidos de regalo con tarjeta (para quién, mensaje, anónimo). Idempotente.
alter table office.orders add column if not exists gift jsonb;
-- QR de la tarjeta impresa («¿Quieres mandar uno?»): cuenta escaneos y pedidos que vienen de ahí.
insert into office.qr_sources (slug, label) values ('fresigrama', 'Tarjetas Fresigrama') on conflict (slug) do nothing;
