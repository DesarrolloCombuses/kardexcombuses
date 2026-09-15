-- Endurece el acceso a los datos de Kardex: ya no basta con estar
-- autenticado en el proyecto de Supabase (compartido con otros programas
-- de Combuses) -- además el correo debe estar en la lista de autorizados
-- de Kardex. Los demás sistemas del mismo proyecto no se tocan: siguen
-- funcionando solo con "estar autenticado", tal como antes.
--
-- Repetible sin riesgo (create table/function usan if not exists / or
-- replace, y los alter policy solo cambian la condición, no la crean).

-- 1) Lista de correos autorizados a nivel de base de datos. Debe reflejar
--    siempre lo mismo que AUTHORIZED_USERS en js/permissions.js -- cuando
--    se agregue o quite a alguien ahí, hay que repetir el cambio acá.
create table if not exists kardex_authorized_users (
  email text primary key,
  rol text not null check (rol in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

alter table kardex_authorized_users enable row level security;
-- A propósito no tiene policies: nadie puede leer/escribir esta tabla vía
-- API (ni authenticated ni anon), solo la función de abajo (security
-- definer) y el rol de servicio.

insert into kardex_authorized_users (email, rol) values
  ('kardex@combuses.com.co', 'admin'),
  ('vinculaciones@combuses.com.co', 'admin'),
  ('analistafacturacion@combuses.com.co', 'viewer'),
  ('contabilidad@combuses.com.co', 'viewer')
on conflict (email) do update set rol = excluded.rol;

-- 2) Función que revisa si el correo del usuario autenticado está en la
--    lista. security definer para poder leer kardex_authorized_users pese
--    a que esa tabla no tiene policies propias.
create or replace function kardex_is_authorized()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from kardex_authorized_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function kardex_is_authorized() from public;
grant execute on function kardex_is_authorized() to authenticated, anon;

-- 3) Tablas propias de Kardex: se agrega "and kardex_is_authorized()" a la
--    condición que ya existía. Deja fuera a propósito la tabla "profiles"
--    (forma genérica id/username/full_name/avatar_url, no coincide con lo
--    que Kardex diligencia -- todo indica que la comparten otros programas
--    del mismo proyecto, así que no se toca).
alter policy authenticated_all on accidentes_transito
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on aspirantes
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on contactos_emergencia
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on employees
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on facturas
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on hijos_empleado
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on infracciones_transito
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on item_categories
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on item_variants
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_all on perfil_sociodemografico
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy "vehiculo_bases access" on vehiculo_bases
  using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_insert on kardex_movement_items
  with check (auth.role() = 'authenticated' and kardex_is_authorized());
alter policy authenticated_select on kardex_movement_items
  using (auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_insert on kardex_movements
  with check (auth.role() = 'authenticated' and kardex_is_authorized());
alter policy authenticated_select on kardex_movements
  using (auth.role() = 'authenticated' and kardex_is_authorized());

-- Antes cualquiera con sesión (de cualquier programa) podía leer la
-- auditoría de cambios del perfil público (qual = true, sin ni siquiera
-- pedir estar autenticado).
alter policy authenticated_select_auditoria_perfil_publico on perfil_publico_auditoria
  using (auth.role() = 'authenticated' and kardex_is_authorized());

-- 4) La vista de stock corre, por defecto, con los permisos de su dueño
--    (postgres) y por eso ignoraba las policies de item_categories/
--    item_variants -- con security_invoker pasa a respetarlas.
alter view v_stock_actual set (security_invoker = on);

-- 5) Buckets de Storage propios de Kardex. No se tocan "rostros-referencia",
--    "asistencia-fotos", "conductor-documentos", "flota-documentos",
--    "parque-docs", "pruebas-disciplinarias", "encuesta-uniforme-fotos" ni
--    "inmuebles-fotos"/"formularios-zci": son de otros programas.
--    Ojo: "fotos-empleados" también tiene policies aparte para el perfil
--    público (anon_insert_foto_perfil_publico / anon_update_foto_perfil_publico)
--    que a propósito no se tocan -- son las que permiten que un empleado sin
--    sesión suba su foto desde el link público.
alter policy authenticated_rw_facturas on storage.objects
  using (bucket_id = 'facturas' and auth.role() = 'authenticated' and kardex_is_authorized())
  with check (bucket_id = 'facturas' and auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_rw_firmas on storage.objects
  using (bucket_id = 'firmas' and auth.role() = 'authenticated' and kardex_is_authorized())
  with check (bucket_id = 'firmas' and auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_rw_fotos on storage.objects
  using (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and kardex_is_authorized())
  with check (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and kardex_is_authorized());

alter policy authenticated_rw_fotos_empleados on storage.objects
  using (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and kardex_is_authorized())
  with check (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and kardex_is_authorized());

-- El bucket "hojas-vida" también tiene policies viejas sin ningún filtro de
-- autenticación (pdf_insert/pdf_select/pdf_update). No se tocan acá porque
-- no está confirmado si son de Kardex o de otro programa -- mientras
-- sigan ahí, este endurecimiento en particular no cierra el acceso del
-- todo para ese bucket. Ver aviso al usuario.
alter policy authenticated_rw_hojas_vida on storage.objects
  using (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and kardex_is_authorized())
  with check (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and kardex_is_authorized());
