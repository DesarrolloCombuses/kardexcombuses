// Registro y creación de actividades: una actividad (ej. "Entrega de
// entradas Comfama - Diciembre") agrupa muchos registros individuales de
// quién recibió algo -- cada registro deja firma y foto del receptor, y
// queda relacionado a la ficha del empleado (no se escribe a mano, se busca
// y selecciona, mismo combobox de Salida). Reutiliza SignaturePad y
// CameraCapture dentro del modal compartido, mismo patrón que
// empleados.js:_abrirFirma()/_abrirModal() -- se inicializan justo después
// de inyectar el HTML del modal, cuando el canvas ya tiene tamaño real.

function acEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function acFormatFecha(fechaIso) {
  if (!fechaIso) return '—';
  const m = String(fechaIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fechaIso;
  const [, yyyy, mm, dd] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).toLocaleDateString('es-CO');
}

Router.register('actividades', {
  title: 'Actividades',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('ac-form').addEventListener('submit', (e) => this._crear(e));
      this._bound = true;
    }
    document.getElementById('ac-fecha').value = document.getElementById('ac-fecha').value || new Date().toISOString().slice(0, 10);
    this._empleados = await DB.getEmployees({ onlyActive: true });
    await this._load();
  },

  async _load() {
    this._actividades = await DB.getActividades();
    this._render();
  },

  _render() {
    const lista = document.getElementById('ac-lista');
    document.getElementById('ac-contador').textContent = this._actividades.length
      ? `${this._actividades.length} actividad(es)`
      : 'Todavía no se ha creado ninguna actividad.';
    lista.innerHTML = this._actividades.map((a) => `
      <div class="person-row">
        <div class="person-info">
          <div class="person-name">${acEscapeHtml(a.nombre)}</div>
          <div class="person-meta">
            <span>${acFormatFecha(a.fecha)}</span>
            <span>Creada por ${acEscapeHtml(a.creado_por_nombre || a.creado_por_email)}</span>
          </div>
        </div>
        <button type="button" class="btn-secondary" data-abrir="${a.id}">Abrir</button>
      </div>
    `).join('');
    lista.querySelectorAll('[data-abrir]').forEach((btn) => {
      btn.addEventListener('click', () => this._abrirActividad(this._actividades.find((a) => a.id === btn.dataset.abrir)));
    });
  },

  async _crear(e) {
    e.preventDefault();
    const msg = document.getElementById('ac-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const nombre = document.getElementById('ac-nombre').value.trim();
    const descripcion = document.getElementById('ac-descripcion').value.trim();
    const fecha = document.getElementById('ac-fecha').value;
    if (!nombre || !fecha) {
      msg.textContent = 'Nombre y fecha son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Creando…');
    try {
      const actividad = await DB.crearActividad({ nombre, descripcion, fecha });
      document.getElementById('ac-form').reset();
      document.getElementById('ac-fecha').value = new Date().toISOString().slice(0, 10);
      await this._load();
      this._abrirActividad(actividad);
    } catch (err) {
      msg.textContent = 'No se pudo crear: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },

  async _abrirActividad(actividad) {
    this._actividadAbierta = actividad;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${acEscapeHtml(actividad.nombre)}</div>
          <div class="detalle-sub">${acFormatFecha(actividad.fecha)}${actividad.descripcion ? ' — ' + acEscapeHtml(actividad.descripcion) : ''}</div>
        </div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Registrar entrega</h3>
        <form id="ac-registro-form" class="form">
          <label>Empleado que recibe
            <div class="combobox" id="ac-empleado-combobox">
              <input type="text" id="ac-empleado-search" autocomplete="off" placeholder="Buscar por nombre o cédula…" />
              <input type="hidden" id="ac-empleado-id" />
              <ul class="combobox-list hidden" id="ac-empleado-list"></ul>
            </div>
          </label>
          <label>Detalle (opcional)<input type="text" id="ac-detalle" placeholder="Ej. 2 entradas" /></label>

          <h4 class="modal-section-title">Firma de quien recibe</h4>
          <canvas id="ac-firma-canvas" class="signature-canvas"></canvas>
          <button type="button" id="ac-firma-limpiar" class="btn-secondary">Limpiar firma</button>

          <h4 class="modal-section-title" style="margin-top:1rem">Foto de quien recibe</h4>
          <label class="file-picker" for="ac-foto-input">
            <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
            Tomar / adjuntar foto
          </label>
          <input type="file" id="ac-foto-input" accept="image/*" capture="environment" class="hidden" />
          <img id="ac-foto-preview" class="photo-preview hidden" alt="Foto de quien recibe" />

          <div style="margin-top:0.9rem">
            <button type="submit">Registrar</button>
            <p id="ac-registro-msg" class="form-msg"></p>
          </div>
        </form>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Ya registrados</h3>
        <p class="empty-note" id="ac-registros-contador"></p>
        <div id="ac-registros-lista" class="person-list"></div>
      </div>
    `;

    this._acFirma = new SignaturePad(document.getElementById('ac-firma-canvas'));
    document.getElementById('ac-firma-limpiar').addEventListener('click', () => this._acFirma.clear());
    this._acCamera = new CameraCapture({
      inputEl: document.getElementById('ac-foto-input'),
      previewEl: document.getElementById('ac-foto-preview'),
    });

    this._setupEmpleadoCombobox();
    document.getElementById('ac-registro-form').addEventListener('submit', (e) => this._registrar(e));

    await this._cargarRegistros();
  },

  _setupEmpleadoCombobox() {
    const search = document.getElementById('ac-empleado-search');
    const hidden = document.getElementById('ac-empleado-id');
    const list = document.getElementById('ac-empleado-list');
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._empleados.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q))
        : this._empleados;
      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `<li data-id="${e.id}">${acEscapeHtml(e.nombre)} <span class="combobox-cedula">· CC ${acEscapeHtml(e.cedula)}</span></li>`).join('');
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
      list.classList.add('hidden');
    });
  },

  async _cargarRegistros() {
    const cont = document.getElementById('ac-registros-contador');
    const lista = document.getElementById('ac-registros-lista');
    cont.textContent = 'Cargando…';
    try {
      const registros = await DB.getRegistrosActividad(this._actividadAbierta.id);
      this._registros = registros;
      cont.textContent = registros.length ? `${registros.length} persona(s) registrada(s)` : 'Todavía nadie registrado.';
      lista.innerHTML = registros.map((r) => `
        <div class="person-row">
          <div class="person-info">
            <div class="person-name">${acEscapeHtml(r.employees?.nombre || 'Empleado')}</div>
            <div class="person-meta">
              <span>CC ${acEscapeHtml(r.employees?.cedula || '—')}</span>
              ${r.detalle ? `<span>${acEscapeHtml(r.detalle)}</span>` : ''}
              <span>${new Date(r.created_at).toLocaleString('es-CO')}</span>
              <span>Registró: ${acEscapeHtml(r.registrado_por_nombre || r.registrado_por_email)}</span>
            </div>
          </div>
          <button type="button" class="btn-secondary" data-ver-evidencia="${r.id}">Ver foto/firma</button>
        </div>
      `).join('');
      lista.querySelectorAll('[data-ver-evidencia]').forEach((btn) => {
        btn.addEventListener('click', () => this._verEvidencia(registros.find((r) => r.id === btn.dataset.verEvidencia)));
      });
    } catch (err) {
      cont.textContent = 'No se pudo cargar el listado: ' + err.message;
      lista.innerHTML = '';
    }
  },

  async _verEvidencia(registro) {
    Loading.show('Cargando…');
    let urlFoto = null;
    let urlFirma = null;
    try {
      [urlFoto, urlFirma] = await Promise.all([
        registro.foto_url ? DB.getSignedUrl('fotos-entrega', registro.foto_url) : Promise.resolve(null),
        registro.firma_url ? DB.getSignedUrl('firmas', registro.firma_url) : Promise.resolve(null),
      ]);
    } catch (err) {
      alert('No se pudo cargar la evidencia: ' + err.message);
      Loading.hide();
      return;
    }
    Loading.hide();

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${acEscapeHtml(registro.employees?.nombre || 'Empleado')} — CC ${acEscapeHtml(registro.employees?.cedula || '—')}</div>
          <div class="detalle-sub">${acEscapeHtml(this._actividadAbierta.nombre)} · ${new Date(registro.created_at).toLocaleString('es-CO')}</div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Foto</h3>
        ${urlFoto ? `<img src="${urlFoto}" style="max-width:100%;border-radius:8px" />` : '<p class="empty-note">Sin foto.</p>'}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Firma</h3>
        ${urlFirma ? `<img src="${urlFirma}" style="max-height:120px;background:#fff;border:1px solid var(--slate-200,#e5e7eb);border-radius:6px;padding:6px" />` : '<p class="empty-note">Sin firma.</p>'}
      </div>
      <div style="margin-top:0.8rem"><button type="button" class="btn-secondary" id="ac-volver-btn">← Volver a la actividad</button></div>
    `;
    document.getElementById('ac-volver-btn').addEventListener('click', () => this._abrirActividad(this._actividadAbierta));
  },

  async _registrar(e) {
    e.preventDefault();
    const msg = document.getElementById('ac-registro-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const employeeId = document.getElementById('ac-empleado-id').value;
    const detalle = document.getElementById('ac-detalle').value.trim();

    if (!employeeId) {
      msg.textContent = 'Busca y selecciona el empleado que recibe.';
      msg.className = 'form-msg error';
      return;
    }
    if (this._acFirma.isEmpty()) {
      msg.textContent = 'Falta la firma de quien recibe.';
      msg.className = 'form-msg error';
      return;
    }
    if (this._acCamera.processing) {
      msg.textContent = 'Espera un momento, la foto se está procesando…';
      msg.className = 'form-msg error';
      return;
    }
    if (!this._acCamera.hasPhoto()) {
      msg.textContent = 'Falta la foto de quien recibe.';
      msg.className = 'form-msg error';
      return;
    }
    // Aviso suave (no bloqueante): puede ser legítimo repetir/corregir un
    // registro, así que se pregunta en vez de impedirlo del todo.
    if (this._registros?.some((r) => r.employee_id === employeeId)) {
      if (!confirm('Esta persona ya está registrada en esta actividad. ¿Registrarla de nuevo de todas formas?')) return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Subiendo firma y foto…');
    try {
      const firmaBlob = await this._acFirma.toBlob();
      if (!firmaBlob) throw new Error('No se pudo capturar la firma, inténtalo de nuevo.');
      const fotoFile = this._acCamera.getFile();
      const [firmaPath, fotoPath] = await Promise.all([
        DB.uploadToBucket('firmas', firmaBlob, 'png'),
        DB.uploadToBucket('fotos-entrega', fotoFile, (fotoFile.name.split('.').pop() || 'jpg')),
      ]);

      Loading.setMessage('Registrando…');
      await DB.registrarActividadPersona({
        actividadId: this._actividadAbierta.id,
        employeeId,
        detalle: detalle || null,
        firmaUrl: firmaPath,
        fotoUrl: fotoPath,
      });

      msg.textContent = 'Registrado correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('ac-registro-form').reset();
      // form.reset() no basta para el <input type="hidden"> -- se limpia a
      // mano para no dejar pegado el employeeId anterior (el buscador de
      // texto sí se limpia, pero registraría de nuevo al mismo empleado sin
      // que se note si alguien solo le da submit otra vez).
      document.getElementById('ac-empleado-id').value = '';
      document.getElementById('ac-empleado-search').value = '';
      this._acFirma.clear();
      this._acCamera.reset();
      await this._cargarRegistros();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo registrar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },
});
