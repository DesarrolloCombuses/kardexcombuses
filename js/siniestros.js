// Base de siniestros de conductores, mantenida por el equipo de SST en un
// Google Sheet publicado (fuera de Supabase). Antes se consultaba en vivo
// (fetch directo al CSV publicado) cada vez que alguien la necesitaba, pero
// ese endpoint de Google falla seguido (error 500 intermitente) -- cuando
// fallaba, quien generaba un Paz y Salvo se quedaba sin poder verificar
// siniestros en ese momento.
//
// Ahora una Edge Function (supabase/functions/sync-siniestros) sincroniza el
// sheet hacia la tabla siniestros_transito -- por cron cada hora y con el
// botón "Actualizar ahora" del módulo Siniestros -- y acá se lee esa copia,
// que es Supabase normal (rápido, protegido por RLS, no depende de que
// Google responda en el momento exacto en que alguien lo necesita).
let _cachePromise = null;

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

// Arma el mismo shape que antes armaba el parser de CSV, a partir de la fila
// cruda (encabezado -> valor) que guardó sync-siniestros en "datos".
function _reshapeFila(datos) {
  const get = (nombre) => (datos[nombre] || '').trim();
  const conciliacion = get('CONCILIADO');
  const detalle = Object.keys(datos)
    .filter((nombre) => nombre && !_esColumnaOculta(nombre))
    .map((nombre) => ({ label: nombre, valor: (datos[nombre] || '').trim() }))
    .filter((c) => c.valor);
  return {
    cedula: _soloDigitos(get('CEDULA')),
    fecha: get('FECHA SINIESTRO'),
    lesionados: get('LESIONADOS') || 'N/N',
    // "NO CONCILIADO" (o vacío) es el estado por defecto de un caso recién
    // abierto -- se trata como pendiente hasta que quede registrado un
    // desenlace real (a favor, en contra, desistimiento, intervenido por
    // tránsito).
    conciliacion: conciliacion || 'NO CONCILIADO',
    pendiente: !conciliacion || conciliacion.toUpperCase() === 'NO CONCILIADO',
    // Definición e hipótesis son la mejor lectura de las columnas con ese
    // nombre, pero el sheet no siempre las llena de forma consistente (a
    // veces la hipótesis real queda en "CODIGO" o "DESCRIPCION" en vez de
    // en "HIPOTESIS") -- por eso "detalle" trae TODA la fila cruda, para
    // que quien genera el documento pueda verificar y corregir estos dos
    // campos antes de imprimir.
    definicion: get('ESTADO DE SINIESTRO') || 'N/N',
    hipotesis: get('HIPOTESIS') || 'N/N',
    detalle,
  };
}

async function _cargar() {
  const { data, error } = await window.supabaseClient
    .from('siniestros_transito')
    .select('cedula, datos, synced_at');
  if (error) throw error;
  _ultimaSincronizacion = data.length ? data[0].synced_at : null;
  return data.map((fila) => _reshapeFila(fila.datos));
}

let _ultimaSincronizacion = null;

function _obtenerRegistros() {
  if (!_cachePromise) {
    _cachePromise = _cargar().catch((err) => {
      _cachePromise = null;
      throw err;
    });
  }
  return _cachePromise;
}

window.Siniestros = {
  async buscarPorCedula(cedula) {
    const cedulaDigits = _soloDigitos(cedula);
    const registros = await _obtenerRegistros();
    return registros.filter((r) => r.cedula === cedulaDigits);
  },

  // Todos los siniestros del sheet, sin filtrar por cédula -- para la vista
  // de estadísticas de Siniestros (junto a comparendos/accidentes).
  async listarTodos() {
    return _obtenerRegistros();
  },

  // Cuándo se sincronizó por última vez la copia en Supabase (null si la
  // tabla está vacía -- aún no ha corrido ninguna sincronización exitosa).
  // Se llena como efecto de buscarPorCedula/listarTodos, así que solo tiene
  // valor después de llamar alguna de las dos.
  ultimaSincronizacion() {
    return _ultimaSincronizacion;
  },

  // Fuerza una sincronización ahora mismo (botón "Actualizar ahora" en
  // Siniestros) en vez de esperar al cron cada hora -- útil cuando SST
  // acaba de agregar un caso y se necesita verlo de una vez. Invalida el
  // caché en memoria para que la próxima consulta traiga lo recién
  // sincronizado.
  async actualizarAhora() {
    const { data, error } = await window.supabaseClient.functions.invoke('sync-siniestros', { body: {} });
    if (error) {
      // Igual patrón que enviarConductorASonar en js/db.js: cuando la
      // función responde con un status distinto de 2xx, el SDK lo trae acá
      // como "error" (no como data.ok = false) -- el mensaje real igual
      // queda en el body de la respuesta.
      let mensaje = error.message;
      try {
        const body = await error.context?.json();
        if (body?.message) mensaje = body.message;
      } catch (_) {}
      throw new Error(mensaje);
    }
    _cachePromise = null;
    return data;
  },
};
