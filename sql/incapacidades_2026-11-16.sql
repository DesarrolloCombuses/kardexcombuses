-- ============================================================================
-- Kardex de Dotación -- Combuses SA
-- Copia en Supabase de la base de INCAPACIDADES (Google Sheet publicado que
-- mantiene Gestión Humana).
--
-- Mismo camino que ya siguió la base de siniestros de tránsito
-- (sql/siniestros_transito_cache_2026-09-20.sql): una Edge Function
-- sincroniza el sheet hacia esta tabla por cron, y el cliente lee de aquí.
-- El CSV publicado de Google falla seguido con un 500 intermitente, y una
-- consulta en vivo deja la pantalla vacía justo cuando alguien la necesita.
--
-- LO QUE HACE DIFERENTE A ESTA TABLA: trae DATOS DE SALUD
-- -------------------------------------------------------
-- El sheet incluye código y descripción del diagnóstico de cada persona.
-- Eso no es información de asistencia: es historia clínica. Por eso esta
-- tabla NO tiene policy de lectura para `authenticated` -- a diferencia de
-- siniestros_transito, nadie la consulta directo. La única puerta es
-- kardex_incapacidades_listar(), que arma la respuesta SIN las dos columnas
-- de diagnóstico salvo que quien pregunta sea Gestión Humana o admin.
--
-- Es el mismo criterio de las columnas ocultas de Empleados
-- (sql/columnas_ocultas_empleados_2026-09-18.sql): la restricción es REAL y
-- del servidor. Esconderlo en el navegador no sirve de nada -- el dato igual
-- viajó, y queda en la pestaña de red de cualquier navegador.
--
-- "datos" guarda la fila cruda del sheet para no tener que migrar la tabla
-- cada vez que Gestión Humana agregue una columna. Las dos columnas de
-- diagnóstico se SACAN de ahí antes de guardar (lo hace la Edge Function):
-- si se quedaran dentro, devolver "datos" a cualquiera filtraría justo lo
-- que las columnas aparte protegen.
-- ============================================================================

create table if not exists kardex_incapacidades (
  id bigint generated always as identity primary key,
  -- La columna KEY del sheet. Comprobado sobre las 553 filas de hoy: no se
  -- repite ninguna, así que sirve para reconocer la misma incapacidad entre
  -- una sincronización y otra.
  sheet_key text,
  cedula text not null,
  nombre text,
  cargo text,
  area text,                      -- OPERATIVO / ADM
  tipo_evento text,               -- EG (enfermedad general) / AT / EL
  eps text,                       -- en el sheet se llama "TIPO DE TRABAJADOR"
  fecha_inicio date,
  fecha_fin date,
  dias integer,
  dias_mes_real integer,
  dias_mes_siguiente integer,
  -- DATOS DE SALUD. Solo salen por kardex_incapacidades_listar() y solo
  -- para Gestión Humana o admin.
  diagnostico_codigo text,
  diagnostico_descripcion text,
  fecha_registro date,
  ruta text,
  interno text,
  afiliado text,
  adjunto text,
  datos jsonb not null default '{}'::jsonb,   -- fila cruda, SIN diagnóstico
  synced_at timestamptz not null default now()
);

create index if not exists idx_kardex_incapacidades_cedula on kardex_incapacidades(cedula);
create index if not exists idx_kardex_incapacidades_inicio on kardex_incapacidades(fecha_inicio);
create index if not exists idx_kardex_incapacidades_sheet_key on kardex_incapacidades(sheet_key);

alter table kardex_incapacidades enable row level security;

-- A propósito: NINGUNA policy. Ni select. La tabla se lee solo desde las
-- funciones de abajo, que son security definer y por eso no pasan por RLS.
-- El service_role de la Edge Function tampoco pasa por RLS, así que puede
-- escribir sin policy.
drop policy if exists "permiso_ver_kardex_incapacidades" on kardex_incapacidades;

-- Y por si alguien le pusiera un grant por fuera: se le quita el acceso
-- directo a los roles del cliente. Hay que nombrar a `anon` aparte de
-- `public` -- en Supabase, revocar de public NO le quita el permiso a anon.
revoke all on kardex_incapacidades from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quién puede ver el módulo
-- ---------------------------------------------------------------------------
create or replace function kardex_puede_ver_incapacidades()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    kardex_es_gestion_humana()
    or kardex_tiene_permiso('incapacidades', 'ver'),
    false);
$$;

-- Ver el DIAGNÓSTICO es otra cosa que ver la incapacidad: se puede necesitar
-- contar días de ausencia sin tener por qué saber de qué se enfermó nadie.
--
-- OJO con no usar aquí kardex_es_gestion_humana(). Pese al nombre, esa
-- función devuelve true para CUALQUIER cuenta de kardex_authorized_users,
-- incluidas las de rol "viewer" (es kardex_is_authorized() or grupo =
-- 'GESTION HUMANA'). Para el resto del ERP eso está bien -- un viewer es una
-- cuenta de consulta general -- pero una historia clínica no es "consulta
-- general". Aquí se nombran los dos casos a mano: admin, o estar en el grupo
-- GESTION HUMANA. Hoy eso deja fuera a 2 cuentas viewer que de otro modo
-- verían los diagnósticos.
create or replace function kardex_puede_ver_diagnostico()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    kardex_mi_rol_autorizado() = 'admin' or kardex_mi_grupo() = 'GESTION HUMANA',
    false);
$$;

-- ---------------------------------------------------------------------------
-- La única puerta de lectura
-- ---------------------------------------------------------------------------
-- Devuelve jsonb y no una tabla con columnas fijas porque las claves del
-- diagnóstico tienen que poder NO ESTAR. Devolverlas en null también serviría
-- para no mostrarlas, pero dejaría al cliente decidiendo qué enseña -- y la
-- idea es justo que esa decisión no esté en el navegador.
create or replace function kardex_incapacidades_listar(
  p_desde date default null,
  p_hasta date default null
)
returns setof jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_diag boolean;
begin
  if not kardex_puede_ver_incapacidades() then
    raise exception 'Tu cuenta no tiene permiso para ver Incapacidades.'
      using errcode = '42501';
  end if;
  v_diag := kardex_puede_ver_diagnostico();

  return query
  select
    jsonb_build_object(
      'id', i.id,
      'sheet_key', i.sheet_key,
      'cedula', i.cedula,
      'nombre', i.nombre,
      'cargo', i.cargo,
      'area', i.area,
      'tipo_evento', i.tipo_evento,
      'eps', i.eps,
      'fecha_inicio', i.fecha_inicio,
      'fecha_fin', i.fecha_fin,
      'dias', i.dias,
      'dias_mes_real', i.dias_mes_real,
      'dias_mes_siguiente', i.dias_mes_siguiente,
      'fecha_registro', i.fecha_registro,
      'ruta', i.ruta,
      'interno', i.interno,
      'afiliado', i.afiliado,
      'adjunto', i.adjunto,
      'datos', i.datos,
      -- Se dice SIEMPRE si la persona está en la nómina: una incapacidad de
      -- alguien que no cruza es una cédula mal escrita en el sheet, y hay
      -- que poder verlas para corregirlas.
      'en_nomina', exists (select 1 from employees e where e.cedula = i.cedula),
      'activo', exists (select 1 from employees e where e.cedula = i.cedula and e.activo)
    )
    || case when v_diag then jsonb_build_object(
         'diagnostico_codigo', i.diagnostico_codigo,
         'diagnostico_descripcion', i.diagnostico_descripcion)
       else '{}'::jsonb end
  from kardex_incapacidades i
  where (p_desde is null or i.fecha_inicio >= p_desde)
    and (p_hasta is null or i.fecha_inicio <= p_hasta)
  order by i.fecha_inicio desc nulls last, i.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Agregado por mes, para el indicador de ausentismo
-- ---------------------------------------------------------------------------
-- Solo conteos: ni nombres, ni cédulas, ni diagnósticos. Por eso le basta
-- con el permiso de ver el módulo o el informe de gestión -- el mismo
-- criterio que gh-ausentismo, que tampoco dice quién faltó.
create or replace function kardex_incapacidades_por_mes(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  mes text,
  tipo_evento text,
  eventos integer,
  dias integer,
  personas integer
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (kardex_puede_ver_incapacidades()
          or coalesce(kardex_tiene_permiso('informe-gestion', 'ver'), false)) then
    raise exception 'Tu cuenta no tiene permiso para ver el ausentismo por incapacidad.'
      using errcode = '42501';
  end if;

  return query
  select
    to_char(i.fecha_inicio, 'YYYY-MM') as mes,
    coalesce(nullif(trim(i.tipo_evento), ''), 'SIN TIPO') as tipo_evento,
    count(*)::integer as eventos,
    -- greatest(...,0): hay filas del sheet con la fecha final ANTERIOR a la
    -- inicial, y ahí los días salen negativos. Restarían del total y lo
    -- dejarían por debajo de lo real. Se cuentan como cero y el módulo las
    -- muestra aparte para que las corrijan en el sheet.
    sum(greatest(coalesce(i.dias, 0), 0))::integer as dias,
    count(distinct i.cedula)::integer as personas
  from kardex_incapacidades i
  where i.fecha_inicio is not null
    and (p_desde is null or i.fecha_inicio >= p_desde)
    and (p_hasta is null or i.fecha_inicio <= p_hasta)
  group by 1, 2
  order by 1 desc, 2;
end;
$$;

revoke all on function kardex_incapacidades_listar(date, date) from public, anon;
revoke all on function kardex_incapacidades_por_mes(date, date) from public, anon;
grant execute on function kardex_incapacidades_listar(date, date) to authenticated;
grant execute on function kardex_incapacidades_por_mes(date, date) to authenticated;
grant execute on function kardex_puede_ver_incapacidades() to authenticated;
grant execute on function kardex_puede_ver_diagnostico() to authenticated;

-- ---------------------------------------------------------------------------
-- El módulo en la lista blanca de permisos
-- ---------------------------------------------------------------------------
-- kardex_permisos_usuario.modulo tiene un CHECK con los módulos válidos. Sin
-- agregar 'incapacidades' ahí, la casilla aparecería en Usuarios pero
-- guardar el permiso fallaría con un error de restricción -- y el mensaje no
-- diría por qué.
alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard', 'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas',
    'aspirantes', 'empleados', 'personal-cumpleanos', 'personal-alertas',
    'personal-conductores', 'personal-perfil', 'personal-rotacion',
    'permisos-vacaciones', 'incapacidades',
    'siniestros-transito', 'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos', 'lineas-celulares',
    'informes-disciplinarios', 'procesos-disciplinarios', 'mantenimiento',
    'informe-gestion', 'procesos-disciplinarios-gh', 'procesos-disciplinarios-historico'
  ));
