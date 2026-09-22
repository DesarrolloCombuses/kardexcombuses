// Contabilidad > Fondo de reposición de siniestros.
//
// Muestra el fondo tal como lo lleva contabilidad: el cuadro de movimientos
// del fondo completo (saldos por año, conciliaciones pagadas, inversión) y
// el aporte de cada vehículo mes a mes.
//
// Los aportes se guardan por interno de vehículo; la placa y la ruta salen
// de flota_vehiculos (parque automotor) cruzando por ese interno. OJO: hay
// internos con más de un registro en la flota (el mismo número reasignado a
// otra placa), así que el cruce se queda con el vehículo vinculado -- ver
// _indexarFlota.

function fsEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fsPesos(valor, decimales = 0) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: decimales, minimumFractionDigits: decimales,
  });
}

const FS_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fsEtiquetaPeriodo(periodo) {
  const m = String(periodo).match(/^(\d{4})-(\d{2})/);
  if (!m) return periodo;
  return `${FS_MESES[Number(m[2]) - 1]} ${m[1].slice(2)}`;
}

function fsEtiquetaPeriodoLarga(periodo) {
  const m = String(periodo).match(/^(\d{4})-(\d{2})/);
  if (!m) return periodo;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const s = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Columnas verticales de una sola serie. Usa el mismo markup y CSS que la
// gráfica de Rotación de personal (.col-chart), solo que con una barra por
// período en vez de dos.
function fsRenderColumnas(elId, filas) {
  const el = document.getElementById(elId);
  if (!filas.length) {
    el.innerHTML = '<p class="empty-note">Sin aportes cargados.</p>';
    return;
  }
  const max = Math.max(1, ...filas.map((f) => f.valor));
  el.innerHTML = `
    <div class="col-chart-inner">
      <div class="col-chart-plot">
        ${filas.map((f) => `
          <div class="col-bars" title="${fsEscapeHtml(f.titulo)}: ${fsPesos(f.valor)}">
            <span class="col-bar in" data-pct="${(f.valor / max) * 100}"><span class="col-bar-value">${f.corto}</span></span>
          </div>
        `).join('')}
      </div>
      <div class="col-chart-axis">
        ${filas.map((f) => `<span class="col-label">${fsEscapeHtml(f.label)}</span>`).join('')}
      </div>
    </div>
  `;
  requestAnimationFrame(() => {
    el.querySelectorAll('.col-bar').forEach((bar) => { bar.style.height = bar.dataset.pct + '%'; });
    el.scrollLeft = el.scrollWidth;
  });
}

// Millones con un decimal: el valor completo en pesos no cabe encima de una
// columna de 34px y el tooltip ya lleva la cifra exacta.
function fsMillones(valor) {
  if (!valor) return '';
  return (valor / 1e6).toFixed(valor >= 1e7 ? 0 : 1) + 'M';
}

Router.register('fondo-siniestros', {
  title: 'Fondo de reposición',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('fs-buscar').addEventListener('input', () => this._renderTabla());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [vehiculos, aportes, resumen, flota] = await Promise.all([
      DB.getFondoVehiculos(),
      DB.getFondoAportes(),
      DB.getFondoResumen(),
      DB.getFlotaVehiculos().catch(() => []),
    ]);
    this._vehiculos = vehiculos;
    this._aportes = aportes;
    this._resumen = resumen;
    this._flota = this._indexarFlota(flota);
    this._render();
  },

  // Un interno puede aparecer más de una vez en la flota (número reasignado
  // a otra placa). Se prefiere el vehículo vinculado; si ninguno lo está,
  // queda el primero, para no dejar la fila sin placa.
  _indexarFlota(flota) {
    const porInterno = new Map();
    (flota || []).forEach((v) => {
      if (!v.interno) return;
      const previo = porInterno.get(v.interno);
      if (!previo || (v.vinculado && !previo.vinculado)) porInterno.set(v.interno, v);
    });
    return porInterno;
  },

  _valorResumen(etiqueta) {
    const fila = (this._resumen || []).find((r) => r.etiqueta === etiqueta);
    return fila ? Number(fila.valor) : null;
  },

  _render() {
    // Totales por vehículo y por período, en una sola pasada. El saldo
    // inicial se separa de los aportes del año: es el acumulado con que
    // arranca cada vehículo, no plata recaudada este año (ver la columna
    // es_saldo_inicial en sql/contabilidad_fondo_2026-09-22.sql).
    this._porVehiculo = new Map();
    this._porPeriodo = new Map();
    this._saldoInicial = 0;
    this._periodoSaldoInicial = null;
    this._aportes.forEach((a) => {
      const valor = Number(a.valor) || 0;
      this._porVehiculo.set(a.interno, (this._porVehiculo.get(a.interno) || 0) + valor);
      if (a.es_saldo_inicial) {
        this._saldoInicial += valor;
        this._periodoSaldoInicial = a.periodo;
        return;
      }
      this._porPeriodo.set(a.periodo, (this._porPeriodo.get(a.periodo) || 0) + valor);
    });
    this._aportadoEsteAnio = [...this._porPeriodo.values()].reduce((s, v) => s + v, 0);

    document.getElementById('fs-kpi-total').textContent = fsPesos(this._valorResumen('TOTAL FONDO'));
    document.getElementById('fs-kpi-aportes').textContent = fsPesos(this._valorResumen('Aportes totales'));
    document.getElementById('fs-kpi-rendimientos').textContent = fsPesos(this._valorResumen('Rendimientos'));
    document.getElementById('fs-kpi-disponible').textContent = fsPesos(this._valorResumen('Disponible'));

    const periodos = [...this._porPeriodo.keys()].sort();
    fsRenderColumnas('fs-col-chart', periodos.map((p) => ({
      label: fsEtiquetaPeriodo(p),
      titulo: fsEtiquetaPeriodoLarga(p),
      corto: fsMillones(this._porPeriodo.get(p)),
      valor: this._porPeriodo.get(p),
    })));

    const pie = document.getElementById('fs-chart-pie');
    pie.textContent = this._saldoInicial
      ? `No incluye el saldo con que arrancó el año (${fsPesos(this._saldoInicial)}, columna ${fsEtiquetaPeriodoLarga(this._periodoSaldoInicial)} del archivo), que es acumulado de años anteriores y no un recaudo del mes. Recaudado en lo corrido del año: ${fsPesos(this._aportadoEsteAnio)}.`
      : '';
    pie.classList.toggle('hidden', !this._saldoInicial);

    this._renderAviso();
    this._renderMovimientos();
    this._renderTabla();
  },

  // Control de consistencia: el cuadro de resumen lo escribe contabilidad a
  // mano, así que puede quedar atrasado respecto a las columnas de aportes
  // (pasó con el corte de agosto 2026). Si no cuadran, se dice en pantalla
  // en vez de mostrar dos cifras distintas sin explicación.
  _renderAviso() {
    const el = document.getElementById('fs-aviso');
    const totalCuadro = this._valorResumen('Aportes totales');
    const totalReal = this._saldoInicial + this._aportadoEsteAnio;
    const diferencia = totalCuadro === null ? 0 : totalReal - totalCuadro;
    if (Math.abs(diferencia) < 1) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <strong>Los aportes cargados no cuadran con el cuadro de resumen.</strong>
      La suma real de los aportes por vehículo da ${fsPesos(totalReal)}, mientras que el
      cuadro declara ${fsPesos(totalCuadro)} en "Aportes totales" — una diferencia de
      ${fsPesos(Math.abs(diferencia))}. Suele pasar porque el cuadro se actualiza a mano y quedó
      un corte atrasado. Las cifras de las tarjetas de arriba vienen del cuadro.
    `;
  },

  _renderMovimientos() {
    const movimientos = (this._resumen || []).filter((r) => r.grupo === 'movimiento');
    const el = document.getElementById('fs-movimientos');
    if (!movimientos.length) {
      el.innerHTML = '<p class="empty-note">Sin movimientos cargados.</p>';
      return;
    }
    // Las cifras que son un total (no un movimiento más) se marcan para que
    // no se lean como una entrada/salida cualquiera del fondo.
    const esTotal = (e) => /^(Aportes totales|TOTAL FONDO|Disponible|Total rendimientos)/i.test(e);
    el.innerHTML = movimientos.map((m) => {
      const valor = Number(m.valor);
      const negativo = valor < 0;
      return `
        <div class="fondo-mov ${esTotal(m.etiqueta) ? 'es-total' : ''}">
          <div class="fondo-mov-texto">
            <span class="fondo-mov-etiqueta">${fsEscapeHtml(m.etiqueta)}</span>
            ${m.detalle ? `<span class="fondo-mov-detalle">${fsEscapeHtml(m.detalle)}</span>` : ''}
          </div>
          <span class="fondo-mov-valor ${negativo ? 'negativo' : ''}">${fsPesos(valor)}</span>
        </div>
      `;
    }).join('');
  },

  _renderTabla() {
    const filtro = (document.getElementById('fs-buscar').value || '').trim().toLowerCase();
    const filas = this._vehiculos
      .map((v) => {
        const flota = this._flota.get(v.interno);
        return {
          interno: v.interno,
          propietario: v.propietario || '',
          nit: v.nit || '',
          placa: flota ? flota.placa : null,
          ruta: flota ? (flota.nombre_ruta || flota.ruta) : null,
          total: this._porVehiculo.get(v.interno) || 0,
        };
      })
      .filter((f) => !filtro
        || f.interno.includes(filtro)
        || f.propietario.toLowerCase().includes(filtro)
        || f.nit.toLowerCase().includes(filtro)
        || (f.placa || '').toLowerCase().includes(filtro))
      .sort((a, b) => Number(a.interno) - Number(b.interno));

    document.getElementById('fs-contador').textContent =
      `${filas.length} de ${this._vehiculos.length} vehículo(s) · ${fsPesos(filas.reduce((s, f) => s + f.total, 0))}`;

    const tbody = document.querySelector('#fs-tabla tbody');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Ningún vehículo coincide con la búsqueda.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((f) => `
      <tr>
        <td data-label="Interno"><strong>${fsEscapeHtml(f.interno)}</strong></td>
        <td data-label="Placa">${fsEscapeHtml(f.placa || '—')}</td>
        <td data-label="Ruta">${fsEscapeHtml(f.ruta || '—')}</td>
        <td data-label="Propietario">${fsEscapeHtml(f.propietario || '—')}</td>
        <td data-label="Aportado" class="num">${fsPesos(f.total)}</td>
        <td data-label="Detalle"><button type="button" class="btn-ghost btn-sm" data-ver-fondo="${fsEscapeHtml(f.interno)}">Ver meses</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-ver-fondo]').forEach((btn) => {
      btn.addEventListener('click', () => this._verVehiculo(btn.dataset.verFondo));
    });
  },

  _verVehiculo(interno) {
    const vehiculo = this._vehiculos.find((v) => v.interno === interno);
    const flota = this._flota.get(interno);
    const meses = this._aportes
      .filter((a) => a.interno === interno)
      .sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
    const total = meses.reduce((s, m) => s + Number(m.valor || 0), 0);

    document.getElementById('modal-body').innerHTML = `
      <h3 style="margin:0 0 0.35rem">Interno ${fsEscapeHtml(interno)}${flota && flota.placa ? ' · ' + fsEscapeHtml(flota.placa) : ''}</h3>
      <p class="muted" style="margin:0 0 1.2rem">
        ${fsEscapeHtml(vehiculo ? (vehiculo.propietario || 'Sin propietario') : 'Sin propietario')}
        ${vehiculo && vehiculo.nit ? ' · NIT ' + fsEscapeHtml(vehiculo.nit) : ''}
        ${flota && (flota.nombre_ruta || flota.ruta) ? ' · Ruta ' + fsEscapeHtml(flota.nombre_ruta || flota.ruta) : ''}
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Mes</th><th class="num">Aporte</th></tr></thead>
          <tbody>
            ${meses.map((m) => `
              <tr>
                <td data-label="Mes">${fsEscapeHtml(fsEtiquetaPeriodoLarga(m.periodo))}</td>
                <td data-label="Aporte" class="num">${fsPesos(m.valor)}</td>
              </tr>
            `).join('')}
            <tr class="fila-total">
              <td data-label="Mes"><strong>Total aportado</strong></td>
              <td data-label="Aporte" class="num"><strong>${fsPesos(total)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },
});
