-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Agrega fecha_entrega a kardex_movements: la fecha real de la entrega,
-- elegida por quien registra la salida. Separada de "fecha" (el timestamp
-- de registro que ordena el kardex y que usa Inventario historico junto
-- con stock_resultante para reconstruir el stock a una fecha pasada) para
-- no romper esa reconstruccion si una entrega se registra con retraso.
-- Seguro de re-ejecutar (no-op si la columna ya existe).
-- ============================================================================

alter table kardex_movements add column if not exists fecha_entrega date;
