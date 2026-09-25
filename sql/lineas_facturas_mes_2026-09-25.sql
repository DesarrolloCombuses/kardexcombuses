-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Registro mensual de la factura de lineas celulares.
--
-- El mes nuevo NO se digita en blanco. En los datos reales casi todas las
-- lineas facturan exactamente lo mismo mes a mes (un mismo valor se repite en
-- 30 de las 40), asi que crear el periodo copiando el anterior y dejar que
-- contabilidad corrija solo lo que cambio convierte "digitar 40 renglones" en
-- "revisar 40 y tocar tres". Sin esto el modulo no se usa.
--
-- Es funcion y no varios inserts desde el navegador porque son N+1
-- escrituras que tienen que pasar juntas: si se cae a la mitad queda una
-- factura con medio detalle, que es peor que no tenerla.
--
-- Seguro de re-ejecutar.
-- ============================================================================

create or replace function kardex_linea_factura_crear(
  p_contrato text,
  p_periodo date,
  p_fecha_factura date default null,
  p_fecha_vencimiento date default null,
  p_copiar boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_previo uuid;
  v_filas int;
begin
  if p_periodo is null then
    raise exception 'Hay que decir de que mes es la factura.';
  end if;

  -- Siempre el primer dia del mes: asi dos capturas del mismo mes chocan
  -- contra el indice unico en vez de crear dos facturas paralelas.
  p_periodo := date_trunc('month', p_periodo)::date;

  if exists (select 1 from kardex_lineas_facturas
             where coalesce(contrato_numero, '') = coalesce(p_contrato, '')
               and periodo = p_periodo) then
    raise exception 'Ese mes ya esta registrado para este contrato.';
  end if;

  insert into kardex_lineas_facturas (contrato_numero, periodo, fecha_factura, fecha_vencimiento_pago)
  values (p_contrato, p_periodo, p_fecha_factura, p_fecha_vencimiento)
  returning id into v_id;

  if not p_copiar then
    return v_id;
  end if;

  -- El mes anterior mas reciente de ESTE contrato (no necesariamente el mes
  -- inmediatamente anterior: puede haber huecos si algun mes no se registro).
  select id into v_previo
  from kardex_lineas_facturas
  where coalesce(contrato_numero, '') = coalesce(p_contrato, '')
    and periodo < p_periodo
  order by periodo desc
  limit 1;

  if v_previo is not null then
    -- Se copian solo las lineas que siguen sin cancelar: una linea dada de
    -- baja el mes pasado no deberia reaparecer facturando este mes.
    insert into kardex_lineas_factura_detalle (
      factura_id, linea_numero, cargo_basico, iva, cargos, descuentos,
      total_antes_impuestos, impoconsumo, iva_consumo, total)
    select v_id, d.linea_numero, d.cargo_basico, d.iva, d.cargos, d.descuentos,
           d.total_antes_impuestos, d.impoconsumo, d.iva_consumo, d.total
    from kardex_lineas_factura_detalle d
    where d.factura_id = v_previo
      and not exists (select 1 from kardex_lineas l
                      where l.numero = d.linea_numero and l.estado = 'cancelada');
    get diagnostics v_filas = row_count;
  else
    v_filas := 0;
  end if;

  -- Primer mes de un contrato (o el anterior quedo vacio): se siembra con las
  -- lineas activas de ese contrato y su cargo basico, para que igual haya de
  -- donde partir en vez de una tabla en blanco.
  if v_filas = 0 then
    insert into kardex_lineas_factura_detalle (factura_id, linea_numero, cargo_basico, total)
    select v_id, l.numero, l.cargo_basico, l.cargo_basico
    from kardex_lineas l
    where coalesce(l.contrato_numero, '') = coalesce(p_contrato, '')
      and l.estado <> 'cancelada';
  end if;

  -- El total arranca siendo la suma de los renglones. Contabilidad lo
  -- sobreescribe con el de la factura real; la vista avisa si no cuadran.
  update kardex_lineas_facturas
     set total = (select sum(total) from kardex_lineas_factura_detalle where factura_id = v_id)
   where id = v_id;

  return v_id;
end;
$$;

revoke all on function kardex_linea_factura_crear(text, date, date, date, boolean) from public;
grant execute on function kardex_linea_factura_crear(text, date, date, date, boolean) to authenticated;

-- Agregar una linea suelta a una factura ya creada (una que se activo a mitad
-- de mes y por eso no venia en la copia del mes anterior).
create or replace function kardex_linea_factura_agregar_linea(
  p_factura uuid,
  p_linea text,
  p_total numeric default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into kardex_lineas_factura_detalle (factura_id, linea_numero, cargo_basico, total)
  select p_factura, p_linea, l.cargo_basico, coalesce(p_total, l.cargo_basico)
  from kardex_lineas l where l.numero = p_linea
  on conflict (factura_id, linea_numero) do nothing;
end;
$$;

revoke all on function kardex_linea_factura_agregar_linea(uuid, text, numeric) from public;
grant execute on function kardex_linea_factura_agregar_linea(uuid, text, numeric) to authenticated;
