// Lineas celulares: inventario de las lineas moviles de la empresa, con su
// historico de responsables, de altas y bajas, y lo que factura cada una.
//
// Tres cosas que este modulo da por ciertas porque asi son los datos reales
// (ver sql/lineas_celulares_2026-09-25.sql):
//  - El responsable puede NO ser una persona: "Bahia Aeropuerto", "Taquilla
//    Sumni" y "Despacho Ruta 041 Aranjuez" son puestos o equipos. Por eso es
//    texto libre con enlace opcional a un empleado.
//  - Una misma linea puede facturar bajo dos contratos el mismo mes (pasa con
//    dos lineas hoy). El costo del mes de una linea es la SUMA de sus
//    renglones, no el primero que aparezca.
//  - Las fechas de permanencia y de pago no venian en el archivo de origen:
//    se capturan a mano aca. Mientras no existan, el panel de alertas lo dice
//    en vez de quedarse mudo y aparentar que todo esta al dia.

const LC_ESTADOS = {
  activa: { label: 'Activa', tag: 'activo' },
  suspendida: { label: 'Suspendida', tag: 'pendiente' },
  cancelada: { label: 'Cancelada', tag: 'inactivo-tag' },
};

// Mismo umbral que Parque automotor, para que "por vencer" signifique lo
// mismo en toda la app.
const LC_DIAS_ALERTA = 30;

function lcEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function lcPesos(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

// Las fechas llegan como "aaaa-mm-dd" (columna date). Se parsean por
// componentes y no con new Date(string), que en Colombia (UTC-5) corre la
// fecha un dia hacia atras. Mismo criterio que el resto de las vistas.
function lcParseFecha(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function lcFormatFecha(iso) {
  const d = lcParseFecha(iso);
  return d ? d.toLocaleDateString('es-CO') : null;
}

function lcFormatPeriodo(iso) {
  const d = lcParseFecha(iso);
  if (!d) return '—';
  const texto = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function lcDiasHasta(iso) {
  const d = lcParseFecha(iso);
  if (!d) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - hoy.getTime()) / 86400000);
}

function lcHoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Router.register('lineas-celulares', {
  title: 'Líneas celulares',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('lc-buscar').addEventListener('input', () => this._renderTabla());
      document.getElementById('lc-filtro-estado').addEventListener('change', () => this._renderTabla());
      document.getElementById('lc-filtro-contrato').addEventListener('change', () => this._renderTabla());
      document.getElementById('lc-nueva-btn').addEventListener('click', () => this._abrirFormulario(null));
      document.getElementById('lc-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-linea]');
        if (!btn) return;
        const linea = this._lineas.find((l) => l.numero === btn.dataset.linea);
        if (!linea) return;
        if (btn.dataset.accion === 'ficha') this._verFicha(linea);
        else if (btn.dataset.accion === 'editar') this._abrirFormulario(linea);
        else if (btn.dataset.accion === 'responsable') this._abrirAsignar(linea);
        else if (btn.dataset.accion === 'estado') this._abrirEstado(linea);
      });
      document.querySelectorAll('.lc-tab').forEach((b) => {
        b.addEventListener('click', () => this._cambiarTab(b.dataset.tab));
      });
      document.getElementById('lc-fac-periodo').addEventListener('change', () => this._renderFacturaSeleccionada());
      document.getElementById('lc-fac-contrato').addEventListener('change', () => this._renderFacturaSeleccionada());
      document.getElementById('lc-fac-nueva-btn').addEventListener('click', () => this._abrirNuevaFactura());
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [lineas, contratos, facturas, empleados] = await Promise.all([
      DB.getLineas(),
      DB.getLineasContratos(),
      DB.getLineasFacturas(),
      // Solo sirve para avisar que el responsable ya se retiro. Una cuenta con
      // permiso de lineas pero no de empleados no puede leer esa tabla, y eso
      // no debe tumbar el modulo entero: se degrada a no dar ese aviso.
      DB.getEmployees({ onlyActive: false }).catch(() => []),
    ]);
    this._lineas = lineas;
    this._contratos = contratos;
    this._facturas = facturas;
    this._empleados = new Map((empleados || []).map((e) => [e.id, e]));

    // Costo por linea y por periodo. Se acumula (+=) porque una linea puede
    // tener dos renglones en el mismo mes, uno por cada contrato.
    this._costos = new Map();
    this._periodos = [...new Set(facturas.map((f) => f.periodo))].sort().reverse();
    facturas.forEach((f) => {
      (f.kardex_lineas_factura_detalle || []).forEach((d) => {
        const clave = `${d.linea_numero}|${f.periodo}`;
        this._costos.set(clave, (this._costos.get(clave) || 0) + (Number(d.total) || 0));
      });
    });
    this._ultimoPeriodo = this._periodos[0] || null;

    this._llenarFiltroContrato();
    this._renderKpis();
    this._renderAlertas();
    this._renderTabla();
    this._renderFacturas();
  },

  _cambiarTab(tab) {
    document.querySelectorAll('.lc-tab').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
    document.getElementById('lc-panel-lineas').classList.toggle('hidden', tab !== 'lineas');
    document.getElementById('lc-panel-facturas').classList.toggle('hidden', tab !== 'facturas');
  },

  _costoDe(numero, periodo) {
    if (!periodo) return null;
    const v = this._costos.get(`${numero}|${periodo}`);
    return v === undefined ? null : v;
  },

  _permanenciaDe(linea) {
    return linea.fecha_fin_permanencia || linea.kardex_lineas_contratos?.fecha_fin_permanencia || null;
  },

  _llenarFiltroContrato() {
    const sel = document.getElementById('lc-filtro-contrato');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los contratos</option>'
      + this._contratos.map((c) => `<option value="${lcEscapeHtml(c.numero)}">${lcEscapeHtml(c.numero)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === actual)) sel.value = actual;
  },

  _renderKpis() {
    const activas = this._lineas.filter((l) => l.estado === 'activa');
    document.getElementById('lc-kpi-activas').textContent = activas.length;
    document.getElementById('lc-kpi-inactivas').textContent = this._lineas.length - activas.length;

    const total = (this._facturas || [])
      .filter((f) => f.periodo === this._ultimoPeriodo)
      .reduce((s, f) => s + (f.kardex_lineas_factura_detalle || []).reduce((t, d) => t + (Number(d.total) || 0), 0), 0);
    document.getElementById('lc-kpi-costo').textContent = this._ultimoPeriodo ? lcPesos(total) : '—';
    document.getElementById('lc-kpi-costo-label').textContent =
      this._ultimoPeriodo ? `Facturado en ${lcFormatPeriodo(this._ultimoPeriodo)}` : 'Sin facturas cargadas';
  },

  // Las tres alertas que se pidieron. Devuelve una lista plana para poder
  // contarlas y pintarlas con el mismo codigo.
  _calcularAlertas() {
    const alertas = [];

    this._lineas.forEach((l) => {
      if (l.estado === 'cancelada') return;

      const fin = this._permanenciaDe(l);
      const dias = lcDiasHasta(fin);
      if (dias !== null && dias <= LC_DIAS_ALERTA) {
        alertas.push({
          tipo: 'permanencia',
          grave: dias < 0,
          linea: l.numero,
          titulo: `${l.numero} · ${l.responsable || 'Sin responsable'}`,
          detalle: dias < 0
            ? `La permanencia se venció hace ${Math.abs(dias)} día(s) — ${lcFormatFecha(fin)}`
            : (dias === 0 ? `La permanencia vence hoy — ${lcFormatFecha(fin)}`
              : `La permanencia vence en ${dias} día(s) — ${lcFormatFecha(fin)}`),
        });
      }

      if (!String(l.responsable || '').trim()) {
        alertas.push({
          tipo: 'sin-responsable',
          grave: true,
          linea: l.numero,
          titulo: `${l.numero} · sin responsable`,
          detalle: 'La línea está activa y se sigue facturando, pero no tiene a nadie a cargo.',
        });
      } else if (l.employee_id) {
        const emp = this._empleados.get(l.employee_id);
        if (emp && emp.activo === false) {
          alertas.push({
            tipo: 'ex-empleado',
            grave: true,
            linea: l.numero,
            titulo: `${l.numero} · ${l.responsable}`,
            detalle: 'El responsable ya no está activo en la empresa. Hay que reasignar la línea o darla de baja.',
          });
        }
      }
    });

    (this._facturas || []).forEach((f) => {
      if (f.pagada) return;
      const dias = lcDiasHasta(f.fecha_vencimiento_pago);
      if (dias === null || dias > LC_DIAS_ALERTA) return;
      alertas.push({
        tipo: 'factura',
        grave: dias < 0,
        linea: null,
        titulo: `Factura ${lcFormatPeriodo(f.periodo)} · contrato ${f.contrato_numero || '—'}`,
        detalle: (dias < 0
          ? `Se venció hace ${Math.abs(dias)} día(s)`
          : (dias === 0 ? 'Vence hoy' : `Vence en ${dias} día(s)`))
          + ` — ${lcFormatFecha(f.fecha_vencimiento_pago)} · ${lcPesos(f.total)}`,
      });
    });

    return alertas.sort((a, b) => (b.grave ? 1 : 0) - (a.grave ? 1 : 0));
  },

  _renderAlertas() {
    const alertas = this._calcularAlertas();
    document.getElementById('lc-kpi-alertas').textContent = alertas.length;

    const el = document.getElementById('lc-alertas');
    if (!alertas.length) {
      // Si no hay ninguna fecha capturada, el silencio seria engañoso: diria
      // "todo al dia" cuando en realidad no hay con que comparar.
      const sinPermanencia = this._lineas.every((l) => !this._permanenciaDe(l));
      const sinPago = (this._facturas || []).every((f) => !f.fecha_vencimiento_pago);
      el.innerHTML = sinPermanencia || sinPago
        ? `<p class="empty-note">Sin alertas por ahora, pero ojo: ${[
            sinPermanencia ? 'ninguna línea tiene fecha de fin de permanencia' : null,
            sinPago ? 'ninguna factura tiene fecha límite de pago' : null,
          ].filter(Boolean).join(' y ')}. Mientras no se capturen, esas alertas no se pueden calcular.</p>`
        : '<p class="empty-note">Sin alertas: todas las líneas tienen responsable y no hay vencimientos cerca.</p>';
      return;
    }

    el.innerHTML = alertas.map((a) => `
      <div class="detalle-list-item">
        <span class="tag ${a.grave ? 'descartado' : 'pendiente'}">${a.grave ? 'Atención' : 'Pronto'}</span>
        <div class="lc-item-texto">
          <span class="detalle-list-item-main">${lcEscapeHtml(a.titulo)}</span>
          <span class="detalle-list-item-sub">${lcEscapeHtml(a.detalle)}</span>
        </div>
        ${a.linea ? `<button type="button" class="btn-secondary btn-sm" data-linea="${lcEscapeHtml(a.linea)}" data-accion="ficha">Ver</button>` : ''}
      </div>
    `).join('');

    el.querySelectorAll('[data-linea]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const linea = this._lineas.find((l) => l.numero === btn.dataset.linea);
        if (linea) this._verFicha(linea);
      });
    });
  },

  _renderTabla() {
    const q = document.getElementById('lc-buscar').value.trim().toLowerCase();
    const estado = document.getElementById('lc-filtro-estado').value;
    const contrato = document.getElementById('lc-filtro-contrato').value;

    let filas = this._lineas;
    if (estado) filas = filas.filter((l) => l.estado === estado);
    if (contrato) filas = filas.filter((l) => l.contrato_numero === contrato);
    if (q) {
      filas = filas.filter((l) => l.numero.includes(q)
        || (l.responsable || '').toLowerCase().includes(q)
        || (l.cargo || '').toLowerCase().includes(q));
    }
    this._filtradas = filas;

    document.getElementById('lc-contador').textContent = filas.length === this._lineas.length
      ? `${this._lineas.length} línea(s)`
      : `Mostrando ${filas.length} de ${this._lineas.length} línea(s)`;

    const tbody = document.getElementById('lc-tbody');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Ninguna línea coincide con los filtros.</td></tr>';
      return;
    }

    tbody.innerHTML = filas.map((l) => {
      const est = LC_ESTADOS[l.estado] || { label: l.estado, tag: 'inactivo-tag' };
      const costo = this._costoDe(l.numero, this._ultimoPeriodo);
      const sinResponsable = !String(l.responsable || '').trim();
      return `
        <tr>
          <td data-label="Línea"><strong>${lcEscapeHtml(l.numero)}</strong></td>
          <td data-label="Responsable">
            <div class="${sinResponsable ? 'muted' : ''}">${lcEscapeHtml(l.responsable || 'Sin responsable')}</div>
            ${l.cargo ? `<div class="pa-vehiculo-sub muted">${lcEscapeHtml(l.cargo)}</div>` : ''}
          </td>
          <td data-label="Contrato">${lcEscapeHtml(l.contrato_numero || '—')}</td>
          <td data-label="Estado"><span class="tag ${est.tag}">${est.label}</span></td>
          <td data-label="Costo del mes" class="num">${costo === null ? '—' : lcPesos(costo)}</td>
          <td data-label="Acciones">
            <button type="button" class="btn-secondary btn-sm" data-linea="${lcEscapeHtml(l.numero)}" data-accion="ficha">Ficha</button>
            <button type="button" class="btn-secondary btn-sm" data-linea="${lcEscapeHtml(l.numero)}" data-accion="responsable">Responsable</button>
            <button type="button" class="btn-secondary btn-sm" data-linea="${lcEscapeHtml(l.numero)}" data-accion="estado">Estado</button>
            <button type="button" class="btn-secondary btn-sm" data-linea="${lcEscapeHtml(l.numero)}" data-accion="editar">Editar</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  _abrirModal(html, ancho) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-box').classList.toggle('modal-wide', !!ancho);
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },

  _cerrarModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal-box').classList.remove('modal-wide');
  },

  // ---- Ficha con el historico completo ----
  async _verFicha(linea) {
    this._abrirModal('<p class="empty-note">Cargando…</p>', true);
    let hist;
    try {
      hist = await DB.getLineaHistorial(linea.numero);
    } catch (err) {
      this._abrirModal(`<p class="empty-note">No se pudo cargar el histórico: ${lcEscapeHtml(err.message)}</p>`, true);
      return;
    }

    const est = LC_ESTADOS[linea.estado] || { label: linea.estado, tag: 'inactivo-tag' };
    const fin = this._permanenciaDe(linea);

    const costos = this._periodos.map((p) => ({ periodo: p, valor: this._costoDe(linea.numero, p) }))
      .filter((c) => c.valor !== null);

    const dato = (label, valor) => `
      <div class="detalle-field">
        <div class="detalle-field-label">${lcEscapeHtml(label)}</div>
        <div class="detalle-field-value ${valor ? '' : 'pendiente'}">${valor ? lcEscapeHtml(valor) : 'Sin dato'}</div>
      </div>`;

    this._abrirModal(`
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${lcEscapeHtml(linea.numero)}</div>
          <div class="detalle-sub">${lcEscapeHtml(linea.responsable || 'Sin responsable')}${linea.cargo ? ' · ' + lcEscapeHtml(linea.cargo) : ''}</div>
        </div>
        <div class="detalle-tags"><span class="tag ${est.tag}">${est.label}</span></div>
      </div>

      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Datos de la línea</h4></div>
        <div class="detalle-grid">
          ${dato('Contrato', linea.contrato_numero)}
          ${dato('Operador', linea.kardex_lineas_contratos?.operador)}
          ${dato('Plan', linea.plan_descripcion)}
          ${dato('Cargo básico', linea.cargo_basico ? lcPesos(linea.cargo_basico) : null)}
          ${dato('Activación', lcFormatFecha(linea.fecha_activacion))}
          ${dato('Baja', lcFormatFecha(linea.fecha_desactivacion))}
          ${dato('Fin de permanencia', lcFormatFecha(fin))}
        </div>
        ${linea.notas ? `<p class="view-intro" style="margin:0.8rem 0 0">${lcEscapeHtml(linea.notas)}</p>` : ''}
      </div>

      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Quién la ha tenido</h4></div>
        ${hist.asignaciones.length ? `
          <div class="detalle-list">
            ${hist.asignaciones.map((a) => `
              <div class="detalle-list-item">
                <span class="tag ${a.hasta ? 'inactivo-tag' : 'activo'}">${a.hasta ? 'Anterior' : 'Actual'}</span>
                <div class="lc-item-texto">
                  <span class="detalle-list-item-main">${lcEscapeHtml(a.responsable)}${a.cargo ? ' · ' + lcEscapeHtml(a.cargo) : ''}</span>
                  <span class="detalle-list-item-sub">Desde ${lcFormatFecha(a.desde)}${a.hasta ? ` hasta ${lcFormatFecha(a.hasta)}` : ''}${a.motivo ? ` · ${lcEscapeHtml(a.motivo)}` : ''}</span>
                </div>
              </div>`).join('')}
          </div>` : '<p class="empty-note">Sin registros de asignación.</p>'}
      </div>

      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Altas y bajas</h4></div>
        ${hist.estados.length ? `
          <div class="detalle-list">
            ${hist.estados.map((e) => {
              const es = LC_ESTADOS[e.estado] || { label: e.estado, tag: 'inactivo-tag' };
              return `
              <div class="detalle-list-item">
                <span class="tag ${es.tag}">${es.label}</span>
                <div class="lc-item-texto">
                  <span class="detalle-list-item-main">${lcFormatFecha(e.fecha)}</span>
                  <span class="detalle-list-item-sub">${e.motivo ? lcEscapeHtml(e.motivo) : 'Sin motivo registrado'}${e.registrado_por ? ` · ${lcEscapeHtml(e.registrado_por)}` : ''}</span>
                </div>
              </div>`;
            }).join('')}
          </div>` : '<p class="empty-note">Sin movimientos de estado.</p>'}
      </div>

      <div class="detalle-card">
        <div class="detalle-card-header"><h4 class="detalle-card-title">Lo que ha facturado</h4></div>
        ${costos.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Período</th><th class="num">Total</th></tr></thead>
              <tbody>
                ${costos.map((c) => `<tr><td data-label="Período">${lcFormatPeriodo(c.periodo)}</td><td data-label="Total" class="num">${lcPesos(c.valor)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<p class="empty-note">Todavía no hay facturas cargadas para esta línea.</p>'}
      </div>
    `, true);
  },

  // ---- Alta / edición ----
  _abrirFormulario(linea) {
    const esNueva = !linea;
    const l = linea || {};
    this._abrirModal(`
      <h3 style="margin:0 0 1rem">${esNueva ? 'Nueva línea' : 'Editar línea ' + lcEscapeHtml(l.numero)}</h3>
      <form id="lc-form" class="form">
        <div class="fieldset-grid">
          <label>Número de línea
            <input type="text" id="lc-f-numero" value="${lcEscapeHtml(l.numero || '')}" ${esNueva ? 'required' : 'readonly'} inputmode="numeric" />
          </label>
          <label>Contrato
            <select id="lc-f-contrato">
              <option value="">Sin contrato</option>
              ${this._contratos.map((c) => `<option value="${lcEscapeHtml(c.numero)}" ${l.contrato_numero === c.numero ? 'selected' : ''}>${lcEscapeHtml(c.numero)}</option>`).join('')}
            </select>
          </label>
          ${esNueva ? `
          <label>Responsable
            <input type="text" id="lc-f-responsable" placeholder="Persona, puesto o equipo" />
          </label>
          <label>Cargo o ubicación
            <input type="text" id="lc-f-cargo" />
          </label>` : ''}
          <label>Plan
            <input type="text" id="lc-f-plan" value="${lcEscapeHtml(l.plan_descripcion || '')}" />
          </label>
          <label>Cargo básico
            <input type="number" id="lc-f-basico" step="0.01" value="${l.cargo_basico ?? ''}" />
          </label>
          <label>Fecha de activación
            <input type="date" id="lc-f-activacion" value="${l.fecha_activacion || (esNueva ? lcHoyIso() : '')}" />
          </label>
          <label>Fin de permanencia
            <input type="date" id="lc-f-permanencia" value="${l.fecha_fin_permanencia || ''}" />
          </label>
        </div>
        <label>Notas<textarea id="lc-f-notas" rows="2">${lcEscapeHtml(l.notas || '')}</textarea></label>
        <p class="view-intro" style="margin:0.2rem 0 0.8rem">Si dejas el fin de permanencia vacío, se usa el del contrato.</p>
        <button type="submit" class="btn-block"><span>${esNueva ? 'Crear línea' : 'Guardar cambios'}</span></button>
        <p id="lc-f-msg" class="form-msg"></p>
      </form>
    `);
    document.getElementById('lc-form').addEventListener('submit', (e) => this._guardar(e, esNueva, l));
  },

  async _guardar(e, esNueva, original) {
    e.preventDefault();
    const msg = document.getElementById('lc-f-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const numero = document.getElementById('lc-f-numero').value.trim();
    if (!numero) { msg.textContent = 'El número es obligatorio.'; msg.className = 'form-msg error'; return; }
    if (esNueva && this._lineas.some((l) => l.numero === numero)) {
      msg.textContent = 'Esa línea ya está registrada.';
      msg.className = 'form-msg error';
      return;
    }

    const basico = document.getElementById('lc-f-basico').value;
    const fila = {
      numero,
      contrato_numero: document.getElementById('lc-f-contrato').value || null,
      plan_descripcion: document.getElementById('lc-f-plan').value.trim() || null,
      cargo_basico: basico === '' ? null : Number(basico),
      fecha_activacion: document.getElementById('lc-f-activacion').value || null,
      fecha_fin_permanencia: document.getElementById('lc-f-permanencia').value || null,
      notas: document.getElementById('lc-f-notas').value.trim() || null,
    };

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    Loading.show('Guardando…');
    try {
      await DB.guardarLinea(fila, esNueva);
      // La línea nueva arranca con su responsable y su alta en el histórico,
      // en vez de nacer sin rastro y aparecer de una vez en las alertas de
      // "sin responsable".
      if (esNueva) {
        const responsable = document.getElementById('lc-f-responsable').value.trim();
        if (responsable) {
          await DB.asignarLinea(numero, responsable, document.getElementById('lc-f-cargo').value.trim(),
            null, fila.fecha_activacion || lcHoyIso(), 'Alta de la línea');
        }
        await DB.cambiarEstadoLinea(numero, 'activa', fila.fecha_activacion || lcHoyIso(), 'Alta de la línea');
      }
      this._cerrarModal();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
      Loading.hide();
    }
  },

  // ---- Cambiar responsable ----
  _abrirAsignar(linea) {
    this._abrirModal(`
      <h3 style="margin:0 0 0.4rem">Cambiar responsable</h3>
      <p class="view-intro" style="margin:0 0 1rem">Línea ${lcEscapeHtml(linea.numero)} · ahora a cargo de ${lcEscapeHtml(linea.responsable || 'nadie')}.</p>
      <form id="lc-asig-form" class="form">
        <div class="fieldset-grid">
          <label>Nuevo responsable<input type="text" id="lc-a-responsable" required placeholder="Persona, puesto o equipo" /></label>
          <label>Cargo o ubicación<input type="text" id="lc-a-cargo" /></label>
          <label>Desde<input type="date" id="lc-a-desde" value="${lcHoyIso()}" required /></label>
        </div>
        <label>Motivo<input type="text" id="lc-a-motivo" placeholder="Ej: entrega del cargo, reasignación de ruta" /></label>
        <button type="submit" class="btn-block"><span>Guardar el cambio</span></button>
        <p id="lc-a-msg" class="form-msg"></p>
      </form>
    `);
    document.getElementById('lc-asig-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('lc-a-msg');
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      Loading.show('Guardando…');
      try {
        await DB.asignarLinea(
          linea.numero,
          document.getElementById('lc-a-responsable').value.trim(),
          document.getElementById('lc-a-cargo').value.trim(),
          null,
          document.getElementById('lc-a-desde').value,
          document.getElementById('lc-a-motivo').value.trim(),
        );
        this._cerrarModal();
        await this._load();
      } catch (err) {
        msg.textContent = 'No se pudo guardar: ' + err.message;
        msg.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        Loading.hide();
      }
    });
  },

  // ---- Activar / suspender / cancelar ----
  _abrirEstado(linea) {
    const opciones = Object.entries(LC_ESTADOS)
      .map(([k, v]) => `<option value="${k}" ${linea.estado === k ? 'selected' : ''}>${v.label}</option>`).join('');
    this._abrirModal(`
      <h3 style="margin:0 0 0.4rem">Estado de la línea</h3>
      <p class="view-intro" style="margin:0 0 1rem">Línea ${lcEscapeHtml(linea.numero)} · hoy está ${(LC_ESTADOS[linea.estado] || {}).label || linea.estado}.</p>
      <form id="lc-est-form" class="form">
        <div class="fieldset-grid">
          <label>Nuevo estado<select id="lc-e-estado">${opciones}</select></label>
          <label>Fecha<input type="date" id="lc-e-fecha" value="${lcHoyIso()}" required /></label>
        </div>
        <label>Motivo<input type="text" id="lc-e-motivo" placeholder="Ej: robo del equipo, retiro del colaborador" /></label>
        <button type="submit" class="btn-block"><span>Guardar</span></button>
        <p id="lc-e-msg" class="form-msg"></p>
      </form>
    `);
    document.getElementById('lc-est-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('lc-e-msg');
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      Loading.show('Guardando…');
      try {
        await DB.cambiarEstadoLinea(
          linea.numero,
          document.getElementById('lc-e-estado').value,
          document.getElementById('lc-e-fecha').value,
          document.getElementById('lc-e-motivo').value.trim(),
        );
        this._cerrarModal();
        await this._load();
      } catch (err) {
        msg.textContent = 'No se pudo guardar: ' + err.message;
        msg.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        Loading.hide();
      }
    });
  },

  // ======================= FACTURAS DEL MES =======================

  _renderFacturas() {
    const selP = document.getElementById('lc-fac-periodo');
    const selC = document.getElementById('lc-fac-contrato');
    const periodoPrevio = selP.value;
    const contratoPrevio = selC.value;

    const periodos = [...new Set(this._facturas.map((f) => f.periodo))].sort().reverse();
    selP.innerHTML = periodos.length
      ? periodos.map((p) => `<option value="${p}">${lcFormatPeriodo(p)}</option>`).join('')
      : '<option value="">Sin meses registrados</option>';
    if (periodos.includes(periodoPrevio)) selP.value = periodoPrevio;

    const contratos = [...new Set(this._facturas.map((f) => f.contrato_numero || ''))].sort();
    selC.innerHTML = contratos.map((c) => `<option value="${lcEscapeHtml(c)}">${lcEscapeHtml(c || 'Sin contrato')}</option>`).join('')
      || '<option value="">—</option>';
    if (contratos.includes(contratoPrevio)) selC.value = contratoPrevio;

    this._renderFacturaSeleccionada();
  },

  _facturaSeleccionada() {
    const periodo = document.getElementById('lc-fac-periodo').value;
    const contrato = document.getElementById('lc-fac-contrato').value;
    return this._facturas.find((f) => f.periodo === periodo && (f.contrato_numero || '') === contrato) || null;
  },

  _renderFacturaSeleccionada() {
    const el = document.getElementById('lc-fac-detalle');
    const f = this._facturaSeleccionada();
    const contador = document.getElementById('lc-fac-contador');

    if (!f) {
      contador.textContent = '';
      el.innerHTML = this._facturas.length
        ? '<p class="empty-note">Ese contrato no tiene factura registrada en ese mes. Usa “Registrar un mes”.</p>'
        : '<p class="empty-note">Todavía no hay ningún mes registrado. Empieza con “Registrar un mes”.</p>';
      return;
    }

    const filas = (f.kardex_lineas_factura_detalle || [])
      .slice()
      .sort((a, b) => String(a.linea_numero).localeCompare(String(b.linea_numero)));
    const suma = filas.reduce((s, d) => s + (Number(d.total) || 0), 0);
    const declarado = Number(f.total) || 0;
    // Se avisa la diferencia en vez de "corregir" en silencio: el que manda
    // es el total de la factura del operador, pero si no cuadra con la suma
    // de las líneas hay un renglón mal digitado o uno que falta.
    const descuadre = Math.abs(suma - declarado) >= 1;

    contador.textContent = `${filas.length} línea(s) en esta factura`;

    const nombreDe = (numero) => {
      const l = this._lineas.find((x) => x.numero === numero);
      return l ? (l.responsable || 'Sin responsable') : 'Línea que ya no está en el inventario';
    };

    el.innerHTML = `
      <div class="panel-card">
        <div class="section-heading"><h2>Datos de la factura</h2></div>
        <form id="lc-fac-form" class="form">
          <div class="fieldset-grid">
            <label>Fecha de la factura<input type="date" id="lc-fac-fecha" value="${f.fecha_factura || ''}" /></label>
            <label>Fecha límite de pago<input type="date" id="lc-fac-vence" value="${f.fecha_vencimiento_pago || ''}" /></label>
            <label>Total a pagar<input type="number" id="lc-fac-total" step="0.01" value="${f.total ?? ''}" /></label>
            <label>Fecha de pago<input type="date" id="lc-fac-pago" value="${f.fecha_pago || ''}" /></label>
          </div>
          <label class="checkbox-label"><input type="checkbox" id="lc-fac-pagada" ${f.pagada ? 'checked' : ''} /> Ya está pagada</label>
          <label>Notas<input type="text" id="lc-fac-notas" value="${lcEscapeHtml(f.notas || '')}" /></label>
          <button type="submit" class="btn-block"><span>Guardar los datos de la factura</span></button>
          <p id="lc-fac-msg" class="form-msg"></p>
        </form>
        ${descuadre ? `<div class="alerta-inline" style="margin-top:0.9rem">
          La suma de las líneas da ${lcPesos(suma)} pero el total dice ${lcPesos(declarado)}.
          Son ${lcPesos(Math.abs(suma - declarado))} de diferencia: revisa si falta un renglón o alguno quedó mal digitado.
        </div>` : ''}
      </div>

      <div class="panel-card" style="margin-top:1rem">
        <div class="section-heading">
          <h2>Valor de cada línea</h2>
          <button type="button" class="btn-secondary btn-sm" id="lc-fac-add-linea">+ Agregar una línea</button>
        </div>
        <p class="view-intro" style="margin:0 0 0.8rem">Los valores vienen copiados del mes anterior: cambia solo los que llegaron distintos y guarda.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Línea</th><th>Responsable</th><th class="num">Valor a pagar</th></tr></thead>
            <tbody>
              ${filas.map((d) => `
                <tr>
                  <td data-label="Línea"><strong>${lcEscapeHtml(d.linea_numero)}</strong></td>
                  <td data-label="Responsable">${lcEscapeHtml(nombreDe(d.linea_numero))}</td>
                  <td data-label="Valor a pagar" class="num">
                    <input type="number" step="0.01" class="lc-fac-valor" style="max-width:150px"
                           data-id="${d.id}" data-linea="${lcEscapeHtml(d.linea_numero)}" value="${d.total ?? ''}" />
                  </td>
                </tr>`).join('')
              || '<tr><td colspan="3" class="empty-note">Esta factura no tiene líneas. Agrégalas con el botón de arriba.</td></tr>'}
            </tbody>
            <tfoot>
              <tr class="fila-total">
                <td colspan="2"><strong>Suma de las líneas</strong></td>
                <td class="num"><strong id="lc-fac-suma">${lcPesos(suma)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button type="button" class="btn-block" id="lc-fac-guardar-valores" style="margin-top:0.9rem"><span>Guardar los valores</span></button>
        <p id="lc-fac-valores-msg" class="form-msg"></p>
      </div>
    `;

    // La suma del pie se recalcula mientras escriben, para que vean el
    // descuadre antes de guardar y no después.
    el.querySelectorAll('.lc-fac-valor').forEach((inp) => {
      inp.addEventListener('input', () => {
        const total = [...el.querySelectorAll('.lc-fac-valor')]
          .reduce((t, i) => t + (Number(i.value) || 0), 0);
        document.getElementById('lc-fac-suma').textContent = lcPesos(total);
      });
    });

    document.getElementById('lc-fac-form').addEventListener('submit', (e) => this._guardarFactura(e, f));
    document.getElementById('lc-fac-guardar-valores').addEventListener('click', () => this._guardarValores(f));
    document.getElementById('lc-fac-add-linea').addEventListener('click', () => this._agregarLineaAFactura(f));
  },

  async _guardarFactura(e, f) {
    e.preventDefault();
    const msg = document.getElementById('lc-fac-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    Loading.show('Guardando…');
    try {
      const total = document.getElementById('lc-fac-total').value;
      await DB.guardarFacturaLinea({
        id: f.id,
        fecha_factura: document.getElementById('lc-fac-fecha').value || null,
        fecha_vencimiento_pago: document.getElementById('lc-fac-vence').value || null,
        total: total === '' ? null : Number(total),
        pagada: document.getElementById('lc-fac-pagada').checked,
        fecha_pago: document.getElementById('lc-fac-pago').value || null,
        notas: document.getElementById('lc-fac-notas').value.trim() || null,
      });
      await this._load();
      this._cambiarTab('facturas');
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
      Loading.hide();
    }
  },

  async _guardarValores(f) {
    const msg = document.getElementById('lc-fac-valores-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const btn = document.getElementById('lc-fac-guardar-valores');
    btn.disabled = true;
    Loading.show('Guardando…');
    try {
      const filas = [...document.querySelectorAll('.lc-fac-valor')].map((inp) => ({
        id: inp.dataset.id,
        factura_id: f.id,
        linea_numero: inp.dataset.linea,
        total: inp.value === '' ? null : Number(inp.value),
      }));
      await DB.guardarDetalleFactura(filas);
      await this._load();
      this._cambiarTab('facturas');
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
      Loading.hide();
    }
  },

  _agregarLineaAFactura(f) {
    const yaEstan = new Set((f.kardex_lineas_factura_detalle || []).map((d) => d.linea_numero));
    const candidatas = this._lineas.filter((l) => !yaEstan.has(l.numero) && l.estado !== 'cancelada');
    if (!candidatas.length) {
      alert('Todas las líneas activas ya están en esta factura.');
      return;
    }
    this._abrirModal(`
      <h3 style="margin:0 0 1rem">Agregar una línea a la factura</h3>
      <form id="lc-addl-form" class="form">
        <label>Línea
          <select id="lc-addl-linea">
            ${candidatas.map((l) => `<option value="${lcEscapeHtml(l.numero)}">${lcEscapeHtml(l.numero)} · ${lcEscapeHtml(l.responsable || 'sin responsable')}</option>`).join('')}
          </select>
        </label>
        <label>Valor a pagar<input type="number" id="lc-addl-total" step="0.01" /></label>
        <p class="view-intro" style="margin:0.2rem 0 0.8rem">Si lo dejas vacío se usa el cargo básico de la línea.</p>
        <button type="submit" class="btn-block"><span>Agregar</span></button>
        <p id="lc-addl-msg" class="form-msg"></p>
      </form>
    `);
    document.getElementById('lc-addl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      Loading.show('Agregando…');
      try {
        const v = document.getElementById('lc-addl-total').value;
        await DB.agregarLineaAFactura(f.id, document.getElementById('lc-addl-linea').value,
          v === '' ? null : Number(v));
        this._cerrarModal();
        await this._load();
        this._cambiarTab('facturas');
      } catch (err) {
        const m = document.getElementById('lc-addl-msg');
        m.textContent = 'No se pudo agregar: ' + err.message;
        m.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        Loading.hide();
      }
    });
  },

  _abrirNuevaFactura() {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    this._abrirModal(`
      <h3 style="margin:0 0 0.4rem">Registrar un mes</h3>
      <p class="view-intro" style="margin:0 0 1rem">Se crean los renglones copiando los valores del último mes registrado de ese contrato. Después corriges los que llegaron distintos.</p>
      <form id="lc-nf-form" class="form">
        <div class="fieldset-grid">
          <label>Contrato
            <select id="lc-nf-contrato">
              ${this._contratos.map((c) => `<option value="${lcEscapeHtml(c.numero)}">${lcEscapeHtml(c.numero)}</option>`).join('')}
            </select>
          </label>
          <label>Mes<input type="month" id="lc-nf-periodo" value="${mesActual}" required /></label>
          <label>Fecha de la factura<input type="date" id="lc-nf-fecha" /></label>
          <label>Fecha límite de pago<input type="date" id="lc-nf-vence" /></label>
        </div>
        <label class="checkbox-label"><input type="checkbox" id="lc-nf-copiar" checked /> Copiar los valores del mes anterior</label>
        <button type="submit" class="btn-block"><span>Crear el mes</span></button>
        <p id="lc-nf-msg" class="form-msg"></p>
      </form>
    `);
    document.getElementById('lc-nf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('lc-nf-msg');
      msg.textContent = '';
      msg.className = 'form-msg';
      const btn = e.target.querySelector('button[type="submit"]');
      const contrato = document.getElementById('lc-nf-contrato').value;
      btn.disabled = true;
      Loading.show('Creando…');
      try {
        const mes = document.getElementById('lc-nf-periodo').value;
        await DB.crearFacturaLinea(
          contrato,
          `${mes}-01`,
          document.getElementById('lc-nf-fecha').value,
          document.getElementById('lc-nf-vence').value,
          document.getElementById('lc-nf-copiar').checked,
        );
        this._cerrarModal();
        await this._load();
        document.getElementById('lc-fac-periodo').value = `${mes}-01`;
        document.getElementById('lc-fac-contrato').value = contrato;
        this._renderFacturaSeleccionada();
        this._cambiarTab('facturas');
      } catch (err) {
        msg.textContent = 'No se pudo crear: ' + err.message;
        msg.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        Loading.hide();
      }
    });
  },
});
