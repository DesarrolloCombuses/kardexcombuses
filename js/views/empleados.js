// Campos del perfil sociodemográfico (diagnóstico SG-SST). Centralizados
// acá para poder generar el formulario del modal y leer/guardar sus
// valores desde la misma lista, en vez de repetir cada campo tres veces.
const CAMPOS_SOCIODEMOGRAFICOS = [
  { id: 'tipo_identificacion', label: 'Tipo de identificación', type: 'select', options: ['CC', 'CE', 'TI', 'PA', 'Otro'] },
  { id: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date' },
  { id: 'sexo', label: 'Sexo', type: 'select', options: ['Masculino', 'Femenino', 'Otro'] },
  { id: 'estado_civil', label: 'Estado civil', type: 'select', options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Divorciado(a)', 'Viudo(a)'] },
  { id: 'grado_escolaridad', label: 'Grado de escolaridad', type: 'select', options: ['Primaria', 'Secundaria incompleta', 'Secundaria completa', 'Técnico', 'Tecnólogo', 'Universitario', 'Posgrado'] },
  { id: 'composicion_familiar', label: 'Composición familiar', type: 'text', placeholder: 'Ej: cónyuge y 2 hijos' },
  { id: 'personas_a_cargo', label: 'Personas a cargo', type: 'number' },
  { id: 'cabeza_familia', label: '¿Es cabeza de familia?', type: 'checkbox' },
  { id: 'estrato_socioeconomico', label: 'Estrato socioeconómico', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
  { id: 'lugar_residencia', label: 'Lugar de residencia (municipio)', type: 'text' },
  { id: 'direccion_residencia', label: 'Dirección de residencia', type: 'text' },
  { id: 'barrio', label: 'Barrio', type: 'text' },
  { id: 'tipo_vivienda', label: 'Tipo de vivienda', type: 'select', options: ['Propia urbana', 'En arriendo urbano', 'Familiar urbano', 'Propia rural', 'En arriendo rural', 'Familiar rural'] },
  { id: 'medio_desplazamiento', label: 'Medio de desplazamiento', type: 'select', options: ['A pie', 'Bicicleta', 'Moto propia', 'Vehículo propio', 'Transporte público', 'Transporte de la empresa', 'Otro'] },
  { id: 'raza', label: 'Grupo étnico', type: 'select', options: ['Negro(a), mulato(a), afrocolombiano(a)', 'Indígena', 'Raizal del archipiélago de San Andrés y Providencia', 'Rom (gitano)', 'Ninguna de las anteriores'] },
  { id: 'tipo_sangre', label: 'Tipo de sangre', type: 'select', options: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
  { id: 'turno_trabajo', label: 'Turno de trabajo', type: 'select', options: ['Diurno', 'Nocturno', 'Mixto'] },
  { id: 'tipo_vinculacion', label: 'Tipo de vinculación', type: 'text' },
  { id: 'fecha_ingreso', label: 'Fecha de ingreso', type: 'date' },
  { id: 'conduce', label: '¿Conduce para el desempeño de sus funciones?', type: 'checkbox' },
  { id: 'tipo_vehiculo_conduce', label: 'Tipo de vehículo que conduce', type: 'text' },
  { id: 'anios_experiencia_conduccion', label: 'Años de experiencia en conducción', type: 'number' },
  { id: 'talla_camisa', label: 'Talla de camisa', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] },
  { id: 'talla_pantalon', label: 'Talla de pantalón', type: 'select', options: ['28', '30', '32', '34', '36', '38', '40', '42', '44', '46'] },
  { id: 'talla_calzado', label: 'Talla de calzado', type: 'select', options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  { id: 'eps', label: 'EPS', type: 'datalist', options: EPS_COLOMBIA },
  { id: 'arl', label: 'ARL', type: 'datalist', options: ARL_COLOMBIA },
  { id: 'fondo_pension', label: 'Fondo de pensión', type: 'datalist', options: FONDOS_PENSION_COLOMBIA },
  { id: 'caja_compensacion', label: 'Caja de compensación', type: 'datalist', options: CAJAS_COMPENSACION_COLOMBIA },
  { id: 'observaciones', label: 'Observaciones', type: 'textarea' },
];

function valorCampoDetalle(campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (campo.type === 'checkbox') return valor ? 'Sí' : 'No';
  if (campo.type === 'date') return formatFecha(valor);
  return valor;
}

// Rutas cuyos conductores también deben quedar registrados en Sonar
// Telematics -- mantener sincronizada con RUTA_A_CUENTA en
// supabase/functions/sonar-insert-driver/index.ts (Combuses tiene más de
// una cuenta/flota en Sonar, así que cada ruta nueva se agrega en los dos
// lados: acá solo decide si se ofrece el envío, la Edge Function decide con
// qué cuenta se envía).
const RUTAS_SONAR = ['700', '2', '41'];

// La ruta puede quedar escrita como "700", "Ruta 700" o "R700" según quién
// la digite -- se compara solo por los dígitos para no depender del formato.
function esRutaSonar(ruta) {
  return RUTAS_SONAR.includes(String(ruta || '').replace(/\D/g, ''));
}

function esConductorRutaSonar(empleado) {
  return /conductor/i.test(empleado?.cargo || '') && esRutaSonar(empleado?.ruta);
}

function formatFecha(iso) {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('es-CO') : '—';
}

function formatSalario(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

// Antigüedad y edad son datos que se leen de un vistazo (no hay que ir
// campo por campo a calcularlos a mano), por eso se destacan aparte en el
// detalle en vez de quedar mezclados en la grilla con todo lo demás.
function antiguedadTexto(fechaIngresoISO) {
  if (!fechaIngresoISO) return '—';
  const ingreso = new Date(`${fechaIngresoISO}T00:00:00`);
  const hoy = new Date();
  let meses = (hoy.getFullYear() - ingreso.getFullYear()) * 12 + (hoy.getMonth() - ingreso.getMonth());
  if (hoy.getDate() < ingreso.getDate()) meses--;
  meses = Math.max(0, meses);
  if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(meses / 12);
  return `${anios} ${anios === 1 ? 'año' : 'años'}`;
}

function edadTexto(fechaNacimientoISO) {
  if (!fechaNacimientoISO) return '—';
  const nacimiento = new Date(`${fechaNacimientoISO}T00:00:00`);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const sinCumplirAun = hoy.getMonth() < nacimiento.getMonth()
    || (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (sinCumplirAun) edad--;
  return `${edad} años`;
}

function campoSociodemograficoHtml(campo, valor) {
  const id = `socio-${campo.id}`;
  if (campo.type === 'select') {
    const opciones = ['<option value="">—</option>']
      .concat(campo.options.map((o) => `<option value="${o}" ${valor === o ? 'selected' : ''}>${o}</option>`))
      .join('');
    return `<label>${campo.label}<select id="${id}">${opciones}</select></label>`;
  }
  if (campo.type === 'datalist') {
    const opciones = campo.options.map((o) => `<option value="${o}"></option>`).join('');
    return `<label>${campo.label}<input type="text" id="${id}" list="${id}-list" value="${valor || ''}" autocomplete="off" /><datalist id="${id}-list">${opciones}</datalist></label>`;
  }
  if (campo.type === 'checkbox') {
    return `<label class="checkbox-label"><input type="checkbox" id="${id}" ${valor ? 'checked' : ''} /> ${campo.label}</label>`;
  }
  if (campo.type === 'textarea') {
    return `<label style="grid-column:1/-1">${campo.label}<textarea id="${id}" rows="2">${valor || ''}</textarea></label>`;
  }
  return `<label>${campo.label}<input type="${campo.type}" id="${id}" value="${valor || ''}" ${campo.placeholder ? `placeholder="${campo.placeholder}"` : ''} /></label>`;
}

Router.register('empleados', {
  title: 'Empleados',
  async onEnter() {
    if (!this._bound) {
      ['empleados-search', 'empleados-filtro-fecha-desde', 'empleados-filtro-fecha-hasta'].forEach((id) => {
        document.getElementById(id).addEventListener('input', () => this._render());
      });
      ['empleados-estado', 'empleados-filtro-cargo', 'empleados-filtro-area', 'empleados-filtro-perfil'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('empleados-nuevo-btn').addEventListener('click', () => this._abrirModal(null));
      document.getElementById('empleados-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const employees = await DB.getEmployeesConPerfil({ onlyActive: false });
    this._employees = employees;

    const activos = employees.filter((e) => e.activo);
    const completos = activos.filter((e) => e.perfil_sociodemografico).length;
    document.getElementById('empleados-stat-total').textContent = activos.length;
    document.getElementById('empleados-stat-completos').textContent = completos;
    document.getElementById('empleados-stat-pendientes').textContent = activos.length - completos;

    this._llenarFiltros(employees);
    this._render();
  },

  // Cargo/Área se llenan con los valores que realmente existen en los
  // datos (no una lista fija) -- así el filtro nunca queda desactualizado
  // ni ofrece opciones que no tienen a nadie detrás. Se preserva la
  // selección previa si sigue existiendo, para no perder el filtro activo
  // cada vez que se recarga la lista (ej. después de guardar un empleado).
  _llenarFiltros(employees) {
    const llenarSelect = (id, valores) => {
      const sel = document.getElementById(id);
      const actual = sel.value;
      const opciones = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
      if (opciones.includes(actual)) sel.value = actual;
    };
    llenarSelect('empleados-filtro-cargo', employees.map((e) => e.cargo));
    llenarSelect('empleados-filtro-area', employees.map((e) => e.area));
  },

  _limpiarFiltros() {
    document.getElementById('empleados-search').value = '';
    document.getElementById('empleados-estado').value = 'activos';
    document.getElementById('empleados-filtro-cargo').value = '';
    document.getElementById('empleados-filtro-area').value = '';
    document.getElementById('empleados-filtro-perfil').value = '';
    document.getElementById('empleados-filtro-fecha-desde').value = '';
    document.getElementById('empleados-filtro-fecha-hasta').value = '';
    this._render();
  },

  _iniciales(nombre) {
    const partes = nombre.trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
  },

  // El bucket "fotos-empleados" es privado, así que hay que resolver un
  // signed URL para poder mostrar la foto -- se cachea por path (no por
  // empleado) para no repetir la llamada si la misma foto aparece varias
  // veces (ej. en la lista y luego en el detalle).
  async _resolverFoto(fotoUrl) {
    if (!fotoUrl) return null;
    this._fotoCache = this._fotoCache || new Map();
    if (this._fotoCache.has(fotoUrl)) return this._fotoCache.get(fotoUrl);
    try {
      const url = await DB.getSignedUrl('fotos-empleados', fotoUrl);
      this._fotoCache.set(fotoUrl, url);
      return url;
    } catch {
      return null;
    }
  },

  // Pinta la foto sobre el círculo de iniciales una vez que el signed URL
  // resuelve (async) -- se renderiza primero con iniciales para que la
  // lista no quede esperando la red, y la foto aparece encima cuando llega.
  _pintarFoto(el, url) {
    if (!el || !url) return;
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  },

  _render() {
    const q = document.getElementById('empleados-search').value.trim().toLowerCase();
    const estado = document.getElementById('empleados-estado').value;
    const cargo = document.getElementById('empleados-filtro-cargo').value;
    const area = document.getElementById('empleados-filtro-area').value;
    const perfilFiltro = document.getElementById('empleados-filtro-perfil').value;
    const fechaDesde = document.getElementById('empleados-filtro-fecha-desde').value;
    const fechaHasta = document.getElementById('empleados-filtro-fecha-hasta').value;

    let filtrados = this._employees;
    if (estado === 'activos') filtrados = filtrados.filter((e) => e.activo);
    else if (estado === 'inactivos') filtrados = filtrados.filter((e) => !e.activo);
    if (cargo) filtrados = filtrados.filter((e) => e.cargo === cargo);
    if (area) filtrados = filtrados.filter((e) => e.area === area);
    if (perfilFiltro === 'completo') filtrados = filtrados.filter((e) => e.perfil_sociodemografico);
    else if (perfilFiltro === 'pendiente') filtrados = filtrados.filter((e) => !e.perfil_sociodemografico);
    if (fechaDesde) filtrados = filtrados.filter((e) => e.perfil_sociodemografico?.fecha_ingreso && e.perfil_sociodemografico.fecha_ingreso >= fechaDesde);
    if (fechaHasta) filtrados = filtrados.filter((e) => e.perfil_sociodemografico?.fecha_ingreso && e.perfil_sociodemografico.fecha_ingreso <= fechaHasta);
    if (q) filtrados = filtrados.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q));

    const total = this._employees.length;
    document.getElementById('empleados-contador').textContent =
      filtrados.length === total ? `${total} empleado(s)` : `Mostrando ${filtrados.length} de ${total} empleado(s)`;

    const lista = document.getElementById('empleados-lista');
    if (filtrados.length === 0) {
      lista.innerHTML = '<p class="empty-note">Sin resultados con estos filtros.</p>';
      return;
    }
    lista.innerHTML = filtrados.map((e) => {
      const completo = !!e.perfil_sociodemografico;
      return `
        <div class="person-row ${e.activo ? '' : 'inactivo'}">
          <span class="person-avatar" data-avatar-id="${e.id}">${this._iniciales(e.nombre)}</span>
          <div class="person-info">
            <div class="person-name">${e.nombre}${e.activo ? '' : ' <span class="person-inactive-flag">Inactivo</span>'}</div>
            <div class="person-meta"><span>CC ${e.cedula}</span><span>${e.cargo || 'Sin cargo'}</span></div>
          </div>
          <span class="tag ${completo ? 'completo' : 'pendiente'}">${completo ? 'Completo' : 'Pendiente'}</span>
          <button type="button" class="btn-secondary" data-editar="${e.id}">${completo ? 'Ver perfil' : 'Completar perfil'}</button>
        </div>
      `;
    }).join('');

    lista.querySelectorAll('[data-editar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = this._employees.find((x) => x.id === btn.dataset.editar);
        if (!emp) return;
        // Siempre se muestra primero en solo lectura (menos riesgo de
        // modificar algo sin querer), tenga o no perfil sociodemográfico
        // completo -- antes, sin perfil, se saltaba directo al formulario de
        // edición y con eso se perdían datos que sí existen aunque el
        // perfil esté pendiente (activo/inactivo, vehículo asignado, etc.).
        this._verDetalle(emp);
      });
    });

    filtrados.filter((e) => e.foto_url).forEach((e) => {
      this._resolverFoto(e.foto_url).then((url) => {
        this._pintarFoto(lista.querySelector(`[data-avatar-id="${e.id}"]`), url);
      });
    });
  },

  _campoDetalle(campo, valor, claseExtra) {
    return `
      <div class="detalle-field ${claseExtra || ''}">
        <div class="detalle-field-label">${campo.label}</div>
        <div class="detalle-field-value">${valorCampoDetalle(campo, valor)}</div>
      </div>
    `;
  },

  _contactoDetalleHtml(c) {
    const sub = [c.parentesco, c.telefono].filter(Boolean).join(' · ') || '—';
    return `<div class="detalle-list-item"><span class="detalle-list-item-main">${c.nombre}</span><span class="detalle-list-item-sub">${sub}</span></div>`;
  },

  _hijoDetalleHtml(h) {
    const partes = [];
    if (h.fecha_nacimiento) partes.push(`${formatFecha(h.fecha_nacimiento)} (${edadTexto(h.fecha_nacimiento)})`);
    if (h.sexo) partes.push(h.sexo);
    return `<div class="detalle-list-item"><span class="detalle-list-item-main">${h.nombre}</span><span class="detalle-list-item-sub">${partes.join(' · ') || '—'}</span></div>`;
  },

  _verDetalle(empleado) {
    const perfil = empleado.perfil_sociodemografico || {};

    // Fecha de ingreso, antigüedad y edad se destacan arriba de todo -- son
    // los datos que primero se buscan al abrir la ficha de alguien. El resto
    // de campos va abajo en una grilla, sin repetir fecha_nacimiento ni
    // fecha_ingreso (ya están en los destacados).
    const camposGrid = CAMPOS_SOCIODEMOGRAFICOS.filter((c) => !['fecha_nacimiento', 'fecha_ingreso', 'observaciones'].includes(c.id));
    const gridHtml = camposGrid.map((c) => this._campoDetalle(c, perfil[c.id])).join('');
    const campoObservaciones = CAMPOS_SOCIODEMOGRAFICOS.find((c) => c.id === 'observaciones');
    const observacionesHtml = perfil.observaciones ? this._campoDetalle(campoObservaciones, perfil.observaciones, 'detalle-field-full') : '';

    // Vehículo/ruta viven en "employees" (se usan también en Entrega e
    // Historial), no en perfil_sociodemografico -- pero para quien ve la
    // ficha son parte de la misma información completa del conductor, así
    // que se muestran acá igual que un dato destacado más.
    const tieneVehiculo = empleado.numero_interno || empleado.ruta || empleado.base;
    const vehiculoHtml = tieneVehiculo ? `
      <div class="detalle-field-label" style="margin:0 0 0.5rem">Vehículo asignado</div>
      <div class="detalle-facts" style="margin-bottom:1.4rem">
        <div class="detalle-fact">
          <div class="detalle-fact-value">${empleado.numero_interno || '—'}</div>
          <div class="detalle-fact-label">Vehículo interno</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${empleado.ruta || '—'}</div>
          <div class="detalle-fact-label">Ruta</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${empleado.base || '—'}</div>
          <div class="detalle-fact-label">Base</div>
        </div>
      </div>
    ` : '';

    const sonarHtml = this._sonarBloqueHtml(empleado);

    const contactos = empleado.contactos_emergencia || [];
    const contactosHtml = contactos.length ? `
      <div class="modal-section">
        <h3 class="modal-section-title">Contactos de emergencia</h3>
        <div class="detalle-list">${contactos.map((c) => this._contactoDetalleHtml(c)).join('')}</div>
      </div>
    ` : '';

    const hijos = empleado.hijos_empleado || [];
    const hijosHtml = hijos.length ? `
      <div class="modal-section">
        <h3 class="modal-section-title">Hijos</h3>
        <div class="detalle-list">${hijos.map((h) => this._hijoDetalleHtml(h)).join('')}</div>
      </div>
    ` : '';

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <button type="button" class="detalle-avatar-btn" id="empleado-detalle-avatar-btn" aria-label="Ver foto de perfil en grande">
          <span class="person-avatar detalle-avatar" id="empleado-detalle-avatar">${this._iniciales(empleado.nombre)}</span>
        </button>
        <div class="detalle-header-info">
          <div class="detalle-nombre">${empleado.nombre}</div>
          <div class="detalle-sub">CC ${empleado.cedula}${empleado.cargo ? ' · ' + empleado.cargo : ''}${empleado.area ? ' · ' + empleado.area : ''}${empleado.telefono ? ' · ' + empleado.telefono : ''}${empleado.email_personal ? ' · ' + empleado.email_personal : ''}</div>
        </div>
        <div class="detalle-tags">
          <span class="tag ${empleado.activo ? 'activo' : 'inactivo-tag'}">${empleado.activo ? 'Activo' : 'Inactivo'}</span>
          <span class="tag ${empleado.perfil_sociodemografico ? 'completo' : 'pendiente'}">${empleado.perfil_sociodemografico ? 'Perfil completo' : 'Perfil pendiente'}</span>
        </div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact">
          <div class="detalle-fact-value">${formatFecha(perfil.fecha_ingreso)}</div>
          <div class="detalle-fact-label">Fecha de ingreso</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${antiguedadTexto(perfil.fecha_ingreso)}</div>
          <div class="detalle-fact-label">Antigüedad</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${edadTexto(perfil.fecha_nacimiento)}</div>
          <div class="detalle-fact-label">Edad</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${formatSalario(empleado.salario)}</div>
          <div class="detalle-fact-label">Salario</div>
        </div>
        ${!empleado.activo ? `
        <div class="detalle-fact">
          <div class="detalle-fact-value">${formatFecha(empleado.fecha_salida)}</div>
          <div class="detalle-fact-label">Fecha de salida</div>
        </div>
        ` : ''}
        ${!empleado.activo && empleado.motivo_renuncia ? `
        <div class="detalle-fact">
          <div class="detalle-fact-value">${empleado.motivo_renuncia}</div>
          <div class="detalle-fact-label">Motivo de salida</div>
        </div>
        ` : ''}
      </div>

      ${this._estadoBloqueHtml(empleado)}

      ${empleado.perfil_aprobado_at ? `
      <p class="view-intro" style="margin:0 0 1.2rem">Perfil aprobado el ${new Date(empleado.perfil_aprobado_at).toLocaleString('es-CO')}${empleado.perfil_aprobado_por ? ' por ' + empleado.perfil_aprobado_por : ''}.</p>
      ` : ''}

      ${vehiculoHtml}
      ${sonarHtml}

      <div class="modal-section">
        <h3 class="modal-section-title">Perfil sociodemográfico</h3>
        <div class="detalle-grid">${gridHtml}${observacionesHtml}</div>
      </div>

      ${contactosHtml}
      ${hijosHtml}

      <button type="button" id="empleado-detalle-editar" style="margin-top:1.2rem">Editar</button>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('empleado-detalle-editar').addEventListener('click', () => this._abrirModal(empleado));

    const sonarBtn = document.getElementById('empleado-sonar-btn');
    if (sonarBtn) sonarBtn.addEventListener('click', () => this._reenviarSonar(empleado));

    const inactivarBtn = document.getElementById('empleado-inactivar-btn');
    if (inactivarBtn) {
      inactivarBtn.addEventListener('click', () => {
        inactivarBtn.classList.add('hidden');
        document.getElementById('empleado-inactivar-form').classList.remove('hidden');
      });
      document.getElementById('empleado-inactivar-cancelar').addEventListener('click', () => {
        document.getElementById('empleado-inactivar-form').classList.add('hidden');
        inactivarBtn.classList.remove('hidden');
      });
      document.getElementById('empleado-inactivar-confirmar').addEventListener('click', () => {
        const fechaSalida = document.getElementById('empleado-inactivar-fecha').value || null;
        const motivo = document.getElementById('empleado-inactivar-motivo').value.trim() || null;
        this._cambiarEstado(empleado, false, fechaSalida, motivo);
      });
    }
    const activarBtn = document.getElementById('empleado-activar-btn');
    if (activarBtn) {
      activarBtn.addEventListener('click', () => {
        if (!confirm(`¿Marcar a ${empleado.nombre} como activo de nuevo?`)) return;
        this._cambiarEstado(empleado, true, null, null);
      });
    }

    if (empleado.foto_url) {
      this._resolverFoto(empleado.foto_url).then((url) => {
        this._pintarFoto(document.getElementById('empleado-detalle-avatar'), url);
        if (!url) return;
        // La foto en el círculo de arriba queda chica a propósito (es un
        // avatar, no un visor) -- clic para verla de verdad, en una pestaña
        // nueva con su tamaño real en vez de un lightbox que complique el
        // modal que ya está abierto.
        const btn = document.getElementById('empleado-detalle-avatar-btn');
        btn.classList.add('clickeable');
        btn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      });
    }
  },

  // Cambiar activo/inactivo directo desde el detalle -- antes solo se podía
  // tocando "Editar" y guardando todo el formulario. Al inactivar se pide la
  // fecha de salida ahí mismo (con el día de hoy como valor por defecto,
  // editable) para que quede registrada desde el primer momento en vez de
  // depender de que alguien la agregue después a mano.
  _estadoBloqueHtml(empleado) {
    const hoy = new Date().toISOString().slice(0, 10);
    if (empleado.activo) {
      return `
        <div style="margin-bottom:1.2rem">
          <button type="button" id="empleado-inactivar-btn" class="btn-secondary">Marcar como inactivo</button>
          <div id="empleado-inactivar-form" class="form hidden" style="max-width:260px;margin-top:0.7rem">
            <label>Fecha de salida<input type="date" id="empleado-inactivar-fecha" value="${hoy}" /></label>
            <label>Motivo de salida<input type="text" id="empleado-inactivar-motivo" placeholder="Ej: renuncia voluntaria" /></label>
            <div style="display:flex;gap:0.5rem">
              <button type="button" id="empleado-inactivar-confirmar">Confirmar</button>
              <button type="button" id="empleado-inactivar-cancelar" class="btn-secondary">Cancelar</button>
            </div>
          </div>
          <p id="empleado-estado-msg" class="form-msg"></p>
        </div>
      `;
    }
    return `
      <div style="margin-bottom:1.2rem">
        <button type="button" id="empleado-activar-btn" class="btn-secondary">Marcar como activo</button>
        <p id="empleado-estado-msg" class="form-msg"></p>
      </div>
    `;
  },

  async _cambiarEstado(empleado, activo, fechaSalida, motivoRenuncia) {
    const msg = document.getElementById('empleado-estado-msg');
    msg.textContent = 'Guardando…';
    msg.className = 'form-msg';
    try {
      await DB.updateEmployee(empleado.id, { activo, fecha_salida: fechaSalida, motivo_renuncia: motivoRenuncia });
      await this._load();
      const actualizado = this._employees.find((e) => e.id === empleado.id);
      if (actualizado) this._verDetalle(actualizado);
    } catch (err) {
      msg.textContent = 'No se pudo actualizar: ' + err.message;
      msg.className = 'form-msg error';
    }
  },

  // Los conductores de ciertas rutas (RUTAS_SONAR) deben existir también en
  // Sonar Telematics (plataforma externa de rastreo GPS de los vehículos).
  // Este bloque solo aparece para ellos; el resto de empleados no lo ve.
  _sonarBloqueHtml(empleado) {
    if (!esConductorRutaSonar(empleado)) return '';
    let badge;
    if (empleado.sonar_synced_at) {
      badge = `<span class="tag completo">Sincronizado el ${new Date(empleado.sonar_synced_at).toLocaleString('es-CO')}</span>`;
    } else if (empleado.sonar_sync_error) {
      badge = `<span class="tag descartado">Error: ${empleado.sonar_sync_error}</span>`;
    } else {
      badge = `<span class="tag pendiente">Sin enviar a Sonar</span>`;
    }
    return `
      <div class="modal-section">
        <h3 class="modal-section-title">Sonar Telematics</h3>
        <p class="view-intro" style="margin:0 0 0.6rem">Este conductor pertenece a una ruta (${empleado.ruta || ''}) que también debe quedar registrada en Sonar Telematics.</p>
        <div id="empleado-sonar-badge" style="margin-bottom:0.6rem">${badge}</div>
        <button type="button" id="empleado-sonar-btn" class="btn-secondary">${empleado.sonar_synced_at ? 'Reenviar a Sonar' : 'Enviar a Sonar'}</button>
        <p id="empleado-sonar-msg" class="form-msg"></p>
      </div>
    `;
  },

  async _enviarASonar(employeeId, msgEl) {
    msgEl.textContent = 'Conectando con Sonar…';
    msgEl.className = 'form-msg';
    try {
      const res = await DB.enviarConductorASonar(employeeId);
      msgEl.textContent = res.ok ? '✓ Conectado con Sonar: el conductor quedó creado.' : `No se pudo conectar con Sonar: ${res.message}`;
      msgEl.className = res.ok ? 'form-msg success' : 'form-msg error';
      return res;
    } catch (err) {
      msgEl.textContent = 'No se pudo conectar con Sonar: ' + err.message;
      msgEl.className = 'form-msg error';
      return null;
    }
  },

  async _reenviarSonar(empleado) {
    const res = await this._enviarASonar(empleado.id, document.getElementById('empleado-sonar-msg'));
    if (!res) return;
    const badgeWrap = document.getElementById('empleado-sonar-badge');
    const btn = document.getElementById('empleado-sonar-btn');
    if (res.ok) {
      empleado.sonar_synced_at = new Date().toISOString();
      empleado.sonar_sync_error = null;
      if (badgeWrap) badgeWrap.innerHTML = `<span class="tag completo">Sincronizado el ${new Date(empleado.sonar_synced_at).toLocaleString('es-CO')}</span>`;
      if (btn) btn.textContent = 'Reenviar a Sonar';
    } else {
      empleado.sonar_sync_error = res.message;
      if (badgeWrap) badgeWrap.innerHTML = `<span class="tag descartado">Error: ${res.message}</span>`;
    }
  },

  // Contactos de emergencia e hijos son listas de largo variable (0, 1 o
  // varios), así que se editan como filas que se agregan/quitan libremente
  // -- mismo patrón "línea dinámica" que ya usa Entrega para las prendas
  // (.linea-row-wrap / .linea-row / .linea-remove), reutilizado tal cual
  // para no inventar un segundo lenguaje visual para lo mismo.
  _addContactoRow(contacto) {
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
    document.getElementById('empleado-contactos').appendChild(wrap);
    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  },

  _addHijoRow(hijo) {
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
    document.getElementById('empleado-hijos').appendChild(wrap);
    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  },

  async _abrirModal(empleado) {
    const perfil = empleado?.perfil_sociodemografico || {};
    const camposHtml = CAMPOS_SOCIODEMOGRAFICOS.map((c) => campoSociodemograficoHtml(c, perfil[c.id])).join('');

    document.getElementById('modal-body').innerHTML = `
      <div class="modal-header">
        <span class="modal-header-fecha">${empleado ? `${empleado.nombre} · CC ${empleado.cedula}` : 'Nuevo empleado'}</span>
      </div>
      <form id="empleado-form" class="form form-wide">
        <fieldset>
          <legend>Datos básicos</legend>
          <div class="foto-picker-row">
            <span class="person-avatar foto-picker-avatar" id="empleado-foto-fallback">${empleado?.nombre ? this._iniciales(empleado.nombre) : '?'}</span>
            <img id="empleado-foto-preview" class="foto-picker-preview hidden" alt="" />
            <div class="foto-picker-actions">
              <label class="file-picker" for="empleado-foto-input">
                <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
                <span id="empleado-foto-label">${empleado?.foto_url ? 'Cambiar foto' : 'Agregar foto'}</span>
              </label>
              <input type="file" id="empleado-foto-input" accept="image/*" capture="environment" class="hidden" />
              <button type="button" id="empleado-foto-quitar" class="btn-secondary ${empleado?.foto_url ? '' : 'hidden'}">Quitar foto</button>
            </div>
          </div>
          <div class="fieldset-grid">
            <label>Nombre completo<input type="text" id="empleado-nombre" value="${empleado?.nombre || ''}" required /></label>
            <label>Cédula<input type="text" id="empleado-cedula" value="${empleado?.cedula || ''}" required /></label>
            <label>Cargo<input type="text" id="empleado-cargo" value="${empleado?.cargo || ''}" /></label>
            <label>Área<input type="text" id="empleado-area" value="${empleado?.area || ''}" /></label>
            <label>Teléfono<input type="tel" id="empleado-telefono" value="${empleado?.telefono || ''}" /></label>
            <label>Correo personal<input type="email" id="empleado-email-personal" value="${empleado?.email_personal || ''}" /></label>
            <label>Salario<input type="number" id="empleado-salario" value="${empleado?.salario ?? ''}" min="0" step="1000" placeholder="Ej: 1300000" /></label>
            <label>Fecha de salida<input type="date" id="empleado-fecha-salida" value="${empleado?.fecha_salida || ''}" /></label>
            <label>Motivo de salida<input type="text" id="empleado-motivo-renuncia" value="${empleado?.motivo_renuncia || ''}" /></label>
          </div>
          <label class="checkbox-label"><input type="checkbox" id="empleado-activo" ${!empleado || empleado.activo ? 'checked' : ''} /> Empleado activo</label>
        </fieldset>
        <fieldset>
          <legend>Vehículo asignado (conductores)</legend>
          <p class="view-intro" style="margin:0">Solo aplica a conductores. Se usa en la Entrega para confirmar que se entrega al conductor correcto.</p>
          <div class="fieldset-grid">
            <label><span>Número interno de vehículo <span class="req-star hidden" id="req-numero-interno">*</span></span><input type="text" id="empleado-numero-interno" value="${empleado?.numero_interno || ''}" /></label>
            <label><span>Ruta <span class="req-star hidden" id="req-ruta">*</span></span><input type="text" id="empleado-ruta" value="${empleado?.ruta || ''}" /></label>
            <label>Base<input type="text" id="empleado-base" value="${empleado?.base || ''}" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Perfil sociodemográfico</legend>
          <p class="view-intro" style="margin:0">Para el diagnóstico del SG-SST. Es opcional — puedes guardar el empleado y completarlo después.</p>
          <div class="fieldset-grid">${camposHtml}</div>
        </fieldset>
        <fieldset>
          <legend>Contactos de emergencia</legend>
          <p class="view-intro" style="margin:0">Opcional. Se puede agregar más de uno.</p>
          <div id="empleado-contactos"></div>
          <button type="button" id="empleado-contacto-add" class="btn-secondary">+ Agregar contacto</button>
        </fieldset>
        <fieldset>
          <legend>Hijos</legend>
          <p class="view-intro" style="margin:0">Opcional. Se puede agregar más de uno.</p>
          <div id="empleado-hijos"></div>
          <button type="button" id="empleado-hijo-add" class="btn-secondary">+ Agregar hijo/a</button>
        </fieldset>
        <div>
          <button type="submit">Guardar</button>
          <p id="empleado-msg" class="form-msg"></p>
        </div>
      </form>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('empleado-cargo').addEventListener('input', () => this._actualizarRequeridoVehiculo());
    this._actualizarRequeridoVehiculo();

    document.getElementById('empleado-contacto-add').addEventListener('click', () => this._addContactoRow());
    document.getElementById('empleado-hijo-add').addEventListener('click', () => this._addHijoRow());
    (empleado?.contactos_emergencia || []).forEach((c) => this._addContactoRow(c));
    (empleado?.hijos_empleado || []).forEach((h) => this._addHijoRow(h));

    // stamp:false -- a diferencia de la foto de Entrega, esta es la foto de
    // perfil/carné del empleado, no debe quedar con fecha/hora quemada.
    this._fotoUrlOriginal = empleado?.foto_url || null;
    this._empleadoSonarSyncedAt = empleado?.sonar_synced_at || null;
    this._fotoQuitada = false;
    this._fotoCamera = new CameraCapture({
      inputEl: document.getElementById('empleado-foto-input'),
      previewEl: document.getElementById('empleado-foto-preview'),
      stamp: false,
      filename: 'foto-empleado.jpg',
    });
    document.getElementById('empleado-foto-input').addEventListener('change', () => {
      this._fotoQuitada = false;
      document.getElementById('empleado-foto-fallback').classList.add('hidden');
      document.getElementById('empleado-foto-label').textContent = 'Cambiar foto';
      document.getElementById('empleado-foto-quitar').classList.remove('hidden');
    });
    document.getElementById('empleado-foto-quitar').addEventListener('click', () => {
      this._fotoCamera.reset();
      this._fotoQuitada = true;
      document.getElementById('empleado-foto-fallback').classList.remove('hidden');
      document.getElementById('empleado-foto-label').textContent = 'Agregar foto';
      document.getElementById('empleado-foto-quitar').classList.add('hidden');
    });
    if (this._fotoUrlOriginal) {
      this._resolverFoto(this._fotoUrlOriginal).then((url) => {
        if (!url) return;
        const img = document.getElementById('empleado-foto-preview');
        if (!img) return; // el modal pudo haberse cerrado/reemplazado ya
        img.src = url;
        img.classList.remove('hidden');
        document.getElementById('empleado-foto-fallback').classList.add('hidden');
      });
    }

    document.getElementById('empleado-form').addEventListener('submit', (e) => this._guardar(e, empleado ? empleado.id : null));
  },

  // Número interno de vehículo y Ruta son obligatorios para conductores
  // (Cargo con "conductor"): se marca con un asterisco en vivo mientras se
  // escribe el cargo, y se valida de nuevo al guardar por si el campo Cargo
  // no llegó a perder el foco.
  _actualizarRequeridoVehiculo() {
    const esConductor = /conductor/i.test(document.getElementById('empleado-cargo').value);
    document.getElementById('req-numero-interno').classList.toggle('hidden', !esConductor);
    document.getElementById('req-ruta').classList.toggle('hidden', !esConductor);
  },

  async _guardar(e, employeeId) {
    e.preventDefault();
    const msg = document.getElementById('empleado-msg');
    msg.textContent = 'Guardando…';
    msg.className = 'form-msg';

    const nombre = document.getElementById('empleado-nombre').value.trim();
    const cedula = document.getElementById('empleado-cedula').value.trim();
    if (!nombre || !cedula) {
      msg.textContent = 'Nombre y cédula son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }
    const basico = {
      nombre,
      cedula,
      cargo: document.getElementById('empleado-cargo').value.trim() || null,
      area: document.getElementById('empleado-area').value.trim() || null,
      telefono: document.getElementById('empleado-telefono').value.trim() || null,
      email_personal: document.getElementById('empleado-email-personal').value.trim() || null,
      salario: document.getElementById('empleado-salario').value ? Number(document.getElementById('empleado-salario').value) : null,
      fecha_salida: document.getElementById('empleado-fecha-salida').value || null,
      motivo_renuncia: document.getElementById('empleado-motivo-renuncia').value.trim() || null,
      activo: document.getElementById('empleado-activo').checked,
      numero_interno: document.getElementById('empleado-numero-interno').value.trim() || null,
      ruta: document.getElementById('empleado-ruta').value.trim() || null,
      base: document.getElementById('empleado-base').value.trim() || null,
    };

    const numInternoEl = document.getElementById('empleado-numero-interno');
    const rutaEl = document.getElementById('empleado-ruta');
    const esConductor = /conductor/i.test(basico.cargo || '');
    numInternoEl.classList.remove('input-error');
    rutaEl.classList.remove('input-error');
    if (esConductor && (!basico.numero_interno || !basico.ruta)) {
      msg.textContent = 'Para el cargo Conductor, Número interno de vehículo y Ruta son obligatorios.';
      msg.className = 'form-msg error';
      if (!basico.numero_interno) numInternoEl.classList.add('input-error');
      if (!basico.ruta) rutaEl.classList.add('input-error');
      return;
    }

    // La foto es opcional: si no se tocó nada, se conserva la que ya tenía
    // (this._fotoUrlOriginal); si se marcó "Quitar foto" queda en null; si
    // se capturó una nueva, se sube al bucket y se guarda su path.
    if (this._fotoQuitada) {
      basico.foto_url = null;
    } else if (this._fotoCamera.hasPhoto()) {
      msg.textContent = 'Subiendo foto…';
      try {
        const file = this._fotoCamera.getFile();
        const ext = file.name.split('.').pop() || 'jpg';
        basico.foto_url = await DB.uploadToBucket('fotos-empleados', file, ext);
      } catch (err) {
        msg.textContent = 'No se pudo subir la foto: ' + err.message;
        msg.className = 'form-msg error';
        return;
      }
      msg.textContent = 'Guardando…';
    } else {
      basico.foto_url = this._fotoUrlOriginal;
    }

    // Filas vacías (nadie escribió nombre) se descartan en vez de guardarse
    // como un contacto/hijo en blanco -- pasa seguido si alguien le da
    // "+ Agregar" y se arrepiente sin usar "Quitar".
    const contactos = Array.from(document.querySelectorAll('#empleado-contactos .linea-row')).map((row) => ({
      nombre: row.querySelector('.contacto-nombre').value.trim(),
      parentesco: row.querySelector('.contacto-parentesco').value || null,
      telefono: row.querySelector('.contacto-telefono').value.trim() || null,
    })).filter((c) => c.nombre);

    const hijos = Array.from(document.querySelectorAll('#empleado-hijos .linea-row')).map((row) => ({
      nombre: row.querySelector('.hijo-nombre').value.trim(),
      fecha_nacimiento: row.querySelector('.hijo-fecha-nacimiento').value || null,
      sexo: row.querySelector('.hijo-sexo').value || null,
    })).filter((h) => h.nombre);

    const perfil = {};
    let perfilTieneDatos = false;
    CAMPOS_SOCIODEMOGRAFICOS.forEach((c) => {
      const el = document.getElementById(`socio-${c.id}`);
      let valor;
      if (c.type === 'checkbox') {
        valor = el.checked;
        if (valor) perfilTieneDatos = true;
      } else if (c.type === 'number') {
        valor = el.value ? parseInt(el.value, 10) : null;
        if (valor !== null) perfilTieneDatos = true;
      } else {
        valor = el.value.trim() || null;
        if (valor !== null) perfilTieneDatos = true;
      }
      perfil[c.id] = valor;
    });

    try {
      let id = employeeId;
      if (id) {
        await DB.updateEmployee(id, basico);
      } else {
        const nuevo = await DB.createEmployee(basico);
        id = nuevo.id;
      }
      // Al crear, solo se guarda el perfil si se alcanzó a llenar algo (para
      // no dejar una fila vacía marcada como "Completo"). Al editar, siempre
      // se guarda -- si el usuario borró todos los campos a propósito, debe
      // quedar reflejado.
      if (perfilTieneDatos || employeeId) {
        await DB.savePerfilSociodemografico(id, perfil);
      }
      await DB.saveContactosEmergencia(id, contactos);
      await DB.saveHijosEmpleado(id, hijos);

      // Primera vez que este conductor queda con cargo Conductor + una ruta
      // de RUTAS_SONAR: se envía a Sonar automáticamente, sin pedir
      // confirmación -- el mensaje deja explícito que se conectó con Sonar
      // para que quede claro que sí pasó. Ediciones posteriores no vuelven
      // a enviarse solas -- para eso queda el botón "Reenviar a Sonar" en
      // el detalle.
      const requiereSonar = esConductorRutaSonar(basico);
      if (requiereSonar && !this._empleadoSonarSyncedAt) {
        await this._enviarASonar(id, msg);
        await this._load();
        return;
      }

      msg.textContent = 'Empleado guardado correctamente.';
      msg.className = 'form-msg success';
      await this._load();
      setTimeout(() => this._closeModal(), 700);
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    }
  },

  _closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal-box').classList.remove('modal-wide');
  },
});
