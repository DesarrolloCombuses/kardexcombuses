-- ============================================================================
-- Kardex / ERP Combuses -- Procesos disciplinarios: traer la tabla vieja por lotes
--
-- Complemento de procesos_disciplinarios_2026-10-01.sql y
-- procesos_disciplinarios_hoja_2026-10-01.sql. Correr DESPUES de los dos.
--
-- POR QUE
-- kardex_pd_importar() hacia las 303 filas de un solo golpe y se pasaba del
-- statement_timeout de PostgREST: "canceling statement due to statement
-- timeout". La importacion de la hoja no se cae porque la app la manda de a
-- 40 filas; esta no tenia esa division. Ahora recibe un rango y la app la
-- llama en vueltas, igual que la otra.
--
-- Y YA QUE ESTAMOS, UN CAMBIO DE CRITERIO
-- Cuando se escribio, la tabla vieja era la unica fuente. Hoy la fuente buena
-- es la hoja (417 procesos contra 303), y esta tabla sirve para UNA cosa que
-- la hoja no tiene: los campos de la decision -- tipo, antecedentes,
-- consideraciones, compromisos, recurso, fecha de reintegro -- que solo
-- existen en los procesos creados dentro del programa anterior.
--
-- Por eso ahora solo RELLENA: lo que ya tiene valor en el ERP no se toca,
-- venga de la hoja o de alguien que lo edito a mano. Antes pisaba el nombre,
-- el cargo, el area, el motivo y las fechas de citacion.
--
-- Seguro de re-ejecutar y de repetir la importacion.
-- ============================================================================

-- La firma cambia (antes no recibia nada), asi que hay que soltar la vieja:
-- un create or replace con parametros nuevos crearia una sobrecarga y la app
-- no sabria cual le responde.
drop function if exists kardex_pd_importar();
drop function if exists kardex_pd_importar(integer, integer);

create or replace function kardex_pd_importar(
  p_desde integer default 0,
  p_limite integer default 60
)
returns table (
  copiados integer,
  procesados integer,
  total integer,
  con_empleado integer,
  sin_empleado integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_copiados integer := 0;
  v_procesados integer := 0;
  v_total integer := 0;
begin
  if not coalesce(kardex_es_gestion_humana()
                  or kardex_tiene_permiso('procesos-disciplinarios', 'agregar'), false) then
    raise exception 'No autorizado para importar procesos disciplinarios.';
  end if;

  select count(*)::integer into v_total
  from procesos_disciplinarios pv
  where pv.key is not null;

  -- El orden por key es el que hace que los lotes no se pisen ni se salten
  -- filas entre una vuelta y la siguiente.
  with viejo as (
    select
      pv.key as origen_key,
      pv.datos as d,
      to_jsonb(pv) as fila
    from procesos_disciplinarios pv
    where pv.key is not null
    order by pv.key
    offset greatest(p_desde, 0)
    limit greatest(p_limite, 1)
  ),
  campos as (
    select
      origen_key,
      coalesce(nullif(d ->> 'cc', ''), fila ->> 'cc') as cedula,
      coalesce(nullif(d ->> 'nombre', ''), fila ->> 'nombre') as nombre,
      coalesce(nullif(d ->> 'cargo', ''), fila ->> 'cargo') as cargo,
      coalesce(nullif(d ->> 'area', ''), fila ->> 'area') as area,
      coalesce(nullif(d ->> 'interno', ''), fila ->> 'interno') as interno,
      coalesce(nullif(d ->> 'ruta', ''), fila ->> 'ruta') as ruta,
      coalesce(nullif(d ->> 'propietario', ''), fila ->> 'propietario') as propietario,
      coalesce(nullif(d ->> 'fechaIngreso', ''), fila ->> 'fecha_ingreso') as fecha_ingreso,
      coalesce(nullif(d ->> 'celularCitado', ''), nullif(d ->> 'celular', ''),
               nullif(d ->> 'celularAfiliado', ''), fila ->> 'celular') as celular,
      coalesce(nullif(d ->> 'correoCitado', ''), nullif(d ->> 'correoNotificacion', ''),
               nullif(d ->> 'correoAfiliado', ''), fila ->> 'correo_notificacion') as correo,
      coalesce(nullif(d ->> 'motivo', ''), fila ->> 'motivo') as motivo,
      coalesce(nullif(d ->> 'reglamento', ''), fila ->> 'reglamento_interno_trabajo') as normas,
      coalesce(nullif(d ->> 'pruebas', ''), fila ->> 'pruebas') as pruebas_texto,
      coalesce(nullif(d ->> 'falta', ''), fila ->> 'falta') as falta,
      d ->> 'primeraVez' as sancion_primera,
      d ->> 'segundaVez' as sancion_segunda,
      d ->> 'terceraVez' as sancion_tercera,
      d ->> 'cuartaVez' as sancion_cuarta,
      coalesce(nullif(d ->> 'fechaHechos', ''), nullif(d ->> 'fechaDiligenciamiento', ''),
               fila ->> 'fecha_diligenciamiento_descargos') as fecha_hechos,
      coalesce(nullif(d ->> 'fechaCitacion', ''), fila ->> 'fecha_citacion') as fecha_citacion,
      coalesce(nullif(d ->> 'horaCitacion', ''), fila ->> 'hora_citacion') as hora_citacion,
      lower(btrim(coalesce(nullif(d ->> 'asistencia', ''), fila ->> 'asistencia', ''))) as asistencia,
      coalesce(nullif(d ->> 'fechaActaDescargos', ''), fila ->> 'fecha_acta_descargos') as fecha_descargos,
      coalesce(nullif(d ->> 'horaActaDescargos', ''), fila ->> 'hora_acta_descargos') as hora_desc_ini,
      coalesce(nullif(d ->> 'horaDiligenciamiento', ''), fila ->> 'hora_diligenciamiento_descargos') as hora_desc_fin,
      coalesce(nullif(d ->> 'acta', ''), nullif(d ->> 'textoActa', ''), fila ->> 'acta') as acta,
      coalesce(nullif(d ->> 'disciplinario', ''), fila ->> 'disciplinario') as dirige,
      d ->> 'tipoDecision' as tipo_decision,
      d ->> 'antecedentes' as antecedentes,
      d ->> 'resumenDescargos' as resumen_descargos,
      d ->> 'consideraciones' as consideraciones,
      d ->> 'compromisos' as compromisos,
      d ->> 'numeralesSancion' as numerales_sancion,
      coalesce(nullif(d ->> 'diasSuspension', ''), fila ->> 'dias_suspension') as dias_suspension,
      coalesce(nullif(d ->> 'fechaInicioSancion', ''), fila ->> 'fecha_inicio_sancion') as fecha_ini_sancion,
      coalesce(nullif(d ->> 'fechaFinSancion', ''), fila ->> 'fecha_fin_sancion') as fecha_fin_sancion,
      d ->> 'fechaReintegro' as fecha_reintegro,
      d ->> 'recursoAnte' as recurso_ante,
      d ->> 'recursoDias' as recurso_dias,
      coalesce(nullif(d ->> 'firmaCitacion', ''), fila ->> 'firma_citacion') as firma_citacion,
      d ->> 'firmaDescargos' as firma_descargos,
      coalesce(nullif(d ->> 'firmaSancion', ''), d ->> 'firmaDecision') as firma_decision,
      upper(btrim(coalesce(nullif(d ->> 'estado', ''), fila ->> 'estado', ''))) as estado_viejo,
      coalesce(nullif(d ->> 'responsable', ''), fila ->> 'responsable') as responsable,
      coalesce(nullif(d ->> 'asunto', ''), fila ->> 'asunto') as asunto
    from viejo
  ),
  ins as (
    insert into kardex_procesos_disciplinarios (
      origen_key, employee_id, empleado_cedula, empleado_nombre, empleado_cargo,
      empleado_area, empleado_interno, empleado_ruta, empleado_fecha_ingreso,
      vehiculo_propietario, celular, correo,
      fecha_hechos, motivo, normas, pruebas_texto, falta,
      sancion_primera, sancion_segunda, sancion_tercera, sancion_cuarta,
      fecha_citacion, hora_citacion,
      asistencia, fecha_descargos, hora_descargos_inicio, hora_descargos_fin,
      acta_descargos, dirige_descargos,
      tipo_decision, antecedentes, resumen_descargos, consideraciones, compromisos,
      numerales_sancion, dias_suspension, fecha_inicio_sancion, fecha_fin_sancion,
      fecha_reintegro, recurso_ante, recurso_dias,
      firma_citacion, firma_descargos, firma_decision,
      estado, responsable, asunto, creado_por_email
    )
    select
      v.origen_key,
      (select e.id from employees e
        where e.cedula = btrim(v.cedula)
        order by e.activo desc, e.created_at desc
        limit 1),
      btrim(coalesce(v.cedula, '')),
      nullif(btrim(coalesce(v.nombre, '')), ''),
      nullif(btrim(coalesce(v.cargo, '')), ''),
      nullif(btrim(coalesce(v.area, '')), ''),
      nullif(btrim(coalesce(v.interno, '')), ''),
      nullif(btrim(coalesce(v.ruta, '')), ''),
      kardex_pd_fecha(v.fecha_ingreso),
      nullif(btrim(coalesce(v.propietario, '')), ''),
      nullif(btrim(coalesce(v.celular, '')), ''),
      nullif(btrim(coalesce(v.correo, '')), ''),
      kardex_pd_fecha(v.fecha_hechos),
      nullif(btrim(coalesce(v.motivo, '')), ''),
      nullif(btrim(coalesce(v.normas, '')), ''),
      nullif(btrim(coalesce(v.pruebas_texto, '')), ''),
      nullif(btrim(coalesce(v.falta, '')), ''),
      nullif(btrim(coalesce(v.sancion_primera, '')), ''),
      nullif(btrim(coalesce(v.sancion_segunda, '')), ''),
      nullif(btrim(coalesce(v.sancion_tercera, '')), ''),
      nullif(btrim(coalesce(v.sancion_cuarta, '')), ''),
      kardex_pd_fecha(v.fecha_citacion),
      kardex_pd_hora(v.hora_citacion),
      case when v.asistencia in ('si', 'sí') then 'si'
           when v.asistencia = 'no' then 'no'
           else null end,
      kardex_pd_fecha(v.fecha_descargos),
      kardex_pd_hora(v.hora_desc_ini),
      kardex_pd_hora(v.hora_desc_fin),
      nullif(btrim(coalesce(v.acta, '')), ''),
      nullif(btrim(coalesce(v.dirige, '')), ''),
      nullif(btrim(coalesce(v.tipo_decision, '')), ''),
      nullif(btrim(coalesce(v.antecedentes, '')), ''),
      nullif(btrim(coalesce(v.resumen_descargos, '')), ''),
      nullif(btrim(coalesce(v.consideraciones, '')), ''),
      nullif(btrim(coalesce(v.compromisos, '')), ''),
      nullif(btrim(coalesce(v.numerales_sancion, '')), ''),
      nullif(btrim(coalesce(v.dias_suspension, '')), ''),
      kardex_pd_fecha(v.fecha_ini_sancion),
      kardex_pd_fecha(v.fecha_fin_sancion),
      kardex_pd_fecha(v.fecha_reintegro),
      nullif(btrim(coalesce(v.recurso_ante, '')), ''),
      nullif(btrim(coalesce(v.recurso_dias, '')), ''),
      nullif(btrim(coalesce(v.firma_citacion, '')), ''),
      nullif(btrim(coalesce(v.firma_descargos, '')), ''),
      nullif(btrim(coalesce(v.firma_decision, '')), ''),
      case
        when v.estado_viejo like '%FINALIZ%' then 'finalizado'
        when v.estado_viejo like '%CANCEL%' then 'cancelado'
        when v.estado_viejo like '%SANCION%' or v.estado_viejo like '%SUSPENS%'
          or v.estado_viejo like '%TERMINA%' or v.estado_viejo like '%LLAMADO%' then 'decision'
        when v.estado_viejo like '%DESCARGO%' and v.estado_viejo not like '%CITACION%' then 'descargos'
        when v.estado_viejo like '%CONVERSATORIO%' then 'descargos'
        else 'citacion'
      end,
      nullif(btrim(coalesce(v.responsable, '')), ''),
      nullif(btrim(coalesce(v.asunto, '')), ''),
      coalesce(auth.jwt() ->> 'email', 'importacion')
    from campos v
    where coalesce(btrim(v.cedula), '') <> ''
    -- Solo rellena huecos. Lo que ya tiene valor en el ERP queda como esta,
    -- venga de la hoja o de alguien que lo edito aca.
    on conflict (origen_key) do update set
      employee_id = coalesce(kardex_procesos_disciplinarios.employee_id, excluded.employee_id),
      empleado_nombre = coalesce(kardex_procesos_disciplinarios.empleado_nombre, excluded.empleado_nombre),
      empleado_cargo = coalesce(kardex_procesos_disciplinarios.empleado_cargo, excluded.empleado_cargo),
      empleado_area = coalesce(kardex_procesos_disciplinarios.empleado_area, excluded.empleado_area),
      empleado_interno = coalesce(kardex_procesos_disciplinarios.empleado_interno, excluded.empleado_interno),
      empleado_ruta = coalesce(kardex_procesos_disciplinarios.empleado_ruta, excluded.empleado_ruta),
      empleado_fecha_ingreso = coalesce(kardex_procesos_disciplinarios.empleado_fecha_ingreso, excluded.empleado_fecha_ingreso),
      vehiculo_propietario = coalesce(kardex_procesos_disciplinarios.vehiculo_propietario, excluded.vehiculo_propietario),
      celular = coalesce(kardex_procesos_disciplinarios.celular, excluded.celular),
      correo = coalesce(kardex_procesos_disciplinarios.correo, excluded.correo),
      fecha_hechos = coalesce(kardex_procesos_disciplinarios.fecha_hechos, excluded.fecha_hechos),
      motivo = coalesce(kardex_procesos_disciplinarios.motivo, excluded.motivo),
      normas = coalesce(kardex_procesos_disciplinarios.normas, excluded.normas),
      pruebas_texto = coalesce(kardex_procesos_disciplinarios.pruebas_texto, excluded.pruebas_texto),
      falta = coalesce(kardex_procesos_disciplinarios.falta, excluded.falta),
      sancion_primera = coalesce(kardex_procesos_disciplinarios.sancion_primera, excluded.sancion_primera),
      sancion_segunda = coalesce(kardex_procesos_disciplinarios.sancion_segunda, excluded.sancion_segunda),
      sancion_tercera = coalesce(kardex_procesos_disciplinarios.sancion_tercera, excluded.sancion_tercera),
      sancion_cuarta = coalesce(kardex_procesos_disciplinarios.sancion_cuarta, excluded.sancion_cuarta),
      fecha_citacion = coalesce(kardex_procesos_disciplinarios.fecha_citacion, excluded.fecha_citacion),
      hora_citacion = coalesce(kardex_procesos_disciplinarios.hora_citacion, excluded.hora_citacion),
      asistencia = coalesce(kardex_procesos_disciplinarios.asistencia, excluded.asistencia),
      fecha_descargos = coalesce(kardex_procesos_disciplinarios.fecha_descargos, excluded.fecha_descargos),
      hora_descargos_inicio = coalesce(kardex_procesos_disciplinarios.hora_descargos_inicio, excluded.hora_descargos_inicio),
      hora_descargos_fin = coalesce(kardex_procesos_disciplinarios.hora_descargos_fin, excluded.hora_descargos_fin),
      acta_descargos = coalesce(kardex_procesos_disciplinarios.acta_descargos, excluded.acta_descargos),
      dirige_descargos = coalesce(kardex_procesos_disciplinarios.dirige_descargos, excluded.dirige_descargos),
      -- Lo que de verdad veniamos a buscar: la hoja no trae nada de esto.
      tipo_decision = coalesce(kardex_procesos_disciplinarios.tipo_decision, excluded.tipo_decision),
      antecedentes = coalesce(kardex_procesos_disciplinarios.antecedentes, excluded.antecedentes),
      resumen_descargos = coalesce(kardex_procesos_disciplinarios.resumen_descargos, excluded.resumen_descargos),
      consideraciones = coalesce(kardex_procesos_disciplinarios.consideraciones, excluded.consideraciones),
      compromisos = coalesce(kardex_procesos_disciplinarios.compromisos, excluded.compromisos),
      numerales_sancion = coalesce(kardex_procesos_disciplinarios.numerales_sancion, excluded.numerales_sancion),
      dias_suspension = coalesce(kardex_procesos_disciplinarios.dias_suspension, excluded.dias_suspension),
      fecha_inicio_sancion = coalesce(kardex_procesos_disciplinarios.fecha_inicio_sancion, excluded.fecha_inicio_sancion),
      fecha_fin_sancion = coalesce(kardex_procesos_disciplinarios.fecha_fin_sancion, excluded.fecha_fin_sancion),
      fecha_reintegro = coalesce(kardex_procesos_disciplinarios.fecha_reintegro, excluded.fecha_reintegro),
      recurso_ante = coalesce(kardex_procesos_disciplinarios.recurso_ante, excluded.recurso_ante),
      recurso_dias = coalesce(kardex_procesos_disciplinarios.recurso_dias, excluded.recurso_dias),
      firma_citacion = coalesce(kardex_procesos_disciplinarios.firma_citacion, excluded.firma_citacion),
      firma_descargos = coalesce(kardex_procesos_disciplinarios.firma_descargos, excluded.firma_descargos),
      firma_decision = coalesce(kardex_procesos_disciplinarios.firma_decision, excluded.firma_decision),
      -- El estado solo avanza. Si el ERP ya lo tiene mas adelante, se queda.
      estado = case
        when kardex_procesos_disciplinarios.estado in ('decision', 'finalizado', 'cancelado')
          then kardex_procesos_disciplinarios.estado
        when excluded.estado in ('decision', 'finalizado', 'cancelado', 'descargos')
          then excluded.estado
        else kardex_procesos_disciplinarios.estado
      end,
      responsable = coalesce(kardex_procesos_disciplinarios.responsable, excluded.responsable),
      asunto = coalesce(kardex_procesos_disciplinarios.asunto, excluded.asunto)
    returning 1 as tocada
  )
  select count(*)::integer into v_copiados from ins;

  -- Cuantas filas del rango se miraron (aunque alguna no tuviera cedula):
  -- es lo que le dice a la app si quedan vueltas por dar.
  select count(*)::integer into v_procesados
  from (
    select 1 from procesos_disciplinarios pv
    where pv.key is not null
    order by pv.key
    offset greatest(p_desde, 0)
    limit greatest(p_limite, 1)
  ) q;

  return query
  select v_copiados, v_procesados, v_total,
         (select count(*)::integer from kardex_procesos_disciplinarios where employee_id is not null),
         (select count(*)::integer from kardex_procesos_disciplinarios where employee_id is null);
end;
$$;

revoke all on function kardex_pd_importar(integer, integer) from public;
grant execute on function kardex_pd_importar(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Un indice que faltaba
-- ---------------------------------------------------------------------------
-- Cada fila hace un "select e.id from employees where e.cedula = ..." para
-- enlazar la persona. Sin indice por cedula eso es un recorrido completo de
-- employees por cada proceso, que es buena parte de lo que se demoraba.
create index if not exists idx_employees_cedula on employees (cedula);
