-- Complemento a sql/columnas_ocultas_empleados_2026-09-18.sql: además de
-- qué columnas puede ver una cuenta, el admin puede marcarle que SOLO vea
-- empleados activos -- nunca inactivos/retirados, sin importar qué filtro
-- use en pantalla (ni pidiendo "Todos" desde el buscador). Mismo criterio
-- que las columnas ocultas: presencia de fila = restringido, tabla vacía
-- hoy = nadie tiene esto activado, cero cambio de comportamiento. Bloqueo
-- real en el servidor: kardex_empleados_con_perfil() ignora lo que pida el
-- cliente y fuerza "solo activos" si esta cuenta está marcada.
--
-- Repetible sin riesgo (create table usa if not exists; create policy se
-- dropea antes; create or replace en la función).

create table if not exists kardex_restriccion_activos_empleados (
  employee_id uuid primary key references employees(id),
  creado_por_email text not null,
  created_at timestamptz not null default now()
);

alter table kardex_restriccion_activos_empleados enable row level security;

drop policy if exists "admin_all" on kardex_restriccion_activos_empleados;
create policy "admin_all" on kardex_restriccion_activos_empleados
  for all using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

create or replace function kardex_empleados_con_perfil(
  p_only_active boolean default true,
  p_limit int default 1000,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ocultos text[];
  v_empleados jsonb;
  v_solo_activos boolean;
begin
  if not coalesce(
    kardex_es_gestion_humana()
    or kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver'),
    false
  ) then
    raise exception 'No autorizado';
  end if;

  select exists(
    select 1 from kardex_restriccion_activos_empleados where employee_id = kardex_own_employee_id()
  ) into v_solo_activos;
  if v_solo_activos then
    p_only_active := true;
  end if;

  select coalesce(array_agg(campo), '{}') into v_ocultos
  from kardex_columnas_ocultas_empleados
  where employee_id = kardex_own_employee_id();

  select coalesce(jsonb_agg(fila), '[]'::jsonb) into v_empleados
  from (
    select
      (to_jsonb(e) - v_ocultos)
        || jsonb_build_object(
             'perfil_sociodemografico',
             case when ps.employee_id is null then null else to_jsonb(ps) - v_ocultos end
           )
        || (case when 'contactos_emergencia' = any(v_ocultos) then '{}'::jsonb
             else jsonb_build_object('contactos_emergencia', coalesce(ce.arr, '[]'::jsonb)) end)
        || (case when 'hijos_empleado' = any(v_ocultos) then '{}'::jsonb
             else jsonb_build_object('hijos_empleado', coalesce(he.arr, '[]'::jsonb)) end)
      as fila
    from employees e
    left join perfil_sociodemografico ps on ps.employee_id = e.id
    left join lateral (
      select jsonb_agg(to_jsonb(c)) as arr from contactos_emergencia c where c.employee_id = e.id
    ) ce on true
    left join lateral (
      select jsonb_agg(to_jsonb(h)) as arr from hijos_empleado h where h.employee_id = e.id
    ) he on true
    where (not p_only_active or e.activo)
    order by e.nombre
    limit p_limit offset p_offset
  ) sub;

  return jsonb_build_object('empleados', v_empleados, 'campos_ocultos', to_jsonb(v_ocultos));
end;
$$;

revoke all on function kardex_empleados_con_perfil(boolean, int, int) from public;
grant execute on function kardex_empleados_con_perfil(boolean, int, int) to authenticated;
