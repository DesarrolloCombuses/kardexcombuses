-- ============================================================================
-- Kardex / ERP Combuses -- Procesos disciplinarios
--
-- Trae al ERP el modulo que vivia en el programa aparte "Procesos
-- Disciplinarios" (mismo Supabase, repo DesarrolloCombuses/procesosdisciplinarios).
-- Alla el proceso completo vivia en una sola columna `datos jsonb` de la tabla
-- `procesos_disciplinarios`, con todas las fechas como texto "dd/mm/aaaa" y el
-- empleado copiado de un Google Sheet publicado. Aca queda con columnas
-- tipadas, fechas date/time de verdad y el empleado enlazado a employees.
--
-- La tabla vieja NO se toca ni se borra: el otro programa sigue funcionando
-- hasta que se decida apagarlo. Esta migracion COPIA, no mueve.
--
-- GESTION HUMANA tiene acceso de arranque (kardex_es_gestion_humana(), igual
-- que Actividades e Informes disciplinarios). Las demas cuentas entran solo
-- con el permiso del modulo 'procesos-disciplinarios'.
--
-- Seguro de re-ejecutar: las tablas usan if not exists, las policies se
-- dropean antes de crearse, y la copia de datos es un upsert por origen_key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fechas del programa viejo
-- ---------------------------------------------------------------------------
-- Vienen como texto libre: la mayoria "24/07/2025", algunas ya en ISO, y
-- varias vacias. to_date() revienta con cualquier basura, asi que se envuelve
-- -- un proceso con una fecha mal escrita no puede tumbar toda la migracion.
create or replace function kardex_pd_fecha(p_texto text)
returns date
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if v is null then return null; end if;
  begin
    if v ~ '^\d{4}-\d{2}-\d{2}' then
      return substring(v from 1 for 10)::date;
    elsif v ~ '^\d{1,2}/\d{1,2}/\d{4}' then
      return to_date(substring(v from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY');
    elsif v ~ '^\d{1,2}/\d{1,2}/\d{2}$' then
      return to_date(v, 'DD/MM/YY');
    end if;
  exception when others then
    return null;
  end;
  return null;
end;
$$;

create or replace function kardex_pd_hora(p_texto text)
returns time
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if v is null then return null; end if;
  begin
    return v::time;
  exception when others then
    return null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- El proceso
-- ---------------------------------------------------------------------------
create table if not exists kardex_procesos_disciplinarios (
  id uuid primary key default gen_random_uuid(),

  -- La clave que tenia el proceso en el programa viejo. Sirve para dos cosas:
  -- que la migracion se pueda repetir sin duplicar, y poder rastrear un
  -- documento ya firmado hasta su origen.
  origen_key text unique,

  -- Enlace al empleado cuando se pudo resolver por cedula. Puede quedar nulo:
  -- hay procesos de gente que ya no esta en employees, y perder el proceso por
  -- eso seria peor que guardarlo sin enlace.
  employee_id uuid references employees(id),

  -- Copia de los datos de la persona tal como estaban el dia del proceso. Es
  -- la misma razon que en los informes FO-GH-06: son documentos que se firman,
  -- y si manana cambia de cargo o de ruta, el papel firmado tiene que seguir
  -- diciendo lo que decia.
  empleado_cedula text not null,
  empleado_nombre text,
  empleado_cargo text,
  empleado_area text,
  empleado_interno text,
  empleado_ruta text,
  empleado_fecha_ingreso date,
  vehiculo_propietario text,
  celular text,
  correo text,

  -- 1) Hechos y citacion
  fecha_hechos date,
  motivo text,
  normas text,                      -- articulos del RIT que se citan
  pruebas_texto text,               -- descripcion de las pruebas
  falta text,                       -- falta del catalogo (Art. 108)
  falta_numero integer,
  sancion_primera text,             -- la escala de la falta, copiada al proceso
  sancion_segunda text,
  sancion_tercera text,
  sancion_cuarta text,
  fecha_citacion date,
  hora_citacion time,

  -- 2) Diligencia de descargos
  asistencia text check (asistencia in ('si', 'no') or asistencia is null),
  fecha_descargos date,
  hora_descargos_inicio time,
  hora_descargos_fin time,
  acta_descargos text,              -- el cuestionario de preguntas y respuestas
  dirige_descargos text,

  -- 3) Decision
  tipo_decision text,               -- invitacion | llamado | suspension | terminacion
  antecedentes text,
  resumen_descargos text,
  consideraciones text,
  compromisos text,
  numerales_sancion text,
  dias_suspension text,
  fecha_inicio_sancion date,
  fecha_fin_sancion date,
  fecha_reintegro date,
  recurso_ante text,
  recurso_dias text,

  -- Firmas recogidas (rutas en el bucket). La evidencia legal de cada firma
  -- (hora del servidor, huella del documento, dispositivo, testigo) va en
  -- kardex_procesos_disc_firmas, no aca.
  firma_citacion text,
  firma_descargos text,
  firma_decision text,

  estado text not null default 'citacion'
    check (estado in ('citacion', 'descargos', 'decision', 'finalizado', 'cancelado')),
  responsable text,
  asunto text,

  creado_por_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pd_employee on kardex_procesos_disciplinarios (employee_id);
create index if not exists idx_pd_cedula on kardex_procesos_disciplinarios (empleado_cedula);
create index if not exists idx_pd_estado on kardex_procesos_disciplinarios (estado);
create index if not exists idx_pd_fecha on kardex_procesos_disciplinarios (fecha_citacion desc);

-- ---------------------------------------------------------------------------
-- Pruebas (fotos, videos, PDF)
-- ---------------------------------------------------------------------------
create table if not exists kardex_procesos_disc_pruebas (
  id uuid primary key default gen_random_uuid(),
  proceso_id uuid not null references kardex_procesos_disciplinarios(id) on delete cascade,
  archivo_url text not null,
  archivo_nombre text,
  creado_por_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pd_pruebas_proceso on kardex_procesos_disc_pruebas (proceso_id);

-- ---------------------------------------------------------------------------
-- Evidencia de cada firma (Ley 527/1999, Decreto 2364/2012)
-- ---------------------------------------------------------------------------
-- Una firma sin esto es un dibujo. Lo que le da valor es poder decir QUE
-- documento se firmo (huella), CUANDO segun el servidor -- no segun el reloj
-- del equipo, que el firmante puede cambiar --, QUIEN la recogio, y si no
-- firmo, por que y quien lo atestigua.
create table if not exists kardex_procesos_disc_firmas (
  id uuid primary key default gen_random_uuid(),
  proceso_id uuid not null references kardex_procesos_disciplinarios(id) on delete cascade,
  documento text not null check (documento in ('citacion', 'descargos', 'decision')),

  estado text not null check (estado in ('firmo', 'no_firmo', 'ausente')),
  motivo_no_firma text,

  firma_url text,                   -- imagen de la firma en el bucket
  documento_huella text,            -- sha-256 del HTML exacto que se firmo
  firmante_nombre text,
  firmante_cedula text,

  -- Hora del SERVIDOR (default now()), no la que mande el navegador.
  firmado_en timestamptz not null default now(),
  operador_email text,              -- quien recogio la firma, con su sesion
  testigo_nombre text,
  testigo_cedula text,
  dispositivo text,

  created_at timestamptz not null default now()
);

create index if not exists idx_pd_firmas_proceso on kardex_procesos_disc_firmas (proceso_id);

-- ---------------------------------------------------------------------------
-- Permisos por modulo
-- ---------------------------------------------------------------------------
-- Misma revision previa que en informes disciplinarios: si la base tuviera un
-- modulo que esta lista no trae, el add constraint falla con un mensaje que no
-- dice cual. Este bloque lo nombra.
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
    'informes-disciplinarios',
    'procesos-disciplinarios'
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
    'informes-disciplinarios',
    'procesos-disciplinarios'
  ));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A diferencia de la tabla vieja (`procesos_disciplinarios`, con la policy
-- "app_authenticated_all ... using (true)", o sea CUALQUIER cuenta con sesion
-- en este Supabase -- incluidos los cientos de empleados que entran al ERP por
-- "Mi perfil"), aca manda el permiso del modulo.
alter table kardex_procesos_disciplinarios enable row level security;
alter table kardex_procesos_disc_pruebas enable row level security;
alter table kardex_procesos_disc_firmas enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'kardex_procesos_disciplinarios', 'kardex_procesos_disc_pruebas', 'kardex_procesos_disc_firmas'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);

    execute format($f$
      create policy %I on %I for select to authenticated
      using (kardex_es_gestion_humana() or kardex_tiene_permiso('procesos-disciplinarios', 'ver'))
    $f$, t || '_sel', t);

    execute format($f$
      create policy %I on %I for update to authenticated
      using (kardex_es_gestion_humana() or kardex_tiene_permiso('procesos-disciplinarios', 'editar'))
      with check (kardex_es_gestion_humana() or kardex_tiene_permiso('procesos-disciplinarios', 'editar'))
    $f$, t || '_upd', t);
  end loop;
end $$;

-- El proceso en si: agregar y borrar son del permiso que les toca.
drop policy if exists kardex_procesos_disciplinarios_ins on kardex_procesos_disciplinarios;
create policy kardex_procesos_disciplinarios_ins on kardex_procesos_disciplinarios
  for insert to authenticated
  with check (kardex_es_gestion_humana() or kardex_tiene_permiso('procesos-disciplinarios', 'agregar'));

drop policy if exists kardex_procesos_disciplinarios_del on kardex_procesos_disciplinarios;
create policy kardex_procesos_disciplinarios_del on kardex_procesos_disciplinarios
  for delete to authenticated
  using (kardex_es_gestion_humana() or kardex_tiene_permiso('procesos-disciplinarios', 'borrar'));

-- Pruebas y firmas se agregan SIEMPRE como parte de avanzar un proceso que ya
-- existe, nunca por si solas: adjuntar la foto que falta o recoger la firma de
-- la citacion es editar el proceso. Si exigieran 'agregar', una cuenta con
-- permiso de editar podria cambiar el motivo pero no adjuntar la prueba --
-- mismo caso ya comprobado en lineas celulares.
drop policy if exists kardex_procesos_disc_pruebas_ins on kardex_procesos_disc_pruebas;
create policy kardex_procesos_disc_pruebas_ins on kardex_procesos_disc_pruebas
  for insert to authenticated
  with check (kardex_es_gestion_humana()
              or kardex_tiene_permiso('procesos-disciplinarios', 'agregar')
              or kardex_tiene_permiso('procesos-disciplinarios', 'editar'));

drop policy if exists kardex_procesos_disc_pruebas_del on kardex_procesos_disc_pruebas;
create policy kardex_procesos_disc_pruebas_del on kardex_procesos_disc_pruebas
  for delete to authenticated
  using (kardex_es_gestion_humana()
         or kardex_tiene_permiso('procesos-disciplinarios', 'borrar')
         or kardex_tiene_permiso('procesos-disciplinarios', 'editar'));

drop policy if exists kardex_procesos_disc_firmas_ins on kardex_procesos_disc_firmas;
create policy kardex_procesos_disc_firmas_ins on kardex_procesos_disc_firmas
  for insert to authenticated
  with check (kardex_es_gestion_humana()
              or kardex_tiene_permiso('procesos-disciplinarios', 'agregar')
              or kardex_tiene_permiso('procesos-disciplinarios', 'editar'));

-- Una firma NO se borra ni se edita: es la evidencia de que alguien firmo algo
-- en un momento. Si se recogio mal, se recoge otra y queda el rastro de las
-- dos. Por eso esta tabla no tiene policy de delete -- a proposito.

-- ---------------------------------------------------------------------------
-- Storage: pruebas y firmas del proceso
-- ---------------------------------------------------------------------------
-- Bucket propio. El viejo ('pruebas-disciplinarias', del otro programa) se
-- deja como esta; sus policies dejan leer a cualquier cuenta autenticada, que
-- es justamente lo que no queremos repetir.
insert into storage.buckets (id, name, public)
values ('procesos-disciplinarios', 'procesos-disciplinarios', false)
on conflict (id) do nothing;

drop policy if exists "rw_procesos_disciplinarios" on storage.objects;
create policy "rw_procesos_disciplinarios" on storage.objects for all to authenticated
  using (
    bucket_id = 'procesos-disciplinarios' and (
      kardex_es_gestion_humana()
      or kardex_tiene_permiso('procesos-disciplinarios', 'ver')
    )
  )
  with check (
    bucket_id = 'procesos-disciplinarios' and (
      kardex_es_gestion_humana()
      or kardex_tiene_permiso('procesos-disciplinarios', 'agregar')
      or kardex_tiene_permiso('procesos-disciplinarios', 'editar')
    )
  );

-- ---------------------------------------------------------------------------
-- Copiar los procesos del programa viejo
-- ---------------------------------------------------------------------------
-- La tabla vieja guarda cada proceso de dos formas segun de donde venga:
--   * creados por la app  -> todo en la columna `datos` (jsonb), nombres en
--     camelCase: fechaCitacion, horaCitacion, correoNotificacion...
--   * importados historicos -> en columnas sueltas de la propia tabla.
-- Se prefiere `datos` cuando existe (es lo que hace deSupabase() en el
-- programa viejo) y se cae a las columnas cuando no.
--
-- No se borra nada alla. Si un proceso ya se copio, se actualiza en vez de
-- duplicarse (unique en origen_key).
create or replace function kardex_pd_importar()
returns table (copiados integer, con_empleado integer, sin_empleado integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_copiados integer := 0;
begin
  if not coalesce(kardex_es_gestion_humana()
                  or kardex_tiene_permiso('procesos-disciplinarios', 'agregar'), false) then
    raise exception 'No autorizado para importar procesos disciplinarios.';
  end if;

  -- La fila entera se lee como jsonb (fila) en vez de por nombre de columna.
  -- La tabla vieja tiene un juego de columnas que no controlamos -- los
  -- historicos se importaron con las suyas -- y referenciar una que no exista
  -- impide hasta crear esta funcion. Con ->> una columna ausente da null y la
  -- migracion sigue.
  with viejo as (
    select
      pv.key as origen_key,
      pv.datos as d,
      to_jsonb(pv) as fila
    from procesos_disciplinarios pv
    where pv.key is not null
  ),
  campos as (
    select
      origen_key,
      coalesce(nullif(d ->> 'cc', ''), fila ->> 'cc') as cedula,
      coalesce(nullif(d ->> 'nombre', ''), fila ->> 'nombre') as nombre,
      coalesce(nullif(d ->> 'cargo', ''), fila ->> 'cargo') as cargo,
      coalesce(nullif(d ->> 'area', ''), fila ->> 'area') as area,
      coalesce(nullif(d ->> 'interno', ''), fila ->> 'interno') as interno,
      coalesce(nullif(d ->> 'ruta', ''), fila ->> 'ruta') as ruta,
      coalesce(nullif(d ->> 'propietario', ''), fila ->> 'propietario') as propietario,
      coalesce(nullif(d ->> 'fechaIngreso', ''), fila ->> 'fecha_ingreso') as fecha_ingreso,
      coalesce(nullif(d ->> 'celularCitado', ''), nullif(d ->> 'celular', ''),
               nullif(d ->> 'celularAfiliado', ''), fila ->> 'celular') as celular,
      coalesce(nullif(d ->> 'correoCitado', ''), nullif(d ->> 'correoNotificacion', ''),
               nullif(d ->> 'correoAfiliado', ''), fila ->> 'correo_notificacion') as correo,
      coalesce(nullif(d ->> 'motivo', ''), fila ->> 'motivo') as motivo,
      coalesce(nullif(d ->> 'reglamento', ''), fila ->> 'reglamento_interno_trabajo') as normas,
      coalesce(nullif(d ->> 'pruebas', ''), fila ->> 'pruebas') as pruebas_texto,
      coalesce(nullif(d ->> 'falta', ''), fila ->> 'falta') as falta,
      d ->> 'primeraVez' as sancion_primera,
      d ->> 'segundaVez' as sancion_segunda,
      d ->> 'terceraVez' as sancion_tercera,
      d ->> 'cuartaVez' as sancion_cuarta,
      coalesce(nullif(d ->> 'fechaHechos', ''), nullif(d ->> 'fechaDiligenciamiento', ''),
               fila ->> 'fecha_diligenciamiento_descargos') as fecha_hechos,
      coalesce(nullif(d ->> 'fechaCitacion', ''), fila ->> 'fecha_citacion') as fecha_citacion,
      coalesce(nullif(d ->> 'horaCitacion', ''), fila ->> 'hora_citacion') as hora_citacion,
      lower(btrim(coalesce(nullif(d ->> 'asistencia', ''), fila ->> 'asistencia', ''))) as asistencia,
      coalesce(nullif(d ->> 'fechaActaDescargos', ''), fila ->> 'fecha_acta_descargos') as fecha_descargos,
      coalesce(nullif(d ->> 'horaActaDescargos', ''), fila ->> 'hora_acta_descargos') as hora_desc_ini,
      coalesce(nullif(d ->> 'horaDiligenciamiento', ''), fila ->> 'hora_diligenciamiento_descargos') as hora_desc_fin,
      coalesce(nullif(d ->> 'acta', ''), nullif(d ->> 'textoActa', ''), fila ->> 'acta') as acta,
      coalesce(nullif(d ->> 'disciplinario', ''), fila ->> 'disciplinario') as dirige,
      d ->> 'tipoDecision' as tipo_decision,
      d ->> 'antecedentes' as antecedentes,
      d ->> 'resumenDescargos' as resumen_descargos,
      d ->> 'consideraciones' as consideraciones,
      d ->> 'compromisos' as compromisos,
      d ->> 'numeralesSancion' as numerales_sancion,
      coalesce(nullif(d ->> 'diasSuspension', ''), fila ->> 'dias_suspension') as dias_suspension,
      coalesce(nullif(d ->> 'fechaInicioSancion', ''), fila ->> 'fecha_inicio_sancion') as fecha_ini_sancion,
      coalesce(nullif(d ->> 'fechaFinSancion', ''), fila ->> 'fecha_fin_sancion') as fecha_fin_sancion,
      d ->> 'fechaReintegro' as fecha_reintegro,
      d ->> 'recursoAnte' as recurso_ante,
      d ->> 'recursoDias' as recurso_dias,
      coalesce(nullif(d ->> 'firmaCitacion', ''), fila ->> 'firma_citacion') as firma_citacion,
      d ->> 'firmaDescargos' as firma_descargos,
      coalesce(nullif(d ->> 'firmaSancion', ''), d ->> 'firmaDecision') as firma_decision,
      upper(btrim(coalesce(nullif(d ->> 'estado', ''), fila ->> 'estado', ''))) as estado_viejo,
      coalesce(nullif(d ->> 'responsable', ''), fila ->> 'responsable') as responsable,
      coalesce(nullif(d ->> 'asunto', ''), fila ->> 'asunto') as asunto
    from viejo
  )
  insert into kardex_procesos_disciplinarios (
    origen_key, employee_id, empleado_cedula, empleado_nombre, empleado_cargo,
    empleado_area, empleado_interno, empleado_ruta, empleado_fecha_ingreso,
    vehiculo_propietario, celular, correo,
    fecha_hechos, motivo, normas, pruebas_texto, falta,
    sancion_primera, sancion_segunda, sancion_tercera, sancion_cuarta,
    fecha_citacion, hora_citacion,
    asistencia, fecha_descargos, hora_descargos_inicio, hora_descargos_fin,
    acta_descargos, dirige_descargos,
    tipo_decision, antecedentes, resumen_descargos, consideraciones, compromisos,
    numerales_sancion, dias_suspension, fecha_inicio_sancion, fecha_fin_sancion,
    fecha_reintegro, recurso_ante, recurso_dias,
    firma_citacion, firma_descargos, firma_decision,
    estado, responsable, asunto, creado_por_email
  )
  select
    v.origen_key,
    -- Se enlaza por cedula, prefiriendo la ficha activa. Si la persona ya no
    -- esta, el proceso entra igual con employee_id nulo.
    (select e.id from employees e
      where e.cedula = btrim(v.cedula)
      order by e.activo desc, e.created_at desc
      limit 1),
    btrim(coalesce(v.cedula, '')),
    nullif(btrim(coalesce(v.nombre, '')), ''),
    nullif(btrim(coalesce(v.cargo, '')), ''),
    nullif(btrim(coalesce(v.area, '')), ''),
    nullif(btrim(coalesce(v.interno, '')), ''),
    nullif(btrim(coalesce(v.ruta, '')), ''),
    kardex_pd_fecha(v.fecha_ingreso),
    nullif(btrim(coalesce(v.propietario, '')), ''),
    nullif(btrim(coalesce(v.celular, '')), ''),
    nullif(btrim(coalesce(v.correo, '')), ''),
    kardex_pd_fecha(v.fecha_hechos),
    nullif(btrim(coalesce(v.motivo, '')), ''),
    nullif(btrim(coalesce(v.normas, '')), ''),
    nullif(btrim(coalesce(v.pruebas_texto, '')), ''),
    nullif(btrim(coalesce(v.falta, '')), ''),
    nullif(btrim(coalesce(v.sancion_primera, '')), ''),
    nullif(btrim(coalesce(v.sancion_segunda, '')), ''),
    nullif(btrim(coalesce(v.sancion_tercera, '')), ''),
    nullif(btrim(coalesce(v.sancion_cuarta, '')), ''),
    kardex_pd_fecha(v.fecha_citacion),
    kardex_pd_hora(v.hora_citacion),
    case when v.asistencia in ('si', 'sí') then 'si'
         when v.asistencia = 'no' then 'no'
         else null end,
    kardex_pd_fecha(v.fecha_descargos),
    kardex_pd_hora(v.hora_desc_ini),
    kardex_pd_hora(v.hora_desc_fin),
    nullif(btrim(coalesce(v.acta, '')), ''),
    nullif(btrim(coalesce(v.dirige, '')), ''),
    nullif(btrim(coalesce(v.tipo_decision, '')), ''),
    nullif(btrim(coalesce(v.antecedentes, '')), ''),
    nullif(btrim(coalesce(v.resumen_descargos, '')), ''),
    nullif(btrim(coalesce(v.consideraciones, '')), ''),
    nullif(btrim(coalesce(v.compromisos, '')), ''),
    nullif(btrim(coalesce(v.numerales_sancion, '')), ''),
    nullif(btrim(coalesce(v.dias_suspension, '')), ''),
    kardex_pd_fecha(v.fecha_ini_sancion),
    kardex_pd_fecha(v.fecha_fin_sancion),
    kardex_pd_fecha(v.fecha_reintegro),
    nullif(btrim(coalesce(v.recurso_ante, '')), ''),
    nullif(btrim(coalesce(v.recurso_dias, '')), ''),
    nullif(btrim(coalesce(v.firma_citacion, '')), ''),
    nullif(btrim(coalesce(v.firma_descargos, '')), ''),
    nullif(btrim(coalesce(v.firma_decision, '')), ''),
    -- Los estados del programa viejo eran texto libre en mayusculas. Se
    -- traducen a los cuatro del ERP; cualquier cosa rara entra como 'citacion',
    -- que es el estado inicial y el que menos afirma de mas.
    case
      when v.estado_viejo like '%FINALIZ%' then 'finalizado'
      when v.estado_viejo like '%CANCEL%' then 'cancelado'
      when v.estado_viejo like '%SANCION%' or v.estado_viejo like '%SUSPENS%'
        or v.estado_viejo like '%TERMINA%' or v.estado_viejo like '%LLAMADO%' then 'decision'
      when v.estado_viejo like '%DESCARGO%' and v.estado_viejo not like '%CITACION%' then 'descargos'
      when v.estado_viejo like '%CONVERSATORIO%' then 'descargos'
      else 'citacion'
    end,
    nullif(btrim(coalesce(v.responsable, '')), ''),
    nullif(btrim(coalesce(v.asunto, '')), ''),
    coalesce(auth.jwt() ->> 'email', 'importacion')
  from campos v
  where coalesce(btrim(v.cedula), '') <> ''
  on conflict (origen_key) do update set
    empleado_nombre = excluded.empleado_nombre,
    empleado_cargo = excluded.empleado_cargo,
    empleado_area = excluded.empleado_area,
    motivo = excluded.motivo,
    normas = excluded.normas,
    fecha_citacion = excluded.fecha_citacion,
    hora_citacion = excluded.hora_citacion,
    updated_at = now();

  get diagnostics v_copiados = row_count;

  return query
  select v_copiados,
         (select count(*)::integer from kardex_procesos_disciplinarios where employee_id is not null),
         (select count(*)::integer from kardex_procesos_disciplinarios where employee_id is null);
end;
$$;

revoke all on function kardex_pd_importar() from public;
grant execute on function kardex_pd_importar() to authenticated;

-- ---------------------------------------------------------------------------
-- Para correr la importacion (una sola vez, o cuantas veces haga falta):
--   select * from kardex_pd_importar();
--
-- Devuelve cuantos se copiaron, cuantos quedaron enlazados a un empleado y
-- cuantos no (esos ultimos son gente que ya no esta en employees).
-- ---------------------------------------------------------------------------
