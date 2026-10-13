-- ============================================================================
-- Kardex / ERP Combuses -- Estadistica de procesos disciplinarios
--
-- Complemento de procesos_disciplinarios_2026-10-01.sql,
-- procesos_disciplinarios_hoja_2026-10-01.sql y
-- procesos_disciplinarios_marcha_blanca_2026-10-01.sql. Correr DESPUES.
--
-- POR QUE NO SE LEE LA TABLA DIRECTO
-- El modulo de procesos disciplinarios esta en marcha blanca: hoy solo
-- desarrollotecnologico@combuses.com.co ve un expediente. Si el tablero
-- consultara kardex_procesos_disciplinarios con la sesion de Gestion Humana
-- o de SST, la RLS le devolveria cero filas y el tablero mostraria
-- "0 procesos" -- que cualquiera lee como "no hubo ninguno", no como "no
-- puedes ver esto". Un tablero de indicadores que confunde esas dos cosas no
-- sirve: es peor que no tenerlo, porque se ve igual de convincente.
--
-- Por eso el conteo pasa por una funcion SECURITY DEFINER que, antes de
-- bypassar la RLS, exige su propio permiso.
--
-- QUE DEVUELVE
-- Conteos y nada mas: ni un nombre, ni una cedula, ni una linea de un acta
-- de descargos. Eso es lo que permite que Gestion Humana y SST vean la
-- estadistica SIN abrir la marcha blanca del modulo -- los expedientes
-- siguen cerrados.
--
-- Se desglosa por mes, decision, falta, area, ruta, estado, asistencia a
-- descargos y reincidencia. NO por cargo ni por interno: hay cargos con una
-- sola persona, y un conteo de uno deja de ser una estadistica para ser un
-- senalamiento.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Los dos modulos nuevos en la matriz de permisos
-- ---------------------------------------------------------------------------
-- Son dos entradas de menu sobre el MISMO tablero, con distinto periodo de
-- arranque. Se dejan como dos permisos y no uno para poder dar el periodo
-- del informe sin dar el historico completo.
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
    'mantenimiento',
    'informe-gestion',
    'procesos-disciplinarios-gh',
    'procesos-disciplinarios-historico'
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
    'mantenimiento',
    'informe-gestion',
    'procesos-disciplinarios-gh',
    'procesos-disciplinarios-historico'
  ));

-- ---------------------------------------------------------------------------
-- 2. Quien puede ver la estadistica
-- ---------------------------------------------------------------------------
-- A proposito NO pregunta por kardex_pd_autorizado(): ver los totales no
-- depende de poder abrir un expediente. Si dependiera, la marcha blanca
-- dejaria el tablero en cero para todo el mundo y volveriamos al problema de
-- arriba.
--
-- kardex_es_gestion_humana() ya incluye a las cuentas autorizadas del ERP
-- (kardex_is_authorized()), misma convencion que usa kardex_ig_puede_ver().
create or replace function kardex_pd_estadistica_puede_ver()
returns boolean
language sql
stable
as $$
  select kardex_es_gestion_humana()
      or kardex_tiene_permiso('procesos-disciplinarios-gh', 'ver')
      or kardex_tiene_permiso('procesos-disciplinarios-historico', 'ver');
$$;

revoke all on function kardex_pd_estadistica_puede_ver() from public, anon;
grant execute on function kardex_pd_estadistica_puede_ver() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El conteo
-- ---------------------------------------------------------------------------
-- Devuelve filas (dimension, etiqueta, total) en vez de una columna por
-- indicador: asi se agrega un desglose nuevo sin cambiar la firma de la
-- funcion ni el codigo que la llama.
--
-- LA FECHA DEL PROCESO es la de citacion -- el dia en que arranco. Si falta
-- (procesos viejos de la hoja que no la traian) se cae a la fecha de
-- registro y, en ultimo caso, a cuando entro al ERP. Sin ese coalesce, los
-- procesos sin citacion desapareceran de todos los meses y el total de la
-- grafica no cuadraria con el KPI de arriba.
create or replace function kardex_pd_estadistica(p_desde date default null, p_hasta date default null)
returns table (dimension text, etiqueta text, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not kardex_pd_estadistica_puede_ver() then
    raise exception 'Tu cuenta no tiene permiso para consultar la estadistica de procesos disciplinarios'
      using errcode = '42501';
  end if;

  return query
  with base as (
    select p.*,
           coalesce(p.fecha_citacion, p.fecha_registro, p.created_at::date) as fecha_base
    from kardex_procesos_disciplinarios p
  ),
  filtrado as (
    select * from base
    where (p_desde is null or fecha_base >= p_desde)
      and (p_hasta is null or fecha_base <= p_hasta)
  ),
  por_persona as (
    select empleado_cedula, count(*) as n from filtrado group by 1
  )
  select 'resumen'::text, 'procesos'::text, count(*)::bigint from filtrado
  union all
  select 'resumen', 'personas', count(*)::bigint from por_persona
  union all
  select 'resumen', 'reincidentes', count(*)::bigint from por_persona where n >= 2
  union all
  select 'resumen', 'abiertos', count(*)::bigint from filtrado
   where estado not in ('finalizado', 'cancelado')
  union all
  select 'resumen', 'suspensiones', count(*)::bigint from filtrado where tipo_decision = 'suspension'
  union all
  select 'resumen', 'terminaciones', count(*)::bigint from filtrado where tipo_decision = 'terminacion'
  union all
  -- dias_suspension es texto libre ("3", "3 dias", "tres"). Se le sacan los
  -- digitos; lo que venga escrito en letras suma 0. Es una aproximacion y
  -- asi se dice en el tablero, no se presenta como cifra exacta.
  --
  -- El tope de 3 digitos no es un detalle: en un campo libre alguien puede
  -- escribir una fecha, y "2026-10-13" sin este filtro se convierte en
  -- 20.261.013 dias de suspension. Un numero asi no se ve como un error, se
  -- ve como un dato -- y es el tipo de cifra que termina en un informe.
  select 'resumen', 'dias_suspension',
         coalesce(sum(
           case when regexp_replace(coalesce(dias_suspension, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,3}$'
             then regexp_replace(coalesce(dias_suspension, ''), '[^0-9]', '', 'g')::bigint
             else 0 end
         ), 0)::bigint
    from filtrado
  union all
  select 'mes', to_char(fecha_base, 'YYYY-MM'), count(*)::bigint
    from filtrado where fecha_base is not null group by 2
  union all
  select 'decision', coalesce(nullif(btrim(tipo_decision), ''), 'sin_decision'), count(*)::bigint
    from filtrado group by 2
  union all
  select 'estado', estado, count(*)::bigint from filtrado group by 2
  union all
  select 'falta', coalesce(nullif(btrim(falta), ''), 'Sin clasificar'), count(*)::bigint
    from filtrado group by 2
  union all
  select 'area', coalesce(nullif(btrim(empleado_area), ''), 'Sin dato'), count(*)::bigint
    from filtrado group by 2
  union all
  select 'ruta', coalesce(nullif(btrim(empleado_ruta), ''), 'Sin dato'), count(*)::bigint
    from filtrado group by 2
  union all
  select 'asistencia', coalesce(nullif(btrim(asistencia), ''), 'sin_dato'), count(*)::bigint
    from filtrado group by 2
  union all
  select 'reincidencia',
         case when n = 1 then '1 proceso'
              when n = 2 then '2 procesos'
              when n = 3 then '3 procesos'
              else '4 o mas' end,
         count(*)::bigint
    from por_persona group by 2;
end;
$$;

revoke all on function kardex_pd_estadistica(date, date) from public, anon;
grant execute on function kardex_pd_estadistica(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Para comprobar:
--   select * from kardex_pd_estadistica(null, null) where dimension = 'resumen';
--   select * from kardex_pd_estadistica('2026-08-01', '2026-10-31') where dimension = 'mes';
-- ---------------------------------------------------------------------------
