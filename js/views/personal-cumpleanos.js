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

Router.register('personal-cumpleanos', {
  title: 'Cumpleaños',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('cu-filtro-cargo').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('cu-pdf-btn').addEventListener('click', () => this._descargarPdf());
      this._bound = true;
    }
    this._empleadosAll = await DB.getEmployeesConPerfil({ onlyActive: true });
    this._llenarFiltroCargo(this._empleadosAll);
    this._aplicarFiltro();
  },

  // Cargo se llena con los valores que realmente existen en los datos (no
  // una lista fija), igual que el filtro de cargo de Empleados.
  _llenarFiltroCargo(empleados) {
    const sel = document.getElementById('cu-filtro-cargo');
    const actual = sel.value;
    const opciones = [...new Set(empleados.map((e) => e.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${sel.dataset.todos}</option>` + opciones.map((v) => `<option value="${v}">${v}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  },

  _aplicarFiltro() {
    const cargo = document.getElementById('cu-filtro-cargo').value;
    const filtrados = cargo ? this._empleadosAll.filter((e) => e.cargo === cargo) : this._empleadosAll;
    document.getElementById('cu-filtro-resultado').textContent = cargo
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
    // Se guarda para "Descargar PDF" -- así el PDF sale con exactamente lo
    // mismo que se está viendo en pantalla (mismo filtro de cargo aplicado).
    this._items = proximosCumple;
    this._renderCumpleanos(proximosCumple);
  },

  // Lista de próximos cumpleaños (nombre, cargo, fecha y cuántos días
  // faltan) más un ranking por cargo, para saber tanto a quién felicitar
  // como qué cargo concentra más cumpleaños en el rango.
  _renderCumpleanos(items) {
    document.getElementById('cu-cumple-subtitulo').textContent =
      `${items.length} en los próximos ${DIAS_CUMPLE_PROXIMO} días`;
    const lista = document.getElementById('cu-cumple-lista');
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
    this._renderRankedBars('cu-bars-cumple-cargo', distribucion(items.map((x) => x.e), (e) => e.cargo));
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

  // Mismo patrón que "Paz y salvo" en empleados.js: una ventana nueva con
  // un documento HTML autocontenido y un botón que llama a window.print()
  // -- así "Guardar como PDF" lo resuelve el propio diálogo de impresión
  // del navegador, sin depender de ninguna librería de PDF.
  _descargarPdf() {
    const items = this._items || [];
    const cargo = document.getElementById('cu-filtro-cargo').value;
    const filasHtml = items.length
      ? items.map(({ e, dias }) => {
        const fechaTexto = new Date(`${e.perfil_sociodemografico.fecha_nacimiento}T00:00:00`)
          .toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
        const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;
        return `<tr><td>${e.nombre}</td><td>${e.cargo || '—'}</td><td>${fechaTexto}</td><td>${cuando}</td></tr>`;
      }).join('')
      : `<tr><td colspan="4" style="text-align:center;color:#888">Sin cumpleaños en los próximos ${DIAS_CUMPLE_PROXIMO} días.</td></tr>`;

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Cumpleaños próximos — Combuses</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px; }
  .doc-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; border-bottom: 2px solid #0a1930; padding-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 17px; color: #0a1930; }
  .doc-meta { text-align: right; font-size: 11.5px; color: #444; line-height: 1.5; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; font-size: 12.5px; text-align: left; }
  th { background: #f3f4f6; text-transform: uppercase; font-size: 11px; }
  tr:nth-child(even) td { background: #fafafa; }
  .print-actions { margin-bottom: 16px; }
  .print-actions button { font: inherit; padding: 8px 16px; border-radius: 6px; border: none; background: #2f6fed; color: #fff; font-weight: 600; cursor: pointer; }
  @media print { .print-actions { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="doc-header">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" stroke="#0a1930" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7l8 4 8-4M12 11v10" stroke="#0a1930" stroke-width="1.8" stroke-linejoin="round"/></svg>
      COMBUSES
    </div>
    <div class="doc-meta">
      Generado el ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}<br>
      ${items.length} persona(s) en los próximos ${DIAS_CUMPLE_PROXIMO} días
    </div>
  </div>
  <h1>Cumpleaños próximos${cargo ? ' — ' + cargo : ''}</h1>
  <table>
    <thead><tr><th>Nombre</th><th>Cargo</th><th>Fecha</th><th>Cuándo</th></tr></thead>
    <tbody>${filasHtml}</tbody>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) {
      alert('El navegador bloqueó la ventana emergente. Habilítala para este sitio e intenta de nuevo.');
      return;
    }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
  },
});
