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
    if (!vehiculos.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-note">Sin resultados con estos filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = vehiculos.map((v) => `
      <tr>
        <td data-label="Interno">${paEscapeHtml(v.interno)}</td>
        <td data-label="Placa">${paEscapeHtml(v.placa)}</td>
        <td data-label="Clase">${paEscapeHtml(v.clase)}</td>
        <td data-label="Estado"><span class="tag ${v.vinculado ? 'activo' : 'inactivo-tag'}">${paEscapeHtml(v.estado || 'Sin dato')}</span></td>
        ${v.docs.map((d) => `<td data-label="${paEscapeHtml(d.label)}"><span class="tag ${d.tag}" title="${paEscapeHtml(d.texto)}">${paEscapeHtml(d.texto)}</span></td>`).join('')}
      </tr>
    `).join('');
  },
});
