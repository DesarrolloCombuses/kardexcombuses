// Mantenimiento: consulta de los alistamientos diarios y los mantenimientos
// que captura la "Plataforma SICOV" (otra app, mismo Supabase) y que se le
// reportan a la Superintendencia de Transporte.
//
// Esta vista SOLO LEE. El alistamiento lo llena el conductor en su formulario
// y el mantenimiento el taller en el suyo; ahí se valida la placa contra la
// flota, la cédula contra employees y las actividades contra el catálogo
// oficial. Duplicar ese registro acá sería abrir una segunda puerta a un dato
// que se le afirma a un regulador.
//
// El catálogo de actividades se guarda por su id OFICIAL, así que lo que se
// muestra en la ficha es exactamente lo que viaja en el reporte.

// Por componentes y no con new Date(iso): Colombia es UTC-5 y una fecha sola
// ('2026-10-09') se leería como medianoche UTC, que acá es el día antes.
function mtFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '—';
  return new Date(a, m - 1, d).toLocaleDateString('es-CO');
}

function mtHora(hhmmss) {
  if (!hhmmss) return '—';
  return String(hhmmss).slice(0, 5);
}

function mtHoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

function mtEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 1 y 2 son los valores que exige el manual de la Supertransporte; se guardan
// como número porque es lo que viaja en el reporte.
const MT_TIPO = { 1: 'Preventivo', 2: 'Correctivo' };

function mtMensajeError(err) {
  const m = String(err?.message || err || '');
  if (/permission denied|row-level security|policy/i.test(m)) {
    return 'Tu cuenta no tiene permiso para consultar mantenimiento. Pídeselo a un administrador en Usuarios.';
  }
  if (/relation .* does not exist|PGRST205/i.test(m)) {
    return 'Las tablas de la plataforma SICOV todavía no están creadas en esta base de datos.';
  }
  return m || 'Error desconocido.';
}

Router.register('mantenimiento', {
  title: 'Mantenimiento',

  _tab: 'alistamientos',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('mt-search').addEventListener('input', () => this._pintar());
      document.getElementById('mt-estado').addEventListener('change', () => this._pintar());
      document.getElementById('mt-desde').addEventListener('change', () => this._load());
      document.getElementById('mt-hasta').addEventListener('change', () => this._load());
      document.getElementById('mt-hoy').addEventListener('click', () => this._rango('hoy'));
      document.getElementById('mt-mes').addEventListener('click', () => this._rango('mes'));
      document.querySelectorAll('#mt-tabs [data-tab]').forEach((b) => {
        b.addEventListener('click', () => this._verTab(b.dataset.tab));
      });
      this._bound = true;
    }
    // Arranca en el día de hoy: es la consulta que se hace a diario ("¿quién
    // no ha alistado?"), y evita traer meses de registros sin que nadie los
    // haya pedido.
    if (!document.getElementById('mt-desde').value) this._rango('hoy', { sinCargar: true });
    this._verTab(this._tab);
    await this._load();
  },

  _rango(cual, { sinCargar = false } = {}) {
    const hoy = mtHoyISO();
    const desde = cual === 'mes' ? `${hoy.slice(0, 7)}-01` : hoy;
    document.getElementById('mt-desde').value = desde;
    document.getElementById('mt-hasta').value = hoy;
    if (!sinCargar) this._load();
  },

  _verTab(tab) {
    this._tab = tab;
    document.getElementById('mt-panel-alistamientos').classList.toggle('hidden', tab !== 'alistamientos');
    document.getElementById('mt-panel-mantenimientos').classList.toggle('hidden', tab !== 'mantenimientos');
    document.querySelectorAll('#mt-tabs [data-tab]').forEach((b) => {
      b.classList.toggle('activo', b.dataset.tab === tab);
    });
    // El filtro de estado solo existe para alistamientos: un mantenimiento no
    // tiene "con novedad", lo que tiene es tipo preventivo o correctivo.
    document.getElementById('mt-estado').closest('.filtro-inline').classList.toggle('hidden', tab !== 'alistamientos');
    if (this._alistamientos) this._pintar();
  },

  async _load() {
    const desde = document.getElementById('mt-desde').value || mtHoyISO();
    const hasta = document.getElementById('mt-hasta').value || mtHoyISO();
    Loading.show('Cargando…');
    try {
      const [alistamientos, mantenimientos, catalogo, vehiculos] = await Promise.all([
        DB.getAlistamientosSicov({ desde, hasta }),
        DB.getMantenimientosSicov({ desde, hasta }),
        this._catalogo ? Promise.resolve(this._catalogo) : DB.getCatalogoActividadesSicov(),
        // La flota se usa solo para saber quién falta por alistar. Si esa
        // consulta falla, el resto de la vista no tiene por qué caerse.
        DB.getFlotaVehiculos().catch(() => []),
      ]);
      this._alistamientos = alistamientos;
      this._mantenimientos = mantenimientos;
      this._catalogo = catalogo;
      this._catalogoPorId = Object.fromEntries(catalogo.map((a) => [a.id, a]));
      this._vehiculos = vehiculos;
      this._pintar();
    } catch (err) {
      document.getElementById('mt-contador').textContent = mtMensajeError(err);
      document.getElementById('mt-tbody-alist').innerHTML =
        `<tr><td colspan="6" class="empty-note">${mtEsc(mtMensajeError(err))}</td></tr>`;
      document.getElementById('mt-tbody-mant').innerHTML = '';
    } finally {
      Loading.hide();
    }
  },

  _filtrados(filas, campos) {
    const q = document.getElementById('mt-search').value.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter((f) => campos.some((c) => String(f[c] || '').toLowerCase().includes(q)));
  },

  _pintar() {
    this._pintarKpis();
    if (this._tab === 'alistamientos') this._pintarAlistamientos();
    else this._pintarMantenimientos();
    this._pintarFaltantes();
  },

  // Los KPI del día son del DÍA, no del rango que se esté mirando: son el
  // semáforo de hoy, y cambiarlos al mover el filtro los volvería inútiles
  // como alerta. El único que sigue al rango es el de mantenimientos, y por
  // eso su etiqueta dice "del período".
  _pintarKpis() {
    const hoy = mtHoyISO();
    const deHoy = (this._alistamientos || []).filter((a) => a.fecha === hoy);
    document.getElementById('mt-kpi-hoy').textContent = deHoy.length;
    document.getElementById('mt-kpi-novedad').textContent =
      deHoy.filter((a) => a.estado === 'CON_NOVEDAD').length;
    document.getElementById('mt-kpi-faltan').textContent = this._faltantes().length;
    document.getElementById('mt-kpi-mant').textContent = (this._mantenimientos || []).length;
  },

  // Vehículos vinculados que hoy no tienen alistamiento. Solo los vinculados:
  // un vehículo retirado de la operación no tiene por qué alistarse, y
  // contarlo inflaría la alerta hasta volverla ruido.
  _faltantes() {
    const hoy = mtHoyISO();
    const alistadas = new Set((this._alistamientos || [])
      .filter((a) => a.fecha === hoy)
      .map((a) => String(a.placa || '').toUpperCase().trim()));
    return (this._vehiculos || [])
      .filter((v) => v.vinculado !== false)
      .filter((v) => !alistadas.has(String(v.placa || '').toUpperCase().trim()))
      .sort((a, b) => String(a.placa).localeCompare(String(b.placa), 'es'));
  },

  _pintarFaltantes() {
    const faltan = this._faltantes();
    document.getElementById('mt-faltantes-titulo').textContent =
      faltan.length ? `${faltan.length} vehículo(s) sin alistamiento hoy` : 'Todos los vehículos vinculados alistaron hoy';
    const lista = document.getElementById('mt-faltantes-lista');
    if (!faltan.length) {
      lista.innerHTML = '<p class="empty-note">Nada pendiente.</p>';
      return;
    }
    lista.innerHTML = faltan.map((v) => `
      <div class="detalle-list-item">
        <span class="lc-item-texto">
          <span class="detalle-list-item-main">${mtEsc(v.placa)}</span>
          <span class="detalle-list-item-sub">${mtEsc(v.numero_interno ? `Interno ${v.numero_interno}` : 'Sin interno')}${v.ruta ? ` · Ruta ${mtEsc(v.ruta)}` : ''}</span>
        </span>
      </div>`).join('');
  },

  _pintarAlistamientos() {
    const estado = document.getElementById('mt-estado').value;
    let filas = this._filtrados(this._alistamientos || [],
      ['placa', 'conductor_nombre', 'conductor_num_id', 'responsable_nombre']);
    if (estado) filas = filas.filter((a) => a.estado === estado);

    document.getElementById('mt-contador').textContent =
      `${filas.length} alistamiento(s)` + (filas.length !== (this._alistamientos || []).length
        ? ` de ${(this._alistamientos || []).length}` : '');

    const tbody = document.getElementById('mt-tbody-alist');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Sin alistamientos en este período.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((a) => `
      <tr>
        <td>${mtFecha(a.fecha)}</td>
        <td><strong>${mtEsc(a.placa)}</strong></td>
        <td>${mtEsc(a.conductor_nombre || '—')}<br><span class="muted">CC ${mtEsc(a.conductor_num_id || '—')}</span></td>
        <td>${a.kilometraje != null ? Number(a.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td><span class="tag ${a.estado === 'CON_NOVEDAD' ? 'novedad' : 'activo'}">${a.estado === 'CON_NOVEDAD' ? 'Con novedad' : 'Sin novedad'}</span></td>
        <td><button type="button" class="btn-secondary" data-ver-alist="${a.id}">Ver</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-ver-alist]').forEach((b) => {
      b.addEventListener('click', () => this._verAlistamiento(
        filas.find((x) => String(x.id) === b.dataset.verAlist)));
    });
  },

  _pintarMantenimientos() {
    const filas = this._filtrados(this._mantenimientos || [],
      ['placa', 'responsable_nombre', 'responsable_num_id', 'detalle_libre']);

    document.getElementById('mt-contador').textContent =
      `${filas.length} mantenimiento(s)` + (filas.length !== (this._mantenimientos || []).length
        ? ` de ${(this._mantenimientos || []).length}` : '');

    const tbody = document.getElementById('mt-tbody-mant');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-note">Sin mantenimientos en este período.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((m) => `
      <tr>
        <td>${mtFecha(m.fecha)}</td>
        <td>${mtHora(m.hora)}</td>
        <td><strong>${mtEsc(m.placa)}</strong></td>
        <td><span class="tag ${m.tipo === 2 ? 'pendiente' : 'activo'}">${MT_TIPO[m.tipo] || m.tipo}</span></td>
        <td>${mtEsc(m.responsable_nombre || '—')}<br><span class="muted">CC ${mtEsc(m.responsable_num_id || '—')}</span></td>
        <td>${m.kilometraje != null ? Number(m.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td><button type="button" class="btn-secondary" data-ver-mant="${m.id}">Ver</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-ver-mant]').forEach((b) => {
      b.addEventListener('click', () => this._verMantenimiento(
        filas.find((x) => String(x.id) === b.dataset.verMant)));
    });
  },

  _nombreActividad(id) {
    return this._catalogoPorId?.[id]?.descripcion || `Actividad ${id}`;
  },

  _abrirModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },

  async _verAlistamiento(a) {
    if (!a) return;
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Alistamiento ${mtEsc(a.placa)} · ${mtFecha(a.fecha)}</h3>
        <p class="muted">Conductor: ${mtEsc(a.conductor_nombre || '—')} (CC ${mtEsc(a.conductor_num_id || '—')})<br>
        Responsable del proceso: ${mtEsc(a.responsable_nombre || '—')}<br>
        Registrado: ${a.registrado_en ? new Date(a.registrado_en).toLocaleString('es-CO') : '—'}${a.kilometraje != null ? ` · ${Number(a.kilometraje).toLocaleString('es-CO')} km` : ''}</p>
        ${a.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(a.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Checklist</h3>
        <div id="mt-detalle-actividades"><p class="muted">Cargando…</p></div>
      </div>`);
    try {
      const actividades = await DB.getActividadesAlistamiento(a.id);
      const caja = document.getElementById('mt-detalle-actividades');
      if (!caja) return;                       // se cerró mientras llegaba
      if (!actividades.length) {
        caja.innerHTML = '<p class="muted">Este alistamiento no tiene actividades registradas.</p>';
        return;
      }
      // Las no conformes primero: son la razón de abrir la ficha.
      const orden = [...actividades].sort((x, y) => Number(x.conforme) - Number(y.conforme));
      caja.innerHTML = `<div class="detalle-list">${orden.map((x) => `
        <div class="detalle-list-item">
          <span class="lc-item-texto">
            <span class="detalle-list-item-main">${mtEsc(this._nombreActividad(x.actividad_id))}</span>
            ${x.observacion ? `<span class="detalle-list-item-sub">${mtEsc(x.observacion)}</span>` : ''}
          </span>
          <span class="tag ${x.conforme ? 'activo' : 'novedad'}">${x.conforme ? 'Conforme' : 'No conforme'}</span>
        </div>`).join('')}</div>`;
    } catch (err) {
      const caja = document.getElementById('mt-detalle-actividades');
      if (caja) caja.innerHTML = `<p class="muted">${mtEsc(mtMensajeError(err))}</p>`;
    }
  },

  async _verMantenimiento(m) {
    if (!m) return;
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Mantenimiento ${mtEsc(m.placa)} · ${mtFecha(m.fecha)} ${mtHora(m.hora)}</h3>
        <p class="muted">${MT_TIPO[m.tipo] || m.tipo} · Responsable: ${mtEsc(m.responsable_nombre || '—')} (CC ${mtEsc(m.responsable_num_id || '—')})${m.kilometraje != null ? ` · ${Number(m.kilometraje).toLocaleString('es-CO')} km` : ''}</p>
        ${m.detalle_libre ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(m.detalle_libre)}</p>` : ''}
        ${m.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(m.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Actividades</h3>
        <div id="mt-detalle-actividades"><p class="muted">Cargando…</p></div>
      </div>`);
    try {
      const actividades = await DB.getActividadesMantenimiento(m.id);
      const caja = document.getElementById('mt-detalle-actividades');
      if (!caja) return;
      if (!actividades.length) {
        caja.innerHTML = '<p class="muted">Sin actividades del catálogo; mira el detalle de arriba.</p>';
        return;
      }
      caja.innerHTML = `<div class="detalle-list">${actividades.map((x) => `
        <div class="detalle-list-item">
          <span class="lc-item-texto">
            <span class="detalle-list-item-main">${mtEsc(this._nombreActividad(x.actividad_id))}</span>
            ${x.observacion ? `<span class="detalle-list-item-sub">${mtEsc(x.observacion)}</span>` : ''}
          </span>
        </div>`).join('')}</div>`;
    } catch (err) {
      const caja = document.getElementById('mt-detalle-actividades');
      if (caja) caja.innerHTML = `<p class="muted">${mtEsc(mtMensajeError(err))}</p>`;
    }
  },
});
