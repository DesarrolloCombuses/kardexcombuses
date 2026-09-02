// Pasa a mayúsculas y sin tildes automáticamente lo que se escribe en los
// campos de texto libre de toda la app (nombres, direcciones, observaciones,
// etc.), para que los datos queden consistentes sin depender de cómo cada
// persona los digite -- el campo "área" de empleados, por ejemplo, antes
// mezclaba mayúsculas y minúsculas de la misma palabra, y las tildes
// mezcladas (o su ausencia) rompían cruces con otras bases de datos (Sonar,
// siniestros) que comparan nombres como texto plano.
//
// Un solo listener delegado en document (no uno por campo): así cubre
// también los campos que se inyectan después por innerHTML (formularios
// dentro de modales), sin tener que engancharlo a mano en cada vista.
//
// Tipos de <input> que NO se tocan porque el mayúsculas no aplica o
// rompería el campo: email (se escriben en minúscula por convención),
// password, search (no tiene sentido gritar mientras se busca), date,
// file, tel, number, checkbox, radio, hidden, url.
const TIPOS_SIN_MAYUSCULAS = new Set([
  'email', 'password', 'search', 'date', 'file', 'tel', 'number',
  'checkbox', 'radio', 'hidden', 'url', 'time', 'datetime-local', 'month', 'week',
]);

// La Ñ/ñ es una letra propia del español, no una vocal con tilde -- por eso
// se deja fuera de este mapa a propósito (usar String.normalize('NFD') la
// habría descompuesto en "N" + tilde y la habría dañado, ej. "MUÑOZ").
const MAPA_TILDES = {
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U',
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u',
};

function quitarTildes(texto) {
  return texto.replace(/[ÁÉÍÓÚÜáéíóúü]/g, (c) => MAPA_TILDES[c]);
}

document.addEventListener('input', (e) => {
  const el = e.target;
  const esInputTexto = el instanceof HTMLInputElement && !TIPOS_SIN_MAYUSCULAS.has(el.type);
  const esTextarea = el instanceof HTMLTextAreaElement;
  if (!esInputTexto && !esTextarea) return;
  if (el.dataset.sinMayusculas !== undefined) return; // escape hatch puntual si algún campo lo necesita
  if (e.isComposing) return; // no interrumpir mientras un teclado predictivo/IME está componiendo

  const transformado = quitarTildes(el.value).toUpperCase();
  if (transformado === el.value) return;
  const inicio = el.selectionStart;
  const fin = el.selectionEnd;
  el.value = transformado;
  if (inicio !== null && fin !== null) el.setSelectionRange(inicio, fin);
});
