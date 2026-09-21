-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Agrega el modulo nuevo "Alertas de vencimientos" (dashboard de SOAT/
-- tecnomecanica/tarjeta de operacion vencidos o por vencer en 30 dias, ver
-- js/views/alertas-vencimientos.js) al mismo esquema de permisos granulares
-- por modulo que ya usan las demas vistas de Kardex (ver
-- sql/permisos_granulares_2026-09-16.sql). Es un modulo INDEPENDIENTE de
-- 'parque-automotor' en la matriz de permisos -- una cuenta puede tener uno
-- sin el otro.
--
-- A proposito NO se agrega ninguna policy nueva sobre flota_vehiculos ni
-- flota_documentos_estado: esas son tablas/vista del "Portal de Documentos"
-- (programa aparte de los coordinadores de ruta, mismo proyecto de Supabase
-- compartido), y hoy Kardex las lee sin ninguna policy propia de
-- kardex_tiene_permiso() -- el mismo hueco que ya existe para
-- 'parque-automotor' desde sql/parque_automotor_permisos_2026-09-20.sql
-- (que tampoco tiene policy sobre esas tablas, solo sobre parque_automotor,
-- la tabla vieja que ya no se usa). Cerrar ese hueco es una decision aparte,
-- pendiente, que le corresponde a quien administra el Portal de Documentos
-- -- no se toca en esta migracion.
--
-- Repetible sin riesgo.
-- ============================================================================

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'permisos-vacaciones', 'siniestros-transito', 'parque-automotor',
    'alertas-vencimientos'
  ));
