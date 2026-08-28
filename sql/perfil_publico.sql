-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Autodiligenciamiento del perfil por parte del nuevo empleado, via un link
-- publico (sin login) que se le comparte manualmente. El link solo trae el
-- id del empleado; la cedula la escribe la persona y se valida del lado del
-- servidor antes de mostrar o guardar cualquier dato -- por eso estas
-- funciones son "security definer" en vez de dar permisos directos de tabla
-- al rol anon.
--
-- Version ampliada: cubre casi todo el perfil sociodemografico (antes solo
-- pedia nacimiento/sexo/direccion/telefono), mas foto de perfil y contactos
-- de emergencia, con validacion de edad minima (17 anios) del lado del
-- servidor. Reemplaza la version basica anterior de este archivo.
--
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql,
-- perfil_sociodemografico.sql y contactos_hijos_empleado.sql. Seguro de
-- re-ejecutar.
-- ============================================================================

alter table employees add column if not exists telefono text;

-- Aprobacion final del perfil: distinta de "seleccionar" al aspirante
-- (convertirlo en empleado y enviarle el link). El empleado ya tiene todos
-- sus datos autodiligenciados cuando la jefa de Gestion Humana revisa y
-- aprueba desde Seleccion de personal -- eso es lo que queda registrado
-- acá, y es lo que el link publico le muestra a la persona.
alter table employees add column if not exists perfil_aprobado_at timestamptz;
alter table employees add column if not exists perfil_aprobado_por text;

-- Firmas anteriores de estas funciones (version basica) -- se borran antes
-- de recrearlas porque el numero/tipo de parametros cambio, y
-- "create or replace" no reemplaza una funcion si la firma es distinta
-- (dejaria las dos versiones conviviendo, ambiguas para PostgREST).
drop function if exists public.perfil_publico_obtener(uuid, text);
drop function if exists public.perfil_publico_guardar(uuid, text, date, text, text, text, text);

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
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', ce.nombre, 'parentesco', ce.parentesco, 'telefono', ce.telefono) order by ce.created_at)
      from contactos_emergencia ce where ce.employee_id = e.id
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

  -- Cualquier guardado desde el link deja el perfil otra vez pendiente de
  -- aprobación: si ya estaba aprobado y la persona corrige un dato, la
  -- aprobación anterior quedó sobre datos que ya no son los actuales.
  update employees set
    telefono = coalesce(p_perfil->>'telefono', telefono),
    foto_url = coalesce(p_foto_url, foto_url),
    perfil_aprobado_at = null,
    perfil_aprobado_por = null
  where id = p_employee_id;

  insert into perfil_sociodemografico (
    employee_id, tipo_identificacion, fecha_nacimiento, sexo, estado_civil, grado_escolaridad,
    composicion_familiar, personas_a_cargo, cabeza_familia, estrato_socioeconomico,
    lugar_residencia, barrio, tipo_vivienda, medio_desplazamiento, raza, tipo_sangre,
    conduce, tipo_vehiculo_conduce, anios_experiencia_conduccion, updated_at
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
    updated_at = now();

  delete from contactos_emergencia where employee_id = p_employee_id;
  insert into contactos_emergencia (employee_id, nombre, parentesco, telefono)
  select p_employee_id, c->>'nombre', c->>'parentesco', c->>'telefono'
  from jsonb_array_elements(coalesce(p_contactos, '[]'::jsonb)) as c
  where coalesce(c->>'nombre', '') <> '';
end;
$$;

revoke all on function public.perfil_publico_guardar(uuid, text, jsonb, jsonb, text) from public;
grant execute on function public.perfil_publico_guardar(uuid, text, jsonb, jsonb, text) to anon, authenticated;

-- Deja que el link publico (rol anon, sin sesion) suba/reemplace SOLO la
-- foto de perfil del empleado del link, y unicamente bajo esta ruta fija
-- ("perfil-publico/<id-del-empleado>.jpg", una foto por empleado). No
-- depende de la cedula -- las policies de Storage no tienen forma de
-- validarla, solo pueden mirar la ruta del archivo -- pero exige que exista
-- un empleado con exactamente ese id, y aunque suban el archivo, no queda
-- como LA foto oficial del empleado (employees.foto_url) hasta que
-- perfil_publico_guardar() la registre, y esa funcion si valida la cedula.
-- A proposito no se da permiso de lectura (select) a anon sobre este bucket:
-- así nadie puede listar ni ver la foto de otro empleado con solo la anon
-- key, aunque sepa o adivine su id.
drop policy if exists "anon_insert_foto_perfil_publico" on storage.objects;
create policy "anon_insert_foto_perfil_publico" on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'fotos-empleados'
    and exists (select 1 from employees e where name = 'perfil-publico/' || e.id::text || '.jpg')
  );

drop policy if exists "anon_update_foto_perfil_publico" on storage.objects;
create policy "anon_update_foto_perfil_publico" on storage.objects
  for update
  to anon
  using (bucket_id = 'fotos-empleados' and name like 'perfil-publico/%')
  with check (
    bucket_id = 'fotos-empleados'
    and exists (select 1 from employees e where name = 'perfil-publico/' || e.id::text || '.jpg')
  );
