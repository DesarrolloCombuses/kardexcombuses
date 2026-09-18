-- Columnas visibles por cuenta en Empleados (ver y descargar Excel): además
-- de si una cuenta puede entrar o no a Empleados (kardex_permisos_usuario,
-- módulo "empleados"), el admin puede marcar QUÉ columnas de información
-- específicas puede ver esa cuenta -- ej. que alguien vea el listado de
-- personal pero nunca el salario ni la dirección de nadie.
--
-- A diferencia de los permisos granulares (kardex_permisos_usuario), esto
-- NO es aditivo -- es una restricción, a propósito, sobre lo que ya daría
-- el grupo o el módulo. Puede incluso restringir a una cuenta de GESTION
-- HUMANA si se le configura.
--
-- El bloqueo es real en el servidor: kardex_empleados_con_perfil() arma la
-- respuesta ya sin esas claves (jsonb - text[]), así que la columna oculta
-- nunca sale de Supabase hacia esa cuenta -- no depende de qué pida el
-- cliente en su select().
--
-- Repetible sin riesgo (create table/function usan if not exists / or
-- replace; create policy no -- se dropea antes).

-- Endurece kardex_es_gestion_humana() (sql/gestion_humana_modulos_2026-09-16.sql):
-- antes podía devolver NULL (no false) para una cuenta sin grupo, porque
-- "kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA'" da NULL
-- cuando kardex_mi_grupo() es NULL. En las policies RLS que ya la usan eso
-- no cambia nada (NULL excluye la fila igual que false), pero en un
-- "if not (...)" de PL/pgSQL sí importa -- "if not (NULL)" no entra al
-- then, así que cualquier chequeo de autorización que confiara en esta
-- función quedaría bypasseado para una cuenta sin grupo (se detectó al
-- armar kardex_empleados_con_perfil, más abajo). Cambio puramente
-- defensivo, mismo comportamiento donde ya se usaba.
create or replace function kardex_es_gestion_humana()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA', false);
$$;

create table if not exists kardex_columnas_ocultas_empleados (
  employee_id uuid not null references employees(id),
  campo text not null check (campo in (
    'telefono', 'email_personal', 'salario', 'fecha_salida', 'motivo_renuncia',
    'contactos_emergencia', 'hijos_empleado',
    -- mismos ids que CAMPOS_SOCIODEMOGRAFICOS en js/views/empleados.js:
    'tipo_identificacion', 'fecha_nacimiento', 'sexo', 'estado_civil', 'grado_escolaridad',
    'composicion_familiar', 'personas_a_cargo', 'cabeza_familia', 'estrato_socioeconomico',
    'lugar_residencia', 'direccion_residencia', 'barrio', 'tipo_vivienda', 'medio_desplazamiento',
    'raza', 'tipo_sangre', 'turno_trabajo', 'tipo_vinculacion', 'fecha_ingreso', 'conduce',
    'tipo_vehiculo_conduce', 'anios_experiencia_conduccion', 'talla_camisa', 'talla_pantalon',
    'talla_calzado', 'eps', 'arl', 'fondo_pension', 'caja_compensacion', 'observaciones'
  )),
  creado_por_email text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, campo)
);

alter table kardex_columnas_ocultas_empleados enable row level security;

drop policy if exists "admin_all" on kardex_columnas_ocultas_empleados;
create policy "admin_all" on kardex_columnas_ocultas_empleados
  for all using (auth.role() = 'authenticated' and kardex_is_authorized())
  with check (auth.role() = 'authenticated' and kardex_is_authorized());

create or replace function kardex_empleados_con_perfil(
  p_only_active boolean default true,
  p_limit int default 1000,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ocultos text[];
  v_empleados jsonb;
begin
  -- Mismo criterio que hoy dan las RLS de employees/perfil_sociodemografico
  -- para quien de verdad llama a esta función (DB.getEmployeesConPerfil,
  -- usada por Empleados/Alertas/Cumpleaños/Conductores/Perfil) -- salida e
  -- historial también pueden leer employees por RLS, pero tienen su propia
  -- consulta en sus vistas y nunca pasan por acá, así que no hace falta
  -- incluirlas.
  -- coalesce(...,false) es obligatorio acá: kardex_es_gestion_humana() hace
  -- "kardex_is_authorized() or kardex_mi_grupo() = 'GESTION HUMANA'" -- para
  -- una cuenta sin grupo, kardex_mi_grupo() da NULL, y "false or NULL" da
  -- NULL (no false) en SQL. En una policy RLS eso da igual (NULL excluye la
  -- fila igual que false), pero acá es un "if not (...)" en PL/pgSQL, donde
  -- "if not (NULL)" NO entra al then -- sin el coalesce, cualquier cuenta
  -- autenticada sin permiso alguno pasaba el chequeo (se detectó con el test
  -- de impersonación de más abajo antes de aplicar este fix).
  if not coalesce(
    kardex_es_gestion_humana()
    or kardex_tiene_permiso('empleados', 'ver') or kardex_tiene_permiso('personal-cumpleanos', 'ver')
    or kardex_tiene_permiso('personal-alertas', 'ver') or kardex_tiene_permiso('personal-conductores', 'ver')
    or kardex_tiene_permiso('personal-perfil', 'ver'),
    false
  ) then
    raise exception 'No autorizado';
  end if;

  -- coalesce a '{}' es obligatorio: sin filas (cuenta admin sin
  -- employee_id), array_agg da NULL, y "jsonb - NULL::text[]" más abajo
  -- borraría el objeto entero en vez de no quitar nada.
  select coalesce(array_agg(campo), '{}') into v_ocultos
  from kardex_columnas_ocultas_empleados
  where employee_id = kardex_own_employee_id();

  select coalesce(jsonb_agg(fila), '[]'::jsonb) into v_empleados
  from (
    select
      (to_jsonb(e) - v_ocultos)
        || jsonb_build_object(
             'perfil_sociodemografico',
             case when ps.employee_id is null then null else to_jsonb(ps) - v_ocultos end
           )
        || (case when 'contactos_emergencia' = any(v_ocultos) then '{}'::jsonb
             else jsonb_build_object('contactos_emergencia', coalesce(ce.arr, '[]'::jsonb)) end)
        || (case when 'hijos_empleado' = any(v_ocultos) then '{}'::jsonb
             else jsonb_build_object('hijos_empleado', coalesce(he.arr, '[]'::jsonb)) end)
      as fila
    from employees e
    left join perfil_sociodemografico ps on ps.employee_id = e.id
    left join lateral (
      select jsonb_agg(to_jsonb(c)) as arr from contactos_emergencia c where c.employee_id = e.id
    ) ce on true
    left join lateral (
      select jsonb_agg(to_jsonb(h)) as arr from hijos_empleado h where h.employee_id = e.id
    ) he on true
    where (not p_only_active or e.activo)
    order by e.nombre
    limit p_limit offset p_offset
  ) sub;

  return jsonb_build_object('empleados', v_empleados, 'campos_ocultos', to_jsonb(v_ocultos));
end;
$$;

revoke all on function kardex_empleados_con_perfil(boolean, int, int) from public;
grant execute on function kardex_empleados_con_perfil(boolean, int, int) to authenticated;
