-- Contabilidad > Fondo de reposición de siniestros.
--
-- El fondo lo lleva contabilidad en un Excel ("FONDO SINIESTROS 2026") con
-- dos hojas: los aportes mensuales de cada vehículo, y un corte histórico de
-- rendimientos por vehículo. Al pie de cada hoja hay además un cuadro de
-- resumen del fondo completo (saldos por año, conciliaciones pagadas por
-- siniestros, rendimientos mensuales, inversión). Este esquema recibe las
-- tres cosas.
--
-- OJO: este archivo crea SOLO la estructura. Los datos se cargan aparte y
-- NUNCA se commitean: el repo es público y acá hay NIT y nombre de los
-- propietarios, más las cifras del fondo.
--
-- El interno cruza 1:1 con flota_vehiculos.interno (verificado: los 111
-- vehículos del fondo existen en la flota), así que la placa y la ruta NO se
-- duplican acá -- se leen de allá al consultar. Lo que sí se guarda es el
-- nit/propietario tal como los tiene contabilidad: es el dato contable del
-- aporte y no tiene que seguir al dueño actual del vehículo si este cambió.

-- =====================================================================
-- Vehículos que aportan al fondo
-- =====================================================================
create table if not exists kardex_fondo_vehiculos (
  interno text primary key,
  nit text,
  propietario text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Aporte mensual por vehículo (modelo largo: una fila por mes)
-- =====================================================================
create table if not exists kardex_fondo_aportes (
  id uuid primary key default gen_random_uuid(),
  interno text not null references kardex_fondo_vehiculos(interno) on delete cascade,
  periodo date not null,          -- primer día del mes al que corresponde el aporte
  valor numeric not null,         -- numeric sin escala fija: el Excel trae
                                  -- decimales largos y redondear acá haría
                                  -- que los totales no cuadren con el origen
  -- La primera columna del Excel (dic-25) NO es el aporte de ese mes: es el
  -- saldo acumulado con que cada vehículo arranca el año. Se comprobó
  -- sumando la columna (387.599.591,92) contra el propio cuadro de resumen:
  -- Saldo 2023 + Aportes 2024 - las 4 conciliaciones + Aportes 2025 =
  -- 387.599.592 (los 8 centavos de diferencia son redondeo del Excel).
  -- Sin esta marca la gráfica mensual queda inservible: una barra de 388
  -- millones al lado de meses de 14-23 millones aplasta todo lo demás.
  es_saldo_inicial boolean not null default false,
  created_at timestamptz not null default now(),
  unique (interno, periodo)
);
create index if not exists kardex_fondo_aportes_periodo_idx on kardex_fondo_aportes (periodo);

-- =====================================================================
-- Corte histórico de rendimientos por vehículo (hoja "RENDIMIENTOS")
-- Es una foto fija de cierre por año, no una serie: se guarda ancho, igual
-- que en el origen.
-- =====================================================================
create table if not exists kardex_fondo_rendimientos_vehiculo (
  interno text primary key references kardex_fondo_vehiculos(interno) on delete cascade,
  aportes_dic_2023 numeric,
  rendimientos_2023 numeric,
  total_2024 numeric,
  rendimientos_2024 numeric,
  total_2025 numeric,
  rendimientos_2025 numeric,
  total_propietario numeric,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Cuadro de resumen del fondo completo (el bloque al pie de las hojas)
-- =====================================================================
create table if not exists kardex_fondo_resumen (
  id uuid primary key default gen_random_uuid(),
  grupo text not null check (grupo in ('movimiento', 'rendimiento_mes', 'ingreso')),
  etiqueta text not null,
  detalle text,                   -- p.ej. de qué siniestro salió una conciliación
  valor numeric,
  periodo date,                   -- solo para grupo 'rendimiento_mes'
  orden int not null default 0,   -- para reproducir el orden del cuadro original
  created_at timestamptz not null default now()
);

-- =====================================================================
-- RLS: cifras financieras, así que nada de acceso por defecto. Solo
-- cuentas autorizadas o con el permiso granular del módulo. A diferencia de
-- otros módulos NO se abre a GESTION HUMANA: esto es de contabilidad.
-- =====================================================================
alter table kardex_fondo_vehiculos enable row level security;
alter table kardex_fondo_aportes enable row level security;
alter table kardex_fondo_rendimientos_vehiculo enable row level security;
alter table kardex_fondo_resumen enable row level security;

drop policy if exists "permiso_ver_fondo_vehiculos" on kardex_fondo_vehiculos;
create policy "permiso_ver_fondo_vehiculos" on kardex_fondo_vehiculos for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized()
    or kardex_tiene_permiso('fondo-siniestros', 'ver')
    or kardex_tiene_permiso('fondo-rendimientos', 'ver')
  ));

drop policy if exists "permiso_ver_fondo_aportes" on kardex_fondo_aportes;
create policy "permiso_ver_fondo_aportes" on kardex_fondo_aportes for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_tiene_permiso('fondo-siniestros', 'ver')
  ));

drop policy if exists "permiso_ver_fondo_resumen" on kardex_fondo_resumen;
create policy "permiso_ver_fondo_resumen" on kardex_fondo_resumen for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_tiene_permiso('fondo-siniestros', 'ver')
  ));

drop policy if exists "permiso_ver_fondo_rendimientos" on kardex_fondo_rendimientos_vehiculo;
create policy "permiso_ver_fondo_rendimientos" on kardex_fondo_rendimientos_vehiculo for select
  using (auth.role() = 'authenticated' and (
    kardex_is_authorized() or kardex_tiene_permiso('fondo-rendimientos', 'ver')
  ));

-- Sin policies de insert/update/delete a propósito: la carga es una
-- importación puntual que se corre por fuera de la app (como service_role),
-- no algo que se edite desde la pantalla. Si más adelante contabilidad sube
-- el archivo desde la app, eso se agrega acá de forma explícita.

-- =====================================================================
-- Los dos módulos nuevos en la matriz de permisos de Usuarios
-- =====================================================================
alter table kardex_permisos_usuario drop constraint if exists kardex_permisos_usuario_modulo_check;
alter table kardex_permisos_usuario add constraint kardex_permisos_usuario_modulo_check
  check (modulo in (
    'dashboard', 'inventario', 'inventario-historico', 'nueva-prenda', 'estadisticas',
    'entrada', 'salida', 'historial', 'facturas', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores',
    'personal-perfil', 'personal-rotacion', 'permisos-vacaciones', 'siniestros-transito',
    'parque-automotor', 'alertas-vencimientos', 'actividades',
    'fondo-siniestros', 'fondo-rendimientos'
  ));
