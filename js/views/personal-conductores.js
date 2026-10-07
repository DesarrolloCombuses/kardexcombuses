// Cuenta cuántas personas caen en cada valor de un campo (o "Sin dato" si
// viene vacío), ordenado de mayor a menor cantidad (Sin dato siempre al
// final).
function distribucion(items, getValor) {
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

Router.register('personal-conductores', {
  title: 'Conductores por ruta',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pc-filtro-estado').addEventListener('change', () => this._aplicarFiltro());
      this._bound = true;
    }
    // Se traen también los retirados para poder consultarlos; el filtro de
    // estado arranca en "Activos", que es como se veía esta pantalla antes.
    this._empleadosAll = await DB.getEmployeesConPerfil({ onlyActive: false });
    this._aplicarFiltro();
  },

  // Una cuenta con la restricción "solo empleados activos" (ver Usuarios)
  // nunca recibe retirados del servidor: para ella este filtro existe pero
  // "Inactivos" no muestra a nadie, que es justamente lo que se quiere.
  _porEstado(empleados) {
    const estado = document.getElementById('pc-filtro-estado').value;
    if (estado === 'inactivos') return empleados.filter((e) => !e.activo);
    if (estado === 'todos') return empleados;
    return empleados.filter((e) => e.activo);
  },

  _aplicarFiltro() {
    const base = this._porEstado(this._empleadosAll || []);
    document.getElementById('pc-filtro-resultado').textContent = {
      activos: `${base.length} empleado(s) activo(s)`,
      inactivos: `${base.length} persona(s) retirada(s)`,
      todos: `${base.length} empleado(s), activos y retirados`,
    }[document.getElementById('pc-filtro-estado').value];
    this._render(base);
  },

  _render(empleados) {
    // Ruta y número interno viven en "employees" (no en el perfil
    // sociodemográfico opcional), así que un conductor cuenta acá aunque
    // todavía no haya completado su perfil sociodemográfico.
    const conductores = empleados.filter((e) => /conductor/i.test(e.cargo || ''));
    document.getElementById('pc-ruta-subtitulo').textContent =
      `${conductores.length} conductor${conductores.length === 1 ? '' : 'es'}`;

    const distRuta = distribucion(conductores, (e) => e.ruta);
    const rutasConConductores = distRuta.filter((d) => d.label !== 'Sin dato');
    const sinRuta = distRuta.find((d) => d.label === 'Sin dato');
    const lider = rutasConConductores[0]; // distribucion() ya ordena de mayor a menor
    document.getElementById('pc-ruta-kpi-rutas').textContent = rutasConConductores.length;
    document.getElementById('pc-ruta-kpi-sinruta').textContent = sinRuta ? sinRuta.count : 0;
    document.getElementById('pc-ruta-kpi-lider').textContent = lider ? `Ruta ${lider.label} (${lider.count})` : '—';
    this._renderRankedBars('pc-bars-ruta', distRuta);
  },

  // Ranking tipo "leaderboard" (rango + barra a color + %) -- más visual
  // que una barra plana, para que se lea de un vistazo cuál ruta concentra
  // más conductores.
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
      const etiqueta = esSinDato ? 'Sin dato' : 'Ruta ' + d.label;
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
});
