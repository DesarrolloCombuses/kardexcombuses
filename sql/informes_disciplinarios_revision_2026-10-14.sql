-- ============================================================================
-- Kardex / ERP Combuses -- Informes disciplinarios: revision
--
-- Complemento de sql/informes_disciplinarios_2026-09-29.sql. Correr DESPUES.
--
-- QUE RESUELVE
-- Hoy un supervisor registra un informe y queda ahi. Quien tiene que
-- revisarlo -- la coordinadora de SST -- no se entera a menos que entre al
-- modulo a mirar, y no hay forma de distinguir un informe que llego ayer de
-- uno que ya se atendio hace tres meses: todos se ven igual.
--
-- Se agrega entonces el unico dato que falta para eso: cuando se reviso y
-- quien. Un informe sin esa marca esta pendiente; con ella, atendido.
--
-- POR QUE UN RPC Y NO UN UPDATE NORMAL
-- La policy de update de esta tabla exige el permiso 'editar'. Pero revisar
-- NO es editar: quien revisa tiene que poder marcar que ya lo vio sin poder
-- cambiarle los hechos, la evidencia ni el empleado al informe. Son dos
-- cosas distintas y darle 'editar' a quien solo revisa seria abrirle la
-- puerta a modificar un documento que se firma.
--
-- Ademas, el correo del revisor lo pone el SERVIDOR con la sesion, no el
-- cliente. Si lo mandara el cliente, cualquiera podria marcar un informe a
-- nombre de otra persona -- y esa marca es la que dice quien respondio.
--
-- Seguro de re-ejecutar.
-- ============================================================================

alter table kardex_informes_disciplinarios
  add column if not exists revisado_en timestamptz,
  add column if not exists revisado_por_email text,
  add column if not exists revisado_por_nombre text;

comment on column kardex_informes_disciplinarios.revisado_en is
  'Cuando se marco como revisado. Nulo = pendiente de revision.';

-- ---------------------------------------------------------------------------
-- Marcar (o desmarcar) un informe como revisado
-- ---------------------------------------------------------------------------
-- p_revisado = false sirve para devolverlo a pendiente: si alguien lo marco
-- por error, tiene que poder deshacerlo sin pedirle permisos de edicion a
-- nadie. Al desmarcar se borra tambien quien lo habia revisado, para que no
-- quede un nombre pegado a una revision que ya no existe.
create or replace function kardex_informes_disc_marcar_revisado(
  p_id uuid,
  p_revisado boolean default true,
  p_nombre text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_cuando timestamptz;
begin
  if not (kardex_es_gestion_humana()
          or kardex_tiene_permiso('informes-disciplinarios', 'ver')) then
    raise exception 'Tu cuenta no tiene permiso para revisar informes disciplinarios'
      using errcode = '42501';
  end if;

  if p_revisado then
    update kardex_informes_disciplinarios
       set revisado_en = now(),
           revisado_por_email = v_correo,
           revisado_por_nombre = nullif(btrim(coalesce(p_nombre, '')), ''),
           updated_at = now()
     where id = p_id
     returning revisado_en into v_cuando;
  else
    update kardex_informes_disciplinarios
       set revisado_en = null,
           revisado_por_email = null,
           revisado_por_nombre = null,
           updated_at = now()
     where id = p_id
     returning revisado_en into v_cuando;
  end if;

  if not found then
    raise exception 'No existe ese informe disciplinario';
  end if;

  return v_cuando;
end;
$$;

revoke all on function kardex_informes_disc_marcar_revisado(uuid, boolean, text) from public, anon;
grant execute on function kardex_informes_disc_marcar_revisado(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cuantos quedan sin revisar
-- ---------------------------------------------------------------------------
-- Para el contador del menu. Es SECURITY INVOKER a proposito: corre con la
-- RLS de quien pregunta, asi que una cuenta sin acceso al modulo recibe 0 --
-- que es correcto, porque para ella no hay informes que revisar.
create or replace function kardex_informes_disc_sin_revisar()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from kardex_informes_disciplinarios
  where revisado_en is null;
$$;

revoke all on function kardex_informes_disc_sin_revisar() from public, anon;
grant execute on function kardex_informes_disc_sin_revisar() to authenticated;

-- ---------------------------------------------------------------------------
-- Los informes que ya existen quedan como PENDIENTES (revisado_en nulo).
-- Es lo correcto: nadie los ha revisado dentro del ERP todavia. Si se
-- prefiere arrancar con el contador en cero, correr una sola vez:
--
--   update kardex_informes_disciplinarios
--      set revisado_en = created_at, revisado_por_nombre = 'Antes del ERP'
--    where revisado_en is null;
--
-- Para comprobar:
--   select kardex_informes_disc_sin_revisar();
-- ---------------------------------------------------------------------------
