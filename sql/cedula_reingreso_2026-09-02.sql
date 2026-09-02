-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Permite reingresos: alguien que ya trabajo en Combuses (registro inactivo)
-- puede volver a vincularse como un empleado NUEVO, sin tocar su historial
-- anterior. Antes employees.cedula era unique a secas, asi que la cedula
-- del registro viejo (inactivo) bloqueaba crear uno nuevo con un
-- "duplicate key value violates unique constraint employees_cedula_key".
--
-- La regla real de negocio no es "la cedula es unica siempre" -- es "no
-- puede haber DOS empleados ACTIVOS con la misma cedula al mismo tiempo".
-- Varios registros inactivos con la misma cedula (una fila por cada paso
-- por la empresa) son validos.
-- ============================================================================

alter table employees drop constraint if exists employees_cedula_key;

create unique index if not exists employees_cedula_activo_unique
  on employees (cedula)
  where activo = true;
