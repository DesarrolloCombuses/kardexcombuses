-- ============================================================================
-- Kardex / ERP Combuses -- Modulo "Informe de gestion"
--
-- Los indicadores del SG-SST (Resolucion 0312 de 2019) y del PESV (Paso 20 de
-- la Resolucion 40595 de 2022) se venian llevando en documentos de Word: una
-- tabla por informe, el resultado escrito a mano y el estado escrito tambien a
-- mano al lado. Eso ya produjo al menos una contradiccion dentro del mismo
-- documento -- un 70% descrito como "desempeno satisfactorio" en la conclusion
-- y marcado "No cumple" tres parrafos despues, contra su meta de 95%.
--
-- Este modelo evita que eso pueda volver a pasar:
--   * el ESTADO no se guarda, se calcula comparando el valor con la meta;
--   * el VALOR no se escribe, se calcula del numerador y el denominador
--     (21 de 28 capacitaciones -> 75%), que es lo que de verdad se cuenta.
-- Lo unico que se digita es lo que alguien conto.
--
-- Se guarda una medicion por periodo (mes, trimestre o ano, segun la
-- frecuencia del indicador) para que haya serie historica y se pueda comparar
-- un ano con otro. El informe anual es la lectura de esa serie, no un dato
-- aparte que haya que mantener sincronizado.
--
-- ESTE ARCHIVO NO TRAE RESULTADOS REALES, solo la estructura y el catalogo de
-- indicadores con sus metas y formulas (que son las de la norma, publicas).
-- Las mediciones de la empresa van en sql/import_ig_*.sql, que .gitignore
-- excluye: este repositorio es publico.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El modulo en la matriz de permisos
-- ---------------------------------------------------------------------------
-- Si la base tuviera un modulo que esta lista no trae, el add constraint falla
-- con un mensaje que no dice cual. Esta revision previa si lo dice.
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
    'procesos-disciplinarios',
    'mantenimiento',
    'informe-gestion'
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
    'procesos-disciplinarios',
    'mantenimiento',
    'informe-gestion'
  ));

-- ---------------------------------------------------------------------------
-- 2. Catalogo de indicadores
-- ---------------------------------------------------------------------------
-- Un renglon por indicador. Su meta queda guardada en dos formas: el numero
-- con el que se compara (meta_valor + meta_operador) y el texto tal como lo
-- escribe la norma (meta_texto, p.ej. "<= Ano anterior"), porque no todas las
-- metas son un numero.
create table if not exists public.kardex_ig_indicadores (
  id            bigserial primary key,
  codigo        text not null unique,
  sistema       text not null check (sistema in ('sgsst', 'pesv')),
  nombre        text not null,
  formula       text,
  meta_valor    numeric,
  -- '>=' y '>' : mas es mejor.  '<=' y '<' : menos es mejor.
  -- '<=anterior' : la meta es no empeorar frente al ano pasado; si no hay
  -- ano pasado cargado, el indicador se muestra SIN estado en vez de darse
  -- por cumplido.
  meta_operador text not null default '>=' check (meta_operador in ('>=', '>', '<=', '<', '=', '<=anterior')),
  meta_texto    text,
  unidad        text not null default 'porcentaje' check (unidad in ('porcentaje', 'numero', 'tasa')),
  frecuencia    text not null default 'mensual' check (frecuencia in ('mensual', 'trimestral', 'anual')),
  orden         integer not null default 0,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

comment on table public.kardex_ig_indicadores is
  'Catalogo de indicadores del SG-SST y del PESV. El estado nunca se guarda aqui ni en las mediciones: se calcula comparando el valor con la meta.';

-- ---------------------------------------------------------------------------
-- 3. Mediciones
-- ---------------------------------------------------------------------------
-- periodo es el mes (1-12), el trimestre (1-4) o 1 si el indicador es anual.
-- El trigger de mas abajo lo valida contra la frecuencia del indicador.
create table if not exists public.kardex_ig_mediciones (
  id             bigserial primary key,
  indicador_id   bigint not null references public.kardex_ig_indicadores (id) on delete cascade,
  anio           integer not null check (anio between 2015 and 2100),
  periodo        integer not null check (periodo between 1 and 12),
  numerador      numeric,
  denominador    numeric,
  valor          numeric,
  -- Un informe anual casi nunca trae el dato de un mes suelto: trae el
  -- acumulado "a octubre". Marcarlo evita que ese 70% se lea como si fuera el
  -- resultado de octubre y ensucie la grafica de evolucion, que solo usa las
  -- mediciones del periodo.
  acumulado      boolean not null default false,
  observacion    text,
  registrado_por uuid default auth.uid(),
  registrado_en  timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (indicador_id, anio, periodo)
);

create index if not exists idx_ig_mediciones_anio on public.kardex_ig_mediciones (anio);

-- ---------------------------------------------------------------------------
-- 4. Series informativas (sin meta)
-- ---------------------------------------------------------------------------
-- Lo que el informe muestra como contexto y no como indicador: participantes
-- por tema de capacitacion, atenciones por especialidad, cifras de
-- accidentalidad. No tienen meta, asi que no pueden "cumplir" ni "no cumplir"
-- y no entran al calculo de cumplimiento; solo se grafican.
create table if not exists public.kardex_ig_series (
  id       bigserial primary key,
  grupo    text not null,
  anio     integer not null check (anio between 2015 and 2100),
  etiqueta text not null,
  valor    numeric not null,
  orden    integer not null default 0,
  unique (grupo, anio, etiqueta)
);

-- ---------------------------------------------------------------------------
-- 5. El valor se calcula; no se digita
-- ---------------------------------------------------------------------------
-- Si vienen numerador y denominador, el valor sale de ahi. Asi el porcentaje
-- no puede discrepar de los numeros que lo sustentan, que es exactamente lo
-- que pasaba en los informes de Word.
create or replace function public.kardex_ig_calcular()
returns trigger
language plpgsql
as $$
declare
  v_frecuencia text;
  v_maximo integer;
begin
  if new.denominador is not null and new.denominador <> 0 and new.numerador is not null then
    new.valor := round((new.numerador / new.denominador) * 100, 2);
  elsif new.valor is null then
    raise exception 'Hay que dar el numerador y el denominador, o el valor directamente.';
  end if;

  select frecuencia into v_frecuencia
  from public.kardex_ig_indicadores where id = new.indicador_id;

  v_maximo := case v_frecuencia when 'mensual' then 12 when 'trimestral' then 4 else 1 end;
  if new.periodo > v_maximo then
    raise exception 'El indicador es % y el periodo % no existe (va de 1 a %).',
      v_frecuencia, new.periodo, v_maximo;
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_ig_calcular on public.kardex_ig_mediciones;
create trigger trg_ig_calcular
  before insert or update on public.kardex_ig_mediciones
  for each row execute function public.kardex_ig_calcular();

-- ---------------------------------------------------------------------------
-- 6. Quien puede ver y quien puede registrar
-- ---------------------------------------------------------------------------
create or replace function public.kardex_ig_puede_ver()
returns boolean
language sql
stable
as $$
  select kardex_is_authorized() or kardex_tiene_permiso('informe-gestion', 'ver');
$$;

create or replace function public.kardex_ig_puede_escribir(p_accion text)
returns boolean
language sql
stable
as $$
  select kardex_is_authorized() or kardex_tiene_permiso('informe-gestion', p_accion);
$$;

revoke all on function public.kardex_ig_puede_ver() from public, anon;
revoke all on function public.kardex_ig_puede_escribir(text) from public, anon;
grant execute on function public.kardex_ig_puede_ver() to authenticated;
grant execute on function public.kardex_ig_puede_escribir(text) to authenticated;

alter table public.kardex_ig_indicadores enable row level security;
alter table public.kardex_ig_mediciones  enable row level security;
alter table public.kardex_ig_series      enable row level security;

-- El catalogo lo administra solo un admin: cambiar una meta cambia la lectura
-- de toda la serie historica, hacia atras incluida.
drop policy if exists kardex_ig_indicadores_sel on public.kardex_ig_indicadores;
create policy kardex_ig_indicadores_sel on public.kardex_ig_indicadores
  for select to authenticated using (kardex_ig_puede_ver());

drop policy if exists kardex_ig_indicadores_all on public.kardex_ig_indicadores;
create policy kardex_ig_indicadores_all on public.kardex_ig_indicadores
  for all to authenticated using (kardex_is_authorized()) with check (kardex_is_authorized());

drop policy if exists kardex_ig_mediciones_sel on public.kardex_ig_mediciones;
create policy kardex_ig_mediciones_sel on public.kardex_ig_mediciones
  for select to authenticated using (kardex_ig_puede_ver());

drop policy if exists kardex_ig_mediciones_ins on public.kardex_ig_mediciones;
create policy kardex_ig_mediciones_ins on public.kardex_ig_mediciones
  for insert to authenticated with check (kardex_ig_puede_escribir('agregar'));

drop policy if exists kardex_ig_mediciones_upd on public.kardex_ig_mediciones;
create policy kardex_ig_mediciones_upd on public.kardex_ig_mediciones
  for update to authenticated using (kardex_ig_puede_escribir('editar')) with check (kardex_ig_puede_escribir('editar'));

drop policy if exists kardex_ig_mediciones_del on public.kardex_ig_mediciones;
create policy kardex_ig_mediciones_del on public.kardex_ig_mediciones
  for delete to authenticated using (kardex_ig_puede_escribir('borrar'));

drop policy if exists kardex_ig_series_sel on public.kardex_ig_series;
create policy kardex_ig_series_sel on public.kardex_ig_series
  for select to authenticated using (kardex_ig_puede_ver());

drop policy if exists kardex_ig_series_all on public.kardex_ig_series;
create policy kardex_ig_series_all on public.kardex_ig_series
  for all to authenticated using (kardex_ig_puede_escribir('editar')) with check (kardex_ig_puede_escribir('editar'));

grant select on public.kardex_ig_indicadores to authenticated;
grant select, insert, update, delete on public.kardex_ig_mediciones to authenticated;
grant select, insert, update, delete on public.kardex_ig_series to authenticated;
grant usage on sequence public.kardex_ig_mediciones_id_seq to authenticated;
grant usage on sequence public.kardex_ig_series_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Catalogo: los 24 indicadores de los dos informes
-- ---------------------------------------------------------------------------
-- Las metas y las formulas son las de la norma; no son dato de la empresa.
insert into public.kardex_ig_indicadores
  (codigo, sistema, nombre, formula, meta_valor, meta_operador, meta_texto, unidad, frecuencia, orden)
values
  -- SG-SST (Resolucion 0312 de 2019)
  ('sgsst-plan-trabajo',    'sgsst', 'Cumplimiento del Plan de Trabajo SG-SST', '(Actividades ejecutadas / Actividades programadas) x 100', 95, '>=', '≥ 95%', 'porcentaje', 'mensual', 10),
  ('sgsst-capacitacion',    'sgsst', 'Cumplimiento del Programa de Capacitación', '(Capacitaciones ejecutadas / Capacitaciones programadas) x 100', 100, '>=', '100%', 'porcentaje', 'mensual', 20),
  ('sgsst-induccion',       'sgsst', 'Cumplimiento de Inducción y Reinducción', '(Trabajadores capacitados / Trabajadores programados) x 100', 100, '>=', '100%', 'porcentaje', 'mensual', 30),
  ('sgsst-copasst',         'sgsst', 'Funcionamiento del COPASST', '(Reuniones realizadas / Reuniones programadas) x 100', 100, '>=', '100%', 'porcentaje', 'mensual', 40),
  ('sgsst-convivencia',     'sgsst', 'Funcionamiento del Comité de Convivencia', '(Reuniones realizadas / Reuniones programadas) x 100', 100, '>=', '100%', 'porcentaje', 'trimestral', 50),
  ('sgsst-inspecciones',    'sgsst', 'Cumplimiento de Inspecciones Planeadas', '(Inspecciones ejecutadas / Inspecciones programadas) x 100', 100, '>=', '100%', 'porcentaje', 'mensual', 60),
  ('sgsst-acpm',            'sgsst', 'Cierre de Acciones Correctivas (ACPM)', '(ACPM cerradas / ACPM generadas) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 70),
  ('sgsst-frecuencia-at',   'sgsst', 'Frecuencia de Accidentalidad', '(N.º de AT x 200.000) / Horas-hombre trabajadas', null, '<=anterior', '≤ Año anterior', 'tasa', 'mensual', 80),
  ('sgsst-severidad-at',    'sgsst', 'Severidad de Accidentalidad', '(Días perdidos x 200.000) / Horas-hombre trabajadas', null, '<=anterior', '≤ Año anterior', 'tasa', 'mensual', 90),
  ('sgsst-ausentismo',      'sgsst', 'Tasa de Ausentismo', '(Días de ausencia / Días laborados) x 100', 3, '<=', '≤ 3%', 'porcentaje', 'mensual', 100),
  ('sgsst-incidencia-el',   'sgsst', 'Incidencia de Enfermedad Laboral', '(Casos nuevos de EL / Trabajadores expuestos) x 100', 0, '=', '0%', 'porcentaje', 'anual', 110),
  ('sgsst-prevalencia-el',  'sgsst', 'Prevalencia de Enfermedad Laboral', '(Total de casos de EL / Total de trabajadores) x 100', 0, '=', '0%', 'porcentaje', 'anual', 120),
  ('sgsst-emergencias',     'sgsst', 'Cumplimiento del Plan de Emergencias', '(Actividades ejecutadas / Actividades programadas) x 100', 100, '>=', '100%', 'porcentaje', 'anual', 130),

  -- PESV -- Paso 20 de la Resolucion 40595 de 2022
  ('pesv-acpm',             'pesv', 'Cierre de ACPM', '(ACPM cerradas / ACPM generadas) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 10),
  ('pesv-siniestralidad',   'pesv', 'Reducción de siniestralidad', '(Reducción de siniestros frente al periodo anterior) x 100', 20, '>=', '20%', 'porcentaje', 'anual', 20),
  ('pesv-formacion',        'pesv', 'Plan de formación', '(Personas formadas / Personas programadas) x 100', 70, '>=', '≥ 70%', 'porcentaje', 'mensual', 30),
  ('pesv-velocidad',        'pesv', 'Excesos de velocidad', '(Eventos de exceso / Total de recorridos) x 100', 5, '<', '< 5%', 'porcentaje', 'mensual', 40),
  ('pesv-programas',        'pesv', 'Programas críticos de riesgo', '(Programas implementados / Programas exigidos) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 50),
  ('pesv-mantenimiento',    'pesv', 'Mantenimiento vehicular', '(Mantenimientos ejecutados / Mantenimientos programados) x 100', 95, '>=', '≥ 95%', 'porcentaje', 'mensual', 60),
  ('pesv-preoperacionales', 'pesv', 'Inspecciones preoperacionales', '(Inspecciones realizadas / Inspecciones requeridas) x 100', 100, '>=', '100%', 'porcentaje', 'mensual', 70),
  ('pesv-cultura-vial',     'pesv', 'Cultura vial', '(Actividades de cultura vial ejecutadas / programadas) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 80),
  ('pesv-legal',            'pesv', 'Cumplimiento legal', '(Requisitos legales cumplidos / Requisitos aplicables) x 100', 95, '>=', '≥ 95%', 'porcentaje', 'trimestral', 90),
  ('pesv-no-conformidades', 'pesv', 'Cierre de no conformidades', '(No conformidades cerradas / No conformidades abiertas) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 100),
  ('pesv-comunicacion',     'pesv', 'Estrategias de comunicación', '(Estrategias ejecutadas / Estrategias programadas) x 100', 90, '>=', '≥ 90%', 'porcentaje', 'trimestral', 110)
on conflict (codigo) do update set
  sistema       = excluded.sistema,
  nombre        = excluded.nombre,
  formula       = excluded.formula,
  meta_valor    = excluded.meta_valor,
  meta_operador = excluded.meta_operador,
  meta_texto    = excluded.meta_texto,
  unidad        = excluded.unidad,
  frecuencia    = excluded.frecuencia,
  orden         = excluded.orden;

-- ---------------------------------------------------------------------------
-- Para comprobar como quedo:
--   select sistema, count(*) from kardex_ig_indicadores group by 1;
--     -> sgsst 13, pesv 11
--   select count(*) from kardex_ig_mediciones;
--     -> 0 hasta que se corra el import de las mediciones
-- ---------------------------------------------------------------------------
