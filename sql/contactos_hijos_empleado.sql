-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Contactos de emergencia e hijos de cada empleado. Van en tablas aparte
-- (no como columnas de employees ni de perfil_sociodemografico) porque un
-- mismo empleado puede tener varios de cada uno -- relacion uno a muchos.
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql. Seguro de
-- re-ejecutar (create table / policy usan if not exists / drop+create).
-- ============================================================================

create table if not exists contactos_emergencia (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  nombre text not null,
  parentesco text,
  telefono text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contactos_emergencia_employee on contactos_emergencia(employee_id);

alter table contactos_emergencia enable row level security;
drop policy if exists "authenticated_all" on contactos_emergencia;
create policy "authenticated_all" on contactos_emergencia
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists hijos_empleado (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  nombre text not null,
  fecha_nacimiento date,
  sexo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hijos_empleado_employee on hijos_empleado(employee_id);

alter table hijos_empleado enable row level security;
drop policy if exists "authenticated_all" on hijos_empleado;
create policy "authenticated_all" on hijos_empleado
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
