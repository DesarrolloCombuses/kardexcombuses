-- Nota interna opcional por empleado, para casos que quedan pendientes de
-- confirmar con alguien externo (ej. gestion humana / BUK) antes de poder
-- decidir algo en Kardex -- como los 2 casos de posible reingreso detectados
-- al depurar empleados duplicados el 2026-09-18/20 (ver
-- columnas_ocultas_empleados_kardex.md en memoria para el contexto de los
-- duplicados). Vacio/null = sin nada pendiente (la inmensa mayoria).
alter table employees add column if not exists revision_pendiente text;
