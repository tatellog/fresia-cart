-- Método de pago: en línea (Mercado Pago) o al recibir. Idempotente.
alter table office.orders add column if not exists payment_method text not null default 'online';
alter table office.orders drop constraint if exists orders_payment_method_check;
alter table office.orders add constraint orders_payment_method_check check (payment_method in ('online', 'contra_entrega'));

alter table office.orders drop constraint if exists orders_payment_status_check;
alter table office.orders add constraint orders_payment_status_check
  check (payment_status in ('sin_pagar', 'por_cobrar', 'pendiente', 'aprobado', 'rechazado', 'cancelado', 'devuelto'));
