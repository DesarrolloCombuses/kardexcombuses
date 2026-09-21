// Alertas de vencimientos: documentos de la flota (SOAT, tecnomecánica,
// tarjeta de operación, etc.) ya vencidos o por vencer en los próximos 30
// días, de un vistazo, sin tener que revisar vehículo por vehículo en
// Parque automotor. Mismas tablas que ese módulo hermano
// (flota_vehiculos/flota_documentos_estado, del "Portal de Documentos") --
// ver el comentario de cabecera de js/views/parque-automotor.js. Solo se
// alertan VENCIDO/POR_VENCER: SIN_FECHA es un problema de dato faltante,
// no de vencimiento inminente, y ya es visible en la tabla de ese módulo.

const AV_TIPO_LABELS = {
  SOAT: 'SOAT',
  TECNOMECANICA: 'Tecnomecánica',
  TARJETA_OPERACION: 'Tarjeta de operación',
  MANTENIMIENTO_PREVENTIVO: 'Mantenimiento preventivo',
  CERTIFICACION_AMPARO: 'Certificación de amparo',
  LICENCIA_TRANSITO: 'Licencia de tránsito',
};

function avEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Mismo parseo por componentes que paParseFechaIso (parque-automotor.js):
// evita que "new Date(string)" corra la fecha un día hacia atrás en una
// zona horaria detrás de UTC (Colombia, UTC-5).
function avParseFechaIso(valor) {
  if (!valor) return null;
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function avFormatFecha(valor) {
  const d = avParseFechaIso(valor);
  return d ? d.toLocaleDateString('es-CO') : null;
}

// Negativo = ya venció hace |n| días. Positivo/0 = vence en n días.
function avDiasDesdeHoy(valor) {
  const fecha = avParseFechaIso(valor);
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
}

function avTextoEstado(estado, dias, fechaTexto) {
  if (estado === 'VENCIDO') return `Vencido hace ${Math.abs(dias)} día(s) — ${fechaTexto}`;
  return (dias === 0 ? 'Vence hoy' : `Vence en ${dias} día(s)`) + ` — ${fechaTexto}`;
}

// Cuenta cuántas alertas caen en cada valor de un campo (o "Sin dato" si
// viene vacío), ordenado de mayor a menor cantidad (Sin dato siempre al
// final). Mismo criterio que distribucion() en personal-alertas.js.
function avDistribucion(items, getValor) {
  const counts = new Map();
  items.forEach((item) => {
    const v = getValor(item) || 'Sin dato';
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  const entries = [...counts.entries()];
  return entries.filter(([k]) => k !== 'Sin dato').sort((a, b) => b[1] - a[1])
    .concat(entries.filter(([k]) => k === 'Sin dato'))
    .map(([label, count]) => ({ label, count }));
}

Router.register('alertas-vencimientos', {
  title: 'Alertas de vencimientos',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('av-filtro-ruta').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('av-mostrar-desvinculados').addEventListener('change', () => this._aplicarFiltro());
      document.querySelector('[data-view="alertas-vencimientos"]').addEventListener('click', (e) => {
        const btnDoc = e.target.closest('.av-ver-doc');
        if (btnDoc) this._abrirDocumento(btnDoc);
      });
      this._bound = true;
    }

    const [vehiculos, documentos] = await Promise.all([
      DB.getFlotaVehiculos(),
      DB.getFlotaDocumentosEstado(),
    ]);

    const vehiculosPorPlaca = new Map(vehiculos.map((v) => [v.placa, v]));

    this._alertas = documentos
      .filter((d) => d.estado_vencimiento === 'VENCIDO' || d.estado_vencimiento === 'POR_VENCER')
      .map((d) => {
        const v = vehiculosPorPlaca.get(d.placa);
        if (!v) return null;
        const dias = avDiasDesdeHoy(d.fecha_vencimiento);
        const fechaTexto = avFormatFecha(d.fecha_vencimiento);
        return {
          placa: d.placa,
          interno: v.interno || '—',
          ruta: v.nombre_ruta || v.ruta || null,
          vinculado: !!v.vinculado,
          tipo: d.tipo,
          tipoLabel: AV_TIPO_LABELS[d.tipo] || d.tipo,
          estado: d.estado_vencimiento,
          dias,
          fechaTexto,
          texto: avTextoEstado(d.estado_vencimiento, dias, fechaTexto),
          storagePath: d.storage_path,
        };
      })
      .filter(Boolean);

    // KPIs: por vehículo (no por documento), solo vinculados, mutuamente
    // excluyentes (vencido antes que por-vencer) -- mismo criterio que
    // parque-automotor.js, y fijos: no reaccionan al checkbox de
    // desvinculados, se calculan una sola vez acá.
    const vehiculosConEstado = new Map();
    documentos.forEach((d) => {
      const v = vehiculosPorPlaca.get(d.placa);
      if (!v || !v.vinculado) return;
      const actual = vehiculosConEstado.get(d.placa) || { tieneVencido: false, tienePorVencer: false };
      if (d.estado_vencimiento === 'VENCIDO') actual.tieneVencido = true;
      else if (d.estado_vencimiento === 'POR_VENCER') actual.tienePorVencer = true;
      vehiculosConEstado.set(d.placa, actual);
    });
    const estadosVinculados = [...vehiculosConEstado.values()];
    document.getElementById('av-kpi-vencidos').textContent = estadosVinculados.filter((e) => e.tieneVencido).length;
    document.getElementById('av-kpi-por-vencer').textContent = estadosVinculados.filter((e) => !e.tieneVencido && e.tienePorVencer).length;

    this._llenarFiltroRuta(this._alertas);
    this._aplicarFiltro();
  },

  _llenarFiltroRuta(alertas) {
    const sel = document.getElementById('av-filtro-ruta');
    const actual = sel.value;
    const opciones = [...new Set(alertas.map((a) => a.ruta).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${avEscapeHtml(v)}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const ruta = document.getElementById('av-filtro-ruta').value;
    const mostrarDesvinculados = document.getElementById('av-mostrar-desvinculados').checked;

    let filtrados = this._alertas;
    if (!mostrarDesvinculados) filtrados = filtrados.filter((a) => a.vinculado);
    if (ruta) filtrados = filtrados.filter((a) => a.ruta === ruta);

    // dias negativo (vencido, más negativo = más vencido) y dias 0-30 (por
    // vencer, más chico = más urgente) -- el mismo comparador ordena bien
    // ambas listas.
    const vencidos = filtrados.filter((a) => a.estado === 'VENCIDO').sort((a, b) => a.dias - b.dias);
    const porVencer = filtrados.filter((a) => a.estado === 'POR_VENCER').sort((a, b) => a.dias - b.dias);

    document.getElementById('av-contador').textContent = `${filtrados.length} alerta(s)`;
    this._renderLista('av-lista-vencidos', vencidos, 'Sin documentos vencidos con estos filtros.');
    this._renderLista('av-lista-por-vencer', porVencer, 'Sin documentos por vencer con estos filtros.');
    this._renderRankedBars('av-bars-vencidos-ruta', avDistribucion(vencidos, (a) => a.ruta));
    this._renderRankedBars('av-bars-porvencer-ruta', avDistribucion(porVencer, (a) => a.ruta));
  },

  _renderLista(elId, items, vacioTexto) {
    const el = document.getElementById(elId);
    el.innerHTML = items.length === 0
      ? `<p class="empty-note">${vacioTexto}</p>`
      : items.map((a) => `
        <div class="detalle-list-item">
          <span class="detalle-list-item-main">${avEscapeHtml(a.placa)} · Interno ${avEscapeHtml(a.interno)}</span>
          <span class="detalle-list-item-sub">${avEscapeHtml(a.tipoLabel)} · ${avEscapeHtml(a.texto)}${a.ruta ? ' · Ruta ' + avEscapeHtml(a.ruta) : ''}</span>
          ${a.storagePath ? `
            <button type="button" class="pa-doc-link av-ver-doc" data-path="${avEscapeHtml(a.storagePath)}" title="Ver documento" aria-label="Ver documento de ${avEscapeHtml(a.tipoLabel)}">
              <svg viewBox="0 0 20 20" fill="none" width="14" height="14"><path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.6"/></svg>
            </button>
          ` : ''}
        </div>
      `).join('');
  },

  async _abrirDocumento(btn) {
    const path = btn.dataset.path;
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    try {
      const url = await DB.getUrlDocumentoFlota(path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert('No se pudo abrir el documento: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  },

  // Ranking tipo "leaderboard" (rango + barra a color + %) -- mismo patrón
  // que personal-alertas.js.
  _renderRankedBars(elId, dist) {
    const el = document.getElementById(elId);
    const total = dist.reduce((s, d) => s + d.count, 0);
    if (total === 0) {
      el.innerHTML = '<p class="empty-note">Sin datos todavía.</p>';
      return;
    }
    const max = Math.max(...dist.map((d) => d.count)) || 1;
    let colorIdx = 0;
    el.innerHTML = dist.map((d, i) => {
      const esSinDato = d.label === 'Sin dato';
      const color = esSinDato ? '#c9d0db' : this._palette[colorIdx++ % this._palette.length];
      const pct = (d.count / total) * 100;
      return `
        <div class="ranked-row ${i === 0 && !esSinDato ? 'top-rank' : ''}">
          <span class="ranked-rank">${i + 1}</span>
          <div class="ranked-body">
            <div class="ranked-top-row">
              <span class="ranked-label" title="${avEscapeHtml(d.label)}">${avEscapeHtml(d.label)}</span>
              <span class="ranked-value">${d.count}<span class="ranked-pct">(${pct.toFixed(0)}%)</span></span>
            </div>
            <span class="ranked-track"><span class="ranked-fill" data-pct="${(d.count / max) * 100}" style="background:${color}"></span></span>
          </div>
        </div>
      `;
    }).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.ranked-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
    });
  },
});
