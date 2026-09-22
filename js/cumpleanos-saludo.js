// Saludo de cumpleaños al entrar a la app.
//
// Por qué no se muestra SOLO el día exacto: la gente no entra a la app todos
// los días, y un saludo que solo aparece el 11 de septiembre no lo ve nadie
// que ese día estuvo en ruta, de descanso o incapacitado. Por eso la ventana
// es de 30 días hacia atrás (nunca hacia adelante) y el texto cambia según
// el caso -- si ya pasó, lo reconoce en vez de fingir que es hoy.
//
// Se muestra UNA vez por año por persona: la marca queda en localStorage,
// que es por navegador. Si alguien entra desde el celular y desde un PC lo
// va a ver dos veces; se aceptó a propósito antes que guardar una tabla de
// "saludos mostrados" en la base para un mensaje de felicitación.

const CUMPLE_VENTANA_DIAS = 30;

// "SANDOVAL PEREZ ALEXANDRA" -> "Sandoval Perez Alexandra". No se intenta
// adivinar cuál de las palabras es el nombre de pila: en las fichas el orden
// es apellidos primero, pero no siempre, y equivocarse en el saludo de
// cumpleaños de alguien es peor que saludarlo con el nombre completo.
function cumpleNombreLegible(nombre) {
  return String(nombre || '')
    .toLocaleLowerCase('es-CO')
    .replace(/(^|\s|-)([\p{L}])/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'));
}

const CUMPLE_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Cuántos días pasaron desde el cumpleaños de ESTE año. Negativo = todavía
// no llega. Se compara por componentes (no con Date.parse del ISO) porque
// 'YYYY-MM-DD' se interpreta como UTC y en Colombia (UTC-5) eso corre la
// fecha un día para atrás -- el mismo bug que ya se cuidó en otras vistas.
function cumpleDiasDesde(fechaNacimientoIso, hoy = new Date()) {
  const partes = String(fechaNacimientoIso || '').split('-');
  if (partes.length !== 3) return null;
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (!mes || !dia) return null;

  // 29 de febrero en un año que no es bisiesto: se celebra el 28. Sin esto,
  // new Date(2026, 1, 29) se desborda al 1 de marzo.
  const anio = hoy.getFullYear();
  let cumple = new Date(anio, mes - 1, dia);
  if (cumple.getMonth() !== mes - 1) cumple = new Date(anio, mes - 1, dia - 1);

  const aMedianoche = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const MS_DIA = 24 * 60 * 60 * 1000;
  return Math.round((aMedianoche(hoy) - aMedianoche(cumple)) / MS_DIA);
}

// Decide si toca saludar y con qué texto. Separada del DOM a propósito, para
// poder probar la regla sin navegador.
function cumpleDecidir(datos, hoy = new Date()) {
  if (!datos || !datos.fecha_nacimiento) return null;
  const dias = cumpleDiasDesde(datos.fecha_nacimiento, hoy);
  if (dias === null || dias < 0 || dias > CUMPLE_VENTANA_DIAS) return null;

  const partes = datos.fecha_nacimiento.split('-');
  const fechaTexto = `${Number(partes[2])} de ${CUMPLE_MESES[Number(partes[1]) - 1]}`;

  if (dias === 0) {
    return { titulo: '¡Feliz cumpleaños!', detalle: 'Hoy es tu día. Que lo disfrutes mucho.', dias };
  }
  if (dias === 1) {
    return { titulo: '¡Feliz cumpleaños!', detalle: `Tu cumpleaños fue ayer y no alcanzamos a saludarte. ¡Felicitaciones!`, dias };
  }
  return {
    titulo: '¡Feliz cumpleaños!',
    detalle: `Tu cumpleaños fue el ${fechaTexto} y no alcanzamos a saludarte. ¡Felicitaciones, aunque sea con algunos días de retraso!`,
    dias,
  };
}

// localStorage puede no estar disponible (ventana privada, cookies
// bloqueadas) y el acceso mismo puede tirar excepción. Si falla, se saluda
// igual: peor es que la app se caiga por un mensaje de felicitación.
function cumpleYaSaludado(clave) {
  try { return localStorage.getItem(clave) === '1'; } catch { return false; }
}

function cumpleMarcarSaludado(clave) {
  try { localStorage.setItem(clave, '1'); } catch { /* sin almacenamiento */ }
}

function cumpleMostrarModal(saludo, nombre) {
  const backdrop = document.getElementById('modal-backdrop');
  const body = document.getElementById('modal-body');
  if (!backdrop || !body) return;

  body.innerHTML = `
    <div class="cumple-saludo">
      <div class="cumple-saludo-icono" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none">
          <path d="M32 9c0 3-3 3.6-3 6.2A3 3 0 0032 18a3 3 0 003-2.8C35 12.6 32 12 32 9z" fill="currentColor"/>
          <path d="M32 18v7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M14 34c0-3.3 2.7-6 6-6h24c3.3 0 6 2.7 6 6v3H14v-3z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M11 37h42v13a4 4 0 01-4 4H15a4 4 0 01-4-4V37z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M11 44c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3 3.5 3 7 3 3.5-3 7-3 3.5 3 7 3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 28v-4M42 28v-4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>
      <h2 class="cumple-saludo-titulo">${saludo.titulo}</h2>
      <p class="cumple-saludo-nombre">${nombre}</p>
      <p class="cumple-saludo-detalle">${saludo.detalle}</p>
      <p class="cumple-saludo-firma">Te desea <strong>Combuses S.A.</strong></p>
      <button type="button" class="btn-block" id="cumple-saludo-cerrar"><span>¡Gracias!</span></button>
    </div>
  `;
  backdrop.classList.remove('hidden');
  document.getElementById('cumple-saludo-cerrar').addEventListener('click', () => {
    backdrop.classList.add('hidden');
  });
}

// Punto de entrada, lo llama js/app.js al final del arranque. Nunca propaga
// un error: si algo falla acá la app tiene que seguir funcionando igual.
async function cumpleSaludarSiCorresponde() {
  try {
    const datos = await DB.getMiCumpleanos();
    if (!datos || !datos.employee_id) return;

    const saludo = cumpleDecidir(datos);
    if (!saludo) return;

    const clave = `kardex_cumple_${datos.employee_id}_${new Date().getFullYear()}`;
    if (cumpleYaSaludado(clave)) return;

    cumpleMostrarModal(saludo, cumpleNombreLegible(datos.nombre));
    cumpleMarcarSaludado(clave);
  } catch {
    // Cuenta administrativa sin ficha, sin conexión, permiso faltante… nada
    // de eso justifica romper el arranque de la app.
  }
}
