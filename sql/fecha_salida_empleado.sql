-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Fecha de salida del empleado (cuando aplica). Vive en "employees" -- igual
-- que "activo" -- y no en perfil_sociodemografico, porque no depende de que
-- el empleado haya llenado su perfil (un empleado inactivo/retirado puede
-- no tener perfil_sociodemografico en absoluto).
-- Seguro de re-ejecutar.
-- ============================================================================

alter table employees add column if not exists fecha_salida date;
