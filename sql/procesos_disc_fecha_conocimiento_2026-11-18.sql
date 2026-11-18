-- Procesos disciplinarios: la fecha en que la empresa se entera de los hechos.
--
-- El art. 106 del Reglamento Interno da DOS plazos alternativos para enviar
-- la citacion a descargos:
--
--   "La citacion a descargos debera enviarse dentro de los cinco (5) dias
--    habiles siguientes a la ocurrencia de la presunta falta disciplinaria
--    o dentro de los cuatro (4) dias habiles siguientes a aquel en que la
--    empresa tenga conocimiento."
--
-- Hasta ahora solo guardabamos `fecha_hechos`, asi que el aviso de plazo de
-- la ficha solo podia medir contra la primera rama y avisaba de mas cuando
-- la empresa se enteraba tarde -- que es justo el caso en que el plazo SI
-- esta cumplido. Con esta columna el aviso usa la rama que corresponde.
--
-- Es opcional a proposito: los 443 procesos importados no la traen, y de
-- ellos no se puede deducir. Cuando esta en null, el aviso sigue midiendo
-- contra los hechos y lo dice.
--
-- Aplicar en el SQL Editor de Supabase. No toca datos existentes.

alter table kardex_procesos_disciplinarios
  add column if not exists fecha_conocimiento date;

comment on column kardex_procesos_disciplinarios.fecha_conocimiento is
  'Fecha en que la empresa tuvo conocimiento de los hechos (art. 106 RIT). '
  'Si esta presente manda sobre fecha_hechos para contar el plazo de la '
  'citacion: 4 dias habiles desde el conocimiento, en vez de 5 desde los '
  'hechos. Null en los procesos importados del programa anterior.';

-- No puede ser anterior a los hechos ni futura respecto de la citacion.
-- Se deja como check y no solo como validacion de pantalla porque la tabla
-- tambien la escriben los RPC de importacion.
alter table kardex_procesos_disciplinarios
  drop constraint if exists kardex_pd_fecha_conocimiento_check;

alter table kardex_procesos_disciplinarios
  add constraint kardex_pd_fecha_conocimiento_check
  check (
    fecha_conocimiento is null
    or fecha_hechos is null
    or fecha_conocimiento >= fecha_hechos
  );
