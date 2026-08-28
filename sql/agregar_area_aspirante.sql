-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Agrega el area a la que aspira el candidato (ademas del cargo) -- para
-- poder hacerle seguimiento al proceso por area, no solo por cargo.
-- Ejecutar en el SQL Editor de Supabase. Seguro de re-ejecutar.
-- ============================================================================

alter table aspirantes add column if not exists area_aspirada text;
