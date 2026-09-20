-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Copia en Supabase de la base de siniestros de transito (Google Sheet
-- externo, mantenido por SST). Antes js/siniestros.js hacia fetch() directo
-- al CSV publicado del sheet cada vez que alguien lo necesitaba -- ese
-- endpoint de Google falla seguido (error 500 intermitente), y cuando
-- fallaba, quien generaba un Paz y Salvo se quedaba sin poder verificar
-- siniestros. Ahora una Edge Function (supabase/functions/sync-siniestros)
-- sincroniza el sheet hacia esta tabla -- por cron cada hora y con un boton
-- "Actualizar ahora" en el modulo Siniestros -- y el cliente lee de aqui,
-- que es Supabase normal (rapido, confiable, protegido por RLS como
-- cualquier otra tabla).
--
-- "datos" guarda la fila completa del sheet (encabezado -> valor) en vez de
-- una columna por campo: el equipo de SST agrega/quita columnas del sheet
-- sin avisar, y el cliente ya decide cuales mostrar/ocultar
-- (_esColumnaOculta en js/siniestros.js) -- guardar la fila cruda evita
-- tener que migrar esta tabla cada vez que cambia el sheet.
--
-- Cada sincronizacion exitosa reemplaza TODO el contenido (borra e inserta
-- de nuevo) en vez de hacer upsert por clave -- asi la copia siempre queda
-- identica al sheet actual, incluyendo filas borradas alla. Si el fetch al
-- sheet falla, la Edge Function no toca esta tabla -- la ultima copia buena
-- se queda tal cual, en vez de dejar el modulo sin datos.
-- ============================================================================

create table if not exists siniestros_transito (
  id bigint generated always as identity primary key,
  sheet_key text,
  cedula text not null,
  datos jsonb not null,
  synced_at timestamptz not null default now()
);
create index if not exists idx_siniestros_transito_cedula on siniestros_transito(cedula);
create index if not exists idx_siniestros_transito_synced_at on siniestros_transito(synced_at);

alter table siniestros_transito enable row level security;

-- Mismo criterio de acceso que infracciones_transito/accidentes_transito
-- (sql/accidentes_infracciones_2026-09-02.sql): quien puede ver Empleados o
-- el modulo Siniestros. Sin policy de insert/update/delete para
-- `authenticated` a proposito -- solo la Edge Function (service_role, que
-- no pasa por RLS) escribe acá.
drop policy if exists "permiso_ver_siniestros_transito" on siniestros_transito;
create policy "permiso_ver_siniestros_transito" on siniestros_transito
  for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized()
    or kardex_tiene_permiso('empleados', 'ver')
    or kardex_tiene_permiso('siniestros-transito', 'ver')
  ));
