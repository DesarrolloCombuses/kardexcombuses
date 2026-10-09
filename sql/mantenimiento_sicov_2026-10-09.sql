-- ============================================================================
-- Kardex / ERP Combuses -- Modulo Mantenimiento (alistamientos SICOV)
--
-- Las tablas sicov_* ya existen en este mismo Supabase: las creo la
-- "Plataforma SICOV" (repo gesmovil sicov), que captura los alistamientos
-- diarios del conductor y los mantenimientos del taller, y se los entrega por
-- API a GESMOVIL para la Supertransporte.
--
-- Este archivo NO toca ese modelo. No crea, altera ni borra ninguna tabla
-- suya: solo agrega permiso de LECTURA para que el ERP pueda consultarlos.
--
-- POR QUE HACE FALTA
-- Esas tablas tienen RLS activo y ninguna policy de lectura, asi que hoy solo
-- las ven las edge functions con la service_role key. El comentario de su
-- migracion explica por que no hay policies de ESCRITURA: "un registro de
-- alistamiento es una afirmacion ante el regulador, y solo debe nacer por el
-- camino que valida placa, cedula y actividades". Ese motivo sigue intacto
-- aca -- lo que se abre es solo select. Consultar no afirma nada.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El modulo en la matriz de permisos
-- ---------------------------------------------------------------------------
-- Misma revision previa de siempre: si la base tuviera un modulo que esta
-- lista no trae, el add constraint falla con un mensaje que no dice cual.
do $$
declare
  v_faltantes text;
begin
  select string_agg(distinct modulo, ', ')
    into v_faltantes
  from kardex_permisos_usuario
  where modulo not in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos',
    'lineas-celulares',
    'informes-disciplinarios',
    'procesos-disciplinarios',
    'mantenimiento'
  );

  if v_faltantes is not null then
    raise exception 'Hay permisos guardados de modulos que no estan en la lista nueva: %. Agregalos al check antes de correr esto.', v_faltantes;
  end if;
end $$;

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos',
    'lineas-celulares',
    'informes-disciplinarios',
    'procesos-disciplinarios',
    'mantenimiento'
  ));

-- ---------------------------------------------------------------------------
-- Quien puede consultar
-- ---------------------------------------------------------------------------
-- Una sola funcion, para que las cuatro policies digan lo mismo y se cambie
-- en un solo sitio. Admin/viewer del ERP entran (es informacion de flota, no
-- datos personales sensibles), y cualquier otra cuenta necesita el permiso
-- del modulo.
create or replace function kardex_mtto_puede_ver()
returns boolean
language sql
stable
as $$
  select coalesce(kardex_is_authorized(), false)
      or coalesce(kardex_tiene_permiso('mantenimiento', 'ver'), false);
$$;

revoke all on function kardex_mtto_puede_ver() from public, anon;
grant execute on function kardex_mtto_puede_ver() to authenticated;

-- ---------------------------------------------------------------------------
-- Lectura de los alistamientos y mantenimientos
-- ---------------------------------------------------------------------------
-- Solo select. No se agrega insert, update ni delete: eso sigue pasando por
-- las edge functions de la plataforma SICOV, que es donde se valida.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sicov_alistamientos', 'sicov_alistamiento_actividades',
    'sicov_mantenimientos', 'sicov_mantenimiento_actividades'
  ] loop
    execute format('drop policy if exists %I on %I', 'kardex_mtto_' || t || '_sel', t);
    execute format($f$
      create policy %I on %I for select to authenticated
      using (kardex_mtto_puede_ver())
    $f$, 'kardex_mtto_' || t || '_sel', t);
  end loop;
end $$;

-- El catalogo de actividades ya tiene su propia policy de lectura para
-- cualquier cuenta autenticada (sicov_cat_actividades_lectura, limitada a las
-- activas). No se toca: la vista necesita leerlo para poner el nombre de cada
-- actividad, y esa policy ya se lo permite.

-- ---------------------------------------------------------------------------
-- Para comprobar como quedo (desde una cuenta con sesion):
--   select kardex_mtto_puede_ver();
--   select count(*) from sicov_alistamientos;
--   select fecha, count(*) from sicov_alistamientos group by 1 order by 1 desc limit 10;
-- ---------------------------------------------------------------------------
