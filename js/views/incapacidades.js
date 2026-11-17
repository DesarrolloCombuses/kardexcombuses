// Incapacidades médicas del personal.
//
// Los datos vienen de un Google Sheet que mantiene Gestión Humana y que una
// Edge Function copia a Supabase cada hora (ver
// supabase/functions/sync-incapacidades y sql/incapacidades_2026-11-16.sql).
// Esta vista no toca el sheet: solo lee la copia y, con el botón "Actualizar
// ahora", pide que se vuelva a bajar.
//
// EL DIAGNÓSTICO NO SE ESCONDE AQUÍ
// ---------------------------------
// El sheet trae código y descripción del diagnóstico de cada persona. Quién
// puede verlo lo decide el SERVIDOR: si la cuenta no es admin ni del grupo
// GESTION HUMANA, la respuesta llega sin esas claves. Por eso esta vista no
// pregunta por el rol para decidir qué pinta -- mira si la clave vino.
//
// Es a propósito. Esconderlo en el navegador no protegería nada: el dato ya
// habría viajado y se vería en la pestaña de red de cualquier navegador.

const INC_TIPOS = {
  EG: 'Enfermedad general',
  AT: 'Accidente de trabajo',
  EL: 'Enfermedad laboral',
};

function incEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function incFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return (a && m && d) ? `${d}/${m}/${a}` : '—';
}

function incMesLargo(clave) {
  const [a, m] = String(clave).split('-').map(Number);
  if (!a || !m) return clave;
  return new Date(a, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}

// Columnas por mes. Copia local a propósito, como en las demás vistas: cada
// una se mantiene autocontenida en vez de depender de que otro archivo se
// haya cargado antes en app.html.
function incRenderColumnas(elId, filas) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!filas.length) {
    el.innerHTML = '<p class="empty-note">Sin incapacidades en este período.</p>';
    return;
  }
  const max = Math.max(1, ...filas.map((f) => f.valor));
  el.innerHTML = `
    <div class="col-chart-inner">
      <div class="col-chart-plot">
        ${filas.map((f) => `
          <div class="col-bars" title="${incEscapeHtml(f.titulo)}">
            <span class="col-bar in" data-pct="${(f.valor / max) * 100}"><span class="col-bar-value">${f.valor || ''}</span></span>
          </div>
        `).join('')}
      </div>
      <div class="col-chart-axis">
        ${filas.map((f) => `<span class="col-label">${incEscapeHtml(f.label)}</span>`).join('')}
      </div>
    </div>
  `;
  requestAnimationFrame(() => {
    el.querySelectorAll('.col-bar').forEach((b) => { b.style.height = b.dataset.pct + '%'; });
    // Se arranca mirando el mes más reciente, que es el que interesa.
    el.scrollLeft = el.scrollWidth;
  });
}

Router.register('incapacidades', {
  title: 'Incapacidades',

  async onEnter() {
    if (!this._bound) {
      ['inc-desde', 'inc-hasta', 'inc-tipo', 'inc-area'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('inc-buscar').addEventListener('input', () => this._render());
      document.getElementById('inc-actualizar-btn')
        .addEventListener('click', () => this._sincronizar());
      document.getElementById('inc-export-btn')
        .addEventListener('click', () => this._exportar());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const msg = document.getElementById('inc-msg');
    msg.classList.add('hidden');
    Loading.show('Cargando incapacidades…');
    try {
      this._filas = await DB.getIncapacidades();
    } catch (err) {
      this._filas = [];
      msg.textContent = /42501|permiso/i.test(err.message || '')
        ? 'Tu cuenta no tiene permiso para ver Incapacidades. Pídeselo a Gestión Humana en Usuarios.'
        : 'No se pudieron cargar las incapacidades: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }

    // Si la primera fila trae la clave, es que al servidor le pareció bien
    // dárnosla. No se consulta el rol: manda lo que llegó.
    this._verDiagnostico = this._filas.some((f) => 'diagnostico_codigo' in f);

    this._llenarAreas();
    this._render();
  },

  _llenarAreas() {
    const sel = document.getElementById('inc-area');
    const previo = sel.value;
    const areas = [...new Set(this._filas.map((f) => (f.area || '').trim()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todas</option>'
      + areas.map((a) => `<option>${incEscapeHtml(a)}</option>`).join('');
    sel.value = previo;
  },

  _filtradas() {
    const desde = document.getElementById('inc-desde').value;
    const hasta = document.getElementById('inc-hasta').value;
    const tipo = document.getElementById('inc-tipo').value.trim().toUpperCase();
    const area = document.getElementById('inc-area').value;
    const q = document.getElementById('inc-buscar').value.trim().toLowerCase();

    return (this._filas || []).filter((f) => {
      if (desde && (!f.fecha_inicio || f.fecha_inicio < desde)) return false;
      if (hasta && (!f.fecha_inicio || f.fecha_inicio > hasta)) return false;
      if (tipo && (f.tipo_evento || '').trim().toUpperCase() !== tipo) return false;
      if (area && (f.area || '').trim() !== area) return false;
      if (q) {
        const enNombre = (f.nombre || '').toLowerCase().includes(q);
        const enCedula = (f.cedula || '').includes(q);
        if (!enNombre && !enCedula) return false;
      }
      return true;
    });
  },

  // Los días negativos NO se suman como negativos: vienen de filas del sheet
  // con la fecha final anterior a la inicial, y restarían del total dejando
  // el ausentismo por debajo de lo real. Se cuentan como cero y la fila se
  // avisa aparte para que la corrijan en el sheet.
  _dias(f) {
    return Math.max(0, Number(f.dias) || 0);
  },

  _render() {
    const filas = this._filtradas();

    const dias = filas.reduce((s, f) => s + this._dias(f), 0);
    const personas = new Set(filas.map((f) => f.cedula)).size;
    document.getElementById('inc-kpi-eventos').textContent = filas.length.toLocaleString('es-CO');
    document.getElementById('inc-kpi-dias').textContent = dias.toLocaleString('es-CO');
    document.getElementById('inc-kpi-personas').textContent = personas.toLocaleString('es-CO');
    document.getElementById('inc-kpi-promedio').textContent = filas.length
      ? (dias / filas.length).toFixed(1).replace('.', ',')
      : '0';

    this._renderAvisos(filas);
    this._renderGrafica(filas);
    this._renderTabla(filas);

    const total = (this._filas || []).length;
    document.getElementById('inc-contador').textContent = filas.length === total
      ? `${total} incapacidad(es).`
      : `${filas.length} de ${total} incapacidad(es) con los filtros puestos.`;
  },

  // Lo que viene mal del sheet. No se corrige solo: se dice cuántas filas
  // son y qué les pasa, porque el arreglo va en el sheet y no aquí -- si se
  // "arreglara" en pantalla, el error seguiría allá para siempre.
  _renderAvisos(filas) {
    const cont = document.getElementById('inc-avisos');
    const avisos = [];

    const alReves = filas.filter((f) => f.fecha_fin && f.fecha_inicio && f.fecha_fin < f.fecha_inicio);
    if (alReves.length) {
      avisos.push(`<strong>${alReves.length}</strong> incapacidad(es) tienen la fecha final ANTES de la inicial.`
        + ' Sus días no se están sumando (saldrían negativos). Hay que corregirlas en el sheet.');
    }

    const fuera = filas.filter((f) => !f.en_nomina);
    if (fuera.length) {
      const cuantos = new Set(fuera.map((f) => f.cedula)).size;
      avisos.push(`<strong>${fuera.length}</strong> incapacidad(es) de <strong>${cuantos}</strong> cédula(s)`
        + ' que no están en Empleados. O la cédula está mal escrita en el sheet, o esa persona nunca se cargó al sistema.');
    }

    cont.innerHTML = avisos.length
      ? `<div class="visor-avisos">${avisos.map((a) => `<div class="visor-aviso"><span>${a}</span></div>`).join('')}</div>`
      : '';
  },

  _renderGrafica(filas) {
    const porMes = new Map();
    filas.forEach((f) => {
      if (!f.fecha_inicio) return;
      const k = String(f.fecha_inicio).slice(0, 7);
      porMes.set(k, (porMes.get(k) || 0) + this._dias(f));
    });
    const claves = [...porMes.keys()].sort();
    incRenderColumnas('inc-col-chart', claves.map((k) => ({
      label: incMesLargo(k),
      valor: porMes.get(k),
      titulo: `${incMesLargo(k)}: ${porMes.get(k)} día(s)`,
    })));
  },

  _columnas() {
    const cols = [
      { k: 'fecha_inicio', t: 'Inicio', f: (f) => incFecha(f.fecha_inicio) },
      { k: 'fecha_fin', t: 'Fin', f: (f) => incFecha(f.fecha_fin) },
      { k: 'dias', t: 'Días', f: (f) => (f.dias == null ? '—' : String(f.dias)) },
      { k: 'nombre', t: 'Nombre', f: (f) => incEscapeHtml(f.nombre || '—') },
      { k: 'cedula', t: 'Cédula', f: (f) => incEscapeHtml(f.cedula || '—') },
      { k: 'cargo', t: 'Cargo', f: (f) => incEscapeHtml(f.cargo || '—') },
      { k: 'area', t: 'Área', f: (f) => incEscapeHtml(f.area || '—') },
      { k: 'tipo_evento', t: 'Tipo', f: (f) => {
        const t = (f.tipo_evento || '').trim().toUpperCase();
        return t ? `<span title="${incEscapeHtml(INC_TIPOS[t] || t)}">${incEscapeHtml(t)}</span>` : '—';
      } },
      { k: 'eps', t: 'EPS', f: (f) => incEscapeHtml(f.eps || '—') },
    ];
    if (this._verDiagnostico) {
      cols.push({ k: 'diagnostico_codigo', t: 'Dx', f: (f) => incEscapeHtml(f.diagnostico_codigo || '—') });
      cols.push({
        k: 'diagnostico_descripcion',
        t: 'Diagnóstico',
        f: (f) => incEscapeHtml(f.diagnostico_descripcion || '—'),
      });
    }
    return cols;
  },

  _renderTabla(filas) {
    const tabla = document.getElementById('inc-tabla');
    const cols = this._columnas();
    tabla.querySelector('thead').innerHTML =
      `<tr>${cols.map((c) => `<th>${c.t}</th>`).join('')}</tr>`;

    if (!filas.length) {
      tabla.querySelector('tbody').innerHTML =
        `<tr><td colspan="${cols.length}" class="empty-note">Ninguna incapacidad con estos filtros.</td></tr>`;
      return;
    }

    // Las filas con algo mal se marcan en la tabla, no solo en el aviso de
    // arriba. Un aviso que dice "1 incapacidad tiene las fechas al revés"
    // sin dejar encontrarla obliga a repasar la tabla entera a mano, que es
    // justo lo que el aviso tenía que evitar.
    tabla.querySelector('tbody').innerHTML = filas.map((f) => {
      const alReves = f.fecha_fin && f.fecha_inicio && f.fecha_fin < f.fecha_inicio;
      let marca = '';
      if (alReves) {
        marca = ' data-revisar="fechas" title="La fecha final es anterior a la inicial:'
          + ' sus días no se están sumando. Hay que corregirla en el sheet."';
      } else if (!f.en_nomina) {
        marca = ' data-revisar="cedula" title="Esta cédula no está en Empleados."'
          + ' style="opacity:.72"';
      }
      return `<tr${marca}>${cols.map((c) => `<td>${c.f(f)}</td>`).join('')}</tr>`;
    }).join('');
  },

  // Baja lo que esté filtrado, no la base entera: el Excel tiene que
  // coincidir con lo que la persona está mirando.
  _exportar() {
    const filas = this._filtradas();
    if (!filas.length) {
      const msg = document.getElementById('inc-msg');
      msg.textContent = 'No hay nada que descargar con estos filtros.';
      msg.className = 'form-msg error';
      msg.classList.remove('hidden');
      return;
    }
    const cols = this._columnas();
    const hoja = XLSX.utils.json_to_sheet(filas.map((f) => {
      const o = {};
      cols.forEach((c) => {
        // Para el Excel se quiere el valor crudo, no el HTML de la tabla.
        o[c.t] = c.k.startsWith('fecha_') ? incFecha(f[c.k]) : (f[c.k] ?? '');
      });
      o['En Empleados'] = f.en_nomina ? 'Sí' : 'No';
      return o;
    }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Incapacidades');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `incapacidades-combuses-${hoy}.xlsx`);
  },

  async _sincronizar() {
    const btn = document.getElementById('inc-actualizar-btn');
    const estado = document.getElementById('inc-sync-estado');
    btn.disabled = true;
    estado.textContent = 'Bajando el sheet…';
    try {
      const res = await DB.sincronizarIncapacidades();
      estado.textContent = `Actualizado: ${res.filas} fila(s).`;
      await this._load();
    } catch (err) {
      estado.textContent = '';
      const msg = document.getElementById('inc-msg');
      msg.textContent = 'No se pudo actualizar: ' + err.message
        + ' — lo que ves sigue siendo la última copia buena.';
      msg.className = 'form-msg error';
      msg.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  },
});
