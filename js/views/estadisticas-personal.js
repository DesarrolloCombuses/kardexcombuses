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

// Cuántos días faltan para el próximo cumpleaños (0 = hoy) contando desde
// la fecha de nacimiento, sin importar el año de nacimiento -- si el
// cumpleaños de este año ya pasó, se calcula contra el del año siguiente.
const DIAS_CUMPLE_PROXIMO = 30;

function diasParaCumplir(fechaNacimientoISO, hoy) {
  if (!fechaNacimientoISO) return null;
  const nacimiento = new Date(`${fechaNacimientoISO}T00:00:00`);
  let proximo = new Date(hoy.getFullYear(), nacimiento.getMonth(), nacimiento.getDate());
  if (proximo < hoy) proximo = new Date(hoy.getFullYear() + 1, nacimiento.getMonth(), nacimiento.getDate());
  return Math.round((proximo - hoy) / 86400000);
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

Router.register('estadisticas-personal', {
  title: 'Estadísticas de personal',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('sp-filtro-cargo').addEventListener('change', () => this._aplicarFiltro());
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
    const sel = document.getElementById('sp-filtro-cargo');
    const actual = sel.value;
    const opciones = [...new Set(empleados.map((e) => e.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const cargo = document.getElementById('sp-filtro-cargo').value;
    const filtrados = cargo ? this._empleadosAll.filter((e) => e.cargo === cargo) : this._empleadosAll;
    document.getElementById('sp-filtro-resultado').textContent = cargo
      ? `Mostrando ${filtrados.length} de ${this._empleadosAll.length} empleado(s) — cargo "${cargo}"`
      : `${this._empleadosAll.length} empleado(s)`;
    this._render(filtrados);
  },

  _render(empleados) {
    const conPerfil = empleados.filter((e) => e.perfil_sociodemografico);
    const perfiles = conPerfil.map((e) => e.perfil_sociodemografico);

    document.getElementById('sp-kpi-total').textContent = empleados.length;
    document.getElementById('sp-kpi-completos').textContent = conPerfil.length;

    const edades = perfiles.map((p) => edadDeFecha(p.fecha_nacimiento)).filter((e) => e != null);
    document.getElementById('sp-kpi-edad').textContent = edades.length
      ? Math.round(edades.reduce((s, e) => s + e, 0) / edades.length)
      : '—';

    const conducen = perfiles.filter((p) => p.conduce === true).length;
    document.getElementById('sp-kpi-conduce').textContent = empleados.length
      ? `${Math.round((conducen / empleados.length) * 100)}%`
      : '0%';

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const proximosCumple = conPerfil
      .map((e) => ({ e, dias: diasParaCumplir(e.perfil_sociodemografico.fecha_nacimiento, hoy) }))
      .filter((x) => x.dias != null && x.dias <= DIAS_CUMPLE_PROXIMO)
      .sort((a, b) => a.dias - b.dias);
    this._renderCumpleanos(proximosCumple);

    const mayores50 = conPerfil
      .filter((e) => (edadDeFecha(e.perfil_sociodemografico.fecha_nacimiento) ?? 0) >= 50)
      .sort((a, b) => edadDeFecha(b.perfil_sociodemografico.fecha_nacimiento) - edadDeFecha(a.perfil_sociodemografico.fecha_nacimiento));
    this._renderMayores50(mayores50);

    this._renderDonut('sp-donut-sexo', 'sp-legend-sexo', 'sp-donut-sexo-total', distribucion(perfiles, (p) => p.sexo));
    renderBarChart('sp-bars-edad', distribucion(perfiles, (p) => rangoEdad(edadDeFecha(p.fecha_nacimiento)), ORDEN_RANGO_EDAD));
    renderBarChart('sp-bars-estado-civil', distribucion(perfiles, (p) => p.estado_civil));
    renderBarChart('sp-bars-escolaridad', distribucion(perfiles, (p) => p.grado_escolaridad, ORDEN_ESCOLARIDAD));
    renderBarChart('sp-bars-estrato', distribucion(perfiles, (p) => p.estrato_socioeconomico, ORDEN_ESTRATO));
    this._renderDonut('sp-donut-medio', 'sp-legend-medio', 'sp-donut-medio-total', distribucion(perfiles, (p) => p.medio_desplazamiento));
    this._renderDonut('sp-donut-turno', 'sp-legend-turno', 'sp-donut-turno-total', distribucion(perfiles, (p) => p.turno_trabajo));
    renderBarChart('sp-bars-sangre', distribucion(perfiles, (p) => p.tipo_sangre, ORDEN_SANGRE));

    // Ruta y número interno viven en "employees" (no en el perfil
    // sociodemográfico opcional), así que se agrupa sobre la lista completa
    // de empleados y no sobre "perfiles" -- así un conductor cuenta acá
    // aunque todavía no haya completado su perfil sociodemográfico.
    const conductores = empleados.filter((e) => /conductor/i.test(e.cargo || ''));
    document.getElementById('sp-ruta-subtitulo').textContent =
      `${conductores.length} conductor${conductores.length === 1 ? '' : 'es'}`;

    const distRuta = distribucion(conductores, (e) => e.ruta);
    const rutasConConductores = distRuta.filter((d) => d.label !== 'Sin dato');
    const sinRuta = distRuta.find((d) => d.label === 'Sin dato');
    const lider = rutasConConductores[0]; // distribucion() ya ordena de mayor a menor
    document.getElementById('sp-ruta-kpi-rutas').textContent = rutasConConductores.length;
    document.getElementById('sp-ruta-kpi-sinruta').textContent = sinRuta ? sinRuta.count : 0;
    document.getElementById('sp-ruta-kpi-lider').textContent = lider ? `Ruta ${lider.label} (${lider.count})` : '—';
    this._renderRankedBars('sp-bars-ruta', distRuta, (l) => 'Ruta ' + l);
  },

  // Lista de próximos cumpleaños (nombre, cargo, fecha y cuántos días
  // faltan) más un ranking por cargo, para saber tanto a quién felicitar
  // como qué cargo concentra más cumpleaños en el rango.
  _renderCumpleanos(items) {
    document.getElementById('sp-cumple-subtitulo').textContent =
      `${items.length} en los próximos ${DIAS_CUMPLE_PROXIMO} días`;
    const lista = document.getElementById('sp-cumple-lista');
    lista.innerHTML = items.length === 0
      ? `<p class="empty-note">Sin cumpleaños en los próximos ${DIAS_CUMPLE_PROXIMO} días.</p>`
      : items.map(({ e, dias }) => {
        const fechaTexto = new Date(`${e.perfil_sociodemografico.fecha_nacimiento}T00:00:00`)
          .toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
        const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;
        return `
          <div class="detalle-list-item">
            <span class="detalle-list-item-main">${e.nombre}</span>
            <span class="detalle-list-item-sub">${e.cargo || 'Sin cargo'} · ${fechaTexto} · ${cuando}</span>
          </div>
        `;
      }).join('');
    this._renderRankedBars('sp-bars-cumple-cargo', distribucion(items.map((x) => x.e), (e) => e.cargo));
  },

  // Mismo patrón que _renderCumpleanos: lista de personas (para saber
  // quiénes son, ej. para exámenes médicos periódicos) más el desglose por
  // cargo.
  _renderMayores50(items) {
    document.getElementById('sp-mayores50-subtitulo').textContent = `${items.length} persona(s)`;
    const lista = document.getElementById('sp-mayores50-lista');
    lista.innerHTML = items.length === 0
      ? '<p class="empty-note">Sin personas mayores de 50 años.</p>'
      : items.map((e) => `
        <div class="detalle-list-item">
          <span class="detalle-list-item-main">${e.nombre}</span>
          <span class="detalle-list-item-sub">${e.cargo || 'Sin cargo'} · ${edadDeFecha(e.perfil_sociodemografico.fecha_nacimiento)} años</span>
        </div>
      `).join('');
    this._renderRankedBars('sp-bars-mayores50-cargo', distribucion(items, (e) => e.cargo));
  },

  // Ranking tipo "leaderboard" (rango + barra a color + %) -- más visual
  // que una barra plana, para que se lea de un vistazo qué valor concentra
  // más personas (rutas, cargos, etc.). formatLabel deja personalizar cómo
  // se ve cada etiqueta (ej. "Ruta 700" en vez de solo "700").
  _renderRankedBars(elId, dist, formatLabel = (l) => l) {
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
      const etiqueta = esSinDato ? 'Sin dato' : formatLabel(d.label);
      return `
        <div class="ranked-row ${i === 0 && !esSinDato ? 'top-rank' : ''}">
          <span class="ranked-rank">${i + 1}</span>
          <div class="ranked-body">
            <div class="ranked-top-row">
              <span class="ranked-label" title="${etiqueta}">${etiqueta}</span>
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
