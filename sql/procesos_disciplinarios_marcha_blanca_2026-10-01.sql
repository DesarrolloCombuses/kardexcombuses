-- ============================================================================
-- Kardex / ERP Combuses -- Procesos disciplinarios: marcha blanca
--
-- Complemento de procesos_disciplinarios_2026-10-01.sql,
-- procesos_disciplinarios_hoja_2026-10-01.sql y
-- procesos_disciplinarios_lotes_2026-10-01.sql. Correr DESPUES de los tres.
--
-- QUE HACE
-- Mientras se termina de cargar y revisar la informacion, el modulo lo ve
-- UNA sola cuenta: desarrollotecnologico@combuses.com.co. Ni Gestion Humana
-- ni un admin del ERP. Son datos disciplinarios a medio migrar y no deben
-- circular hasta que esten revisados.
--
-- PARA ABRIRLO DESPUES
-- Cambiar el correo por null en kardex_pd_marcha_blanca() (una linea, al
-- comienzo de este archivo) y volver a correr solo esa funcion. Todo lo
-- demas -- policies, triggers y los RPC -- pasa por ahi, asi que no hay que
-- tocar nada mas y vuelve sola la regla de siempre: Gestion Humana mas quien
-- tenga el permiso del modulo.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El interruptor
-- ---------------------------------------------------------------------------
-- Devuelve el correo de la unica cuenta que entra durante la marcha blanca,
-- o null cuando el modulo ya esta abierto para todos.
--
--   ABRIR EL MODULO  ->  select null::text
--
create or replace function kardex_pd_marcha_blanca()
returns text
language sql
immutable
as $$
  select 'desarrollotecnologico@combuses.com.co'::text;
$$;

-- Supabase le da EXECUTE a todo el mundo por defecto. Esta funcion devuelve
-- un correo corporativo: no es una contrasena, pero no hay razon para que
-- cualquiera sin sesion pueda preguntarselo a la API.
--
-- OJO con el revoke: Supabase le concede EXECUTE a anon DIRECTAMENTE, no a
-- traves de PUBLIC, asi que "revoke from public" no se lo quita -- se
-- comprobo llamandola con la llave anonima despues de revocar y seguia
-- respondiendo el correo. Hay que nombrar a anon.
revoke all on function kardex_pd_marcha_blanca() from public, anon;
grant execute on function kardex_pd_marcha_blanca() to authenticated;

-- ---------------------------------------------------------------------------
-- La unica regla de acceso del modulo
-- ---------------------------------------------------------------------------
-- Todo lo del modulo pregunta aca: las policies de las tres tablas, la del
-- bucket, los triggers y los RPC. Un solo sitio que cambiar.
create or replace function kardex_pd_autorizado(p_accion text)
returns boolean
language sql
stable
as $$
  select case
    when kardex_pd_marcha_blanca() is not null
      then lower(coalesce(auth.jwt() ->> 'email', '')) = lower(kardex_pd_marcha_blanca())
    else kardex_es_gestion_humana()
      or kardex_tiene_permiso('procesos-disciplinarios', p_accion)
  end;
$$;

revoke all on function kardex_pd_autorizado(text) from public, anon;
grant execute on function kardex_pd_autorizado(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Las policies, ahora todas por la misma puerta
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'kardex_procesos_disciplinarios', 'kardex_procesos_disc_pruebas', 'kardex_procesos_disc_firmas'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);

    execute format($f$
      create policy %I on %I for select to authenticated
      using (kardex_pd_autorizado('ver'))
    $f$, t || '_sel', t);

    execute format($f$
      create policy %I on %I for update to authenticated
      using (kardex_pd_autorizado('editar'))
      with check (kardex_pd_autorizado('editar'))
    $f$, t || '_upd', t);
  end loop;
end $$;

drop policy if exists kardex_procesos_disciplinarios_ins on kardex_procesos_disciplinarios;
create policy kardex_procesos_disciplinarios_ins on kardex_procesos_disciplinarios
  for insert to authenticated
  with check (kardex_pd_autorizado('agregar'));

drop policy if exists kardex_procesos_disciplinarios_del on kardex_procesos_disciplinarios;
create policy kardex_procesos_disciplinarios_del on kardex_procesos_disciplinarios
  for delete to authenticated
  using (kardex_pd_autorizado('borrar'));

-- Pruebas y firmas se adjuntan como parte de avanzar un proceso que ya
-- existe, asi que 'editar' tambien alcanza (mismo criterio del archivo
-- original: adjuntar la foto que falta es editar el proceso).
drop policy if exists kardex_procesos_disc_pruebas_ins on kardex_procesos_disc_pruebas;
create policy kardex_procesos_disc_pruebas_ins on kardex_procesos_disc_pruebas
  for insert to authenticated
  with check (kardex_pd_autorizado('agregar') or kardex_pd_autorizado('editar'));

drop policy if exists kardex_procesos_disc_pruebas_del on kardex_procesos_disc_pruebas;
create policy kardex_procesos_disc_pruebas_del on kardex_procesos_disc_pruebas
  for delete to authenticated
  using (kardex_pd_autorizado('borrar') or kardex_pd_autorizado('editar'));

drop policy if exists kardex_procesos_disc_firmas_ins on kardex_procesos_disc_firmas;
create policy kardex_procesos_disc_firmas_ins on kardex_procesos_disc_firmas
  for insert to authenticated
  with check (kardex_pd_autorizado('agregar') or kardex_pd_autorizado('editar'));

-- Una firma sigue sin policy de delete, a proposito.

drop policy if exists "rw_procesos_disciplinarios" on storage.objects;
create policy "rw_procesos_disciplinarios" on storage.objects for all to authenticated
  using (bucket_id = 'procesos-disciplinarios' and kardex_pd_autorizado('ver'))
  with check (bucket_id = 'procesos-disciplinarios'
              and (kardex_pd_autorizado('agregar') or kardex_pd_autorizado('editar')));

-- ---------------------------------------------------------------------------
-- El hueco de los RPC: security definer se salta RLS
-- ---------------------------------------------------------------------------
-- kardex_pd_importar y kardex_pd_importar_hoja son SECURITY DEFINER, asi que
-- las policies de arriba NO las frenan: corren con los permisos del dueno de
-- la funcion. Su propio guard sigue diciendo "Gestion Humana o permiso del
-- modulo", que durante la marcha blanca es demasiada gente.
--
-- En vez de reescribir esas dos funciones enteras -- son largas, y tener el
-- mapeo de columnas duplicado en dos archivos es pedir que se desincronicen
-- --, el control se pone donde ninguna via puede esquivarlo: un trigger sobre
-- las tablas. Da igual si la escritura llega por PostgREST, por un RPC
-- definer o por uno que se escriba manana.
--
-- Es a nivel de SENTENCIA, no de fila: se evalua una vez por operacion y no
-- 418 veces durante una importacion.
-- La accion se mira segun lo que se esta haciendo, no fija. Durante la marcha
-- blanca da igual (solo pasa un correo), pero el dia que se abra, un trigger
-- que exigiera siempre 'editar' le negaria el insert a una cuenta con permiso
-- de 'agregar' -- y el error saldria lejos de aca. El 'or editar' es el mismo
-- criterio de las policies de pruebas y firmas: adjuntar lo que falta a un
-- proceso que ya existe es editarlo.
create or replace function kardex_pd_guard()
returns trigger
language plpgsql
as $$
declare
  v_accion text := case tg_op
    when 'INSERT' then 'agregar'
    when 'DELETE' then 'borrar'
    else 'editar'
  end;
begin
  if not coalesce(kardex_pd_autorizado(v_accion) or kardex_pd_autorizado('editar'), false) then
    raise exception 'Procesos disciplinarios esta en marcha blanca: solo la cuenta autorizada puede modificarlo.'
      using errcode = 'insufficient_privilege';
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'kardex_procesos_disciplinarios', 'kardex_procesos_disc_pruebas', 'kardex_procesos_disc_firmas'
  ] loop
    execute format('drop trigger if exists trg_pd_guard on %I', t);
    execute format(
      'create trigger trg_pd_guard before insert or update or delete on %I
         for each statement execute function kardex_pd_guard()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- El resumen de la pantalla, por la misma puerta
-- ---------------------------------------------------------------------------
create or replace function kardex_pd_resumen()
returns table (
  total integer,
  con_empleado integer,
  sin_empleado integer,
  de_la_hoja integer,
  con_acta integer,
  personas integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*)::integer,
    count(*) filter (where employee_id is not null)::integer,
    count(*) filter (where employee_id is null)::integer,
    count(*) filter (where origen_fila is not null)::integer,
    count(*) filter (where acta_descargos is not null)::integer,
    count(distinct empleado_cedula)::integer
  from kardex_procesos_disciplinarios
  where kardex_pd_autorizado('ver');
$$;

revoke all on function kardex_pd_resumen() from public, anon;
grant execute on function kardex_pd_resumen() to authenticated;

-- ---------------------------------------------------------------------------
-- Para comprobar como quedo:
--   select kardex_pd_marcha_blanca();            -- el correo, o null si ya se abrio
--   select kardex_pd_autorizado('ver');          -- true solo en esa cuenta
--   select count(*) from kardex_procesos_disciplinarios;  -- 0 desde cualquier otra
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Cerrarle anon a los RPC de los archivos anteriores
-- ---------------------------------------------------------------------------
-- Mismo caso: se crearon con "revoke from public", que a anon no le quita
-- nada. Su guard interno ya los frena, pero una funcion del modulo no tiene
-- por que estar al alcance de una llamada sin sesion.
revoke all on function kardex_pd_importar(integer, integer) from public, anon;
grant execute on function kardex_pd_importar(integer, integer) to authenticated;

revoke all on function kardex_pd_importar_hoja(jsonb) from public, anon;
grant execute on function kardex_pd_importar_hoja(jsonb) to authenticated;
