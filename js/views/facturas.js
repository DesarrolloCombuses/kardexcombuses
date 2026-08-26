Router.register('facturas', {
  title: 'Facturas',

  async onEnter() {
    if (window.APP_ROLE !== 'admin') {
      document.getElementById('factura-form').classList.add('hidden');
    }
    if (!this._bound) {
      document.getElementById('factura-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('factura-archivo-input').addEventListener('change', () => this._updateArchivoLabel());
      this._bound = true;
    }
    await this._load();
  },

  _updateArchivoLabel() {
    const input = document.getElementById('factura-archivo-input');
    const label = document.getElementById('factura-archivo-label');
    label.textContent = input.files[0] ? input.files[0].name : 'Adjuntar archivo (PDF o foto)';
  },

  async _load() {
    this._facturas = await DB.getFacturas();
    this._render();
  },

  _render() {
    const tbody = document.getElementById('facturas-tbody');
    if (this._facturas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Sin facturas registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = this._facturas.map((f) => `
      <tr data-id="${f.id}">
        <td data-label="N.º factura">${f.numero_factura}</td>
        <td data-label="Fecha remisión">${new Date(`${f.fecha_remision}T00:00:00`).toLocaleDateString('es-CO')}</td>
        <td data-label="Archivo">${f.archivo_url
          ? `<button type="button" class="btn-secondary factura-ver" data-path="${f.archivo_url}">Ver archivo</button>`
          : `<span class="muted" title="${f.archivo_nombre ? 'Era: ' + f.archivo_nombre : ''}">Sin archivo</span>`}</td>
        <td data-label="Observaciones">${f.observaciones || ''}</td>
        <td data-label="Registrada por">${f.creado_por_nombre || '—'}</td>
        <td>${window.APP_ROLE === 'admin' ? '<button type="button" class="btn-secondary factura-eliminar" style="color:var(--danger-text)">Eliminar</button>' : ''}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.factura-ver').forEach((btn) => {
      btn.addEventListener('click', () => this._verArchivo(btn.dataset.path));
    });
    tbody.querySelectorAll('.factura-eliminar').forEach((btn) => {
      btn.addEventListener('click', (e) => this._eliminar(e.target.closest('tr').dataset.id));
    });
  },

  async _verArchivo(path) {
    try {
      const url = await DB.getSignedUrl('facturas', path);
      window.open(url, '_blank');
    } catch (err) {
      alert('No se pudo abrir el archivo: ' + err.message);
    }
  },

  async _eliminar(id) {
    if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;
    try {
      await DB.deleteFactura(id);
      await this._load();
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    }
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('factura-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const numero = document.getElementById('factura-numero').value.trim();
    const fecha = document.getElementById('factura-fecha').value;
    const archivo = document.getElementById('factura-archivo-input').files[0];
    const observaciones = document.getElementById('factura-observaciones').value.trim() || null;

    if (!numero || !fecha) {
      msg.textContent = 'Completa el número de factura y la fecha.';
      msg.className = 'form-msg error';
      return;
    }
    if (!archivo) {
      msg.textContent = 'Adjunta el archivo de la factura (PDF o foto).';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';

    try {
      const session = await Auth.getSession();
      await DB.createFactura({
        numeroFactura: numero,
        fechaRemision: fecha,
        archivoFile: archivo,
        observaciones,
        createdBy: session.user.id,
      });
      msg.textContent = 'Factura guardada correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('factura-form').reset();
      this._updateArchivoLabel();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  },
});
