-- Frésia Club (FO-010): ¿este pedido tiene sello? Evita sumarlo dos veces y permite retirarlo si se cancela o reembolsa.
alter table office.orders add column if not exists club_stamped boolean not null default false;
