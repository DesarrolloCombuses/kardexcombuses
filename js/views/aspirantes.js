Router.register('aspirantes', {
  title: 'Selección de personal',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('aspirante-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('aspirante-hoja-input').addEventListener('change', () => this._updateHojaLabel());
      this._bound = true;
    }
    await this._load();
  },

  _updateHojaLabel() {
    const input = document.getElementById('aspirante-hoja-input');
    const label = document.getElementById('aspirante-hoja-label');
    label.textContent = input.files[0] ? input.files[0].name : 'Adjuntar hoja de vida (PDF o foto)';
  },

  async _load() {
    const [aspirantes, empleados] = await Promise.all([DB.getAspirantes(), DB.getEmployees({ onlyActive: true })]);
    this._aspirantes = aspirantes;
    this._llenarSugerencias(empleados);
    this._render();
  },

  // Sugiere el cargo/área que ya existen en Empleados (datalist: autocompleta
  // pero sigue dejando escribir uno nuevo, por si se está contratando para
  // un cargo/área que todavía no existe en la planta).
  _llenarSugerencias(empleados) {
    const llenar = (id, valores) => {
      const opciones = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      document.getElementById(id).innerHTML = opciones.map((v) => `<option value="${v}"></option>`).join('');
    };
    llenar('aspirante-cargo-list', empleados.map((e) => e.cargo));
    llenar('aspirante-area-list', empleados.map((e) => e.area));
  },

  _render() {
    const tbody = document.getElementById('aspirantes-tbody');
    if (this._aspirantes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">Sin aspirantes registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = this._aspirantes.map((a) => {
      const estadoTag = a.estado === 'Contratado' ? 'completo' : a.estado === 'Descartado' ? 'descartado' : 'pendiente';
      let acciones;
      if (a.employee_id) {
        acciones = `
          <span class="tag completo">Ya es empleado</span>
          <button type="button" class="btn-secondary aspirante-link" data-id="${a.id}">Copiar link de perfil</button>
        `;
      } else if (a.estado === 'Descartado') {
        acciones = `<button type="button" class="btn-secondary aspirante-reabrir" data-id="${a.id}">Reabrir</button>`;
      } else {
        acciones = `
          <button type="button" class="btn-secondary aspirante-aprobar" data-id="${a.id}">Aprobar</button>
          <button type="button" class="btn-secondary aspirante-descartar" data-id="${a.id}" style="color:var(--danger-text)">Descartar</button>
        `;
      }
      return `
      <tr data-id="${a.id}">
        <td data-label="Nombre">${a.nombre}${a.cedula ? ' <span class="muted">· CC ' + a.cedula + '</span>' : ''}</td>
        <td data-label="Cargo al que aspira">${a.cargo_aspirado || '—'}</td>
        <td data-label="Área">${a.area_aspirada || '—'}</td>
        <td data-label="Teléfono">${a.telefono || '—'}</td>
        <td data-label="Hoja de vida">${a.hoja_vida_url
          ? `<button type="button" class="btn-secondary aspirante-ver-hoja" data-id="${a.id}">Ver</button>`
          : '<span class="muted">Sin archivo</span>'}</td>
        <td data-label="Estado"><span class="tag ${estadoTag}">${a.estado}</span></td>
        <td data-label="">
          ${acciones}
          <button type="button" class="btn-secondary aspirante-eliminar" data-id="${a.id}" style="color:var(--danger-text)">Eliminar</button>
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.aspirante-ver-hoja').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = this._aspirantes.find((x) => x.id === btn.dataset.id);
        if (a) this._verHoja(a);
      });
    });
    tbody.querySelectorAll('.aspirante-aprobar').forEach((btn) => {
      btn.addEventListener('click', () => this._aprobar(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-descartar').forEach((btn) => {
      btn.addEventListener('click', () => this._cambiarEstado(btn.dataset.id, 'Descartado'));
    });
    tbody.querySelectorAll('.aspirante-reabrir').forEach((btn) => {
      btn.addEventListener('click', () => this._cambiarEstado(btn.dataset.id, 'En proceso'));
    });
    tbody.querySelectorAll('.aspirante-link').forEach((btn) => {
      btn.addEventListener('click', () => this._copiarLink(btn));
    });
    tbody.querySelectorAll('.aspirante-eliminar').forEach((btn) => {
      btn.addEventListener('click', () => this._eliminar(btn.dataset.id));
    });
  },

  // Mismo visor compartido (imagen inline / PDF en iframe) que ya usa
  // Facturas para su archivo adjunto -- incluida la deducción del tipo por
  // extensión, que uploadToBucket agrega sola al subir.
  async _verHoja(aspirante) {
    try {
      const url = await DB.getSignedUrl('hojas-vida', aspirante.hoja_vida_url);
      const ext = (aspirante.hoja_vida_url.split('.').pop() || '').toLowerCase();
      const esImagen = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      const esPdf = ext === 'pdf';

      const visor = esImagen
        ? `<img src="${url}" alt="Hoja de vida de ${aspirante.nombre}" style="max-width:100%;display:block;margin:0 auto;border-radius:var(--radius-sm)">`
        : esPdf
          ? `<iframe src="${url}" title="Hoja de vida de ${aspirante.nombre}" style="width:100%;height:70vh;border:1px solid var(--slate-200);border-radius:var(--radius-sm)"></iframe>`
          : `<p class="muted">No se puede previsualizar este tipo de archivo — ábrelo en una pestaña nueva.</p>`;

      document.getElementById('modal-body').innerHTML = `
        <div class="modal-header">
          <span class="modal-header-fecha">Hoja de vida — ${aspirante.nombre}</span>
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

  async _cambiarEstado(id, estado) {
    try {
      await DB.updateAspiranteEstado(id, estado);
      await this._load();
    } catch (err) {
      alert('No se pudo actualizar el estado: ' + err.message);
    }
  },

  // Aprobar = marcar Contratado + crear el empleado, en un solo paso. Al
  // terminar deja listo el link de perfil público para copiar y enviar.
  async _aprobar(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante) return;
    if (!confirm(`¿Aprobar a ${aspirante.nombre} y crear su registro de empleado?`)) return;
    try {
      const empleado = await DB.aprobarAspirante(aspirante);
      await this._load();
      const url = this._linkPerfil(empleado.id);
      const copiado = await this._copiarTexto(url);
      alert(
        `${aspirante.nombre} quedó aprobado y registrado como empleado.\n\n` +
        `Link para que complete sus datos:\n${url}` +
        (copiado ? '\n\n(ya quedó copiado al portapapeles)' : '')
      );
    } catch (err) {
      alert('No se pudo aprobar: ' + err.message);
    }
  },

  _linkPerfil(employeeId) {
    const url = new URL('perfil-publico.html', window.location.href);
    url.searchParams.set('id', employeeId);
    return url.toString();
  },

  async _copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return false;
    }
  },

  async _copiarLink(btn) {
    const a = this._aspirantes.find((x) => x.id === btn.dataset.id);
    if (!a || !a.employee_id) return;
    const url = this._linkPerfil(a.employee_id);
    const copiado = await this._copiarTexto(url);
    if (copiado) {
      const original = btn.textContent;
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } else {
      prompt('Copia este link manualmente:', url);
    }
  },

  async _eliminar(id) {
    if (!confirm('¿Eliminar este aspirante? Esta acción no se puede deshacer.')) return;
    try {
      await DB.deleteAspirante(id);
      await this._load();
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    }
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('aspirante-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const nombre = document.getElementById('aspirante-nombre').value.trim();
    const cedula = document.getElementById('aspirante-cedula').value.trim();
    const telefono = document.getElementById('aspirante-telefono').value.trim() || null;
    const cargoAspirado = document.getElementById('aspirante-cargo').value.trim() || null;
    const areaAspirada = document.getElementById('aspirante-area').value.trim() || null;
    const hojaVidaFile = document.getElementById('aspirante-hoja-input').files[0] || null;
    const observaciones = document.getElementById('aspirante-observaciones').value.trim() || null;

    if (!nombre || !cedula) {
      msg.textContent = 'Nombre y cédula son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';

    try {
      await DB.createAspirante({ nombre, cedula, telefono, cargoAspirado, areaAspirada, hojaVidaFile, observaciones });
      msg.textContent = 'Aspirante registrado correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('aspirante-form').reset();
      this._updateHojaLabel();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  },
});
