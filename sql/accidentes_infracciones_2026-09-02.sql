-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Tablas para comparendos (infracciones de transito) y accidentes de los
-- conductores, cargados desde un Excel que sube el usuario a mano cada
-- cierto tiempo (hoja INFRACCIONES y hoja ACCIDENTES). Se cruzan por cedula
-- en el Paz y Salvo, junto a los siniestros del Google Sheet externo.
-- Estructura identica a la que queda reflejada en sql/schema.sql. Seguro de
-- re-ejecutar. La carga de datos reales va en un archivo aparte
-- (sql/accidentes_infracciones_import_*.sql) que nunca se sube a git.
-- ============================================================================

create table if not exists infracciones_transito (
  comparendo_nro text primary key,
  fecha_comparendo timestamptz,
  placa text,
  columna_sin_nombre text,
  codigo_infraccion text,
  infraccion text,
  tipo_comparendo text,
  cedula text,
  nombre_infractor text,
  id_empresa text,
  created_at timestamptz not null default now()
);

create table if not exists accidentes_transito (
  nro_croquis text primary key,
  comparendo_nro text,
  direccion text,
  placa text,
  clase_accidente text,
  gravedad_accidente text,
  cedula text,
  nombre_infractor text,
  fecha_accidente timestamptz,
  id_empresa text,
  columna_sin_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists idx_infracciones_transito_cedula on infracciones_transito(cedula);
create index if not exists idx_accidentes_transito_cedula on accidentes_transito(cedula);

alter table infracciones_transito enable row level security;
alter table accidentes_transito enable row level security;

drop policy if exists "authenticated_all" on infracciones_transito;
create policy "authenticated_all" on infracciones_transito
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all" on accidentes_transito;
create policy "authenticated_all" on accidentes_transito
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
