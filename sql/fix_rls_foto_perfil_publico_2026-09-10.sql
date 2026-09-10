-- Corrige que la subida de foto desde el link público de perfil (rol anon,
-- sin sesión) siempre fallaba con "se violaron las políticas" -- ver
-- comentario completo en sql/schema.sql, junto a estas mismas policies.
--
-- Causa: la policy de Storage necesitaba confirmar "existe un empleado con
-- este id" consultando employees directo, pero employees solo tiene la
-- policy "authenticated_all" -- para anon esa tabla es invisible por RLS,
-- así que el exists(...) siempre daba falso, sin importar que el empleado
-- existiera. Se reemplaza por una función security definer que sí puede
-- ver employees (sin exponer la tabla a anon: solo expone un booleano).

create or replace function public.existe_empleado_para_foto_publica(p_object_name text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from employees e
    where p_object_name = 'perfil-publico/' || e.id::text || '.jpg'
  );
$$;

revoke all on function public.existe_empleado_para_foto_publica(text) from public;
grant execute on function public.existe_empleado_para_foto_publica(text) to anon, authenticated;

drop policy if exists "anon_insert_foto_perfil_publico" on storage.objects;
create policy "anon_insert_foto_perfil_publico" on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'fotos-empleados'
    and public.existe_empleado_para_foto_publica(name)
  );

drop policy if exists "anon_update_foto_perfil_publico" on storage.objects;
create policy "anon_update_foto_perfil_publico" on storage.objects
  for update
  to anon
  using (bucket_id = 'fotos-empleados' and name like 'perfil-publico/%')
  with check (
    bucket_id = 'fotos-empleados'
    and public.existe_empleado_para_foto_publica(name)
  );
