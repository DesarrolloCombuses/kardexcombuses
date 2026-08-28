-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Vincula cada entrada con la factura/soporte de compra de la que salio
-- (tabla facturas, ver sql/facturas.sql -- debe existir antes de correr este
-- script). Antes no habia forma de relacionarlas y el numero de factura se
-- anotaba a mano en observaciones, lo que no permitia identificar de forma
-- confiable a que factura correspondia cada entrada.
-- Nullable: no toda entrada viene de una factura (ej. alta de prenda/talla
-- nueva en el catalogo, o el inventario inicial). Solo se usa en entradas --
-- no se valida por check porque una salida jamas la usa.
-- Seguro de re-ejecutar (no-op si la columna ya existe).
-- ============================================================================

alter table kardex_movements add column if not exists factura_id uuid references facturas(id);

create index if not exists idx_movements_factura on kardex_movements(factura_id);
