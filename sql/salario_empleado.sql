-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Salario del empleado. Vive en "employees" -- igual que fecha_salida -- para
-- que no dependa de que el empleado haya llenado su perfil sociodemografico.
--
-- OJO seguridad: este dato NUNCA debe importarse con un script que quede
-- commiteado en este repo (es publico). La carga masiva de salarios reales
-- se hace directo contra produccion con `supabase db query --linked`, sin
-- que ese archivo pase por git. Ver README / conversacion del import.
--
-- No se expone en el link publico de autodiligenciamiento (perfil-publico) --
-- es un dato administrativo interno, no algo que la persona autoreporte.
-- Seguro de re-ejecutar.
-- ============================================================================

alter table employees add column if not exists salario numeric;
