-- Logo de la empresa: un solo archivo, subido desde la propia aplicación.
--
-- Hasta ahora el logo estaba DIBUJADO en el código (tres arcos de SVG en
-- index.html, app.html, el certificado laboral y el informe técnico
-- disciplinario). Eso tiene dos problemas: no es el logo real de la empresa,
-- y cambiarlo obligaba a tocar cuatro archivos y publicar una versión nueva.
--
-- El bucket es PÚBLICO y la ruta es FIJA. Las dos decisiones van juntas y
-- tienen una sola razón: la pantalla de login todavía no tiene sesión, así
-- que no puede pedir un enlace firmado ni leer una tabla de configuración.
-- Con bucket público y ruta fija, cualquier pantalla arma la URL sola. Y el
-- logo de una empresa no es un secreto: está pintado en los buses.
--
-- Por lo mismo NO hace falta una tabla de configuración: el archivo es la
-- única fuente de verdad. Si existe, se usa; si no, se sigue dibujando el
-- SVG de respaldo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Leer: cualquiera. Es redundante con que el bucket sea público (la ruta
-- /object/public/ no pasa por RLS), pero hace falta para que listar el
-- bucket desde la app funcione igual, y deja escrito en la base que esto
-- es deliberado y no un bucket que se quedó abierto por descuido.
drop policy if exists marca_lectura_publica on storage.objects;
create policy marca_lectura_publica on storage.objects
  for select
  using (bucket_id = 'marca');

-- Escribir: solo admin. Cambiar el logo cambia TODOS los documentos que
-- emite la empresa -- certificados laborales incluidos -- así que no basta
-- con estar autorizado en Kardex.
drop policy if exists marca_admin_escribe on storage.objects;
create policy marca_admin_escribe on storage.objects
  for all
  using (
    bucket_id = 'marca'
    and auth.role() = 'authenticated'
    and kardex_mi_rol_autorizado() = 'admin'
  )
  with check (
    bucket_id = 'marca'
    and auth.role() = 'authenticated'
    and kardex_mi_rol_autorizado() = 'admin'
  );
