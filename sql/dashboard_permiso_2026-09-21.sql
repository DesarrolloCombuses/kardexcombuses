-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Agrega "Panel" (Dashboard) a la matriz de permisos granulares (ver
-- sql/permisos_granulares_2026-09-16.sql): era la unica vista registrada en
-- el Router sin manera de dársela a una cuenta de grupo/empleado -- se
-- detecto porque en Usuarios > "Editar permisos" no aparecia como opcion
-- asignable (a diferencia de 'usuarios'/'mis-permisos'/'ayuda', que SI
-- quedan fuera a proposito, ver el comentario de SECCIONES_PERMISOS en
-- js/views/usuarios.js).
--
-- A diferencia de los demas modulos, el Dashboard no tiene una tabla propia:
-- mezcla stock (item_variants/item_categories), empleados activos (solo el
-- conteo) y los ultimos movimientos (kardex_movements + employees +
-- kardex_movement_items). Dar "ver" ahi vía las policies RLS de siempre
-- (kardex_tiene_permiso('dashboard','ver') en cada tabla) le abriria a esa
-- cuenta la fila COMPLETA de employees por REST directo (no solo el conteo
-- que muestra la pantalla) -- incluye cedula/salario/telefono, no solo lo
-- que pinta el Panel. En vez de eso, kardex_dashboard_kpis() hace el mismo
-- calculo que hacia el cliente (js/views/dashboard.js) pero adentro de una
-- funcion security definer que solo devuelve los campos agregados que la
-- pantalla necesita -- mismo patron que kardex_empleados_con_perfil (filtra
-- antes de devolver, no expone la tabla base).
--
-- Nota: la suscripcion Realtime del Dashboard (DB.subscribeToChanges sobre
-- item_variants/kardex_movements/kardex_movement_items/employees, ver
-- js/views/dashboard.js) sigue leyendo directo de esas tablas -- una cuenta
-- que SOLO tenga 'dashboard':'ver' (sin 'inventario'/'historial'/'empleados')
-- puede no recibir el push de "hay un cambio, recalcula" en vivo (Realtime
-- respeta RLS), pero al entrar a la vista o recargar sí ve los datos
-- correctos siempre, vía esta función. No se considera necesario resolver
-- ese caso hoy (nadie lo pidió); documentado por si alguien lo nota.
--
-- Repetible sin riesgo.
-- ============================================================================

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'permisos-vacaciones', 'siniestros-transito', 'parque-automotor',
    'alertas-vencimientos'
  ));

create or replace function kardex_dashboard_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_categorias int;
  v_stock_total int;
  v_empleados int;
  v_bajo_stock jsonb;
  v_recientes jsonb;
begin
  if not coalesce(kardex_is_authorized() or kardex_tiene_permiso('dashboard', 'ver'), false) then
    raise exception 'No autorizado';
  end if;

  select count(distinct c.id), coalesce(sum(v.stock_actual), 0)
    into v_categorias, v_stock_total
    from item_categories c join item_variants v on v.item_category_id = c.id;

  select count(*) into v_empleados from employees where activo = true;

  -- Mismo umbral (5) que _UMBRAL_BAJO en js/views/dashboard.js -- el umbral
  -- "crítico" (2) es solo de presentación, se sigue calculando en el cliente
  -- sobre este mismo array.
  select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'talla', talla, 'stock_actual', stock_actual)), '[]'::jsonb)
    into v_bajo_stock
    from (
      select c.nombre as categoria, v.talla, v.stock_actual
      from item_categories c join item_variants v on v.item_category_id = c.id
      where v.stock_actual <= 5
      order by v.stock_actual asc
    ) sub;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'fecha', m.fecha, 'tipo', m.tipo, 'anulado', m.anulado,
      'empleado_nombre', e.nombre, 'lineas', coalesce(li.n, 0)
    )), '[]'::jsonb)
    into v_recientes
    from (
      select * from kardex_movements order by fecha desc limit 8
    ) m
    left join employees e on e.id = m.employee_id
    left join lateral (select count(*) as n from kardex_movement_items mi where mi.movement_id = m.id) li on true;

  return jsonb_build_object(
    'categorias', v_categorias,
    'stock_total', v_stock_total,
    'empleados_activos', v_empleados,
    'bajo_stock', v_bajo_stock,
    'movimientos_recientes', v_recientes
  );
end;
$$;

revoke all on function kardex_dashboard_kpis() from public;
grant execute on function kardex_dashboard_kpis() to authenticated;
