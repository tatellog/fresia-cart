-- Recorrido del repartidor (últimos puntos) para dibujar la ruta en el mapa del cliente. Idempotente.
alter table office.order_tracking add column if not exists trail jsonb not null default '[]'::jsonb;
