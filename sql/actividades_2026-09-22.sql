-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Modulo nuevo "Actividades": crear una actividad (ej. "Entrega de entradas
-- Comfama - Diciembre 2026") y registrar, por cada empleado que recibe algo
-- en esa actividad, quien la registro, con foto y firma del receptor --
-- mismo patron ya usado en Salida (ver js/views/salida.js: SignaturePad +
-- CameraCapture + buckets firmas/fotos-entrega), generalizado a cualquier
-- tipo de actividad en vez de solo entrega de prendas de inventario.
--
-- Decision confirmada con el usuario (2026-09-22): el receptor SIEMPRE es un
-- empleado de la planta (se busca y selecciona, no se escribe a mano) -- el
-- registro queda relacionado a employees.id, no con datos sueltos.
--
-- A proposito NO hay policy de update/delete en ninguna de las 2 tablas
-- nuevas (mismo criterio de auditabilidad que kardex_movements/
-- kardex_movement_items -- ver sql/permisos_granulares_2026-09-16.sql): un
-- registro no se edita ni se borra desde la app. Si mas adelante se pide
-- poder "anular" un registro, es un cambio aparte.
--
-- GESTION HUMANA tiene acceso de arranque (kardex_es_gestion_humana(), igual
-- que el resto del dominio de Personal) -- coordinar este tipo de entregas
-- (Comfama, bienestar) es tipicamente de RRHH. No hace falta agregarlo a la
-- policy de employees: ya lo cubre la policy "authenticated_all" ampliada en
-- sql/gestion_humana_modulos_2026-09-16.sql.
--
-- Repetible sin riesgo.
-- ============================================================================

create table if not exists kardex_actividades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  fecha date not null default current_date,
  creado_por_email text not null,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);

alter table kardex_actividades enable row level security;

drop policy if exists "permiso_ver_actividades" on kardex_actividades;
create policy "permiso_ver_actividades" on kardex_actividades for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana()
    or kardex_tiene_permiso('actividades', 'ver') or kardex_tiene_permiso('actividades', 'agregar')
  ));

drop policy if exists "permiso_agregar_actividades" on kardex_actividades;
create policy "permiso_agregar_actividades" on kardex_actividades for insert
  with check (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar')
  ));

create table if not exists kardex_actividad_registros (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references kardex_actividades(id) on delete cascade,
  employee_id uuid not null references employees(id),
  -- Texto libre opcional para lo que se entregó puntualmente (ej. "2
  -- entradas parque" o "boleta #045") -- la actividad ya trae el nombre
  -- general (ej. "Entrega de entradas Comfama"), esto es el detalle por
  -- persona cuando hace falta.
  detalle text,
  firma_url text,
  foto_url text,
  registrado_por_email text not null,
  registrado_por_nombre text,
  created_at timestamptz not null default now()
);

alter table kardex_actividad_registros enable row level security;

drop policy if exists "permiso_ver_actividad_registros" on kardex_actividad_registros;
create policy "permiso_ver_actividad_registros" on kardex_actividad_registros for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'ver')
  ));

drop policy if exists "permiso_agregar_actividad_registros" on kardex_actividad_registros;
create policy "permiso_agregar_actividad_registros" on kardex_actividad_registros for insert
  with check (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar')
  ));

-- Aditivas sobre tablas/buckets ya existentes (ninguna policy existente se
-- toca): esta cuenta necesita poder leer la planta para buscar al receptor,
-- y escribir en los mismos buckets de evidencia que ya usa Salida.
drop policy if exists "permiso_ver_employees_actividades" on employees;
create policy "permiso_ver_employees_actividades" on employees for select
  using (auth.role() = 'authenticated' and (
    kardex_tiene_permiso('actividades', 'ver') or kardex_tiene_permiso('actividades', 'agregar')
  ));

drop policy if exists "permiso_rw_firmas_actividades" on storage.objects;
create policy "permiso_rw_firmas_actividades" on storage.objects for all
  using (bucket_id = 'firmas' and auth.role() = 'authenticated' and (
    kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar') or kardex_tiene_permiso('actividades', 'ver')
  ))
  with check (bucket_id = 'firmas' and auth.role() = 'authenticated' and (
    kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar')
  ));

drop policy if exists "permiso_rw_fotos_entrega_actividades" on storage.objects;
create policy "permiso_rw_fotos_entrega_actividades" on storage.objects for all
  using (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and (
    kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar') or kardex_tiene_permiso('actividades', 'ver')
  ))
  with check (bucket_id = 'fotos-entrega' and auth.role() = 'authenticated' and (
    kardex_es_gestion_humana() or kardex_tiene_permiso('actividades', 'agregar')
  ));

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades'
  ));
