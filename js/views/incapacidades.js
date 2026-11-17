// Incapacidades médicas del personal.
//
// Se registran y se corrigen aquí. Todas, incluidas las viejas.
//
// Hasta el 2026-11-17 esta tabla era una copia de solo lectura de un Google
// Sheet de Gestión Humana, y las filas que venían de allá estaban bloqueadas
// a propósito: la sincronización las habría devuelto como estuvieran en el
// sheet. Apagado el sheet, ese bloqueo se volvía una trampa -- las 553 filas
// históricas quedarían congeladas para siempre, y entre ellas están las que
// traen la fecha final antes de la inicial y las que tienen una cédula que
// no cruza con Empleados. Se desbloquearon.
//
// La columna `origen` se conserva porque sigue siendo cierta: dice cuáles
// nadie escribió aquí y por tanto traen la calidad que traía el sheet.
// Ver sql/incapacidades_sin_sheet_2026-11-17.sql.
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

// Días entre dos fechas ISO, con el último día incluido: del 5 al 5 es un
// día, no cero. Es la misma cuenta que hace el servidor al guardar
// (kardex_incapacidad_guardar); se repite acá solo para poder enseñarla
// mientras se llena el formulario, no para mandarla -- los días que se
// guardan los calcula la base de datos.
function incDiasEntre(inicioIso, finIso) {
  if (!inicioIso || !finIso) return null;
  const a = new Date(inicioIso + 'T00:00:00');
  const b = new Date(finIso + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000) + 1;
}

// El rótulo y su asterisco de obligatorio, dentro del MISMO elemento.
// ".form label" es un flex en columna: un texto suelto y un <span> hermano
// cuentan como dos hijos, así que el asterisco caía en su propia línea,
// debajo del rótulo y encima del campo.
function incReq(texto) {
  return `<span>${texto} <span class="req-star">*</span></span>`;
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
      ['inc-desde', 'inc-hasta', 'inc-tipo', 'inc-area', 'inc-origen'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('inc-buscar').addEventListener('input', () => this._render());
      document.getElementById('inc-limpiar-btn')
        .addEventListener('click', () => this._limpiarFiltros());
      document.getElementById('inc-export-btn')
        .addEventListener('click', () => this._exportar());
      document.getElementById('inc-nueva-btn')
        .addEventListener('click', () => this._abrirFormulario(null));
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const msg = document.getElementById('inc-msg');
    msg.classList.add('hidden');
    this._permisos = this._permisos || {};
    Loading.show('Cargando incapacidades…');
    try {
      // En paralelo: los permisos no dependen de las filas, y pedir uno
      // detrás del otro solo haría más lenta la pantalla.
      const [filas, permisos] = await Promise.all([
        DB.getIncapacidades(),
        DB.getIncapacidadesPermisos(),
      ]);
      this._filas = filas;
      this._permisos = permisos;
    } catch (err) {
      this._filas = [];
      msg.textContent = /42501|permiso/i.test(err.message || '')
        ? 'Tu cuenta no tiene permiso para ver Incapacidades. Pídeselo a Gestión Humana en Usuarios.'
        : 'No se pudieron cargar las incapacidades: ' + err.message;
      msg.className = 'form-msg error';
      msg.classList.remove('hidden');
    } finally {
      Loading.hide();
    }

    // Si la primera fila trae la clave, es que al servidor le pareció bien
    // dárnosla. No se consulta el rol: manda lo que llegó.
    this._verDiagnostico = this._filas.some((f) => 'diagnostico_codigo' in f);

    document.getElementById('inc-nueva-btn')
      .classList.toggle('hidden', !this._permisos.registrar);

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

  _limpiarFiltros() {
    ['inc-desde', 'inc-hasta', 'inc-tipo', 'inc-area', 'inc-origen', 'inc-buscar']
      .forEach((id) => { document.getElementById(id).value = ''; });
    this._render();
  },

  _filtradas() {
    const desde = document.getElementById('inc-desde').value;
    const hasta = document.getElementById('inc-hasta').value;
    const tipo = document.getElementById('inc-tipo').value.trim().toUpperCase();
    const area = document.getElementById('inc-area').value;
    const origen = document.getElementById('inc-origen').value;
    const q = document.getElementById('inc-buscar').value.trim().toLowerCase();

    return (this._filas || []).filter((f) => {
      if (desde && (!f.fecha_inicio || f.fecha_inicio < desde)) return false;
      if (hasta && (!f.fecha_inicio || f.fecha_inicio > hasta)) return false;
      if (tipo && (f.tipo_evento || '').trim().toUpperCase() !== tipo) return false;
      if (area && (f.area || '').trim() !== area) return false;
      if (origen && (f.origen || 'SHEET') !== origen) return false;
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
  //
  // Las registradas en Kardex no pueden tener ese problema: la base de datos
  // las rechaza (CHECK kardex_incapacidades_fechas_check).
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
        + ' Sus días no se están sumando (saldrían negativos). Están marcadas en ámbar abajo:'
        + ' ábrelas con «Corregir» y pon la fecha buena.');
    }

    const fuera = filas.filter((f) => !f.en_nomina);
    if (fuera.length) {
      const cuantos = new Set(fuera.map((f) => f.cedula)).size;
      avisos.push(`<strong>${fuera.length}</strong> incapacidad(es) de <strong>${cuantos}</strong> cédula(s)`
        + ' que no están en Empleados. O la cédula quedó mal escrita, o esa persona nunca se cargó'
        + ' al sistema. Al abrirlas con «Corregir» se puede volver a elegir a la persona.');
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

  // Columnas de DATOS. La de acciones NO va aquí a propósito: esta misma
  // lista arma el Excel, y unos botones no son un dato.
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
    cols.push({
      k: 'origen',
      t: 'Origen',
      f: (f) => {
        const o = f.origen === 'KARDEX' ? 'KARDEX' : 'SHEET';
        const texto = o === 'KARDEX' ? 'Kardex' : 'Histórica';
        const ayuda = o === 'KARDEX'
          ? 'Registrada en Kardex.'
          : 'Venía del Google Sheet que Gestión Humana usó hasta el 17/11/2026.'
            + ' Se corrige aquí, como cualquier otra.';
        return `<span class="inc-origen" data-origen="${o}" title="${incEscapeHtml(ayuda)}">${texto}</span>`;
      },
    });
    return cols;
  },

  // Todas se pueden corregir, también las históricas.
  //
  // Hasta el 2026-11-17 las del sheet no se podían: la sincronización las
  // devolvía como estuvieran allá. Apagado el sheet, mantener el bloqueo
  // solo serviría para que los errores que trajo el sheet no se pudieran
  // arreglar en ninguna parte.
  _editable() {
    return true;
  },

  _renderTabla(filas) {
    const tabla = document.getElementById('inc-tabla');
    const cols = this._columnas();
    const hayAcciones = !!(this._permisos.editar || this._permisos.borrar);
    const totalCols = cols.length + (hayAcciones ? 1 : 0);

    tabla.querySelector('thead').innerHTML = '<tr>'
      + cols.map((c) => `<th>${c.t}</th>`).join('')
      + (hayAcciones ? '<th class="inc-td-acciones"></th>' : '')
      + '</tr>';

    if (!filas.length) {
      tabla.querySelector('tbody').innerHTML =
        `<tr><td colspan="${totalCols}" class="empty-note">Ninguna incapacidad con estos filtros.</td></tr>`;
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
          + ' sus días no se están sumando. Corrígela con el botón Corregir."';
      } else if (!f.en_nomina) {
        marca = ' data-revisar="cedula" title="Esta cédula no está en Empleados."'
          + ' style="opacity:.72"';
      }

      let acciones = '';
      if (hayAcciones) {
        const botones = [];
        if (this._editable(f)) {
          if (this._permisos.editar) {
            botones.push(`<button type="button" class="inc-editar" data-id="${f.id}">Corregir</button>`);
          }
          if (this._permisos.borrar) {
            botones.push(`<button type="button" class="inc-borrar" data-id="${f.id}">Borrar</button>`);
          }
        }
        // inc-td-acciones la deja pegada al borde derecho: la tabla es ancha
        // y se desplaza en horizontal, y unos botones que hay que ir a
        // buscar fuera de la pantalla no los encuentra nadie.
        acciones = `<td class="inc-td-acciones"><div class="inc-fila-acciones">${botones.join('')}</div></td>`;
      }

      return `<tr${marca}>${cols.map((c) => `<td>${c.f(f)}</td>`).join('')}${acciones}</tr>`;
    }).join('');

    tabla.querySelectorAll('.inc-editar').forEach((b) => {
      b.addEventListener('click', () => this._abrirFormulario(
        this._filas.find((f) => String(f.id) === b.dataset.id)));
    });
    tabla.querySelectorAll('.inc-borrar').forEach((b) => {
      b.addEventListener('click', () => this._borrar(
        this._filas.find((f) => String(f.id) === b.dataset.id)));
    });
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

  // ---- Registrar y corregir -------------------------------------------------

  async _abrirFormulario(fila) {
    const esNueva = !fila;
    if (!this._empleados) {
      try {
        this._empleados = await DB.getEmployees({ onlyActive: true });
      } catch (_) {
        this._empleados = [];
      }
    }

    const verDx = !!this._permisos.diagnostico;
    const epsConocidas = [...new Set((this._filas || [])
      .map((f) => (f.eps || '').trim()).filter(Boolean))].sort();

    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${esNueva ? 'Registrar incapacidad' : 'Corregir incapacidad'}</div>
          <div class="detalle-sub">${esNueva
            ? 'Queda guardada en Kardex. La sincronización del Google Sheet no la toca.'
            : `${incEscapeHtml(fila.nombre || '')} · CC ${incEscapeHtml(fila.cedula || '')}`}</div>
        </div>
      </div>

      <div class="modal-section">
        <form class="form" id="inc-form">
          <label>${incReq('Persona')}
            <div class="combobox" id="inc-combobox">
              <input type="text" id="inc-persona-buscar" autocomplete="off"
                     placeholder="Buscar por nombre o cédula…"
                     value="${esNueva ? '' : incEscapeHtml(fila.nombre + ' — CC ' + fila.cedula)}" />
              <input type="hidden" id="inc-persona-cedula" value="${esNueva ? '' : incEscapeHtml(fila.cedula)}" />
              <ul class="combobox-list hidden" id="inc-persona-lista"></ul>
            </div>
          </label>
          ${(!esNueva && !fila.en_nomina) ? '<p class="empty-note">Esta cédula no está en Empleados: la incapacidad no le cuenta a nadie. Busca a la persona correcta y elígela de la lista.</p>' : ''}

          <div class="form-row">
            <label>${incReq('Tipo de evento')}
              <select id="inc-f-tipo">
                <option value="EG">EG — enfermedad general</option>
                <option value="AT">AT — accidente de trabajo</option>
                <option value="EL">EL — enfermedad laboral</option>
              </select>
            </label>
            <label>EPS
              <input type="text" id="inc-f-eps" list="inc-eps-lista"
                     value="${esNueva ? '' : incEscapeHtml(fila.eps || '')}" />
              <datalist id="inc-eps-lista">
                ${epsConocidas.map((e) => `<option value="${incEscapeHtml(e)}"></option>`).join('')}
              </datalist>
            </label>
          </div>

          <div class="form-row">
            <label>${incReq('Desde')}
              <input type="date" id="inc-f-inicio" value="${esNueva ? '' : incEscapeHtml(fila.fecha_inicio || '')}" required />
            </label>
            <label>${incReq('Hasta')}
              <input type="date" id="inc-f-fin" value="${esNueva ? '' : incEscapeHtml(fila.fecha_fin || '')}" required />
            </label>
          </div>
          <p class="inc-dias-nota" id="inc-f-dias">Pon las dos fechas para calcular los días.</p>

          ${verDx ? `
          <div class="form-row">
            <label>Código del diagnóstico
              <input type="text" id="inc-f-dx-cod" placeholder="Ej. J00"
                     value="${esNueva ? '' : incEscapeHtml(fila.diagnostico_codigo || '')}" />
            </label>
            <label>Diagnóstico
              <input type="text" id="inc-f-dx-desc"
                     value="${esNueva ? '' : incEscapeHtml(fila.diagnostico_descripcion || '')}" />
            </label>
          </div>
          <p class="empty-note">Dato de salud: solo lo ven las cuentas de Gestión Humana y los administradores.</p>
          ` : ''}

          <label>Observaciones
            <textarea id="inc-f-obs" rows="2">${esNueva ? '' : incEscapeHtml(fila.observaciones || '')}</textarea>
          </label>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.8rem">
            <button type="submit" id="inc-f-guardar">${esNueva ? 'Registrar' : 'Guardar cambios'}</button>
            <button type="button" class="btn-secondary" id="inc-f-cerrar">Cancelar</button>
          </div>
          <p id="inc-f-msg" class="form-msg"></p>
          ${esNueva ? '' : `<p class="inc-meta">${incEscapeHtml(this._pie(fila))}</p>`}
        </form>
      </div>
    `;

    document.getElementById('inc-f-tipo').value = esNueva
      ? 'EG'
      : ((fila.tipo_evento || 'EG').trim().toUpperCase());

    this._montarCombobox(esNueva, fila);

    const inicio = document.getElementById('inc-f-inicio');
    const fin = document.getElementById('inc-f-fin');
    inicio.addEventListener('change', () => {
      // Comodidad: si todavía no hay fecha final, se propone el mismo día.
      // Una incapacidad de un solo día es la más común y así no hay que
      // escribir dos veces la misma fecha.
      if (!fin.value) fin.value = inicio.value;
      this._notaDias();
    });
    fin.addEventListener('change', () => this._notaDias());
    this._notaDias();

    document.getElementById('inc-f-cerrar').addEventListener('click', () => {
      document.getElementById('modal-backdrop').classList.add('hidden');
    });
    document.getElementById('inc-form')
      .addEventListener('submit', (e) => this._guardar(e, fila));
  },

  _pie(fila) {
    const partes = [];
    if (fila.creado_por) {
      partes.push('Registrada por ' + fila.creado_por
        + (fila.creado_en ? ' el ' + incFecha(fila.creado_en) : ''));
    }
    if (fila.actualizado_por) {
      partes.push('última corrección de ' + fila.actualizado_por
        + (fila.actualizado_en ? ' el ' + incFecha(fila.actualizado_en) : ''));
    }
    return partes.join(' · ');
  },

  // Enseña la cuenta ANTES de guardar. Es la misma que hace el servidor;
  // acá solo se muestra, no se manda -- los días que se guardan los calcula
  // la base de datos a partir de las fechas, igual que las fechas al revés
  // las rechaza la base de datos y no este aviso.
  _notaDias() {
    const nota = document.getElementById('inc-f-dias');
    if (!nota) return;
    const inicio = document.getElementById('inc-f-inicio').value;
    const fin = document.getElementById('inc-f-fin').value;
    if (!inicio || !fin) {
      nota.textContent = 'Pon las dos fechas para calcular los días.';
      nota.className = 'inc-dias-nota';
      return;
    }
    const dias = incDiasEntre(inicio, fin);
    if (dias === null || dias < 1) {
      nota.textContent = 'La fecha de fin no puede ser anterior a la de inicio.';
      nota.className = 'inc-dias-nota error';
      return;
    }
    nota.textContent = dias === 1
      ? 'Es 1 día de incapacidad (el día final cuenta).'
      : `Son ${dias} días de incapacidad (los dos extremos cuentan).`;
    nota.className = 'inc-dias-nota';
  },

  _montarCombobox(esNueva, fila) {
    const buscar = document.getElementById('inc-persona-buscar');
    const oculto = document.getElementById('inc-persona-cedula');
    const lista = document.getElementById('inc-persona-lista');
    const MAX = 40;

    // Al corregir no se cambia de persona: eso sería otra incapacidad, de
    // otro expediente. Si se equivocaron de persona, se borra y se registra
    // bien, y así queda rastro de las dos cosas.
    //
    // La excepción son las filas cuya cédula no cruza con Empleados -- las
    // que trajo el sheet mal escritas. Ahí elegir persona NO es cambiar de
    // expediente: es decir por fin de quién era la incapacidad. Dejarlas
    // bloqueadas las condenaría a no contarle a nadie para siempre.
    const hayQueReasignar = !esNueva && fila && !fila.en_nomina;
    if (!esNueva && !hayQueReasignar) {
      buscar.readOnly = true;
      return;
    }

    const pintar = () => {
      const q = buscar.value.trim().toLowerCase();
      if (!q) { lista.classList.add('hidden'); return; }
      const encontrados = (this._empleados || []).filter((e) =>
        String(e.nombre || '').toLowerCase().includes(q)
        || String(e.cedula || '').includes(q)).slice(0, MAX);
      lista.innerHTML = encontrados.length
        ? encontrados.map((e) => `<li data-cedula="${incEscapeHtml(e.cedula)}">${incEscapeHtml(e.nombre)} — CC ${incEscapeHtml(e.cedula)}</li>`).join('')
        : '<li class="combobox-empty">Nadie coincide</li>';
      lista.classList.remove('hidden');
      lista.querySelectorAll('[data-cedula]').forEach((li) => {
        li.addEventListener('click', () => {
          const emp = (this._empleados || []).find((e) => String(e.cedula) === li.dataset.cedula);
          if (!emp) return;
          oculto.value = emp.cedula;
          buscar.value = emp.nombre + ' — CC ' + emp.cedula;
          lista.classList.add('hidden');
        });
      });
    };
    // Se borra la cédula elegida en cuanto se vuelve a escribir: si no, el
    // texto diría una persona y se guardaría otra.
    buscar.addEventListener('input', () => { oculto.value = ''; pintar(); });
  },

  async _guardar(evento, fila) {
    evento.preventDefault();
    const msg = document.getElementById('inc-f-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const fallar = (t) => { msg.textContent = t; msg.className = 'form-msg error'; };

    const cedula = document.getElementById('inc-persona-cedula').value.trim();
    const inicio = document.getElementById('inc-f-inicio').value;
    const fin = document.getElementById('inc-f-fin').value;

    if (!cedula) return fallar('Busca y selecciona a la persona en la lista.');
    if (!inicio || !fin) return fallar('Hacen falta la fecha de inicio y la de fin.');
    if (fin < inicio) return fallar('La fecha de fin no puede ser anterior a la de inicio.');

    const datos = {
      id: fila ? fila.id : null,
      cedula,
      tipo_evento: document.getElementById('inc-f-tipo').value,
      eps: document.getElementById('inc-f-eps').value,
      fecha_inicio: inicio,
      fecha_fin: fin,
      observaciones: document.getElementById('inc-f-obs').value,
    };
    // Las claves del diagnóstico solo se mandan si esta cuenta puede verlo.
    // Mandarlas vacías desde una cuenta que no lo ve borraría el diagnóstico
    // de una incapacidad ya registrada con solo abrirla y guardarla. El
    // servidor también se protege de eso, pero no hay por qué mandarlo.
    if (this._permisos.diagnostico) {
      datos.diagnostico_codigo = document.getElementById('inc-f-dx-cod').value;
      datos.diagnostico_descripcion = document.getElementById('inc-f-dx-desc').value;
    }

    const btn = document.getElementById('inc-f-guardar');
    btn.disabled = true;
    try {
      await DB.guardarIncapacidad(datos);
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
      this._avisar(fila ? 'Incapacidad corregida.' : 'Incapacidad registrada.', 'success');
    } catch (err) {
      fallar(err.message || 'No se pudo guardar.');
    } finally {
      btn.disabled = false;
    }
  },

  async _borrar(fila) {
    if (!fila) return;
    const quien = fila.nombre || fila.cedula;
    if (!confirm('¿Borrar la incapacidad de ' + quien
      + ' del ' + incFecha(fila.fecha_inicio) + ' al ' + incFecha(fila.fecha_fin) + '?')) return;
    try {
      await DB.borrarIncapacidad(fila.id);
      await this._load();
      this._avisar('Incapacidad borrada.', 'success');
    } catch (err) {
      this._avisar('No se pudo borrar: ' + err.message, 'error');
    }
  },

  // _load() esconde el aviso al arrancar, así que avisar DESPUÉS de
  // recargar es lo que hace que el mensaje se quede en pantalla.
  _avisar(texto, tono) {
    const aviso = document.getElementById('inc-msg');
    aviso.textContent = texto;
    aviso.className = 'form-msg ' + tono;
    aviso.classList.remove('hidden');
  },
});
