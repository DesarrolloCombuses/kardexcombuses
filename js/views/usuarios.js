// Admin: crea la cuenta de acceso de un empleado (para "Mis permisos") y le
// asigna un grupo. La creación real de la cuenta de Supabase Auth pasa por
// la Edge Function kardex-crear-usuario (ver DB.crearUsuario) -- acá solo se
// arma el formulario y se pinta el directorio de cuentas ya creadas.
//
// Además, cada usuario puede tener permisos sueltos por módulo (ver/agregar/
// editar/borrar), aditivos por encima de lo que ya da su grupo -- ver
// sql/permisos_granulares_2026-09-16.sql. Se editan en el modal compartido
// (#modal-backdrop), mismo patrón que el detalle de Historial.

// Mismos módulos que sql/permisos_granulares_2026-09-16.sql, agrupados como
// en el sidebar para que la matriz se lea igual de organizada.
const SECCIONES_PERMISOS = [
  { titulo: 'General', modulos: [
    { key: 'dashboard', label: 'Panel' },
  ] },
  { titulo: 'Inventario', modulos: [
    { key: 'inventario', label: 'Inventario' },
    { key: 'inventario-historico', label: 'Historial de inventario' },
    { key: 'nueva-prenda', label: 'Nueva prenda' },
    { key: 'estadisticas', label: 'Estadísticas' },
  ] },
  { titulo: 'Movimientos', modulos: [
    { key: 'entrada', label: 'Entrada' },
    { key: 'salida', label: 'Salida' },
    { key: 'historial', label: 'Historial' },
    { key: 'facturas', label: 'Facturas' },
  ] },
  { titulo: 'Personal', modulos: [
    { key: 'aspirantes', label: 'Selección de personal' },
    { key: 'empleados', label: 'Empleados' },
    { key: 'personal-cumpleanos', label: 'Cumpleaños' },
    { key: 'personal-alertas', label: 'Alertas' },
    { key: 'personal-conductores', label: 'Conductores por ruta' },
    { key: 'personal-perfil', label: 'Perfil sociodemográfico' },
    { key: 'permisos-vacaciones', label: 'Permisos y vacaciones' },
  ] },
  { titulo: 'Siniestros', modulos: [
    { key: 'siniestros-transito', label: 'Comparendos, accidentes y siniestros' },
  ] },
  { titulo: 'Parque automotor', modulos: [
    { key: 'parque-automotor', label: 'Vencimiento de documentos' },
    { key: 'alertas-vencimientos', label: 'Alertas de vencimientos' },
  ] },
];

// Columnas de Empleados que se pueden ocultar por cuenta (ver
// sql/columnas_ocultas_empleados_2026-09-18.sql) -- a diferencia de
// SECCIONES_PERMISOS, esto NO es aditivo: es una restricción sobre lo que
// ya daría el módulo/grupo, real en el servidor (kardex_empleados_con_perfil
// arma la respuesta sin esas claves). id/nombre/cédula/cargo/área/base/
// ruta/vehículo quedan siempre visibles a propósito -- otras vistas
// (Conductores por ruta, por ejemplo) agrupan por esos campos.
const CAMPOS_EMPLEADO_CORE = [
  { id: 'telefono', label: 'Teléfono' },
  { id: 'email_personal', label: 'Correo personal' },
  { id: 'salario', label: 'Salario' },
  { id: 'fecha_salida', label: 'Fecha de salida' },
  { id: 'motivo_renuncia', label: 'Motivo de renuncia' },
];
const CAMPOS_EMPLEADO_RELACIONES = [
  { id: 'contactos_emergencia', label: 'Contactos de emergencia' },
  { id: 'hijos_empleado', label: 'Hijos' },
];

Router.register('usuarios', {
  title: 'Usuarios',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('us-form').addEventListener('submit', (e) => this._submit(e));
      this._setupEmpleadoCombobox();
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [empleados, usuarios] = await Promise.all([
      DB.getEmployees({ onlyActive: true }),
      DB.getUsuariosGrupos(),
    ]);
    this._empleados = empleados;
    this._usuarios = usuarios;
    this._render();
  },

  _setupEmpleadoCombobox() {
    const search = document.getElementById('us-empleado-input');
    const hidden = document.getElementById('us-empleado-id');
    const list = document.getElementById('us-empleado-list');
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._empleados.filter((e) => e.nombre.toLowerCase().includes(q) || (e.cedula || '').includes(q))
        : this._empleados;
      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `<li data-id="${e.id}">${e.nombre} <span class="combobox-cedula">· CC ${e.cedula}</span></li>`).join('');
        if (matches.length > visibles.length) list.innerHTML += `<li class="combobox-empty">Y ${matches.length - visibles.length} más… sigue escribiendo para acotar.</li>`;
      }
      list.classList.remove('hidden');
    };

    search.addEventListener('focus', () => { search.select(); renderLista(search.value); });
    search.addEventListener('input', () => { hidden.value = ''; renderLista(search.value); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const primero = list.querySelector('li[data-id]');
      if (primero) primero.click();
    });
    search.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const empleado = this._empleados.find((emp) => emp.id === li.dataset.id);
      if (!empleado) return;
      hidden.value = empleado.id;
      search.value = `${empleado.nombre} — CC ${empleado.cedula}`;
      const emailInput = document.getElementById('us-email');
      if (empleado.email_personal && !emailInput.value) emailInput.value = empleado.email_personal;
      list.classList.add('hidden');
    });
  },

  _render() {
    const total = this._usuarios.length;
    document.getElementById('us-contador').textContent = total ? `${total} usuario(s) con grupo asignado` : 'Todavía no se ha creado ningún usuario.';

    const lista = document.getElementById('us-lista');
    lista.innerHTML = this._usuarios.map((u) => `
      <div class="person-row">
        <div class="person-info">
          <div class="person-name">${u.alias}</div>
          <div class="person-meta"><span>${u.employee?.nombre || '—'} · CC ${u.employee?.cedula || '—'}</span></div>
        </div>
        <span class="tag activo">${u.grupo}</span>
        <button type="button" class="btn-secondary" data-permisos="${u.employee_id}">Editar permisos</button>
        <button type="button" class="btn-secondary" data-quitar="${u.employee_id}">Quitar grupo</button>
      </div>
    `).join('');

    lista.querySelectorAll('[data-quitar]').forEach((btn) => {
      btn.addEventListener('click', () => this._quitarGrupo(btn.dataset.quitar));
    });
    lista.querySelectorAll('[data-permisos]').forEach((btn) => {
      btn.addEventListener('click', () => this._abrirPermisos(btn.dataset.permisos));
    });
  },

  async _abrirPermisos(employeeId) {
    const usuario = this._usuarios.find((u) => u.employee_id === employeeId);
    Loading.show('Cargando permisos…');
    let permisos;
    let columnasOcultas;
    let soloActivos;
    try {
      [permisos, columnasOcultas, soloActivos] = await Promise.all([
        DB.getPermisosUsuario(employeeId),
        DB.getColumnasOcultasEmpleado(employeeId),
        DB.getSoloActivosEmpleado(employeeId),
      ]);
    } catch (err) {
      Loading.hide();
      alert('No se pudieron cargar los permisos: ' + err.message);
      return;
    }
    Loading.hide();

    const filaColumna = (c) => `
      <tr data-campo="${c.id}">
        <td style="text-align:center"><input type="checkbox" data-campo-check ${columnasOcultas.has(c.id) ? '' : 'checked'} /></td>
        <td>${c.label}</td>
      </tr>
    `;
    const tituloGrupoColumnas = (texto) => `<tr><td colspan="2" style="background:var(--slate-50);font-weight:700;color:var(--slate-500);font-size:0.76rem;text-transform:uppercase;letter-spacing:0.04em">${texto}</td></tr>`;

    document.getElementById('modal-body').innerHTML = `
      <div class="modal-header">
        <span class="modal-header-fecha">Permisos de ${usuario?.alias || 'este usuario'}</span>
      </div>
      <p class="view-intro">Permisos sueltos por módulo, además de lo que ya le da su grupo (${usuario?.grupo || '—'}).</p>
      <div class="table-wrap">
        <table id="perm-tabla">
          <thead><tr><th>Módulo</th><th style="text-align:center">Ver</th><th style="text-align:center">Agregar</th><th style="text-align:center">Editar</th><th style="text-align:center">Borrar</th></tr></thead>
          <tbody>
            ${SECCIONES_PERMISOS.map((seccion) => `
              <tr><td colspan="5" style="background:var(--slate-50);font-weight:700;color:var(--slate-500);font-size:0.76rem;text-transform:uppercase;letter-spacing:0.04em">${seccion.titulo}</td></tr>
              ${seccion.modulos.map((m) => {
                const p = permisos[m.key] || {};
                return `
                  <tr data-modulo="${m.key}">
                    <td>${m.label}</td>
                    <td style="text-align:center"><input type="checkbox" data-accion="ver" ${p.ver ? 'checked' : ''} /></td>
                    <td style="text-align:center"><input type="checkbox" data-accion="agregar" ${p.agregar ? 'checked' : ''} /></td>
                    <td style="text-align:center"><input type="checkbox" data-accion="editar" ${p.editar ? 'checked' : ''} /></td>
                    <td style="text-align:center"><input type="checkbox" data-accion="borrar" ${p.borrar ? 'checked' : ''} /></td>
                  </tr>
                `;
              }).join('')}
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="modal-section" style="margin-top:1.4rem">
        <h3 class="modal-section-title">Columnas visibles de Empleados</h3>
        <p class="view-intro" style="margin:0 0 0.6rem">Por defecto ve todo. Desmarca lo que esta cuenta NO deba ver ni descargar en Excel -- aplica en cualquier vista donde vea información de empleados (Empleados, Alertas, Cumpleaños, Conductores, Perfil).</p>
        <label class="checkbox-label" style="display:block;margin:0 0 1rem">
          <input type="checkbox" id="col-solo-activos" ${soloActivos ? 'checked' : ''} />
          Mostrarle solo empleados activos (nunca inactivos/retirados, ni pidiendo "Todos" desde el buscador)
        </label>
        <div class="table-wrap">
          <table id="col-tabla">
            <tbody>
              ${tituloGrupoColumnas('Datos laborales y contacto')}
              ${CAMPOS_EMPLEADO_CORE.map(filaColumna).join('')}
              ${tituloGrupoColumnas('Perfil sociodemográfico')}
              ${CAMPOS_SOCIODEMOGRAFICOS.map(filaColumna).join('')}
              ${tituloGrupoColumnas('Relaciones')}
              ${CAMPOS_EMPLEADO_RELACIONES.map(filaColumna).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:1.2rem">
        <button type="button" id="perm-guardar-btn">Guardar permisos</button>
        <p id="perm-msg" class="form-msg"></p>
      </div>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('perm-guardar-btn').addEventListener('click', () => this._guardarPermisos(employeeId));
  },

  async _guardarPermisos(employeeId) {
    const msg = document.getElementById('perm-msg');
    const filas = [...document.querySelectorAll('#perm-tabla tr[data-modulo]')].map((tr) => {
      const get = (accion) => tr.querySelector(`input[data-accion="${accion}"]`).checked;
      return { modulo: tr.dataset.modulo, ver: get('ver'), agregar: get('agregar'), editar: get('editar'), borrar: get('borrar') };
    });
    const columnasOcultas = [...document.querySelectorAll('#col-tabla tr[data-campo]')]
      .filter((tr) => !tr.querySelector('input[data-campo-check]').checked)
      .map((tr) => tr.dataset.campo);
    const soloActivos = document.getElementById('col-solo-activos').checked;

    Loading.show('Guardando…');
    try {
      await Promise.all([
        DB.guardarPermisosUsuario(employeeId, filas),
        DB.guardarColumnasOcultasEmpleado(employeeId, columnasOcultas),
        DB.guardarSoloActivosEmpleado(employeeId, soloActivos),
      ]);
      msg.textContent = 'Permisos guardados.';
      msg.className = 'form-msg success';
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  async _quitarGrupo(employeeId) {
    const usuario = this._usuarios.find((u) => u.employee_id === employeeId);
    if (!confirm(`¿Quitar el grupo de "${usuario?.alias || 'este usuario'}"? Su cuenta sigue existiendo, solo deja de tener grupo asignado (y de poder aprobar permisos, si lo tenía).`)) return;
    Loading.show('Quitando…');
    try {
      await DB.quitarGrupoUsuario(employeeId);
      await this._load();
    } catch (err) {
      alert('No se pudo quitar: ' + err.message);
    } finally {
      Loading.hide();
    }
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('us-msg');
    const passwordBox = document.getElementById('us-password-box');
    msg.textContent = '';
    msg.className = 'form-msg';
    passwordBox.classList.add('hidden');

    const employeeId = document.getElementById('us-empleado-id').value;
    const alias = document.getElementById('us-alias').value.trim();
    const email = document.getElementById('us-email').value.trim();
    const grupo = document.getElementById('us-grupo').value;

    if (!employeeId) {
      msg.textContent = 'Selecciona un empleado de la lista.';
      msg.className = 'form-msg error';
      return;
    }
    if (!alias || !email || !grupo) {
      msg.textContent = 'Alias, correo y grupo son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Creando…');
    try {
      const resultado = await DB.crearUsuario({ employeeId, email, alias, grupo });
      if (resultado.created && resultado.tempPassword) {
        passwordBox.textContent = `Cuenta creada. Contraseña temporal: ${resultado.tempPassword} — cópiala ahora y compártela con el empleado, no se vuelve a mostrar.`;
        passwordBox.classList.remove('hidden');
      } else {
        msg.textContent = 'Esta cuenta ya existía — se actualizó su grupo.';
        msg.className = 'form-msg success';
      }
      document.getElementById('us-form').reset();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo crear: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },
});
