// Bandeja de aprobación (admin): aprueba/rechaza las solicitudes de los
// empleados, y también puede registrar una a nombre de alguien que todavía
// no tiene correo cargado (así no depende de que esa persona ya tenga
// cuenta para pedir su permiso).

function formatFechaHoraPV(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function tagPV(estado) {
  return estado === 'Aprobado' ? 'completo' : estado === 'Rechazado' ? 'descartado' : 'pendiente';
}

Router.register('permisos-vacaciones', {
  title: 'Permisos y vacaciones',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pv-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('pv-soporte-input').addEventListener('change', () => this._updateSoporteLabel());
      document.getElementById('pv-reposicion').addEventListener('change', () => this._toggleReemplazo());
      ['pv-search', 'pv-filtro-fecha-desde', 'pv-filtro-fecha-hasta'].forEach((id) => {
        document.getElementById(id).addEventListener('input', () => this._render());
      });
      ['pv-filtro-estado', 'pv-filtro-tipo'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('pv-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [permisos, empleados] = await Promise.all([DB.getPermisos(), DB.getEmployees({ onlyActive: true })]);
    this._permisos = permisos;
    this._empleados = empleados;
    this._setupCombobox('pv-empleado-input', 'pv-empleado-id', 'pv-empleado-list', empleados);
    this._setupCombobox('pv-reemplazo-input', 'pv-reemplazo-id', 'pv-reemplazo-list', empleados);
    this._pintarStats(permisos);
    this._render();
  },

  _pintarStats(permisos) {
    const hoy = new Date();
    const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const esteMes = permisos.filter((p) => (p.created_at || '').slice(0, 7) === inicioMes).length;
    document.getElementById('pv-stat-pendientes').textContent = permisos.filter((p) => p.estado === 'Pendiente').length;
    document.getElementById('pv-stat-aprobados').textContent = permisos.filter((p) => p.estado === 'Aprobado').length;
    document.getElementById('pv-stat-rechazados').textContent = permisos.filter((p) => p.estado === 'Rechazado').length;
    document.getElementById('pv-stat-mes').textContent = esteMes;
  },

  _toggleReemplazo() {
    const requiere = document.getElementById('pv-reposicion').value === 'si';
    document.getElementById('pv-reemplazo-wrap').classList.toggle('hidden', !requiere);
    if (!requiere) {
      document.getElementById('pv-reemplazo-id').value = '';
      document.getElementById('pv-reemplazo-input').value = '';
    }
  },

  _updateSoporteLabel() {
    const input = document.getElementById('pv-soporte-input');
    const label = document.getElementById('pv-soporte-label');
    label.textContent = input.files[0] ? input.files[0].name : 'Adjuntar soporte (opcional, PDF o foto)';
  },

  // Buscador de empleado reutilizable -- se llama dos veces en esta vista
  // (empleado solicitante y empleado que reemplaza), ambos contra la misma
  // lista completa (el admin sí puede leer employees directo).
  _setupCombobox(searchId, hiddenId, listId, empleados) {
    const search = document.getElementById(searchId);
    const hidden = document.getElementById(hiddenId);
    const list = document.getElementById(listId);
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q ? empleados.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q)) : empleados;
      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `<li data-id="${e.id}">${e.nombre} <span class="combobox-cedula">· CC ${e.cedula}</span></li>`).join('');
        if (matches.length > visibles.length) list.innerHTML += `<li class="combobox-empty">Y ${matches.length - visibles.length} más… sigue escribiendo para acotar.</li>`;
      }
      list.classList.remove('hidden');
    };

    // Los listeners se reponen en cada _load() (se sobreescribe la lista de
    // empleados si cambió); usar los mismos ids con addEventListener de
    // nuevo no duplica nada raro porque el nodo <input> nunca se recrea,
    // pero para no ir acumulando listeners se marca con un dataset flag.
    if (search.dataset.comboboxBound) return;
    search.dataset.comboboxBound = '1';

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
      list.classList.add('hidden');
    });
  },

  _limpiarFiltros() {
    document.getElementById('pv-search').value = '';
    document.getElementById('pv-filtro-estado').value = '';
    document.getElementById('pv-filtro-tipo').value = '';
    document.getElementById('pv-filtro-fecha-desde').value = '';
    document.getElementById('pv-filtro-fecha-hasta').value = '';
    this._render();
  },

  _iniciales(nombre) {
    const partes = (nombre || '').trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
  },

  _render() {
    const q = document.getElementById('pv-search').value.trim().toLowerCase();
    const estado = document.getElementById('pv-filtro-estado').value;
    const tipo = document.getElementById('pv-filtro-tipo').value;
    const fechaDesde = document.getElementById('pv-filtro-fecha-desde').value;
    const fechaHasta = document.getElementById('pv-filtro-fecha-hasta').value;

    let filtrados = this._permisos;
    if (estado) filtrados = filtrados.filter((p) => p.estado === estado);
    if (tipo) filtrados = filtrados.filter((p) => p.tipo_permiso === tipo);
    if (fechaDesde) filtrados = filtrados.filter((p) => (p.fecha_hora_inicio || '').slice(0, 10) >= fechaDesde);
    if (fechaHasta) filtrados = filtrados.filter((p) => (p.fecha_hora_inicio || '').slice(0, 10) <= fechaHasta);
    if (q) filtrados = filtrados.filter((p) => (p.employee?.nombre || '').toLowerCase().includes(q) || (p.employee?.cedula || '').includes(q));

    const total = this._permisos.length;
    document.getElementById('pv-contador').textContent =
      filtrados.length === total ? `${total} solicitud(es)` : `Mostrando ${filtrados.length} de ${total} solicitud(es)`;

    const lista = document.getElementById('pv-lista');
    if (filtrados.length === 0) {
      lista.innerHTML = '<p class="empty-note">Sin resultados con estos filtros.</p>';
      return;
    }

    lista.innerHTML = filtrados.map((p) => {
      const meta = [
        p.employee?.cargo || 'Sin cargo',
        `${formatFechaHoraPV(p.fecha_hora_inicio)} → ${formatFechaHoraPV(p.fecha_hora_fin)}`,
      ].filter(Boolean).join(' · ');
      return `
        <div class="person-row">
          <span class="person-avatar">${this._iniciales(p.employee?.nombre)}</span>
          <div class="person-info">
            <div class="person-name">${p.employee?.nombre || 'Empleado eliminado'} — ${p.tipo_permiso}</div>
            <div class="person-meta"><span>${meta}</span></div>
          </div>
          <span class="tag ${tagPV(p.estado)}">${p.estado}</span>
          <button type="button" class="btn-secondary" data-detalle="${p.id}">Ver detalle</button>
        </div>
      `;
    }).join('');

    lista.querySelectorAll('[data-detalle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = this._permisos.find((x) => x.id === btn.dataset.detalle);
        if (p) this._verDetalle(p);
      });
    });
  },

  _verDetalle(p) {
    const acciones = p.estado === 'Pendiente' ? `
      <button type="button" class="btn-secondary" id="pv-aprobar">Aprobar</button>
      <button type="button" class="btn-secondary" id="pv-rechazar" style="color:var(--danger-text)">Rechazar</button>
    ` : `<button type="button" class="btn-secondary" id="pv-volver-pendiente">Volver a Pendiente</button>`;

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <span class="person-avatar detalle-avatar">${this._iniciales(p.employee?.nombre)}</span>
        <div class="detalle-header-info">
          <div class="detalle-nombre">${p.employee?.nombre || 'Empleado eliminado'}</div>
          <div class="detalle-sub">CC ${p.employee?.cedula || '—'} · ${p.employee?.cargo || ''}</div>
        </div>
        <div class="detalle-tags"><span class="tag ${tagPV(p.estado)}">${p.estado}</span></div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value">${p.tipo_permiso}</div><div class="detalle-fact-label">Tipo de permiso</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${formatFechaHoraPV(p.fecha_hora_inicio)}</div><div class="detalle-fact-label">Desde</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${formatFechaHoraPV(p.fecha_hora_fin)}</div><div class="detalle-fact-label">Hasta</div></div>
      </div>

      ${p.motivo ? `<div class="modal-section"><h3 class="modal-section-title">Motivo</h3><p class="prose-p">${p.motivo}</p></div>` : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">Reposición</h3>
        <p class="prose-p">${p.requiere_reposicion ? `Sí, reemplaza: ${p.reemplazo?.nombre || '—'}` : 'No requiere reposición.'}</p>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Soporte adjunto</h3>
        ${p.soporte_url ? `<button type="button" class="btn-secondary" id="pv-ver-soporte">Ver soporte</button>` : '<p class="muted">Sin archivo adjunto.</p>'}
      </div>

      ${p.estado === 'Rechazado' && p.motivo_rechazo ? `<div class="modal-section"><h3 class="modal-section-title">Motivo de rechazo</h3><p class="prose-p">${p.motivo_rechazo}</p></div>` : ''}
      ${p.estado === 'Aprobado' ? `<div class="modal-section"><p class="muted">Aprobado por ${p.aprobado_por || '—'} el ${formatFechaHoraPV(p.aprobado_en)}.</p></div>` : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">Acciones</h3>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center">${acciones}</div>
      </div>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('pv-ver-soporte', () => this._verSoporte(p));
    on('pv-aprobar', () => this._aprobar(p.id));
    on('pv-rechazar', () => this._rechazar(p.id));
    on('pv-volver-pendiente', () => this._cambiarEstado(p.id, 'Pendiente'));
  },

  async _verSoporte(p) {
    try {
      const url = await DB.getSignedUrl('permisos-soportes', p.soporte_url);
      const ext = (p.soporte_url.split('.').pop() || '').toLowerCase();
      const esImagen = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      const esPdf = ext === 'pdf';
      const visor = esImagen
        ? `<img src="${url}" alt="Soporte" style="max-width:100%;display:block;margin:0 auto;border-radius:var(--radius-sm)">`
        : esPdf
          ? `<iframe src="${url}" title="Soporte" style="width:100%;height:70vh;border:1px solid var(--slate-200);border-radius:var(--radius-sm)"></iframe>`
          : `<p class="muted">No se puede previsualizar este tipo de archivo — ábrelo en una pestaña nueva.</p>`;
      document.getElementById('modal-body').innerHTML = `
        <div class="modal-header"><span class="modal-header-fecha">Soporte adjunto</span></div>
        <div class="modal-section">${visor}</div>
        <div class="modal-section" style="text-align:right"><a href="${url}" target="_blank" rel="noopener" class="btn-secondary">Abrir en pestaña nueva ↗</a></div>
      `;
      document.getElementById('modal-box').classList.add('modal-wide');
      document.getElementById('modal-backdrop').classList.remove('hidden');
    } catch (err) {
      alert('No se pudo abrir el archivo: ' + err.message);
    }
  },

  async _cambiarEstado(id, estado, extra = {}) {
    Loading.show('Guardando…');
    try {
      const { data: sessionData } = await window.supabaseClient.auth.getSession();
      await DB.updatePermisoEstado(id, estado, { ...extra, aprobadoPor: sessionData.session.user.email });
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
    } catch (err) {
      alert('No se pudo guardar: ' + err.message);
    } finally {
      Loading.hide();
    }
  },

  _aprobar(id) {
    if (!confirm('¿Aprobar esta solicitud?')) return;
    this._cambiarEstado(id, 'Aprobado');
  },

  _rechazar(id) {
    const motivo = prompt('Motivo del rechazo (se lo puede ver el empleado):');
    if (motivo === null) return;
    this._cambiarEstado(id, 'Rechazado', { motivoRechazo: motivo.trim() || null });
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('pv-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const employeeId = document.getElementById('pv-empleado-id').value;
    const tipoPermiso = document.getElementById('pv-tipo').value;
    const inicioVal = document.getElementById('pv-inicio').value;
    const finVal = document.getElementById('pv-fin').value;
    const motivo = document.getElementById('pv-motivo').value.trim() || null;
    const requiereReposicion = document.getElementById('pv-reposicion').value === 'si';
    const reemplazoEmployeeId = document.getElementById('pv-reemplazo-id').value || null;
    const soporteFile = document.getElementById('pv-soporte-input').files[0] || null;

    if (!employeeId) {
      msg.textContent = 'Selecciona el empleado.';
      msg.className = 'form-msg error';
      return;
    }
    if (!tipoPermiso || !inicioVal || !finVal) {
      msg.textContent = 'Tipo de permiso y fechas son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }
    if (requiereReposicion && !reemplazoEmployeeId) {
      msg.textContent = 'Selecciona quién lo reemplaza.';
      msg.className = 'form-msg error';
      return;
    }
    const fechaHoraInicio = new Date(inicioVal).toISOString();
    const fechaHoraFin = new Date(finVal).toISOString();
    if (fechaHoraFin <= fechaHoraInicio) {
      msg.textContent = 'La fecha de fin debe ser posterior a la de inicio.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Guardando…');
    try {
      await DB.createPermiso({ employeeId, tipoPermiso, fechaHoraInicio, fechaHoraFin, motivo, requiereReposicion, reemplazoEmployeeId, soporteFile });
      msg.textContent = 'Permiso registrado correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('pv-form').reset();
      document.getElementById('pv-empleado-id').value = '';
      this._toggleReemplazo();
      this._updateSoporteLabel();
      document.getElementById('pv-registrar-detalle').open = false;
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
