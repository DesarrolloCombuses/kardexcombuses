-- Módulo "Usuarios": el admin crea cuentas de acceso para empleados (alias +
-- grupo) desde el propio ERP, en vez de hacerlo a mano en el dashboard de
-- Supabase. Por ahora el único grupo con capacidad especial es GESTION
-- HUMANA, que puede aprobar/rechazar permisos de cualquier empleado (misma
-- paridad que hoy tienen kardex@/vinculaciones@). Los otros 5 grupos quedan
-- como dato organizativo, sin abrir módulos nuevos todavía.
--
-- Repetible sin riesgo (create table/function usan if not exists / or
-- replace; los alter policy solo cambian la condición, no la crean).

create table if not exists kardex_empleado_grupos (
  employee_id uuid primary key references employees(id),
  grupo text not null check (grupo in (
    'CONTABILIDAD', 'DIRECCION ADMINISTRATIVA', 'OPERACIONES',
    'GESTION Y CONTROL DE FLOTA', 'GESTION HUMANA', 'DESARROLLO TECNOLOGICO'
  )),
  alias text not null,
  creado_por_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table kardex_empleado_grupos enable row level security;

drop policy if exists "admin_all" on kardex_empleado_grupos;
create policy "admin_all" on kardex_empleado_grupos
  for all using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

-- ---------------------------------------------------------------------------
-- Grupo del empleado autenticado (o null), y si puede aprobar permisos:
-- kardex_is_authorized() (admin/viewer de siempre) o grupo GESTION HUMANA.
-- kardex_authorized_users / kardex_is_authorized() no se tocan.
-- ---------------------------------------------------------------------------

create or replace function kardex_mi_grupo()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select grupo from kardex_empleado_grupos where employee_id = kardex_own_employee_id();
$$;

revoke all on function kardex_mi_grupo() from public;
grant execute on function kardex_mi_grupo() to authenticated;

create or replace function kardex_puede_aprobar_permisos()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA';
$$;

revoke all on function kardex_puede_aprobar_permisos() from public;
grant execute on function kardex_puede_aprobar_permisos() to authenticated;

-- ---------------------------------------------------------------------------
-- permisos_solicitudes: el gate de "admin" pasa de kardex_is_authorized() a
-- kardex_puede_aprobar_permisos() (superconjunto: sigue siendo true para
-- admin/viewer, y ahora también para GESTION HUMANA).
-- ---------------------------------------------------------------------------

alter policy "select_propio_o_admin" on permisos_solicitudes
  using (
    auth.role() = 'authenticated' and (kardex_puede_aprobar_permisos() or employee_id = kardex_own_employee_id())
  );

alter policy "insert_propio_o_admin" on permisos_solicitudes
  with check (
    auth.role() = 'authenticated' and (
      kardex_puede_aprobar_permisos()
      or (employee_id = kardex_own_employee_id() and estado = 'Pendiente' and aprobado_por is null)
    )
  );

alter policy "update_solo_admin" on permisos_solicitudes
  using (auth.role() = 'authenticated' and kardex_puede_aprobar_permisos())
  with check (auth.role() = 'authenticated' and kardex_puede_aprobar_permisos());

alter policy "rw_permisos_soportes" on storage.objects
  using (
    bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and (
      kardex_puede_aprobar_permisos() or (storage.foldername(name))[1] = kardex_own_employee_id()::text
    )
  )
  with check (
    bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and (
      kardex_puede_aprobar_permisos() or (storage.foldername(name))[1] = kardex_own_employee_id()::text
    )
  );
