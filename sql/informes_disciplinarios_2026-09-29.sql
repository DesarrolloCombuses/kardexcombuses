-- ============================================================================
-- Kardex / ERP Combuses -- Informe tecnico disciplinario (formato FO-GH-06)
--
-- Gestion Humana venia llenando el formato a mano en Word: se buscaba a la
-- persona en otra parte, se copiaban nombre/cedula/area/cargo, y el archivo
-- quedaba suelto en una carpeta. Aca queda como modulo: se elige el empleado,
-- los cuatro datos del encabezado salen de su ficha, la evidencia se adjunta
-- en el mismo registro y el informe imprimible se genera desde la app.
--
-- GESTION HUMANA tiene acceso de arranque (kardex_es_gestion_humana(), igual
-- que el modulo de Actividades): FO-GH-06 es un formato suyo, no tiene
-- sentido que haya que darle el permiso aparte. Las demas cuentas entran solo
-- con el permiso del modulo 'informes-disciplinarios'.
--
-- Seguro de re-ejecutar (create ... if not exists, y las policies se dropean
-- antes de crearse).
-- ============================================================================

create table if not exists kardex_informes_disciplinarios (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),

  -- Copia de los datos del empleado tal como estaban el dia del informe. NO
  -- se leen de employees al imprimir: esto es un documento que se firma, y si
  -- manana la persona cambia de cargo o de area, el papel que ya se firmo
  -- tiene que seguir diciendo lo que decia ese dia.
  empleado_nombre text not null,
  empleado_cedula text not null,
  empleado_area text,
  empleado_cargo text,

  fecha_hechos date not null,
  fecha_entrega date,
  lugar_hechos text,
  tipo_novedad text,

  descripcion_hechos text not null,
  evidencia text,
  observaciones text,

  -- Punto 6 del formato: quien recibe el informe (nombre y cargo). Las
  -- firmas en si van en blanco -- se firman a mano sobre el impreso.
  recibe_nombre text,
  recibe_cargo text,

  creado_por_email text not null,
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Las dos fechas se digitan a mano y se confunden facil entre ellas. Que
  -- la entrega quede antes de los hechos no es un caso raro: es el dedazo
  -- tipico, y sin esto solo se descubre cuando el informe ya esta firmado.
  constraint informes_disc_entrega_no_anterior
    check (fecha_entrega is null or fecha_entrega >= fecha_hechos)
);

-- El listado se filtra por empleado (cuantos informes lleva) y se ordena por
-- fecha de los hechos.
create index if not exists idx_informes_disc_employee
  on kardex_informes_disciplinarios (employee_id);
create index if not exists idx_informes_disc_fecha
  on kardex_informes_disciplinarios (fecha_hechos desc);

-- Punto 3 del formato (Evidencia): el recuadro de texto vive en la tabla de
-- arriba; los archivos van aparte porque son varios por informe (fotos del
-- hecho, el comparendo en PDF, el pantallazo del reporte).
create table if not exists kardex_informes_disciplinarios_archivos (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid not null references kardex_informes_disciplinarios(id) on delete cascade,
  archivo_url text not null,
  archivo_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists idx_informes_disc_archivos_informe
  on kardex_informes_disciplinarios_archivos (informe_id);

-- ---------------------------------------------------------------------------
-- Permisos por modulo
-- ---------------------------------------------------------------------------
-- La lista se copia de la que HAY en produccion (se consulta pg_constraint,
-- no el .sql mas reciente por fecha del nombre: ya paso una vez que el
-- archivo y la base no coincidieran).
--
-- Si la base tuviera un modulo que esta lista no trae, el "add constraint" de
-- abajo falla con el mensaje genérico de Postgres ("is violated by some row"),
-- que no dice cual. Este bloque revisa antes y lo nombra -- no cambia nada,
-- solo hace que el error se pueda arreglar sin adivinar.
do $$
declare
  v_faltantes text;
begin
  select string_agg(distinct modulo, ', ')
    into v_faltantes
  from kardex_permisos_usuario
  where modulo not in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos',
    'lineas-celulares',
    'informes-disciplinarios'
  );

  if v_faltantes is not null then
    raise exception 'Hay permisos guardados de modulos que no estan en la lista nueva: %. Agregalos al check antes de correr esto.', v_faltantes;
  end if;
end $$;

alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard',
    'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos',
    'lineas-celulares',
    'informes-disciplinarios'
  ));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table kardex_informes_disciplinarios enable row level security;
alter table kardex_informes_disciplinarios_archivos enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'kardex_informes_disciplinarios', 'kardex_informes_disciplinarios_archivos'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);

    execute format($f$
      create policy %I on %I for select to authenticated
      using (kardex_es_gestion_humana() or kardex_tiene_permiso('informes-disciplinarios', 'ver'))
    $f$, t || '_sel', t);

    execute format($f$
      create policy %I on %I for update to authenticated
      using (kardex_es_gestion_humana() or kardex_tiene_permiso('informes-disciplinarios', 'editar'))
      with check (kardex_es_gestion_humana() or kardex_tiene_permiso('informes-disciplinarios', 'editar'))
    $f$, t || '_upd', t);
  end loop;
end $$;

-- Insert y delete NO son iguales en las dos tablas, asi que van por fuera
-- del bucle.
drop policy if exists kardex_informes_disciplinarios_ins on kardex_informes_disciplinarios;
create policy kardex_informes_disciplinarios_ins on kardex_informes_disciplinarios
  for insert to authenticated
  with check (kardex_es_gestion_humana() or kardex_tiene_permiso('informes-disciplinarios', 'agregar'));

drop policy if exists kardex_informes_disciplinarios_del on kardex_informes_disciplinarios;
create policy kardex_informes_disciplinarios_del on kardex_informes_disciplinarios
  for delete to authenticated
  using (kardex_es_gestion_humana() or kardex_tiene_permiso('informes-disciplinarios', 'borrar'));

-- Un archivo de evidencia nunca se agrega ni se quita "por si solo": se
-- adjunta al crear el informe (agregar) o al corregirlo despues (editar).
-- Si su insert exigiera solo 'agregar', una cuenta con permiso de editar
-- podria cambiar la descripcion pero no sumar la foto que falta -- y si su
-- delete exigiera 'borrar', no podria quitar la que subio equivocada sin
-- que ademas se le diera permiso para borrar informes completos. Es el
-- mismo caso que ya se comprobo en lineas celulares con las tablas de
-- historico (ver sql/lineas_celulares_2026-09-25.sql).
drop policy if exists kardex_informes_disciplinarios_archivos_ins on kardex_informes_disciplinarios_archivos;
create policy kardex_informes_disciplinarios_archivos_ins on kardex_informes_disciplinarios_archivos
  for insert to authenticated
  with check (kardex_es_gestion_humana()
              or kardex_tiene_permiso('informes-disciplinarios', 'agregar')
              or kardex_tiene_permiso('informes-disciplinarios', 'editar'));

drop policy if exists kardex_informes_disciplinarios_archivos_del on kardex_informes_disciplinarios_archivos;
create policy kardex_informes_disciplinarios_archivos_del on kardex_informes_disciplinarios_archivos
  for delete to authenticated
  using (kardex_es_gestion_humana()
         or kardex_tiene_permiso('informes-disciplinarios', 'borrar')
         or kardex_tiene_permiso('informes-disciplinarios', 'editar'));

-- ---------------------------------------------------------------------------
-- Storage: archivos de evidencia
-- ---------------------------------------------------------------------------
-- Bucket propio de Kardex. OJO: en este mismo Supabase ya existe un bucket
-- "pruebas-disciplinarias" que pertenece a otra app (Portal de Documentos);
-- no se toca ni se reusa.
--
-- Se organiza por carpeta = employee_id (al crear el informe su id todavia
-- no existe, y agrupar por persona sirve igual). La carpeta NO es el control
-- de acceso, a diferencia de permisos-soportes, donde el empleado sube a su
-- propia carpeta: aca solo escribe Gestion Humana, y lo que manda es el
-- permiso del modulo.
insert into storage.buckets (id, name, public)
values ('informes-disciplinarios', 'informes-disciplinarios', false)
on conflict (id) do nothing;

drop policy if exists "rw_informes_disciplinarios" on storage.objects;
create policy "rw_informes_disciplinarios" on storage.objects for all to authenticated
  using (
    bucket_id = 'informes-disciplinarios' and (
      kardex_es_gestion_humana()
      or kardex_tiene_permiso('informes-disciplinarios', 'ver')
    )
  )
  with check (
    bucket_id = 'informes-disciplinarios' and (
      kardex_es_gestion_humana()
      or kardex_tiene_permiso('informes-disciplinarios', 'agregar')
      or kardex_tiene_permiso('informes-disciplinarios', 'editar')
    )
  );

-- ---------------------------------------------------------------------------
-- Guardar el informe completo (encabezado + archivos) en una sola operacion
-- ---------------------------------------------------------------------------
-- Es funcion y no varias llamadas desde el cliente porque el encabezado y sus
-- archivos tienen que quedar juntos: si el navegador se cierra entre el
-- insert del informe y el de sus evidencias, queda un informe que dice
-- "evidencia: ver fotos adjuntas" sin ninguna foto adjunta.
--
-- p_archivos: jsonb array de {url, nombre}. Las rutas ya vienen subidas al
-- bucket por el cliente (el storage no se puede escribir desde plpgsql).
create or replace function kardex_informe_disciplinario_guardar(
  p_informe jsonb,
  p_archivos jsonb default '[]'::jsonb,
  p_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  a jsonb;
begin
  if p_id is null then
    insert into kardex_informes_disciplinarios (
      employee_id, empleado_nombre, empleado_cedula, empleado_area, empleado_cargo,
      fecha_hechos, fecha_entrega, lugar_hechos, tipo_novedad,
      descripcion_hechos, evidencia, observaciones,
      recibe_nombre, recibe_cargo, creado_por_email, creado_por_nombre
    ) values (
      (p_informe ->> 'employee_id')::uuid,
      p_informe ->> 'empleado_nombre',
      p_informe ->> 'empleado_cedula',
      p_informe ->> 'empleado_area',
      p_informe ->> 'empleado_cargo',
      (p_informe ->> 'fecha_hechos')::date,
      nullif(p_informe ->> 'fecha_entrega', '')::date,
      p_informe ->> 'lugar_hechos',
      p_informe ->> 'tipo_novedad',
      p_informe ->> 'descripcion_hechos',
      p_informe ->> 'evidencia',
      p_informe ->> 'observaciones',
      p_informe ->> 'recibe_nombre',
      p_informe ->> 'recibe_cargo',
      v_email,
      p_informe ->> 'creado_por_nombre'
    )
    returning id into v_id;
  else
    v_id := p_id;
    -- employee_id y los datos copiados del empleado NO se reescriben: si el
    -- informe se hizo a nombre de otra persona, eso no es una correccion de
    -- redaccion, es un informe distinto.
    update kardex_informes_disciplinarios set
      fecha_hechos = (p_informe ->> 'fecha_hechos')::date,
      fecha_entrega = nullif(p_informe ->> 'fecha_entrega', '')::date,
      lugar_hechos = p_informe ->> 'lugar_hechos',
      tipo_novedad = p_informe ->> 'tipo_novedad',
      descripcion_hechos = p_informe ->> 'descripcion_hechos',
      evidencia = p_informe ->> 'evidencia',
      observaciones = p_informe ->> 'observaciones',
      recibe_nombre = p_informe ->> 'recibe_nombre',
      recibe_cargo = p_informe ->> 'recibe_cargo',
      updated_at = now()
    where id = v_id;

    if not found then
      raise exception 'El informe % no existe o no tienes permiso para editarlo.', v_id;
    end if;
  end if;

  for a in select * from jsonb_array_elements(coalesce(p_archivos, '[]'::jsonb)) loop
    insert into kardex_informes_disciplinarios_archivos (informe_id, archivo_url, archivo_nombre)
    values (v_id, a ->> 'url', a ->> 'nombre');
  end loop;

  return v_id;
end;
$$;

revoke all on function kardex_informe_disciplinario_guardar(jsonb, jsonb, uuid) from public;
grant execute on function kardex_informe_disciplinario_guardar(jsonb, jsonb, uuid) to authenticated;
