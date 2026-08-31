// Pasa a mayúsculas automáticamente lo que se escribe en los campos de
// texto libre de toda la app (nombres, direcciones, observaciones, etc.),
// para que los datos queden consistentes sin depender de cómo cada persona
// los digite -- el campo "área" de empleados, por ejemplo, hoy mezcla
// mayúsculas y minúsculas de la misma palabra.
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

document.addEventListener('input', (e) => {
  const el = e.target;
  const esInputTexto = el instanceof HTMLInputElement && !TIPOS_SIN_MAYUSCULAS.has(el.type);
  const esTextarea = el instanceof HTMLTextAreaElement;
  if (!esInputTexto && !esTextarea) return;
  if (el.dataset.sinMayusculas !== undefined) return; // escape hatch puntual si algún campo lo necesita
  if (e.isComposing) return; // no interrumpir mientras un teclado predictivo/IME está componiendo

  const mayusculas = el.value.toUpperCase();
  if (mayusculas === el.value) return;
  const inicio = el.selectionStart;
  const fin = el.selectionEnd;
  el.value = mayusculas;
  if (inicio !== null && fin !== null) el.setSelectionRange(inicio, fin);
});
