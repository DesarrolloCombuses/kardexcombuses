// Contabilidad > Fondos de reposición.
//
// Sirve para los dos fondos que lleva contabilidad (siniestros y urbano) con
// el mismo código: se eligen desde el selector de arriba. Tienen la misma
// forma -- aportes mensuales por vehículo más un cuadro de resumen -- pero
// difieren en el detalle:
//   * el urbano trae placa propia y 10 años de historia (103 meses); el de
//     siniestros, 9 meses y sin placa (se toma del parque automotor);
//   * cada uno nombra sus cifras de resumen distinto ("TOTAL FONDO" vs
//     "TOTAL", "Aportes totales" vs "INGRESOS ENERO A DICIEMBRE").
// Por eso los KPIs de arriba se calculan de los aportes reales en vez de
// leerse del cuadro: así significan lo mismo en cualquier fondo. El cuadro
// de contabilidad se muestra completo más abajo, tal como viene.

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

function fsAnio(periodo) { return String(periodo).slice(0, 4); }

function fsEtiquetaPeriodo(periodo) {
  const m = String(periodo).match(/^(\d{4})-(\d{2})/);
  return m ? `${FS_MESES[Number(m[2]) - 1]} ${m[1].slice(2)}` : periodo;
}

function fsEtiquetaPeriodoLarga(periodo) {
  const m = String(periodo).match(/^(\d{4})-(\d{2})/);
  if (!m) return periodo;
  const s = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Millones con un decimal: la cifra completa no cabe encima de una columna
// de 34px y el tooltip ya lleva el valor exacto.
function fsMillones(valor) {
  if (!valor) return '';
  const abs = Math.abs(valor);
  if (abs >= 1e9) return (valor / 1e9).toFixed(1) + 'MM';
  if (abs >= 1e6) return (valor / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  return Math.round(valor / 1e3) + 'K';
}

function fsRenderColumnas(elId, filas) {
  const el = document.getElementById(elId);
  if (!filas.length) {
    el.innerHTML = '<p class="empty-note">Sin aportes en este período.</p>';
    return;
  }
  // Con devoluciones el total de un mes puede ser negativo: la escala se
  // toma del valor absoluto y las barras negativas se pintan en rojo.
  const max = Math.max(1, ...filas.map((f) => Math.abs(f.valor)));
  el.innerHTML = `
    <div class="col-chart-inner">
      <div class="col-chart-plot">
        ${filas.map((f) => `
          <div class="col-bars" title="${fsEscapeHtml(f.titulo)}: ${fsPesos(f.valor)}">
            <span class="col-bar ${f.valor < 0 ? 'out' : 'in'}" data-pct="${(Math.abs(f.valor) / max) * 100}"><span class="col-bar-value">${fsMillones(f.valor)}</span></span>
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

Router.register('fondo-siniestros', {
  title: 'Fondos de reposición',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('fs-buscar').addEventListener('input', () => this._renderTabla());
      document.getElementById('fs-fondo').addEventListener('change', () => this._cambiarFondo());
      document.getElementById('fs-periodo').addEventListener('change', () => this._renderGrafica());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [fondos, vehiculos, aportes, resumen, flota] = await Promise.all([
      DB.getFondos(),
      DB.getFondoVehiculos(),
      DB.getFondoAportes(),
      DB.getFondoResumen(),
      DB.getFlotaVehiculos().catch(() => []),
    ]);
    this._fondos = fondos.length ? fondos : [{ clave: 'siniestros', nombre: 'Fondo de reposición' }];
    this._todoVehiculos = vehiculos;
    this._todoAportes = aportes;
    this._todoResumen = resumen;
    this._flota = this._indexarFlota(flota);

    const sel = document.getElementById('fs-fondo');
    const previo = sel.value;
    sel.innerHTML = this._fondos.map((f) => `<option value="${fsEscapeHtml(f.clave)}">${fsEscapeHtml(f.nombre)}</option>`).join('');
    sel.value = this._fondos.some((f) => f.clave === previo) ? previo : this._fondos[0].clave;

    this._cambiarFondo();
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

  _cambiarFondo() {
    this._fondo = document.getElementById('fs-fondo').value;
    this._vehiculos = this._todoVehiculos.filter((v) => v.fondo === this._fondo);
    this._aportes = this._todoAportes.filter((a) => a.fondo === this._fondo);
    this._resumen = this._todoResumen.filter((r) => r.fondo === this._fondo);
    // El período elegido no se hereda entre fondos: un año que existe en los
    // dos (2026) se daba por bueno y el fondo urbano abría en ese año suelto
    // en vez de en su vista por años, que es la que tiene sentido con diez
    // años de historia.
    document.getElementById('fs-periodo').value = '';
    this._render();
  },

  _valorResumen(etiqueta) {
    const fila = (this._resumen || []).find((r) => r.etiqueta === etiqueta);
    return fila ? Number(fila.valor) : null;
  },

  _render() {
    // Totales por vehículo y por período, en una sola pasada. El saldo
    // inicial se separa: es el acumulado con que arranca cada vehículo, no
    // plata recaudada en un mes (ver es_saldo_inicial en el esquema).
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

    this._periodos = [...this._porPeriodo.keys()].sort();
    this._anios = [...new Set(this._periodos.map(fsAnio))].sort();
    const anioActual = this._anios[this._anios.length - 1];
    const recaudadoAnio = this._periodos
      .filter((p) => fsAnio(p) === anioActual)
      .reduce((s, p) => s + this._porPeriodo.get(p), 0);
    const totalAportado = this._saldoInicial + [...this._porPeriodo.values()].reduce((s, v) => s + v, 0);
    const rendAnio = this._resumen
      .filter((r) => r.grupo === 'rendimiento_mes')
      .reduce((s, r) => s + (Number(r.valor) || 0), 0);

    document.getElementById('fs-kpi-total').textContent = fsPesos(totalAportado);
    document.getElementById('fs-kpi-anio').textContent = fsPesos(recaudadoAnio);
    document.getElementById('fs-kpi-anio-label').textContent = `Recaudado en ${anioActual || 'el año'}`;
    document.getElementById('fs-kpi-vehiculos').textContent = this._vehiculos.length;
    document.getElementById('fs-kpi-rendimientos').textContent = rendAnio ? fsPesos(rendAnio) : '—';

    // Con 10 años de historia (el fondo urbano) una columna por mes es
    // ilegible, así que por defecto se agrupa por año y se puede abrir un
    // año concreto. Con pocos meses se muestran los meses directamente.
    const sel = document.getElementById('fs-periodo');
    const previo = sel.value;
    const muchos = this._periodos.length > 18;
    sel.innerHTML = (muchos ? '<option value="anios">Todos los años</option>' : '')
      + this._anios.map((a) => `<option value="${a}">${a}</option>`).join('');
    const opciones = [...sel.options].map((o) => o.value);
    sel.value = opciones.includes(previo) ? previo : (muchos ? 'anios' : this._anios[this._anios.length - 1]);
    sel.parentElement.classList.toggle('hidden', this._anios.length < 2);

    this._renderGrafica();
    this._renderAviso();
    this._renderMovimientos();
    this._renderTabla();
  },

  _renderGrafica() {
    const modo = document.getElementById('fs-periodo').value;
    let filas;
    if (modo === 'anios') {
      const porAnio = new Map();
      this._periodos.forEach((p) => {
        porAnio.set(fsAnio(p), (porAnio.get(fsAnio(p)) || 0) + this._porPeriodo.get(p));
      });
      filas = [...porAnio.entries()].map(([anio, valor]) => ({ label: anio, titulo: `Año ${anio}`, valor }));
    } else {
      filas = this._periodos
        .filter((p) => fsAnio(p) === modo)
        .map((p) => ({ label: fsEtiquetaPeriodo(p), titulo: fsEtiquetaPeriodoLarga(p), valor: this._porPeriodo.get(p) }));
    }
    fsRenderColumnas('fs-col-chart', filas);

    document.getElementById('fs-chart-titulo').textContent = modo === 'anios'
      ? 'Aportes recaudados por año' : `Aportes recaudados en ${modo}`;

    const pie = document.getElementById('fs-chart-pie');
    pie.textContent = this._saldoInicial
      ? `No incluye el saldo con que arrancó el fondo (${fsPesos(this._saldoInicial)}, columna ${fsEtiquetaPeriodoLarga(this._periodoSaldoInicial)} del archivo), que es acumulado y no un recaudo del mes.`
      : '';
    pie.classList.toggle('hidden', !this._saldoInicial);
  },

  // Control de consistencia: el cuadro de resumen lo escribe contabilidad a
  // mano y puede quedar atrasado respecto a las columnas de aportes (pasó
  // con el corte de agosto 2026 en el fondo de siniestros). Solo se compara
  // cuando el cuadro declara una cifra que sea equivalente a la suma de
  // aportes -- no todos los fondos la tienen.
  _renderAviso() {
    const el = document.getElementById('fs-aviso');
    const fila = (this._resumen || []).find((r) => /^aportes totales/i.test(r.etiqueta || ''));
    if (!fila) { el.classList.add('hidden'); return; }
    const totalCuadro = Number(fila.valor);
    const totalReal = this._saldoInicial + [...this._porPeriodo.values()].reduce((s, v) => s + v, 0);
    const diferencia = totalReal - totalCuadro;
    if (Math.abs(diferencia) < 1) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <strong>Los aportes cargados no cuadran con el cuadro de resumen.</strong>
      La suma real de los aportes por vehículo da ${fsPesos(totalReal)}, mientras que el
      cuadro declara ${fsPesos(totalCuadro)} en "${fsEscapeHtml(fila.etiqueta)}" — una diferencia de
      ${fsPesos(Math.abs(diferencia))}. Suele pasar porque el cuadro se actualiza a mano y quedó
      un corte atrasado.
    `;
  },

  _renderMovimientos() {
    const movimientos = (this._resumen || []).filter((r) => r.grupo === 'movimiento' || r.grupo === 'ingreso');
    const el = document.getElementById('fs-movimientos');
    if (!movimientos.length) {
      el.innerHTML = '<p class="empty-note">Este fondo no trae cuadro de resumen.</p>';
      return;
    }
    const esTotal = (e) => /^(aportes totales|total|saldo en cuenta|disponible)/i.test(e);
    el.innerHTML = movimientos.map((m) => {
      const valor = Number(m.valor);
      return `
        <div class="fondo-mov ${esTotal(m.etiqueta) ? 'es-total' : ''}">
          <div class="fondo-mov-texto">
            <span class="fondo-mov-etiqueta">${fsEscapeHtml(m.etiqueta)}</span>
            ${m.detalle ? `<span class="fondo-mov-detalle">${fsEscapeHtml(m.detalle)}</span>` : ''}
          </div>
          <span class="fondo-mov-valor ${valor < 0 ? 'negativo' : ''}">${fsPesos(valor)}</span>
        </div>
      `;
    }).join('');
  },

  _placaDe(v) {
    if (v.placa) return v.placa;
    const flota = this._flota.get(v.interno);
    return flota ? flota.placa : null;
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
          placa: this._placaDe(v),
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
      <tr${f.total === 0 ? ' class="fila-apagada"' : ''}>
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
    const placa = vehiculo ? this._placaDe(vehiculo) : null;
    const meses = this._aportes
      .filter((a) => a.interno === interno)
      .sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
    const total = meses.reduce((s, m) => s + Number(m.valor || 0), 0);

    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-body').innerHTML = `
      <h3 style="margin:0 0 0.35rem">Interno ${fsEscapeHtml(interno)}${placa ? ' · ' + fsEscapeHtml(placa) : ''}</h3>
      <p class="muted" style="margin:0 0 1.2rem">
        ${fsEscapeHtml(vehiculo ? (vehiculo.propietario || 'Sin propietario') : 'Sin propietario')}
        ${vehiculo && vehiculo.nit ? ' · NIT ' + fsEscapeHtml(vehiculo.nit) : ''}
        ${flota && (flota.nombre_ruta || flota.ruta) ? ' · Ruta ' + fsEscapeHtml(flota.nombre_ruta || flota.ruta) : ''}
        · ${meses.length} movimiento(s)
      </p>
      <div class="table-wrap" style="max-height:420px; overflow-y:auto">
        <table>
          <thead><tr><th>Mes</th><th>Concepto</th><th class="num">Valor</th></tr></thead>
          <tbody>
            ${meses.map((m) => {
              const valor = Number(m.valor);
              const etiqueta = m.es_saldo_inicial ? 'Saldo inicial' : (m.concepto || '');
              return `
                <tr>
                  <td data-label="Mes">${fsEscapeHtml(fsEtiquetaPeriodoLarga(m.periodo))}</td>
                  <td data-label="Concepto">${etiqueta ? `<span class="tag">${fsEscapeHtml(etiqueta)}</span>` : ''}</td>
                  <td data-label="Valor" class="num${valor < 0 ? ' negativo' : ''}">${fsPesos(valor)}</td>
                </tr>
              `;
            }).join('')}
            <tr class="fila-total">
              <td data-label="Mes"><strong>Total</strong></td>
              <td></td>
              <td data-label="Valor" class="num"><strong>${fsPesos(total)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },
});
