-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Amplia el perfil sociodemografico con 3 campos que faltaban frente a la
-- practica oficial en Colombia (ficha de datos generales del Ministerio de
-- Salud y Proteccion Social, sobre la base del Decreto 1072 de 2015):
-- tipo de vivienda, personas a cargo y cabeza de familia. Tambien remapea
-- "raza" a las categorias oficiales de pertenencia etnica (DANE), que
-- reemplazan las opciones anteriores en el formulario -- no se renombra la
-- columna para no romper lo ya cargado, solo se ajustan los valores.
-- Ejecutar en el SQL Editor de Supabase. Seguro de re-ejecutar.
-- ============================================================================

alter table perfil_sociodemografico add column if not exists personas_a_cargo integer;
alter table perfil_sociodemografico add column if not exists cabeza_familia boolean;
alter table perfil_sociodemografico add column if not exists tipo_vivienda text;

update perfil_sociodemografico set raza = 'Ninguna de las anteriores' where raza in ('Mestizo', 'Blanco', 'Otro');
update perfil_sociodemografico set raza = 'Negro(a), mulato(a), afrocolombiano(a)' where raza = 'Afrodescendiente';
-- 'Indígena' ya coincide con la nueva opción, no necesita cambio.
