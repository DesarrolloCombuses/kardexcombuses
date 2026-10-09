-- ============================================================================
-- Kardex / ERP Combuses -- Mantenimiento: preoperacionales de rutas urbanas
--
-- Complemento de mantenimiento_sicov_2026-10-09.sql. Correr DESPUES de ese.
--
-- La tabla `preoperacionales` es del checklist urbano (Zamora y Aranjuez -
-- Guadalupe), que llenan los conductores desde el link publico y los
-- coordinadores desde el portal de rutas. Es un sistema distinto del de
-- SICOV: otro formulario, otros items y otra escala de estado
-- (OK / ALERTA / CRITICO en vez de OK / CON_NOVEDAD).
--
-- Este archivo NO toca ese modelo. Solo abre la LECTURA para el ERP.
--
-- OJO, SON DOS COSAS Y NO UNA
-- La migracion 20261008120000_cerrar_permisos_documentos.sql de ese proyecto
-- hizo dos cierres sobre esta tabla:
--   1. alter table ... enable row level security   (sin ninguna policy)
--   2. revoke all on public.preoperacionales from anon, authenticated
-- El segundo es un permiso de TABLA, anterior a RLS. Con solo crear la policy
-- la consulta seguiria fallando con "permission denied for table
-- preoperacionales", porque el grant no esta. Hay que devolver el select y
-- ademas escribir la policy.
--
-- Se devuelve unicamente select. Insert/update/delete siguen revocados: esos
-- registros nacen por las edge functions, que validan la placa contra la
-- flota, los valores contra la lista permitida y calculan el estado_general
-- en el servidor.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- Permiso de tabla (lo que el revoke quito) y nada mas.
grant select on public.preoperacionales to authenticated;

-- Y la policy, con la misma puerta que el resto del modulo.
drop policy if exists kardex_mtto_preoperacionales_sel on public.preoperacionales;
create policy kardex_mtto_preoperacionales_sel
  on public.preoperacionales
  for select
  to authenticated
  using (kardex_mtto_puede_ver());

-- ---------------------------------------------------------------------------
-- Para comprobar como quedo (desde una cuenta con sesion):
--   select count(*) from preoperacionales;
--   select ruta, estado_general, count(*) from preoperacionales
--     group by 1, 2 order by 1, 2;
--
-- Y desde fuera, sin sesion, con la llave publica: debe responder
-- "permission denied" o una lista vacia, nunca datos.
-- ---------------------------------------------------------------------------
