-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- El inventario inicial (sql/seed_dotacion_javier.sql) escribio el stock
-- directo en item_variants.stock_actual, sin pasar por kardex_movements.
-- Eso significa que esas unidades no quedaron registradas como una entrada
-- en el Historial -- el stock "aparecia de la nada" en vez de tener un
-- movimiento que lo explique. Este script corrige eso, registrando todo el
-- inventario inicial como UNA entrada real (fecha = cuando se cargo el
-- inventario), para que quede trazado igual que cualquier otro movimiento.
--
-- De aqui en adelante no hace falta correr esto de nuevo: toda entrada
-- (vista "Entrada") y toda salida (vista "Entrega") ya pasan por
-- kardex_movements automaticamente.
--
-- Es seguro de re-ejecutar: si ya existe la entrada de "Inventario inicial"
-- no la vuelve a crear.
--
-- Como puede que ya se hayan registrado movimientos reales (o de prueba)
-- despues de la carga inicial, la cantidad de esta entrada para cada prenda
-- se calcula asi:
--   cantidad_inicial = stock_actual_de_hoy - efecto_neto_de_movimientos_ya_existentes
-- Esto se calcula en el momento de correr el script, con los datos reales
-- de la base -- no depende de numeros fijos de antemano.
-- ============================================================================

do $$
declare
  v_ya_existe boolean;
  v_movement_id uuid;
  v_omitidas integer;
begin
  select exists(
    select 1 from kardex_movements
    where tipo = 'entrada'
      and observaciones = 'Inventario inicial (carga desde DOTACION JAVIER.csv)'
  ) into v_ya_existe;

  if v_ya_existe then
    raise notice 'La entrada de inventario inicial ya existe -- no se crea de nuevo.';
    return;
  end if;

  insert into kardex_movements (tipo, fecha, observaciones)
  values (
    'entrada',
    coalesce((select min(created_at) from item_variants), now()),
    'Inventario inicial (carga desde DOTACION JAVIER.csv)'
  )
  returning id into v_movement_id;

  -- Se desactiva el trigger de stock solo para este backfill: estas líneas
  -- describen un movimiento que ya ocurrió en el pasado (la carga inicial),
  -- no representan un cambio de stock nuevo -- item_variants.stock_actual
  -- ya refleja el valor correcto de hoy y no debe tocarse.
  alter table kardex_movement_items disable trigger trg_apply_kardex_movement_item;

  with efecto_neto as (
    select
      mi.item_variant_id,
      sum(case when m.tipo = 'entrada' then mi.cantidad else -mi.cantidad end) as neto
    from kardex_movement_items mi
    join kardex_movements m on m.id = mi.movement_id
    where m.anulado = false
    group by mi.item_variant_id
  ),
  a_insertar as (
    select
      v.id as item_variant_id,
      v.stock_actual - coalesce(en.neto, 0) as cantidad_inicial
    from item_variants v
    left join efecto_neto en on en.item_variant_id = v.id
  )
  insert into kardex_movement_items (movement_id, item_variant_id, cantidad, stock_resultante)
  select v_movement_id, item_variant_id, cantidad_inicial, cantidad_inicial
  from a_insertar
  where cantidad_inicial > 0;

  alter table kardex_movement_items enable trigger trg_apply_kardex_movement_item;

  select count(*) into v_omitidas
  from item_variants v
  left join (
    select mi.item_variant_id, sum(case when m.tipo = 'entrada' then mi.cantidad else -mi.cantidad end) as neto
    from kardex_movement_items mi join kardex_movements m on m.id = mi.movement_id
    where m.anulado = false and mi.movement_id != v_movement_id
    group by mi.item_variant_id
  ) en on en.item_variant_id = v.id
  where (v.stock_actual - coalesce(en.neto, 0)) <= 0;

  if v_omitidas > 0 then
    raise notice '% prenda(s) quedaron SIN entrada inicial porque su stock ya está totalmente explicado por otros movimientos (o el cálculo dio 0/negativo) -- revisar manualmente.', v_omitidas;
  end if;
end $$;

-- Verificación: el total de esta entrada inicial + el efecto neto de todos
-- los demás movimientos debe coincidir con el stock actual total.
select
  (select coalesce(sum(mi.cantidad), 0)
     from kardex_movement_items mi
     join kardex_movements m on m.id = mi.movement_id
     where m.observaciones = 'Inventario inicial (carga desde DOTACION JAVIER.csv)') as entrada_inicial_total,
  (select coalesce(sum(stock_actual), 0) from item_variants) as stock_actual_total;
