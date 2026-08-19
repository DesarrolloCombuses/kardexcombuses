-- ============================================================================
-- Datos iniciales de inventario: DOTACION JAVIER.csv
-- Ejecutar después de schema.sql. Idempotente (on conflict do nothing/update).
-- Total esperado tras la carga: 336 unidades (coincide con "Total general" del CSV).
-- ============================================================================

do $$
declare
  v_cat_id uuid;
begin

  -- BOTAS GESTORES MOVILIDAD Y SERVICIO (45)
  insert into item_categories (nombre) values ('BOTAS GESTORES MOVILIDAD Y SERVICIO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '35', 2), (v_cat_id, '36', 2), (v_cat_id, '37', 5), (v_cat_id, '38', 7),
    (v_cat_id, '39', 12), (v_cat_id, '40', 9), (v_cat_id, '41', 4), (v_cat_id, '42', 2), (v_cat_id, '43', 2)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMISAS POLO GESTORES (40)
  insert into item_categories (nombre) values ('CAMISAS POLO GESTORES')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '2XL', 8), (v_cat_id, '3XL', 4), (v_cat_id, 'L', 12), (v_cat_id, 'M', 3), (v_cat_id, 'XL', 13)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- PANTALON GESTORES TIPO CARGO (9)
  insert into item_categories (nombre) values ('PANTALON GESTORES TIPO CARGO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '34', 4), (v_cat_id, '36', 4), (v_cat_id, '42', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMISAS SST ADMINISTRATIVO (2)
  insert into item_categories (nombre) values ('CAMISAS SST ADMINISTRATIVO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '2XL', 2)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMI BUSO SST ADMINISTRATIVO (2)
  insert into item_categories (nombre) values ('CAMI BUSO SST ADMINISTRATIVO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, 'XL', 2)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- SUDADERA SST ADMINISTRATIVO (1)
  insert into item_categories (nombre) values ('SUDADERA SST ADMINISTRATIVO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '16', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- DOTACION CAMISAS AEROPUERTO (18)
  insert into item_categories (nombre) values ('DOTACION CAMISAS AEROPUERTO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '2XL', 13), (v_cat_id, '3XL', 4), (v_cat_id, 'XL', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- PANTALON AEROPUERTO (19)
  insert into item_categories (nombre) values ('PANTALON AEROPUERTO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '10', 2), (v_cat_id, '14', 2), (v_cat_id, '38', 13), (v_cat_id, '48', 2)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- DOTACION CHAQUETA AEROPUERTO (39)
  insert into item_categories (nombre) values ('DOTACION CHAQUETA AEROPUERTO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '12', 1), (v_cat_id, '38', 1), (v_cat_id, '2XL', 16), (v_cat_id, 'L', 6), (v_cat_id, 'XL', 15)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- ZAPATILLAS (3)
  insert into item_categories (nombre) values ('ZAPATILLAS')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '37', 3)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMISETA URBANA (28)
  insert into item_categories (nombre) values ('CAMISETA URBANA')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '3XL', 1), (v_cat_id, '5XL', 1), (v_cat_id, 'L', 8), (v_cat_id, 'M', 18)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- JEANS URBANO (69)
  insert into item_categories (nombre) values ('JEANS URBANO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '28', 2), (v_cat_id, '32', 1), (v_cat_id, '34', 2), (v_cat_id, '36', 15),
    (v_cat_id, '38', 35), (v_cat_id, '40', 7), (v_cat_id, '42', 6), (v_cat_id, '46', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- TENNIS URBANOS (18)
  insert into item_categories (nombre) values ('TENNIS URBANOS')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '35', 4), (v_cat_id, '36', 4), (v_cat_id, '39', 4), (v_cat_id, '40', 1),
    (v_cat_id, '41', 2), (v_cat_id, '42', 2), (v_cat_id, '43', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- PANTALON ADMINISTRATIVOS HOMBRE (11)
  insert into item_categories (nombre) values ('PANTALON ADMINISTRATIVOS HOMBRE')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '34', 8), (v_cat_id, '36', 1), (v_cat_id, '42', 2)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMISA ADMINISTRATIVO HOMBRE (19)
  insert into item_categories (nombre) values ('CAMISA ADMINISTRATIVO HOMBRE')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, 'L', 4), (v_cat_id, 'M', 14), (v_cat_id, 'S', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- CAMISAS MUJERES ADMINISTRTIVAS (4)
  insert into item_categories (nombre) values ('CAMISAS MUJERES ADMINISTRTIVAS')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '3XL', 3), (v_cat_id, 'M', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

  -- PANTALON MUJER ADMINISTRATIVO (9)
  insert into item_categories (nombre) values ('PANTALON MUJER ADMINISTRATIVO')
    on conflict (nombre) do update set nombre = excluded.nombre
    returning id into v_cat_id;
  insert into item_variants (item_category_id, talla, stock_actual) values
    (v_cat_id, '6', 2), (v_cat_id, '8', 2), (v_cat_id, '16', 2), (v_cat_id, '24', 2), (v_cat_id, '36', 1)
  on conflict (item_category_id, talla) do update set stock_actual = excluded.stock_actual;

end $$;

-- Verificación: debe devolver 336
select sum(stock_actual) as total_general from item_variants;
