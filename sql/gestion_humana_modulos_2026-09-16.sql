-- Amplía lo que puede ver/editar/agregar una cuenta con grupo GESTION HUMANA
-- (ver sql/usuarios_grupos_2026-09-16.sql): de "solo aprobar permisos" a
-- todo el dominio de Personal (Empleados, Selección de personal,
-- Cumpleaños, Alertas, Conductores por ruta, Perfil sociodemográfico),
-- igual que ya puede kardex@/vinculaciones@ para esas mismas tablas.
--
-- Tablas elegidas rastreando qué toca cada vista de "Personal" en js/db.js:
-- employees, aspirantes, contactos_emergencia, hijos_empleado,
-- perfil_sociodemografico, perfil_publico_auditoria (ficha/certificados),
-- infracciones_transito/accidentes_transito (cruce de Paz y Salvo dentro de
-- Empleados) y las 2 storage buckets fotos-empleados/hojas-vida. Además
-- kardex_movements en SOLO LECTURA (para "quién ya recibió dotación" en
-- Alertas y el historial dentro de la ficha del empleado) -- no se toca su
-- policy de insert (GESTION HUMANA no registra entregas de dotación).
--
-- A propósito NO se toca: vehiculo_bases (datos de flota, usados solo por
-- el botón de vincular conductor a Sonar dentro de Empleados -- sistema
-- ajeno), facturas ni kardex_movement_items (se embeben en algunas
-- consultas de Empleados, pero PostgREST simplemente los deja vacíos si no
-- hay permiso, no rompe la consulta -- no hace falta abrir facturación ni
-- el detalle de items a Gestión Humana para esto). Inventario, Entrada,
-- Salida, Historial, Facturas y Siniestros de tránsito siguen siendo
-- exclusivos de admin/viewer.
--
-- Repetible sin riesgo (create or replace / alter policy).

create or replace function kardex_es_gestion_humana()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA';
$$;

revoke all on function kardex_es_gestion_humana() from public;
grant execute on function kardex_es_gestion_humana() to authenticated;

-- kardex_puede_aprobar_permisos() pasa a ser un alias de la función de
-- arriba -- misma condición, nombre distinto para que las policies de
-- permisos_solicitudes sigan leyéndose claro.
create or replace function kardex_puede_aprobar_permisos()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select kardex_es_gestion_humana();
$$;

alter policy authenticated_all on employees
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on aspirantes
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on contactos_emergencia
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on hijos_empleado
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on perfil_sociodemografico
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on infracciones_transito
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_all on accidentes_transito
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_select_auditoria_perfil_publico on perfil_publico_auditoria
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_select on kardex_movements
  using (auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_rw_fotos_empleados on storage.objects
  using (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and kardex_es_gestion_humana());

alter policy authenticated_rw_hojas_vida on storage.objects
  using (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and kardex_es_gestion_humana())
  with check (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and kardex_es_gestion_humana());
