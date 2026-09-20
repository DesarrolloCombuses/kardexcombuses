// Parque automotor: vencimientos y documentos reales de cada bus. Se lee de
// flota_vehiculos / flota_documentos_estado -- las tablas del "Portal de
// Documentos" que usan los coordinadores de ruta (programa aparte, mismo
// proyecto de Supabase: ver carpeta portal-documentos-rutas), que es donde
// de verdad se sube el PDF/foto de cada documento. Antes esta vista leía
// parque_automotor (un import congelado con solo el NOMBRE de cada archivo,
// nunca el archivo real) -- se dejó de usar por completo.

// Documentos que se muestran como columna fija de la tabla (los que aplican
// a casi todos los vehículos). Certificación de amparo y licencia de
// tránsito no se muestran ahí porque muy pocos vehículos los tienen
// registrados todavía -- igual aparecen en la ficha de detalle si existen.
const PA_TIPOS_TABLA = ['SOAT', 'TECNOMECANICA', 'TARJETA_OPERACION', 'MANTENIMIENTO_PREVENTIVO'];

const PA_TIPO_LABELS = {
  SOAT: 'SOAT',
  TECNOMECANICA: 'Tecnomecánica',
  TARJETA_OPERACION: 'Tarjeta de operación',
  MANTENIMIENTO_PREVENTIVO: 'Mantenimiento preventivo',
  CERTIFICACION_AMPARO: 'Certificación de amparo',
  LICENCIA_TRANSITO: 'Licencia de tránsito',
};

// estado_vencimiento ya viene calculado desde flota_documentos_estado (SQL,
// mismo umbral de 30 días) -- acá solo se traduce a tag/texto para pintarlo.
// El tag muestra siempre la MISMA palabra corta (igual que el resto de tags
// de esta app: "Activo", "Pendiente", etc.) -- el detalle completo (fecha
// exacta, días) va aparte, no adentro del tag, para que la tabla se lea de
// un vistazo en vez de una frase larga por celda.
const PA_ESTADO_TAG = { VENCIDO: 'descartado', POR_VENCER: 'pendiente', VIGENTE: 'completo', SIN_FECHA: 'inactivo-tag' };
const PA_ESTADO_LABEL = { VENCIDO: 'Vencido', POR_VENCER: 'Por vencer', VIGENTE: 'Vigente', SIN_FECHA: 'Sin registrar' };
const PA_ESTADO_PESO = { VENCIDO: 3, POR_VENCER: 2, VIGENTE: 1, SIN_FECHA: 0 };

function paEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paVacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// fecha_vencimiento/fecha_ingreso/etc. llegan como "aaaa-mm-dd" (columna date
// de Postgres) -- se parsea por componentes (constructor de 3 argumentos,
// hora local) en vez de "new Date(string)", que en una zona horaria detrás
// de UTC (Colombia, UTC-5) puede correr la fecha un día hacia atrás si se
// interpreta como medianoche UTC. Mismo criterio que ya se usa en
// js/views/siniestros-transito.js.
function paParseFechaIso(valor) {
  if (!valor) return null;
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function paFormatFecha(valor) {
  const d = paParseFechaIso(valor);
  return d ? d.toLocaleDateString('es-CO') : null;
}

function paTextoEstado(doc) {
  const fechaTexto = paFormatFecha(doc.fecha_vencimiento);
  if (doc.estado_vencimiento === 'SIN_FECHA' || !fechaTexto) return 'Sin fecha registrada';
  if (doc.estado_vencimiento === 'VIGENTE') return `Vigente hasta ${fechaTexto}`;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = paParseFechaIso(doc.fecha_vencimiento);
  const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
  if (doc.estado_vencimiento === 'VENCIDO') return `Vencido hace ${Math.abs(dias)} día(s) — ${fechaTexto}`;
  return (dias === 0 ? 'Vence hoy' : `Vence en ${dias} día(s)`) + ` — ${fechaTexto}`;
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

const PA_SECCIONES_FICHA = [
  { titulo: 'Identificación', campos: [
    ['marca', 'Marca'], ['modelo', 'Modelo'], ['clase', 'Clase'], ['motor', 'N.º de motor'], ['chasis', 'Chasis'],
  ] },
  { titulo: 'Ruta', campos: [
    ['ruta', 'Ruta'], ['nombre_ruta', 'Nombre de ruta'],
  ] },
  { titulo: 'Propietario y contrato', campos: [
    ['propietario_nit', 'NIT/identificación propietario'], ['propietario_nombre', 'Nombre del propietario'],
    ['contrato', 'N.º de contrato'],
  ] },
];

Router.register('parque-automotor', {
  title: 'Parque automotor',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pa-search').addEventListener('input', () => this._aplicarFiltro());
      document.getElementById('pa-filtro-estado-doc').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-mostrar-desvinculados').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-tbody').addEventListener('click', (e) => {
        const btnFicha = e.target.closest('.pa-ver-ficha');
        if (btnFicha) { this._verDetalle(this._filasRenderizadas[Number(btnFicha.dataset.idx)]); return; }
        const btnDoc = e.target.closest('.pa-ver-doc');
        if (btnDoc) this._abrirDocumento(btnDoc);
      });
      document.getElementById('modal-body').addEventListener('click', (e) => {
        const btnDoc = e.target.closest('.pa-ver-doc');
        if (btnDoc) this._abrirDocumento(btnDoc);
      });
      this._bound = true;
    }

    const [vehiculos, documentos] = await Promise.all([
      DB.getFlotaVehiculos(),
      DB.getFlotaDocumentosEstado(),
    ]);

    const docsPorPlaca = new Map();
    documentos.forEach((d) => {
      if (!docsPorPlaca.has(d.placa)) docsPorPlaca.set(d.placa, []);
      docsPorPlaca.get(d.placa).push(d);
    });

    this._vehiculos = vehiculos
      .map((v) => {
        const docs = (docsPorPlaca.get(v.placa) || []).map((d) => ({
          tipo: d.tipo,
          label: PA_TIPO_LABELS[d.tipo] || d.tipo,
          estado: d.estado_vencimiento,
          tag: PA_ESTADO_TAG[d.estado_vencimiento] || 'inactivo-tag',
          corto: PA_ESTADO_LABEL[d.estado_vencimiento] || d.estado_vencimiento,
          peso: PA_ESTADO_PESO[d.estado_vencimiento] ?? 0,
          texto: paTextoEstado(d),
          fechaTexto: paFormatFecha(d.fecha_vencimiento),
          storagePath: d.storage_path,
          nombreArchivo: d.nombre_archivo_original,
        }));
        const docsTabla = PA_TIPOS_TABLA.map((tipo) =>
          docs.find((d) => d.tipo === tipo) || { tipo, label: PA_TIPO_LABELS[tipo], estado: 'SIN_FECHA', tag: 'inactivo-tag', corto: 'Sin registrar', peso: 0, texto: 'Sin registrar en el Portal de Documentos', fechaTexto: null, storagePath: null }
        );
        const peorEstado = docsTabla.reduce((peor, d) => (d.peso > peor.peso ? d : peor), { peso: -1, estado: 'SIN_FECHA' });
        return {
          placa: v.placa,
          interno: v.interno || '—',
          clase: v.clase || '—',
          vinculado: !!v.vinculado,
          operante: !!v.operante,
          docsTabla,
          docsTodos: docs,
          tieneVencido: docsTabla.some((d) => d.estado === 'VENCIDO'),
          tienePorVencer: docsTabla.some((d) => d.estado === 'POR_VENCER'),
          peorEstado: peorEstado.estado,
          raw: v,
        };
      })
      .sort((a, b) => {
        if (a.vinculado !== b.vinculado) return a.vinculado ? -1 : 1;
        const orden = { VENCIDO: 0, POR_VENCER: 1, VIGENTE: 2, SIN_FECHA: 3 };
        return (orden[a.peorEstado] ?? 9) - (orden[b.peorEstado] ?? 9);
      });

    this._render();
    this._aplicarFiltro();
  },

  async _abrirDocumento(btn) {
    const path = btn.dataset.path;
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Abriendo…';
    try {
      const url = await DB.getUrlDocumentoFlota(path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert('No se pudo abrir el documento: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
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

  // Celda de un documento: tag corto (una palabra, mismo criterio que el
  // resto de tags de la app) + fecha en chico aparte + un botón-ícono "ver"
  // solo si ya existe el archivo real -- así la tabla se lee de un vistazo
  // en vez de una frase larga por celda. El detalle completo (días exactos)
  // queda en el title (tooltip) para quien lo necesite.
  _tagDocumentoHtml(d) {
    const boton = d.storagePath
      ? `<button type="button" class="pa-doc-link pa-ver-doc" data-path="${paEscapeHtml(d.storagePath)}" title="Ver documento" aria-label="Ver documento de ${paEscapeHtml(d.label)}">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14"><path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>`
      : '';
    return `
      <div class="pa-doc-cell">
        <span class="tag ${d.tag}" title="${paEscapeHtml(d.texto)}">${paEscapeHtml(d.corto)}</span>
        ${d.fechaTexto ? `<span class="pa-doc-fecha">${paEscapeHtml(d.fechaTexto)}</span>` : ''}
        ${boton}
      </div>
    `;
  },

  _renderTabla(vehiculos) {
    const tbody = document.getElementById('pa-tbody');
    this._filasRenderizadas = vehiculos;
    if (!vehiculos.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-note">Sin resultados con estos filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = vehiculos.map((v, i) => `
      <tr>
        <td data-label="Vehículo">
          <div class="pa-vehiculo-placa">${paEscapeHtml(v.placa)}</div>
          <div class="pa-vehiculo-sub muted">Interno ${paEscapeHtml(v.interno)} · ${paEscapeHtml(v.clase)}</div>
        </td>
        <td data-label="Estado">
          <span class="tag ${v.vinculado ? 'activo' : 'inactivo-tag'}">${v.vinculado ? 'Vinculado' : 'Desvinculado'}</span>
          ${!v.operante ? '<div style="margin-top:0.3rem"><span class="tag pendiente">No operante</span></div>' : ''}
        </td>
        ${v.docsTabla.map((d) => `<td data-label="${paEscapeHtml(d.label)}">${this._tagDocumentoHtml(d)}</td>`).join('')}
        <td data-label="Ficha"><button type="button" class="btn-secondary pa-ver-ficha" data-idx="${i}">Ver ficha</button></td>
      </tr>
    `).join('');
  },

  _verDetalle(v) {
    const f = v.raw;
    const seccionesHtml = PA_SECCIONES_FICHA.map((s) => `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">${paEscapeHtml(s.titulo)}</h4></div>
        <div class="detalle-grid">${s.campos.map(([campo, label]) => paCampoDetalle(label, f[campo])).join('')}</div>
      </div>
    `).join('');

    const vigenciaHtml = `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Vigencia en la flota</h4></div>
        <div class="detalle-grid">
          ${paCampoDetalle('Fecha de ingreso', paFormatFecha(f.fecha_ingreso))}
          ${paCampoDetalle('Fecha de retiro', paFormatFecha(f.fecha_retiro))}
          ${paCampoDetalle('Fecha de contrato', paFormatFecha(f.fecha_contrato))}
        </div>
      </div>
    `;

    const documentosHtml = `
      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Documentos</h4></div>
        <div class="detalle-grid">
          ${v.docsTodos.map((d) => `
            <div class="detalle-field">
              <div class="detalle-field-label">${paEscapeHtml(d.label)}</div>
              <div class="detalle-field-value">${this._tagDocumentoHtml(d)}</div>
            </div>
          `).join('') || '<p class="empty-note">Sin documentos registrados en el Portal de Documentos.</p>'}
        </div>
      </div>
    `;

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${paEscapeHtml(v.placa)} <span class="muted" style="font-weight:500">· Interno ${paEscapeHtml(v.interno)}</span></div>
          <div class="detalle-sub">${paEscapeHtml(v.clase)}</div>
        </div>
        <div class="detalle-tags">
          <span class="tag ${v.vinculado ? 'activo' : 'inactivo-tag'}">${v.vinculado ? 'Vinculado' : 'Desvinculado'}</span>
          <span class="tag ${v.operante ? 'completo' : 'pendiente'}">${v.operante ? 'Operante' : 'No operante'}</span>
        </div>
      </div>
      ${seccionesHtml}
      ${vigenciaHtml}
      ${documentosHtml}
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },
});
