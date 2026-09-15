-- Módulo "Permisos y vacaciones": los empleados piden permisos/vacaciones
-- autenticados con su correo personal, y los administradores de Kardex
-- (kardex@/vinculaciones@) los aprueban o rechazan desde el ERP.
--
-- Repetible sin riesgo (create table/function usan if not exists / or
-- replace, create policy no -- si se repite hay que dropear antes).

create table if not exists permisos_solicitudes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  tipo_permiso text not null check (tipo_permiso in (
    'Citas Médicas EPS', 'Luto', 'Calamidad Doméstica', 'Maternidad', 'Paternidad',
    'Compensatorio', 'Día de la Familia', 'Estudio', 'Jurado de votación',
    'Ejercer el derecho al voto', 'Matrimonio', 'Personales/Otros (No remunerados)'
  )),
  fecha_hora_inicio timestamptz not null,
  fecha_hora_fin timestamptz not null,
  motivo text,
  requiere_reposicion boolean not null default false,
  reemplazo_employee_id uuid references employees(id),
  soporte_url text,
  soporte_nombre text,
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Aprobado', 'Rechazado')),
  motivo_rechazo text,
  aprobado_por text,
  aprobado_en timestamptz,
  creado_por_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permisos_fecha_fin_posterior check (fecha_hora_fin > fecha_hora_inicio),
  constraint permisos_reemplazo_si_requiere check (not requiere_reposicion or reemplazo_employee_id is not null)
);

create index if not exists idx_permisos_employee on permisos_solicitudes(employee_id);
create index if not exists idx_permisos_estado on permisos_solicitudes(estado);

-- ---------------------------------------------------------------------------
-- Funciones security definer: le dan a un empleado autenticado con su correo
-- personal acceso a una porción mínima y no sensible de "employees" (su
-- propia fila y un directorio liviano para elegir reemplazo), sin abrir la
-- tabla completa -- esa sigue protegida solo para kardex_is_authorized().
-- ---------------------------------------------------------------------------

create or replace function kardex_own_employee_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from employees
  where activo = true and lower(email_personal) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

revoke all on function kardex_own_employee_id() from public;
grant execute on function kardex_own_employee_id() to authenticated;

create or replace function kardex_mi_empleado()
returns table (id uuid, nombre text, cedula text, cargo text, area text)
language sql
security definer
set search_path = public
stable
as $$
  select id, nombre, cedula, cargo, area from employees where id = kardex_own_employee_id();
$$;

revoke all on function kardex_mi_empleado() from public;
grant execute on function kardex_mi_empleado() to authenticated;

create or replace function kardex_directorio_empleados()
returns table (id uuid, nombre text, cedula text, cargo text, area text)
language sql
security definer
set search_path = public
stable
as $$
  select id, nombre, cedula, cargo, area from employees where activo = true;
$$;

revoke all on function kardex_directorio_empleados() from public;
grant execute on function kardex_directorio_empleados() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS de permisos_solicitudes
-- ---------------------------------------------------------------------------

alter table permisos_solicitudes enable row level security;

create policy "select_propio_o_admin" on permisos_solicitudes
  for select using (
    auth.role() = 'authenticated' and (kardex_is_authorized() or employee_id = kardex_own_employee_id())
  );

-- Un empleado solo puede insertar su propia solicitud, y solo ya nacida en
-- Pendiente sin aprobador -- defensa extra por si alguien llama la API
-- directo con su propia sesión e intenta insertar una fila ya "Aprobada".
create policy "insert_propio_o_admin" on permisos_solicitudes
  for insert with check (
    auth.role() = 'authenticated' and (
      kardex_is_authorized()
      or (employee_id = kardex_own_employee_id() and estado = 'Pendiente' and aprobado_por is null)
    )
  );

-- Solo el admin aprueba/rechaza/corrige -- el empleado no tiene policy de
-- update, no puede tocar su propia solicitud una vez creada.
create policy "update_solo_admin" on permisos_solicitudes
  for update using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

-- ---------------------------------------------------------------------------
-- Storage: soportes adjuntos (incapacidades, etc.). A diferencia de los
-- demás buckets de Kardex, acá el empleado sube directo desde su propia
-- sesión, así que se aísla por carpeta ({employee_id}/archivo.ext).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('permisos-soportes', 'permisos-soportes', false)
on conflict (id) do nothing;

create policy "rw_permisos_soportes" on storage.objects for all
  using (
    bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and (
      kardex_is_authorized() or (storage.foldername(name))[1] = kardex_own_employee_id()::text
    )
  )
  with check (
    bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and (
      kardex_is_authorized() or (storage.foldername(name))[1] = kardex_own_employee_id()::text
    )
  );
