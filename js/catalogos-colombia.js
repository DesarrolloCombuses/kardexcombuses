// Catálogos de entidades colombianas (EPS, ARL, fondos de pensión y cajas de
// compensación) para los campos de afiliación del perfil sociodemográfico.
// Antes eran campos de texto libre -- quedan como listas para evitar
// digitación manual y errores de tipeo. Cada lista termina en una opción
// "Otra"/"Otro" por si alguien está afiliado a una entidad que no aparece
// (el sistema de salud/pensiones colombiano cambia con frecuencia: fusiones,
// intervenciones, liquidaciones).
// Compartido entre el formulario interno (js/views/empleados.js) y el link
// público de autodiligenciamiento (js/perfil-publico.js) para que ambos
// muestren siempre las mismas opciones.
// Fuentes (verificadas 2026): Supersalud/Portafolio y La República para EPS,
// Superfinanciera para ARL, listado oficial UGPP de cajas de compensación
// (14-ene-2026, excluye las que están en intervención administrativa total).

const EPS_COLOMBIA = [
  'Nueva EPS',
  'EPS Sura',
  'EPS Sanitas',
  'Salud Total EPS',
  'Compensar EPS',
  'Famisanar',
  'Coosalud EPS',
  'Mutual Ser EPS',
  'Aliansalud EPS',
  'S.O.S. (Servicio Occidental de Salud)',
  'Comfenalco Valle EPS',
  'Otra',
];

const ARL_COLOMBIA = [
  'ARL Sura',
  'ARL Positiva',
  'ARL Bolívar',
  'ARL Colmena',
  'ARL Colpatria (AXA Colpatria)',
  'ARL La Equidad',
  'ARL Aurora (antes Liberty Seguros)',
  'Otra',
];

const FONDOS_PENSION_COLOMBIA = [
  'Colpensiones',
  'Porvenir',
  'Protección',
  'Colfondos',
  'Skandia',
  'Otro',
];

const CAJAS_COMPENSACION_COLOMBIA = [
  'Cafamaz (Amazonas)',
  'Comfama (Antioquia)',
  'Cajasai (San Andrés y Providencia)',
  'Combarranquilla (Atlántico)',
  'Cajacopi Atlántico',
  'Comfamiliar Atlántico',
  'Comfenalco Cartagena',
  'Comfaboy (Boyacá)',
  'Confa (Caldas)',
  'Comfacasanare',
  'Comfacauca',
  'Comfacesar',
  'Comfachocó',
  'Colsubsidio (Bogotá/Cundinamarca)',
  'Cafam (Bogotá/Cundinamarca)',
  'Compensar (Bogotá/Cundinamarca)',
  'Comfacundi',
  'Cajamag (Magdalena)',
  'Cofrem (Meta)',
  'Comfaoriente (Norte de Santander)',
  'Comfamiliar Putumayo',
  'Comfenalco Quindío',
  'Comfenalco Santander',
  'Cajasan (Santander)',
  'Comfasucre (Sucre)',
  'Cafasur (Sur del Tolima)',
  'Comfenalco Tolima',
  'Comfatolima',
  'Comfenalco Valle (Valle del Cauca)',
  'Comfandi (Valle del Cauca)',
  'Otra',
];
