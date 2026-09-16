-- Firma electrónica guardada por empleado (Gerente General, Coordinador
-- Administrativo, Coordinador de Gestión Humana, o cualquier otro), para
-- estampar automáticamente en documentos generados desde el programa
-- (certificado laboral, por ahora) en vez de dejar una línea en blanco para
-- firmar a mano. Reutiliza el bucket "firmas" que ya existe (hoy usado para
-- la firma de quien recibe dotación en Salida), bajo su propio prefijo de
-- ruta ("certificados/") para no mezclarse con esas firmas.
--
-- Quién puede guardarla: mismo criterio que ya edita la ficha del empleado
-- (admin/viewer, GESTION HUMANA, o permiso granular "empleados"/editar-
-- agregar) -- guardar una firma es, en la práctica, otro dato más de la
-- ficha. No se toca ninguna policy existente de storage.objects (ni
-- authenticated_rw_firmas ni permiso_rw_firmas, ambas de sql/schema.sql y
-- sql/permisos_granulares_2026-09-16.sql), solo se agrega una nueva
-- (Postgres combina varias policies permisivas del mismo comando con OR).
--
-- Repetible sin riesgo (add column if not exists / create policy con drop
-- previo).

alter table employees add column if not exists firma_url text;

drop policy if exists "permiso_rw_firmas_certificado" on storage.objects;
create policy "permiso_rw_firmas_certificado" on storage.objects for all
  using (
    bucket_id = 'firmas' and name like 'certificados/%' and auth.role() = 'authenticated' and (
      kardex_is_authorized() or kardex_es_gestion_humana()
      or kardex_tiene_permiso('empleados', 'editar') or kardex_tiene_permiso('empleados', 'agregar')
    )
  )
  with check (
    bucket_id = 'firmas' and name like 'certificados/%' and auth.role() = 'authenticated' and (
      kardex_is_authorized() or kardex_es_gestion_humana()
      or kardex_tiene_permiso('empleados', 'editar') or kardex_tiene_permiso('empleados', 'agregar')
    )
  );
