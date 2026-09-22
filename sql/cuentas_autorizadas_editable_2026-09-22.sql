-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Deja administrar las cuentas "superadmin" (admin/viewer, kardex_authorized_users)
-- desde la propia pantalla de Usuarios -- hasta ahora (ver
-- sql/cuentas_autorizadas_lectura_2026-09-22.sql) solo se podian VER, dar o
-- quitar el rol admin/viewer seguia siendo un cambio de codigo mio.
--
-- CAMBIO DE ARQUITECTURA IMPORTANTE: hasta ahora esta lista vivia DUPLICADA
-- -- AUTHORIZED_USERS (una constante fija en js/permissions.js, desplegada
-- por git) y esta tabla (kardex_authorized_users). Cambiar solo la tabla no
-- serviria de nada: Permissions.resolveRole() revisaba primero la lista fija
-- del codigo, asi que un cambio hecho unicamente aqui jamas se habria visto
-- reflejado en la app hasta el proximo despliegue. Por eso, junto con esta
-- migracion, js/permissions.js deja de tener esa lista fija y pasa a
-- preguntarle a la base de datos (kardex_mi_rol_autorizado(), de abajo) cada
-- vez que alguien inicia sesion -- la tabla pasa a ser la UNICA fuente de
-- verdad, sin nada que sincronizar a mano nunca mas.
--
-- Salvaguarda: ninguna de las dos funciones de escritura deja que una cuenta
-- se modifique O SE QUITE A SI MISMA -- evita que alguien se bloquee el
-- acceso sin querer a media sesion. Para cambiar tu propia cuenta, otro
-- admin tiene que hacerlo.
--
-- Repetible sin riesgo.
-- ============================================================================

-- 1) Auto-consulta: cada cuenta puede saber su PROPIO rol (o null si no
--    tiene) -- sin chequeo de autorizacion, porque es exactamente lo que
--    resuelve si esta autorizada o no (mismo patron sin gate que
--    kardex_own_employee_id()/kardex_mi_grupo()). Nunca revela el rol de
--    otra cuenta.
create or replace function kardex_mi_rol_autorizado()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select rol from kardex_authorized_users
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

revoke all on function kardex_mi_rol_autorizado() from public;
grant execute on function kardex_mi_rol_autorizado() to authenticated;

-- 2) Dar/cambiar el rol de OTRA cuenta. A diferencia del resto de funciones
--    de escritura de Kardex (que se conforman con kardex_is_authorized(),
--    sin distinguir admin de viewer), esta exige que quien llama sea
--    puntualmente 'admin' -- si no, una cuenta viewer podria darse a sí
--    misma o a un tercero acceso total, una escalada de privilegios que no
--    existía antes de que esta lista fuera editable.
create or replace function kardex_guardar_cuenta_autorizada(p_email text, p_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if coalesce((select rol from kardex_authorized_users where email = v_caller), '') <> 'admin' then
    raise exception 'Solo una cuenta admin puede hacer esto';
  end if;
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El correo no es válido';
  end if;
  if p_rol not in ('admin', 'viewer') then
    raise exception 'Rol inválido';
  end if;
  if v_email = v_caller then
    raise exception 'No puedes cambiar tu propia cuenta desde aquí -- pídele a otro admin que lo haga.';
  end if;

  insert into kardex_authorized_users (email, rol) values (v_email, p_rol)
    on conflict (email) do update set rol = excluded.rol;
end;
$$;

revoke all on function kardex_guardar_cuenta_autorizada(text, text) from public;
grant execute on function kardex_guardar_cuenta_autorizada(text, text) to authenticated;

-- 3) Quitarle el acceso total a OTRA cuenta. Mismo gate estricto (admin,
--    no solo autorizado) y misma protección de no poder auto-quitarse.
--    Ojo: esto NO borra la cuenta de Supabase Auth -- solo deja de estar en
--    esta lista, así que la próxima vez que intente entrar,
--    Auth.requireAuth() la rechaza igual que a cualquier correo no
--    autorizado (ver js/auth.js), pero su login sigue existiendo por si se
--    le vuelve a dar acceso después.
create or replace function kardex_quitar_cuenta_autorizada(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if coalesce((select rol from kardex_authorized_users where email = v_caller), '') <> 'admin' then
    raise exception 'Solo una cuenta admin puede hacer esto';
  end if;
  if v_email = v_caller then
    raise exception 'No puedes quitarte el acceso a ti mismo desde aquí -- pídele a otro admin que lo haga.';
  end if;

  delete from kardex_authorized_users where email = v_email;
end;
$$;

revoke all on function kardex_quitar_cuenta_autorizada(text) from public;
grant execute on function kardex_quitar_cuenta_autorizada(text) to authenticated;
