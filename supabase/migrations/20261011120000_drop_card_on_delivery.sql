-- Sin tarjeta al recibir: la terminal se queda en el local; con tarjeta se paga en línea. Idempotente.
alter table office.orders drop column if exists pay_with_card;
