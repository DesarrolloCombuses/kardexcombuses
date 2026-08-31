// Página pública (sin login) para que el nuevo empleado complete su perfil
// a partir de un link con su employee_id. La cédula que escribe se valida
// del lado del servidor (funciones RPC en sql/perfil_publico.sql), nunca se
// confía en el cliente para decidir a quién pertenece el registro -- lo
// mismo aplica a la edad mínima (17 años), que también se revisa acá para
// dar feedback inmediato pero la valida de nuevo el servidor.
//
// Campos que se piden acá (autodiligenciados por la persona): casi todo el
// perfil sociodemográfico, foto y contactos de emergencia, agrupados en
// secciones (como el formulario interno de Empleados) para que se sienta
// ordenado y no como una sola lista larga de campos sueltos. Lo que queda
// fuera a propósito (turno de trabajo, tipo de vinculación, fecha de
// ingreso, observaciones) son decisiones administrativas de Combuses, no
// algo que la persona autoreporte -- esos se completan desde Empleados y
// acá solo se muestra la fecha de ingreso, de referencia.
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
      { id: 'eps', label: 'EPS', type: 'select', options: EPS_COLOMBIA },
      { id: 'arl', label: 'ARL', type: 'select', options: ARL_COLOMBIA },
      { id: 'fondo_pension', label: 'Fondo de pensión', type: 'select', options: FONDOS_PENSION_COLOMBIA },
      { id: 'caja_compensacion', label: 'Caja de compensación', type: 'select', options: CAJAS_COMPENSACION_COLOMBIA },
    ],
  },
];

const TODOS_LOS_CAMPOS = SECCIONES_PUBLICAS.flatMap((s) => s.campos);

function campoPublicoHtml(campo, valor) {
  const id = `pp-${campo.id}`;
  if (campo.type === 'select') {
    const opciones = ['<option value="">—</option>']
      .concat(campo.options.map((o) => `<option value="${o}" ${valor === o ? 'selected' : ''}>${o}</option>`))
      .join('');
    return `<label>${campo.label}<select id="${id}">${opciones}</select></label>`;
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

(function () {
  document.getElementById('pp-year').textContent = new Date().getFullYear();

  const params = new URLSearchParams(window.location.search);
  const employeeId = params.get('id');

  const gateCard = document.getElementById('pp-gate-card');
  const formCard = document.getElementById('pp-form-card');
  const errorCard = document.getElementById('pp-error-card');

  if (!employeeId) {
    gateCard.classList.add('hidden');
    errorCard.classList.remove('hidden');
    return;
  }

  let cedulaVerificada = null;
  let fotoCamera = null;

  const formatFecha = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  function addContactoRow(contacto) {
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
    document.getElementById('pp-contactos').appendChild(wrap);
    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  }

  function addHijoRow(hijo) {
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
    document.getElementById('pp-hijos').appendChild(wrap);
    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  }

  function bannerAprobacionHtml(perfil) {
    return perfil.perfil_aprobado_at
      ? '<div class="pp-banner aprobado" id="pp-estado-banner">✓ Tu perfil fue aprobado. ¡Bienvenido(a) a Combuses!</div>'
      : '<div class="pp-banner pendiente" id="pp-estado-banner">Tu información está en revisión. Puedes volver a entrar por este mismo link para ver cuándo quede aprobada.</div>';
  }

  function renderFormulario(perfil) {
    const seccionesHtml = SECCIONES_PUBLICAS.map((s) => seccionPublicaHtml(s, perfil)).join('');
    const inicial = (perfil.nombre || '?').trim().charAt(0).toUpperCase();

    formCard.innerHTML = `
      ${bannerAprobacionHtml(perfil)}

      <div class="pp-profile-header">
        <div class="foto-picker-row">
          <span class="person-avatar foto-picker-avatar" id="pp-foto-fallback">${inicial}</span>
          <img id="pp-foto-preview" class="foto-picker-preview hidden" alt="" />
          <div class="foto-picker-actions">
            <label class="file-picker" for="pp-foto-input">
              <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
              <span id="pp-foto-label">${perfil.foto_url ? 'Cambiar foto' : 'Agregar foto'}</span>
            </label>
            <!-- Sin "capture": así el selector nativo del celular deja
                 elegir entre tomar una foto nueva o escogerla de la
                 galería, en vez de forzar la cámara de una (que es lo que
                 pasa con el atributo capture y no deja otra opción). -->
            <input type="file" id="pp-foto-input" accept="image/*" class="hidden" />
          </div>
        </div>
        <div class="pp-profile-header-name">
          <h2>Hola, ${perfil.nombre || ''}</h2>
          <p class="pp-subtitle" style="margin:0.15rem 0 0">Completa la mayor cantidad de datos que puedas. Puedes volver a este link cuando quieras para revisarlos.</p>
        </div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${perfil.cargo || '—'}</div><div class="detalle-fact-label">Cargo</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${perfil.area || '—'}</div><div class="detalle-fact-label">Área</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${formatFecha(perfil.fecha_ingreso)}</div><div class="detalle-fact-label">Fecha de ingreso</div></div>
      </div>

      <form id="pp-datos-form" class="form">
        <fieldset class="pp-section">
          <legend>Fecha de nacimiento</legend>
          <label>Fecha de nacimiento<input type="date" id="pp-fecha-nacimiento" value="${perfil.fecha_nacimiento || ''}" required /></label>
          <p id="pp-fecha-nacimiento-msg" class="form-msg"></p>
        </fieldset>

        ${seccionesHtml}

        <fieldset class="pp-section">
          <legend>Contacto</legend>
          <div class="fieldset-grid">
            <label>Teléfono<input type="tel" id="pp-telefono" value="${perfil.telefono || ''}" placeholder="Número de celular" /></label>
            <label>Correo personal<input type="email" id="pp-email-personal" value="${perfil.email_personal || ''}" placeholder="tucorreo@ejemplo.com" /></label>
          </div>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Contactos de emergencia</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Puedes agregar más de uno.</p>
          <div id="pp-contactos"></div>
          <button type="button" id="pp-contacto-add" class="btn-secondary">+ Agregar contacto</button>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Hijos</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Si tienes, puedes agregar más de uno.</p>
          <div id="pp-hijos"></div>
          <button type="button" id="pp-hijo-add" class="btn-secondary">+ Agregar hijo/a</button>
        </fieldset>

        <button type="submit" class="btn-block"><span>Guardar mis datos</span></button>
        <p id="pp-datos-msg" class="form-msg"></p>
      </form>
    `;

    document.getElementById('pp-contacto-add').addEventListener('click', () => addContactoRow());
    (perfil.contactos || []).forEach((c) => addContactoRow(c));

    document.getElementById('pp-hijo-add').addEventListener('click', () => addHijoRow());
    (perfil.hijos || []).forEach((h) => addHijoRow(h));

    // stamp:false -- es una foto de perfil, no debe quedar con fecha/hora
    // quemada como las de evidencia de entrega.
    fotoCamera = new CameraCapture({
      inputEl: document.getElementById('pp-foto-input'),
      previewEl: document.getElementById('pp-foto-preview'),
      stamp: false,
      filename: 'foto-perfil-publico.jpg',
    });

    document.getElementById('pp-fecha-nacimiento').addEventListener('change', (e) => {
      const err = validarFechaNacimiento(e.target.value);
      const msg = document.getElementById('pp-fecha-nacimiento-msg');
      msg.textContent = err || '';
      msg.className = err ? 'form-msg error' : 'form-msg';
    });

    document.getElementById('pp-datos-form').addEventListener('submit', onSubmitDatos);
  }

  async function onSubmitDatos(e) {
    e.preventDefault();
    const msg = document.getElementById('pp-datos-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const fechaNacimiento = document.getElementById('pp-fecha-nacimiento').value;
    const errorFecha = validarFechaNacimiento(fechaNacimiento);
    if (errorFecha) {
      document.getElementById('pp-fecha-nacimiento-msg').textContent = errorFecha;
      document.getElementById('pp-fecha-nacimiento-msg').className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';

    try {
      let fotoUrl = null;
      if (fotoCamera && fotoCamera.hasPhoto()) {
        fotoUrl = await DB.uploadFotoPublico(employeeId, fotoCamera.getFile());
      }

      const perfil = {
        fecha_nacimiento: fechaNacimiento,
        telefono: document.getElementById('pp-telefono').value.trim() || null,
        email_personal: document.getElementById('pp-email-personal').value.trim() || null,
      };
      TODOS_LOS_CAMPOS.forEach((c) => { perfil[c.id] = leerValorCampo(c); });

      const contactos = Array.from(document.querySelectorAll('#pp-contactos .linea-row'))
        .map((row) => ({
          nombre: row.querySelector('.contacto-nombre').value.trim(),
          parentesco: row.querySelector('.contacto-parentesco').value || null,
          telefono: row.querySelector('.contacto-telefono').value.trim() || null,
        }))
        .filter((c) => c.nombre);

      const hijos = Array.from(document.querySelectorAll('#pp-hijos .linea-row'))
        .map((row) => ({
          nombre: row.querySelector('.hijo-nombre').value.trim(),
          fecha_nacimiento: row.querySelector('.hijo-fecha-nacimiento').value || null,
          sexo: row.querySelector('.hijo-sexo').value || null,
        }))
        .filter((h) => h.nombre);

      await DB.guardarPerfilPublico(employeeId, cedulaVerificada, perfil, contactos, hijos, fotoUrl);
      msg.textContent = 'Datos guardados. ¡Gracias!';
      msg.className = 'form-msg success';

      // guardarPerfilPublico() siempre deja el perfil pendiente de nuevo
      // del lado del servidor (ver sql/perfil_publico.sql) -- se refleja
      // acá mismo sin tener que volver a pedir todo el perfil.
      const banner = document.getElementById('pp-estado-banner');
      if (banner) {
        banner.className = 'pp-banner pendiente';
        banner.textContent = 'Tu información está en revisión. Puedes volver a entrar por este mismo link para ver cuándo quede aprobada.';
      }
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  }

  document.getElementById('pp-gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pp-gate-msg');
    const cedula = document.getElementById('pp-cedula').value.trim();
    msg.textContent = '';
    msg.className = 'form-msg';
    if (!cedula) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const perfil = await DB.obtenerPerfilPublico(employeeId, cedula);
      cedulaVerificada = cedula;
      renderFormulario(perfil);
      gateCard.classList.add('hidden');
      formCard.classList.remove('hidden');
    } catch (err) {
      msg.textContent = 'No encontramos un registro con esa cédula para este link. Verifica e intenta de nuevo.';
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
