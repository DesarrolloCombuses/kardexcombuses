-- Permisos granulares por cuenta: además del acceso fijo que ya dan
-- admin/viewer/GESTION HUMANA (sin tocar ninguna de esas policies), el
-- admin puede darle a CUALQUIER cuenta permisos sueltos por módulo (ver /
-- agregar / editar / borrar) desde "Usuarios". Es puramente aditivo:
-- Postgres combina con OR varias policies permisivas para el mismo
-- comando, así que acá solo se agregan policies nuevas, ninguna existente
-- se modifica ni se borra.
--
-- Repetible sin riesgo (create table/function usan if not exists / or
-- replace; create policy no -- si se repite hay que dropear antes).

create table if not exists kardex_permisos_usuario (
  employee_id uuid not null references employees(id),
  modulo text not null check (modulo in (
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'permisos-vacaciones', 'siniestros-transito'
  )),
  ver boolean not null default false,
  agregar boolean not null default false,
  editar boolean not null default false,
  borrar boolean not null default false,
  creado_por_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, modulo)
);

alter table kardex_permisos_usuario enable row level security;

drop policy if exists "admin_all" on kardex_permisos_usuario;
create policy "admin_all" on kardex_permisos_usuario
  for all using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

create or replace function kardex_tiene_permiso(p_modulo text, p_accion text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from kardex_permisos_usuario pu
    where pu.employee_id = kardex_own_employee_id()
      and pu.modulo = p_modulo
      and case p_accion
        when 'ver' then pu.ver
        when 'agregar' then pu.agregar
        when 'editar' then pu.editar
        when 'borrar' then pu.borrar
        else false
      end
  );
$$;

revoke all on function kardex_tiene_permiso(text, text) from public;
grant execute on function kardex_tiene_permiso(text, text) to authenticated;

create or replace function kardex_mis_permisos_modulos()
returns table (modulo text, ver boolean, agregar boolean, editar boolean, borrar boolean)
language sql
security definer
set search_path = public
stable
as $$
  select modulo, ver, agregar, editar, borrar from kardex_permisos_usuario
  where employee_id = kardex_own_employee_id();
$$;

revoke all on function kardex_mis_permisos_modulos() from public;
grant execute on function kardex_mis_permisos_modulos() to authenticated;

-- ---------------------------------------------------------------------------
-- item_categories / item_variants: solo "ver" (varios módulos las leen) y
-- "agregar" (solo nueva-prenda las escribe). No hay UI de editar/borrar
-- catálogo hoy, así que no se agregan esas policies (no habría nada que
-- las use, y kardex_tiene_permiso() seguiría protegiendo igual si algún
-- día se agregan).
-- ---------------------------------------------------------------------------

create policy "permiso_ver_item_categories" on item_categories for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('inventario', 'ver') or kardex_tiene_permiso('inventario-historico', 'ver')
    or kardex_tiene_permiso('nueva-prenda', 'ver') or kardex_tiene_permiso('estadisticas', 'ver')
    or kardex_tiene_permiso('entrada', 'ver') or kardex_tiene_permiso('salida', 'ver')
  ));
create policy "permiso_agregar_item_categories" on item_categories for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('nueva-prenda', 'agregar'));

create policy "permiso_ver_item_variants" on item_variants for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('inventario', 'ver') or kardex_tiene_permiso('inventario-historico', 'ver')
    or kardex_tiene_permiso('nueva-prenda', 'ver') or kardex_tiene_permiso('estadisticas', 'ver')
    or kardex_tiene_permiso('entrada', 'ver') or kardex_tiene_permiso('salida', 'ver')
  ));
create policy "permiso_agregar_item_variants" on item_variants for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('nueva-prenda', 'agregar'));

-- ---------------------------------------------------------------------------
-- kardex_movements / kardex_movement_items: solo select+insert (no tienen
-- policy de update/delete hoy -- la única forma de "editar" es anular, ver
-- más abajo).
-- ---------------------------------------------------------------------------

create policy "permiso_ver_kardex_movements" on kardex_movements for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('inventario-historico', 'ver') or kardex_tiene_permiso('historial', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver')
  ));
create policy "permiso_agregar_kardex_movements" on kardex_movements for insert
  with check (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('entrada', 'agregar') or kardex_tiene_permiso('salida', 'agregar')
    or kardex_tiene_permiso('nueva-prenda', 'agregar')
  ));

create policy "permiso_ver_kardex_movement_items" on kardex_movement_items for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('inventario-historico', 'ver') or kardex_tiene_permiso('historial', 'ver')
  ));
create policy "permiso_agregar_kardex_movement_items" on kardex_movement_items for insert
  with check (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('entrada', 'agregar') or kardex_tiene_permiso('salida', 'agregar')
    or kardex_tiene_permiso('nueva-prenda', 'agregar')
  ));

-- ---------------------------------------------------------------------------
-- facturas: entrada la necesita en solo lectura (selector de factura),
-- historial la embebe (lectura); el módulo "facturas" tiene las 4 acciones.
-- ---------------------------------------------------------------------------

create policy "permiso_ver_facturas" on facturas for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('entrada', 'ver') or kardex_tiene_permiso('historial', 'ver')
    or kardex_tiene_permiso('facturas', 'ver')
  ));
create policy "permiso_agregar_facturas" on facturas for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('facturas', 'agregar'));
create policy "permiso_editar_facturas" on facturas for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('facturas', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('facturas', 'editar'));
create policy "permiso_borrar_facturas" on facturas for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('facturas', 'borrar'));

-- ---------------------------------------------------------------------------
-- employees / perfil_sociodemografico / contactos_emergencia / hijos_empleado:
-- el módulo "empleados" tiene las 4 acciones; los módulos de solo consulta
-- de Personal (cumpleaños/alertas/conductores/perfil) solo agregan "ver".
-- ---------------------------------------------------------------------------

create policy "permiso_ver_employees" on employees for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('salida', 'ver')
    or kardex_tiene_permiso('historial', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver')
  ));
create policy "permiso_agregar_employees" on employees for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'agregar'));
create policy "permiso_editar_employees" on employees for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'));
create policy "permiso_borrar_employees" on employees for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'borrar'));

create policy "permiso_ver_perfil_sociodemografico" on perfil_sociodemografico for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver')
  ));
create policy "permiso_agregar_perfil_sociodemografico" on perfil_sociodemografico for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'agregar'));
create policy "permiso_editar_perfil_sociodemografico" on perfil_sociodemografico for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'));
create policy "permiso_borrar_perfil_sociodemografico" on perfil_sociodemografico for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'borrar'));

create policy "permiso_ver_contactos_emergencia" on contactos_emergencia for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver')
  ));
create policy "permiso_agregar_contactos_emergencia" on contactos_emergencia for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'agregar'));
create policy "permiso_editar_contactos_emergencia" on contactos_emergencia for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'));
create policy "permiso_borrar_contactos_emergencia" on contactos_emergencia for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'borrar'));

create policy "permiso_ver_hijos_empleado" on hijos_empleado for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver')
  ));
create policy "permiso_agregar_hijos_empleado" on hijos_empleado for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'agregar'));
create policy "permiso_editar_hijos_empleado" on hijos_empleado for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'editar'));
create policy "permiso_borrar_hijos_empleado" on hijos_empleado for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'borrar'));

-- ---------------------------------------------------------------------------
-- aspirantes: módulo "aspirantes", las 4 acciones.
-- ---------------------------------------------------------------------------

create policy "permiso_ver_aspirantes" on aspirantes for select
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'ver'));
create policy "permiso_agregar_aspirantes" on aspirantes for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'agregar'));
create policy "permiso_editar_aspirantes" on aspirantes for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'editar'));
create policy "permiso_borrar_aspirantes" on aspirantes for delete
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'borrar'));

-- ---------------------------------------------------------------------------
-- infracciones_transito / accidentes_transito: solo lectura, para el cruce
-- de Paz y Salvo dentro de Empleados y para el módulo de Siniestros.
-- ---------------------------------------------------------------------------

create policy "permiso_ver_infracciones_transito" on infracciones_transito for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('siniestros-transito', 'ver')
  ));
create policy "permiso_ver_accidentes_transito" on accidentes_transito for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('siniestros-transito', 'ver')
  ));

create policy "permiso_ver_auditoria_perfil_publico" on perfil_publico_auditoria for select
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'ver'));

-- ---------------------------------------------------------------------------
-- permisos_solicitudes: aditivo sobre las 3 policies que ya existen
-- (select_propio_o_admin / insert_propio_o_admin / update_solo_admin), sin
-- tocarlas -- así se le puede dar a cualquier cuenta capacidad de
-- ver/registrar/aprobar permisos ajenos sin pasar por el grupo GESTION
-- HUMANA.
-- ---------------------------------------------------------------------------

create policy "permiso_ver_permisos_solicitudes" on permisos_solicitudes for select
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'ver'));
create policy "permiso_agregar_permisos_solicitudes" on permisos_solicitudes for insert
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'agregar'));
create policy "permiso_editar_permisos_solicitudes" on permisos_solicitudes for update
  using (auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'editar'))
  with check (auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'editar'));

-- ---------------------------------------------------------------------------
-- Storage: mismo patrón "for all" que ya usan los demás buckets de Kardex.
-- Para el bucket, alcanza con "ver" o "agregar" sobre el módulo dueño (no
-- hay UI que distinga editar/borrar un archivo ya subido, salvo Facturas).
-- ---------------------------------------------------------------------------

create policy "permiso_rw_hojas_vida" on storage.objects for all
  using (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and (
    kardex_tiene_permiso('aspirantes', 'ver') or kardex_tiene_permiso('aspirantes', 'agregar')
  ))
  with check (bucket_id = 'hojas-vida' and auth.role() = 'authenticated' and kardex_tiene_permiso('aspirantes', 'agregar'));

create policy "permiso_rw_fotos_empleados" on storage.objects for all
  using (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and (
    kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('empleados', 'agregar')
  ))
  with check (bucket_id = 'fotos-empleados' and auth.role() = 'authenticated' and kardex_tiene_permiso('empleados', 'agregar'));

create policy "permiso_rw_firmas" on storage.objects for all
  using (bucket_id = 'firmas' and auth.role() = 'authenticated' and (
    kardex_tiene_permiso('salida', 'agregar') or kardex_tiene_permiso('historial', 'ver')
  ))
  with check (bucket_id = 'firmas' and auth.role() = 'authenticated' and kardex_tiene_permiso('salida', 'agregar'));

create policy "permiso_rw_fotos_entrega" on storage.objects for all
  using (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and (
    kardex_tiene_permiso('salida', 'agregar') or kardex_tiene_permiso('historial', 'ver')
  ))
  with check (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and kardex_tiene_permiso('salida', 'agregar'));

create policy "permiso_rw_facturas_bucket" on storage.objects for all
  using (bucket_id = 'facturas' and auth.role() = 'authenticated' and (
    kardex_tiene_permiso('facturas', 'ver') or kardex_tiene_permiso('facturas', 'agregar')
  ))
  with check (bucket_id = 'facturas' and auth.role() = 'authenticated' and kardex_tiene_permiso('facturas', 'agregar'));

create policy "permiso_rw_permisos_soportes" on storage.objects for all
  using (bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'ver'))
  with check (bucket_id = 'permisos-soportes' and auth.role() = 'authenticated' and kardex_tiene_permiso('permisos-vacaciones', 'agregar'));

-- ---------------------------------------------------------------------------
-- anular_movimiento: hallazgo de seguridad de paso -- esta función (security
-- definer, otorgada a "authenticated" sin distinción) no tenía NINGÚN
-- chequeo de autorización adentro, así que cualquier usuario autenticado de
-- CUALQUIER programa del proyecto compartido podía llamarla y anular un
-- movimiento de Kardex. Se recrea completa (mismo cuerpo de sql/schema.sql)
-- agregando el chequeo al inicio.
-- ---------------------------------------------------------------------------

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
  if not (kardex_is_authorized() or kardex_tiene_permiso('historial', 'borrar')) then
    raise exception 'No autorizado';
  end if;

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
