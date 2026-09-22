-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Permite leer kardex_authorized_users (cuentas 'admin'/'viewer', ver
-- sql/rls_solo_autorizados_2026-09-15.sql) desde el propio Kardex, para
-- mostrarlas en Usuarios -- hoy esa tabla no tiene NINGUNA policy (a
-- proposito, "nadie puede leer/escribir esta tabla vía API"), asi que sin
-- esto un admin no tenia forma de VER en pantalla quien mas tiene acceso
-- total (ej. vinculaciones@combuses.com.co) -- solo revisando el codigo.
--
-- Sigue siendo de SOLO LECTURA: agregar o quitar una cuenta de esta lista
-- sigue siendo un cambio de codigo (AUTHORIZED_USERS en js/permissions.js) +
-- SQL (insert en kardex_authorized_users), no algo editable desde la
-- pantalla -- decision explicita del usuario (2026-09-22), no hace falta
-- mas por ahora.
--
-- Repetible sin riesgo.
-- ============================================================================

create or replace function kardex_cuentas_autorizadas()
returns table (email text, rol text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not kardex_is_authorized() then
    raise exception 'No autorizado';
  end if;
  return query select au.email, au.rol from kardex_authorized_users au order by au.rol, au.email;
end;
$$;

revoke all on function kardex_cuentas_autorizadas() from public;
grant execute on function kardex_cuentas_autorizadas() to authenticated;
