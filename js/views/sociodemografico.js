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
  { id: 'estrato_socioeconomico', label: 'Estrato socioeconómico', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
  { id: 'lugar_residencia', label: 'Lugar de residencia (municipio)', type: 'text' },
  { id: 'barrio', label: 'Barrio', type: 'text' },
  { id: 'medio_desplazamiento', label: 'Medio de desplazamiento', type: 'select', options: ['A pie', 'Bicicleta', 'Moto propia', 'Vehículo propio', 'Transporte público', 'Transporte de la empresa', 'Otro'] },
  { id: 'raza', label: 'Raza / etnia', type: 'select', options: ['Mestizo', 'Afrodescendiente', 'Indígena', 'Blanco', 'Otro'] },
  { id: 'tipo_sangre', label: 'Tipo de sangre', type: 'select', options: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
  { id: 'turno_trabajo', label: 'Turno de trabajo', type: 'select', options: ['Diurno', 'Nocturno', 'Mixto'] },
  { id: 'tipo_vinculacion', label: 'Tipo de vinculación', type: 'text' },
  { id: 'fecha_ingreso', label: 'Fecha de ingreso', type: 'date' },
  { id: 'conduce', label: '¿Conduce para el desempeño de sus funciones?', type: 'checkbox' },
  { id: 'tipo_vehiculo_conduce', label: 'Tipo de vehículo que conduce', type: 'text' },
  { id: 'anios_experiencia_conduccion', label: 'Años de experiencia en conducción', type: 'number' },
  { id: 'observaciones', label: 'Observaciones', type: 'textarea' },
];

function campoSociodemograficoHtml(campo, valor) {
  const id = `socio-${campo.id}`;
  if (campo.type === 'select') {
    const opciones = ['<option value="">—</option>']
      .concat(campo.options.map((o) => `<option value="${o}" ${valor === o ? 'selected' : ''}>${o}</option>`))
      .join('');
    return `<label>${campo.label}<select id="${id}">${opciones}</select></label>`;
  }
  if (campo.type === 'checkbox') {
    return `<label class="checkbox-label"><input type="checkbox" id="${id}" ${valor ? 'checked' : ''} /> ${campo.label}</label>`;
  }
  if (campo.type === 'textarea') {
    return `<label style="grid-column:1/-1">${campo.label}<textarea id="${id}" rows="2">${valor || ''}</textarea></label>`;
  }
  return `<label>${campo.label}<input type="${campo.type}" id="${id}" value="${valor || ''}" ${campo.placeholder ? `placeholder="${campo.placeholder}"` : ''} /></label>`;
}

Router.register('sociodemografico', {
  title: 'Perfil sociodemográfico',
  async onEnter() {
    if (!this._bound) {
      document.getElementById('sociodemografico-search').addEventListener('input', () => this._render());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [employees, conPerfil] = await Promise.all([
      DB.getEmployees({ onlyActive: true }),
      DB.getEmployeeIdsConPerfilSociodemografico(),
    ]);
    this._employees = employees;
    this._conPerfil = conPerfil;
    this._render();
  },

  _render() {
    const q = document.getElementById('sociodemografico-search').value.trim().toLowerCase();
    const filtrados = q
      ? this._employees.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q))
      : this._employees;

    const tbody = document.getElementById('sociodemografico-tbody');
    if (filtrados.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">Sin resultados.</td></tr>';
      return;
    }
    tbody.innerHTML = filtrados.map((e) => {
      const completo = this._conPerfil.has(e.id);
      return `
        <tr>
          <td data-label="Nombre">${e.nombre}</td>
          <td data-label="Cédula">${e.cedula}</td>
          <td data-label="Cargo">${e.cargo || '—'}</td>
          <td data-label="Perfil"><span class="tag ${completo ? 'completo' : 'pendiente'}">${completo ? 'Completo' : 'Pendiente'}</span></td>
          <td><button type="button" class="btn-secondary" data-editar="${e.id}">${completo ? 'Editar' : 'Completar'}</button></td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-editar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = this._employees.find((x) => x.id === btn.dataset.editar);
        if (emp) this._abrirPerfil(emp);
      });
    });
  },

  async _abrirPerfil(empleado) {
    const perfil = (await DB.getPerfilSociodemografico(empleado.id)) || {};
    const camposHtml = CAMPOS_SOCIODEMOGRAFICOS.map((c) => campoSociodemograficoHtml(c, perfil[c.id])).join('');

    document.getElementById('modal-body').innerHTML = `
      <div class="modal-header">
        <span class="modal-header-fecha">${empleado.nombre} · CC ${empleado.cedula}</span>
      </div>
      <form id="socio-form" class="form fieldset-grid">
        ${camposHtml}
        <div style="grid-column:1/-1">
          <button type="submit">Guardar perfil</button>
          <p id="socio-msg" class="form-msg"></p>
        </div>
      </form>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('socio-form').addEventListener('submit', (e) => this._guardarPerfil(e, empleado.id));
  },

  async _guardarPerfil(e, employeeId) {
    e.preventDefault();
    const msg = document.getElementById('socio-msg');
    msg.textContent = 'Guardando…';
    msg.className = 'form-msg';

    const payload = {};
    CAMPOS_SOCIODEMOGRAFICOS.forEach((c) => {
      const el = document.getElementById(`socio-${c.id}`);
      if (c.type === 'checkbox') {
        payload[c.id] = el.checked;
      } else if (c.type === 'number') {
        payload[c.id] = el.value ? parseInt(el.value, 10) : null;
      } else {
        payload[c.id] = el.value.trim() || null;
      }
    });

    try {
      await DB.savePerfilSociodemografico(employeeId, payload);
      msg.textContent = 'Perfil guardado correctamente.';
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
