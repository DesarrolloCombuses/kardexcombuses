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

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pf-filtro-cargo').addEventListener('change', () => this._aplicarFiltro());
      this._bound = true;
    }
    this._empleadosAll = await DB.getEmployeesConPerfil({ onlyActive: true });
    this._llenarFiltroCargo(this._empleadosAll);
    this._aplicarFiltro();
  },

  // Cargo se llena con los valores que realmente existen en los datos (no
  // una lista fija), igual que el filtro de cargo de Empleados -- así se
  // puede ver cualquier gráfica de esta página "por cargo" (ej. solo
  // Conductores) o volver a "Todos los cargos" sin perder el resto de la
  // vista.
  _llenarFiltroCargo(empleados) {
    const sel = document.getElementById('pf-filtro-cargo');
    const actual = sel.value;
    const opciones = [...new Set(empleados.map((e) => e.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const cargo = document.getElementById('pf-filtro-cargo').value;
    const filtrados = cargo ? this._empleadosAll.filter((e) => e.cargo === cargo) : this._empleadosAll;
    document.getElementById('pf-filtro-resultado').textContent = cargo
      ? `Mostrando ${filtrados.length} de ${this._empleadosAll.length} empleado(s) — cargo "${cargo}"`
      : `${this._empleadosAll.length} empleado(s)`;
    this._render(filtrados);
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

    this._renderDonut('pf-donut-sexo', 'pf-legend-sexo', 'pf-donut-sexo-total', distribucion(perfiles, (p) => p.sexo));
    renderBarChart('pf-bars-edad', distribucion(perfiles, (p) => rangoEdad(edadDeFecha(p.fecha_nacimiento)), ORDEN_RANGO_EDAD));
    renderBarChart('pf-bars-estado-civil', distribucion(perfiles, (p) => p.estado_civil));
    renderBarChart('pf-bars-escolaridad', distribucion(perfiles, (p) => p.grado_escolaridad, ORDEN_ESCOLARIDAD));
    renderBarChart('pf-bars-estrato', distribucion(perfiles, (p) => p.estrato_socioeconomico, ORDEN_ESTRATO));
    this._renderDonut('pf-donut-medio', 'pf-legend-medio', 'pf-donut-medio-total', distribucion(perfiles, (p) => p.medio_desplazamiento));
    this._renderDonut('pf-donut-turno', 'pf-legend-turno', 'pf-donut-turno-total', distribucion(perfiles, (p) => p.turno_trabajo));
    renderBarChart('pf-bars-sangre', distribucion(perfiles, (p) => p.tipo_sangre, ORDEN_SANGRE));
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
