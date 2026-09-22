// Definición del formulario de perfil que autodiligencia la propia persona,
// compartida por los DOS lugares donde se llena exactamente lo mismo:
//  - perfil-publico.html -- link sin login, se valida con la cédula (lo usa
//    el aspirante recién convertido y cualquiera que todavía no tenga cuenta).
//  - #/mi-perfil dentro de la app -- la persona ya inició sesión, así que el
//    servidor la resuelve por su correo y no hay cédula que pedir.
// Vivía dentro de js/perfil-publico.js hasta v1.112.0; se sacó acá cuando
// apareció el segundo consumidor, para no tener dos copias de 130 líneas de
// formulario que se desincronizan a la primera que alguien agregue un campo.
//
// Depende de js/catalogos-colombia.js (EPS_COLOMBIA y compañía), así que
// tiene que cargarse DESPUÉS de ese archivo.
//
// Campos que se piden acá (autodiligenciados por la persona): casi todo el
// perfil sociodemográfico, foto y contactos de emergencia, agrupados en
// secciones (como el formulario interno de Empleados) para que se sienta
// ordenado y no como una sola lista larga de campos sueltos. Lo que queda
// fuera a propósito (turno de trabajo, tipo de vinculación, fecha de
// ingreso, observaciones) son decisiones administrativas de Combuses, no
// algo que la persona autoreporte -- esos se completan desde Empleados.
const SECCIONES_PUBLICAS = [
  {
    titulo: 'Datos personales',
    campos: [
      { id: 'tipo_identificacion', label: 'Tipo de identificación', type: 'select', options: ['CC', 'CE', 'TI', 'PA', 'Otro'] },
      { id: 'sexo', label: 'Sexo', type: 'select', options: ['Masculino', 'Femenino', 'Otro'] },
      { id: 'estado_civil', label: 'Estado civil', type: 'select', options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Divorciado(a)', 'Viudo(a)'] },
      { id: 'grado_escolaridad', label: 'Grado de escolaridad', type: 'select', options: ['Primaria', 'Secundaria incompleta', 'Secundaria completa', 'Técnico', 'Tecnólogo', 'Universitario', 'Posgrado'] },
      { id: 'tipo_sangre', label: 'Tipo de sangre', type: 'select', options: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
      { id: 'raza', label: 'Grupo étnico', type: 'select', options: ['Negro(a), mulato(a), afrocolombiano(a)', 'Indígena', 'Raizal del archipiélago de San Andrés y Providencia', 'Rom (gitano)', 'Ninguna de las anteriores'] },
    ],
  },
  {
    titulo: 'Vivienda y ubicación',
    campos: [
      { id: 'lugar_residencia', label: 'Municipio de residencia', type: 'text' },
      { id: 'direccion_residencia', label: 'Dirección de residencia', type: 'text' },
      { id: 'barrio', label: 'Barrio', type: 'text' },
      { id: 'tipo_vivienda', label: 'Tipo de vivienda', type: 'select', options: ['Propia urbana', 'En arriendo urbano', 'Familiar urbano', 'Propia rural', 'En arriendo rural', 'Familiar rural'] },
      { id: 'estrato_socioeconomico', label: 'Estrato socioeconómico', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
      { id: 'medio_desplazamiento', label: 'Medio de desplazamiento', type: 'select', options: ['A pie', 'Bicicleta', 'Moto propia', 'Vehículo propio', 'Transporte público', 'Transporte de la empresa', 'Otro'] },
    ],
  },
  {
    titulo: 'Composición familiar',
    campos: [
      { id: 'composicion_familiar', label: 'Composición familiar', type: 'text', placeholder: 'Ej: cónyuge y 2 hijos' },
      { id: 'personas_a_cargo', label: 'Personas a cargo', type: 'number' },
      { id: 'cabeza_familia', label: '¿Eres cabeza de familia?', type: 'checkbox' },
    ],
  },
  {
    titulo: 'Experiencia como conductor',
    campos: [
      { id: 'conduce', label: '¿Tienes experiencia como conductor?', type: 'checkbox' },
      { id: 'tipo_vehiculo_conduce', label: 'Tipo de vehículo que conduces', type: 'text' },
      { id: 'anios_experiencia_conduccion', label: 'Años de experiencia en conducción', type: 'number' },
    ],
  },
  {
    // Como esta misma app reparte la dotación, tener la talla desde el
    // ingreso evita tener que preguntarla después o adivinarla al momento
    // de la entrega.
    titulo: 'Talla de dotación',
    campos: [
      { id: 'talla_camisa', label: 'Talla de camisa', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] },
      { id: 'talla_pantalon', label: 'Talla de pantalón', type: 'select', options: ['28', '30', '32', '34', '36', '38', '40', '42', '44', '46'] },
      { id: 'talla_calzado', label: 'Talla de calzado', type: 'select', options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
    ],
  },
  {
    titulo: 'Afiliaciones',
    campos: [
      { id: 'eps', label: 'EPS', type: 'datalist', options: EPS_COLOMBIA },
      { id: 'arl', label: 'ARL', type: 'datalist', options: ARL_COLOMBIA },
      { id: 'fondo_pension', label: 'Fondo de pensión', type: 'datalist', options: FONDOS_PENSION_COLOMBIA },
      { id: 'caja_compensacion', label: 'Caja de compensación', type: 'datalist', options: CAJAS_COMPENSACION_COLOMBIA },
    ],
  },
];

// "Experiencia como conductor" solo se pregunta si el cargo al que aspiró
// (ya asignado por Selección de personal antes de generar este link) es de
// conductor -- a nadie más le corresponde esa sección.
function esCargoConductor(cargo) {
  return /conductor/i.test(cargo || '');
}

function seccionesVisibles(cargo) {
  return SECCIONES_PUBLICAS.filter((s) => s.titulo !== 'Experiencia como conductor' || esCargoConductor(cargo));
}

function campoPublicoHtml(campo, valor) {
  const id = `pp-${campo.id}`;
  if (campo.type === 'select') {
    const opciones = ['<option value="">—</option>']
      .concat(campo.options.map((o) => `<option value="${o}" ${valor === o ? 'selected' : ''}>${o}</option>`))
      .join('');
    return `<label>${campo.label}<select id="${id}">${opciones}</select></label>`;
  }
  if (campo.type === 'datalist') {
    const opciones = campo.options.map((o) => `<option value="${o}"></option>`).join('');
    return `<label>${campo.label}<input type="text" id="${id}" list="${id}-list" value="${valor == null ? '' : valor}" autocomplete="off" /><datalist id="${id}-list">${opciones}</datalist></label>`;
  }
  if (campo.type === 'checkbox') {
    return `<label class="checkbox-label"><input type="checkbox" id="${id}" ${valor ? 'checked' : ''} /> ${campo.label}</label>`;
  }
  return `<label>${campo.label}<input type="${campo.type}" id="${id}" value="${valor == null ? '' : valor}" ${campo.placeholder ? `placeholder="${campo.placeholder}"` : ''} /></label>`;
}

function seccionPublicaHtml(seccion, perfil) {
  const camposHtml = seccion.campos.map((c) => campoPublicoHtml(c, perfil[c.id])).join('');
  return `
    <fieldset class="pp-section">
      <legend>${seccion.titulo}</legend>
      <div class="fieldset-grid">${camposHtml}</div>
    </fieldset>
  `;
}

function leerValorCampo(campo) {
  const el = document.getElementById(`pp-${campo.id}`);
  if (campo.type === 'checkbox') return el.checked;
  if (campo.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value.trim() || null;
}

// Mismo límite en el cliente (para avisar antes de guardar) y en el
// servidor (que es el que de verdad lo hace cumplir): mayor de 17 años, y
// un tope de 90 para atrapar años digitados por error (ej. 1900 en vez de
// 2000), no porque nadie mayor de 90 pueda trabajar.
function validarFechaNacimiento(iso) {
  if (!iso) return 'La fecha de nacimiento es obligatoria.';
  const nacimiento = new Date(iso + 'T00:00:00');
  if (Number.isNaN(nacimiento.getTime())) return 'Fecha de nacimiento inválida.';
  const hoy = new Date();
  if (nacimiento > hoy) return 'La fecha de nacimiento no puede ser una fecha futura.';
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
  if (edad < 17) return 'Debes ser mayor de 17 años para completar este formulario.';
  if (edad > 90) return 'Revisa la fecha de nacimiento, parece incorrecta.';
  return null;
}

// Pinta los contactos de emergencia / hijos, que son filas repetibles y no
// caben en SECCIONES_PUBLICAS. Reciben el id del contenedor porque los dos
// consumidores usan el mismo marcado.
function addContactoRow(contenedorId, contacto) {
  const opciones = ['Cónyuge/Pareja', 'Padre', 'Madre', 'Hijo(a)', 'Hermano(a)', 'Otro familiar', 'Otro'];
  const wrap = document.createElement('div');
  wrap.className = 'linea-row-wrap';
  wrap.innerHTML = `
    <div class="linea-row">
      <div class="linea-field"><span class="linea-field-label">Nombre</span><input type="text" class="contacto-nombre" value="${contacto?.nombre || ''}" /></div>
      <div class="linea-field"><span class="linea-field-label">Parentesco</span>
        <select class="contacto-parentesco">
          <option value="">—</option>
          ${opciones.map((o) => `<option value="${o}" ${contacto?.parentesco === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="linea-field"><span class="linea-field-label">Teléfono</span><input type="tel" class="contacto-telefono" value="${contacto?.telefono || ''}" /></div>
      <button type="button" class="linea-remove">Quitar</button>
    </div>
  `;
  document.getElementById(contenedorId).appendChild(wrap);
  wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
}

function addHijoRow(contenedorId, hijo) {
  const wrap = document.createElement('div');
  wrap.className = 'linea-row-wrap';
  wrap.innerHTML = `
    <div class="linea-row">
      <div class="linea-field"><span class="linea-field-label">Nombre</span><input type="text" class="hijo-nombre" value="${hijo?.nombre || ''}" /></div>
      <div class="linea-field"><span class="linea-field-label">Fecha de nacimiento</span><input type="date" class="hijo-fecha-nacimiento" value="${hijo?.fecha_nacimiento || ''}" /></div>
      <div class="linea-field"><span class="linea-field-label">Sexo</span>
        <select class="hijo-sexo">
          <option value="">—</option>
          <option value="Masculino" ${hijo?.sexo === 'Masculino' ? 'selected' : ''}>Masculino</option>
          <option value="Femenino" ${hijo?.sexo === 'Femenino' ? 'selected' : ''}>Femenino</option>
        </select>
      </div>
      <button type="button" class="linea-remove">Quitar</button>
    </div>
  `;
  document.getElementById(contenedorId).appendChild(wrap);
  wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
}

// Lee las filas repetibles de vuelta, descartando las que quedaron sin
// nombre (el usuario agregó una fila y no la llenó).
function leerContactos(contenedorId) {
  return Array.from(document.querySelectorAll(`#${contenedorId} .linea-row`))
    .map((row) => ({
      nombre: row.querySelector('.contacto-nombre').value.trim(),
      parentesco: row.querySelector('.contacto-parentesco').value || null,
      telefono: row.querySelector('.contacto-telefono').value.trim() || null,
    }))
    .filter((c) => c.nombre);
}

function leerHijos(contenedorId) {
  return Array.from(document.querySelectorAll(`#${contenedorId} .linea-row`))
    .map((row) => ({
      nombre: row.querySelector('.hijo-nombre').value.trim(),
      fecha_nacimiento: row.querySelector('.hijo-fecha-nacimiento').value || null,
      sexo: row.querySelector('.hijo-sexo').value || null,
    }))
    .filter((h) => h.nombre);
}
