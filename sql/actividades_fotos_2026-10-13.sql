-- ============================================================================
-- Kardex / ERP Combuses -- Fotos de la actividad (galeria)
--
-- Complemento de sql/actividades_2026-09-22.sql.
--
-- Hasta ahora una actividad solo podia tener la foto de CADA PERSONA que
-- recibio algo (kardex_actividad_registros.foto_url): es evidencia de entrega,
-- va con su firma y no se puede borrar sin perder el soporte.
--
-- Esto es otra cosa: las fotos DEL EVENTO -- el almuerzo de cumpleanos, la
-- capacitacion, el amigo secreto --, que son varias por actividad, no tienen
-- a nadie en particular como receptor y existen para mostrarse juntas. Por eso
-- van en su propia tabla y en su propio bucket, y no mezcladas con la
-- evidencia de entrega: borrar una foto del collage no puede tocar el soporte
-- de que alguien recibio su entrada.
--
-- Seguro de re-ejecutar.
-- ============================================================================

create table if not exists public.kardex_actividad_fotos (
  id             uuid primary key default gen_random_uuid(),
  actividad_id   uuid not null references public.kardex_actividades (id) on delete cascade,
  -- Ruta dentro del bucket. La carpeta es el id de la actividad, que ya
  -- existe cuando se suben las fotos (la actividad se crea primero).
  storage_path   text not null,
  -- Pie de foto opcional: "entrega del detalle en el patio", "equipo de
  -- mantenimiento". Sirve para que el collage se entienda sin preguntar.
  descripcion    text,
  orden          integer not null default 0,
  subido_por_email  text not null,
  subido_por_nombre text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_actividad_fotos_actividad
  on public.kardex_actividad_fotos (actividad_id, orden, created_at);

alter table public.kardex_actividad_fotos enable row level security;

-- Mismas puertas que la actividad a la que pertenecen: quien puede ver la
-- actividad ve sus fotos, y quien puede agregarle registros puede subirlas.
drop policy if exists "permiso_ver_actividad_fotos" on public.kardex_actividad_fotos;
create policy "permiso_ver_actividad_fotos" on public.kardex_actividad_fotos for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana()
    or kardex_tiene_permiso('actividades', 'ver') or kardex_tiene_permiso('actividades', 'agregar')
  ));

drop policy if exists "permiso_agregar_actividad_fotos" on public.kardex_actividad_fotos;
create policy "permiso_agregar_actividad_fotos" on public.kardex_actividad_fotos for insert
  with check (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar')
  ));

drop policy if exists "permiso_editar_actividad_fotos" on public.kardex_actividad_fotos;
create policy "permiso_editar_actividad_fotos" on public.kardex_actividad_fotos for update
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'editar')
  ))
  with check (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'editar')
  ));

-- Borrar una foto del collage es una correccion normal (salio movida,
-- repetida, o no era de esta actividad), no la perdida de un soporte legal:
-- por eso aca si hay delete, a diferencia de los registros de entrega.
drop policy if exists "permiso_borrar_actividad_fotos" on public.kardex_actividad_fotos;
create policy "permiso_borrar_actividad_fotos" on public.kardex_actividad_fotos for delete
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'borrar')
  ));

-- ---------------------------------------------------------------------------
-- El bucket
-- ---------------------------------------------------------------------------
-- Privado, como todos los del ERP: las fotos se sirven con URL firmada que
-- expira. Una foto de una actividad muestra caras de empleados, y un bucket
-- publico seria una URL adivinable sin sesion.
insert into storage.buckets (id, name, public)
values ('actividades-fotos', 'actividades-fotos', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_actividades_fotos" on storage.objects;
create policy "authenticated_rw_actividades_fotos" on storage.objects
  for all
  to authenticated
  using (bucket_id = 'actividades-fotos')
  with check (bucket_id = 'actividades-fotos');

-- ---------------------------------------------------------------------------
-- Para comprobar:
--   select count(*) from kardex_actividad_fotos;                  -- 0
--   select id, public from storage.buckets where id = 'actividades-fotos';
-- ---------------------------------------------------------------------------
