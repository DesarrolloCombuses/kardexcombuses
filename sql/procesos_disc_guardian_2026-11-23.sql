-- Procesos disciplinarios: que el guardian nombre a quien debe entrar.
--
-- PROBLEMA. Al levantar la marcha blanca, kardex_pd_autorizado() cae en
-- kardex_es_gestion_humana(), y esa funcion NO es lo que su nombre dice:
--
--   kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA'
--
-- y kardex_is_authorized() da true para admin Y PARA VIEWER. O sea que al
-- abrir el modulo entrarian tambien las dos cuentas viewer del ERP
-- -- facturacion y contabilidad -- a leer y escribir expedientes
-- disciplinarios completos, con el texto integro de las actas de descargos.
-- Nadie quiso eso: un "viewer" es alguien que mira Kardex, no alguien que
-- lleva procesos disciplinarios.
--
-- Es el mismo error que ya se corrigio para el diagnostico de las
-- incapacidades (sql/incapacidades_registro_2026-11-17.sql): ahi tambien se
-- dejo de usar kardex_es_gestion_humana() y se nombro a la gente a mano.
--
-- SOLUCION. Nombrar explicitamente:
--   - admin POR ROL (kardex_mi_rol_autorizado() = 'admin'), no por
--     kardex_is_authorized(), que no distingue admin de viewer;
--   - quien este en el grupo GESTION HUMANA;
--   - quien tenga permiso del modulo para esa accion.
--
-- No se toca kardex_es_gestion_humana(): la usan otros modulos y cambiarla
-- aqui seria cambiarles el alcance sin querer. Lo que se corrige es quien
-- la llama para esto.
--
-- Esto NO levanta la marcha blanca: mientras kardex_pd_marcha_blanca()
-- devuelva un correo, sigue entrando solo esa cuenta. Esto arregla el
-- camino que se usa DESPUES de levantarla, para que levantarla sea seguro.
--
-- Aplicar en el SQL Editor de Supabase. Gobierna 12 policies.

create or replace function kardex_pd_autorizado(p_accion text)
returns boolean
language sql
stable
as $$
  select case
    when kardex_pd_marcha_blanca() is not null
      then lower(coalesce(auth.jwt() ->> 'email', '')) = lower(kardex_pd_marcha_blanca())
    else coalesce(
      kardex_mi_rol_autorizado() = 'admin'
      or kardex_mi_grupo() = 'GESTION HUMANA'
      or kardex_tiene_permiso('procesos-disciplinarios', p_accion),
      false)
  end;
$$;

comment on function kardex_pd_autorizado(text) is
  'Quien puede tocar los procesos disciplinarios. En marcha blanca, solo el '
  'correo de kardex_pd_marcha_blanca(). Levantada, admin POR ROL + grupo '
  'GESTION HUMANA + permiso del modulo. OJO: no usar aqui '
  'kardex_es_gestion_humana(), que tambien da true a las cuentas viewer.';
