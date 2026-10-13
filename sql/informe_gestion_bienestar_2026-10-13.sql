-- ============================================================================
-- Kardex / ERP Combuses -- Indicador "Actividades de bienestar"
--
-- Complemento de sql/informe_gestion_2026-10-13.sql. Correr DESPUES de ese.
--
-- Los 24 indicadores que ya existen se alimentan a mano, porque su dato vive
-- fuera del ERP (reuniones del COPASST, horas-hombre, auditorias). Este no:
-- las actividades de bienestar ya se registran en el modulo Actividades, asi
-- que contarlas otra vez a mano seria pedirle a alguien que copie un numero
-- que el sistema ya sabe -- y que se desactualice en cuanto se cree una
-- actividad mas.
--
-- Por eso se agrega la nocion de FUENTE al catalogo: un indicador puede ser
-- 'manual' (se digita) o traer su valor de una tabla del propio ERP. Este es
-- el primero de los segundos; mas adelante pueden entrar por el mismo camino
-- las preoperacionales y el mantenimiento vehicular, que tambien se cuentan
-- solos desde el modulo Seguridad vial.
--
-- Seguro de re-ejecutar.
-- ============================================================================

alter table public.kardex_ig_indicadores
  add column if not exists fuente text not null default 'manual';

alter table public.kardex_ig_indicadores
  drop constraint if exists kardex_ig_indicadores_fuente_check;
alter table public.kardex_ig_indicadores
  add constraint kardex_ig_indicadores_fuente_check
  check (fuente in ('manual', 'actividades'));

comment on column public.kardex_ig_indicadores.fuente is
  'De donde sale el valor: ''manual'' se digita; ''actividades'' lo cuenta el ERP de kardex_actividades.';

-- ---------------------------------------------------------------------------
-- El conteo
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque el informe de gestion necesita CUANTAS actividades
-- hubo, no verlas: una cuenta puede tener permiso del informe y no del modulo
-- Actividades, y sin esto el conteo le daria 0 -- que se leeria como "no se
-- hizo ninguna actividad de bienestar" en vez de "no puedes ver eso". Por
-- bypassar RLS, lo primero que hace es exigir el permiso del informe.
--
-- Devuelve solo mes y total: ningun nombre, ninguna descripcion.
create or replace function public.kardex_ig_actividades_por_mes(p_anio integer)
returns table (periodo integer, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not kardex_ig_puede_ver() then
    raise exception 'Tu cuenta no tiene permiso para consultar el informe de gestion'
      using errcode = '42501';
  end if;

  return query
    select extract(month from a.fecha)::integer as periodo, count(*)::bigint as total
    from public.kardex_actividades a
    where extract(year from a.fecha) = p_anio
    group by 1
    order by 1;
end;
$$;

revoke all on function public.kardex_ig_actividades_por_mes(integer) from public, anon;
grant execute on function public.kardex_ig_actividades_por_mes(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- El indicador
-- ---------------------------------------------------------------------------
-- Sin meta numerica a proposito: nadie ha fijado cuantas actividades de
-- bienestar debe haber al mes, y ponerle una cifra inventada haria que el
-- modulo empezara a decir "no cumple" contra una meta que no existe. Entra
-- como informativo y se grafica su evolucion mes a mes, que es lo que de
-- verdad se quiere ver.
--
-- Para fijarle meta despues (ej. al menos 2 al mes), basta:
--   update kardex_ig_indicadores
--      set meta_valor = 2, meta_operador = '>=', meta_texto = 'Al menos 2 al mes'
--    where codigo = 'bienestar-actividades';
insert into public.kardex_ig_indicadores
  (codigo, sistema, nombre, formula, meta_valor, meta_operador, meta_texto, unidad, frecuencia, orden, fuente)
values
  ('bienestar-actividades', 'sgsst', 'Actividades de bienestar realizadas',
   'Actividades registradas en el módulo Actividades',
   null, '>=', 'Informativo', 'numero', 'mensual', 140, 'actividades')
on conflict (codigo) do update set
  sistema    = excluded.sistema,
  nombre     = excluded.nombre,
  formula    = excluded.formula,
  unidad     = excluded.unidad,
  frecuencia = excluded.frecuencia,
  orden      = excluded.orden,
  fuente     = excluded.fuente;

-- ---------------------------------------------------------------------------
-- Para comprobar:
--   select codigo, fuente from kardex_ig_indicadores where fuente <> 'manual';
--   select * from kardex_ig_actividades_por_mes(2026);
-- ---------------------------------------------------------------------------
