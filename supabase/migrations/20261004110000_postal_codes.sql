-- Códigos postales (catálogo de SEPOMEX) para validar la dirección y autollenar colonia y alcaldía.
-- El catálogo no se versiona (su licencia no permite redistribuirlo): se carga con npm run db:cp.
create table if not exists office.postal_codes (
  cp text not null check (cp ~ '^\d{5}$'),
  colonia text not null,
  tipo text not null,
  alcaldia text not null,
  estado text not null,
  primary key (cp, colonia)
);

alter table office.postal_codes enable row level security;
alter table office.postal_codes force row level security;
revoke all on office.postal_codes from anon, authenticated, service_role;
grant select, insert, delete on office.postal_codes to fresia_office_app;
drop policy if exists app_access on office.postal_codes;
create policy app_access on office.postal_codes for all to fresia_office_app using (true) with check (true);
