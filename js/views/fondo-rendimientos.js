// Contabilidad > Rendimientos del fondo.
//
// Dos cosas distintas que contabilidad lleva en la misma hoja:
//  - Los rendimientos mes a mes del año en curso (lo que el fondo produce).
//  - El corte histórico acumulado por vehículo (aportes y rendimientos de
//    2023 a 2025, con el total de cada propietario).
// Más el detalle de de dónde salieron los rendimientos (fiducia, cuentas de
// ahorro), que es el cuadro "ingresos" del resumen.

function frEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function frPesos(valor, decimales = 0) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: decimales, minimumFractionDigits: decimales,
  });
}

const FR_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Barras horizontales en orden cronológico (no rankeadas): el orden de los
// meses es la información, no cuál rindió más.
function frRenderMeses(elId, filas) {
  const el = document.getElementById(elId);
  const conValor = filas.filter((f) => f.valor);
  if (!conValor.length) {
    el.innerHTML = '<p class="empty-note">Todavía no hay rendimientos cargados para este año.</p>';
    return;
  }
  const max = Math.max(...conValor.map((f) => f.valor));
  el.innerHTML = filas.map((f) => `
    <div class="bar-row">
      <span class="bar-label" title="${frEscapeHtml(f.label)}">${frEscapeHtml(f.label)}</span>
      <span class="bar-track"><span class="bar-fill" data-pct="${f.valor ? (f.valor / max) * 100 : 0}"></span></span>
      <span class="bar-value">${f.valor ? frPesos(f.valor) : '—'}</span>
    </div>
  `).join('');
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
  });
}

Router.register('fondo-rendimientos', {
  title: 'Rendimientos del fondo',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('fr-buscar').addEventListener('input', () => this._renderTabla());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [rendimientos, vehiculos, resumen, flota] = await Promise.all([
      DB.getFondoRendimientos(),
      DB.getFondoVehiculos(),
      DB.getFondoResumen(),
      DB.getFlotaVehiculos().catch(() => []),
    ]);
    this._rendimientos = rendimientos;
    this._vehiculos = new Map(vehiculos.map((v) => [v.interno, v]));
    this._resumen = resumen;
    this._flota = new Map();
    (flota || []).forEach((v) => {
      if (!v.interno) return;
      const previo = this._flota.get(v.interno);
      if (!previo || (v.vinculado && !previo.vinculado)) this._flota.set(v.interno, v);
    });
    this._render();
  },

  _valorResumen(etiqueta) {
    const fila = (this._resumen || []).find((r) => r.etiqueta === etiqueta);
    return fila ? Number(fila.valor) : null;
  },

  _render() {
    const meses = (this._resumen || []).filter((r) => r.grupo === 'rendimiento_mes');
    const totalAnio = meses.reduce((s, m) => s + (Number(m.valor) || 0), 0);
    const conDato = meses.filter((m) => m.valor);

    document.getElementById('fr-kpi-acumulado').textContent = frPesos(this._valorResumen('Rendimientos'));
    document.getElementById('fr-kpi-anio').textContent = frPesos(totalAnio);
    document.getElementById('fr-kpi-promedio').textContent =
      conDato.length ? frPesos(totalAnio / conDato.length) : '—';
    document.getElementById('fr-kpi-vehiculos').textContent = this._rendimientos.length;

    frRenderMeses('fr-bars-meses', meses.map((m) => ({
      label: m.periodo ? `${FR_MESES[Number(String(m.periodo).slice(5, 7)) - 1]} ${String(m.periodo).slice(0, 4)}` : m.etiqueta,
      valor: Number(m.valor) || 0,
    })));

    const ingresos = (this._resumen || []).filter((r) => r.grupo === 'ingreso');
    const elIngresos = document.getElementById('fr-ingresos');
    elIngresos.innerHTML = ingresos.length
      ? ingresos.map((i) => `
          <div class="fondo-mov">
            <div class="fondo-mov-texto"><span class="fondo-mov-etiqueta">${frEscapeHtml(i.etiqueta)}</span></div>
            <span class="fondo-mov-valor">${frPesos(i.valor)}</span>
          </div>
        `).join('')
      : '<p class="empty-note">Sin detalle de ingresos cargado.</p>';

    this._renderTabla();
  },

  _renderTabla() {
    const filtro = (document.getElementById('fr-buscar').value || '').trim().toLowerCase();
    const filas = this._rendimientos
      .map((r) => {
        const v = this._vehiculos.get(r.interno);
        const f = this._flota.get(r.interno);
        return {
          ...r,
          propietario: v ? (v.propietario || '') : '',
          nit: v ? (v.nit || '') : '',
          placa: f ? f.placa : null,
        };
      })
      .filter((r) => !filtro
        || r.interno.includes(filtro)
        || r.propietario.toLowerCase().includes(filtro)
        || r.nit.toLowerCase().includes(filtro)
        || (r.placa || '').toLowerCase().includes(filtro))
      .sort((a, b) => Number(a.interno) - Number(b.interno));

    const totalRend = filas.reduce((s, r) => s + (Number(r.rendimientos_2023) || 0)
      + (Number(r.rendimientos_2024) || 0) + (Number(r.rendimientos_2025) || 0), 0);
    document.getElementById('fr-contador').textContent =
      `${filas.length} de ${this._rendimientos.length} vehículo(s) · ${frPesos(totalRend)} en rendimientos`;

    const tbody = document.querySelector('#fr-tabla tbody');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-note">Ningún vehículo coincide con la búsqueda.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((r) => `
      <tr>
        <td data-label="Interno"><strong>${frEscapeHtml(r.interno)}</strong></td>
        <td data-label="Placa">${frEscapeHtml(r.placa || '—')}</td>
        <td data-label="Propietario">${frEscapeHtml(r.propietario || '—')}</td>
        <td data-label="Rend. 2023" class="num">${frPesos(r.rendimientos_2023)}</td>
        <td data-label="Rend. 2024" class="num">${frPesos(r.rendimientos_2024)}</td>
        <td data-label="Rend. 2025" class="num">${frPesos(r.rendimientos_2025)}</td>
        <td data-label="Total" class="num"><strong>${frPesos(r.total_propietario)}</strong></td>
      </tr>
    `).join('');
  },
});
