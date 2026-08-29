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
        const perfilAprobado = a.employees?.perfil_aprobado_at;
        const perfilBadge = perfilAprobado
          ? `<span class="tag completo" title="Aprobado por ${a.employees.perfil_aprobado_por || '—'}">Perfil aprobado</span>`
          : '<span class="tag pendiente">Perfil pendiente de aprobación</span>';
        const perfilBtn = perfilAprobado
          ? `<button type="button" class="btn-secondary aspirante-quitar-aprobacion" data-id="${a.id}">Quitar aprobación</button>`
          : `<button type="button" class="btn-secondary aspirante-aprobar-perfil" data-id="${a.id}">Aprobar perfil</button>`;
        acciones = `
          ${perfilBadge}
          <button type="button" class="btn-secondary aspirante-link" data-id="${a.id}">Ver link de perfil</button>
          ${perfilBtn}
          <button type="button" class="btn-secondary aspirante-deshacer-seleccion" data-id="${a.id}">Deshacer selección</button>
          <button type="button" class="btn-secondary aspirante-descartar" data-id="${a.id}" style="color:var(--danger-text)">Descartar</button>
        `;
      } else if (a.estado === 'Descartado') {
        acciones = `<button type="button" class="btn-secondary aspirante-reabrir" data-id="${a.id}">Reabrir</button>`;
      } else {
        acciones = `
          <button type="button" class="btn-secondary aspirante-seleccionar" data-id="${a.id}">Seleccionar candidato</button>
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
    tbody.querySelectorAll('.aspirante-seleccionar').forEach((btn) => {
      btn.addEventListener('click', () => this._seleccionar(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-descartar').forEach((btn) => {
      btn.addEventListener('click', () => this._descartar(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-reabrir').forEach((btn) => {
      btn.addEventListener('click', () => this._cambiarEstado(btn.dataset.id, 'En proceso'));
    });
    tbody.querySelectorAll('.aspirante-link').forEach((btn) => {
      btn.addEventListener('click', () => this._verLink(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-deshacer-seleccion').forEach((btn) => {
      btn.addEventListener('click', () => this._deshacerSeleccion(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-aprobar-perfil').forEach((btn) => {
      btn.addEventListener('click', () => this._aprobarPerfil(btn.dataset.id));
    });
    tbody.querySelectorAll('.aspirante-quitar-aprobacion').forEach((btn) => {
      btn.addEventListener('click', () => this._quitarAprobacionPerfil(btn.dataset.id));
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

  // Seleccionar = marcar Contratado + crear el empleado, en un solo paso. Al
  // terminar deja listo el link de perfil público (en un modal, no un
  // alert() -- en el celular un alert() con una URL larga la corta en
  // varias líneas y no se puede seleccionar bien para copiarla).
  //
  // Esto NO es la aprobación final: "seleccionar" es elegir a este
  // candidato para el cargo y dejarle el link para que llene sus datos.
  // "Aprobar perfil" (más abajo) es lo que hace Gestión Humana después,
  // cuando ya diligenció todo y lo revisaron.
  async _seleccionar(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante) return;
    if (!confirm(`¿Seleccionar a ${aspirante.nombre} y crear su registro de empleado?`)) return;
    try {
      const empleado = await DB.seleccionarAspirante(aspirante);
      await this._load();
      this._mostrarLinkModal(aspirante.nombre, this._linkPerfil(empleado.id));
    } catch (err) {
      alert('No se pudo seleccionar: ' + err.message);
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

  _verLink(id) {
    const a = this._aspirantes.find((x) => x.id === id);
    if (!a || !a.employee_id) return;
    this._mostrarLinkModal(a.nombre, this._linkPerfil(a.employee_id));
  },

  // Modal compartido de la app: el link queda en un input seleccionable
  // (se puede copiar a mano aunque falle el portapapeles) + un botón que
  // copia directo, y en el celular un botón "Compartir…" que abre el menú
  // nativo (WhatsApp, correo, etc. -- lo que tenga instalado el equipo).
  _mostrarLinkModal(nombre, url) {
    const puedeCompartir = typeof navigator.share === 'function';
    document.getElementById('modal-body').innerHTML = `
      <div class="modal-header">
        <span class="modal-header-fecha">Link de perfil — ${nombre}</span>
      </div>
      <div class="modal-section">
        <p class="prose-p">Envíale este link a ${nombre} (WhatsApp, correo, etc.). Con su cédula podrá completar sus datos básicos, sin usuario ni contraseña.</p>
        <input type="text" id="pp-link-input" value="${url}" readonly />
        <div style="display:flex; gap:0.6rem; margin-top:0.75rem; flex-wrap:wrap">
          <button type="button" class="btn-secondary" id="pp-link-copiar">Copiar link</button>
          ${puedeCompartir ? '<button type="button" class="btn-secondary" id="pp-link-compartir">Compartir…</button>' : ''}
        </div>
        <p id="pp-link-msg" class="form-msg"></p>
      </div>
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const input = document.getElementById('pp-link-input');
    input.addEventListener('click', () => input.select());
    input.focus();
    input.select();

    document.getElementById('pp-link-copiar').addEventListener('click', async () => {
      const ok = await this._copiarTexto(url);
      const msg = document.getElementById('pp-link-msg');
      msg.textContent = ok
        ? 'Copiado al portapapeles.'
        : 'No se pudo copiar automáticamente. El texto ya quedó seleccionado: cópialo con el teclado o el menú de tu navegador.';
      msg.className = ok ? 'form-msg success' : 'form-msg error';
      if (!ok) { input.focus(); input.select(); }
    });

    const shareBtn = document.getElementById('pp-link-compartir');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        navigator.share({ title: 'Completa tus datos — ERP Combuses', text: `Hola ${nombre}, completa tus datos aquí:`, url }).catch(() => {});
      });
    }
  },

  async _deshacerSeleccion(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante) return;
    if (!confirm(
      `¿Deshacer la selección de ${aspirante.nombre}?\n\n` +
      `Esto elimina el registro que se creó en Empleados (y lo que ya se le haya cargado ahí: perfil, foto, contactos). ` +
      `El aspirante vuelve a quedar "En proceso".`
    )) return;
    try {
      await DB.revertirAprobacion(aspirante, 'En proceso');
      await this._load();
    } catch (err) {
      alert('No se pudo deshacer: ' + err.message);
    }
  },

  // Descartar sirve en cualquier punto del proceso: si todavía no se había
  // seleccionado, solo cambia el estado; si ya se había convertido en
  // empleado (puede pasar: no se presentó, cambió de idea, etc.) también
  // borra ese registro de Empleados para no dejarlo dando vueltas como
  // activo.
  async _descartar(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante) return;
    const advertencia = aspirante.employee_id
      ? `¿Descartar a ${aspirante.nombre}?\n\nComo ya estaba seleccionado, esto también elimina el registro que se creó en Empleados (perfil, foto, contactos incluidos).`
      : `¿Descartar a ${aspirante.nombre}?`;
    if (!confirm(advertencia)) return;
    try {
      if (aspirante.employee_id) {
        await DB.revertirAprobacion(aspirante, 'Descartado');
      } else {
        await DB.updateAspiranteEstado(id, 'Descartado');
      }
      await this._load();
    } catch (err) {
      alert('No se pudo descartar: ' + err.message);
    }
  },

  // Aprobación final del perfil (Gestión Humana): distinta de "seleccionar"
  // -- el empleado ya existe y ya llenó su parte por el link público; esto
  // solo dice "revisado y aprobado", queda quién y cuándo, y el link
  // público se lo muestra a la persona.
  async _aprobarPerfil(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante || !aspirante.employee_id) return;
    if (!confirm(`¿Aprobar el perfil de ${aspirante.nombre}?`)) return;
    try {
      await DB.aprobarPerfilEmpleado(aspirante.employee_id);
      await this._load();
    } catch (err) {
      alert('No se pudo aprobar el perfil: ' + err.message);
    }
  },

  async _quitarAprobacionPerfil(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante || !aspirante.employee_id) return;
    if (!confirm(`¿Quitar la aprobación del perfil de ${aspirante.nombre}?`)) return;
    try {
      await DB.quitarAprobacionPerfil(aspirante.employee_id);
      await this._load();
    } catch (err) {
      alert('No se pudo quitar la aprobación: ' + err.message);
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
