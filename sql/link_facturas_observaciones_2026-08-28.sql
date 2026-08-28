-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Vincula las entradas viejas (de antes de que existiera factura_id, ver
-- sql/add_factura_entrada.sql) cuyo numero de factura se habia anotado a
-- mano en Observaciones, en vez de dejarlo sin identificar.
--
-- Solo vincula cuando el texto de Observaciones coincide EXACTO (ignorando
-- mayusculas/minusculas y espacios de mas) con el numero de una factura ya
-- registrada -- a proposito conservador, para no vincular por error una
-- entrada con la factura equivocada. Observaciones NO se borra: queda
-- igual, solo se completa factura_id.
--
-- Seguro de re-ejecutar: nunca toca una entrada que ya tenga factura_id.
-- ============================================================================

update kardex_movements m
set factura_id = f.id
from facturas f
where m.tipo = 'entrada'
  and m.factura_id is null
  and m.observaciones is not null
  and trim(lower(m.observaciones)) = trim(lower(f.numero_factura));

-- Resumen: cuántas entradas quedaron vinculadas vs. cuántas con
-- observaciones que NO se pudieron cruzar automático (para revisarlas a
-- mano si hace falta -- puede ser que el texto tenga algo más que el
-- número, ej. "factura FE268" en vez de "FE268").
select
  count(*) filter (where tipo = 'entrada') as total_entradas,
  count(*) filter (where tipo = 'entrada' and factura_id is not null) as con_factura,
  count(*) filter (where tipo = 'entrada' and factura_id is null and observaciones is not null) as con_observacion_sin_vincular
from kardex_movements;
