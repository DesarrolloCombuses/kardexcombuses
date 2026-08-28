-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Autodiligenciamiento del perfil basico por parte del nuevo empleado, via
-- un link publico (sin login) que se le comparte manualmente. El link solo
-- trae el id del empleado; la cedula la escribe la persona y se valida del
-- lado del servidor antes de mostrar o guardar cualquier dato -- por eso
-- estas dos funciones son "security definer" (se ejecutan sin pasar por la
-- sesion anonima) en vez de dar permisos directos de tabla al rol anon.
-- Ejecutar en el SQL Editor de Supabase despues de schema.sql y
-- perfil_sociodemografico.sql. Seguro de re-ejecutar.
-- ============================================================================

alter table employees add column if not exists telefono text;

create or replace function public.perfil_publico_obtener(p_employee_id uuid, p_cedula text)
returns table (
  nombre text,
  cargo text,
  area text,
  fecha_ingreso date,
  fecha_nacimiento date,
  sexo text,
  lugar_residencia text,
  barrio text,
  telefono text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from employees e
    where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula)
  ) then
    raise exception 'No encontramos un registro con esa cedula para este link.';
  end if;

  return query
  select e.nombre, e.cargo, e.area, ps.fecha_ingreso, ps.fecha_nacimiento, ps.sexo,
         ps.lugar_residencia, ps.barrio, e.telefono
  from employees e
  left join perfil_sociodemografico ps on ps.employee_id = e.id
  where e.id = p_employee_id;
end;
$$;

revoke all on function public.perfil_publico_obtener(uuid, text) from public;
grant execute on function public.perfil_publico_obtener(uuid, text) to anon, authenticated;

create or replace function public.perfil_publico_guardar(
  p_employee_id uuid,
  p_cedula text,
  p_fecha_nacimiento date,
  p_sexo text,
  p_lugar_residencia text,
  p_barrio text,
  p_telefono text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from employees e
    where e.id = p_employee_id and trim(e.cedula) = trim(p_cedula)
  ) then
    raise exception 'No encontramos un registro con esa cedula para este link.';
  end if;

  update employees set telefono = p_telefono where id = p_employee_id;

  insert into perfil_sociodemografico (employee_id, fecha_nacimiento, sexo, lugar_residencia, barrio, updated_at)
  values (p_employee_id, p_fecha_nacimiento, p_sexo, p_lugar_residencia, p_barrio, now())
  on conflict (employee_id) do update set
    fecha_nacimiento = excluded.fecha_nacimiento,
    sexo = excluded.sexo,
    lugar_residencia = excluded.lugar_residencia,
    barrio = excluded.barrio,
    updated_at = now();
end;
$$;

revoke all on function public.perfil_publico_guardar(uuid, text, date, text, text, text, text) from public;
grant execute on function public.perfil_publico_guardar(uuid, text, date, text, text, text, text) to anon, authenticated;
