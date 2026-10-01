function edadDeFecha(fechaISO) {
  if (!fechaISO) return null;
  const nacimiento = new Date(`${fechaISO}T00:00:00`);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const sinCumplirAun = hoy.getMonth() < nacimiento.getMonth()
    || (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (sinCumplirAun) edad--;
  return edad;
}

function rangoEdad(edad) {
  if (edad == null) return 'Sin dato';
  if (edad < 25) return 'Menos de 25';
  if (edad < 35) return '25 a 34';
  if (edad < 45) return '35 a 44';
  if (edad < 55) return '45 a 54';
  return '55 o más';
}

// Por componentes y no new Date(iso): Colombia es UTC-5 y una fecha ISO
// suelta se interpreta como medianoche UTC, o sea el dia anterior.
function pfFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('es-CO');
}

function pfEscapar(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ORDEN_RANGO_EDAD = ['Menos de 25', '25 a 34', '35 a 44', '45 a 54', '55 o más', 'Sin dato'];
const ORDEN_ESCOLARIDAD = ['Primaria', 'Secundaria incompleta', 'Secundaria completa', 'Técnico', 'Tecnólogo', 'Universitario', 'Posgrado', 'Sin dato'];
const ORDEN_ESTRATO = ['1', '2', '3', '4', '5', '6', 'Sin dato'];
const ORDEN_SANGRE = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Sin dato'];

// Cuenta cuántas personas caen en cada valor de un campo (o "Sin dato" si
// viene vacío). Si se da un orden fijo se respeta ese orden; si no, se
// ordena de mayor a menor cantidad, dejando "Sin dato" siempre al final.
function distribucion(items, getValor, ordenFijo) {
  const counts = new Map();
  items.forEach((item) => {
    const v = getValor(item) || 'Sin dato';
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  let entries = [...counts.entries()];
  if (ordenFijo) {
    entries.sort((a, b) => {
      const ia = ordenFijo.indexOf(a[0]);
      const ib = ordenFijo.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  } else {
    entries = entries.filter(([k]) => k !== 'Sin dato').sort((a, b) => b[1] - a[1])
      .concat(entries.filter(([k]) => k === 'Sin dato'));
  }
  return entries.map(([label, count]) => ({ label, count }));
}

function renderBarChart(elId, dist) {
  const el = document.getElementById(elId);
  const total = dist.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    el.innerHTML = '<p class="empty-note">Sin datos todavía.</p>';
    return;
  }
  const max = Math.max(...dist.map((d) => d.count)) || 1;
  el.innerHTML = dist.map((d) => `
    <div class="bar-row">
      <span class="bar-label" title="${d.label}">${d.label}</span>
      <span class="bar-track"><span class="bar-fill" data-pct="${(d.count / max) * 100}"></span></span>
      <span class="bar-value">${d.count}</span>
    </div>
  `).join('');
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
  });
}

Router.register('personal-perfil', {
  title: 'Perfil sociodemográfico',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  // Filtros de la barra superior. Todos son AND entre sí y todos repintan
  // KPIs y gráficas: no hay nada en esta pantalla que quede con el total
  // completo mientras el resto muestra un subconjunto.
  _IDS_FILTRO: ['pf-filtro-estado', 'pf-filtro-cargo', 'pf-filtro-campo-fecha', 'pf-filtro-anio', 'pf-filtro-mes'],
  _IDS_FECHA: ['pf-filtro-desde', 'pf-filtro-hasta'],

  async onEnter() {
    if (!this._bound) {
      this._IDS_FILTRO.forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._aplicarFiltro());
      });
      this._IDS_FECHA.forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._aplicarFiltro());
      });
      document.getElementById('pf-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
      this._bound = true;
    }
    // Se traen activos Y retirados de una vez: cambiar el filtro de estado
    // repinta al instante en vez de ir al servidor por cada clic. A una
    // cuenta marcada como "solo activos" el servidor le sigue devolviendo
    // solo activos, ignore lo que pida el cliente (ver
    // sql/solo_activos_empleados_2026-09-18.sql) -- para esa cuenta el
    // filtro "Retirados" simplemente no trae a nadie.
    this._empleadosAll = await DB.getEmployeesConPerfil({ onlyActive: false });
    this._aplicarFiltro();
  },

  // La fecha sobre la que trabaja el filtro de periodo. Ingreso vive en el
  // perfil sociodemográfico (puede faltar si ese perfil no se ha llenado);
  // salida, en la ficha de Empleados.
  _fechaDe(empleado) {
    const campo = document.getElementById('pf-filtro-campo-fecha').value;
    const valor = campo === 'salida'
      ? empleado.fecha_salida
      : (empleado.perfil_sociodemografico || {}).fecha_ingreso;
    return valor ? String(valor).slice(0, 10) : null;
  },

  _porEstado(empleados) {
    const estado = document.getElementById('pf-filtro-estado').value;
    if (estado === 'activos') return empleados.filter((e) => e.activo);
    if (estado === 'inactivos') return empleados.filter((e) => !e.activo);
    return empleados;
  },

  // Cargos y años salen de los datos que hay dentro del estado elegido, no
  // de una lista fija: si se está mirando solo retirados, no tiene sentido
  // ofrecer un cargo o un año en el que no se retiró nadie. La selección
  // actual se conserva si sigue existiendo.
  _llenarFiltros(empleadosEstado) {
    const cargos = [...new Set(empleadosEstado.map((e) => e.cargo).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    this._llenarSelect('pf-filtro-cargo', cargos);

    const anios = [...new Set(empleadosEstado.map((e) => this._fechaDe(e)).filter(Boolean).map((f) => f.slice(0, 4)))]
      .sort((a, b) => b.localeCompare(a));
    this._llenarSelect('pf-filtro-anio', anios);
  },

  _llenarSelect(id, valores) {
    const sel = document.getElementById(id);
    const actual = sel.value;
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>`
      + valores.map((v) => `<option value="${v}">${v}</option>`).join('');
    sel.value = valores.includes(actual) ? actual : '';
  },

  _limpiarFiltros() {
    document.getElementById('pf-filtro-estado').value = 'activos';
    document.getElementById('pf-filtro-campo-fecha').value = 'ingreso';
    document.getElementById('pf-filtro-cargo').value = '';
    document.getElementById('pf-filtro-anio').value = '';
    document.getElementById('pf-filtro-mes').value = '';
    document.getElementById('pf-filtro-desde').value = '';
    document.getElementById('pf-filtro-hasta').value = '';
    this._aplicarFiltro();
  },

  // Un empleado activo no tiene fecha de salida -- sigue trabajando. Pedir
  // "activos" + "filtrar por fecha de salida" no es un filtro que da cero:
  // es una pregunta que no existe, y el resultado se leia como si faltara
  // cargar un dato. Se deshabilita la opcion y, si estaba elegida, el filtro
  // se devuelve a la fecha de ingreso.
  _sincronizarCampoFecha() {
    const estado = document.getElementById('pf-filtro-estado').value;
    const campo = document.getElementById('pf-filtro-campo-fecha');
    const opcionSalida = campo.querySelector('option[value="salida"]');
    const noAplica = estado === 'activos';
    opcionSalida.disabled = noAplica;
    opcionSalida.textContent = noAplica ? 'Fecha de salida (solo retirados)' : 'Fecha de salida';
    if (noAplica && campo.value === 'salida') campo.value = 'ingreso';
  },

  _aplicarFiltro() {
    this._sincronizarCampoFecha();
    const enEstado = this._porEstado(this._empleadosAll || []);
    this._llenarFiltros(enEstado);

    const cargo = document.getElementById('pf-filtro-cargo').value;
    const anio = document.getElementById('pf-filtro-anio').value;
    const mes = document.getElementById('pf-filtro-mes').value;
    const desde = document.getElementById('pf-filtro-desde').value;
    const hasta = document.getElementById('pf-filtro-hasta').value;
    const hayFiltroFecha = !!(anio || mes || desde || hasta);

    let filtrados = cargo ? enEstado.filter((e) => e.cargo === cargo) : enEstado;

    // Quienes no tienen esa fecha no pueden cumplir ni incumplir un rango:
    // quedan por fuera. Pero no es lo mismo que FALTE el dato a que no
    // aplique -- un activo no tiene fecha de salida porque sigue trabajando,
    // no porque nadie la haya cargado. Se cuentan aparte para poder decirlo
    // con esas palabras.
    const porSalida = document.getElementById('pf-filtro-campo-fecha').value === 'salida';
    const excluidos = hayFiltroFecha ? filtrados.filter((e) => !this._fechaDe(e)) : [];
    const sinFecha = excluidos.filter((e) => !(porSalida && e.activo)).length;
    const noAplica = excluidos.length - sinFecha;
    if (hayFiltroFecha) {
      filtrados = filtrados.filter((e) => {
        const f = this._fechaDe(e);
        if (!f) return false;
        if (anio && f.slice(0, 4) !== anio) return false;
        if (mes && f.slice(5, 7) !== mes) return false;
        if (desde && f < desde) return false;
        if (hasta && f > hasta) return false;
        return true;
      });
    }

    this._pintarResumen(filtrados, enEstado, { cargo, anio, mes, desde, hasta, hayFiltroFecha, sinFecha, noAplica });
    this._render(filtrados);
  },

  _pintarResumen(filtrados, enEstado, f) {
    const estado = document.getElementById('pf-filtro-estado').value;
    const etiquetaEstado = estado === 'activos' ? 'Empleados activos'
      : estado === 'inactivos' ? 'Empleados retirados'
      : 'Empleados (activos y retirados)';
    document.getElementById('pf-kpi-total-label').textContent = etiquetaEstado;

    const partes = [];
    if (f.cargo) partes.push(`cargo "${f.cargo}"`);
    const campo = document.getElementById('pf-filtro-campo-fecha').value === 'salida' ? 'salida' : 'ingreso';
    if (f.anio) partes.push(`${campo} en ${f.anio}`);
    if (f.mes) {
      const nombreMes = document.querySelector(`#pf-filtro-mes option[value="${f.mes}"]`).textContent;
      partes.push(`${campo} en ${nombreMes.toLowerCase()}`);
    }
    if (f.desde) partes.push(`${campo} desde ${f.desde}`);
    if (f.hasta) partes.push(`${campo} hasta ${f.hasta}`);

    const resultado = document.getElementById('pf-filtro-resultado');
    resultado.textContent = partes.length
      ? `Mostrando ${filtrados.length} de ${enEstado.length} empleado(s) — ${partes.join(', ')}`
      : `${filtrados.length} empleado(s)`;

    const aviso = document.getElementById('pf-filtro-aviso');
    const motivos = [];
    if (f.noAplica > 0) {
      motivos.push(`${f.noAplica} siguen activos, así que no tienen fecha de salida`);
    }
    if (f.sinFecha > 0) {
      motivos.push(`${f.sinFecha} no tienen la fecha de ${campo} cargada`);
    }
    if (motivos.length) {
      aviso.textContent = `Fuera de este filtro: ${motivos.join('; ')}.`;
      aviso.classList.remove('hidden');
    } else {
      aviso.classList.add('hidden');
      aviso.textContent = '';
    }
  },

  _render(empleados) {
    const conPerfil = empleados.filter((e) => e.perfil_sociodemografico);
    const perfiles = conPerfil.map((e) => e.perfil_sociodemografico);

    document.getElementById('pf-kpi-total').textContent = empleados.length;
    document.getElementById('pf-kpi-completos').textContent = conPerfil.length;

    const edades = perfiles.map((p) => edadDeFecha(p.fecha_nacimiento)).filter((e) => e != null);
    document.getElementById('pf-kpi-edad').textContent = edades.length
      ? Math.round(edades.reduce((s, e) => s + e, 0) / edades.length)
      : '—';

    const conducen = perfiles.filter((p) => p.conduce === true).length;
    document.getElementById('pf-kpi-conduce').textContent = empleados.length
      ? `${Math.round((conducen / empleados.length) * 100)}%`
      : '0%';

    this._renderTabla(empleados);

    this._renderDonut('pf-donut-sexo', 'pf-legend-sexo', 'pf-donut-sexo-total', distribucion(perfiles, (p) => p.sexo));
    renderBarChart('pf-bars-edad', distribucion(perfiles, (p) => rangoEdad(edadDeFecha(p.fecha_nacimiento)), ORDEN_RANGO_EDAD));
    renderBarChart('pf-bars-estado-civil', distribucion(perfiles, (p) => p.estado_civil));
    renderBarChart('pf-bars-escolaridad', distribucion(perfiles, (p) => p.grado_escolaridad, ORDEN_ESCOLARIDAD));
    renderBarChart('pf-bars-estrato', distribucion(perfiles, (p) => p.estrato_socioeconomico, ORDEN_ESTRATO));
    this._renderDonut('pf-donut-medio', 'pf-legend-medio', 'pf-donut-medio-total', distribucion(perfiles, (p) => p.medio_desplazamiento));
    this._renderDonut('pf-donut-turno', 'pf-legend-turno', 'pf-donut-turno-total', distribucion(perfiles, (p) => p.turno_trabajo));
    renderBarChart('pf-bars-sangre', distribucion(perfiles, (p) => p.tipo_sangre, ORDEN_SANGRE));
  },

  // Quienes son los que estan detras de los numeros. Se pinta con los MISMOS
  // empleados que las graficas (el argumento, no this._empleadosAll), asi no
  // hay forma de que la tabla y los KPIs digan cosas distintas.
  _renderTabla(empleados) {
    const cuerpo = document.getElementById('pf-tabla-body');
    const contador = document.getElementById('pf-tabla-contador');
    contador.textContent = empleados.length === 1 ? '1 persona' : `${empleados.length} personas`;

    if (empleados.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7"><span class="empty-note">Ningún empleado cumple estos filtros.</span></td></tr>';
      return;
    }

    const ordenados = [...empleados].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    cuerpo.innerHTML = ordenados.map((e) => {
      const perfil = e.perfil_sociodemografico;
      const edad = perfil ? edadDeFecha(perfil.fecha_nacimiento) : null;
      // Marcar a quien no tiene perfil es la mitad del trabajo de esta
      // pantalla: el KPI dice cuantos faltan, la tabla dice quienes son.
      const sinPerfil = perfil ? '' : ' <span class="tag pendiente">Sin perfil</span>';
      return `
        <tr>
          <td>${pfEscapar(e.nombre)}${sinPerfil}</td>
          <td>${pfEscapar(e.cedula)}</td>
          <td>${pfEscapar(e.cargo || '—')}</td>
          <td><span class="tag ${e.activo ? 'completo' : 'descartado'}">${e.activo ? 'Activo' : 'Retirado'}</span></td>
          <td>${edad == null ? '—' : edad}</td>
          <td>${pfFecha(perfil && perfil.fecha_ingreso)}</td>
          <td>${pfFecha(e.fecha_salida)}</td>
        </tr>
      `;
    }).join('');
  },

  _renderDonut(donutId, legendId, totalId, dist) {
    const donut = document.getElementById(donutId);
    const legend = document.getElementById(legendId);
    const total = dist.reduce((s, d) => s + d.count, 0);
    document.getElementById(totalId).textContent = total;

    if (total === 0) {
      donut.style.background = 'var(--slate-200)';
      legend.innerHTML = '<li class="empty-note">Sin datos.</li>';
      return;
    }

    let acc = 0;
    const stops = [];
    const items = [];
    let colorIdx = 0;
    dist.forEach((d) => {
      const color = d.label === 'Sin dato' ? '#c9d0db' : this._palette[colorIdx++ % this._palette.length];
      const pct = (d.count / total) * 100;
      const from = acc;
      const to = acc + pct;
      stops.push(`${color} ${from}% ${to}%`);
      items.push(`
        <li>
          <span class="dot" style="background:${color}"></span>
          <span class="legend-label">${d.label}</span>
          <span class="legend-value">${pct.toFixed(1)}%</span>
        </li>
      `);
      acc = to;
    });

    donut.style.background = `conic-gradient(${stops.join(', ')})`;
    legend.innerHTML = items.join('');
  },
});
