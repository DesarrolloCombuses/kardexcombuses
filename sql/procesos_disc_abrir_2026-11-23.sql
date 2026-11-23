-- Procesos disciplinarios: se levanta la marcha blanca.
--
-- Desde el 2026-10-07 el modulo lo veia una sola cuenta
-- (desarrollotecnologico@combuses.com.co) porque eran datos disciplinarios a
-- medio revisar, traidos del programa anterior. Ya estan revisados y el
-- modulo esta probado, asi que entra Gestion Humana a usarlo.
--
-- REQUISITO: aplicar ANTES sql/procesos_disc_guardian_2026-11-23.sql. Sin
-- eso, al levantar la marcha blanca el acceso cae en
-- kardex_es_gestion_humana(), que da true tambien a las cuentas viewer, y
-- entrarian facturacion y contabilidad a leer y escribir expedientes
-- disciplinarios. Comprobado cuenta por cuenta antes de correr esto.
--
-- Quien queda adentro despues de esto:
--   - las 3 cuentas admin del ERP (por rol, no por kardex_is_authorized);
--   - quien este en el grupo GESTION HUMANA (hoy: Coordinadora de Gestion
--     Humana y Coordinadora de SST);
--   - quien tenga permiso del modulo para esa accion.
-- Quien queda afuera: las 2 cuentas viewer, y las ~41 cuentas de empleado
-- que existen en el proyecto para "Mi perfil".
--
-- PARA DEVOLVERLO: poner de nuevo el correo en kardex_pd_marcha_blanca() y
-- reponer la vista en VISTAS_EN_MARCHA_BLANCA de js/permissions.js. El
-- guardian corregido no hay que devolverlo: es correcto en los dos modos.
--
-- Aplicar en el SQL Editor de Supabase.

-- null = sin marcha blanca. El case de kardex_pd_autorizado() pasa entonces
-- a la rama de permisos normales, y el trigger trg_pd_guard la sigue.
create or replace function kardex_pd_marcha_blanca()
returns text
language sql
immutable
as $$
  select null::text;
$$;

comment on function kardex_pd_marcha_blanca() is
  'Correo unico que puede ver Procesos disciplinarios mientras el modulo '
  'este en marcha blanca. null = abierto a los permisos normales. Levantada '
  'el 2026-11-23.';

-- El mensaje del trigger hablaba de la marcha blanca; levantada, mentiria.
-- Ahora dice el motivo real por el que alguien puede chocar con el.
create or replace function kardex_pd_guard()
returns trigger
language plpgsql
as $$
declare
  v_accion text := case tg_op
    when 'INSERT' then 'agregar'
    when 'DELETE' then 'borrar'
    else 'editar'
  end;
begin
  if not coalesce(kardex_pd_autorizado(v_accion) or kardex_pd_autorizado('editar'), false) then
    raise exception 'Tu cuenta no tiene permiso para % procesos disciplinarios. Son datos reservados a Gestion Humana.', v_accion
      using errcode = 'insufficient_privilege';
  end if;
  return null;
end;
$$;
