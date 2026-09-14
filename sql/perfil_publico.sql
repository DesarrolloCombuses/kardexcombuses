-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Autodiligenciamiento del perfil, via un link publico (sin login) que se
-- comparte con la persona. La cedula la escribe la persona y se valida del
-- lado del servidor antes de mostrar o guardar cualquier dato -- por eso
-- estas funciones son "security definer" en vez de dar permisos directos de
-- tabla al rol anon.
--
-- Dos formas de llegar al mismo formulario:
--  1) Link personalizado con "?id=<employee_id>" (el que genera Seleccion de
--     personal para un aspirante recien convertido en empleado): exige que
--     coincidan el id Y la cedula.
--  2) Link generico sin parametros (el que se comparte a toda la planta para
--     que actualice sus datos): solo pide la cedula, y solo encuentra
--     empleados ACTIVOS -- a alguien retirado no le corresponde autoeditar
--     su ficha por este medio.
-- p_employee_id es opcional en las dos funciones: si no llega, se resuelve
-- por cedula (flujo 2); si llega, debe coincidir con la cedula (flujo 1).
--
-- Version ampliada: cubre casi todo el perfil sociodemografico (tipo de
-- identificacion, vivienda, familia, grupo etnico, salud, etc.), foto de
-- perfil, contactos de emergencia e hijos, talla de dotacion, afiliaciones
-- (EPS/ARL/pension/caja de compensacion), correo personal y una auditoria de
-- cambios (perfil_publico_auditoria): cada vez que alguien guarda desde este
-- link, se registra campo por campo qué tenía antes y qué quedó ahora, para
-- que Gestion Humana pueda revisar qué cambió (o qué se llenó por primera
-- vez) sin tener que comparar a ojo. Reemplaza versiones anteriores (mas
-- basicas) de este archivo.
--
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql,
-- perfil_sociodemografico.sql y contactos_hijos_empleado.sql. Seguro de
-- re-ejecutar.
-- ============================================================================

alter table employees add column if not exists telefono text;
alter table employees add column if not exists email_personal text;

-- Aprobacion final del perfil: distinta de "seleccionar" al aspirante
-- (convertirlo en empleado y enviarle el link). El empleado ya tiene todos
-- sus datos autodiligenciados cuando la jefa de Gestion Humana revisa y
-- aprueba desde Seleccion de personal -- eso es lo que queda registrado
-- acá, y es lo que el link publico le muestra a la persona.
alter table employees add column if not exists perfil_aprobado_at timestamptz;
alter table employees add column if not exists perfil_aprobado_por text;

alter table perfil_sociodemografico add column if not exists talla_camisa text;
alter table perfil_sociodemografico add column if not exists talla_pantalon text;
alter table perfil_sociodemografico add column if not exists talla_calzado text;
alter table perfil_sociodemografico add column if not exists eps text;
alter table perfil_sociodemografico add column if not exists arl text;
alter table perfil_sociodemografico add column if not exists fondo_pension text;
alter table perfil_sociodemografico add column if not exists caja_compensacion text;

-- Firmas anteriores de estas funciones -- se borran antes de recrearlas
-- porque el numero/tipo de parametros cambio, y "create or replace" no
-- reemplaza una funcion si la firma es distinta (dejaria varias versiones
-- conviviendo, ambiguas para PostgREST).
drop function if exists public.perfil_publico_obtener(uuid, text);
drop function if exists public.perfil_publico_obtener(text, uuid);
drop function if exists public.perfil_publico_guardar(uuid, text, date, text, text, text, text);
drop function if exists public.perfil_publico_guardar(uuid, text, jsonb, jsonb, text);
drop function if exists public.perfil_publico_guardar(uuid, text, jsonb, jsonb, jsonb, text);
drop function if exists public.perfil_publico_guardar(text, jsonb, jsonb, jsonb, text, uuid);

create table if not exists public.perfil_publico_auditoria (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  cedula text not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  created_at timestamptz not null default now()
);
create index if not exists idx_perfil_publico_auditoria_employee
  on public.perfil_publico_auditoria (employee_id, created_at desc);

alter table public.perfil_publico_auditoria enable row level security;

-- Solo lectura para el personal interno (se ve desde la ficha del empleado
-- en Empleados); nadie tiene permiso de insertar/editar/borrar directo --
-- las unicas filas que se crean nacen dentro de perfil_publico_guardar()
-- (security definer, corre como su dueño y no pasa por RLS).
drop policy if exists "authenticated_select_auditoria_perfil_publico" on public.perfil_publico_auditoria;
create policy "authenticated_select_auditoria_perfil_publico" on public.perfil_publico_auditoria
  for select
  to authenticated
  using (true);

create or replace function public.perfil_publico_obtener(p_cedula text, p_employee_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_result jsonb;
begin
  if p_employee_id is not null then
    select e.id into v_employee_id from employees e
      where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula);
  else
    select e.id into v_employee_id from employees e
      where trim(e.cedula) = trim(p_cedula) and e.activo
      limit 1;
  end if;

  if v_employee_id is null then
    raise exception 'No encontramos un registro con esa cedula para este link.';
  end if;

  select jsonb_build_object(
    'employee_id', e.id,
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
    'direccion_residencia', ps.direccion_residencia,
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
  where e.id = v_employee_id;

  return v_result;
end;
$$;

revoke all on function public.perfil_publico_obtener(text, uuid) from public;
grant execute on function public.perfil_publico_obtener(text, uuid) to anon, authenticated;

create or replace function public.perfil_publico_guardar(
  p_cedula text,
  p_perfil jsonb,
  p_contactos jsonb default '[]'::jsonb,
  p_hijos jsonb default '[]'::jsonb,
  p_foto_url text default null,
  p_employee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_fecha_nacimiento date;
  v_old_telefono text;
  v_old_email text;
  v_old_ps jsonb;
  v_campo text;
  v_old_valor text;
  v_new_valor text;
begin
  if p_employee_id is not null then
    select e.id into v_employee_id from employees e
      where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula);
  else
    select e.id into v_employee_id from employees e
      where trim(e.cedula) = trim(p_cedula) and e.activo
      limit 1;
  end if;

  if v_employee_id is null then
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

  -- Auditoría: se compara contra lo que había ANTES de tocar nada, campo por
  -- campo, y solo se deja constancia de lo que de verdad cambió (o se llenó
  -- por primera vez -- valor_anterior queda en null en ese caso). telefono y
  -- email_personal viven en "employees", el resto en
  -- "perfil_sociodemografico"; por eso se comparan aparte.
  select telefono, email_personal into v_old_telefono, v_old_email
  from employees where id = v_employee_id;

  if p_perfil ? 'telefono' and coalesce(v_old_telefono, '') is distinct from coalesce(p_perfil->>'telefono', '') then
    insert into perfil_publico_auditoria (employee_id, cedula, campo, valor_anterior, valor_nuevo)
    values (v_employee_id, p_cedula, 'telefono', v_old_telefono, p_perfil->>'telefono');
  end if;
  if p_perfil ? 'email_personal' and coalesce(v_old_email, '') is distinct from coalesce(p_perfil->>'email_personal', '') then
    insert into perfil_publico_auditoria (employee_id, cedula, campo, valor_anterior, valor_nuevo)
    values (v_employee_id, p_cedula, 'email_personal', v_old_email, p_perfil->>'email_personal');
  end if;

  select to_jsonb(ps) into v_old_ps from perfil_sociodemografico ps where employee_id = v_employee_id;
  v_old_ps := coalesce(v_old_ps, '{}'::jsonb);

  for v_campo in select jsonb_object_keys(p_perfil) loop
    if v_campo in ('telefono', 'email_personal') then continue; end if;
    v_old_valor := v_old_ps ->> v_campo;
    v_new_valor := p_perfil ->> v_campo;
    if coalesce(v_old_valor, '') is distinct from coalesce(v_new_valor, '') then
      insert into perfil_publico_auditoria (employee_id, cedula, campo, valor_anterior, valor_nuevo)
      values (v_employee_id, p_cedula, v_campo, v_old_valor, v_new_valor);
    end if;
  end loop;

  -- Cualquier guardado desde el link deja el perfil otra vez pendiente de
  -- aprobación: si ya estaba aprobado y la persona corrige un dato, la
  -- aprobación anterior quedó sobre datos que ya no son los actuales.
  update employees set
    telefono = coalesce(p_perfil->>'telefono', telefono),
    email_personal = coalesce(p_perfil->>'email_personal', email_personal),
    foto_url = coalesce(p_foto_url, foto_url),
    perfil_aprobado_at = null,
    perfil_aprobado_por = null
  where id = v_employee_id;

  insert into perfil_sociodemografico (
    employee_id, tipo_identificacion, fecha_nacimiento, sexo, estado_civil, grado_escolaridad,
    composicion_familiar, personas_a_cargo, cabeza_familia, estrato_socioeconomico,
    lugar_residencia, direccion_residencia, barrio, tipo_vivienda, medio_desplazamiento, raza, tipo_sangre,
    conduce, tipo_vehiculo_conduce, anios_experiencia_conduccion,
    talla_camisa, talla_pantalon, talla_calzado, eps, arl, fondo_pension, caja_compensacion,
    updated_at
  ) values (
    v_employee_id,
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
    p_perfil->>'direccion_residencia',
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
    direccion_residencia = excluded.direccion_residencia,
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

  delete from contactos_emergencia where employee_id = v_employee_id;
  insert into contactos_emergencia (employee_id, nombre, parentesco, telefono)
  select v_employee_id, c->>'nombre', c->>'parentesco', c->>'telefono'
  from jsonb_array_elements(coalesce(p_contactos, '[]'::jsonb)) as c
  where coalesce(c->>'nombre', '') <> '';

  delete from hijos_empleado where employee_id = v_employee_id;
  insert into hijos_empleado (employee_id, nombre, fecha_nacimiento, sexo)
  select v_employee_id, h->>'nombre', nullif(h->>'fecha_nacimiento', '')::date, h->>'sexo'
  from jsonb_array_elements(coalesce(p_hijos, '[]'::jsonb)) as h
  where coalesce(h->>'nombre', '') <> '';
end;
$$;

revoke all on function public.perfil_publico_guardar(text, jsonb, jsonb, jsonb, text, uuid) from public;
grant execute on function public.perfil_publico_guardar(text, jsonb, jsonb, jsonb, text, uuid) to anon, authenticated;

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
