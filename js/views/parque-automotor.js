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

// Las fechas van al Excel como número de serie (no como texto) para que allá
// se puedan ordenar y filtrar como fecha de verdad. El cálculo es manual y no
// con new Date(...): construir la fecha desde el ISO y restar la época de
// Excel arrastra el desfase de zona horaria y deja "6/9 23:59" en vez de 7/9.
// Mismo criterio y mismo motivo que en js/views/empleados.js.
function paFechaCeldaExcel(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const [, y, mes, d] = m.map(Number);
  return Math.round((Date.UTC(y, mes - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Días que faltan (o que ya pasaron, en negativo) para un vencimiento. La
// tabla muestra esto como frase; en el Excel va como número para poder
// ordenar por "lo más vencido" o filtrar "menos de 15 días".
function paDiasParaVencer(iso) {
  const fecha = paParseFechaIso(iso);
  if (!fecha) return '';
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
}

// Hoja "Vehículos": TODAS las columnas de flota_vehiculos. La tabla en
// pantalla solo muestra placa/interno/clase/ruta y cuatro documentos; el
// resto (motor, chasis, propietario, contrato) vivía únicamente dentro de la
// ficha, de a un vehículo por vez -- que es justo lo que hacía imposible
// cruzar el parque completo en una hoja de cálculo.
const PA_COLUMNAS_VEHICULO = [
  { label: 'Placa', get: (v) => v.raw.placa || '' },
  { label: 'Interno', get: (v) => v.raw.interno || '' },
  { label: 'Vinculado', get: (v) => (v.raw.vinculado ? 'Sí' : 'No') },
  { label: 'Operante', get: (v) => (v.raw.operante ? 'Sí' : 'No') },
  { label: 'Estado de documentos', get: (v) => PA_ESTADO_LABEL[v.peorEstado] || v.peorEstado },
  { label: 'Marca', get: (v) => v.raw.marca || '' },
  { label: 'Modelo', get: (v) => v.raw.modelo || '' },
  { label: 'Clase', get: (v) => v.raw.clase || '' },
  { label: 'N.º de motor', get: (v) => v.raw.motor || '' },
  { label: 'Chasis', get: (v) => v.raw.chasis || '' },
  { label: 'Ruta', get: (v) => v.raw.ruta || '' },
  { label: 'Nombre de ruta', get: (v) => v.raw.nombre_ruta || '' },
  { label: 'NIT propietario', get: (v) => v.raw.propietario_nit || '' },
  { label: 'Propietario', get: (v) => v.raw.propietario_nombre || '' },
  { label: 'N.º de contrato', get: (v) => v.raw.contrato || '' },
  { label: 'Fecha de contrato', get: (v) => paFechaCeldaExcel(v.raw.fecha_contrato), fecha: true },
  { label: 'Fecha de ingreso', get: (v) => paFechaCeldaExcel(v.raw.fecha_ingreso), fecha: true },
  { label: 'Fecha de retiro', get: (v) => paFechaCeldaExcel(v.raw.fecha_retiro), fecha: true },
];

// Los 6 tipos del enum, no los 4 de la tabla: certificación de amparo y
// licencia de tránsito los tiene poco más de la mitad de la flota, y saber
// exactamente a quién le faltan es media razón para bajar el archivo.
const PA_TIPOS_EXPORT = Object.keys(PA_TIPO_LABELS);

Router.register('parque-automotor', {
  title: 'Parque automotor',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pa-search').addEventListener('input', () => this._aplicarFiltro());
      document.getElementById('pa-filtro-estado-doc').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-filtro-ruta').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-mostrar-desvinculados').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('pa-export-btn').addEventListener('click', () => this._exportExcel());
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
          // Solo los usa el Excel: en pantalla no se muestran, pero son
          // justo lo que contabilidad/operaciones pide cuando audita quién
          // cargó un documento y si alguien ya lo revisó.
          fechaIso: d.fecha_vencimiento,
          subidoPorConductor: !!d.subido_por_conductor,
          revisado: !!d.revisado,
          cargadoAt: d.created_at,
        }));
        const docsTabla = PA_TIPOS_TABLA.map((tipo) =>
          docs.find((d) => d.tipo === tipo) || { tipo, label: PA_TIPO_LABELS[tipo], estado: 'SIN_FECHA', tag: 'inactivo-tag', corto: 'Sin registrar', peso: 0, texto: 'Sin registrar en el Portal de Documentos', fechaTexto: null, storagePath: null }
        );
        const peorEstado = docsTabla.reduce((peor, d) => (d.peso > peor.peso ? d : peor), { peso: -1, estado: 'SIN_FECHA' });
        return {
          placa: v.placa,
          interno: v.interno || '—',
          clase: v.clase || '—',
          ruta: v.nombre_ruta || v.ruta || null,
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

    this._llenarFiltroRuta(this._vehiculos);
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

  // Ruta se llena con los valores que realmente existen en los datos (no
  // una lista fija), mismo patrón que el filtro de cargo de Empleados.
  _llenarFiltroRuta(vehiculos) {
    const sel = document.getElementById('pa-filtro-ruta');
    const actual = sel.value;
    const opciones = [...new Set(vehiculos.map((v) => v.ruta).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${paEscapeHtml(v)}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const q = document.getElementById('pa-search').value.trim().toLowerCase();
    const estadoDoc = document.getElementById('pa-filtro-estado-doc').value;
    const ruta = document.getElementById('pa-filtro-ruta').value;
    const mostrarDesvinculados = document.getElementById('pa-mostrar-desvinculados').checked;

    let filtrados = this._vehiculos;
    if (!mostrarDesvinculados) filtrados = filtrados.filter((v) => v.vinculado);
    if (estadoDoc === 'vencido') filtrados = filtrados.filter((v) => v.tieneVencido);
    else if (estadoDoc === 'por_vencer') filtrados = filtrados.filter((v) => !v.tieneVencido && v.tienePorVencer);
    else if (estadoDoc === 'al_dia') filtrados = filtrados.filter((v) => !v.tieneVencido && !v.tienePorVencer);
    if (ruta) filtrados = filtrados.filter((v) => v.ruta === ruta);
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

  // Baja lo que el usuario está viendo (los mismos filtros de la pantalla),
  // no siempre la flota entera: si filtró "con algún vencido" y le bajara
  // igual los 135 vehículos, el archivo no respondería a lo que pidió.
  // Mismo criterio que el export de Empleados.
  async _exportExcel() {
    const btn = document.getElementById('pa-export-btn');
    const vehiculos = this._filasRenderizadas || [];
    if (!vehiculos.length) {
      alert('No hay vehículos para exportar con estos filtros.');
      return;
    }
    btn.disabled = true;
    Loading.show('Preparando Excel…');
    try {
      this._buildExcel(vehiculos);
    } catch (err) {
      alert('No se pudo generar el Excel: ' + err.message);
    } finally {
      btn.disabled = false;
      Loading.hide();
    }
  },

  // Dos hojas, porque son dos preguntas distintas:
  //  - "Vehículos": una fila por bus, con toda su ficha y el estado de cada
  //    uno de los 6 documentos al lado. Sirve para cruzar el parque.
  //  - "Documentos": una fila por documento. Sirve para ordenar por días
  //    vencidos o filtrar por tipo sin pelear con columnas repetidas.
  _buildExcel(vehiculos) {
    const libro = XLSX.utils.book_new();
    const fechaArchivo = new Date().toISOString().slice(0, 10);

    // ---------- Hoja 1: un renglón por vehículo ----------
    const colsDoc = [];
    PA_TIPOS_EXPORT.forEach((tipo) => {
      const label = PA_TIPO_LABELS[tipo];
      colsDoc.push({ label: `${label} — estado`, tipo, campo: 'estado' });
      colsDoc.push({ label: `${label} — vence`, tipo, campo: 'vence', fecha: true });
      colsDoc.push({ label: `${label} — días`, tipo, campo: 'dias' });
      colsDoc.push({ label: `${label} — archivo`, tipo, campo: 'archivo' });
    });

    const headerV = [...PA_COLUMNAS_VEHICULO.map((c) => c.label), ...colsDoc.map((c) => c.label)];
    const fechasV = new Set([
      ...PA_COLUMNAS_VEHICULO.filter((c) => c.fecha).map((c) => c.label),
      ...colsDoc.filter((c) => c.fecha).map((c) => c.label),
    ]);

    const filasV = vehiculos.map((v) => {
      const fila = {};
      PA_COLUMNAS_VEHICULO.forEach((c) => { fila[c.label] = c.get(v); });
      colsDoc.forEach((c) => {
        const d = v.docsTodos.find((x) => x.tipo === c.tipo);
        if (!d) {
          // Sin fila en el Portal de Documentos: no es lo mismo que "sin
          // fecha". Se dice explícitamente en vez de dejar la celda vacía,
          // que se leería como un dato que se perdió al exportar.
          fila[c.label] = c.campo === 'estado' ? 'No registrado' : '';
          return;
        }
        if (c.campo === 'estado') fila[c.label] = PA_ESTADO_LABEL[d.estado] || d.estado;
        else if (c.campo === 'vence') fila[c.label] = paFechaCeldaExcel(d.fechaIso);
        else if (c.campo === 'dias') fila[c.label] = d.fechaIso ? paDiasParaVencer(d.fechaIso) : '';
        else fila[c.label] = d.storagePath ? 'Sí' : 'No';
      });
      return fila;
    });

    XLSX.utils.book_append_sheet(libro, this._hoja(filasV, headerV, fechasV), 'Vehículos');

    // ---------- Hoja 2: un renglón por documento ----------
    const headerD = ['Placa', 'Interno', 'Vinculado', 'Ruta', 'Documento', 'Estado',
      'Vence', 'Días', 'Archivo cargado', 'Nombre del archivo',
      'Lo subió el conductor', 'Revisado', 'Fecha de carga'];
    const fechasD = new Set(['Vence', 'Fecha de carga']);

    const filasD = [];
    vehiculos.forEach((v) => {
      PA_TIPOS_EXPORT.forEach((tipo) => {
        const d = v.docsTodos.find((x) => x.tipo === tipo);
        filasD.push({
          'Placa': v.raw.placa || '',
          'Interno': v.raw.interno || '',
          'Vinculado': v.raw.vinculado ? 'Sí' : 'No',
          'Ruta': v.raw.nombre_ruta || v.raw.ruta || '',
          'Documento': PA_TIPO_LABELS[tipo],
          'Estado': d ? (PA_ESTADO_LABEL[d.estado] || d.estado) : 'No registrado',
          'Vence': d ? paFechaCeldaExcel(d.fechaIso) : '',
          'Días': d && d.fechaIso ? paDiasParaVencer(d.fechaIso) : '',
          'Archivo cargado': d && d.storagePath ? 'Sí' : 'No',
          'Nombre del archivo': (d && d.nombreArchivo) || '',
          'Lo subió el conductor': d ? (d.subidoPorConductor ? 'Sí' : 'No') : '',
          'Revisado': d ? (d.revisado ? 'Sí' : 'No') : '',
          'Fecha de carga': d && d.cargadoAt ? paFechaCeldaExcel(String(d.cargadoAt).slice(0, 10)) : '',
        });
      });
    });

    XLSX.utils.book_append_sheet(libro, this._hoja(filasD, headerD, fechasD), 'Documentos');

    XLSX.writeFile(libro, `parque-automotor-combuses-${fechaArchivo}.xlsx`);
  },

  // Arma una hoja con el formato de fecha aplicado a las columnas que lo
  // llevan (si no, el número de serie se ve como 46000 y nadie entiende qué
  // es) y un ancho de columna proporcional al título.
  _hoja(filas, header, columnasFecha) {
    const hoja = XLSX.utils.json_to_sheet(filas, { header });
    const rango = XLSX.utils.decode_range(hoja['!ref']);
    for (let col = rango.s.c; col <= rango.e.c; col++) {
      if (!columnasFecha.has(header[col])) continue;
      for (let row = rango.s.r + 1; row <= rango.e.r; row++) {
        const celda = hoja[XLSX.utils.encode_cell({ r: row, c: col })];
        if (celda && celda.t === 'n') celda.z = 'd/m/yyyy';
      }
    }
    hoja['!cols'] = header.map((h) => ({ wch: Math.min(Math.max(h.length + 2, 10), 34) }));
    // Sin congelar el encabezado: se probó con '!freeze' y la edición
    // comunitaria de SheetJS lo ignora al escribir (se verificó abriendo el
    // .xlsx generado con openpyxl -- freeze_panes llega en None). Quien lo
    // necesite lo fija en Excel con Vista > Inmovilizar.
    return hoja;
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
