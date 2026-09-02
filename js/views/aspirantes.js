// Áreas administrativas fijas para clasificar la vacante -- se muestran
// siempre como sugerencia (además de las áreas que ya traen los empleados
// activos), porque el campo "área" de Empleados históricamente se usa más
// como cargo ("CONDUCTORES RUTA URBANA", "GESTOR DE SERVICIOS Y EMBARQUE",
// etc.) que como una categoría limpia, y estas 5 no aparecían solas.
const AREAS_VACANTE_FIJAS = ['CONTABILIDAD', 'GERENCIA', 'GESTION Y CONTROL DE FLOTA', 'GESTION HUMANA', 'NOMINA'];

// Esta función recibe tanto fechas puras ("2026-01-01", ej. fecha_salida)
// como timestamps completos (ej. created_at). Ojo con new Date("2026-01-01")
// a secas: lo interpreta como medianoche UTC, que en Colombia (UTC-5)
// muestra el día anterior -- forzar hora local con T00:00:00 evita ese
// corrimiento, pero solo cuando no hay hora ya incluida (ver mismo fix en
// empleados.js para fechas puras).
function formatFechaAspirante(iso) {
  if (!iso) return '—';
  const conHora = iso.includes('T') ? iso : `${iso}T00:00:00`;
  return new Date(conHora).toLocaleDateString('es-CO');
}

function formatFechaHoraAspirante(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

Router.register('aspirantes', {
  title: 'Selección de personal',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('aspirante-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('aspirante-hoja-input').addEventListener('change', () => this._updateHojaLabel());
      ['aspirantes-search', 'aspirantes-filtro-fecha-desde', 'aspirantes-filtro-fecha-hasta'].forEach((id) => {
        document.getElementById(id).addEventListener('input', () => this._render());
      });
      ['aspirantes-filtro-estado', 'aspirantes-filtro-cargo', 'aspirantes-filtro-area'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('aspirantes-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
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
    this._llenarFiltros(aspirantes);
    this._pintarStats(aspirantes);
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
    llenar('aspirante-area-list', [...AREAS_VACANTE_FIJAS, ...empleados.map((e) => e.area)]);
  },

  // Los filtros de Cargo/Área se llenan con lo que realmente aparece entre
  // los aspirantes registrados (no una lista fija), preservando la
  // selección previa si sigue existiendo -- mismo patrón que Empleados.
  _llenarFiltros(aspirantes) {
    const llenarSelect = (id, valores) => {
      const sel = document.getElementById(id);
      const actual = sel.value;
      const opciones = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
      if (opciones.includes(actual)) sel.value = actual;
    };
    llenarSelect('aspirantes-filtro-cargo', aspirantes.map((a) => a.cargo_aspirado));
    llenarSelect('aspirantes-filtro-area', aspirantes.map((a) => a.area_aspirada));
  },

  _limpiarFiltros() {
    document.getElementById('aspirantes-search').value = '';
    document.getElementById('aspirantes-filtro-estado').value = '';
    document.getElementById('aspirantes-filtro-cargo').value = '';
    document.getElementById('aspirantes-filtro-area').value = '';
    document.getElementById('aspirantes-filtro-fecha-desde').value = '';
    document.getElementById('aspirantes-filtro-fecha-hasta').value = '';
    this._render();
  },

  // Tarjetas de resumen arriba de todo -- "Registrados este mes" es la
  // estadística más simple y útil sobre la fecha de registro sin tener que
  // abrir un reporte aparte.
  _pintarStats(aspirantes) {
    const hoy = new Date();
    const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const esteMes = aspirantes.filter((a) => (a.created_at || '').slice(0, 7) === inicioMes).length;
    document.getElementById('aspirantes-stat-proceso').textContent = aspirantes.filter((a) => a.estado === 'En proceso').length;
    document.getElementById('aspirantes-stat-contratados').textContent = aspirantes.filter((a) => a.estado === 'Contratado').length;
    document.getElementById('aspirantes-stat-descartados').textContent = aspirantes.filter((a) => a.estado === 'Descartado').length;
    document.getElementById('aspirantes-stat-mes').textContent = esteMes;
  },

  _iniciales(nombre) {
    const partes = (nombre || '').trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
  },

  _render() {
    const q = document.getElementById('aspirantes-search').value.trim().toLowerCase();
    const estado = document.getElementById('aspirantes-filtro-estado').value;
    const cargo = document.getElementById('aspirantes-filtro-cargo').value;
    const area = document.getElementById('aspirantes-filtro-area').value;
    const fechaDesde = document.getElementById('aspirantes-filtro-fecha-desde').value;
    const fechaHasta = document.getElementById('aspirantes-filtro-fecha-hasta').value;

    let filtrados = this._aspirantes;
    if (estado) filtrados = filtrados.filter((a) => a.estado === estado);
    if (cargo) filtrados = filtrados.filter((a) => a.cargo_aspirado === cargo);
    if (area) filtrados = filtrados.filter((a) => a.area_aspirada === area);
    if (fechaDesde) filtrados = filtrados.filter((a) => (a.created_at || '').slice(0, 10) >= fechaDesde);
    if (fechaHasta) filtrados = filtrados.filter((a) => (a.created_at || '').slice(0, 10) <= fechaHasta);
    if (q) filtrados = filtrados.filter((a) => a.nombre.toLowerCase().includes(q) || (a.cedula || '').includes(q));

    const total = this._aspirantes.length;
    document.getElementById('aspirantes-contador').textContent =
      filtrados.length === total ? `${total} aspirante(s)` : `Mostrando ${filtrados.length} de ${total} aspirante(s)`;

    const lista = document.getElementById('aspirantes-lista');
    if (filtrados.length === 0) {
      lista.innerHTML = '<p class="empty-note">Sin resultados con estos filtros.</p>';
      return;
    }

    lista.innerHTML = filtrados.map((a) => {
      const estadoTag = a.estado === 'Contratado' ? 'completo' : a.estado === 'Descartado' ? 'descartado' : 'pendiente';
      const meta = [
        `CC ${a.cedula}`,
        a.cargo_aspirado || 'Sin cargo',
        a.area_aspirada,
        `Registrado ${formatFechaAspirante(a.created_at)}`,
      ].filter(Boolean).join(' · ');
      return `
        <div class="person-row ${a.estado === 'Descartado' ? 'inactivo' : ''}">
          <span class="person-avatar">${this._iniciales(a.nombre)}</span>
          <div class="person-info">
            <div class="person-name">${a.nombre}</div>
            <div class="person-meta"><span>${meta}</span></div>
          </div>
          <span class="tag ${estadoTag}">${a.estado}</span>
          <button type="button" class="btn-secondary" data-detalle="${a.id}">Ver detalle</button>
        </div>
      `;
    }).join('');

    lista.querySelectorAll('[data-detalle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = this._aspirantes.find((x) => x.id === btn.dataset.detalle);
        if (a) this._verDetalle(a);
      });
    });
  },

  // Ficha completa del aspirante en un modal (mismo patrón que el detalle de
  // Empleados): acá viven todos los datos y todas las acciones posibles
  // según en qué punto del proceso esté, en vez de amontonarlas en la fila.
  _verDetalle(a) {
    const estadoTag = a.estado === 'Contratado' ? 'completo' : a.estado === 'Descartado' ? 'descartado' : 'pendiente';

    let acciones;
    if (a.employee_id) {
      const perfilAprobado = a.employees?.perfil_aprobado_at;
      const perfilBadge = perfilAprobado
        ? `<span class="tag completo" title="Aprobado por ${a.employees.perfil_aprobado_por || '—'}">Perfil aprobado</span>`
        : '<span class="tag pendiente">Perfil pendiente de aprobación</span>';
      const perfilBtn = perfilAprobado
        ? `<button type="button" class="btn-secondary" id="aspirante-quitar-aprobacion">Quitar aprobación</button>`
        : `<button type="button" class="btn-secondary" id="aspirante-aprobar-perfil">Aprobar perfil</button>`;
      acciones = `
        ${perfilBadge}
        <button type="button" class="btn-secondary" id="aspirante-link">Ver link de perfil</button>
        ${perfilBtn}
        <button type="button" class="btn-secondary" id="aspirante-deshacer-seleccion">Deshacer selección</button>
        <button type="button" class="btn-secondary" id="aspirante-descartar" style="color:var(--danger-text)">Descartar</button>
      `;
    } else if (a.estado === 'Descartado') {
      acciones = `<button type="button" class="btn-secondary" id="aspirante-reabrir">Reabrir</button>`;
    } else {
      acciones = `
        <button type="button" class="btn-secondary" id="aspirante-seleccionar">Seleccionar candidato</button>
        <button type="button" class="btn-secondary" id="aspirante-descartar" style="color:var(--danger-text)">Descartar</button>
      `;
    }

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <span class="person-avatar detalle-avatar">${this._iniciales(a.nombre)}</span>
        <div class="detalle-header-info">
          <div class="detalle-nombre">${a.nombre}</div>
          <div class="detalle-sub">CC ${a.cedula}${a.telefono ? ' · ' + a.telefono : ''}</div>
        </div>
        <div class="detalle-tags"><span class="tag ${estadoTag}">${a.estado}</span></div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact">
          <div class="detalle-fact-value">${a.cargo_aspirado || '—'}</div>
          <div class="detalle-fact-label">Cargo al que aspira</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${a.area_aspirada || '—'}</div>
          <div class="detalle-fact-label">Área</div>
        </div>
        <div class="detalle-fact">
          <div class="detalle-fact-value">${formatFechaHoraAspirante(a.created_at)}</div>
          <div class="detalle-fact-label">Fecha de registro</div>
        </div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Hoja de vida</h3>
        ${a.hoja_vida_url
          ? `<button type="button" class="btn-secondary" id="aspirante-ver-hoja">Ver hoja de vida</button>`
          : '<p class="muted">Sin archivo adjunto.</p>'}
      </div>

      ${a.observaciones ? `
        <div class="modal-section">
          <h3 class="modal-section-title">Observaciones</h3>
          <p class="prose-p">${a.observaciones}</p>
        </div>
      ` : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">Acciones</h3>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center">
          ${acciones}
        </div>
      </div>

      <button type="button" id="aspirante-eliminar" class="btn-secondary" style="margin-top:1.2rem; color:var(--danger-text)">Eliminar aspirante</button>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('aspirante-ver-hoja', () => this._verHoja(a));
    on('aspirante-seleccionar', () => this._seleccionar(a.id));
    on('aspirante-descartar', () => this._descartar(a.id));
    on('aspirante-reabrir', () => this._cambiarEstado(a.id, 'En proceso'));
    on('aspirante-link', () => this._verLink(a.id));
    on('aspirante-deshacer-seleccion', () => this._deshacerSeleccion(a.id));
    on('aspirante-aprobar-perfil', () => this._aprobarPerfil(a.id));
    on('aspirante-quitar-aprobacion', () => this._quitarAprobacionPerfil(a.id));
    on('aspirante-eliminar', () => this._eliminar(a.id));
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
    Loading.show('Guardando…');
    try {
      await DB.updateAspiranteEstado(id, estado);
      await this._load();
    } catch (err) {
      alert('No se pudo actualizar el estado: ' + err.message);
    } finally {
      Loading.hide();
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

    // La cédula solo tiene que ser única ENTRE ACTIVOS (ver
    // employees_cedula_activo_unique en schema.sql) -- así que puede haber
    // historial inactivo con esta misma cédula (reingreso: alguien que ya
    // trabajó acá) y aun así se crea un empleado NUEVO, sin tocar ese
    // historial. Solo se bloquea si hay un ACTIVO con la misma cédula --
    // eso sí sería un choque real, probable error de digitación.
    Loading.show('Verificando cédula…');
    let coincidencias;
    try {
      coincidencias = await DB.buscarEmpleadosPorCedula(aspirante.cedula);
    } catch (err) {
      Loading.hide();
      alert('No se pudo verificar la cédula: ' + err.message);
      return;
    }
    Loading.hide();

    const activoExistente = coincidencias.find((e) => e.activo);
    if (activoExistente) {
      alert(`Ya existe un empleado ACTIVO con la cédula ${aspirante.cedula} (${activoExistente.nombre}). Revisa si la cédula está bien digitada antes de continuar -- no se puede seleccionar mientras ese registro siga activo.`);
      return;
    }

    if (coincidencias.length) {
      const masReciente = coincidencias[0];
      const continuar = confirm(
        `Ya existe un registro de "${masReciente.nombre}" con la cédula ${aspirante.cedula}, marcado como inactivo` +
        (masReciente.fecha_salida ? ` (salió el ${formatFechaAspirante(masReciente.fecha_salida)}${masReciente.motivo_renuncia ? ', motivo: ' + masReciente.motivo_renuncia : ''})` : '') +
        `.\n\n¿Es esta misma persona que vuelve a la empresa (reingreso)? Si confirmas, se crea un registro NUEVO de empleado -- el historial anterior se queda intacto, sin modificarlo.`
      );
      if (!continuar) {
        alert('No se seleccionó al candidato. Si la cédula está mal escrita, corrígela en su ficha de aspirante antes de reintentar.');
        return;
      }
    }

    if (!confirm(`¿Seleccionar a ${aspirante.nombre} y crear su registro de empleado?`)) return;
    Loading.show('Creando empleado…');
    try {
      const empleado = await DB.seleccionarAspirante(aspirante);
      await this._load();
      this._mostrarLinkModal(aspirante.nombre, this._linkPerfil(empleado.id));
    } catch (err) {
      alert('No se pudo seleccionar: ' + err.message);
    } finally {
      Loading.hide();
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
    Loading.show('Deshaciendo…');
    try {
      await DB.revertirAprobacion(aspirante, 'En proceso');
      await this._load();
    } catch (err) {
      alert('No se pudo deshacer: ' + err.message);
    } finally {
      Loading.hide();
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
    Loading.show('Descartando…');
    try {
      if (aspirante.employee_id) {
        await DB.revertirAprobacion(aspirante, 'Descartado');
      } else {
        await DB.updateAspiranteEstado(id, 'Descartado');
      }
      await this._load();
    } catch (err) {
      alert('No se pudo descartar: ' + err.message);
    } finally {
      Loading.hide();
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
    Loading.show('Aprobando…');
    try {
      await DB.aprobarPerfilEmpleado(aspirante.employee_id);
      await this._load();
    } catch (err) {
      alert('No se pudo aprobar el perfil: ' + err.message);
    } finally {
      Loading.hide();
    }
  },

  async _quitarAprobacionPerfil(id) {
    const aspirante = this._aspirantes.find((a) => a.id === id);
    if (!aspirante || !aspirante.employee_id) return;
    if (!confirm(`¿Quitar la aprobación del perfil de ${aspirante.nombre}?`)) return;
    Loading.show('Guardando…');
    try {
      await DB.quitarAprobacionPerfil(aspirante.employee_id);
      await this._load();
    } catch (err) {
      alert('No se pudo quitar la aprobación: ' + err.message);
    } finally {
      Loading.hide();
    }
  },

  async _eliminar(id) {
    if (!confirm('¿Eliminar este aspirante? Esta acción no se puede deshacer.')) return;
    Loading.show('Eliminando…');
    try {
      await DB.deleteAspirante(id);
      await this._load();
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    } finally {
      Loading.hide();
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
    Loading.show('Guardando…');

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
      Loading.hide();
    }
  },
});
