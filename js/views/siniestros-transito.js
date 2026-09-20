// Comparendos (infracciones de tránsito), accidentes y siniestros de SST de
// los conductores, vistos todos juntos con sus estadísticas -- mismos datos
// que ya se cruzan por cédula uno por uno en el Paz y Salvo (ver
// js/views/empleados.js y js/siniestros.js), pero acá se ve la foto completa
// sin tener que revisar empleado por empleado.
//
// Comparendos/accidentes viven en Supabase (archivo que sube RRHH); los
// siniestros de SST se consultan en vivo de un Google Sheet publicado (ver
// js/siniestros.js) y por eso pueden fallar por separado -- esta vista no
// debe quedar en blanco solo porque ese Sheet esté caído.

const ORDEN_GRAVEDAD_ACCIDENTE = ['SOLO DAÑOS', 'HERIDO', 'MUERTO', 'Sin dato'];

// Copia local (no compartida con las vistas de personal-*.js) a propósito:
// cada vista de este proyecto se mantiene autocontenida en vez de depender
// de que otro archivo se haya cargado antes en app.html.
function stDistribucion(items, getValor, ordenFijo) {
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

function stRenderBarChart(elId, dist) {
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

// Comparendos/accidentes traen fecha_comparendo/fecha_accidente como
// timestamptz ISO (de Supabase); los siniestros de SST traen la fecha como
// texto libre del Sheet, normalmente "dd/mm/aaaa" pero sin garantía de
// formato. Se intentan ambos formatos y, si no calza ninguno, se devuelve
// null -- mejor un dato "sin fecha reconocible" que una fecha inventada.
function stParseFecha(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  if (!s) return null;
  // Se arma con los componentes (constructor de 3 argumentos, hora local) en
  // vez de new Date(s) sobre el string completo -- si "s" no trae hora/zona
  // explícita (puede pasar según cómo serialice el timestamptz), new Date()
  // la interpreta como medianoche UTC, que en Colombia (UTC-5) corre la
  // fecha -- y a veces el mes -- un día hacia atrás. Como acá solo importa
  // el día calendario (para mostrar y para agrupar por mes), se ignora la
  // hora a propósito.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Si no se puede interpretar la fecha, se muestra el texto crudo tal cual
// (nunca "—" en silencio) -- así se nota si el Sheet trae un formato raro,
// en vez de que el dato desaparezca sin explicación.
function stFormatFecha(valor) {
  const d = stParseFecha(valor);
  if (d) return d.toLocaleDateString('es-CO');
  return valor ? String(valor) : '—';
}

function stEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

Router.register('siniestros-transito', {
  title: 'Siniestros de tránsito',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    if (!this._bound) {
      document.getElementById('st-search').addEventListener('input', () => this._aplicarFiltro());
      document.getElementById('st-filtro-tipo').addEventListener('change', () => this._aplicarFiltro());
      document.getElementById('st-sst-actualizar-btn').addEventListener('click', () => this._actualizarSiniestrosAhora());
      document.getElementById('st-mes-select').addEventListener('change', () => {
        const porMes = this._mesesConDatos();
        this._renderRanking(porMes.get(document.getElementById('st-mes-select').value) || [], 'st-ranking-mes');
      });
      this._bound = true;
    }

    const [infracciones, accidentes] = await Promise.all([
      DB.getInfraccionesTransito(),
      DB.getAccidentesTransito(),
    ]);
    this._infracciones = infracciones;
    this._accidentes = accidentes;

    // Los siniestros de SST no traen nombre (solo cédula) -- se resuelve
    // contra la planta para poder mostrarlo igual que comparendos/accidentes.
    // Aparte del resto a propósito: si esto falla, lo único que se pierde es
    // el nombre de los siniestros de SST (quedan como "Sin nombre"), no toda
    // la vista -- antes iba en el mismo Promise.all de arriba y una falla
    // acá tumbaba también comparendos y accidentes, que no tienen nada que
    // ver con esta consulta.
    let nombrePorCedula = new Map();
    try {
      const empleados = await DB.getEmployees({ onlyActive: false });
      nombrePorCedula = new Map(empleados.map((e) => [e.cedula, e.nombre]));
    } catch (err) {
      // silencioso: es solo para completar nombres, no bloquea nada más
    }

    const sstMsg = document.getElementById('st-sst-msg');
    try {
      this._siniestros = await Siniestros.listarTodos();
      sstMsg.classList.add('hidden');
    } catch (err) {
      this._siniestros = [];
      sstMsg.textContent = 'No se pudieron cargar los siniestros de SST en este momento. Comparendos y accidentes sí se muestran normalmente.';
      sstMsg.classList.remove('hidden');
    }
    this._renderEstadoSync();

    // Lista unificada para la tabla/búsqueda/ranking -- las tres fuentes
    // comparten muy pocas columnas, así que cada una arma su propio texto de
    // "detalle" en vez de forzar columnas que casi siempre quedarían vacías.
    this._items = [
      ...infracciones.map((i) => ({
        fecha: i.fecha_comparendo,
        tipo: 'Comparendo',
        cedula: i.cedula,
        nombre: i.nombre_infractor,
        placa: i.placa,
        detalle: [i.codigo_infraccion, i.infraccion].filter(Boolean).join(' — ') || i.tipo_comparendo || '—',
      })),
      ...accidentes.map((a) => ({
        fecha: a.fecha_accidente,
        tipo: 'Accidente',
        cedula: a.cedula,
        nombre: a.nombre_infractor,
        placa: a.placa,
        detalle: [a.clase_accidente, a.gravedad_accidente].filter(Boolean).join(' — ') || a.direccion || '—',
      })),
      ...this._siniestros.map((s) => ({
        fecha: s.fecha,
        tipo: 'Siniestro SST',
        cedula: s.cedula,
        nombre: nombrePorCedula.get(s.cedula) || null,
        placa: null,
        detalle: [s.definicion, s.hipotesis].filter((v) => v && v !== 'N/N').join(' — ')
          || (s.pendiente ? 'Pendiente de conciliación' : 'Sin más detalle'),
      })),
    ].sort((a, b) => {
      const ta = stParseFecha(a.fecha)?.getTime() ?? -Infinity;
      const tb = stParseFecha(b.fecha)?.getTime() ?? -Infinity;
      return tb - ta;
    });

    this._render();
    this._aplicarFiltro();
  },

  // Hace cuánto se sincronizó por última vez la copia de siniestros SST en
  // Supabase -- para que quede claro que no es "en vivo" y se note si el
  // cron lleva mucho tiempo sin poder correr (ej. si Google cambió el link).
  _renderEstadoSync() {
    const el = document.getElementById('st-sst-sync-estado');
    const ultima = Siniestros.ultimaSincronizacion();
    if (!ultima) {
      el.textContent = 'Siniestros SST: sin sincronizar todavía.';
      return;
    }
    const fecha = new Date(ultima);
    const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
    const hace = minutos < 1 ? 'hace un momento'
      : minutos < 60 ? `hace ${minutos} min`
        : `hace ${Math.round(minutos / 60)} h`;
    el.textContent = `Siniestros SST actualizados ${hace} (${fecha.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}).`;
  },

  async _actualizarSiniestrosAhora() {
    const boton = document.getElementById('st-sst-actualizar-btn');
    const estado = document.getElementById('st-sst-sync-estado');
    boton.disabled = true;
    estado.textContent = 'Actualizando siniestros…';
    try {
      await Siniestros.actualizarAhora();
      await this.onEnter();
    } catch (err) {
      estado.textContent = 'No se pudo actualizar: ' + err.message;
    } finally {
      boton.disabled = false;
    }
  },

  _render() {
    document.getElementById('st-kpi-comparendos').textContent = this._infracciones.length;
    document.getElementById('st-kpi-accidentes').textContent = this._accidentes.length;
    document.getElementById('st-kpi-siniestros').textContent = this._siniestros.length;

    // "Con lesión" = cualquier accidente con gravedad distinta de "SOLO
    // DAÑOS" (típicamente HERIDO o MUERTO) -- el dato real que le importa a
    // SST no es solo cuántos accidentes hay, sino cuántos tuvieron personas
    // afectadas.
    const conLesion = this._accidentes.filter((a) => {
      const g = (a.gravedad_accidente || '').trim().toUpperCase();
      return g && g !== 'SOLO DAÑOS';
    }).length;
    document.getElementById('st-kpi-lesion').textContent = conLesion;

    const pendientes = this._siniestros.filter((s) => s.pendiente).length;
    document.getElementById('st-kpi-pendientes').textContent = pendientes;

    const cedulasUnicas = new Set([...this._infracciones, ...this._accidentes, ...this._siniestros].map((r) => r.cedula).filter(Boolean));
    document.getElementById('st-kpi-conductores').textContent = cedulasUnicas.size;

    stRenderBarChart('st-bars-tipo-comparendo', stDistribucion(this._infracciones, (i) => i.tipo_comparendo));
    stRenderBarChart('st-bars-gravedad', stDistribucion(this._accidentes, (a) => a.gravedad_accidente, ORDEN_GRAVEDAD_ACCIDENTE));
    stRenderBarChart('st-bars-conciliacion', stDistribucion(this._siniestros, (s) => s.conciliacion));
    stRenderBarChart('st-bars-definicion', stDistribucion(this._siniestros, (s) => (s.definicion === 'N/N' ? null : s.definicion)));

    this._renderRanking(this._items, 'st-ranking');
    this._renderTopMensual();
  },

  // Agrupa this._items por mes calendario (según su fecha ya parseada) --
  // para el trend "Incidentes por mes" y para el top de conductores de un
  // mes puntual (en vez de solo el acumulado histórico de "st-ranking").
  _mesesConDatos() {
    const porMes = new Map();
    this._items.forEach((it) => {
      const fecha = stParseFecha(it.fecha);
      if (!fecha) return;
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes.has(key)) porMes.set(key, []);
      porMes.get(key).push(it);
    });
    return porMes;
  },

  _capitaliza(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  // "Top del mes" (selector) + "Incidentes por mes" (tendencia, últimos 12
  // meses con datos) -- para ver de un vistazo si un conductor puntual se
  // repite mes a mes, no solo su total histórico.
  _renderTopMensual() {
    const porMes = this._mesesConDatos();
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    // El selector incluye el mes actual aunque todavía no tenga incidentes
    // registrados (para poder confirmar "0 en lo que va del mes" de una),
    // más todos los meses que sí tienen datos.
    const meses = [...new Set([mesActual, ...porMes.keys()])].sort().reverse();

    const sel = document.getElementById('st-mes-select');
    const seleccionPrevia = sel.value;
    sel.innerHTML = meses.map((k) => {
      const [anio, mes] = k.split('-').map(Number);
      const label = new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
      return `<option value="${k}">${this._capitaliza(label)}</option>`;
    }).join('');
    sel.value = meses.includes(seleccionPrevia) ? seleccionPrevia : mesActual;

    this._renderRanking(porMes.get(sel.value) || [], 'st-ranking-mes');

    // Tendencia: últimos 12 meses con datos, más reciente primero -- mismo
    // orden que el resto de listas de esta app (cumpleaños próximos,
    // historial, etc.).
    const ultimos12 = [...porMes.keys()].sort().reverse().slice(0, 12);
    const dist = ultimos12.map((k) => {
      const [anio, mes] = k.split('-').map(Number);
      const label = new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
      return { label: this._capitaliza(label), count: (porMes.get(k) || []).length };
    });
    stRenderBarChart('st-bars-mensual', dist);
  },

  // Leaderboard de conductores con más incidentes (comparendos + accidentes
  // + siniestros sumados) -- el dato que más le sirve a SST para saber a
  // quién llamar primero a una charla de seguridad vial. Reutilizado tanto
  // para el acumulado histórico (st-ranking) como para el top de un mes
  // puntual (st-ranking-mes).
  _renderRanking(items, elId) {
    const porCedula = new Map();
    items.forEach((it) => {
      if (!it.cedula) return;
      const actual = porCedula.get(it.cedula) || { nombre: it.nombre, count: 0 };
      if (!actual.nombre && it.nombre) actual.nombre = it.nombre;
      actual.count++;
      porCedula.set(it.cedula, actual);
    });
    const ranking = [...porCedula.entries()]
      .map(([cedula, v]) => ({ label: `${v.nombre || 'Sin nombre'} (CC ${cedula})`, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const el = document.getElementById(elId);
    if (!ranking.length) {
      el.innerHTML = '<p class="empty-note">Sin incidentes en este período.</p>';
      return;
    }
    const max = ranking[0].count || 1;
    let colorIdx = 0;
    el.innerHTML = ranking.map((r, i) => {
      const color = this._palette[colorIdx++ % this._palette.length];
      return `
        <div class="ranked-row ${i === 0 ? 'top-rank' : ''}">
          <span class="ranked-rank">${i + 1}</span>
          <div class="ranked-body">
            <div class="ranked-top-row">
              <span class="ranked-label" title="${stEscapeHtml(r.label)}">${stEscapeHtml(r.label)}</span>
              <span class="ranked-value">${r.count}</span>
            </div>
            <span class="ranked-track"><span class="ranked-fill" data-pct="${(r.count / max) * 100}" style="background:${color}"></span></span>
          </div>
        </div>
      `;
    }).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.ranked-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
    });
  },

  _aplicarFiltro() {
    const q = document.getElementById('st-search').value.trim().toLowerCase();
    const tipo = document.getElementById('st-filtro-tipo').value;
    let filtrados = this._items;
    if (tipo) filtrados = filtrados.filter((it) => it.tipo === tipo);
    if (q) {
      filtrados = filtrados.filter((it) =>
        (it.nombre || '').toLowerCase().includes(q)
        || (it.cedula || '').includes(q)
        || (it.placa || '').toLowerCase().includes(q)
      );
    }
    document.getElementById('st-contador').textContent = filtrados.length === this._items.length
      ? `${this._items.length} registro(s)`
      : `Mostrando ${filtrados.length} de ${this._items.length} registro(s)`;
    this._renderTabla(filtrados);
  },

  _renderTabla(items) {
    const tbody = document.getElementById('st-tbody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Sin resultados con estos filtros.</td></tr>';
      return;
    }
    const tagPorTipo = { Accidente: 'salida', Comparendo: 'activo', 'Siniestro SST': 'pendiente' };
    tbody.innerHTML = items.map((it) => `
      <tr>
        <td>${stEscapeHtml(stFormatFecha(it.fecha))}</td>
        <td><span class="tag ${tagPorTipo[it.tipo] || ''}">${stEscapeHtml(it.tipo)}</span></td>
        <td>${stEscapeHtml(it.nombre || '—')}</td>
        <td>${stEscapeHtml(it.cedula || '—')}</td>
        <td>${stEscapeHtml(it.placa || '—')}</td>
        <td>${stEscapeHtml(it.detalle)}</td>
      </tr>
    `).join('');
  },
});
