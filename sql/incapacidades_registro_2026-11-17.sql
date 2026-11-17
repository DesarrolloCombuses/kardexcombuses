-- ============================================================================
-- Kardex de Dotación -- Combuses SA
-- REGISTRAR incapacidades desde la aplicación, no solo mirarlas.
--
-- Hasta ahora kardex_incapacidades era una copia de solo lectura del Google
-- Sheet de Gestión Humana (ver sql/incapacidades_2026-11-16.sql): la Edge
-- Function borraba la tabla entera y la volvía a cargar. Eso basta para
-- consultar, pero significa que Kardex no es donde se registra nada.
--
-- EL PROBLEMA QUE RESUELVE ESTE ARCHIVO
-- --------------------------------------
-- Si se abre un formulario para registrar incapacidades sin tocar nada más,
-- la siguiente sincronización BORRA lo registrado y nadie se entera: la fila
-- simplemente ya no está, sin error, sin aviso y sin forma de recuperarla.
--
-- Por eso cada fila dice de dónde vino (columna `origen`) y la
-- sincronización solo puede tocar las del sheet. Las registradas en Kardex
-- no las borra nadie más que quien tenga permiso de borrarlas.
--
-- No hay que migrar el sheet ni elegir hoy entre uno u otro: el histórico
-- sigue llegando de allá y lo nuevo se puede cargar acá. Cuando Gestión
-- Humana deje de escribir en el sheet, la sincronización se apaga y ya.
--
-- LO QUE NO SE PUEDE HACER DESDE KARDEX, A PROPÓSITO
-- ---------------------------------------------------
-- Editar o borrar una fila que vino del sheet. Se podría dejar, pero el
-- cambio duraría hasta la siguiente sincronización y después volvería solo
-- al valor viejo -- que es peor que no poder hacerlo, porque parece que
-- funcionó. Esas se corrigen en el sheet, y el módulo lo dice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. De dónde vino cada fila, y quién la tocó
-- ---------------------------------------------------------------------------
-- default 'SHEET': las 553 filas que ya están vinieron todas del sheet, así
-- que el default es el relleno correcto para lo que ya existe.
alter table kardex_incapacidades
  add column if not exists origen text not null default 'SHEET',
  add column if not exists observaciones text,
  add column if not exists creado_por text,
  add column if not exists creado_en timestamptz,
  add column if not exists actualizado_por text,
  add column if not exists actualizado_en timestamptz;

alter table kardex_incapacidades drop constraint if exists kardex_incapacidades_origen_check;
alter table kardex_incapacidades add constraint kardex_incapacidades_origen_check
  check (origen in ('SHEET', 'KARDEX'));

-- La sincronización filtra por esta columna en cada corrida: sin índice
-- recorre la tabla entera para saber qué puede borrar.
create index if not exists idx_kardex_incapacidades_origen on kardex_incapacidades(origen);

-- Una incapacidad registrada en Kardex no puede terminar antes de empezar.
-- Es justo el error que trae el sheet (3 filas hoy) y que deja los días en
-- negativo; acá no se permite entrar. Las del sheet quedan fuera del CHECK
-- porque ya están guardadas y bloquear la sincronización por un dato malo de
-- origen dejaría el módulo desactualizado sin que nadie pudiera arreglarlo.
alter table kardex_incapacidades drop constraint if exists kardex_incapacidades_fechas_check;
alter table kardex_incapacidades add constraint kardex_incapacidades_fechas_check
  check (
    origen <> 'KARDEX'
    or (fecha_inicio is not null and fecha_fin is not null and fecha_fin >= fecha_inicio)
  );

-- ---------------------------------------------------------------------------
-- 2. Quién puede escribir
-- ---------------------------------------------------------------------------
-- OJO: acá NO se usa kardex_es_gestion_humana(), por lo mismo que en
-- kardex_puede_ver_diagnostico(). Esa función da true a cualquier cuenta
-- autorizada, incluidas las de rol "viewer". Un viewer es una cuenta de
-- consulta: puede ver el módulo, pero no registrar ausencias de nadie.
create or replace function kardex_incapacidades_permiso(p_accion text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    kardex_mi_rol_autorizado() = 'admin'
    or kardex_mi_grupo() = 'GESTION HUMANA'
    or kardex_tiene_permiso('incapacidades', p_accion),
    false);
$$;

-- Todo lo que el módulo necesita saber para pintarse, en una sola llamada.
-- El cliente usa esto para mostrar u ocultar botones; quien de verdad decide
-- sigue siendo cada función de abajo, que vuelve a preguntar. Esconder un
-- botón no protege nada -- cualquiera puede llamar a la API a mano.
create or replace function kardex_incapacidades_permisos()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'ver', kardex_puede_ver_incapacidades(),
    'registrar', kardex_incapacidades_permiso('agregar'),
    'editar', kardex_incapacidades_permiso('editar'),
    'borrar', kardex_incapacidades_permiso('borrar'),
    'diagnostico', kardex_puede_ver_diagnostico());
$$;

-- ---------------------------------------------------------------------------
-- 3. Guardar (registrar o corregir)
-- ---------------------------------------------------------------------------
-- Los días NO se reciben del formulario: se calculan acá. En el sheet son
-- una columna escrita a mano, y de ahí salen las filas con días negativos.
-- Un dato que se puede deducir de otros dos no se le pide a nadie.
create or replace function kardex_incapacidad_guardar(p_datos jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_id          bigint := nullif(p_datos->>'id', '')::bigint;
  v_cedula      text   := nullif(trim(p_datos->>'cedula'), '');
  v_tipo        text   := upper(nullif(trim(p_datos->>'tipo_evento'), ''));
  v_inicio      date   := nullif(p_datos->>'fecha_inicio', '')::date;
  v_fin         date   := nullif(p_datos->>'fecha_fin', '')::date;
  v_eps         text   := nullif(trim(p_datos->>'eps'), '');
  v_obs         text   := nullif(trim(p_datos->>'observaciones'), '');
  v_registro    date   := nullif(p_datos->>'fecha_registro', '')::date;
  v_dx_cod      text;
  v_dx_desc     text;
  v_emp         record;
  v_origen      text;
  v_dias        integer;
  v_fin_mes     date;
  v_dias_real   integer;
  v_quien       text   := coalesce(auth.jwt()->>'email', 'desconocido');
begin
  -- -- permiso ---------------------------------------------------------------
  if v_id is null then
    if not kardex_incapacidades_permiso('agregar') then
      raise exception 'Tu cuenta no tiene permiso para registrar incapacidades.'
        using errcode = '42501';
    end if;
  else
    if not kardex_incapacidades_permiso('editar') then
      raise exception 'Tu cuenta no tiene permiso para corregir incapacidades.'
        using errcode = '42501';
    end if;
    select origen into v_origen from kardex_incapacidades where id = v_id;
    if v_origen is null then
      raise exception 'Esa incapacidad ya no existe.' using errcode = 'P0002';
    end if;
    -- Ver la nota de arriba: dejar editarla sería mentirle a quien la edita.
    if v_origen = 'SHEET' then
      raise exception 'Esta incapacidad vino del Google Sheet. Corrígela allá: si se cambia aquí, la próxima sincronización la devuelve como estaba.'
        using errcode = '42501';
    end if;
  end if;

  -- -- validación ------------------------------------------------------------
  -- Se comprueba en el servidor y no solo en el formulario: el formulario es
  -- una comodidad, no una barrera -- cualquiera puede llamar a la API.
  if v_cedula is null then
    raise exception 'Falta la cédula de la persona.' using errcode = '22023';
  end if;

  -- `not found` y no `v_emp is null`: un registro compuesto da IS NULL
  -- cuando TODOS sus campos son nulos, así que un empleado real sin cargo ni
  -- área se tomaría por inexistente.
  select e.nombre, e.cargo, e.area into v_emp
  from employees e where e.cedula = v_cedula limit 1;
  if not found then
    raise exception 'La cédula % no está en Empleados. Cárgala primero allá.', v_cedula
      using errcode = '22023';
  end if;

  if v_tipo is null or v_tipo not in ('EG', 'AT', 'EL') then
    raise exception 'El tipo de evento tiene que ser EG, AT o EL.' using errcode = '22023';
  end if;
  if v_inicio is null or v_fin is null then
    raise exception 'Hacen falta la fecha de inicio y la de fin.' using errcode = '22023';
  end if;
  if v_fin < v_inicio then
    raise exception 'La fecha de fin no puede ser anterior a la de inicio.' using errcode = '22023';
  end if;

  -- -- el diagnóstico --------------------------------------------------------
  -- Quien no puede VERLO tampoco lo escribe. Y sobre todo: al corregir una
  -- incapacidad no lo borra sin querer. El formulario de esa cuenta nunca
  -- recibió el diagnóstico, así que tampoco lo manda de vuelta -- si se
  -- guardara lo que llega, el dato se perdería con solo abrir y guardar.
  if kardex_puede_ver_diagnostico() then
    v_dx_cod  := nullif(trim(p_datos->>'diagnostico_codigo'), '');
    v_dx_desc := nullif(trim(p_datos->>'diagnostico_descripcion'), '');
  elsif v_id is not null then
    select diagnostico_codigo, diagnostico_descripcion into v_dx_cod, v_dx_desc
    from kardex_incapacidades where id = v_id;
  end if;

  -- -- los días --------------------------------------------------------------
  -- Inclusivos: una incapacidad del 5 al 5 es un día, no cero.
  v_dias := (v_fin - v_inicio) + 1;
  -- Cuántos caen en el mes en que empieza y cuántos se pasan al siguiente.
  -- Es el corte que usa Gestión Humana para la nómina.
  v_fin_mes := (date_trunc('month', v_inicio) + interval '1 month - 1 day')::date;
  v_dias_real := (least(v_fin, v_fin_mes) - v_inicio) + 1;

  if v_id is null then
    insert into kardex_incapacidades (
      origen, sheet_key, cedula, nombre, cargo, area, tipo_evento, eps,
      fecha_inicio, fecha_fin, dias, dias_mes_real, dias_mes_siguiente,
      diagnostico_codigo, diagnostico_descripcion, fecha_registro,
      observaciones, datos, creado_por, creado_en)
    values (
      'KARDEX', null, v_cedula, v_emp.nombre, v_emp.cargo, v_emp.area, v_tipo, v_eps,
      v_inicio, v_fin, v_dias, v_dias_real, v_dias - v_dias_real,
      v_dx_cod, v_dx_desc, coalesce(v_registro, current_date),
      v_obs, '{}'::jsonb, v_quien, now())
    returning id into v_id;
  else
    update kardex_incapacidades set
      cedula = v_cedula, nombre = v_emp.nombre, cargo = v_emp.cargo, area = v_emp.area,
      tipo_evento = v_tipo, eps = v_eps,
      fecha_inicio = v_inicio, fecha_fin = v_fin,
      dias = v_dias, dias_mes_real = v_dias_real, dias_mes_siguiente = v_dias - v_dias_real,
      diagnostico_codigo = v_dx_cod, diagnostico_descripcion = v_dx_desc,
      fecha_registro = coalesce(v_registro, fecha_registro),
      observaciones = v_obs,
      actualizado_por = v_quien, actualizado_en = now()
    where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'dias', v_dias);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Borrar
-- ---------------------------------------------------------------------------
create or replace function kardex_incapacidad_borrar(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_origen text;
begin
  if not kardex_incapacidades_permiso('borrar') then
    raise exception 'Tu cuenta no tiene permiso para borrar incapacidades.'
      using errcode = '42501';
  end if;
  select origen into v_origen from kardex_incapacidades where id = p_id;
  if v_origen is null then
    raise exception 'Esa incapacidad ya no existe.' using errcode = 'P0002';
  end if;
  if v_origen = 'SHEET' then
    raise exception 'Esta incapacidad vino del Google Sheet. Bórrala allá: si se borra aquí, la próxima sincronización la vuelve a traer.'
      using errcode = '42501';
  end if;
  delete from kardex_incapacidades where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. El listado tiene que decir de dónde viene cada fila
-- ---------------------------------------------------------------------------
-- Sin `origen` en la respuesta, el módulo no sabría cuáles puede ofrecer
-- para editar, y ofrecería todas -- para después fallar con un 42501.
create or replace function kardex_incapacidades_listar(
  p_desde date default null,
  p_hasta date default null
)
returns setof jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_diag boolean;
begin
  if not kardex_puede_ver_incapacidades() then
    raise exception 'Tu cuenta no tiene permiso para ver Incapacidades.'
      using errcode = '42501';
  end if;
  v_diag := kardex_puede_ver_diagnostico();

  return query
  select
    jsonb_build_object(
      'id', i.id,
      'origen', i.origen,
      'sheet_key', i.sheet_key,
      'cedula', i.cedula,
      'nombre', i.nombre,
      'cargo', i.cargo,
      'area', i.area,
      'tipo_evento', i.tipo_evento,
      'eps', i.eps,
      'fecha_inicio', i.fecha_inicio,
      'fecha_fin', i.fecha_fin,
      'dias', i.dias,
      'dias_mes_real', i.dias_mes_real,
      'dias_mes_siguiente', i.dias_mes_siguiente,
      'fecha_registro', i.fecha_registro,
      'observaciones', i.observaciones,
      'ruta', i.ruta,
      'interno', i.interno,
      'afiliado', i.afiliado,
      'adjunto', i.adjunto,
      'datos', i.datos,
      'creado_por', i.creado_por,
      'creado_en', i.creado_en,
      'actualizado_por', i.actualizado_por,
      'actualizado_en', i.actualizado_en,
      'en_nomina', exists (select 1 from employees e where e.cedula = i.cedula),
      'activo', exists (select 1 from employees e where e.cedula = i.cedula and e.activo)
    )
    || case when v_diag then jsonb_build_object(
         'diagnostico_codigo', i.diagnostico_codigo,
         'diagnostico_descripcion', i.diagnostico_descripcion)
       else '{}'::jsonb end
  from kardex_incapacidades i
  where (p_desde is null or i.fecha_inicio >= p_desde)
    and (p_hasta is null or i.fecha_inicio <= p_hasta)
  order by i.fecha_inicio desc nulls last, i.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke all on function kardex_incapacidades_permiso(text) from public, anon;
revoke all on function kardex_incapacidades_permisos() from public, anon;
revoke all on function kardex_incapacidad_guardar(jsonb) from public, anon;
revoke all on function kardex_incapacidad_borrar(bigint) from public, anon;
grant execute on function kardex_incapacidades_permiso(text) to authenticated;
grant execute on function kardex_incapacidades_permisos() to authenticated;
grant execute on function kardex_incapacidad_guardar(jsonb) to authenticated;
grant execute on function kardex_incapacidad_borrar(bigint) to authenticated;
