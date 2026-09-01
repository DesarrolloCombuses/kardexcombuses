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
      btn.addEventListener('click', () => {
        const factura = this._facturas.find((f) => f.id === btn.closest('tr').dataset.id);
        if (factura) this._verArchivo(factura);
      });
    });
    tbody.querySelectorAll('.factura-eliminar').forEach((btn) => {
      btn.addEventListener('click', (e) => this._eliminar(e.target.closest('tr').dataset.id));
    });
  },

  // Visor dentro del modal compartido en vez de abrir directo en pestaña
  // nueva: PDF e imagen se pueden ver sin salir de la app; el tipo se
  // deduce de la extensión guardada en archivo_url (uploadToBucket la
  // agrega al subir, ver DB.createFactura).
  async _verArchivo(factura) {
    try {
      const url = await DB.getSignedUrl('facturas', factura.archivo_url);
      const ext = (factura.archivo_url.split('.').pop() || '').toLowerCase();
      const esImagen = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      const esPdf = ext === 'pdf';

      const visor = esImagen
        ? `<img src="${url}" alt="Factura ${factura.numero_factura}" style="max-width:100%;display:block;margin:0 auto;border-radius:var(--radius-sm)">`
        : esPdf
          ? `<iframe src="${url}" title="Factura ${factura.numero_factura}" style="width:100%;height:70vh;border:1px solid var(--slate-200);border-radius:var(--radius-sm)"></iframe>`
          : `<p class="muted">No se puede previsualizar este tipo de archivo — ábrelo en una pestaña nueva.</p>`;

      document.getElementById('modal-body').innerHTML = `
        <div class="modal-header">
          <span class="modal-header-fecha">Factura ${factura.numero_factura}</span>
        </div>
        <div class="modal-section">${visor}</div>
        <div class="modal-section" style="text-align:right">
          <a href="${url}" target="_blank" rel="noopener" class="btn-secondary">Abrir en pestaña nueva ↗</a>
        </div>
      `;
      document.getElementById('modal-box').classList.add('modal-wide');
      document.getElementById('modal-backdrop').classList.remove('hidden');
    } catch (err) {
      alert('No se pudo abrir el archivo: ' + err.message);
    }
  },

  async _eliminar(id) {
    if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;
    Loading.show('Eliminando…');
    try {
      await DB.deleteFactura(id);
      await this._load();
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    } finally {
      Loading.hide();
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
    Loading.show('Subiendo factura…');

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
      Loading.hide();
    }
  },
});
