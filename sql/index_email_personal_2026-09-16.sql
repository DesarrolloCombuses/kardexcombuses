-- Arregla un timeout real en producción: al abrir "Empleados" con una cuenta
-- de grupo GESTION HUMANA (526 empleados + 3 tablas embebidas), cada fila
-- dispara kardex_es_gestion_humana() -> kardex_mi_grupo() ->
-- kardex_own_employee_id(), que hacía "where lower(email_personal) = ..."
-- SIN índice -- un recorrido completo de employees por cada fila evaluada
-- (potencialmente cientos de miles de comparaciones). Con admin/viewer no
-- se notaba porque kardex_is_authorized() solo mira una tabla de 4 filas.
create index if not exists employees_email_personal_lower_idx
  on employees (lower(email_personal))
  where activo = true;
