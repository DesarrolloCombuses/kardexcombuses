-- ============================================================================
-- Kardex de Dotación -- Combuses SA
-- Dos campos nuevos que aparecieron al comparar la hoja maestra de RRHH
-- contra la base de datos:
--
-- motivo_renuncia: vive en "employees" -- igual que fecha_salida -- y no en
-- perfil_sociodemografico, porque no depende de que el empleado haya
-- llenado su perfil (uno inactivo/retirado puede no tener
-- perfil_sociodemografico en absoluto). Solo aplica cuando activo = false.
--
-- direccion_residencia: vive en perfil_sociodemografico junto con
-- lugar_residencia (municipio) y barrio -- es la dirección completa,
-- un dato distinto que la hoja de RRHH sí trae por separado.
-- ============================================================================

alter table employees add column if not exists motivo_renuncia text;
alter table perfil_sociodemografico add column if not exists direccion_residencia text;
