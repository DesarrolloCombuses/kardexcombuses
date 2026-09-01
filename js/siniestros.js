// Base de siniestros de conductores, mantenida por el equipo de SST en un
// Google Sheet publicado (fuera de Supabase). Se consulta en vivo cada vez
// en lugar de importarla a la base de datos, porque le agregan accidentes
// nuevos todo el tiempo -- una copia importada quedaría desactualizada al
// día siguiente. Solo se usa para cruzar por cédula al generar un paz y
// salvo; no se guarda nada de esto en Supabase.
const SINIESTROS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSlQTJ6AaUMYxwmvspfKERk05d05obM83IMZ4PKvHH8wXPkDHQqIJhUqc8MSusSkQ/pub?gid=409955472&single=true&output=csv';

let _cachePromise = null;

// Parser CSV manual (maneja comillas, comas dentro de campos y saltos de
// línea dentro de campos con comillas) -- el sheet real tiene celdas así
// (ej. nombres de propietarios con coma incluida), un split(',') simple
// las rompería.
function _parseCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c === '\r') {
      // el \n que sigue cierra la fila
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function _soloDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Columnas que no aportan como "información del siniestro" para quien
// revisa el paz y salvo -- rutas de archivo (fotos/audio/video) que no se
// pueden ver desde acá, la cédula/conductor (ya se muestran en el
// encabezado del formulario) y el check de aceptación de datos personales.
const _COLUMNAS_OCULTAS = new Set([
  'KEY', 'CEDULA', 'CONDUCTOR', 'ACEPTA POLITICA DE DATOS PERSONALES',
  'CEDULA PRIMERA CARA', 'CEDULA SEGUNDA CARA', 'ANEXAR VIDEO',
]);
function _esColumnaOculta(nombre) {
  return _COLUMNAS_OCULTAS.has(nombre) || /^IMAGEN/.test(nombre) || /^VERSION AUDIO/.test(nombre);
}

async function _cargar() {
  const res = await fetch(SINIESTROS_CSV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo descargar la base de siniestros.');
  const texto = await res.text();
  const filas = _parseCSV(texto);
  if (!filas.length) return [];

  const headerCrudo = filas[0].map((h) => h.trim());
  const header = headerCrudo.map((h) => h.toUpperCase());
  const col = (nombre) => header.indexOf(nombre);
  const iCedula = col('CEDULA');
  const iFecha = col('FECHA SINIESTRO');
  const iLesionados = col('LESIONADOS');
  const iConciliado = col('CONCILIADO');
  const iEstado = col('ESTADO DE SINIESTRO');
  const iHipotesis = col('HIPOTESIS');

  // Columnas a mostrar en el detalle completo, en el mismo orden en que
  // aparecen en el sheet -- evita tener que adivinar de antemano cuáles
  // importan (el propio equipo de SST decide qué llenar en cada caso).
  const columnasDetalle = header
    .map((nombre, i) => ({ nombre, i }))
    .filter(({ nombre }) => nombre && !_esColumnaOculta(nombre));

  return filas.slice(1)
    .filter((r) => r.length > 1 && _soloDigitos(r[iCedula]))
    .map((r) => {
      const conciliacion = (r[iConciliado] || '').trim();
      const detalle = columnasDetalle
        .map(({ nombre, i }) => ({ label: headerCrudo[i], valor: (r[i] || '').trim() }))
        .filter((c) => c.valor);
      return {
        cedula: _soloDigitos(r[iCedula]),
        fecha: (r[iFecha] || '').trim(),
        lesionados: (r[iLesionados] || '').trim() || 'N/N',
        // "NO CONCILIADO" (o vacío) es el estado por defecto de un caso
        // recién abierto -- se trata como pendiente hasta que quede
        // registrado un desenlace real (a favor, en contra, desistimiento,
        // intervenido por tránsito).
        conciliacion: conciliacion || 'NO CONCILIADO',
        pendiente: !conciliacion || conciliacion.toUpperCase() === 'NO CONCILIADO',
        // Definición e hipótesis son la mejor lectura de las columnas con
        // ese nombre, pero el sheet no siempre las llena de forma
        // consistente (a veces la hipótesis real queda en "CODIGO" o
        // "DESCRIPCION" en vez de en "HIPOTESIS") -- por eso "detalle" trae
        // TODA la fila cruda, para que quien genera el documento pueda
        // verificar y corregir estos dos campos antes de imprimir.
        definicion: (r[iEstado] || '').trim() || 'N/N',
        hipotesis: (r[iHipotesis] || '').trim() || 'N/N',
        detalle,
      };
    });
}

window.Siniestros = {
  async buscarPorCedula(cedula) {
    const cedulaDigits = _soloDigitos(cedula);
    if (!_cachePromise) {
      _cachePromise = _cargar().catch((err) => {
        _cachePromise = null;
        throw err;
      });
    }
    const registros = await _cachePromise;
    return registros.filter((r) => r.cedula === cedulaDigits);
  },
};
