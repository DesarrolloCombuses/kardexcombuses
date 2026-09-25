-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Modulo "Lineas celulares": inventario de las lineas moviles de la empresa,
-- con historico de quien las tuvo, de sus altas y bajas, y de lo que factura
-- cada una mes a mes.
--
-- Contexto de los datos de origen (LINEAS CELULARES.xlsx, 2026-09-25): 40
-- lineas repartidas en 5 contratos. Dos decisiones del modelo salen de mirar
-- ese archivo, no de suponer:
--
--  1. El "responsable" NO puede ser una llave foranea a employees. La mitad
--     no son personas: "Bahia Aeropuerto", "Taquilla Sumni", "Despacho Ruta
--     041 Aranjuez", "Camara taquilla aeropuerto" son puestos o equipos. Se
--     guarda texto libre + un employee_id OPCIONAL para cuando si es una
--     persona de la planta (ahi si sirve para alertar que ya se retiro).
--  2. El historico de responsables es tabla aparte y no un campo mas. En el
--     archivo de origen ya venian anotados a mano dos relevos de responsable
--     (sin numeros ni nombres aca: el repo es publico). Guardar solo el
--     responsable actual borra justamente lo que se pidio conservar.
--
-- Seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Contratos
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas_contratos (
  numero text primary key,
  operador text not null default 'Claro',
  descripcion text,
  fecha_inicio date,
  -- Fin de permanencia: es la fecha que dispara la alerta para renegociar o
  -- no renovar. El archivo de origen no la trae; se captura a mano.
  fecha_fin_permanencia date,
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lineas
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas (
  numero text primary key,
  contrato_numero text references kardex_lineas_contratos(numero) on delete set null,
  estado text not null default 'activa' check (estado in ('activa', 'suspendida', 'cancelada')),
  -- Responsable actual, desnormalizado a proposito: la tabla de historico es
  -- la fuente de verdad, pero listar 40 lineas no puede costar 40 subconsultas
  -- del ultimo responsable. Lo mantiene sincronizado kardex_linea_asignar().
  responsable text,
  cargo text,
  employee_id uuid references employees(id) on delete set null,
  plan_descripcion text,
  cargo_basico numeric(14, 2),
  fecha_activacion date,
  fecha_desactivacion date,
  -- Si es null, la alerta usa la del contrato. Permite que una linea suelta
  -- tenga su propia permanencia sin inventar un contrato para ella.
  fecha_fin_permanencia date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actualizado_por text
);

create index if not exists kardex_lineas_contrato_idx on kardex_lineas (contrato_numero);
create index if not exists kardex_lineas_estado_idx on kardex_lineas (estado);
create index if not exists kardex_lineas_employee_idx on kardex_lineas (employee_id);

-- ---------------------------------------------------------------------------
-- Historico de responsables
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas_asignaciones (
  id uuid primary key default gen_random_uuid(),
  linea_numero text not null references kardex_lineas(numero) on delete cascade,
  responsable text not null,
  cargo text,
  employee_id uuid references employees(id) on delete set null,
  desde date not null default current_date,
  -- null = es la asignacion vigente. Solo puede haber una por linea, lo
  -- garantiza el indice unico de abajo.
  hasta date,
  motivo text,
  registrado_por text,
  created_at timestamptz not null default now()
);

create index if not exists kardex_lineas_asig_linea_idx on kardex_lineas_asignaciones (linea_numero, desde desc);
create unique index if not exists kardex_lineas_asig_vigente_idx
  on kardex_lineas_asignaciones (linea_numero) where hasta is null;

-- ---------------------------------------------------------------------------
-- Historico de estado (activacion / suspension / cancelacion)
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas_estados (
  id uuid primary key default gen_random_uuid(),
  linea_numero text not null references kardex_lineas(numero) on delete cascade,
  estado text not null check (estado in ('activa', 'suspendida', 'cancelada')),
  fecha date not null default current_date,
  motivo text,
  registrado_por text,
  created_at timestamptz not null default now()
);

create index if not exists kardex_lineas_estados_linea_idx on kardex_lineas_estados (linea_numero, fecha desc);

-- ---------------------------------------------------------------------------
-- Facturas: encabezado por contrato y periodo
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas_facturas (
  id uuid primary key default gen_random_uuid(),
  contrato_numero text references kardex_lineas_contratos(numero) on delete set null,
  -- Primer dia del mes facturado. Se guarda como date y no como texto para
  -- poder ordenar y restar periodos sin parsear cadenas.
  periodo date not null,
  fecha_factura date,
  -- La fecha limite de pago: es la segunda alerta que se pidio.
  fecha_vencimiento_pago date,
  total numeric(14, 2),
  pagada boolean not null default false,
  fecha_pago date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists kardex_lineas_facturas_unica
  on kardex_lineas_facturas (coalesce(contrato_numero, ''), periodo);

-- ---------------------------------------------------------------------------
-- Facturas: una fila por linea y periodo
-- ---------------------------------------------------------------------------
create table if not exists kardex_lineas_factura_detalle (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references kardex_lineas_facturas(id) on delete cascade,
  linea_numero text not null,
  cargo_basico numeric(14, 2),
  iva numeric(14, 2),
  cargos numeric(14, 2),
  descuentos numeric(14, 2),
  total_antes_impuestos numeric(14, 2),
  impoconsumo numeric(14, 2),
  iva_consumo numeric(14, 2),
  total numeric(14, 2),
  created_at timestamptz not null default now()
);

-- Sin FK a kardex_lineas a proposito: una factura vieja puede traer una linea
-- que despues se dio de baja y se borro del inventario, y perder el renglon
-- de costo por eso seria peor que tenerlo huerfano.
create unique index if not exists kardex_lineas_detalle_unico
  on kardex_lineas_factura_detalle (factura_id, linea_numero);
create index if not exists kardex_lineas_detalle_linea_idx
  on kardex_lineas_factura_detalle (linea_numero);

-- ---------------------------------------------------------------------------
-- Permisos por modulo
-- ---------------------------------------------------------------------------
-- La lista se copia de la que HAY en produccion (se consulto pg_constraint,
-- no el .sql mas reciente por fecha del nombre: ya paso una vez que el
-- archivo y la base no coincidieran).
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
    'lineas-celulares'
  ));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A diferencia del modulo de fondos (solo lectura, la carga va por fuera),
-- aca SI hay escritura desde la app: dar de alta una linea, activarla,
-- suspenderla y cambiarle el responsable es el trabajo diario del modulo.
alter table kardex_lineas_contratos enable row level security;
alter table kardex_lineas enable row level security;
alter table kardex_lineas_asignaciones enable row level security;
alter table kardex_lineas_estados enable row level security;
alter table kardex_lineas_facturas enable row level security;
alter table kardex_lineas_factura_detalle enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'kardex_lineas_contratos', 'kardex_lineas', 'kardex_lineas_asignaciones',
    'kardex_lineas_estados', 'kardex_lineas_facturas', 'kardex_lineas_factura_detalle'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);

    execute format($f$
      create policy %I on %I for select to authenticated
      using (kardex_is_authorized() or kardex_tiene_permiso('lineas-celulares', 'ver'))
    $f$, t || '_sel', t);

    -- Las dos tablas de historico se escriben SIEMPRE como consecuencia de
    -- editar una linea (cambiarle el responsable o el estado), nunca por si
    -- solas. Si su insert exigiera 'agregar', una cuenta con permiso de
    -- editar podria cambiar el estado de la linea pero no dejar el renglon
    -- del historico -- o sea, la operacion entera fallaria. Se comprobo
    -- impersonando una cuenta con solo 'ver'+'editar': fallaba justo asi.
    if t in ('kardex_lineas_asignaciones', 'kardex_lineas_estados') then
      execute format($f$
        create policy %I on %I for insert to authenticated
        with check (kardex_is_authorized()
                    or kardex_tiene_permiso('lineas-celulares', 'agregar')
                    or kardex_tiene_permiso('lineas-celulares', 'editar'))
      $f$, t || '_ins', t);
    else
      execute format($f$
        create policy %I on %I for insert to authenticated
        with check (kardex_is_authorized() or kardex_tiene_permiso('lineas-celulares', 'agregar'))
      $f$, t || '_ins', t);
    end if;

    execute format($f$
      create policy %I on %I for update to authenticated
      using (kardex_is_authorized() or kardex_tiene_permiso('lineas-celulares', 'editar'))
      with check (kardex_is_authorized() or kardex_tiene_permiso('lineas-celulares', 'editar'))
    $f$, t || '_upd', t);

    execute format($f$
      create policy %I on %I for delete to authenticated
      using (kardex_is_authorized() or kardex_tiene_permiso('lineas-celulares', 'borrar'))
    $f$, t || '_del', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cambiar el responsable de una linea, en una sola operacion
-- ---------------------------------------------------------------------------
-- Es funcion y no tres llamadas desde el cliente porque son tres escrituras
-- que tienen que pasar juntas o no pasar: cerrar la asignacion vigente, abrir
-- la nueva y actualizar el responsable desnormalizado de la linea. Si el
-- navegador se cierra entre la primera y la segunda, la linea queda sin
-- responsable vigente y el indice unico deja de proteger nada.
create or replace function kardex_linea_asignar(
  p_linea text,
  p_responsable text,
  p_cargo text default null,
  p_employee_id uuid default null,
  p_desde date default current_date,
  p_motivo text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text;
begin
  if coalesce(trim(p_responsable), '') = '' then
    raise exception 'El responsable no puede quedar vacio.';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  -- La asignacion vigente se cierra el dia antes de que arranque la nueva,
  -- para que los rangos no se pisen al leer el historico.
  update kardex_lineas_asignaciones
     set hasta = greatest(desde, p_desde - 1)
   where linea_numero = p_linea and hasta is null;

  insert into kardex_lineas_asignaciones
    (linea_numero, responsable, cargo, employee_id, desde, motivo, registrado_por)
  values (p_linea, trim(p_responsable), nullif(trim(coalesce(p_cargo, '')), ''),
          p_employee_id, p_desde, nullif(trim(coalesce(p_motivo, '')), ''), v_email);

  update kardex_lineas
     set responsable = trim(p_responsable),
         cargo = nullif(trim(coalesce(p_cargo, '')), ''),
         employee_id = p_employee_id,
         updated_at = now(),
         actualizado_por = v_email
   where numero = p_linea;
end;
$$;

revoke all on function kardex_linea_asignar(text, text, text, uuid, date, text) from public;
grant execute on function kardex_linea_asignar(text, text, text, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cambiar el estado de una linea
-- ---------------------------------------------------------------------------
-- Mismo motivo: deja el renglon en el historico Y actualiza la linea. Ademas
-- pone/limpia fecha_activacion y fecha_desactivacion segun corresponda, que
-- es lo que siempre se olvida cuando esto se hace con dos updates sueltos.
create or replace function kardex_linea_cambiar_estado(
  p_linea text,
  p_estado text,
  p_fecha date default current_date,
  p_motivo text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text;
begin
  if p_estado not in ('activa', 'suspendida', 'cancelada') then
    raise exception 'Estado invalido: %', p_estado;
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  insert into kardex_lineas_estados (linea_numero, estado, fecha, motivo, registrado_por)
  values (p_linea, p_estado, p_fecha, nullif(trim(coalesce(p_motivo, '')), ''), v_email);

  update kardex_lineas
     set estado = p_estado,
         fecha_activacion = case when p_estado = 'activa' then coalesce(fecha_activacion, p_fecha)
                                 else fecha_activacion end,
         -- Al reactivar se limpia la fecha de baja: dejarla puesta hacia que
         -- la linea apareciera a la vez activa y dada de baja.
         fecha_desactivacion = case when p_estado = 'cancelada' then p_fecha
                                    when p_estado = 'activa' then null
                                    else fecha_desactivacion end,
         updated_at = now(),
         actualizado_por = v_email
   where numero = p_linea;
end;
$$;

revoke all on function kardex_linea_cambiar_estado(text, text, date, text) from public;
grant execute on function kardex_linea_cambiar_estado(text, text, date, text) to authenticated;
