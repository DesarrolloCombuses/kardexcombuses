// Informe técnico disciplinario -- formato FO-GH-06 de Gestión Humana.
//
// Antes se llenaba a mano en Word: se buscaba a la persona en otra parte, se
// copiaban nombre/cédula/área/cargo al encabezado y el archivo quedaba suelto
// en una carpeta. Acá se elige el empleado del buscador, esos cuatro datos
// salen de su ficha, la evidencia se adjunta en el mismo registro y el
// formato imprimible se genera desde la app.
//
// Ver sql/informes_disciplinarios_2026-09-29.sql.

// Sugerencias para "Tipo de novedad" -- el campo es de texto libre a
// propósito: en el Word también lo era, y no hay todavía una lista oficial de
// tipos. El datalist solo empuja a que se escriban igual entre informes (para
// que el filtro sirva), sin bloquear un caso que no esté previsto.
const DIS_TIPOS_NOVEDAD = [
  'Incumplimiento de horario',
  'Ausencia injustificada',
  'Abandono del puesto de trabajo',
  'Incumplimiento de procedimiento',
  'Accidente o siniestro de tránsito',
  'Daño a bienes de la empresa',
  'Trato inadecuado al usuario',
  'Presentación personal / uniforme',
  'Manejo indebido de dinero o recaudo',
  'Consumo de alcohol o sustancias',
];

const DIS_IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

function disFormatFecha(iso) {
  // Por componentes y no new Date(iso): Colombia es UTC-5 y una fecha ISO
  // suelta se interpreta como medianoche UTC, que acá es el día anterior.
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('es-CO');
}

function disEsImagen(nombreOPath) {
  const ext = String(nombreOPath || '').split('.').pop().toLowerCase();
  return DIS_IMG_EXT.includes(ext);
}

// Las vistas no esconden los botones de escritura (ninguna del repo lo hace:
// quien manda es la RLS del servidor). Pero el error crudo de Postgres --
// "new row violates row-level security policy" -- no le dice nada a quien lo
// lee, así que acá se traduce al único motivo real por el que aparece.
function disMensajeError(err) {
  const texto = err?.message || '';
  if (/row-level security|violates row/i.test(texto)) {
    return 'Tu cuenta no tiene permiso para esta acción en Informes disciplinarios. Pídele a Gestión Humana que te lo habilite en Usuarios.';
  }
  return texto || 'Error desconocido.';
}

Router.register('informes-disciplinarios', {
  title: 'Informes disciplinarios',

  // null y no undefined: se manda tal cual como p_id del RPC, y undefined se
  // pierde al serializar el JSON en vez de llegar como "es nuevo".
  _editandoId: null,
  _editandoEmployeeId: null,

  async onEnter() {
    if (!this._bound) {
      document.getElementById('dis-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('dis-archivos-input').addEventListener('change', () => this._sumarArchivosElegidos());
      document.getElementById('dis-cancelar-edicion').addEventListener('click', () => this._salirDeEdicion());
      document.getElementById('dis-search').addEventListener('input', () => this._render());
      document.getElementById('dis-card-pendientes').addEventListener('click', () => {
        document.getElementById('dis-filtro-revision').value = 'pendientes';
        this._render();
      });
      ['dis-filtro-revision', 'dis-filtro-tipo', 'dis-filtro-desde', 'dis-filtro-hasta'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('dis-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
      document.getElementById('dis-tipos-novedad').innerHTML =
        DIS_TIPOS_NOVEDAD.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [informes, empleados] = await Promise.all([
      DB.getInformesDisciplinarios(),
      DB.getEmployees({ onlyActive: true }),
    ]);
    this._informes = informes;
    this._empleados = empleados;
    this._setupCombobox();
    this._llenarFiltroTipo();
    this._pintarStats();
    this._prellenarQuienRecibe();
    this._render();
  },

  // El nombre de quien recibe el informe casi siempre es quien lo está
  // registrando -- se propone, pero se deja editable (a veces lo recibe el
  // jefe directo y no quien digita).
  async _prellenarQuienRecibe() {
    const input = document.getElementById('dis-recibe-nombre');
    if (input.value.trim() || input.dataset.prellenado) return;
    try {
      const nombre = await DB.getMyDisplayName();
      this._miNombre = nombre || null;
      if (nombre && !input.value.trim()) {
        input.value = nombre;
        input.dataset.prellenado = '1';
      }
    } catch {
      // Sin nombre de sesión el campo se queda vacío: es opcional.
    }
  },

  // ---- Buscador de empleado ---------------------------------------------

  _setupCombobox() {
    const search = document.getElementById('dis-empleado-input');
    const hidden = document.getElementById('dis-empleado-id');
    const list = document.getElementById('dis-empleado-list');
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
        list.innerHTML = visibles
          .map((e) => `<li data-id="${e.id}">${escapeHtml(e.nombre)} <span class="combobox-cedula">· CC ${escapeHtml(e.cedula)}</span></li>`)
          .join('');
        if (matches.length > visibles.length) {
          list.innerHTML += `<li class="combobox-empty">Y ${matches.length - visibles.length} más… sigue escribiendo para acotar.</li>`;
        }
      }
      list.classList.remove('hidden');
    };

    if (search.dataset.comboboxBound) return;
    search.dataset.comboboxBound = '1';

    search.addEventListener('focus', () => { search.select(); renderLista(search.value); });
    search.addEventListener('input', () => {
      hidden.value = '';
      this._pintarDatosEmpleado(null);
      renderLista(search.value);
    });
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
      this._pintarDatosEmpleado(empleado);
    });
  },

  // El punto 1 del formato (Datos del caso) no se digita: se muestra tal como
  // está en la ficha, para que quien llena el informe vea con qué datos va a
  // quedar el documento antes de guardarlo.
  _pintarDatosEmpleado(empleado) {
    const caja = document.getElementById('dis-datos-empleado');
    if (!empleado) {
      caja.classList.add('hidden');
      caja.innerHTML = '';
      return;
    }
    const falta = [];
    if (!empleado.area) falta.push('área');
    if (!empleado.cargo) falta.push('cargo');
    caja.innerHTML = `
      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(empleado.nombre)}</div><div class="detalle-fact-label">Nombre</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(empleado.cedula)}</div><div class="detalle-fact-label">Cédula</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(empleado.area || '—')}</div><div class="detalle-fact-label">Área</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(empleado.cargo || '—')}</div><div class="detalle-fact-label">Cargo</div></div>
      </div>
      ${falta.length
        ? `<p class="form-msg error" style="margin:0.4rem 0 0">A esta persona le falta ${falta.join(' y ')} en su ficha de Empleados — el informe va a salir con ese espacio vacío. Complétalo allá antes de imprimirlo.</p>`
        : ''}
    `;
    caja.classList.remove('hidden');
  },

  // ---- KPIs y filtros ---------------------------------------------------

  _pintarStats() {
    const informes = this._informes || [];
    const mesActual = new Date().toISOString().slice(0, 7);
    const porEmpleado = new Map();
    informes.forEach((i) => porEmpleado.set(i.employee_id, (porEmpleado.get(i.employee_id) || 0) + 1));

    document.getElementById('dis-stat-total').textContent = informes.length;
    document.getElementById('dis-stat-mes').textContent =
      informes.filter((i) => (i.fecha_hechos || '').slice(0, 7) === mesActual).length;
    document.getElementById('dis-stat-empleados').textContent = porEmpleado.size;
    document.getElementById('dis-stat-reincidentes').textContent =
      [...porEmpleado.values()].filter((n) => n >= 2).length;
    document.getElementById('dis-stat-pendientes').textContent =
      informes.filter((i) => !i.revisado_en).length;
  },

  // Los tipos del filtro salen de lo que realmente hay registrado, no de
  // DIS_TIPOS_NOVEDAD -- si alguien escribió un tipo que no estaba en las
  // sugerencias, igual tiene que poder filtrarlo.
  _llenarFiltroTipo() {
    const select = document.getElementById('dis-filtro-tipo');
    const anterior = select.value;
    const tipos = [...new Set((this._informes || []).map((i) => i.tipo_novedad).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todos los tipos</option>' +
      tipos.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (tipos.includes(anterior)) select.value = anterior;
  },

  _limpiarFiltros() {
    document.getElementById('dis-filtro-revision').value = '';
    document.getElementById('dis-search').value = '';
    document.getElementById('dis-filtro-tipo').value = '';
    document.getElementById('dis-filtro-desde').value = '';
    document.getElementById('dis-filtro-hasta').value = '';
    this._render();
  },

  _iniciales(nombre) {
    const partes = (nombre || '').trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
  },

  _render() {
    const q = document.getElementById('dis-search').value.trim().toLowerCase();
    const tipo = document.getElementById('dis-filtro-tipo').value;
    const desde = document.getElementById('dis-filtro-desde').value;
    const hasta = document.getElementById('dis-filtro-hasta').value;

    const revision = document.getElementById('dis-filtro-revision').value;

    let filtrados = this._informes || [];
    if (revision === 'pendientes') filtrados = filtrados.filter((i) => !i.revisado_en);
    else if (revision === 'revisados') filtrados = filtrados.filter((i) => i.revisado_en);
    if (tipo) filtrados = filtrados.filter((i) => i.tipo_novedad === tipo);
    if (desde) filtrados = filtrados.filter((i) => (i.fecha_hechos || '') >= desde);
    if (hasta) filtrados = filtrados.filter((i) => (i.fecha_hechos || '') <= hasta);
    if (q) {
      filtrados = filtrados.filter((i) =>
        (i.empleado_nombre || '').toLowerCase().includes(q) ||
        (i.empleado_cedula || '').includes(q) ||
        (i.tipo_novedad || '').toLowerCase().includes(q));
    }

    // Lo que falta por revisar va arriba, sin importar la fecha: esta
    // pantalla existe para atender lo que llegó, no para consultar historia.
    filtrados = filtrados.slice().sort((a, b) => {
      const pa = a.revisado_en ? 1 : 0;
      const pb = b.revisado_en ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return String(b.fecha_hechos || '').localeCompare(String(a.fecha_hechos || ''));
    });

    const total = (this._informes || []).length;
    document.getElementById('dis-contador').textContent =
      filtrados.length === total ? `${total} informe(s)` : `Mostrando ${filtrados.length} de ${total} informe(s)`;

    const lista = document.getElementById('dis-lista');
    if (filtrados.length === 0) {
      lista.innerHTML = total === 0
        ? '<p class="empty-note">Todavía no hay informes registrados.</p>'
        : '<p class="empty-note">Sin resultados con estos filtros.</p>';
      return;
    }

    // Cuántos informes lleva cada persona -- se muestra en la fila porque es
    // el dato que hace que valga la pena tener esto en el sistema y no en
    // archivos de Word sueltos.
    const conteo = new Map();
    (this._informes || []).forEach((i) => conteo.set(i.employee_id, (conteo.get(i.employee_id) || 0) + 1));

    lista.innerHTML = filtrados.map((i) => {
      const n = conteo.get(i.employee_id) || 1;
      const adjuntos = (i.archivos || []).length;
      const meta = [
        `Hechos: ${disFormatFecha(i.fecha_hechos)}`,
        i.lugar_hechos ? escapeHtml(i.lugar_hechos) : null,
        adjuntos ? `${adjuntos} archivo(s)` : null,
      ].filter(Boolean).join(' · ');
      return `
        <div class="person-row">
          <span class="person-avatar">${this._iniciales(i.empleado_nombre)}</span>
          <div class="person-info">
            <div class="person-name">${escapeHtml(i.empleado_nombre)} — ${escapeHtml(i.tipo_novedad || 'Sin tipo')}</div>
            <div class="person-meta"><span>${meta}</span></div>
          </div>
          ${n >= 2 ? `<span class="tag pendiente">${n} informes</span>` : ''}
          <span class="tag ${i.revisado_en ? 'completo' : 'descartado'}">${i.revisado_en ? 'Revisado' : 'Sin revisar'}</span>
          <button type="button" class="btn-secondary" data-detalle="${i.id}">Ver detalle</button>
        </div>
      `;
    }).join('');

    lista.querySelectorAll('[data-detalle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const informe = this._informes.find((x) => x.id === btn.dataset.detalle);
        if (informe) this._verDetalle(informe);
      });
    });
  },

  // ---- Detalle ----------------------------------------------------------

  _verDetalle(informe) {
    const archivos = informe.archivos || [];
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <span class="person-avatar detalle-avatar">${this._iniciales(informe.empleado_nombre)}</span>
        <div class="detalle-header-info">
          <div class="detalle-nombre">${escapeHtml(informe.empleado_nombre)}</div>
          <div class="detalle-sub">CC ${escapeHtml(informe.empleado_cedula)} · ${escapeHtml(informe.empleado_cargo || 'Sin cargo')} · ${escapeHtml(informe.empleado_area || 'Sin área')}</div>
        </div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(informe.tipo_novedad || '—')}</div><div class="detalle-fact-label">Tipo de novedad</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${disFormatFecha(informe.fecha_hechos)}</div><div class="detalle-fact-label">Fecha de los hechos</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${disFormatFecha(informe.fecha_entrega)}</div><div class="detalle-fact-label">Fecha de entrega</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${escapeHtml(informe.lugar_hechos || '—')}</div><div class="detalle-fact-label">Lugar</div></div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Descripción de los hechos</h3>
        <p class="prose-p" style="white-space:pre-wrap">${escapeHtml(informe.descripcion_hechos)}</p>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Evidencia</h3>
        ${informe.evidencia ? `<p class="prose-p" style="white-space:pre-wrap">${escapeHtml(informe.evidencia)}</p>` : '<p class="muted">Sin descripción de evidencia.</p>'}
        ${archivos.length
          ? `<div class="detalle-list" id="dis-archivos-detalle">${archivos.map((a) => `
              <div class="detalle-list-item">
                <span class="lc-item-texto">${escapeHtml(a.archivo_nombre || a.archivo_url)}</span>
                <button type="button" class="btn-secondary" data-archivo="${a.archivo_url}" data-nombre="${escapeHtml(a.archivo_nombre || '')}">Ver</button>
              </div>`).join('')}</div>`
          : '<p class="muted">Sin archivos adjuntos.</p>'}

        <label class="file-picker" for="dis-sumar-input" style="margin-top:0.6rem">
          <svg viewBox="0 0 20 20" fill="none"><path d="M3.5 14.5V5.5a1 1 0 011-1h11a1 1 0 011 1v9a1 1 0 01-1 1h-11a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.5"/><path d="M10 7.5v5M7.5 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Agregar más fotos
        </label>
        <input type="file" id="dis-sumar-input" accept=".pdf,image/*" multiple class="hidden" />
        <p id="dis-sumar-msg" class="form-msg"></p>
      </div>

      ${informe.observaciones
        ? `<div class="modal-section"><h3 class="modal-section-title">Observaciones y/o compromisos</h3><p class="prose-p" style="white-space:pre-wrap">${escapeHtml(informe.observaciones)}</p></div>`
        : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">Firmas</h3>
        <p class="prose-p">Recibe: ${escapeHtml(informe.recibe_nombre || '—')}${informe.recibe_cargo ? ` (${escapeHtml(informe.recibe_cargo)})` : ''}</p>
        <p class="muted">Registrado por ${escapeHtml(informe.creado_por_nombre || informe.creado_por_email)} el ${new Date(informe.created_at).toLocaleString('es-CO')}.</p>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Revisión</h3>
        ${informe.revisado_en
          ? `<p class="prose-p">Revisado por ${escapeHtml(informe.revisado_por_nombre || informe.revisado_por_email || 'alguien')} el ${new Date(informe.revisado_en).toLocaleString('es-CO')}.</p>`
          : '<p class="prose-p">Este informe todavía no se ha revisado.</p>'}
        <button type="button" class="btn-secondary" id="dis-revisar">
          ${informe.revisado_en ? 'Devolver a sin revisar' : 'Marcar como revisado'}
        </button>
        <p id="dis-revisar-msg" class="form-msg"></p>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Acciones</h3>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center">
          <button type="button" id="dis-generar">Generar formato FO-GH-06</button>
          <button type="button" class="btn-secondary" id="dis-editar">Editar</button>
          <button type="button" class="btn-secondary" id="dis-borrar" style="color:var(--danger-text)">Eliminar</button>
        </div>
        <p id="dis-detalle-msg" class="form-msg"></p>
      </div>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('dis-revisar').addEventListener('click', () => this._marcarRevisado(informe));
    document.getElementById('dis-generar').addEventListener('click', () => this._generarDocumento(informe));
    document.getElementById('dis-editar').addEventListener('click', () => this._editar(informe));
    document.getElementById('dis-borrar').addEventListener('click', () => this._borrar(informe));
    document.querySelectorAll('#dis-archivos-detalle [data-archivo]').forEach((btn) => {
      btn.addEventListener('click', () => this._verArchivo(btn.dataset.archivo, btn.dataset.nombre));
    });
    document.getElementById('dis-sumar-input')
      .addEventListener('change', (e) => this._sumarEvidencia(informe, e));
  },

  // Adjuntar evidencia a un informe que ya existe. Antes tocaba entrar a
  // "Editar" -- que ademas abre todo el formulario y deja reescribir los
  // hechos -- solo para sumar una foto que llego despues.
  async _sumarEvidencia(informe, evento) {
    const archivos = [...(evento.target.files || [])];
    evento.target.value = '';
    if (!archivos.length) return;
    const msg = document.getElementById('dis-sumar-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    // Un solo show para toda la operacion: el progreso va por setMessage,
    // porque show() lleva contador y uno por archivo deja el overlay
    // tapando la pantalla con la subida ya terminada.
    Loading.show(`Subiendo 1 de ${archivos.length}…`);
    let texto = '';
    let clase = 'form-msg success';
    try {
      const agregados = await DB.agregarArchivosInformeDisciplinario({
        informeId: informe.id,
        employeeId: informe.employee_id,
        archivos,
      });
      texto = `${agregados} archivo(s) agregado(s).`;
    } catch (err) {
      const pasaron = err && typeof err.agregados === 'number' ? err.agregados : 0;
      texto = pasaron
        ? `Se agregaron ${pasaron} de ${archivos.length}. El siguiente falló: ${disMensajeError(err)}`
        : disMensajeError(err);
      clase = 'form-msg error';
    } finally {
      Loading.hide();
    }

    // Se repinta pase lo que pase: si la tercera fallo, las dos que si
    // entraron tienen que verse en la lista. Repintar borra el modal y con
    // el su mensaje, asi que el texto se pone sobre el modal nuevo.
    try {
      await this._load();
      const actualizado = (this._informes || []).find((i) => i.id === informe.id);
      this._verDetalle(actualizado || informe);
    } catch { /* si la recarga falla, queda el modal viejo y su mensaje */ }

    const destino = document.getElementById('dis-sumar-msg') || msg;
    destino.textContent = texto;
    destino.className = clase;
  },

  // Marcar como revisado es lo que apaga el contador del menú. Se vuelve a
  // cargar la lista y se repinta el globo: si el número siguiera ahí después
  // de revisar el último, nadie volvería a creerle.
  async _marcarRevisado(informe) {
    const msg = document.getElementById('dis-revisar-msg');
    const btn = document.getElementById('dis-revisar');
    btn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = '';
    try {
      const nombre = await DB.getMyDisplayName().catch(() => null);
      await DB.marcarInformeRevisado(informe.id, !informe.revisado_en, nombre);
      await this._load();
      if (window.actualizarPendientesInformes) await window.actualizarPendientesInformes();
      const actualizado = (this._informes || []).find((x) => x.id === informe.id);
      if (actualizado) this._verDetalle(actualizado);
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = 'No se pudo marcar: ' + disMensajeError(err);
      btn.disabled = false;
    }
  },

  async _verArchivo(path, nombre) {
    try {
      const url = await DB.getSignedUrl('informes-disciplinarios', path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert(`No se pudo abrir ${nombre || 'el archivo'}: ${disMensajeError(err)}`);
    }
  },

  async _borrar(informe) {
    if (!confirm(`¿Eliminar el informe de ${informe.empleado_nombre} del ${disFormatFecha(informe.fecha_hechos)}? No se puede deshacer.`)) return;
    const msg = document.getElementById('dis-detalle-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    Loading.show('Eliminando…');
    try {
      await DB.borrarInformeDisciplinario(informe.id);
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
      if (window.actualizarPendientesInformes) await window.actualizarPendientesInformes();
    } catch (err) {
      msg.textContent = 'No se pudo eliminar: ' + disMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  // ---- Registrar / editar -----------------------------------------------

  // El input de archivos REEMPLAZA su seleccion cada vez que se usa. En el
  // celular eso se traduce en que tomar una segunda foto borraba la primera
  // -- parecia que el formulario solo admitiera una. Por eso lo elegido se
  // acumula acá y el input se vacia despues de cada escogida, para que la
  // misma foto se pueda volver a elegir si alguien la quito por error.
  _sumarArchivosElegidos() {
    const input = document.getElementById('dis-archivos-input');
    const yaEstan = this._archivosElegidos || [];
    const nuevos = [...input.files].filter((f) => !yaEstan.some(
      (v) => v.name === f.name && v.size === f.size && v.lastModified === f.lastModified));
    this._archivosElegidos = yaEstan.concat(nuevos);
    input.value = '';
    this._pintarArchivosElegidos();
  },

  _archivosParaSubir() {
    const elegidos = [...(this._archivosElegidos || [])];
    const input = document.getElementById('dis-archivos-input');
    [...((input && input.files) || [])].forEach((f) => {
      const repetido = elegidos.some((v) => v.name === f.name && v.size === f.size
        && v.lastModified === f.lastModified);
      if (!repetido) elegidos.push(f);
    });
    return elegidos;
  },

  _quitarArchivoElegido(indice) {
    this._archivosElegidos = (this._archivosElegidos || []).filter((_, i) => i !== indice);
    this._pintarArchivosElegidos();
  },

  _pintarArchivosElegidos() {
    const label = document.getElementById('dis-archivos-label');
    const caja = document.getElementById('dis-archivos-lista');
    const elegidos = this._archivosElegidos || [];
    label.textContent = elegidos.length
      ? 'Agregar otra foto o PDF'
      : 'Adjuntar evidencia (fotos o PDF, varios archivos)';
    if (!caja) return;
    if (!elegidos.length) {
      caja.innerHTML = '';
      return;
    }
    caja.innerHTML = `<div class="detalle-list">${elegidos.map((f, i) => `
      <div class="detalle-list-item">
        <span class="lc-item-texto">${escapeHtml(f.name)}</span>
        <button type="button" class="btn-secondary" data-quitar-elegido="${i}">Quitar</button>
      </div>`).join('')}</div>
      <p class="empty-note">${elegidos.length} archivo(s) por subir.</p>`;
    caja.querySelectorAll('[data-quitar-elegido]').forEach((b) => {
      b.addEventListener('click', () => this._quitarArchivoElegido(Number(b.dataset.quitarElegido)));
    });
  },

  _editar(informe) {
    document.getElementById('modal-backdrop').classList.add('hidden');
    this._editandoId = informe.id;
    this._editandoEmployeeId = informe.employee_id;

    const set = (id, valor) => { document.getElementById(id).value = valor ?? ''; };
    set('dis-empleado-input', `${informe.empleado_nombre} — CC ${informe.empleado_cedula}`);
    set('dis-empleado-id', informe.employee_id);
    set('dis-fecha-hechos', (informe.fecha_hechos || '').slice(0, 10));
    set('dis-fecha-entrega', (informe.fecha_entrega || '').slice(0, 10));
    set('dis-lugar', informe.lugar_hechos);
    set('dis-tipo', informe.tipo_novedad);
    set('dis-descripcion', informe.descripcion_hechos);
    set('dis-evidencia', informe.evidencia);
    set('dis-observaciones', informe.observaciones);
    set('dis-recibe-nombre', informe.recibe_nombre);
    set('dis-recibe-cargo', informe.recibe_cargo);

    // El empleado no se cambia editando: un informe a nombre de otra persona
    // no es una corrección de redacción, es otro informe (la función de la
    // base tampoco reescribe employee_id -- ver el SQL).
    const buscador = document.getElementById('dis-empleado-input');
    buscador.readOnly = true;
    buscador.classList.add('input-bloqueado');
    this._pintarDatosEmpleado({
      nombre: informe.empleado_nombre,
      cedula: informe.empleado_cedula,
      area: informe.empleado_area,
      cargo: informe.empleado_cargo,
    });

    document.getElementById('dis-form-titulo').textContent = 'Editar informe';
    document.getElementById('dis-submit').textContent = 'Guardar cambios';
    document.getElementById('dis-cancelar-edicion').classList.remove('hidden');
    document.getElementById('dis-registrar-detalle').open = true;
    document.getElementById('dis-registrar-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _salirDeEdicion() {
    this._editandoId = null;
    this._editandoEmployeeId = null;
    document.getElementById('dis-form').reset();
    document.getElementById('dis-empleado-id').value = '';
    const buscador = document.getElementById('dis-empleado-input');
    buscador.readOnly = false;
    buscador.classList.remove('input-bloqueado');
    this._pintarDatosEmpleado(null);
    this._archivosElegidos = [];
    this._pintarArchivosElegidos();
    document.getElementById('dis-form-titulo').textContent = 'Registrar informe';
    document.getElementById('dis-submit').textContent = 'Guardar y generar formato';
    document.getElementById('dis-cancelar-edicion').classList.add('hidden');
    document.getElementById('dis-msg').textContent = '';
    document.getElementById('dis-msg').className = 'form-msg';
    document.getElementById('dis-recibe-nombre').dataset.prellenado = '';
    this._prellenarQuienRecibe();
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('dis-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const employeeId = document.getElementById('dis-empleado-id').value;
    const fechaHechos = document.getElementById('dis-fecha-hechos').value;
    const fechaEntrega = document.getElementById('dis-fecha-entrega').value;
    const descripcion = document.getElementById('dis-descripcion').value.trim();
    // Lo acumulado MAS lo que todavia este en el input. Normalmente el
    // input va vacio (se limpia en cada escogida), pero si por lo que sea
    // no paso por ahi, perder en silencio la evidencia de un informe
    // disciplinario es lo peor que podria hacer esta pantalla.
    const archivos = this._archivosParaSubir();

    const fallar = (texto) => {
      msg.textContent = texto;
      msg.className = 'form-msg error';
    };

    if (!employeeId) return fallar('Busca y selecciona al empleado.');
    if (!fechaHechos) return fallar('La fecha de los hechos es obligatoria.');
    if (!descripcion) return fallar('La descripción de los hechos es obligatoria — es el cuerpo del informe.');

    const hoy = new Date().toISOString().slice(0, 10);
    if (fechaHechos > hoy) return fallar('La fecha de los hechos no puede ser futura.');
    // Mismo chequeo que el constraint de la base, pero acá se avisa antes de
    // subir los archivos y con un mensaje que se entiende.
    if (fechaEntrega && fechaEntrega < fechaHechos) {
      return fallar('La fecha de entrega no puede ser anterior a la de los hechos — revisa si se te cambiaron.');
    }

    const empleado = this._empleados.find((emp) => emp.id === employeeId);
    if (!this._editandoId && !empleado) return fallar('El empleado seleccionado ya no está activo. Vuelve a buscarlo.');

    const informe = {
      employee_id: employeeId,
      empleado_nombre: empleado ? empleado.nombre : null,
      empleado_cedula: empleado ? empleado.cedula : null,
      empleado_area: empleado ? empleado.area : null,
      empleado_cargo: empleado ? empleado.cargo : null,
      fecha_hechos: fechaHechos,
      fecha_entrega: fechaEntrega || null,
      lugar_hechos: document.getElementById('dis-lugar').value.trim() || null,
      tipo_novedad: document.getElementById('dis-tipo').value.trim() || null,
      descripcion_hechos: descripcion,
      evidencia: document.getElementById('dis-evidencia').value.trim() || null,
      observaciones: document.getElementById('dis-observaciones').value.trim() || null,
      recibe_nombre: document.getElementById('dis-recibe-nombre').value.trim() || null,
      recibe_cargo: document.getElementById('dis-recibe-cargo').value.trim() || null,
      // Quién digitó el informe -- no se confunde con "quien recibe", que es
      // un dato del formato y muchas veces es el jefe directo, no quien
      // digita.
      creado_por_nombre: this._miNombre || null,
    };

    const editando = this._editandoId;
    const submitBtn = document.getElementById('dis-submit');
    submitBtn.disabled = true;
    Loading.show(archivos.length ? 'Subiendo evidencia…' : 'Guardando…');
    try {
      const id = await DB.guardarInformeDisciplinario({
        informe: { ...informe, employee_id: editando ? this._editandoEmployeeId : employeeId },
        archivos,
        id: editando,
      });
      this._salirDeEdicion();
      document.getElementById('dis-registrar-detalle').open = false;
      await this._load();
      if (window.actualizarPendientesInformes) await window.actualizarPendientesInformes();
      msg.textContent = editando ? 'Informe actualizado.' : 'Informe guardado.';
      msg.className = 'form-msg success';
      // Al crearlo se abre el formato de una: el informe existe para
      // imprimirlo y firmarlo, no para quedarse en la base.
      const guardado = (this._informes || []).find((i) => i.id === id);
      if (guardado && !editando) this._generarDocumento(guardado);
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + disMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },

  // ---- Formato imprimible FO-GH-06 --------------------------------------

  // Réplica del Word de Gestión Humana. Dos diferencias a propósito con el
  // original: el título del encabezado va una sola vez (en el .docx quedó
  // duplicado por un accidente de edición), y la numeración de los puntos se
  // deja tal cual -- salta del 4 al 6, sin punto 5, porque así está el
  // formato controlado y alguien puede estar citando "el punto 6" por fuera.
  async _generarDocumento(informe) {
    // La ventana hay que abrirla en el mismo tick del clic: después de un
    // await el navegador la trata como popup no pedido y la bloquea.
    const ventana = window.open('', '_blank');
    if (!ventana) {
      alert('El navegador bloqueó la ventana emergente. Habilítala para este sitio e intenta de nuevo.');
      return;
    }
    ventana.document.write('<p style="font-family:Arial,Helvetica,sans-serif;padding:2rem;color:#445">Generando informe…</p>');

    // Las fotos se incrustan en el documento (no solo su nombre): la
    // evidencia es media razón de ser del informe, y un PDF que diga "ver
    // foto adjunta" sin la foto no sirve de nada al entregarlo.
    //
    // Van como data URI y NO como enlace al bucket. El enlace firmado expira
    // en una hora -- el documento se quedaba sin fotos al reabrirlo -- y
    // html2canvas, que es quien dibuja la hoja para el PDF, deja en blanco
    // la imagen que viene de otro dominio: el PDF salía con el texto y sin
    // la evidencia. Ver imagenComoDataUri en js/documento-imprimible.js.
    const adjuntos = informe.archivos || [];
    const imagenes = [];
    const otros = [];
    const fallaron = [];
    const paraIncrustar = adjuntos.filter((a) => disEsImagen(a.archivo_nombre || a.archivo_url));
    let hechas = 0;
    Loading.show(paraIncrustar.length ? `Preparando evidencia… 1 de ${paraIncrustar.length}` : 'Generando informe…');
    try {
      for (const a of adjuntos) {
        if (!disEsImagen(a.archivo_nombre || a.archivo_url)) {
          otros.push(a);
          continue;
        }
        Loading.setMessage(`Preparando evidencia… ${hechas + 1} de ${paraIncrustar.length}`);
        try {
          const url = await DB.getSignedUrl('informes-disciplinarios', a.archivo_url);
          imagenes.push({ src: await imagenComoDataUri(url), nombre: a.archivo_nombre });
        } catch {
          // Una foto que no se pudo leer no bota el informe: se nombra
          // entre los anexos y el documento sale con las demás.
          otros.push(a);
          fallaron.push(a.archivo_nombre || a.archivo_url);
        }
        hechas += 1;
      }
    } finally {
      Loading.hide();
    }

    const caja = (texto) => `<div class="caja">${texto ? escapeHtml(texto) : ''}</div>`;

    const evidenciaHtml = `
      <div class="caja">
        ${informe.evidencia ? escapeHtml(informe.evidencia) : ''}
        ${imagenes.length ? `<div class="evidencias">${imagenes.map((i) => `
          <figure>
            <img src="${i.src}" alt="Evidencia" />
            ${i.nombre ? `<figcaption>${escapeHtml(i.nombre)}</figcaption>` : ''}
          </figure>`).join('')}</div>` : ''}
        ${otros.length ? `<p class="otros-adjuntos"><b>Otros anexos:</b> ${otros.map((a) => escapeHtml(a.archivo_nombre || a.archivo_url)).join(', ')}</p>` : ''}
        ${fallaron.length ? `<p class="otros-adjuntos"><b>Sin incrustar:</b> ${fallaron.map((n) => escapeHtml(n)).join(', ')} — abre el informe en el ERP para verlas.</p>` : ''}
      </div>`;

    const cuerpoHtml = `
  <table>
    <tr class="doc-header">
      <td class="brand-cell">
        <div class="brand">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8.5" stroke="#1c4fa0" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(-15 12 12)"/>
            <circle cx="12" cy="12" r="8.5" stroke="#2fa84f" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(105 12 12)"/>
            <circle cx="12" cy="12" r="8.5" stroke="#f2941d" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(225 12 12)"/>
          </svg>
          COMBUSES
        </div>
      </td>
      <td class="title-cell">FORMATO INFORME TÉCNICO DISCIPLINARIO</td>
      <td class="meta-cell">
        <b>Código:</b> FO-GH-06<br>
        <b>Versión:</b> 1<br>
        <b>Fecha:</b> 09/02/2026
      </td>
    </tr>
  </table>

  <h2 class="punto">1. DATOS DEL CASO</h2>
  <table class="datos">
    <tr>
      <td class="label-cell">Fecha de Entrega</td><td class="value-cell">${disFormatFecha(informe.fecha_entrega)}</td>
      <td class="label-cell">Fecha de los hechos</td><td class="value-cell">${disFormatFecha(informe.fecha_hechos)}</td>
    </tr>
    <tr>
      <td class="label-cell">Lugar de los hechos</td><td class="value-cell">${escapeHtml(informe.lugar_hechos || '')}</td>
      <td class="label-cell">Tipo de novedad</td><td class="value-cell">${escapeHtml(informe.tipo_novedad || '')}</td>
    </tr>
    <tr>
      <td class="label-cell">Nombre</td><td class="value-cell">${escapeHtml(informe.empleado_nombre)}</td>
      <td class="label-cell">Cédula</td><td class="value-cell">${escapeHtml(informe.empleado_cedula)}</td>
    </tr>
    <tr>
      <td class="label-cell">Área</td><td class="value-cell">${escapeHtml(informe.empleado_area || '')}</td>
      <td class="label-cell">Cargo</td><td class="value-cell">${escapeHtml(informe.empleado_cargo || '')}</td>
    </tr>
  </table>

  <h2 class="punto">2. DESCRIPCIÓN DE LOS HECHOS</h2>
  ${caja(informe.descripcion_hechos)}

  <h2 class="punto">3. EVIDENCIA</h2>
  ${evidenciaHtml}

  <h2 class="punto">4. OBSERVACIONES Y/O COMPROMISOS</h2>
  ${caja(informe.observaciones)}

  <h2 class="punto">6. FIRMAS</h2>
  <table class="firmas">
    <tr>
      <th>Firma del colaborador</th>
      <th>Firma de quien recibe</th>
    </tr>
    <tr class="espacio-firma"><td></td><td></td></tr>
    <tr>
      <td>
        Nombre: ${escapeHtml(informe.empleado_nombre)}<br><br>
        Cédula: ${escapeHtml(informe.empleado_cedula)}
      </td>
      <td>
        Nombre: ${escapeHtml(informe.recibe_nombre || '______________________________')}<br><br>
        Cargo: ${escapeHtml(informe.recibe_cargo || '_______________________________')}
      </td>
    </tr>
  </table>
`;

    const estilos = `
  .page { padding: 28px 32px; font-size: 12.5px; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; }
  .doc-header td { border: 1.6px solid #000; padding: 10px 12px; vertical-align: middle; }
  .doc-header .brand-cell { width: 24%; }
  .doc-header .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 17px; color: #0a1930; }
  .doc-header .brand svg { flex: none; }
  .doc-header .title-cell { text-align: center; font-weight: 800; font-size: 14px; letter-spacing: 0.02em; }
  .doc-header .meta-cell { width: 22%; font-size: 11.5px; line-height: 1.5; }
  .punto { font-size: 12.5px; font-weight: 800; margin: 20px 0 6px; letter-spacing: 0.02em; }
  .datos td { border: 1px solid #000; padding: 7px 9px; }
  .datos .label-cell { width: 18%; font-weight: 700; background: #f3f4f6; }
  .datos .value-cell { width: 32%; }
  .caja { border: 1px solid #000; padding: 10px 12px; min-height: 96px; white-space: pre-wrap; }
  .evidencias { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  /* break-inside: una foto cortada por la mitad entre dos hojas no sirve
     como evidencia. Con varias fotos el PDF las baja enteras a la hoja
     siguiente en vez de partirlas. */
  .evidencias figure { margin: 0; width: 46%; break-inside: avoid; page-break-inside: avoid; }
  .evidencias img { width: 100%; border: 1px solid #94a3b8; display: block; }
  .evidencias figcaption { font-size: 10.5px; color: #334; margin-top: 3px; word-break: break-all; }
  .otros-adjuntos { margin: 10px 0 0; font-size: 11.5px; }
  .firmas td, .firmas th { border: 1px solid #000; padding: 8px 10px; width: 50%; vertical-align: top; }
  .firmas th { background: #f3f4f6; font-weight: 700; text-align: center; }
  .firmas .espacio-firma td { height: 78px; }
`;

    const html = paginaImprimible({
      titulo: `Informe disciplinario — ${informe.empleado_nombre}`,
      estilos,
      cuerpoHtml,
      archivo: `informe-disciplinario-${slugArchivo(informe.empleado_nombre)}-${(informe.fecha_hechos || '').slice(0, 10)}.pdf`,
    });

    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
  },
});
