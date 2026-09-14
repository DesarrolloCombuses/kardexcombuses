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

Router.register('personal-alertas', {
  title: 'Cumpleaños y alertas',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pa-filtro-cargo').addEventListener('change', () => this._aplicarFiltro());
      this._bound = true;
    }
    const [empleados, dotacionIds] = await Promise.all([
      DB.getEmployeesConPerfil({ onlyActive: true }),
      DB.getEmployeeIdsConDotacion(),
    ]);
    this._empleadosAll = empleados;
    this._dotacionIds = dotacionIds;
    this._llenarFiltroCargo(this._empleadosAll);
    this._aplicarFiltro();
  },

  // Cargo se llena con los valores que realmente existen en los datos (no
  // una lista fija), igual que el filtro de cargo de Empleados.
  _llenarFiltroCargo(empleados) {
    const sel = document.getElementById('pa-filtro-cargo');
    const actual = sel.value;
    const opciones = [...new Set(empleados.map((e) => e.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const cargo = document.getElementById('pa-filtro-cargo').value;
    const filtrados = cargo ? this._empleadosAll.filter((e) => e.cargo === cargo) : this._empleadosAll;
    document.getElementById('pa-filtro-resultado').textContent = cargo
      ? `Mostrando ${filtrados.length} de ${this._empleadosAll.length} empleado(s) — cargo "${cargo}"`
      : `${this._empleadosAll.length} empleado(s)`;
    this._render(filtrados);
  },

  _render(empleados) {
    const conPerfil = empleados.filter((e) => e.perfil_sociodemografico);

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

    // No depende de perfil_sociodemografico (a diferencia de las otras dos):
    // basta con el Kardex de salidas para saber si a alguien ya se le
    // entregó dotación, sin importar si su perfil sociodemográfico está
    // completo o no.
    const sinDotacion = empleados
      .filter((e) => !this._dotacionIds.has(e.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    this._renderSinDotacion(sinDotacion);
  },

  // Lista de próximos cumpleaños (nombre, cargo, fecha y cuántos días
  // faltan) más un ranking por cargo, para saber tanto a quién felicitar
  // como qué cargo concentra más cumpleaños en el rango.
  _renderCumpleanos(items) {
    document.getElementById('pa-cumple-subtitulo').textContent =
      `${items.length} en los próximos ${DIAS_CUMPLE_PROXIMO} días`;
    const lista = document.getElementById('pa-cumple-lista');
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
    this._renderRankedBars('pa-bars-cumple-cargo', distribucion(items.map((x) => x.e), (e) => e.cargo));
  },

  // Mismo patrón que _renderCumpleanos: lista de personas (para saber
  // quiénes son, ej. para exámenes médicos periódicos) más el desglose por
  // cargo.
  _renderMayores50(items) {
    document.getElementById('pa-mayores50-subtitulo').textContent = `${items.length} persona(s)`;
    const lista = document.getElementById('pa-mayores50-lista');
    lista.innerHTML = items.length === 0
      ? '<p class="empty-note">Sin personas mayores de 50 años.</p>'
      : items.map((e) => `
        <div class="detalle-list-item">
          <span class="detalle-list-item-main">${e.nombre}</span>
          <span class="detalle-list-item-sub">${e.cargo || 'Sin cargo'} · ${edadDeFecha(e.perfil_sociodemografico.fecha_nacimiento)} años</span>
        </div>
      `).join('');
    this._renderRankedBars('pa-bars-mayores50-cargo', distribucion(items, (e) => e.cargo));
  },

  // Cruce Kardex + Empleados: quiénes no tienen ni una sola salida
  // registrada a su nombre -- para que bodega sepa a quién le falta
  // entregarle dotación, sin tener que ir a Historial a buscar uno por uno.
  _renderSinDotacion(items) {
    document.getElementById('pa-sindotacion-subtitulo').textContent = `${items.length} persona(s)`;
    const lista = document.getElementById('pa-sindotacion-lista');
    lista.innerHTML = items.length === 0
      ? '<p class="empty-note">Todos tienen al menos una entrega de dotación registrada.</p>'
      : items.map((e) => `
        <div class="detalle-list-item">
          <span class="detalle-list-item-main">${e.nombre}</span>
          <span class="detalle-list-item-sub">${e.cargo || 'Sin cargo'} · CC ${e.cedula}</span>
        </div>
      `).join('');
    this._renderRankedBars('pa-bars-sindotacion-cargo', distribucion(items, (e) => e.cargo));
  },

  // Ranking tipo "leaderboard" (rango + barra a color + %) -- más visual
  // que una barra plana, para que se lea de un vistazo qué cargo concentra
  // más personas.
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
              <span class="ranked-label" title="${d.label}">${d.label}</span>
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
