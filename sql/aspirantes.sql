-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Proceso de seleccion: aspirantes registrados con su hoja de vida y el
-- cargo al que aspiran, con un estado simple (En proceso / Contratado /
-- Descartado). Cuando un aspirante queda "Contratado", la app ofrece
-- convertirlo en empleado (crea la fila en "employees" y guarda el vinculo
-- en employee_id, para no volver a digitar nombre/cedula/cargo).
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql. Seguro de
-- re-ejecutar (create table/policy usan if not exists / drop+create).
-- ============================================================================

create table if not exists aspirantes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cedula text,
  telefono text,
  cargo_aspirado text,
  area_aspirada text,
  hoja_vida_url text,
  hoja_vida_nombre text,
  estado text not null default 'En proceso' check (estado in ('En proceso', 'Contratado', 'Descartado')),
  observaciones text,
  employee_id uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_aspirantes_estado on aspirantes(estado);

alter table aspirantes enable row level security;

drop policy if exists "authenticated_all" on aspirantes;
create policy "authenticated_all" on aspirantes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Storage: bucket privado para las hojas de vida (PDF o imagen)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('hojas-vida', 'hojas-vida', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_hojas_vida" on storage.objects;
create policy "authenticated_rw_hojas_vida" on storage.objects
  for all
  using (bucket_id = 'hojas-vida' and auth.role() = 'authenticated')
  with check (bucket_id = 'hojas-vida' and auth.role() = 'authenticated');
