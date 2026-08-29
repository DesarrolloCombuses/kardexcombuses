-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Amplia el perfil con: talla de dotacion (camisa/pantalon/calzado -- util
-- porque esta misma app reparte la dotacion), afiliaciones (EPS, ARL, fondo
-- de pension, caja de compensacion) y correo personal. Tambien deja que
-- "Hijos" se pueda diligenciar desde el link publico (antes solo se
-- editaba desde Empleados, igual que ya pasaba con Contactos de
-- emergencia).
-- Ejecutar despues de perfil_sociodemografico.sql, contactos_hijos_empleado.sql
-- y perfil_publico.sql. Seguro de re-ejecutar.
-- ============================================================================

alter table perfil_sociodemografico add column if not exists talla_camisa text;
alter table perfil_sociodemografico add column if not exists talla_pantalon text;
alter table perfil_sociodemografico add column if not exists talla_calzado text;
alter table perfil_sociodemografico add column if not exists eps text;
alter table perfil_sociodemografico add column if not exists arl text;
alter table perfil_sociodemografico add column if not exists fondo_pension text;
alter table perfil_sociodemografico add column if not exists caja_compensacion text;

alter table employees add column if not exists email_personal text;

-- Firma anterior de esta funcion (sin p_hijos) -- se borra antes de
-- recrearla porque el numero de parametros cambio.
drop function if exists public.perfil_publico_guardar(uuid, text, jsonb, jsonb, text);

create or replace function public.perfil_publico_obtener(p_employee_id uuid, p_cedula text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from employees e
    where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula)
  ) then
    raise exception 'No encontramos un registro con esa cedula para este link.';
  end if;

  select jsonb_build_object(
    'nombre', e.nombre,
    'cargo', e.cargo,
    'area', e.area,
    'telefono', e.telefono,
    'email_personal', e.email_personal,
    'foto_url', e.foto_url,
    'perfil_aprobado_at', e.perfil_aprobado_at,
    'fecha_ingreso', ps.fecha_ingreso,
    'tipo_identificacion', ps.tipo_identificacion,
    'fecha_nacimiento', ps.fecha_nacimiento,
    'sexo', ps.sexo,
    'estado_civil', ps.estado_civil,
    'grado_escolaridad', ps.grado_escolaridad,
    'composicion_familiar', ps.composicion_familiar,
    'personas_a_cargo', ps.personas_a_cargo,
    'cabeza_familia', ps.cabeza_familia,
    'estrato_socioeconomico', ps.estrato_socioeconomico,
    'lugar_residencia', ps.lugar_residencia,
    'barrio', ps.barrio,
    'tipo_vivienda', ps.tipo_vivienda,
    'medio_desplazamiento', ps.medio_desplazamiento,
    'raza', ps.raza,
    'tipo_sangre', ps.tipo_sangre,
    'conduce', ps.conduce,
    'tipo_vehiculo_conduce', ps.tipo_vehiculo_conduce,
    'anios_experiencia_conduccion', ps.anios_experiencia_conduccion,
    'talla_camisa', ps.talla_camisa,
    'talla_pantalon', ps.talla_pantalon,
    'talla_calzado', ps.talla_calzado,
    'eps', ps.eps,
    'arl', ps.arl,
    'fondo_pension', ps.fondo_pension,
    'caja_compensacion', ps.caja_compensacion,
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', ce.nombre, 'parentesco', ce.parentesco, 'telefono', ce.telefono) order by ce.created_at)
      from contactos_emergencia ce where ce.employee_id = e.id
    ), '[]'::jsonb),
    'hijos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', h.nombre, 'fecha_nacimiento', h.fecha_nacimiento, 'sexo', h.sexo) order by h.created_at)
      from hijos_empleado h where h.employee_id = e.id
    ), '[]'::jsonb)
  ) into v_result
  from employees e
  left join perfil_sociodemografico ps on ps.employee_id = e.id
  where e.id = p_employee_id;

  return v_result;
end;
$$;

revoke all on function public.perfil_publico_obtener(uuid, text) from public;
grant execute on function public.perfil_publico_obtener(uuid, text) to anon, authenticated;

create or replace function public.perfil_publico_guardar(
  p_employee_id uuid,
  p_cedula text,
  p_perfil jsonb,
  p_contactos jsonb default '[]'::jsonb,
  p_hijos jsonb default '[]'::jsonb,
  p_foto_url text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fecha_nacimiento date;
begin
  if not exists (
    select 1 from employees e
    where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula)
  ) then
    raise exception 'No encontramos un registro con esa cedula para este link.';
  end if;

  v_fecha_nacimiento := nullif(p_perfil->>'fecha_nacimiento', '')::date;
  if v_fecha_nacimiento is null then
    raise exception 'La fecha de nacimiento es obligatoria.';
  end if;
  if v_fecha_nacimiento > current_date then
    raise exception 'La fecha de nacimiento no puede ser una fecha futura.';
  end if;
  if v_fecha_nacimiento > (current_date - interval '17 years')::date then
    raise exception 'Debes ser mayor de 17 años para completar este formulario.';
  end if;
  if v_fecha_nacimiento < (current_date - interval '90 years')::date then
    raise exception 'Revisa la fecha de nacimiento, parece incorrecta.';
  end if;

  update employees set
    telefono = coalesce(p_perfil->>'telefono', telefono),
    email_personal = coalesce(p_perfil->>'email_personal', email_personal),
    foto_url = coalesce(p_foto_url, foto_url),
    perfil_aprobado_at = null,
    perfil_aprobado_por = null
  where id = p_employee_id;

  insert into perfil_sociodemografico (
    employee_id, tipo_identificacion, fecha_nacimiento, sexo, estado_civil, grado_escolaridad,
    composicion_familiar, personas_a_cargo, cabeza_familia, estrato_socioeconomico,
    lugar_residencia, barrio, tipo_vivienda, medio_desplazamiento, raza, tipo_sangre,
    conduce, tipo_vehiculo_conduce, anios_experiencia_conduccion,
    talla_camisa, talla_pantalon, talla_calzado, eps, arl, fondo_pension, caja_compensacion,
    updated_at
  ) values (
    p_employee_id,
    p_perfil->>'tipo_identificacion',
    v_fecha_nacimiento,
    p_perfil->>'sexo',
    p_perfil->>'estado_civil',
    p_perfil->>'grado_escolaridad',
    p_perfil->>'composicion_familiar',
    nullif(p_perfil->>'personas_a_cargo', '')::integer,
    coalesce((p_perfil->>'cabeza_familia')::boolean, false),
    p_perfil->>'estrato_socioeconomico',
    p_perfil->>'lugar_residencia',
    p_perfil->>'barrio',
    p_perfil->>'tipo_vivienda',
    p_perfil->>'medio_desplazamiento',
    p_perfil->>'raza',
    p_perfil->>'tipo_sangre',
    coalesce((p_perfil->>'conduce')::boolean, false),
    p_perfil->>'tipo_vehiculo_conduce',
    nullif(p_perfil->>'anios_experiencia_conduccion', '')::integer,
    p_perfil->>'talla_camisa',
    p_perfil->>'talla_pantalon',
    p_perfil->>'talla_calzado',
    p_perfil->>'eps',
    p_perfil->>'arl',
    p_perfil->>'fondo_pension',
    p_perfil->>'caja_compensacion',
    now()
  )
  on conflict (employee_id) do update set
    tipo_identificacion = excluded.tipo_identificacion,
    fecha_nacimiento = excluded.fecha_nacimiento,
    sexo = excluded.sexo,
    estado_civil = excluded.estado_civil,
    grado_escolaridad = excluded.grado_escolaridad,
    composicion_familiar = excluded.composicion_familiar,
    personas_a_cargo = excluded.personas_a_cargo,
    cabeza_familia = excluded.cabeza_familia,
    estrato_socioeconomico = excluded.estrato_socioeconomico,
    lugar_residencia = excluded.lugar_residencia,
    barrio = excluded.barrio,
    tipo_vivienda = excluded.tipo_vivienda,
    medio_desplazamiento = excluded.medio_desplazamiento,
    raza = excluded.raza,
    tipo_sangre = excluded.tipo_sangre,
    conduce = excluded.conduce,
    tipo_vehiculo_conduce = excluded.tipo_vehiculo_conduce,
    anios_experiencia_conduccion = excluded.anios_experiencia_conduccion,
    talla_camisa = excluded.talla_camisa,
    talla_pantalon = excluded.talla_pantalon,
    talla_calzado = excluded.talla_calzado,
    eps = excluded.eps,
    arl = excluded.arl,
    fondo_pension = excluded.fondo_pension,
    caja_compensacion = excluded.caja_compensacion,
    updated_at = now();

  delete from contactos_emergencia where employee_id = p_employee_id;
  insert into contactos_emergencia (employee_id, nombre, parentesco, telefono)
  select p_employee_id, c->>'nombre', c->>'parentesco', c->>'telefono'
  from jsonb_array_elements(coalesce(p_contactos, '[]'::jsonb)) as c
  where coalesce(c->>'nombre', '') <> '';

  delete from hijos_empleado where employee_id = p_employee_id;
  insert into hijos_empleado (employee_id, nombre, fecha_nacimiento, sexo)
  select p_employee_id, h->>'nombre', nullif(h->>'fecha_nacimiento', '')::date, h->>'sexo'
  from jsonb_array_elements(coalesce(p_hijos, '[]'::jsonb)) as h
  where coalesce(h->>'nombre', '') <> '';
end;
$$;

revoke all on function public.perfil_publico_guardar(uuid, text, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.perfil_publico_guardar(uuid, text, jsonb, jsonb, jsonb, text) to anon, authenticated;
