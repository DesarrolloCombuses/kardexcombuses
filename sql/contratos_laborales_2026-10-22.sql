-- ============================================================================
-- Kardex / ERP Combuses -- Contratos a termino fijo: periodo de prueba y preaviso
--
-- QUE RESUELVE
-- Desde agosto hay contratos a termino fijo para cargos operativos, gestores
-- y auxiliar de contabilidad. Dos fechas de esos contratos no pueden pasarse
-- por alto, y hoy no vivian en ninguna parte:
--
--   1. El fin del PERIODO DE PRUEBA. Pasada esa fecha ya no se puede
--      terminar el contrato alegando el periodo de prueba.
--   2. La entrega del PREAVISO de no renovacion. Si no se entrega a tiempo,
--      el contrato se prorroga solo y la empresa queda amarrada otro
--      periodo igual sin haberlo decidido.
--
-- La segunda es la mas cara: no avisar a tiempo no es "se nos paso", es una
-- renovacion automatica.
--
-- POR QUE UNA TABLA Y NO DOS COLUMNAS EN EL PERFIL
-- Un contrato a termino fijo se prorroga. La persona es la misma pero el
-- contrato es otro, con su propio vencimiento y su propio preaviso. Con dos
-- columnas en el perfil, la prorroga pisa el contrato anterior y se pierde
-- cuando vencio el primero y si se preaviso. Aca cada contrato es una fila y
-- el historial queda.
--
-- LAS FECHAS NO SE CALCULAN SOLAS A PROPOSITO
-- fecha_fin y fin_periodo_prueba se guardan como dato, no como formula. El
-- plazo lo pacta cada contrato y la pantalla propone el calculo al
-- digitarlo, pero lo que manda es lo que diga el papel firmado -- no una
-- regla que alguien supuso meses despues.
--
-- Seguro de re-ejecutar.
-- ============================================================================

create table if not exists public.kardex_contratos (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,

  tipo text not null default 'FIJO'
    check (tipo in ('FIJO', 'INDEFINIDO', 'OBRA_LABOR', 'APRENDIZAJE')),

  fecha_inicio date not null,
  -- Nulo para indefinido y obra/labor: no tienen vencimiento que preavisar.
  fecha_fin date,
  -- Nulo cuando no se pacto periodo de prueba (una prorroga, por ejemplo:
  -- el periodo de prueba solo cabe en el primer contrato).
  fin_periodo_prueba date,

  -- El preaviso: cuando se entrego y quien lo entrego. Mientras esto este
  -- vacio y el contrato tenga vencimiento, la alerta sigue viva.
  preaviso_entregado_en date,
  preaviso_entregado_por_email text,
  preaviso_entregado_por_nombre text,

  -- Que se decidio con el contrato. 'RENOVAR' no cierra la alerta por si
  -- solo: la prorroga se registra como un contrato nuevo, con su fecha.
  decision text check (decision in ('RENOVAR', 'NO_RENOVAR')),
  decision_en timestamptz,

  observaciones text,

  creado_por_email text,
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint kardex_contratos_fin_despues_inicio
    check (fecha_fin is null or fecha_fin > fecha_inicio),
  -- El periodo de prueba no puede empezar antes del contrato ni terminar
  -- despues de el: si eso pasa, la fecha se digito mal.
  constraint kardex_contratos_prueba_dentro
    check (fin_periodo_prueba is null
           or (fin_periodo_prueba > fecha_inicio
               and (fecha_fin is null or fin_periodo_prueba <= fecha_fin))),
  -- Un preaviso con fecha anterior al contrato no es un preaviso.
  constraint kardex_contratos_preaviso_despues_inicio
    check (preaviso_entregado_en is null or preaviso_entregado_en >= fecha_inicio)
);

create index if not exists idx_kardex_contratos_empleado
  on public.kardex_contratos (employee_id, fecha_inicio desc);

-- Las dos consultas que hace la pantalla de alertas son "contratos que
-- vencen pronto" y "periodos de prueba que terminan pronto".
create index if not exists idx_kardex_contratos_fin
  on public.kardex_contratos (fecha_fin)
  where fecha_fin is not null;

create index if not exists idx_kardex_contratos_prueba
  on public.kardex_contratos (fin_periodo_prueba)
  where fin_periodo_prueba is not null;

comment on table public.kardex_contratos is
  'Contratos laborales. Una fila por contrato (una prorroga es otra fila), para no perder el historial de vencimientos y preavisos.';
comment on column public.kardex_contratos.preaviso_entregado_en is
  'Fecha en que se entrego el preaviso de no renovacion. Nulo = sin entregar.';

-- ---------------------------------------------------------------------------
-- Quien ve y quien escribe
-- ---------------------------------------------------------------------------
-- Un contrato dice cuanto le queda a alguien en la empresa: no es dato de
-- consulta general. Se amarra al mismo modulo donde se ven las alertas.
create or replace function kardex_contratos_puede_ver()
returns boolean
language sql
stable
as $$
  select coalesce(kardex_es_gestion_humana(), false)
      or coalesce(kardex_tiene_permiso('personal-alertas', 'ver'), false);
$$;

create or replace function kardex_contratos_puede_editar()
returns boolean
language sql
stable
as $$
  select coalesce(kardex_es_gestion_humana(), false)
      or coalesce(kardex_tiene_permiso('personal-alertas', 'agregar'), false)
      or coalesce(kardex_tiene_permiso('personal-alertas', 'editar'), false);
$$;

revoke all on function kardex_contratos_puede_ver() from public, anon;
revoke all on function kardex_contratos_puede_editar() from public, anon;
grant execute on function kardex_contratos_puede_ver() to authenticated;
grant execute on function kardex_contratos_puede_editar() to authenticated;

alter table public.kardex_contratos enable row level security;

drop policy if exists kardex_contratos_sel on public.kardex_contratos;
create policy kardex_contratos_sel on public.kardex_contratos
  for select to authenticated
  using (kardex_contratos_puede_ver());

drop policy if exists kardex_contratos_ins on public.kardex_contratos;
create policy kardex_contratos_ins on public.kardex_contratos
  for insert to authenticated
  with check (kardex_contratos_puede_editar());

drop policy if exists kardex_contratos_upd on public.kardex_contratos;
create policy kardex_contratos_upd on public.kardex_contratos
  for update to authenticated
  using (kardex_contratos_puede_editar())
  with check (kardex_contratos_puede_editar());

-- Borrar un contrato es borrar la prueba de que existio. Se deja solo para
-- quien tenga 'borrar' explicito, que no se da por defecto.
drop policy if exists kardex_contratos_del on public.kardex_contratos;
create policy kardex_contratos_del on public.kardex_contratos
  for delete to authenticated
  using (coalesce(kardex_es_gestion_humana(), false)
         or coalesce(kardex_tiene_permiso('personal-alertas', 'borrar'), false));

revoke all on table public.kardex_contratos from public, anon;
grant select, insert, update, delete on public.kardex_contratos to authenticated;

-- ---------------------------------------------------------------------------
-- Lo que lee la pantalla de alertas
-- ---------------------------------------------------------------------------
-- Devuelve el contrato VIGENTE de cada persona con las dos cuentas regresivas
-- ya hechas. Se calcula en la base y no en el navegador porque el reloj del
-- equipo de quien mira no puede decidir si un preaviso esta a tiempo.
--
-- dias_para_preaviso: cuantos dias faltan para la FECHA LIMITE de entrega,
-- que es el vencimiento menos los dias de preaviso pactados (30 por ley como
-- minimo). En negativo, el plazo ya se paso.
create or replace function kardex_contratos_alertas(p_dias_preaviso integer default 30)
returns table (
  id uuid,
  employee_id uuid,
  nombre text,
  cedula text,
  cargo text,
  area text,
  activo boolean,
  tipo text,
  fecha_inicio date,
  fecha_fin date,
  fin_periodo_prueba date,
  preaviso_entregado_en date,
  preaviso_entregado_por_nombre text,
  decision text,
  observaciones text,
  fecha_limite_preaviso date,
  dias_para_prueba integer,
  dias_para_preaviso integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not kardex_contratos_puede_ver() then
    raise exception 'Tu cuenta no tiene permiso para ver los contratos'
      using errcode = '42501';
  end if;

  return query
  with vigente as (
    -- Uno por persona: el contrato que empezo mas tarde. Las prorrogas
    -- viejas quedan en la tabla pero no generan alerta.
    select distinct on (c.employee_id) c.*
    from kardex_contratos c
    order by c.employee_id, c.fecha_inicio desc, c.created_at desc
  )
  select
    v.id,
    v.employee_id,
    e.nombre,
    e.cedula,
    e.cargo,
    e.area,
    e.activo,
    v.tipo,
    v.fecha_inicio,
    v.fecha_fin,
    v.fin_periodo_prueba,
    v.preaviso_entregado_en,
    v.preaviso_entregado_por_nombre,
    v.decision,
    v.observaciones,
    case when v.fecha_fin is null then null
         else v.fecha_fin - greatest(coalesce(p_dias_preaviso, 30), 0) end,
    case when v.fin_periodo_prueba is null then null
         else (v.fin_periodo_prueba - current_date)::integer end,
    case when v.fecha_fin is null then null
         else ((v.fecha_fin - greatest(coalesce(p_dias_preaviso, 30), 0)) - current_date)::integer end
  from vigente v
  join employees e on e.id = v.employee_id;
end;
$$;

revoke all on function kardex_contratos_alertas(integer) from public, anon;
grant execute on function kardex_contratos_alertas(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Marcar el preaviso como entregado
-- ---------------------------------------------------------------------------
-- Va por funcion y no por update directo para que el correo de quien lo
-- entrego lo ponga el SERVIDOR con la sesion. Esa marca es la que responde
-- "quien aviso y cuando" si el dia de mañana alguien lo discute, y no puede
-- depender de lo que mande el navegador.
create or replace function kardex_contrato_marcar_preaviso(
  p_id uuid,
  p_fecha date default null,
  p_decision text default null,
  p_nombre text default null
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_fecha date;
begin
  if not kardex_contratos_puede_editar() then
    raise exception 'Tu cuenta no tiene permiso para registrar preavisos'
      using errcode = '42501';
  end if;

  if p_decision is not null and p_decision not in ('RENOVAR', 'NO_RENOVAR') then
    raise exception 'Decision invalida: %', p_decision;
  end if;

  update kardex_contratos
     set preaviso_entregado_en = coalesce(p_fecha, current_date),
         preaviso_entregado_por_email = v_correo,
         preaviso_entregado_por_nombre = nullif(btrim(coalesce(p_nombre, '')), ''),
         decision = coalesce(p_decision, decision),
         decision_en = case when p_decision is not null then now() else decision_en end,
         updated_at = now()
   where id = p_id
   returning preaviso_entregado_en into v_fecha;

  if not found then
    raise exception 'No existe ese contrato';
  end if;

  return v_fecha;
end;
$$;

revoke all on function kardex_contrato_marcar_preaviso(uuid, date, text, text) from public, anon;
grant execute on function kardex_contrato_marcar_preaviso(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Permiso del modulo
-- ---------------------------------------------------------------------------
-- 'personal-alertas' ya existe en la matriz de Usuarios; aqui solo se
-- asegura que acepte las acciones de escritura, por si el CHECK las limita.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'kardex_permisos_usuario'
  ) then
    if not exists (
      select 1 from information_schema.check_constraints cc
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = cc.constraint_name
      where ccu.table_name = 'kardex_permisos_usuario'
        and cc.check_clause like '%personal-alertas%'
    ) then
      raise notice 'Revisar que kardex_permisos_usuario acepte el modulo personal-alertas.';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Para comprobar que quedo:
--
--   select count(*) from kardex_contratos;              -- 0 al principio
--   select * from kardex_contratos_alertas(30) limit 5; -- vacio, sin error
-- ---------------------------------------------------------------------------
