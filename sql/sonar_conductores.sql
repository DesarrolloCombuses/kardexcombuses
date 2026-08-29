-- ============================================================================
-- ERP Combuses -- Sincronizacion de conductores de la ruta 700 con Sonar
-- Telematics (plataforma externa de rastreo GPS).
--
-- Estas dos columnas solo registran EL RESULTADO del envio (cuando se envio
-- por ultima vez con exito, o el ultimo error), para poder mostrarlo en el
-- detalle del empleado y decidir si hay que reenviar. El envio en si lo hace
-- la Edge Function supabase/functions/sonar-insert-driver, que es quien
-- llama al webservice SOAP de Sonar -- las credenciales de Sonar (usuario y
-- contrasena) NUNCA viven en esta base de datos ni en este repo: se
-- configuran como secrets de esa funcion (`supabase secrets set`).
--
-- Seguro de re-ejecutar.
-- ============================================================================

alter table employees add column if not exists sonar_synced_at timestamptz;
alter table employees add column if not exists sonar_sync_error text;
