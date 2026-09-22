// Rotación de personal: ingresos y egresos por mes (últimos 12 meses
// rodantes), leído en gráficas. Copia local de helpers (no compartidos con
// otras vistas a propósito, mismo criterio del resto del repo -- ver
// siniestros-transito.js / personal-alertas.js, de donde se copiaron los
// patrones de "mes calendario + selector" y de barras rankeadas).
//
// Fuente de datos: DB.getEmployeesConPerfil({onlyActive:false}) en una sola
// llamada trae employees (fecha_salida, motivo_renuncia, activo) +
// perfil_sociodemografico embebido (fecha_ingreso). OJO: fecha_ingreso vive
// en un perfil OPCIONAL -- un empleado sin ese perfil llenado no aparece en
// "Ingresos" (se cuenta aparte, ver _sinFechaIngreso), en vez de inventarle
// una fecha o usar created_at como aproximación silenciosa.

const PR_MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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

// Etiqueta corta armada a mano ("Sep 26"). Con toLocaleDateString en es-CO
// el formato corto sale como "sept de 26", que en el eje de una gráfica de
// 12 columnas se lee pésimo y no cabe.
function prEtiquetaMesCorta(key) {
  const [anio, mes] = key.split('-').map(Number);
  return `${PR_MESES_CORTOS[mes - 1]} ${String(anio).slice(2)}`;
}

function prEtiquetaMesLarga(key) {
  const [anio, mes] = key.split('-').map(Number);
  const s = new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prDistribucion(items, getKey) {
  const mapa = new Map();
  items.forEach((it) => {
    const k = (getKey(it) || '').trim() || 'Sin dato';
    mapa.set(k, (mapa.get(k) || 0) + 1);
  });
  return [...mapa.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// Columnas verticales agrupadas: la gráfica principal. Dos series (entraron
// / salieron) sobre los mismos 12 meses, para ver de un vistazo los meses en
// que se fue más gente de la que entró.
function prRenderColumnas(elId, filas) {
  const el = document.getElementById(elId);
  const max = Math.max(1, ...filas.map((f) => Math.max(f.ingresos, f.egresos)));
  el.innerHTML = `
    <div class="col-chart-inner">
      <div class="col-chart-plot">
        ${filas.map((f) => `
          <div class="col-bars" title="${prEscapeHtml(f.titulo)}: ${f.ingresos} ingreso(s), ${f.egresos} egreso(s)">
            <span class="col-bar in" data-pct="${(f.ingresos / max) * 100}"><span class="col-bar-value">${f.ingresos || ''}</span></span>
            <span class="col-bar out" data-pct="${(f.egresos / max) * 100}"><span class="col-bar-value">${f.egresos || ''}</span></span>
          </div>
        `).join('')}
      </div>
      <div class="col-chart-axis">
        ${filas.map((f) => `<span class="col-label">${prEscapeHtml(f.label)}</span>`).join('')}
      </div>
    </div>
  `;
  requestAnimationFrame(() => {
    el.querySelectorAll('.col-bar').forEach((bar) => { bar.style.height = bar.dataset.pct + '%'; });
    // En pantalla angosta la gráfica no cabe entera y arranca mostrando los
    // meses más viejos, dejando el mes actual escondido a la derecha; se
    // posiciona al final, que es por donde se empieza a mirar.
    el.scrollLeft = el.scrollWidth;
  });
}

// Barras horizontales comparadas: una fila por área/cargo con sus dos
// series. Horizontal (y no columnas como arriba) porque acá las etiquetas
// son largas -- "CONDUCTORES AEROPUERTO" no cabe bajo una columna.
function prRenderComparadas(elId, filas) {
  const el = document.getElementById(elId);
  if (!filas.length) {
    el.innerHTML = '<p class="empty-note">Sin datos en este período.</p>';
    return;
  }
  const max = Math.max(1, ...filas.map((f) => Math.max(f.ingresos, f.egresos)));
  el.innerHTML = filas.map((f) => `
    <div class="cmp-row">
      <div class="cmp-head">
        <span class="cmp-label" title="${prEscapeHtml(f.label)}">${prEscapeHtml(f.label)}</span>
        <span class="cmp-nums"><b class="in">+${f.ingresos}</b><b class="out">−${f.egresos}</b></span>
      </div>
      <span class="cmp-track"><span class="cmp-fill in" data-pct="${(f.ingresos / max) * 100}"></span></span>
      <span class="cmp-track"><span class="cmp-fill out" data-pct="${(f.egresos / max) * 100}"></span></span>
    </div>
  `).join('');
  requestAnimationFrame(() => {
    el.querySelectorAll('.cmp-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
  });
}

// Barras rankeadas de una sola serie (motivos de salida). Mismo patrón que
// personal-alertas.js / alertas-vencimientos.js.
const PR_PALETA = ['#d33d2b', '#e8743b', '#c9557e', '#8f5fd6', '#2f6fed', '#20b2aa', '#5ec26a', '#ff9f43'];

function prRenderRankeadas(elId, dist) {
  const el = document.getElementById(elId);
  const total = dist.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    el.innerHTML = '<p class="empty-note">Sin datos en este período.</p>';
    return;
  }
  const max = Math.max(...dist.map((d) => d.count)) || 1;
  let colorIdx = 0;
  el.innerHTML = dist.map((d, i) => {
    const esSinDato = d.label === 'Sin dato';
    const color = esSinDato ? '#c9d0db' : PR_PALETA[colorIdx++ % PR_PALETA.length];
    const pct = (d.count / total) * 100;
    return `
      <div class="ranked-row ${i === 0 && !esSinDato ? 'top-rank' : ''}">
        <span class="ranked-rank">${i + 1}</span>
        <div class="ranked-body">
          <div class="ranked-top-row">
            <span class="ranked-label" title="${prEscapeHtml(d.label)}">${prEscapeHtml(d.label)}</span>
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
}

// Barras horizontales simples en orden fijo (antigüedad al salir): acá el
// orden es el de los tramos, NO por magnitud -- rankearlo perdería la
// lectura de "se van apenas entran".
function prRenderTramos(elId, tramos) {
  const el = document.getElementById(elId);
  const total = tramos.reduce((s, t) => s + t.count, 0);
  if (total === 0) {
    el.innerHTML = '<p class="empty-note">Sin datos en este período.</p>';
    return;
  }
  const max = Math.max(...tramos.map((t) => t.count)) || 1;
  el.innerHTML = tramos.map((t) => `
    <div class="bar-row">
      <span class="bar-label" title="${prEscapeHtml(t.label)}">${prEscapeHtml(t.label)}</span>
      <span class="bar-track"><span class="bar-fill rojo" data-pct="${(t.count / max) * 100}"></span></span>
      <span class="bar-value">${t.count}</span>
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
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty-note">Sin ${tipo === 'egreso' ? 'egresos' : 'ingresos'} en este período.</td></tr>`;
    return;
  }
  tbody.innerHTML = personas.map((p) => `
    <tr>
      <td data-label="Fecha">${prFormatFecha(p.fecha)}</td>
      <td data-label="Nombre">${prEscapeHtml(p.nombre)}</td>
      <td data-label="Cédula">${prEscapeHtml(p.cedula || '—')}</td>
      <td data-label="Cargo">${prEscapeHtml(p.cargo || '—')}</td>
      <td data-label="Área">${prEscapeHtml(p.area || '—')}</td>
      ${tipo === 'egreso' ? `<td data-label="Motivo">${prEscapeHtml(p.motivo || '—')}</td>` : ''}
    </tr>
  `).join('');
}

Router.register('personal-rotacion', {
  title: 'Rotación de personal',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pr-mes-select').addEventListener('change', () => this._renderPeriodo());
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
        // fecha_ingreso se guarda también en el egreso para poder medir
        // cuánto duró la persona antes de salir.
        this._egresos.push({
          nombre: e.nombre, cedula: e.cedula, cargo: e.cargo, area: e.area,
          fecha: fs, motivo: e.motivo_renuncia, fechaIngreso: fi,
        });
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
      ? `${this._sinFechaIngreso} empleado(s) sin fecha de ingreso en su perfil sociodemográfico — no cuentan en "Ingresos" hasta que se complete.`
      : '';
    nota.classList.toggle('hidden', !this._sinFechaIngreso);

    // Gráfica principal en orden cronológico (el array va del mes actual
    // hacia atrás, así que se invierte para leer de izquierda a derecha).
    const cronologico = [...this._meses12].reverse();
    prRenderColumnas('pr-col-chart', cronologico.map((k) => ({
      label: prEtiquetaMesCorta(k),
      titulo: prEtiquetaMesLarga(k),
      ingresos: (this._porMesIngresos.get(k) || []).length,
      egresos: (this._porMesEgresos.get(k) || []).length,
    })));

    const sel = document.getElementById('pr-mes-select');
    const seleccionPrevia = sel.value;
    sel.innerHTML = `<option value="todos">Últimos 12 meses</option>`
      + this._meses12.map((k) => `<option value="${k}">${prEtiquetaMesLarga(k)}</option>`).join('');
    sel.value = (seleccionPrevia === 'todos' || this._meses12.includes(seleccionPrevia)) ? seleccionPrevia : 'todos';

    this._renderPeriodo();
  },

  // Tramos de antigüedad al momento de salir. El orden es el de los
  // tramos, no por magnitud (ver prRenderTramos).
  _tramosAntiguedad(egresos) {
    const tramos = [
      { label: 'Menos de 1 mes', count: 0, test: (d) => d < 30 },
      { label: 'De 1 a 3 meses', count: 0, test: (d) => d < 90 },
      { label: 'De 3 a 6 meses', count: 0, test: (d) => d < 180 },
      { label: 'De 6 a 12 meses', count: 0, test: (d) => d < 365 },
      { label: 'Más de 1 año', count: 0, test: () => true },
    ];
    const sinDato = { label: 'Sin fecha de ingreso', count: 0 };
    egresos.forEach((e) => {
      if (!e.fechaIngreso) { sinDato.count++; return; }
      const dias = Math.floor((e.fecha - e.fechaIngreso) / 86400000);
      // Una salida anterior al ingreso es un dato inconsistente: no se
      // fuerza al tramo más corto, se reporta aparte como dato faltante.
      if (dias < 0) { sinDato.count++; return; }
      tramos.find((t) => t.test(dias)).count++;
    });
    return sinDato.count ? [...tramos, sinDato] : tramos;
  },

  // Une las dos series (entraron / salieron) sobre la misma etiqueta, para
  // poder compararlas fila por fila.
  _comparadas(ingresos, egresos, getKey) {
    const mapa = new Map();
    const sumar = (items, campo) => {
      prDistribucion(items, getKey).forEach(({ label, count }) => {
        if (!mapa.has(label)) mapa.set(label, { label, ingresos: 0, egresos: 0 });
        mapa.get(label)[campo] = count;
      });
    };
    sumar(ingresos, 'ingresos');
    sumar(egresos, 'egresos');
    return [...mapa.values()].sort((a, b) => (b.ingresos + b.egresos) - (a.ingresos + a.egresos));
  },

  _renderPeriodo() {
    const key = document.getElementById('pr-mes-select').value;
    const claves = key === 'todos' ? this._meses12 : [key];

    const ingresos = claves
      .flatMap((k) => this._porMesIngresos.get(k) || [])
      .sort((a, b) => a.fecha - b.fecha);
    const egresos = claves
      .flatMap((k) => this._porMesEgresos.get(k) || [])
      .sort((a, b) => a.fecha - b.fecha);

    prRenderRankeadas('pr-bars-motivos', prDistribucion(egresos, (e) => e.motivo));
    prRenderTramos('pr-bars-antiguedad', this._tramosAntiguedad(egresos));
    prRenderComparadas('pr-bars-area', this._comparadas(ingresos, egresos, (p) => p.area));
    prRenderComparadas('pr-bars-cargo', this._comparadas(ingresos, egresos, (p) => p.cargo));

    document.getElementById('pr-contador-ingresos').textContent = `${ingresos.length} ingreso(s)`;
    document.getElementById('pr-contador-egresos').textContent = `${egresos.length} egreso(s)`;
    document.getElementById('pr-detalle-resumen').textContent = `${ingresos.length} ingreso(s) · ${egresos.length} egreso(s)`;
    prRenderTablaPersonas('pr-tabla-ingresos', ingresos, 'ingreso');
    prRenderTablaPersonas('pr-tabla-egresos', egresos, 'egreso');
  },
});
