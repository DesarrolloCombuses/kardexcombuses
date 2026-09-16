// Admin: crea la cuenta de acceso de un empleado (para "Mis permisos") y le
// asigna un grupo. La creación real de la cuenta de Supabase Auth pasa por
// la Edge Function kardex-crear-usuario (ver DB.crearUsuario) -- acá solo se
// arma el formulario y se pinta el directorio de cuentas ya creadas.

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
        <button type="button" class="btn-secondary" data-quitar="${u.employee_id}">Quitar grupo</button>
      </div>
    `).join('');

    lista.querySelectorAll('[data-quitar]').forEach((btn) => {
      btn.addEventListener('click', () => this._quitarGrupo(btn.dataset.quitar));
    });
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
