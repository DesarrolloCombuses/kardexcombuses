-- ============================================================================
-- Kardex de Dotación -- Combuses SA
-- Se jubila el Google Sheet: Incapacidades se lleva SOLO desde Kardex.
--
-- Gestión Humana deja de escribir en el sheet. Desde ahora la incapacidad se
-- registra en el ERP y no hay nada que sincronizar.
--
-- LO QUE HAY QUE DESHACER, Y POR QUÉ NO ES OPCIONAL
-- --------------------------------------------------
-- En sql/incapacidades_registro_2026-11-17.sql se bloqueó a propósito
-- corregir o borrar las filas con origen = 'SHEET': la sincronización las
-- devolvía como estuvieran en el sheet, así que el cambio no habría durado.
--
-- Apagado el sheet, ese bloqueo se vuelve una trampa. Las 553 filas
-- históricas quedarían congeladas para siempre, y entre ellas están las 3
-- con la fecha final antes de la inicial y las 9 con una cédula que no cruza
-- con Empleados. Ya no se podrían arreglar en el sheet (nadie lo mira) ni en
-- Kardex (está prohibido). Por eso se quita el bloqueo.
--
-- LO QUE SE CONSERVA
-- -------------------
-- La columna `origen` NO se toca. Sigue diciendo de dónde salió cada fila, y
-- eso sigue siendo cierto y sigue sirviendo: son datos que nadie escribió
-- aquí, con la calidad que traía el sheet. Lo que cambia es quién los puede
-- corregir, no de dónde vinieron.
--
-- El CHECK kardex_incapacidades_fechas_check tampoco se toca: sigue exigiendo
-- fechas coherentes a las filas nuevas (origen = 'KARDEX') y sigue dejando en
-- paz a las históricas, que ya están guardadas con el error de origen. Si las
-- bloqueara, no se podría ni abrirlas para corregirlas.
--
-- La Edge Function sync-incapacidades queda desactivada en su propio código
-- (devuelve 410) en vez de borrarse: así, si alguien la llama por costumbre o
-- por un cron olvidado, responde que ya no se usa en vez de volver a cargar
-- 553 filas encima de las que ahora se mantienen aquí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Guardar: sin el bloqueo de las filas del sheet
-- ---------------------------------------------------------------------------
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
  v_existe      boolean;
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
    -- Ya no se mira el origen: apagado el sheet, una fila histórica se
    -- corrige igual que una registrada aquí. Lo único que se comprueba es
    -- que exista.
    select true into v_existe from kardex_incapacidades where id = v_id;
    if not found then
      raise exception 'Esa incapacidad ya no existe.' using errcode = 'P0002';
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
-- Borrar: igual, sin mirar el origen
-- ---------------------------------------------------------------------------
create or replace function kardex_incapacidad_borrar(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_existe boolean;
begin
  if not kardex_incapacidades_permiso('borrar') then
    raise exception 'Tu cuenta no tiene permiso para borrar incapacidades.'
      using errcode = '42501';
  end if;
  select true into v_existe from kardex_incapacidades where id = p_id;
  if not found then
    raise exception 'Esa incapacidad ya no existe.' using errcode = 'P0002';
  end if;
  delete from kardex_incapacidades where id = p_id;
end;
$$;

revoke all on function kardex_incapacidad_guardar(jsonb) from public, anon;
revoke all on function kardex_incapacidad_borrar(bigint) from public, anon;
grant execute on function kardex_incapacidad_guardar(jsonb) to authenticated;
grant execute on function kardex_incapacidad_borrar(bigint) to authenticated;
