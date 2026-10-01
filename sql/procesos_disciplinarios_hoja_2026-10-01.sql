-- ============================================================================
-- Kardex / ERP Combuses -- Procesos disciplinarios: importar desde la hoja
--
-- Complemento de procesos_disciplinarios_2026-10-01.sql.
--
-- POR QUE EXISTE ESTE ARCHIVO
-- La primera importacion (kardex_pd_importar) lee la tabla
-- `procesos_disciplinarios` del programa anterior, que tiene 303 procesos.
-- Al revisar la hoja de calculo que alimenta ese programa resulta que la hoja
-- tiene 417: los mismos 303 mas 114 de 2026 que nunca llegaron a la tabla. O
-- sea, la tabla es una foto vieja y la hoja es la fuente que Gestion Humana
-- mantiene al dia. Importar solo de la tabla dejaria 114 procesos por fuera.
--
-- Esta funcion recibe las filas de la hoja YA PARSEADAS por el navegador (el
-- CSV publicado se descarga desde la app, igual que hacia el programa viejo) y
-- las sube con la misma llave `origen_key` = columna KEY de la hoja. Como es
-- la misma llave que usa kardex_pd_importar(), un proceso que ya se trajo de
-- la tabla NO se duplica: se completa.
--
-- Seguro de re-ejecutar y seguro de re-importar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table kardex_procesos_disciplinarios
  add column if not exists fecha_registro date,
  add column if not exists importado_en timestamptz,
  add column if not exists origen_fila jsonb;

comment on column kardex_procesos_disciplinarios.fecha_registro is
  'Fecha en que se diligencio el formulario en la hoja (no es la fecha de la diligencia de descargos).';
comment on column kardex_procesos_disciplinarios.importado_en is
  'Ultima vez que esta fila se trajo de la hoja. Si updated_at es posterior, alguien lo edito en el ERP y una reimportacion NO lo pisa.';
comment on column kardex_procesos_disciplinarios.origen_fila is
  'La fila completa de la hoja, tal como vino. Nada se pierde: si manana se descubre que una columna se interpreto mal, se recalcula desde aca sin volver a la hoja. Tambien guarda las rutas de los archivos de AppSheet (firmas, pruebas, PDF finales), que no son descargables desde el CSV.';

-- ---------------------------------------------------------------------------
-- La importacion
-- ---------------------------------------------------------------------------
-- p_filas: arreglo de objetos con las claves que arma la app (snake_case
-- estable, no los encabezados de la hoja -- si alguien renombra una columna
-- alla, se arregla en un solo sitio del JS y no aca).
create or replace function kardex_pd_importar_hoja(p_filas jsonb)
returns table (
  recibidos integer,
  insertados integer,
  actualizados integer,
  respetados integer,
  sin_cedula integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recibidos integer := 0;
  v_sin_cedula integer := 0;
  v_ins integer := 0;
  v_upd integer := 0;
  v_validos integer := 0;
begin
  if not coalesce(kardex_es_gestion_humana()
                  or kardex_tiene_permiso('procesos-disciplinarios', 'agregar'), false) then
    raise exception 'No autorizado para importar procesos disciplinarios.';
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Se esperaba un arreglo de filas de la hoja.';
  end if;

  select count(*)::integer into v_recibidos from jsonb_array_elements(p_filas);

  with v as (
    select
      f as fila,
      nullif(btrim(coalesce(f ->> 'key', '')), '') as origen_key,
      nullif(btrim(coalesce(f ->> 'cc', '')), '') as cedula
    from jsonb_array_elements(p_filas) f
  ),
  buenas as (
    select * from v where origen_key is not null and cedula is not null
  ),
  ins as (
    insert into kardex_procesos_disciplinarios (
      origen_key, employee_id, empleado_cedula, empleado_nombre, empleado_cargo,
      empleado_area, empleado_interno, empleado_ruta, empleado_fecha_ingreso,
      vehiculo_propietario, celular, correo,
      fecha_registro, motivo, normas, falta,
      sancion_primera, sancion_segunda, sancion_tercera, sancion_cuarta,
      fecha_citacion, hora_citacion,
      asistencia, fecha_descargos, hora_descargos_inicio, hora_descargos_fin,
      acta_descargos, dirige_descargos,
      dias_suspension, fecha_inicio_sancion, fecha_fin_sancion,
      firma_citacion, firma_decision,
      estado, responsable, asunto,
      creado_por_email, origen_fila, importado_en
    )
    select
      b.origen_key,
      -- Enlace por cedula, prefiriendo la ficha activa.
      (select e.id from employees e
        where e.cedula = b.cedula
        order by e.activo desc, e.created_at desc
        limit 1),
      b.cedula,
      nullif(btrim(coalesce(b.fila ->> 'nombre', '')), ''),
      -- La hoja trae CARGO vacio en 392 de 417 filas (y mete el cargo real en
      -- la columna AREA). La ficha de employees es el dato bueno, asi que se
      -- usa para completar lo que la hoja no trae, sin pisar lo que si trae.
      coalesce(
        nullif(btrim(coalesce(b.fila ->> 'cargo', '')), ''),
        (select e.cargo from employees e where e.cedula = b.cedula
          order by e.activo desc, e.created_at desc limit 1)
      ),
      nullif(btrim(coalesce(b.fila ->> 'area', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'interno', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'ruta', '')), ''),
      kardex_pd_fecha(b.fila ->> 'fecha_ingreso'),
      nullif(btrim(coalesce(b.fila ->> 'propietario', '')), ''),
      coalesce(
        nullif(btrim(coalesce(b.fila ->> 'celular_citado', '')), ''),
        nullif(btrim(coalesce(b.fila ->> 'celular', '')), ''),
        nullif(btrim(coalesce(b.fila ->> 'celular_afiliado', '')), '')
      ),
      coalesce(
        nullif(btrim(coalesce(b.fila ->> 'correo_citado', '')), ''),
        nullif(btrim(coalesce(b.fila ->> 'correo_notificacion', '')), ''),
        nullif(btrim(coalesce(b.fila ->> 'correo_afiliado', '')), '')
      ),
      kardex_pd_fecha(b.fila ->> 'fecha_registro'),
      nullif(btrim(coalesce(b.fila ->> 'motivo', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'normas', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'falta', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'primera_vez', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'segunda_vez', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'tercera_vez', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'cuarta_vez', '')), ''),
      kardex_pd_fecha(b.fila ->> 'fecha_citacion'),
      kardex_pd_hora(b.fila ->> 'hora_citacion'),
      case lower(btrim(coalesce(b.fila ->> 'asistencia', '')))
        when 'si' then 'si'
        when 'sí' then 'si'
        when 'no' then 'no'
        else null
      end,
      -- La hoja tiene DOS fechas de diligencia: la del acta (formato de fecha)
      -- y una escrita a mano ("4 de September 2025"). Se prefiere la que
      -- parsea; la otra queda intacta en origen_fila.
      coalesce(kardex_pd_fecha(b.fila ->> 'fecha_acta'),
               kardex_pd_fecha(b.fila ->> 'fecha_diligencia')),
      kardex_pd_hora(b.fila ->> 'hora_acta'),
      kardex_pd_hora(b.fila ->> 'hora_diligencia'),
      coalesce(
        nullif(btrim(coalesce(b.fila ->> 'acta', '')), ''),
        nullif(btrim(coalesce(b.fila ->> 'texto_acta', '')), '')
      ),
      nullif(btrim(coalesce(b.fila ->> 'disciplinario', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'dias_suspension', '')), ''),
      kardex_pd_fecha(b.fila ->> 'fecha_inicio_sancion'),
      kardex_pd_fecha(b.fila ->> 'fecha_fin_sancion'),
      nullif(btrim(coalesce(b.fila ->> 'firma_citacion', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'firma_sancion', '')), ''),
      case
        when upper(coalesce(b.fila ->> 'estado', '')) like '%FINALIZ%' then 'finalizado'
        when upper(coalesce(b.fila ->> 'estado', '')) like '%CANCEL%' then 'cancelado'
        when upper(coalesce(b.fila ->> 'estado', '')) like '%CONVERSATORIO%' then 'descargos'
        else 'citacion'
      end,
      nullif(btrim(coalesce(b.fila ->> 'responsable', '')), ''),
      nullif(btrim(coalesce(b.fila ->> 'asunto', '')), ''),
      coalesce(auth.jwt() ->> 'email', 'importacion'),
      b.fila,
      now()
    from buenas b
    on conflict (origen_key) do update set
      employee_id = coalesce(excluded.employee_id, kardex_procesos_disciplinarios.employee_id),
      empleado_nombre = coalesce(excluded.empleado_nombre, kardex_procesos_disciplinarios.empleado_nombre),
      empleado_cargo = coalesce(excluded.empleado_cargo, kardex_procesos_disciplinarios.empleado_cargo),
      empleado_area = coalesce(excluded.empleado_area, kardex_procesos_disciplinarios.empleado_area),
      empleado_interno = coalesce(excluded.empleado_interno, kardex_procesos_disciplinarios.empleado_interno),
      empleado_ruta = coalesce(excluded.empleado_ruta, kardex_procesos_disciplinarios.empleado_ruta),
      empleado_fecha_ingreso = coalesce(excluded.empleado_fecha_ingreso, kardex_procesos_disciplinarios.empleado_fecha_ingreso),
      vehiculo_propietario = coalesce(excluded.vehiculo_propietario, kardex_procesos_disciplinarios.vehiculo_propietario),
      celular = coalesce(excluded.celular, kardex_procesos_disciplinarios.celular),
      correo = coalesce(excluded.correo, kardex_procesos_disciplinarios.correo),
      fecha_registro = coalesce(excluded.fecha_registro, kardex_procesos_disciplinarios.fecha_registro),
      motivo = coalesce(excluded.motivo, kardex_procesos_disciplinarios.motivo),
      normas = coalesce(excluded.normas, kardex_procesos_disciplinarios.normas),
      falta = coalesce(excluded.falta, kardex_procesos_disciplinarios.falta),
      sancion_primera = coalesce(excluded.sancion_primera, kardex_procesos_disciplinarios.sancion_primera),
      sancion_segunda = coalesce(excluded.sancion_segunda, kardex_procesos_disciplinarios.sancion_segunda),
      sancion_tercera = coalesce(excluded.sancion_tercera, kardex_procesos_disciplinarios.sancion_tercera),
      sancion_cuarta = coalesce(excluded.sancion_cuarta, kardex_procesos_disciplinarios.sancion_cuarta),
      fecha_citacion = coalesce(excluded.fecha_citacion, kardex_procesos_disciplinarios.fecha_citacion),
      hora_citacion = coalesce(excluded.hora_citacion, kardex_procesos_disciplinarios.hora_citacion),
      asistencia = coalesce(excluded.asistencia, kardex_procesos_disciplinarios.asistencia),
      fecha_descargos = coalesce(excluded.fecha_descargos, kardex_procesos_disciplinarios.fecha_descargos),
      hora_descargos_inicio = coalesce(excluded.hora_descargos_inicio, kardex_procesos_disciplinarios.hora_descargos_inicio),
      hora_descargos_fin = coalesce(excluded.hora_descargos_fin, kardex_procesos_disciplinarios.hora_descargos_fin),
      acta_descargos = coalesce(excluded.acta_descargos, kardex_procesos_disciplinarios.acta_descargos),
      dirige_descargos = coalesce(excluded.dirige_descargos, kardex_procesos_disciplinarios.dirige_descargos),
      dias_suspension = coalesce(excluded.dias_suspension, kardex_procesos_disciplinarios.dias_suspension),
      fecha_inicio_sancion = coalesce(excluded.fecha_inicio_sancion, kardex_procesos_disciplinarios.fecha_inicio_sancion),
      fecha_fin_sancion = coalesce(excluded.fecha_fin_sancion, kardex_procesos_disciplinarios.fecha_fin_sancion),
      firma_citacion = coalesce(excluded.firma_citacion, kardex_procesos_disciplinarios.firma_citacion),
      firma_decision = coalesce(excluded.firma_decision, kardex_procesos_disciplinarios.firma_decision),
      -- El estado NO se devuelve atras: si el ERP ya lo movio mas adelante que
      -- la hoja, manda el ERP.
      estado = case
        when kardex_procesos_disciplinarios.estado in ('decision', 'finalizado', 'cancelado')
          then kardex_procesos_disciplinarios.estado
        else excluded.estado
      end,
      responsable = coalesce(excluded.responsable, kardex_procesos_disciplinarios.responsable),
      asunto = coalesce(excluded.asunto, kardex_procesos_disciplinarios.asunto),
      origen_fila = excluded.origen_fila,
      importado_en = now()
    -- Si alguien edito el proceso dentro del ERP despues de la ultima
    -- importacion, la hoja NO lo pisa. El trabajo hecho aca manda sobre la
    -- hoja, que es justamente lo que se quiere al dejar de usarla.
    where kardex_procesos_disciplinarios.importado_en is null
       or kardex_procesos_disciplinarios.updated_at <= kardex_procesos_disciplinarios.importado_en
    returning (xmax = 0) as es_nuevo
  )
  select
    count(*) filter (where es_nuevo)::integer,
    count(*) filter (where not es_nuevo)::integer
  into v_ins, v_upd
  from ins;

  select count(*)::integer into v_validos
  from jsonb_array_elements(p_filas) f
  where nullif(btrim(coalesce(f ->> 'key', '')), '') is not null
    and nullif(btrim(coalesce(f ->> 'cc', '')), '') is not null;

  v_sin_cedula := v_recibidos - v_validos;

  return query select
    v_recibidos,
    v_ins,
    v_upd,
    v_validos - v_ins - v_upd,
    v_sin_cedula;
end;
$$;

revoke all on function kardex_pd_importar_hoja(jsonb) from public;
grant execute on function kardex_pd_importar_hoja(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Resumen de lo que hay, para la pantalla
-- ---------------------------------------------------------------------------
create or replace function kardex_pd_resumen()
returns table (
  total integer,
  con_empleado integer,
  sin_empleado integer,
  de_la_hoja integer,
  con_acta integer,
  personas integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*)::integer,
    count(*) filter (where employee_id is not null)::integer,
    count(*) filter (where employee_id is null)::integer,
    count(*) filter (where origen_fila is not null)::integer,
    count(*) filter (where acta_descargos is not null)::integer,
    count(distinct empleado_cedula)::integer
  from kardex_procesos_disciplinarios
  where kardex_es_gestion_humana()
     or kardex_tiene_permiso('procesos-disciplinarios', 'ver');
$$;

revoke all on function kardex_pd_resumen() from public;
grant execute on function kardex_pd_resumen() to authenticated;
