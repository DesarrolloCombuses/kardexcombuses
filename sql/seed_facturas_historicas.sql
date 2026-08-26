-- ============================================================================
-- Kardex de Dotación — Combuses SA
-- Carga las 12 facturas que venían en Libro3.xlsx (de otro sistema, "monte
-- dfacturas"). El archivo PDF/foto de cada una NO está disponible -- solo se
-- rescata el número, la fecha y el nombre que tenía el archivo original,
-- como referencia. Ejecutar en el SQL Editor después de facturas.sql.
--
-- OJO: la fila "FE 226" traía en el Excel la fecha 2016-05-15, muy fuera de
-- rango frente a las demás (todas de 2026) -- probablemente un error de
-- digitación al cargarla en el sistema anterior. Se importa tal cual venía;
-- corrígela luego a mano en la app si la fecha real era otra.
--
-- Este script no vuelve a insertar si ya se corrió antes (usa el número de
-- factura + fecha para no duplicar).
-- ============================================================================

insert into facturas (numero_factura, fecha_remision, archivo_nombre, observaciones)
select v.numero_factura, v.fecha_remision, v.archivo_nombre,
  case when v.observaciones is null or v.observaciones = ''
    then '[Migrado del sistema anterior; archivo no disponible]'
    else v.observaciones || ' [Migrado del sistema anterior; archivo no disponible]'
  end
from (values
  ('FE 175',                 date '2026-01-26', '012e1fb4.FACTURA.214655.pdf', null),
  ('FE 186',                 date '2026-02-19', '9c5f5530.FACTURA.214728.pdf', null),
  ('FE 189',                 date '2026-02-23', '6ccef511.FACTURA.214803.pdf', null),
  ('FE 173',                 date '2026-01-14', '819f2c18.FACTURA.214847.pdf', null),
  ('FE 199',                 date '2026-03-18', 'd2d281f0.FACTURA.150242.pdf', null),
  ('CUENTA DE COBRO GORRAS', date '2026-04-06', '90a565a1.FACTURA.144837.pdf', '60 GORRAS'),
  ('FE 206',                 date '2026-04-08', 'bdea368f.FACTURA.172631.pdf', null),
  ('FE 226',                 date '2016-05-15', 'a4cefe4d.FACTURA.200405.pdf', 'DOTACION NUEVA'),
  ('229',                    date '2026-05-20', 'a84a3b91.FACTURA.133121.pdf', null),
  ('FE',                     date '2026-06-16', 'ce485a16.FACTURA.123250.24.pdf', 'MERCANCIA QUE HABIA PEDIDO JESSICA'),
  ('FE 253',                 date '2026-07-27', '52c4adf2.FACTURA.212044.pdf', 'NUEVO'),
  ('FE22243',                date '2026-07-28', '863ddc26.FACTURA.192439.jpg', null)
) as v(numero_factura, fecha_remision, archivo_nombre, observaciones)
where not exists (
  select 1 from facturas f
  where f.numero_factura = v.numero_factura and f.fecha_remision = v.fecha_remision
);

select count(*) as facturas_historicas_cargadas from facturas
where observaciones like '%Migrado del sistema anterior%';
