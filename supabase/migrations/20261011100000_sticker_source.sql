-- Stickers (/s?utm_source=sticker): cuenta escaneos y pedidos que vienen de ahí. Idempotente.
insert into office.qr_sources (slug, label) values ('sticker', 'Stickers') on conflict (slug) do nothing;
