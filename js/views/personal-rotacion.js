// Rotación de personal: ingresos y egresos por mes (últimos 12 meses
// rodantes), con el detalle de quiénes fueron en cada mes. Copia local de
// helpers (no compartidos con otras vistas a propósito, mismo criterio del
// resto del repo -- ver siniestros-transito.js, de donde se copió el patrón
// de "mes calendario + selector + tendencia de 12 meses").
//
// Fuente de datos: DB.getEmployeesConPerfil({onlyActive:false}) en una sola
// llamada trae employees (fecha_salida, motivo_renuncia, activo) +
// perfil_sociodemografico embebido (fecha_ingreso). OJO: fecha_ingreso vive
// en un perfil OPCIONAL -- un empleado sin ese perfil llenado no aparece en
// "Ingresos" (se cuenta aparte, ver _sinFechaIngreso), en vez de inventarle
// una fecha o usar created_at como aproximación silenciosa.

function prParseFechaIso(fechaIso) {
  if (!fechaIso) return null;
  const m = String(fechaIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  // Por componentes (hora local), no new Date(string) sobre el ISO
  // completo -- evita el corrimiento de un día por zona horaria (UTC-5).
  const [, yyyy, mm, dd] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function prFormatFecha(d) {
  return d ? d.toLocaleDateString('es-CO') : '—';
}

function prEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Mismo patrón que stRenderBarChart (siniestros-transito.js): barras
// horizontales simples, sin ranking (acá el orden es cronológico, no por
// magnitud).
function prRenderBarChart(elId, dist) {
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

function prRenderTablaPersonas(elId, personas, tipo) {
  const cols = tipo === 'egreso' ? 6 : 5;
  const tbody = document.querySelector(`#${elId} tbody`);
  if (!personas.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty-note">Sin ${tipo === 'egreso' ? 'egresos' : 'ingresos'} este mes.</td></tr>`;
    return;
  }
  tbody.innerHTML = personas.map((p) => `
    <tr>
      <td>${prFormatFecha(p.fecha)}</td>
      <td>${prEscapeHtml(p.nombre)}</td>
      <td>${prEscapeHtml(p.cedula || '—')}</td>
      <td>${prEscapeHtml(p.cargo || '—')}</td>
      <td>${prEscapeHtml(p.area || '—')}</td>
      ${tipo === 'egreso' ? `<td>${prEscapeHtml(p.motivo || '—')}</td>` : ''}
    </tr>
  `).join('');
}

Router.register('personal-rotacion', {
  title: 'Rotación de personal',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pr-mes-select').addEventListener('change', () => this._renderMes());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const empleados = await DB.getEmployeesConPerfil({ onlyActive: false });

    this._ingresos = [];
    this._egresos = [];
    let sinFechaIngreso = 0;

    empleados.forEach((e) => {
      const fi = prParseFechaIso(e.perfil_sociodemografico?.fecha_ingreso);
      if (fi) {
        this._ingresos.push({ nombre: e.nombre, cedula: e.cedula, cargo: e.cargo, area: e.area, fecha: fi });
      } else {
        sinFechaIngreso++;
      }
      const fs = prParseFechaIso(e.fecha_salida);
      if (fs) {
        this._egresos.push({ nombre: e.nombre, cedula: e.cedula, cargo: e.cargo, area: e.area, fecha: fs, motivo: e.motivo_renuncia });
      }
    });
    this._sinFechaIngreso = sinFechaIngreso;
    this._activosHoy = empleados.filter((e) => e.activo).length;

    this._render();
  },

  _porMes(items) {
    const porMes = new Map();
    items.forEach((it) => {
      const key = `${it.fecha.getFullYear()}-${String(it.fecha.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes.has(key)) porMes.set(key, []);
      porMes.get(key).push(it);
    });
    return porMes;
  },

  _capitaliza(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  _render() {
    this._porMesIngresos = this._porMes(this._ingresos);
    this._porMesEgresos = this._porMes(this._egresos);

    // Ventana rodante fija de 12 meses (no "solo meses con datos"): el mes
    // actual primero, igual de vacíos que con datos -- así siempre se ve el
    // mismo período completo, sin que un mes sin movimientos desaparezca.
    const hoy = new Date();
    this._meses12 = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      this._meses12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const totalIngresos = this._meses12.reduce((s, k) => s + (this._porMesIngresos.get(k) || []).length, 0);
    const totalEgresos = this._meses12.reduce((s, k) => s + (this._porMesEgresos.get(k) || []).length, 0);
    const neto = totalIngresos - totalEgresos;

    document.getElementById('pr-kpi-ingresos').textContent = totalIngresos;
    document.getElementById('pr-kpi-egresos').textContent = totalEgresos;
    document.getElementById('pr-kpi-neto').textContent = (neto > 0 ? '+' : '') + neto;
    document.getElementById('pr-kpi-plantilla').textContent = this._activosHoy;

    const nota = document.getElementById('pr-nota-sin-fecha');
    nota.textContent = this._sinFechaIngreso
      ? `${this._sinFechaIngreso} empleado(s) sin fecha de ingreso en su perfil sociodemográfico -- no cuentan en "Ingresos" hasta que se complete.`
      : '';
    nota.classList.toggle('hidden', !this._sinFechaIngreso);

    const etiquetaMes = (k) => {
      const [anio, mes] = k.split('-').map(Number);
      return this._capitaliza(new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }));
    };
    prRenderBarChart('pr-bars-ingresos', this._meses12.map((k) => ({ label: etiquetaMes(k), count: (this._porMesIngresos.get(k) || []).length })));
    prRenderBarChart('pr-bars-egresos', this._meses12.map((k) => ({ label: etiquetaMes(k), count: (this._porMesEgresos.get(k) || []).length })));

    const sel = document.getElementById('pr-mes-select');
    const seleccionPrevia = sel.value;
    sel.innerHTML = this._meses12.map((k) => {
      const [anio, mes] = k.split('-').map(Number);
      const label = this._capitaliza(new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }));
      return `<option value="${k}">${label}</option>`;
    }).join('');
    sel.value = this._meses12.includes(seleccionPrevia) ? seleccionPrevia : this._meses12[0];

    this._renderMes();
  },

  _renderMes() {
    const key = document.getElementById('pr-mes-select').value;
    const ingresosMes = (this._porMesIngresos.get(key) || []).slice().sort((a, b) => a.fecha - b.fecha);
    const egresosMes = (this._porMesEgresos.get(key) || []).slice().sort((a, b) => a.fecha - b.fecha);
    document.getElementById('pr-contador-ingresos').textContent = `${ingresosMes.length} ingreso(s)`;
    document.getElementById('pr-contador-egresos').textContent = `${egresosMes.length} egreso(s)`;
    prRenderTablaPersonas('pr-tabla-ingresos', ingresosMes, 'ingreso');
    prRenderTablaPersonas('pr-tabla-egresos', egresosMes, 'egreso');
  },
});
