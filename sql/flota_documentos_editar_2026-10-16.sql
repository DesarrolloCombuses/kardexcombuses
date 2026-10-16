-- ============================================================================
-- Kardex / ERP Combuses -- Parque automotor: corregir documentos desde el ERP
--
-- QUE RESUELVE
-- Hasta hoy "Parque automotor" solo mira. Si un SOAT se renovo, si una fecha
-- quedo mal digitada, o si el documento se cargo en la placa equivocada, no
-- habia nada que hacer desde el ERP: tocaba ir al Portal de Documentos.
--
-- LEER ESTO ANTES DE CORRER
-- flota_documentos NO es una tabla del ERP. Es del "Portal de Documentos",
-- otro programa que vive en el mismo proyecto de Supabase y que es donde los
-- coordinadores de ruta suben los PDF. Este archivo le abre la puerta al ERP
-- para escribir ahi. Eso significa que un cambio hecho desde el ERP se ve de
-- inmediato en ese otro programa, y al reves. Es lo que se pidio; queda
-- dicho para que nadie se sorprenda despues.
--
-- Dos cosas NO se tocan a proposito:
--   - subido_por_conductor y revisado son del flujo del Portal (el conductor
--     sube, alguien revisa). El ERP no las escribe.
--   - El archivo anterior no se borra del bucket cuando se reemplaza. Un
--     documento vencido sigue siendo el soporte de su periodo.
--
-- SE DETIENE SOLO si encuentra algo distinto de lo que se verifico el
-- 2026-10-16, en vez de abrir permisos a ciegas sobre la tabla de otro
-- programa. Si eso pasa, hay que volver a mirar con el dueño del Portal.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Comprobaciones antes de tocar nada
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls boolean;
begin
  select c.relrowsecurity into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'flota_documentos';

  if v_rls is null then
    raise exception
      'No existe public.flota_documentos. Este archivo es para el Portal de Documentos; revisar antes de seguir.';
  end if;

  -- Sin RLS, los permisos los deciden solo los GRANT: dar insert/update a
  -- "authenticated" dejaria escribir a CUALQUIER cuenta con sesion, del ERP
  -- o del Portal, sin pasar por los permisos de Kardex. Eso no se hace sin
  -- hablarlo con quien mantiene el Portal.
  if not v_rls then
    raise exception
      'flota_documentos tiene la RLS apagada. Encenderla puede romper el Portal de Documentos, y dar los permisos sin ella dejaria escribir a cualquier cuenta. Hay que decidirlo con el dueño de ese programa: NO se aplico nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Quien puede corregir documentos de la flota
-- ---------------------------------------------------------------------------
-- Mirar el parque automotor y cambiarle la fecha de vencimiento a un SOAT no
-- son la misma responsabilidad: por eso esto pide 'agregar'/'editar' sobre
-- el modulo, no el 'ver' que ya tiene mas gente.
create or replace function kardex_flota_puede_editar()
returns boolean
language sql
stable
as $$
  select coalesce(kardex_is_authorized(), false)
      or coalesce(kardex_tiene_permiso('parque-automotor', 'agregar'), false)
      or coalesce(kardex_tiene_permiso('parque-automotor', 'editar'), false);
$$;

revoke all on function kardex_flota_puede_editar() from public, anon;
grant execute on function kardex_flota_puede_editar() to authenticated;

comment on function kardex_flota_puede_editar is
  'Puerta unica para que el ERP escriba en flota_documentos (tabla del Portal de Documentos).';

-- ---------------------------------------------------------------------------
-- 2. Policies para el ERP
-- ---------------------------------------------------------------------------
-- Van con nombre propio ("kardex_...") para que se distingan de las del
-- Portal y se puedan quitar sin tocar las de ese programa. Una policy mas
-- solo SUMA permiso a quien cumpla su condicion: las que ya existen siguen
-- funcionando igual.
drop policy if exists kardex_flota_documentos_ins on public.flota_documentos;
create policy kardex_flota_documentos_ins on public.flota_documentos
  for insert to authenticated
  with check (kardex_flota_puede_editar());

drop policy if exists kardex_flota_documentos_upd on public.flota_documentos;
create policy kardex_flota_documentos_upd on public.flota_documentos
  for update to authenticated
  using (kardex_flota_puede_editar())
  with check (kardex_flota_puede_editar());

-- Sin DELETE a proposito: el ERP no borra documentos de la flota. Un
-- documento que ya no sirve se reemplaza; borrarlo es perder el soporte de
-- su periodo, y ademas seria pisarle el flujo al Portal.

-- PostgREST necesita el GRANT ademas de la policy. Es seguro porque la RLS
-- esta activa (se comprobo arriba): el grant abre la puerta, la policy
-- decide quien pasa.
grant insert, update on public.flota_documentos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El archivo en el bucket
-- ---------------------------------------------------------------------------
-- El bucket 'flota-documentos' es privado y ya se lee desde el ERP (las URL
-- firmadas funcionan). Falta poder SUBIR el archivo nuevo.
drop policy if exists kardex_flota_documentos_storage_ins on storage.objects;
create policy kardex_flota_documentos_storage_ins on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flota-documentos' and kardex_flota_puede_editar());

-- ---------------------------------------------------------------------------
-- Para comprobar que quedo:
--
--   select policyname, cmd
--   from pg_policies
--   where tablename = 'flota_documentos' and policyname like 'kardex_%';
--
--   select kardex_flota_puede_editar();   -- true con una cuenta que pueda
-- ---------------------------------------------------------------------------
