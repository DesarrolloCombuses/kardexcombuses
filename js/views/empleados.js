Router.register('empleados', {
  title: 'Empleados',
  async onEnter() {
    if (!this._bound) {
      document.getElementById('empleado-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('empleado-cancel-btn').addEventListener('click', () => this._resetForm());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const employees = await DB.getEmployees();
    const tbody = document.getElementById('empleados-tbody');
    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Sin empleados registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = employees.map((e) => `
      <tr>
        <td data-label="Nombre">${e.nombre}</td>
        <td data-label="Cédula">${e.cedula}</td>
        <td data-label="Cargo">${e.cargo || '—'}</td>
        <td data-label="Área">${e.area || '—'}</td>
        <td data-label="Estado">${e.activo ? 'Activo' : 'Inactivo'}</td>
        <td>
          <button type="button" class="btn-secondary" data-edit="${e.id}">Editar</button>
          <button type="button" class="btn-secondary" data-toggle="${e.id}" data-active="${e.activo}">
            ${e.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emp = employees.find((e) => e.id === btn.dataset.edit);
        this._fillForm(emp);
      });
    });
    tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await DB.updateEmployee(btn.dataset.toggle, { activo: btn.dataset.active !== 'true' });
        await this._load();
      });
    });
  },

  _fillForm(emp) {
    document.getElementById('empleado-id').value = emp.id;
    document.getElementById('empleado-nombre').value = emp.nombre;
    document.getElementById('empleado-cedula').value = emp.cedula;
    document.getElementById('empleado-cargo').value = emp.cargo || '';
    document.getElementById('empleado-area').value = emp.area || '';
    document.getElementById('empleado-submit-btn').textContent = 'Guardar cambios';
    document.getElementById('empleado-cancel-btn').classList.remove('hidden');
  },

  _resetForm() {
    document.getElementById('empleado-form').reset();
    document.getElementById('empleado-id').value = '';
    document.getElementById('empleado-submit-btn').textContent = 'Agregar';
    document.getElementById('empleado-cancel-btn').classList.add('hidden');
  },

  async _submit(e) {
    e.preventDefault();
    const id = document.getElementById('empleado-id').value;
    const payload = {
      nombre: document.getElementById('empleado-nombre').value.trim(),
      cedula: document.getElementById('empleado-cedula').value.trim(),
      cargo: document.getElementById('empleado-cargo').value.trim() || null,
      area: document.getElementById('empleado-area').value.trim() || null,
    };
    try {
      if (id) {
        await DB.updateEmployee(id, payload);
      } else {
        await DB.createEmployee(payload);
      }
      this._resetForm();
      await this._load();
    } catch (err) {
      alert('No se pudo guardar el empleado: ' + err.message);
    }
  },
});
