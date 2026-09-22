-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- "Mi perfil": deja que un colaborador CON CUENTA edite sus propios datos y
-- suba su foto desde dentro de la app (#/mi-perfil), sin el link publico ni
-- tener que escribir la cedula.
--
-- Por que son envoltorios y no funciones nuevas: el formulario, las
-- validaciones (edad minima 17, tope 90), el guardado del perfil
-- sociodemografico, contactos, hijos y el "vuelve a quedar pendiente de
-- aprobacion" ya estan resueltos en perfil_publico_obtener/guardar. Duplicar
-- esa logica garantizaba que las dos copias se desincronizaran. Lo unico que
-- cambia es COMO se identifica a la persona: alla por cedula, aca por el
-- correo del JWT (kardex_own_employee_id(), ver
-- sql/permisos_vacaciones_2026-09-15.sql).
--
-- OJO con las firmas: las funciones vivas en produccion son las de
-- schema.sql -- (p_cedula text, p_employee_id uuid default null) -- NO las
-- de sql/ampliar_perfil_talla_eps_hijos.sql, que quedaron sobreescritas. Por
-- eso se llaman con notacion nombrada, para que un reordenamiento futuro de
-- los parametros no las haga apuntar al argumento equivocado en silencio.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Leer mi propio perfil
-- ---------------------------------------------------------------------------
create or replace function public.kardex_mi_perfil_obtener()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_cedula text;
begin
  v_id := kardex_own_employee_id();
  if v_id is null then
    raise exception 'Esta cuenta no esta vinculada a ninguna ficha de empleado activa.';
  end if;

  select cedula into v_cedula from employees where id = v_id;

  -- El employee_id se agrega explicitamente: lo necesita el cliente para
  -- subir la foto (la Edge Function subir-foto-perfil-publico lo pide en el
  -- header x-employee-id) y no depender de que la funcion de abajo lo siga
  -- incluyendo en su json.
  return perfil_publico_obtener(p_cedula := v_cedula, p_employee_id := v_id)
         || jsonb_build_object('employee_id', v_id);
end;
$$;

revoke all on function public.kardex_mi_perfil_obtener() from public;
grant execute on function public.kardex_mi_perfil_obtener() to authenticated;

-- ---------------------------------------------------------------------------
-- Guardar mi propio perfil
-- ---------------------------------------------------------------------------
-- p_foto_nueva es un booleano, NO la ruta del archivo, a proposito: la ruta
-- se arma aca con el id que resolvio el servidor. Si se aceptara una ruta
-- del cliente, una cuenta podria dejar su employees.foto_url apuntando al
-- archivo de otra persona (la Edge Function que sube la imagen no exige
-- sesion; ver el comentario de su index.ts).
create or replace function public.kardex_mi_perfil_guardar(
  p_perfil jsonb,
  p_contactos jsonb default '[]'::jsonb,
  p_hijos jsonb default '[]'::jsonb,
  p_foto_nueva boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_cedula text;
begin
  v_id := kardex_own_employee_id();
  if v_id is null then
    raise exception 'Esta cuenta no esta vinculada a ninguna ficha de empleado activa.';
  end if;

  select cedula into v_cedula from employees where id = v_id;

  perform perfil_publico_guardar(
    p_cedula      := v_cedula,
    p_perfil      := p_perfil,
    p_contactos   := coalesce(p_contactos, '[]'::jsonb),
    p_hijos       := coalesce(p_hijos, '[]'::jsonb),
    p_foto_url    := case when p_foto_nueva then 'perfil-publico/' || v_id::text || '.jpg' else null end,
    p_employee_id := v_id
  );
end;
$$;

revoke all on function public.kardex_mi_perfil_guardar(jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.kardex_mi_perfil_guardar(jsonb, jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Mi cumpleanos (para el saludo al entrar a la app)
-- ---------------------------------------------------------------------------
-- Consulta aparte y deliberadamente minima en vez de reusar
-- kardex_mi_perfil_obtener(): esto corre en CADA carga de la app, y el
-- perfil completo trae contactos, hijos y veinte campos mas que el saludo no
-- necesita. Devuelve null si la cuenta no corresponde a un empleado activo
-- (cuentas administrativas como administrador@ o desarrollo@), y el cliente
-- simplemente no saluda.
create or replace function public.kardex_mi_cumpleanos()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'employee_id', e.id,
    'nombre', e.nombre,
    'fecha_nacimiento', ps.fecha_nacimiento
  )
  from employees e
  left join perfil_sociodemografico ps on ps.employee_id = e.id
  where e.id = kardex_own_employee_id();
$$;

revoke all on function public.kardex_mi_cumpleanos() from public;
grant execute on function public.kardex_mi_cumpleanos() to authenticated;
