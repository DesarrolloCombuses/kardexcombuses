-- Reemplaza el mecanismo de subida de foto del link público de perfil.
--
-- sql/fix_rls_foto_perfil_publico_2026-09-10.sql corrigió un bug real en la
-- policy (el exists() contra employees siempre daba falso para anon por su
-- propia RLS), pero probando contra producción con requests HTTP directas
-- se confirmó que el problema real es otro, a nivel de plataforma: Supabase
-- Storage rechaza CUALQUIER insert/update del rol anon en un bucket con
-- public=false sin importar qué digan las policies -- se probó incluso con
-- una policy "to public, with check (true)" (sin ninguna condición) y
-- siguió fallando "row-level security policy", mientras que el mismo
-- request contra un bucket public=true sí funcionó. "fotos-empleados" tiene
-- que seguir siendo privado, así que las policies de anon sobre ese bucket
-- nunca van a poder funcionar -- se quitan en vez de dejarlas ahí sin uso
-- real. La subida ahora la hace la Edge Function
-- subir-foto-perfil-publico (supabase/functions/), que usa el service role
-- del lado del servidor para poder escribir en el bucket privado.

drop policy if exists "anon_insert_foto_perfil_publico" on storage.objects;
drop policy if exists "anon_update_foto_perfil_publico" on storage.objects;
drop function if exists public.existe_empleado_para_foto_publica(text);
