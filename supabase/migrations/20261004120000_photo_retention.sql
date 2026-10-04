-- Las fotos de entrega se borran a los 30 días (plan gratis: 500 MB). Idempotente.
grant delete on office.delivery_photos to fresia_office_app;
create index if not exists delivery_photos_created_idx on office.delivery_photos (created_at);
