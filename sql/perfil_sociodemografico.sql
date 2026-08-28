-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Perfil sociodemografico: datos de cada empleado para el diagnostico que
-- exige el SG-SST (edad, genero, estado civil, escolaridad, vivienda,
-- desplazamiento, etc.), separados de "employees" porque no tienen nada
-- que ver con la logistica de dotacion -- asi la tabla operativa de
-- siempre se queda liviana y esta se puede restringir aparte el dia que
-- haga falta (hoy usa el mismo modelo de acceso que el resto de Kardex).
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql. Seguro de
-- re-ejecutar (create table / policy usan if not exists / drop+create).
-- ============================================================================

create table if not exists perfil_sociodemografico (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references employees(id) on delete cascade,

  tipo_identificacion text,
  fecha_nacimiento date,
  sexo text,
  estado_civil text,
  grado_escolaridad text,
  composicion_familiar text,
  personas_a_cargo integer,
  cabeza_familia boolean,
  estrato_socioeconomico text,
  lugar_residencia text,
  barrio text,
  tipo_vivienda text,
  medio_desplazamiento text,
  raza text,
  tipo_sangre text,
  turno_trabajo text,
  tipo_vinculacion text,
  fecha_ingreso date,
  conduce boolean,
  tipo_vehiculo_conduce text,
  anios_experiencia_conduccion integer,
  observaciones text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_perfil_socio_employee on perfil_sociodemografico(employee_id);

alter table perfil_sociodemografico enable row level security;

drop policy if exists "authenticated_all" on perfil_sociodemografico;
create policy "authenticated_all" on perfil_sociodemografico
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
