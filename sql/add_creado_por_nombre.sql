-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Guarda el nombre de quien registra cada movimiento directo en
-- kardex_movements (ver DB.getMyDisplayName en js/db.js), en vez de
-- depender solo de created_by + profiles.full_name. Esa tabla es
-- compartida con otro sistema y, si no tiene el nombre lleno, el Excel de
-- Historial mostraba "Usuario" para todos -- sin poder identificar quien
-- hizo cada entrada o salida. El respaldo al correo de la sesion garantiza
-- que siempre quede algo identificable.
-- Seguro de re-ejecutar (no-op si la columna ya existe).
-- ============================================================================

alter table kardex_movements add column if not exists creado_por_nombre text;
