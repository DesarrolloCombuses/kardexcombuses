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

// ---- Checklist urbano (preoperacionales de Zamora y Aranjuez) -------------
// Copiado literal de supabase/functions/_shared/preop.ts del backend de las
// apps de conductor, que es donde se valida y donde se calcula el
// estado_general. Acá solo sirve para PINTAR: poner el ítem con su nombre
// legible y su color según la gravedad. El original manda; si allá cambian un
// valor, acá aparecería sin color hasta que se copie de nuevo -- por eso
// MT_PREOP_NIVEL cae en 1 (alerta) ante un valor que no reconoce, y no en 0:
// más vale señalar de más que dar por bueno algo que no se sabe qué es.
const MT_PREOP_CAMPOS = {
  conductor_apto: { 'Sí, apto': 0, 'No, no apto': 2 },
  fluidos: { 'OK': 0, 'Alguno bajo': 1, 'Falta alguno o requiere cambio': 2 },
  llantas: { 'OK': 0, 'Presión baja o desgaste visible': 1, 'Llanta lisa o desinflada': 2 },
  direccion_suspension: { 'OK': 0, 'Vibra o hace ruido extraño': 1, 'Juego excesivo o no responde bien': 2 },
  luces: { 'OK': 0, 'Alguna no sirve': 1, 'Varias no encienden': 2 },
  visibilidad: { 'OK': 0, 'Requiere ajuste o no limpia bien': 1, 'Dañado, no funciona o parabrisas fisurado': 2 },
  cinturones: { 'OK': 0, 'Alguno dañado': 1, 'No funcionan': 2 },
  emergencia: { 'OK': 0, 'Algo incompleto o vencido': 1, 'Falta extintor o botiquín': 2 },
  puertas: { 'OK': 0, 'Pasamanos flojo o puerta dura': 1, 'No cierra bien o no hay salida de emergencia': 2 },
  documentacion: { 'OK': 0, 'Alguno por vencer': 1, 'Alguno vencido o falta': 2 },
  frenos: { 'OK': 0, 'Se sienten suaves o flojos': 1, 'No frenan bien': 2 },
};

// El orden importa: el autorreporte del conductor va primero porque si él
// dice que no está apto, lo del vehículo pasa a segundo plano.
const MT_PREOP_ETIQUETAS = [
  ['conductor_apto', '¿El conductor se reporta apto?'],
  ['frenos', 'Frenos'],
  ['llantas', 'Llantas'],
  ['direccion_suspension', 'Dirección y suspensión'],
  ['luces', 'Luces'],
  ['fluidos', 'Fluidos'],
  ['visibilidad', 'Visibilidad (limpiabrisas, espejos, parabrisas)'],
  ['cinturones', 'Cinturones'],
  ['emergencia', 'Equipo de emergencia'],
  ['puertas', 'Puertas y pasamanos'],
  ['documentacion', 'Documentación'],
];

function mtPreopNivel(campo, valor) {
  const niveles = MT_PREOP_CAMPOS[campo];
  if (!niveles) return 1;
  const n = niveles[String(valor || '').trim()];
  return n === undefined ? 1 : n;
}

const MT_PREOP_ESTADO = {
  OK: { texto: 'OK', clase: 'activo' },
  ALERTA: { texto: 'Alerta', clase: 'pendiente' },
  CRITICO: { texto: 'Crítico', clase: 'novedad' },
};

// Cada pestaña tiene su propia escala de estado, así que el filtro se
// repuebla: ofrecerle "Con novedad" a un preoperacional no encontraría nada.
const MT_ESTADOS_POR_TAB = {
  alistamientos: [['', 'Todos'], ['OK', 'Sin novedad'], ['CON_NOVEDAD', 'Con novedad']],
  mantenimientos: [],
  preoperacionales: [['', 'Todos'], ['OK', 'OK'], ['ALERTA', 'Alerta'], ['CRITICO', 'Crítico']],
};

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
    ['alistamientos', 'mantenimientos', 'preoperacionales'].forEach((t) => {
      document.getElementById(`mt-panel-${t}`).classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('#mt-tabs [data-tab]').forEach((b) => {
      b.classList.toggle('activo', b.dataset.tab === tab);
    });
    // Cada pestaña trae su escala. Un mantenimiento no tiene estado -- lo que
    // tiene es tipo preventivo o correctivo --, así que ahí el filtro se
    // esconde en vez de ofrecer opciones que no aplican.
    const opciones = MT_ESTADOS_POR_TAB[tab] || [];
    const sel = document.getElementById('mt-estado');
    sel.closest('.filtro-inline').classList.toggle('hidden', !opciones.length);
    if (opciones.length) {
      sel.innerHTML = opciones.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    }
    if (this._alistamientos) this._pintar();
  },

  async _load() {
    const desde = document.getElementById('mt-desde').value || mtHoyISO();
    const hasta = document.getElementById('mt-hasta').value || mtHoyISO();
    Loading.show('Cargando…');
    try {
      const [alistamientos, mantenimientos, catalogo, vehiculos, preoperacionales] = await Promise.all([
        DB.getAlistamientosSicov({ desde, hasta }),
        DB.getMantenimientosSicov({ desde, hasta }),
        this._catalogo ? Promise.resolve(this._catalogo) : DB.getCatalogoActividadesSicov(),
        // La flota se usa solo para saber quién falta por alistar. Si esa
        // consulta falla, el resto de la vista no tiene por qué caerse.
        DB.getFlotaVehiculos().catch(() => []),
        // Las preoperacionales urbanas son de otro sistema: si todavía no se
        // abrió su permiso, las otras dos pestañas tienen que seguir sirviendo.
        DB.getPreoperacionales({ desde, hasta }).catch((e) => { this._errorPreop = e; return []; }),
      ]);
      this._alistamientos = alistamientos;
      this._mantenimientos = mantenimientos;
      this._catalogo = catalogo;
      this._catalogoPorId = Object.fromEntries(catalogo.map((a) => [a.id, a]));
      this._vehiculos = vehiculos;
      this._preoperacionales = preoperacionales;
      if (preoperacionales.length) this._errorPreop = null;
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
    else if (this._tab === 'mantenimientos') this._pintarMantenimientos();
    else this._pintarPreoperacionales();
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

  _pintarPreoperacionales() {
    const estado = document.getElementById('mt-estado').value;
    let filas = this._filtrados(this._preoperacionales || [],
      ['placa', 'ruta', 'interno', 'conductor_nombre', 'conductor_cedula']);
    if (estado) filas = filas.filter((p) => p.estado_general === estado);

    const total = (this._preoperacionales || []).length;
    document.getElementById('mt-contador').textContent =
      `${filas.length} preoperacional(es)` + (filas.length !== total ? ` de ${total}` : '');

    const tbody = document.getElementById('mt-tbody-preop');
    if (!filas.length) {
      // Si la consulta falló (permiso no abierto todavía), decirlo: una tabla
      // vacía haría pensar que no hay checklists, que es muy distinto.
      const msg = this._errorPreop
        ? mtMensajeError(this._errorPreop)
        : 'Sin preoperacionales en este período.';
      tbody.innerHTML = `<tr><td colspan="7" class="empty-note">${mtEsc(msg)}</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map((p) => {
      const est = MT_PREOP_ESTADO[p.estado_general] || { texto: p.estado_general, clase: 'pendiente' };
      return `
      <tr>
        <td>${mtFecha(p.fecha)}</td>
        <td>${mtEsc(p.ruta || '—')}</td>
        <td><strong>${mtEsc(p.placa)}</strong>${p.interno ? `<br><span class="muted">Interno ${mtEsc(p.interno)}</span>` : ''}</td>
        <td>${mtEsc(p.conductor_nombre || '—')}<br><span class="muted">CC ${mtEsc(p.conductor_cedula || '—')}</span></td>
        <td>${p.kilometraje != null ? Number(p.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td>${mtEsc(p.combustible || '—')}</td>
        <td><span class="tag ${est.clase}">${est.texto}</span>
          <button type="button" class="btn-secondary" data-ver-preop="${p.id}">Ver</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-ver-preop]').forEach((b) => {
      b.addEventListener('click', () => this._verPreoperacional(
        filas.find((x) => String(x.id) === b.dataset.verPreop)));
    });
  },

  // Todo el checklist está en columnas de la misma fila, así que no hace
  // falta una segunda consulta: se abre al instante.
  _verPreoperacional(p) {
    if (!p) return;
    const est = MT_PREOP_ESTADO[p.estado_general] || { texto: p.estado_general, clase: 'pendiente' };
    const items = MT_PREOP_ETIQUETAS
      .map(([campo, etiqueta]) => ({ campo, etiqueta, valor: p[campo], nivel: mtPreopNivel(campo, p[campo]) }))
      .filter((x) => x.valor)
      // Lo grave primero: es a lo que hay que reaccionar.
      .sort((a, b) => b.nivel - a.nivel);
    const clasePorNivel = ['activo', 'pendiente', 'novedad'];
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Preoperacional ${mtEsc(p.placa)} · ${mtFecha(p.fecha)}</h3>
        <p class="muted">Ruta ${mtEsc(p.ruta || '—')}${p.interno ? ` · Interno ${mtEsc(p.interno)}` : ''}<br>
        Conductor: ${mtEsc(p.conductor_nombre || '—')} (CC ${mtEsc(p.conductor_cedula || '—')})<br>
        ${p.kilometraje != null ? `${Number(p.kilometraje).toLocaleString('es-CO')} km · ` : ''}Combustible: ${mtEsc(p.combustible || '—')}
        ${p.created_at ? `<br>Registrado: ${new Date(p.created_at).toLocaleString('es-CO')}` : ''}</p>
        <p><span class="tag ${est.clase}">${est.texto}</span></p>
        ${p.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(p.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Checklist</h3>
        <div class="detalle-list">${items.map((x) => `
          <div class="detalle-list-item">
            <span class="lc-item-texto">
              <span class="detalle-list-item-main">${mtEsc(x.etiqueta)}</span>
            </span>
            <span class="tag ${clasePorNivel[x.nivel]}">${mtEsc(x.valor)}</span>
          </div>`).join('')}</div>
      </div>`);
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
