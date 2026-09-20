// Parque automotor: vencimientos de documentos de cada bus (SOAT, gases,
// tecnomecánica y tarjeta de operación) para que quede visible en la app
// cuándo se le vence algo a cada vehículo, sin depender de revisar el
// archivo original a mano. La tabla parque_automotor la carga aparte quien
// administra la flota (no este módulo) -- acá solo se lee y se avisa.

const PA_DOCUMENTOS = [
  { campo: 'Fecha Vencimiento Soat', label: 'SOAT' },
  { campo: 'Fecha Vencimiento Gases', label: 'Revisión de gases' },
  { campo: 'Fecha Vencimiento Tecnomecanica', label: 'Tecnomecánica' },
  { campo: 'Fecha Vencimiento Tecnomecanica Bim', label: 'Tecnomec. bimensual' },
  { campo: 'Fecha Vencimiento Operacion', label: 'Tarjeta de operación' },
];

const PA_DIAS_POR_VENCER = 30;

// Copia local a propósito (mismo criterio que el resto de vistas de este
// proyecto: cada una se mantiene autocontenida). Las fechas llegan como
// texto "d/m/aaaa" o "dd/mm/aaaa" -- se parsea por componentes (constructor
// de 3 argumentos, hora local) para no correr el día por el mismo problema
// de "new Date(string)" interpretando medianoche UTC que ya se corrigió en
// js/views/siniestros-transito.js.
function paParseFecha(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, dd, mm, yyyy] = m;
  if (yyyy.length === 2) yyyy = '20' + yyyy;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function paEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paVacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// Ficha del vehículo: agrupa el resto de columnas de parque_automotor (las
// que no son fecha de vencimiento) para mostrarlas en el modal de detalle.
const PA_SECCIONES_FICHA = [
  { titulo: 'Identificación', campos: [
    ['Empresa', 'Empresa'], ['Marca', 'Marca'], ['Modelo', 'Modelo'],
    ['Motor', 'N.º de motor'], ['Chasis', 'Chasis'], ['Serial', 'Serial'],
  ] },
  { titulo: 'Capacidad y ruta', campos: [
    ['CapacidadSentados', 'Capacidad sentados'], ['CapacidadPie', 'Capacidad de pie'],
    ['Ruta', 'Ruta'], ['Nombre Ruta', 'Nombre de ruta'],
  ] },
  { titulo: 'Propietario y contrato', campos: [
    ['Propietario', 'Identificación propietario'], ['Nombres Propietarios', 'Nombre del propietario'],
    ['Contrato', 'N.º de contrato'], ['Fecha Contrato', 'Fecha de contrato'],
  ] },
];

// "Fecha Ingreso"/"FechaRetiro" traen fechas centinela cuando no hay dato
// real (ej. "2/01/1900" o "31/12/3000") en vez de venir vacías -- se tratan
// como "sin dato" para no mostrar una fecha absurda como si fuera real.
function paFechaVigencia(valor) {
  const fecha = paParseFecha(valor);
  if (!fecha) return null;
  const anio = fecha.getFullYear();
  if (anio <= 1901 || anio >= 2999) return null;
  return fecha;
}

function paCampoDetalle(label, valor, claseExtra) {
  const vacio = paVacio(valor);
  return `
    <div class="detalle-field ${claseExtra || ''}">
      <div class="detalle-field-label">${paEscapeHtml(label)}</div>
      <div class="detalle-field-value ${vacio ? 'pendiente' : ''}">${vacio ? 'Sin dato' : paEscapeHtml(valor)}</div>
    </div>
  `;
}

// Estado de un documento puntual a partir de su fecha de vencimiento.
// "peso" ordena de más a menos urgente, para sacar el peor estado de un
// vehículo entre sus 5 documentos.
function paEstadoDocumento(valor) {
  const fecha = paParseFecha(valor);
  if (!fecha) return { estado: 'sin_dato', peso: 0, tag: 'inactivo-tag', texto: 'Sin dato' };
  const hoy = new Date();
  const hoyMedianoche = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = Math.round((fecha.getTime() - hoyMedianoche.getTime()) / 86400000);
  const fechaTexto = fecha.toLocaleDateString('es-CO');
  if (dias < 0) {
    return { estado: 'vencido', peso: 3, tag: 'descartado', texto: `Vencido hace ${Math.abs(dias)} día(s) — ${fechaTexto}` };
  }
  if (dias <= PA_DIAS_POR_VENCER) {
    const cuando = dias === 0 ? 'Vence hoy' : `Vence en ${dias} día(s)`;
    return { estado: 'por_vencer', peso: 2, tag: 'pendiente', texto: `${cuando} — ${fechaTexto}` };
  }
  return { estado: 'vigente', peso: 1, tag: 'completo', texto: `Vigente hasta ${fechaTexto}` };
}

Router.register('parque-automotor', {
  title: 'Parque automotor',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pa-search').addEventListener('input', () => this._aplicarFiltro());
      document.getElementById('pa-filtro-estado-doc').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-mostrar-desvinculados').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('.pa-ver-ficha');
        if (!btn) return;
        const vehiculo = this._filasRenderizadas[Number(btn.dataset.idx)];
        if (vehiculo) this._verDetalle(vehiculo);
      });
      this._bound = true;
    }

    const filas = await DB.getParqueAutomotor();
    this._vehiculos = filas
      .map((f) => {
        const docs = PA_DOCUMENTOS.map((d) => ({ ...d, ...paEstadoDocumento(f[d.campo]) }));
        const peorEstado = docs.reduce((peor, d) => (d.peso > peor.peso ? d : peor), { peso: -1, estado: 'sin_dato' });
        return {
          interno: f['Interno'] || '—',
          placa: f['Placa'] || '—',
          clase: f['Clase'] || '—',
          estado: (f['Estado'] || '').trim().toUpperCase(),
          vinculado: (f['Estado'] || '').trim().toUpperCase() === 'VINCULADO',
          docs,
          tieneVencido: docs.some((d) => d.estado === 'vencido'),
          tienePorVencer: docs.some((d) => d.estado === 'por_vencer'),
          peorEstado: peorEstado.estado,
          raw: f,
        };
      })
      // Vinculados primero, y entre ellos los que necesitan atención primero
      // -- así lo más urgente queda arriba en vez de perderse en la lista.
      .sort((a, b) => {
        if (a.vinculado !== b.vinculado) return a.vinculado ? -1 : 1;
        const orden = { vencido: 0, por_vencer: 1, vigente: 2, sin_dato: 3 };
        return (orden[a.peorEstado] ?? 9) - (orden[b.peorEstado] ?? 9);
      });

    this._render();
    this._aplicarFiltro();
  },

  _render() {
    const vinculados = this._vehiculos.filter((v) => v.vinculado);
    document.getElementById('pa-kpi-vinculados').textContent = vinculados.length;
    document.getElementById('pa-kpi-vencidos').textContent = vinculados.filter((v) => v.tieneVencido).length;
    document.getElementById('pa-kpi-por-vencer').textContent = vinculados.filter((v) => !v.tieneVencido && v.tienePorVencer).length;
  },

  _aplicarFiltro() {
    const q = document.getElementById('pa-search').value.trim().toLowerCase();
    const estadoDoc = document.getElementById('pa-filtro-estado-doc').value;
    const mostrarDesvinculados = document.getElementById('pa-mostrar-desvinculados').checked;

    let filtrados = this._vehiculos;
    if (!mostrarDesvinculados) filtrados = filtrados.filter((v) => v.vinculado);
    if (estadoDoc === 'vencido') filtrados = filtrados.filter((v) => v.tieneVencido);
    else if (estadoDoc === 'por_vencer') filtrados = filtrados.filter((v) => !v.tieneVencido && v.tienePorVencer);
    else if (estadoDoc === 'al_dia') filtrados = filtrados.filter((v) => !v.tieneVencido && !v.tienePorVencer);
    if (q) {
      filtrados = filtrados.filter((v) =>
        v.placa.toLowerCase().includes(q) || v.interno.toLowerCase().includes(q)
      );
    }

    document.getElementById('pa-contador').textContent = filtrados.length === this._vehiculos.length
      ? `${this._vehiculos.length} vehículo(s)`
      : `Mostrando ${filtrados.length} de ${this._vehiculos.length} vehículo(s)`;
    this._renderTabla(filtrados);
  },

  _renderTabla(vehiculos) {
    const tbody = document.getElementById('pa-tbody');
    // Se guarda la lista tal cual quedó filtrada -- el botón "Ver ficha" de
    // cada fila referencia su posición acá (data-idx) en vez de buscar por
    // interno/placa, para no fallar si algún vehículo repite interno (ya
    // pasa en los datos reales: hay más filas que internos distintos).
    this._filasRenderizadas = vehiculos;
    if (!vehiculos.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-note">Sin resultados con estos filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = vehiculos.map((v, i) => `
      <tr>
        <td data-label="Interno">${paEscapeHtml(v.interno)}</td>
        <td data-label="Placa">${paEscapeHtml(v.placa)}</td>
        <td data-label="Clase">${paEscapeHtml(v.clase)}</td>
        <td data-label="Estado"><span class="tag ${v.vinculado ? 'activo' : 'inactivo-tag'}">${paEscapeHtml(v.estado || 'Sin dato')}</span></td>
        ${v.docs.map((d) => `<td data-label="${paEscapeHtml(d.label)}"><span class="tag ${d.tag}" title="${paEscapeHtml(d.texto)}">${paEscapeHtml(d.texto)}</span></td>`).join('')}
        <td data-label="Ficha"><button type="button" class="btn-secondary pa-ver-ficha" data-idx="${i}">Ver ficha</button></td>
      </tr>
    `).join('');
  },

  // Ficha completa del vehículo -- el resto de columnas de parque_automotor
  // que no caben en la tabla (identificación, capacidad, propietario,
  // contrato, fechas de vigencia) más los mismos 5 documentos ya calculados
  // para esa fila.
  _verDetalle(v) {
    const f = v.raw;
    const seccionesHtml = PA_SECCIONES_FICHA.map((s) => `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">${paEscapeHtml(s.titulo)}</h4></div>
        <div class="detalle-grid">${s.campos.map(([campo, label]) => paCampoDetalle(label, f[campo])).join('')}</div>
      </div>
    `).join('');

    const fechaIngreso = paFechaVigencia(f['Fecha Ingreso']);
    const fechaRetiro = paFechaVigencia(f['FechaRetiro']);
    const vigenciaHtml = `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Vigencia en la flota</h4></div>
        <div class="detalle-grid">
          ${paCampoDetalle('Fecha de ingreso', fechaIngreso ? fechaIngreso.toLocaleDateString('es-CO') : null)}
          ${paCampoDetalle('Fecha de retiro', fechaRetiro ? fechaRetiro.toLocaleDateString('es-CO') : null)}
        </div>
      </div>
    `;

    const documentosHtml = `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Documentos</h4></div>
        <div class="detalle-grid">
          ${v.docs.map((d) => `
            <div class="detalle-field">
              <div class="detalle-field-label">${paEscapeHtml(d.label)}</div>
              <div class="detalle-field-value"><span class="tag ${d.tag}">${paEscapeHtml(d.texto)}</span></div>
            </div>
          `).join('')}
        </div>
        ${!paVacio(f['Comentario']) ? paCampoDetalle('Comentario', f['Comentario'], 'detalle-field-full') : ''}
      </div>
    `;

    // Estos 4 campos hoy solo traen el NOMBRE del archivo que se subió en el
    // sistema donde se administra la flota (fuera de Kardex) -- no hay un
    // PDF/foto real accesible desde acá para abrir o descargar, así que se
    // muestran como texto simple con una aclaración en vez de simular un
    // botón "Ver" que no llevaría a ningún lado.
    const archivos = [
      ['Foto del vehículo', f['Foto vehiculo']],
      ['SOAT (archivo)', f['SOAT VIRTUAL']],
      ['Tecnomecánica (archivo)', f['TECNOMECANICA VIRTUAL']],
      ['Tarjeta de operación (archivo)', f['TARJETA DE OPERACION VIRTUAL']],
    ].filter(([, valor]) => !paVacio(valor));
    const archivosHtml = archivos.length ? `
      <div class="modal-section">
        <h3 class="modal-section-title">Archivos referenciados</h3>
        <p class="empty-note" style="margin-bottom:0.6rem">Por ahora solo se guardó el nombre de estos archivos, no el archivo en sí -- no se pueden abrir ni descargar desde acá todavía.</p>
        <div class="detalle-grid">${archivos.map(([label, valor]) => paCampoDetalle(label, valor)).join('')}</div>
      </div>
    ` : '';

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${paEscapeHtml(v.placa)} <span class="muted" style="font-weight:500">· Interno ${paEscapeHtml(v.interno)}</span></div>
          <div class="detalle-sub">${paEscapeHtml(v.clase)}</div>
        </div>
        <div class="detalle-tags">
          <span class="tag ${v.vinculado ? 'activo' : 'inactivo-tag'}">${paEscapeHtml(v.estado || 'Sin dato')}</span>
        </div>
      </div>
      ${seccionesHtml}
      ${vigenciaHtml}
      ${documentosHtml}
      ${archivosHtml}
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },
});
