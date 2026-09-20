-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Conecta la tabla parque_automotor (creada directo en el dashboard de
-- Supabase, con los datos de la flota: placa, interno, estado y fechas de
-- vencimiento de SOAT/gases/tecnomecanica/tarjeta de operacion) al mismo
-- esquema de permisos granulares por modulo que ya usan las demas tablas de
-- Kardex (ver sql/permisos_granulares_2026-09-16.sql), para el modulo nuevo
-- "Parque automotor" (vencimientos y alertas).
--
-- Hallazgo de seguridad de paso: la tabla ya tenia RLS activo, pero con una
-- sola policy de solo lectura abierta a "authenticated" sin ninguna otra
-- condicion. En este proyecto de Supabase compartido (ver memoria
-- "Ecosistema Sonar en Supabase") eso significa que CUALQUIER cuenta con
-- sesion valida en cualquiera de los otros programas (Sonar, BUK, etc.),
-- no solo las cuentas autorizadas de Kardex, podia leer el parque
-- automotor completo. Se reemplaza por el mismo patron
-- kardex_is_authorized()/kardex_tiene_permiso() de siempre.
--
-- Repetible sin riesgo.
-- ============================================================================

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'permisos-vacaciones', 'siniestros-transito', 'parque-automotor'
  ));

drop policy if exists "parque_automotor lectura autenticados" on parque_automotor;

create policy "permiso_ver_parque_automotor" on parque_automotor for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_tiene_permiso('parque-automotor', 'ver')
  ));
