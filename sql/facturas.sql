-- ============================================================================
-- Kardex de Dotación — Combuses SA
-- Facturas: registro de las facturas/soportes de compra de dotación, cada
-- una con su archivo (PDF o foto) guardado en Storage.
-- Ejecutar en el SQL Editor de Supabase después de schema.sql. Es
-- re-ejecutable sin riesgo (create table/policy usan if not exists / drop+create).
-- ============================================================================

create table if not exists facturas (
  id uuid primary key default gen_random_uuid(),
  numero_factura text not null,
  fecha_remision date not null,
  archivo_url text,
  archivo_nombre text,
  observaciones text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- archivo_url es opcional: permite guardar registros históricos migrados de
-- otro sistema cuyo PDF/foto ya no se puede recuperar (queda solo el
-- nombre que tenía, en archivo_nombre, como referencia). Toda factura
-- nueva cargada desde la app sí exige el archivo.
alter table facturas alter column archivo_url drop not null;

alter table facturas enable row level security;

-- Igual que item_categories/item_variants/employees: no es parte de la
-- cadena de auditoría del kardex (no mueve stock), así que aquí sí se
-- permite editar/borrar directamente si alguien sube la factura equivocada.
drop policy if exists "authenticated_all" on facturas;
create policy "authenticated_all" on facturas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Storage: bucket privado para los archivos de factura (PDF o imagen)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_facturas" on storage.objects;
create policy "authenticated_rw_facturas" on storage.objects
  for all
  using (bucket_id = 'facturas' and auth.role() = 'authenticated')
  with check (bucket_id = 'facturas' and auth.role() = 'authenticated');
