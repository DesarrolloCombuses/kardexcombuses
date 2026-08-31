// Catálogos de entidades colombianas (EPS, ARL, fondos de pensión y cajas de
// compensación) para los campos de afiliación del perfil sociodemográfico.
// Antes eran campos de texto libre -- ahora son campos de texto con sugerencias
// (datalist): al escribir o pegar el nombre, el navegador filtra la lista por
// las palabras que coincidan, y si la respuesta no está en la lista se puede
// seguir escribiendo libremente (el sistema de salud/pensiones colombiano
// cambia con frecuencia: fusiones, intervenciones, liquidaciones).
// Compartido entre el formulario interno (js/views/empleados.js) y el link
// público de autodiligenciamiento (js/perfil-publico.js) para que ambos
// muestren siempre las mismas sugerencias.
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
];

const ARL_COLOMBIA = [
  'ARL Sura',
  'ARL Positiva',
  'ARL Bolívar',
  'ARL Colmena',
  'ARL Colpatria (AXA Colpatria)',
  'ARL La Equidad',
  'ARL Aurora (antes Liberty Seguros)',
];

const FONDOS_PENSION_COLOMBIA = [
  'Colpensiones',
  'Porvenir',
  'Protección',
  'Colfondos',
  'Skandia',
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
];
