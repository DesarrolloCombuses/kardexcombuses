-- Constancia de quién restableció la contraseña de una cuenta de empleado.
--
-- Contexto: desde Usuarios se puede generar una contraseña nueva para la
-- cuenta de acceso de un empleado (Edge Function kardex-reset-password).
-- Cambiarle la clave a otra persona es una acción sensible y no puede
-- quedar sin rastro.
--
-- Esto NO es obligatorio para que el botón funcione: la función escribe
-- estas dos columnas al final y, si no existen, igual devuelve la
-- contraseña nueva y la pantalla avisa que no quedó constancia. Corre este
-- archivo para que quede.
--
-- Es aditivo: agrega dos columnas que admiten nulo a una tabla que ya
-- existe. No cambia ninguna política, ningún permiso y ninguna fila. No
-- toca nada del otro programa que vive en este mismo proyecto de Supabase.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'kardex_empleado_grupos'
  ) then
    raise exception 'No existe la tabla kardex_empleado_grupos: este archivo no es para esta base.';
  end if;
end $$;

alter table kardex_empleado_grupos
  add column if not exists password_reset_at timestamptz,
  add column if not exists password_reset_por_email text;

comment on column kardex_empleado_grupos.password_reset_at is
  'Cuándo se restableció por última vez la contraseña de esta cuenta desde el módulo Usuarios.';
comment on column kardex_empleado_grupos.password_reset_por_email is
  'Qué administrador la restableció.';

-- Comprobación: debe devolver las dos columnas.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'kardex_empleado_grupos'
  and column_name in ('password_reset_at', 'password_reset_por_email')
order by column_name;

-- ---------------------------------------------------------------------
-- PARA DESHACERLO
-- ---------------------------------------------------------------------
-- Borra la constancia junto con las columnas, así que solo tiene sentido
-- si se decide no usar el botón de restablecer:
--
--   alter table kardex_empleado_grupos
--     drop column if exists password_reset_at,
--     drop column if exists password_reset_por_email;
