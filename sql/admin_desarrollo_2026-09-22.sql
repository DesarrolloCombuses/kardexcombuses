-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Agrega desarrollotecnologico@combuses.com.co como cuenta 'admin' -- es la
-- cuenta del propio desarrollador, con acceso total (mismo rol que
-- kardex@combuses.com.co / vinculaciones@combuses.com.co). Espejo exacto de
-- AUTHORIZED_USERS en js/permissions.js, que es donde vive la lista completa
-- comentada (ver sql/rls_solo_autorizados_2026-09-15.sql -- ambas listas
-- deben mantenerse en sync).
--
-- Repetible sin riesgo.
-- ============================================================================

insert into kardex_authorized_users (email, rol) values
  ('desarrollotecnologico@combuses.com.co', 'admin')
on conflict (email) do update set rol = excluded.rol;
