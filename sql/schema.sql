-- ============================================================================
-- Kardex de Dotación — Combuses SA
-- Esquema Supabase (Postgres): tablas, trigger de stock, vista, RLS, storage.
-- Ejecutar completo en el SQL Editor de Supabase antes de seed_dotacion_javier.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

create table if not exists item_categories (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists item_variants (
  id uuid primary key default gen_random_uuid(),
  item_category_id uuid not null references item_categories(id) on delete cascade,
  talla text not null,
  stock_actual integer not null default 0,
  created_at timestamptz not null default now(),
  unique (item_category_id, talla)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cedula text not null unique,
  cargo text,
  area text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  numero_interno text,
  vehiculo_asociado text,
  ruta text
);

-- Perfil del usuario del sistema (1:1 con auth.users). Si este proyecto ya
-- tiene una tabla profiles de otro sistema, se reutiliza tal cual (Kardex
-- solo lee full_name/username para mostrar el nombre de quien entrega).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kardex_movements (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada', 'salida')),
  fecha timestamptz not null default now(),
  employee_id uuid references employees(id),
  entregado_por_nombre text,
  firma_entrega_url text,
  firma_receptor_url text,
  foto_receptor_url text,
  observaciones text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  anulado boolean not null default false,
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id),
  constraint salida_requiere_empleado check (
    tipo = 'entrada' or employee_id is not null
  )
);

create table if not exists kardex_movement_items (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references kardex_movements(id) on delete cascade,
  item_variant_id uuid not null references item_variants(id),
  cantidad integer not null check (cantidad > 0),
  stock_resultante integer,
  created_at timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existía
-- de una versión anterior de este script; estos ALTER lo hacen sin riesgo
-- (no-op si la columna ya está).
alter table kardex_movements add column if not exists anulado boolean not null default false;
alter table kardex_movements add column if not exists anulado_at timestamptz;
alter table kardex_movements add column if not exists anulado_por uuid references auth.users(id);

-- Fecha del día real de la entrega (la elige quien registra la salida),
-- separada a propósito de "fecha" -- esa sigue siendo el timestamp exacto
-- de registro que ordena el kardex y que usa Inventario histórico junto
-- con stock_resultante para reconstruir el stock a una fecha pasada. Si
-- "fecha" también se pudiera editar libremente, una salida registrada
-- tarde con fecha atrasada podría desordenar esa reconstrucción.
alter table kardex_movements add column if not exists fecha_entrega date;

-- Nombre de quien registra el movimiento, guardado al momento de crearlo
-- (ver DB.getMyDisplayName en js/db.js). created_by ya identifica al
-- usuario de forma inequívoca (uuid de auth.users), pero mostrar ese id
-- no sirve en el Excel de Historial -- y depender de profiles.full_name
-- fallaba en silencio como "Usuario" para todos si esa tabla (compartida
-- con otro sistema) no tenía el nombre lleno. Guardarlo acá, con respaldo
-- al correo de la sesión, garantiza que siempre identifique a la persona.
alter table kardex_movements add column if not exists creado_por_nombre text;

-- Numero interno de vehiculo (y ruta) asociado al empleado, relevante sobre
-- todo para conductores. Se ve en la Entrega para confirmar que se le
-- entrega la dotacion al conductor correcto. Datos cargados por separado
-- desde sql/update_conductores_vehiculo.sql (mismo CSV de empleados).
alter table employees add column if not exists numero_interno text;
alter table employees add column if not exists vehiculo_asociado text;
alter table employees add column if not exists ruta text;

-- Base/afiliado del vehículo asignado (a qué empresa/base va dirigido el
-- vehículo del conductor). Se carga por número interno de vehículo, no por
-- empleado -- ver sql/update_base_vehiculo_2026-08-27.sql.
alter table employees add column if not exists base text;

create index if not exists idx_item_variants_category on item_variants(item_category_id);
create index if not exists idx_movements_employee on kardex_movements(employee_id);
create index if not exists idx_movements_fecha on kardex_movements(fecha);
create index if not exists idx_movement_items_movement on kardex_movement_items(movement_id);
create index if not exists idx_movement_items_variant on kardex_movement_items(item_variant_id);

-- ----------------------------------------------------------------------------
-- Trigger: actualizar stock_actual al insertar una línea de movimiento
-- ----------------------------------------------------------------------------

create or replace function fn_apply_kardex_movement_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_stock_actual integer;
begin
  select tipo into v_tipo from kardex_movements where id = new.movement_id;

  if v_tipo = 'entrada' then
    update item_variants
      set stock_actual = stock_actual + new.cantidad
      where id = new.item_variant_id
      returning stock_actual into v_stock_actual;
  elsif v_tipo = 'salida' then
    update item_variants
      set stock_actual = stock_actual - new.cantidad
      where id = new.item_variant_id
      returning stock_actual into v_stock_actual;

    if v_stock_actual < 0 then
      raise exception 'Stock insuficiente para la variante %: quedaría en %', new.item_variant_id, v_stock_actual;
    end if;
  else
    raise exception 'Tipo de movimiento desconocido: %', v_tipo;
  end if;

  new.stock_resultante := v_stock_actual;
  return new;
end;
$$;

drop trigger if exists trg_apply_kardex_movement_item on kardex_movement_items;
create trigger trg_apply_kardex_movement_item
  before insert on kardex_movement_items
  for each row
  execute function fn_apply_kardex_movement_item();

-- ----------------------------------------------------------------------------
-- Anular movimiento: revierte el stock de cada línea y marca el movimiento
-- como anulado (no lo borra, para conservar el rastro de que existió/se
-- corrigió). Útil para pruebas o errores de captura.
--
-- security definer a propósito: kardex_movements/kardex_movement_items solo
-- permiten SELECT + INSERT por RLS (ver más abajo) -- nadie puede editar ni
-- borrar un movimiento ya creado, ni por error ni manipulando la API a
-- mano. La ÚNICA forma de "corregir" uno es por esta función, que además
-- deja registrado quién y cuándo (anulado_por/anulado_at, tomados de
-- auth.uid()/now() -- no se pueden falsificar porque no son parámetros).
-- Por eso necesita bypasear esa RLS para poder hacer su propio update.
-- ----------------------------------------------------------------------------

create or replace function anular_movimiento(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_anulado boolean;
  v_item record;
begin
  select tipo, anulado into v_tipo, v_anulado
    from kardex_movements where id = p_movement_id for update;

  if v_tipo is null then
    raise exception 'Movimiento no encontrado';
  end if;
  if v_anulado then
    raise exception 'Este movimiento ya estaba anulado';
  end if;

  for v_item in
    select item_variant_id, cantidad from kardex_movement_items where movement_id = p_movement_id
  loop
    if v_tipo = 'salida' then
      -- devolver al stock lo que se había entregado
      update item_variants set stock_actual = stock_actual + v_item.cantidad
        where id = v_item.item_variant_id;
    else
      -- quitar del stock lo que se había ingresado, sin dejarlo negativo
      update item_variants set stock_actual = stock_actual - v_item.cantidad
        where id = v_item.item_variant_id;
      if (select stock_actual from item_variants where id = v_item.item_variant_id) < 0 then
        raise exception 'No se puede anular: dejaría el stock de una prenda en negativo (ya se usó parte de esa entrada)';
      end if;
    end if;
  end loop;

  update kardex_movements
    set anulado = true, anulado_at = now(), anulado_por = auth.uid()
    where id = p_movement_id;
end;
$$;

grant execute on function anular_movimiento(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Nota: no se crea un trigger automático en auth.users para poblar profiles.
-- Si este proyecto es compartido con otro sistema, ese sistema puede ya tener
-- su propio mecanismo de creación de perfiles (con columnas propias); crear
-- un segundo trigger AFTER INSERT sobre auth.users con columnas equivocadas
-- puede romper la creación de CUALQUIER usuario nuevo del proyecto. Kardex
-- simplemente lee profiles si existe una fila, y usa el email como fallback.

-- ----------------------------------------------------------------------------
-- Vista: stock actual por categoría/talla
-- ----------------------------------------------------------------------------

create or replace view v_stock_actual as
select
  c.id as item_category_id,
  c.nombre as categoria,
  v.id as item_variant_id,
  v.talla,
  v.stock_actual,
  sum(v.stock_actual) over (partition by c.id) as stock_total_categoria
from item_categories c
join item_variants v on v.item_category_id = c.id
order by c.nombre, v.talla;

-- security_invoker: sin esto, una vista creada por el rol postgres (que
-- tiene BYPASSRLS) ignora las políticas RLS de las tablas base para
-- CUALQUIER usuario que consulte la vista, incluso anónimo.
alter view v_stock_actual set (security_invoker = on);

-- ----------------------------------------------------------------------------
-- Row Level Security: todo requiere sesión autenticada, sin acceso anónimo
-- ----------------------------------------------------------------------------

alter table item_categories enable row level security;
alter table item_variants enable row level security;
alter table employees enable row level security;
alter table profiles enable row level security;
alter table kardex_movements enable row level security;
alter table kardex_movement_items enable row level security;

drop policy if exists "authenticated_all" on item_categories;
create policy "authenticated_all" on item_categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all" on item_variants;
create policy "authenticated_all" on item_variants
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all" on employees;
create policy "authenticated_all" on employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_select_own_or_all" on profiles;
create policy "authenticated_select_own_or_all" on profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated_update_own" on profiles;
create policy "authenticated_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Solo SELECT + INSERT: una vez creado, un movimiento no se puede editar ni
-- borrar directamente por RLS (ni por error desde la app, ni por alguien
-- manipulando la API a mano). La única forma de "corregir" uno es
-- anular_movimiento() (ver arriba), que sí queda registrado con quién y
-- cuándo. Esto es lo que garantiza que el kardex sea auditable de verdad.
drop policy if exists "authenticated_all" on kardex_movements;
drop policy if exists "authenticated_select" on kardex_movements;
create policy "authenticated_select" on kardex_movements
  for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated_insert" on kardex_movements;
create policy "authenticated_insert" on kardex_movements
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all" on kardex_movement_items;
drop policy if exists "authenticated_select" on kardex_movement_items;
create policy "authenticated_select" on kardex_movement_items
  for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated_insert" on kardex_movement_items;
create policy "authenticated_insert" on kardex_movement_items
  for insert with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Storage: buckets privados para firmas y fotos de entrega
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('firmas', 'firmas', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('fotos-entrega', 'fotos-entrega', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_firmas" on storage.objects;
create policy "authenticated_rw_firmas" on storage.objects
  for all
  using (bucket_id = 'firmas' and auth.role() = 'authenticated')
  with check (bucket_id = 'firmas' and auth.role() = 'authenticated');

drop policy if exists "authenticated_rw_fotos" on storage.objects;
create policy "authenticated_rw_fotos" on storage.objects
  for all
  using (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated')
  with check (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Realtime: para que el inventario/dashboard/historial se actualicen solos
-- en todas las pantallas abiertas cuando alguien registra un movimiento.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'item_variants'
  ) then
    alter publication supabase_realtime add table item_variants;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'item_categories'
  ) then
    alter publication supabase_realtime add table item_categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'kardex_movements'
  ) then
    alter publication supabase_realtime add table kardex_movements;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'kardex_movement_items'
  ) then
    alter publication supabase_realtime add table kardex_movement_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'employees'
  ) then
    alter publication supabase_realtime add table employees;
  end if;
end $$;
