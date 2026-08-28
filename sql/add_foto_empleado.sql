-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Foto de perfil del empleado (opcional). Bucket privado separado del de
-- Entregas (fotos-entrega) -- esa es evidencia de una entrega puntual, esta
-- es la foto de carne/perfil de la persona. Seguro de re-ejecutar.
-- ============================================================================

alter table employees add column if not exists foto_url text;

insert into storage.buckets (id, name, public)
values ('fotos-empleados', 'fotos-empleados', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_fotos_empleados" on storage.objects;
create policy "authenticated_rw_fotos_empleados" on storage.objects
  for all
  using (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated')
  with check (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated');
