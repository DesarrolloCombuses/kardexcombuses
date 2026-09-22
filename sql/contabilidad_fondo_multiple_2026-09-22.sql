-- Contabilidad: soportar VARIOS fondos de reposición, no solo el de siniestros.
--
-- Llegó el "Fondo de reposición urbano", que tiene la misma forma (aportes
-- mensuales por vehículo + un cuadro de resumen) pero es un fondo aparte.
-- Y 60 de sus 82 vehículos YA están en el fondo de siniestros: el mismo bus
-- aporta a los dos. Por eso el interno deja de identificar una fila por sí
-- solo y todo pasa a llevar la columna `fondo`.
--
-- Lo ya cargado queda como fondo 'siniestros' (el default del ALTER), así
-- que no hay que recargarlo.
--
-- Dos cosas que trae el archivo urbano y el de siniestros no tenía:
--   * PLACA propia (el de siniestros solo traía interno).
--   * Movimientos que comparten mes con el aporte normal: una columna
--     "devolución mayo" aparte de mayo-2020, y dos columnas distintas para
--     octubre-2017. Por eso aparece `concepto`: distingue esos registros sin
--     perderlos ni sumarlos a ciegas contra el aporte del mes.

-- =====================================================================
-- 1) Columna `fondo` en todas las tablas
-- =====================================================================
alter table kardex_fondo_vehiculos
  add column if not exists fondo text not null default 'siniestros',
  add column if not exists placa text;
alter table kardex_fondo_aportes
  add column if not exists fondo text not null default 'siniestros',
  add column if not exists concepto text;
alter table kardex_fondo_rendimientos_vehiculo
  add column if not exists fondo text not null default 'siniestros';
alter table kardex_fondo_resumen
  add column if not exists fondo text not null default 'siniestros';

-- Catálogo de fondos, para no repartir los nombres bonitos por el código.
create table if not exists kardex_fondos (
  clave text primary key,
  nombre text not null,
  orden int not null default 0
);
insert into kardex_fondos (clave, nombre, orden) values
  ('siniestros', 'Fondo de reposición de siniestros', 1),
  ('urbano',     'Fondo de reposición urbano', 2)
on conflict (clave) do update set nombre = excluded.nombre, orden = excluded.orden;

-- =====================================================================
-- 2) Las llaves pasan a ser (fondo, interno)
-- =====================================================================
alter table kardex_fondo_aportes                drop constraint if exists kardex_fondo_aportes_interno_fkey;
alter table kardex_fondo_rendimientos_vehiculo  drop constraint if exists kardex_fondo_rendimientos_vehiculo_interno_fkey;
alter table kardex_fondo_aportes                drop constraint if exists kardex_fondo_aportes_interno_periodo_key;
alter table kardex_fondo_vehiculos              drop constraint if exists kardex_fondo_vehiculos_pkey;
alter table kardex_fondo_rendimientos_vehiculo  drop constraint if exists kardex_fondo_rendimientos_vehiculo_pkey;

alter table kardex_fondo_vehiculos              add primary key (fondo, interno);
alter table kardex_fondo_rendimientos_vehiculo  add primary key (fondo, interno);

alter table kardex_fondo_aportes
  add constraint kardex_fondo_aportes_vehiculo_fkey
  foreign key (fondo, interno) references kardex_fondo_vehiculos (fondo, interno) on delete cascade;
alter table kardex_fondo_rendimientos_vehiculo
  add constraint kardex_fondo_rendimientos_vehiculo_fkey
  foreign key (fondo, interno) references kardex_fondo_vehiculos (fondo, interno) on delete cascade;

-- Un vehículo puede tener, en el mismo mes, el aporte normal y además un
-- ajuste identificado por su concepto -- de ahí el coalesce en vez de un
-- unique simple (en un índice único, NULL no choca contra NULL).
drop index if exists kardex_fondo_aportes_unico;
create unique index kardex_fondo_aportes_unico
  on kardex_fondo_aportes (fondo, interno, periodo, coalesce(concepto, ''));

create index if not exists kardex_fondo_aportes_fondo_periodo_idx
  on kardex_fondo_aportes (fondo, periodo);

-- =====================================================================
-- 3) Las policies no cambian de criterio, pero se recrean para que el
--    módulo 'fondo-siniestros' cubra los dos fondos (es el mismo permiso
--    de "ver el fondo de reposición", no uno por fondo).
-- =====================================================================
drop policy if exists "permiso_ver_fondo_vehiculos" on kardex_fondo_vehiculos;
create policy "permiso_ver_fondo_vehiculos" on kardex_fondo_vehiculos for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized()
    or kardex_tiene_permiso('fondo-siniestros', 'ver')
    or kardex_tiene_permiso('fondo-rendimientos', 'ver')
  ));

alter table kardex_fondos enable row level security;
drop policy if exists "permiso_ver_fondos" on kardex_fondos;
create policy "permiso_ver_fondos" on kardex_fondos for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized()
    or kardex_tiene_permiso('fondo-siniestros', 'ver')
    or kardex_tiene_permiso('fondo-rendimientos', 'ver')
  ));
