// Informe de gestión: los indicadores del SG-SST (Resolución 0312 de 2019) y
// del PESV (Paso 20 de la Resolución 40595 de 2022).
//
// Estos indicadores se venían llevando en Word, con el resultado escrito a
// mano y el estado escrito a mano al lado. Acá no se escribe ninguno de los
// dos: el porcentaje lo calcula la base a partir del numerador y el
// denominador (21 de 28 capacitaciones), y el estado lo deriva esta vista
// comparando ese valor con la meta del indicador. Lo único que se digita es lo
// que alguien contó.
//
// Esa diferencia no es de estilo. En el informe de Word de 2026 un 70% quedó
// descrito como "desempeño satisfactorio" en la conclusión y marcado "No
// cumple" tres párrafos después, contra su meta de 95%. Acá eso no puede
// pasar, porque el estado no es un dato que alguien teclee.

function igEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function igNum(v, decimales = 1) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

const IG_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const IG_SISTEMAS = { sgsst: 'SG-SST', pesv: 'PESV / Seguridad vial' };

// Escala de interpretación del propio informe de gestión. No es invento de
// esta vista: está en el documento, y por eso se respeta tal cual.
function igCalificacion(valor) {
  if (valor == null) return null;
  if (valor > 95) return { texto: 'Excelente', clase: 'activo' };
  if (valor >= 90) return { texto: 'Sobresaliente', clase: 'activo' };
  if (valor >= 80) return { texto: 'Bueno', clase: 'pendiente' };
  if (valor >= 70) return { texto: 'Aceptable', clase: 'pendiente' };
  return { texto: 'Inaceptable', clase: 'novedad' };
}

// "Más es mejor" o "menos es mejor": un ausentismo del 95% no es
// "sobresaliente", y meterlo al índice global lo hundiría justamente por ser
// bueno.
function igMasEsMejor(ind) {
  return ind.meta_operador === '>=' || ind.meta_operador === '>';
}

// La escala de 70/80/90/95 interpreta el porcentaje de cumplimiento de algo
// programado, así que solo aplica cuando la meta es eso: un umbral alto de
// cumplimiento. "Reducir la siniestralidad un 20%" también es un porcentaje y
// también es "más es mejor", pero calificar ese 20 con esta escala diría
// "Inaceptable" al lado de un "Cumple" -- la misma contradicción que este
// módulo existe para no repetir.
function igAplicaEscala(ind) {
  return igMasEsMejor(ind) && ind.unidad === 'porcentaje' && Number(ind.meta_valor) >= 70;
}

const IG_CUMPLE = { clave: 'cumple', texto: 'Cumple', clase: 'activo' };
const IG_NO_CUMPLE = { clave: 'no_cumple', texto: 'No cumple', clase: 'novedad' };
const IG_LIMITE = { clave: 'limite', texto: 'En el límite', clase: 'pendiente' };
const IG_SIN_DATO = { clave: 'sin_dato', texto: 'Sin medición', clase: 'pendiente' };
const IG_SIN_REF = { clave: 'sin_ref', texto: 'Sin año anterior', clase: 'pendiente' };
const IG_INFORMATIVO = { clave: 'informativo', texto: 'Informativo', clase: 'pendiente' };

// El estado sale de comparar el valor con la meta, nunca de un campo guardado.
function igEstado(ind, valor, valorAnterior) {
  if (valor == null) return IG_SIN_DATO;
  const v = Number(valor);

  // "No empeorar frente al año pasado": sin el año pasado cargado no se puede
  // afirmar nada, y dar por cumplido lo que no se sabe sería lo peor que
  // podría hacer esta pantalla.
  if (ind.meta_operador === '<=anterior') {
    if (valorAnterior == null) return IG_SIN_REF;
    return v <= Number(valorAnterior) ? IG_CUMPLE : IG_NO_CUMPLE;
  }

  if (ind.meta_valor == null) return IG_INFORMATIVO;
  const meta = Number(ind.meta_valor);
  switch (ind.meta_operador) {
    case '>=': return v >= meta ? IG_CUMPLE : IG_NO_CUMPLE;
    case '>': return v > meta ? IG_CUMPLE : IG_NO_CUMPLE;
    case '<=': return v <= meta ? IG_CUMPLE : IG_NO_CUMPLE;
    // Justo en el umbral de una meta estricta no es cumplir ni incumplir: es
    // el "Límite" que ya usaba el informe del PESV para el 5% de velocidad.
    case '<': return v === meta ? IG_LIMITE : (v < meta ? IG_CUMPLE : IG_NO_CUMPLE);
    case '=': return v === meta ? IG_CUMPLE : IG_NO_CUMPLE;
    default: return IG_INFORMATIVO;
  }
}

// El resultado del año a partir de sus mediciones:
//   - si hay un acumulado cargado, ese manda (es el consolidado del informe);
//   - si no, y todas las mediciones traen numerador y denominador, se suman
//     unos y otros -- promediar porcentajes de meses con distinto número de
//     actividades daría un número que no corresponde a nada;
//   - y si solo hay porcentajes sueltos, se promedian, que es lo único posible.
function igResultadoAnual(ind, mediciones) {
  const ms = (mediciones || []).filter((m) => m.valor != null || m.denominador);
  if (!ms.length) return null;

  const acumuladas = ms.filter((m) => m.acumulado);
  if (acumuladas.length) {
    const ultima = acumuladas.reduce((a, b) => (b.periodo > a.periodo ? b : a));
    return { valor: Number(ultima.valor), medicion: ultima, modo: 'acumulado' };
  }

  const conPartes = ms.filter((m) => m.numerador != null && m.denominador);
  if (conPartes.length === ms.length) {
    const num = conPartes.reduce((s, m) => s + Number(m.numerador), 0);
    const den = conPartes.reduce((s, m) => s + Number(m.denominador), 0);
    if (!den) return null;
    const ultima = ms.reduce((a, b) => (b.periodo > a.periodo ? b : a));
    return { valor: Math.round((num / den) * 10000) / 100, medicion: ultima, modo: 'suma', num, den, periodos: ms.length };
  }

  const ultima = ms.reduce((a, b) => (b.periodo > a.periodo ? b : a));

  // Un conteo se suma: doce meses con 2 actividades cada uno son 24 en el
  // año, no 2. Promediar solo tiene sentido cuando el valor ya es una tasa o
  // un porcentaje de algo.
  if (ind.unidad === 'numero') {
    const total = ms.reduce((s, m) => s + Number(m.valor), 0);
    return { valor: total, medicion: ultima, modo: 'total', periodos: ms.length };
  }

  const prom = ms.reduce((s, m) => s + Number(m.valor), 0) / ms.length;
  return { valor: Math.round(prom * 100) / 100, medicion: ultima, modo: 'promedio', periodos: ms.length };
}

function igPeriodoTexto(ind, res) {
  if (!res) return '—';
  if (res.modo === 'suma') return `Suma de ${res.periodos} periodo(s)`;
  if (res.modo === 'total') return `Total de ${res.periodos} periodo(s)`;
  if (res.modo === 'promedio') return `Promedio de ${res.periodos} periodo(s)`;
  const m = res.medicion;
  if (ind.frecuencia === 'anual') return 'Del año';
  const base = ind.frecuencia === 'mensual'
    ? IG_MESES[m.periodo - 1] || `Periodo ${m.periodo}`
    : `Trimestre ${m.periodo}`;
  return m.acumulado ? `Acumulado a ${base.toLowerCase()}` : base;
}

function igUnidad(ind, v) {
  if (v == null) return '—';
  return ind.unidad === 'porcentaje' ? `${igNum(v)}%` : igNum(v, 2);
}

// Colores de los estados. Van acá y no en el CSS porque el conic-gradient de
// la dona se arma en JS: la leyenda y los sectores tienen que salir del mismo
// sitio o terminan diciendo cosas distintas.
const IG_COLOR_ESTADO = {
  cumple: '#0f8a4f',
  limite: '#d97706',
  no_cumple: '#dc2626',
  sin_ref: '#64748b',
  sin_dato: '#94a3b8',
  informativo: '#2f6fed',
};

const IG_COLOR_NIVEL = {
  Excelente: '#0f8a4f',
  Sobresaliente: '#20b2aa',
  Bueno: '#2f6fed',
  Aceptable: '#d97706',
  Inaceptable: '#dc2626',
};

function igPuede(accion) {
  if (window.APP_ROLE === 'admin') return true;
  const p = (window.APP_PERMISOS_MODULOS || {})['informe-gestion'];
  return !!(p && p[accion]);
}

function igMensajeError(err) {
  const m = String(err?.message || err || '');
  if (/permission denied|row-level security|policy/i.test(m)) {
    return 'Tu cuenta no tiene permiso para consultar el informe de gestión. Pídeselo a un administrador en Usuarios.';
  }
  if (/relation .* does not exist|PGRST205/i.test(m)) {
    return 'Las tablas del informe de gestión todavía no están creadas en esta base de datos. Falta correr sql/informe_gestion_2026-10-13.sql.';
  }
  return m || 'Error desconocido.';
}

Router.register('informe-gestion', {
  title: 'Informe de gestión',

  _sistema: '',
  _seleccionado: null,

  async onEnter() {
    if (!this._bound) {
      document.getElementById('ig-anio').addEventListener('change', () => this._load());
      document.getElementById('ig-sistema').addEventListener('change', () => {
        this._sistema = document.getElementById('ig-sistema').value;
        this._seleccionado = null;
        this._pintar();
      });
      document.getElementById('ig-registrar').addEventListener('click', () => this._abrirForm());
      this._bound = true;
    }
    document.getElementById('ig-registrar').classList.toggle('hidden', !igPuede('agregar'));
    await this._load();
  },

  async _load() {
    Loading.show('Cargando…');
    try {
      if (!this._catalogo) this._catalogo = await DB.getIndicadoresGestion();

      // Los años con algo cargado. Siempre se ofrece el año en curso, aunque
      // todavía no tenga mediciones: es donde se va a registrar.
      if (!this._aniosListos) {
        const anios = await DB.getAniosGestion();
        const actual = new Date().getFullYear();
        if (!anios.includes(actual)) anios.unshift(actual);
        const sel = document.getElementById('ig-anio');
        sel.innerHTML = anios.map((a) => `<option value="${a}">${a}</option>`).join('');
        // Arranca en el año más reciente CON datos: entrar a un año vacío
        // haría parecer que no hay nada cargado.
        const conDatos = anios.find((a) => a !== actual) || actual;
        sel.value = String(anios.includes(actual) && anios.length === 1 ? actual : conDatos);
        this._aniosListos = true;
      }

      this._anio = Number(document.getElementById('ig-anio').value);
      const [mediciones, series] = await Promise.all([
        DB.getMedicionesGestion(this._anio),
        DB.getSeriesGestion(this._anio),
      ]);
      this._mediciones = mediciones;
      this._series = series;
      await this._cargarCalculados();
      this._error = null;
      this._pintar();
    } catch (err) {
      this._error = err;
      document.getElementById('ig-tbody').innerHTML =
        `<tr><td colspan="6" class="empty-note">${igEsc(igMensajeError(err))}</td></tr>`;
      ['ig-bars', 'ig-evolucion', 'ig-series-capacitacion', 'ig-series-salud'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
    } finally {
      Loading.hide();
    }
  },

  // Los indicadores que el ERP cuenta solo. Sus mediciones no se guardan en
  // kardex_ig_mediciones: se arman en cada carga a partir de la fuente real,
  // así nunca quedan desactualizadas respecto a lo que de verdad hay.
  async _cargarCalculados() {
    const calculados = (this._catalogo || []).filter((i) => i.fuente && i.fuente !== 'manual');
    if (!calculados.length) return;
    for (const ind of calculados) {
      if (ind.fuente !== 'actividades') continue;
      try {
        const porMes = await DB.getActividadesPorMesGestion(this._anio);
        porMes.forEach((fila) => {
          this._mediciones.push({
            id: `calc-${ind.id}-${fila.periodo}`,
            indicador_id: ind.id,
            anio: this._anio,
            periodo: Number(fila.periodo),
            numerador: null,
            denominador: null,
            valor: Number(fila.total),
            acumulado: false,
            calculado: true,
            observacion: null,
          });
        });
      } catch (err) {
        // Que falle el conteo no puede tumbar el resto del informe: el
        // indicador se queda sin medición y se ve como tal.
        this._errorCalculado = err;
      }
    }
  },

  // Cada indicador con su resultado del año y su estado ya resueltos: lo usan
  // la tabla, los KPI y las barras, y así los tres no pueden discrepar.
  _filas() {
    const porIndicador = (id, anio) => (this._mediciones || [])
      .filter((m) => m.indicador_id === id && m.anio === anio);
    return (this._catalogo || [])
      .filter((i) => !this._sistema || i.sistema === this._sistema)
      .map((ind) => {
        const res = igResultadoAnual(ind, porIndicador(ind.id, this._anio));
        const resAnterior = igResultadoAnual(ind, porIndicador(ind.id, this._anio - 1));
        const estado = igEstado(ind, res ? res.valor : null, resAnterior ? resAnterior.valor : null);
        return {
          ind,
          res,
          estado,
          anterior: resAnterior,
          calificacion: res && igAplicaEscala(ind) ? igCalificacion(res.valor) : null,
        };
      });
  },

  _pintar() {
    const filas = this._filas();
    this._pintarKpis(filas);
    this._pintarTabla(filas);
    this._pintarBarras(filas);
    this._pintarEvolucion(filas);
    this._pintarDonut(filas);
    this._pintarNiveles(filas);
    this._pintarPorSistema(filas);
    this._pintarComparativo();
    this._pintarSeries();
  },

  _pintarKpis(filas) {
    const conDato = filas.filter((f) => f.res);
    const cumplen = filas.filter((f) => f.estado.clave === 'cumple').length;
    const noCumplen = filas.filter((f) => f.estado.clave === 'no_cumple').length;
    const sinMedir = filas.filter((f) => f.estado.clave === 'sin_dato').length;

    // El índice solo promedia los indicadores de "más es mejor": meter ahí un
    // ausentismo del 1,5% lo hundiría, cuando ese 1,5% es justamente bueno.
    const paraIndice = conDato.filter((f) => igAplicaEscala(f.ind));
    const indice = paraIndice.length
      ? Math.round(paraIndice.reduce((s, f) => s + f.res.valor, 0) / paraIndice.length)
      : null;
    const cal = igCalificacion(indice);

    document.getElementById('ig-kpi-indice').textContent = indice == null ? '—' : `${indice}%`;
    document.getElementById('ig-kpi-indice-label').textContent = cal
      ? `Índice de gestión · ${cal.texto}`
      : 'Índice de gestión · sin datos';
    document.getElementById('ig-kpi-cumplen').textContent = cumplen;
    document.getElementById('ig-kpi-cumplen-label').textContent =
      `Cumplen la meta · de ${filas.length} indicador(es)`;
    document.getElementById('ig-kpi-nocumplen').textContent = noCumplen;
    document.getElementById('ig-kpi-sinmedir').textContent = sinMedir;
    document.getElementById('ig-kpi-sinmedir-label').textContent = sinMedir
      ? 'Sin medición cargada este año'
      : 'Todos los indicadores tienen medición';
  },

  _pintarTabla(filas) {
    const tbody = document.getElementById('ig-tbody');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">No hay indicadores para este filtro.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((f) => {
      const puedeEditar = igPuede('agregar') || igPuede('editar');
      return `
      <tr data-codigo="${igEsc(f.ind.codigo)}" class="ig-fila">
        <td>
          <strong>${igEsc(f.ind.nombre)}</strong>
          <br><span class="muted">${igEsc(f.ind.formula || '')}</span>
        </td>
        <td><span class="muted">${igEsc(IG_SISTEMAS[f.ind.sistema] || f.ind.sistema)}</span></td>
        <td>${igEsc(f.ind.meta_texto || '—')}</td>
        <td><strong>${igUnidad(f.ind, f.res ? f.res.valor : null)}</strong>
          <br><span class="muted">${igEsc(igPeriodoTexto(f.ind, f.res))}</span></td>
        <td><span class="tag ${f.estado.clase}">${f.estado.texto}</span>
          ${f.calificacion ? `<br><span class="muted">${f.calificacion.texto}</span>` : ''}</td>
        <td>${f.ind.fuente && f.ind.fuente !== 'manual'
          ? '<span class="muted">Automático</span>'
          : (puedeEditar
            ? `<button type="button" class="btn-secondary" data-registrar="${f.ind.id}">Registrar</button>`
            : '')}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-registrar]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._abrirForm(Number(b.dataset.registrar));
      });
    });
    // Clic en la fila: ver su evolución mes a mes.
    tbody.querySelectorAll('.ig-fila').forEach((tr) => {
      tr.addEventListener('click', () => {
        this._seleccionado = tr.dataset.codigo;
        this._pintarEvolucion(this._filas());
      });
    });
  },

  _pintarBarras(filas) {
    const el = document.getElementById('ig-bars');
    const conDato = filas.filter((f) => f.res && f.ind.unidad === 'porcentaje');
    if (!conDato.length) {
      el.innerHTML = '<p class="empty-note">Todavía no hay mediciones cargadas para este año.</p>';
      return;
    }
    const orden = [...conDato].sort((a, b) => a.res.valor - b.res.valor);
    el.innerHTML = orden.map((f) => {
      const clase = f.estado.clave === 'cumple' ? 'ig-ok'
        : f.estado.clave === 'limite' ? 'ig-limite' : 'ig-mal';
      return `
      <div class="bar-row">
        <span class="bar-label" title="${igEsc(f.ind.nombre)}">${igEsc(f.ind.nombre)}</span>
        <span class="bar-track"><span class="bar-fill ${clase}" data-pct="${Math.max(0, Math.min(100, f.res.valor))}"></span></span>
        <span class="bar-value">${igNum(f.res.valor, 0)}%</span>
      </div>`;
    }).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.pct + '%'; });
    });
  },

  // Evolución del indicador elegido. Solo con las mediciones del periodo: un
  // acumulado puesto en la barra de octubre haría ver como resultado de
  // octubre lo que es el consolidado de todo el año.
  _pintarEvolucion(filas) {
    const titulo = document.getElementById('ig-evolucion-titulo');
    const el = document.getElementById('ig-evolucion');
    const fila = filas.find((f) => f.ind.codigo === this._seleccionado)
      || filas.find((f) => (this._mediciones || []).some((m) => m.indicador_id === f.ind.id && !m.acumulado && m.anio === this._anio));

    if (!fila) {
      titulo.textContent = 'Evolución del periodo';
      el.innerHTML = '<p class="empty-note">Ningún indicador tiene todavía mediciones periodo a periodo. Toca una fila de la tabla para ver la suya.</p>';
      return;
    }
    this._seleccionado = fila.ind.codigo;
    const ms = (this._mediciones || [])
      .filter((m) => m.indicador_id === fila.ind.id && m.anio === this._anio && !m.acumulado)
      .sort((a, b) => a.periodo - b.periodo);

    titulo.textContent = `Evolución · ${fila.ind.nombre}`;
    if (!ms.length) {
      el.innerHTML = `<p class="empty-note">Este indicador solo tiene cargado el consolidado del año${
        fila.res && fila.res.modo === 'acumulado' ? ` (${igUnidad(fila.ind, fila.res.valor)})` : ''
      }, no el detalle por periodo.</p>`;
      return;
    }
    const etiqueta = (p) => (fila.ind.frecuencia === 'mensual'
      ? (IG_MESES[p - 1] || `P${p}`) : fila.ind.frecuencia === 'trimestral' ? `Trim. ${p}` : 'Año');
    el.innerHTML = ms.map((m) => {
      const est = igEstado(fila.ind, m.valor, null);
      const clase = est.clave === 'cumple' ? 'ig-ok' : est.clave === 'limite' ? 'ig-limite' : 'ig-mal';
      const detalle = m.numerador != null && m.denominador != null
        ? ` (${igNum(m.numerador, 0)} de ${igNum(m.denominador, 0)})` : '';
      return `
      <div class="bar-row">
        <span class="bar-label" title="${etiqueta(m.periodo)}${detalle}">${etiqueta(m.periodo)}${detalle}</span>
        <span class="bar-track"><span class="bar-fill ${clase}" data-pct="${Math.max(0, Math.min(100, Number(m.valor)))}"></span></span>
        <span class="bar-value">${igNum(m.valor, 0)}%</span>
      </div>`;
    }).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.pct + '%'; });
    });
  },

  // ---- Estadística del conjunto ------------------------------------------
  // Cómo está repartido el sistema entre lo que cumple, lo que no, y lo que
  // ni siquiera se puede juzgar. Esto último va aparte a propósito: un
  // indicador sin medición no es un indicador que falle, y mezclarlos haría
  // ver el sistema peor (o mejor) de lo que se sabe que está.
  _pintarDonut(filas) {
    const donut = document.getElementById('ig-donut');
    const legend = document.getElementById('ig-donut-legend');
    const total = document.getElementById('ig-donut-total');
    if (!donut) return;
    total.textContent = filas.length;

    const grupos = [
      ['cumple', 'Cumplen la meta'],
      ['limite', 'En el límite'],
      ['no_cumple', 'No cumplen'],
      ['sin_ref', 'Sin año anterior'],
      ['sin_dato', 'Sin medición'],
      ['informativo', 'Informativos'],
    ].map(([clave, texto]) => ({
      clave, texto, n: filas.filter((f) => f.estado.clave === clave).length,
    })).filter((g) => g.n);

    if (!filas.length || !grupos.length) {
      donut.style.background = 'var(--slate-200)';
      legend.innerHTML = '<li class="empty-note">Sin indicadores para este filtro.</li>';
      return;
    }

    let acc = 0;
    const stops = [];
    legend.innerHTML = grupos.map((g) => {
      const color = IG_COLOR_ESTADO[g.clave];
      const pct = (g.n / filas.length) * 100;
      stops.push(`${color} ${acc}% ${acc + pct}%`);
      acc += pct;
      return `
        <li>
          <span class="dot" style="background:${color}"></span>
          <span class="legend-label">${g.texto}</span>
          <span class="legend-value">${g.n}</span>
        </li>`;
    }).join('');
    donut.style.background = `conic-gradient(${stops.join(', ')})`;
  },

  // Cuántos indicadores caen en cada nivel de la escala del informe. Es otra
  // lectura, no la misma: un indicador puede estar en "Sobresaliente" y aun
  // así no alcanzar su meta, como el cumplimiento legal del 90% contra una
  // meta del 95%.
  _pintarNiveles(filas) {
    const el = document.getElementById('ig-niveles');
    if (!el) return;
    const conNivel = filas.filter((f) => f.calificacion);
    if (!conNivel.length) {
      el.innerHTML = '<p class="empty-note">Todavía no hay indicadores con nivel de gestión calculado.</p>';
      return;
    }
    const orden = ['Excelente', 'Sobresaliente', 'Bueno', 'Aceptable', 'Inaceptable'];
    const datos = orden.map((nivel) => ({
      nivel, n: conNivel.filter((f) => f.calificacion.texto === nivel).length,
    }));
    const max = Math.max(...datos.map((d) => d.n)) || 1;
    el.innerHTML = datos.map((d, i) => `
      <div class="ranked-row${d.n === max && d.n ? ' top-rank' : ''}">
        <span class="ranked-rank">${i + 1}</span>
        <div class="ranked-body">
          <div class="ranked-top-row">
            <span class="ranked-label">${d.nivel}</span>
            <span class="ranked-value">${d.n}<span class="ranked-pct">${
              conNivel.length ? Math.round((d.n / conNivel.length) * 100) : 0}%</span></span>
          </div>
          <span class="ranked-track"><span class="ranked-fill" data-pct="${(d.n / max) * 100}"
            style="background:${IG_COLOR_NIVEL[d.nivel]}"></span></span>
        </div>
      </div>`).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.ranked-fill').forEach((b) => { b.style.width = b.dataset.pct + '%'; });
    });
  },

  // El índice de cada sistema por separado: un promedio de los 24 junto
  // esconde que uno de los dos puede estar bastante peor que el otro.
  _pintarPorSistema(filas) {
    const caja = document.getElementById('ig-por-sistema');
    if (!caja) return;
    const indices = Object.keys(IG_SISTEMAS).map((sis) => {
      const suyos = filas.filter((f) => f.ind.sistema === sis && f.res && igAplicaEscala(f.ind));
      const valor = suyos.length
        ? Math.round(suyos.reduce((s, f) => s + f.res.valor, 0) / suyos.length) : null;
      return { sis, valor, n: suyos.length, cal: igCalificacion(valor) };
    }).filter((x) => x.n);

    caja.innerHTML = indices.length
      ? indices.map((x) => `
        <div class="ruta-kpi">
          <div class="ruta-kpi-value" style="color:${x.cal ? IG_COLOR_NIVEL[x.cal.texto] : 'inherit'}">${x.valor}%</div>
          <div class="ruta-kpi-label">${igEsc(IG_SISTEMAS[x.sis])} · ${x.cal ? x.cal.texto : ''}</div>
        </div>`).join('')
      : '<p class="empty-note">Sin indicadores medidos para calcular el índice.</p>';
  },

  // Lo que se reportó frente a lo que encontró la auditoría. Es el hallazgo
  // del informe técnico y no se entiende con un solo número: hay que ver los
  // dos al lado.
  _pintarComparativo() {
    const el = document.getElementById('ig-comparativo');
    if (!el) return;
    const dato = (grupo) => (this._series || []).filter((s) => s.grupo === grupo);
    const auto = dato('pesv_autogestion');
    const audi = dato('pesv_auditoria');
    if (!auto.length && !audi.length) {
      el.innerHTML = '<p class="empty-note">Sin resultados de autogestión ni de auditoría cargados para este año.</p>';
      return;
    }
    const columna = (titulo, datos, colores) => {
      const total = datos.reduce((s, d) => s + Number(d.valor), 0) || 1;
      return `
        <div>
          <p class="muted" style="margin:0 0 .5rem"><strong>${igEsc(titulo)}</strong> · ${igNum(total, 0)} ítems</p>
          <div class="bar-chart" style="max-height:none">
            ${datos.map((d, i) => `
              <div class="bar-row">
                <span class="bar-label" title="${igEsc(d.etiqueta)}">${igEsc(d.etiqueta)}</span>
                <span class="bar-track"><span class="bar-fill" data-pct="${(Number(d.valor) / total) * 100}"
                  style="background:${colores[i % colores.length]}"></span></span>
                <span class="bar-value">${igNum(d.valor, 0)}</span>
              </div>`).join('')}
          </div>
        </div>`;
    };
    el.innerHTML = `
      <div class="stat-grid" style="margin:0">
        ${auto.length ? columna('Reporte de autogestión', auto, ['#0f8a4f', '#dc2626', '#94a3b8']) : ''}
        ${audi.length ? columna('Auditoría interna', audi, ['#0f8a4f', '#d97706', '#dc2626']) : ''}
      </div>`;
    requestAnimationFrame(() => {
      el.querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.pct + '%'; });
    });
  },

  _pintarSeries() {
    const dibujar = (id, grupo, vacio) => {
      const el = document.getElementById(id);
      if (!el) return;
      const datos = (this._series || []).filter((s) => s.grupo === grupo);
      if (!datos.length) {
        el.innerHTML = `<p class="empty-note">${vacio}</p>`;
        return;
      }
      const max = Math.max(...datos.map((d) => Number(d.valor))) || 1;
      el.innerHTML = datos.map((d) => `
        <div class="bar-row">
          <span class="bar-label" title="${igEsc(d.etiqueta)}">${igEsc(d.etiqueta)}</span>
          <span class="bar-track"><span class="bar-fill" data-pct="${(Number(d.valor) / max) * 100}"></span></span>
          <span class="bar-value">${igNum(d.valor, 0)}</span>
        </div>`).join('');
      requestAnimationFrame(() => {
        el.querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.pct + '%'; });
      });
    };
    dibujar('ig-series-capacitacion', 'capacitacion_tema', 'Sin participación por tema cargada para este año.');
    dibujar('ig-series-salud', 'salud_especialidad', 'Sin atenciones por especialidad cargadas para este año.');

    // Accidentalidad va como cifras y no como barras: seis accidentes al lado
    // de 2.294 trabajadores en la misma escala no se vería.
    const acc = (this._series || []).filter((s) => s.grupo === 'accidentalidad');
    const caja = document.getElementById('ig-accidentalidad');
    if (caja) {
      caja.innerHTML = acc.length
        ? acc.map((s) => `
          <div class="ruta-kpi">
            <div class="ruta-kpi-value">${igNum(s.valor, 0)}</div>
            <div class="ruta-kpi-label">${igEsc(s.etiqueta)}</div>
          </div>`).join('')
        : '<p class="empty-note">Sin cifras de accidentalidad cargadas para este año.</p>';
    }
  },

  // ---- Registrar una medición --------------------------------------------
  _abrirForm(indicadorId) {
    const cat = this._catalogo || [];
    const manuales = cat.filter((i) => !i.fuente || i.fuente === 'manual');
    const ind = manuales.find((i) => i.id === indicadorId) || manuales[0];
    if (!ind) return;
    const mes = new Date().getMonth() + 1;
    const periodoSugerido = ind.frecuencia === 'mensual' ? mes
      : ind.frecuencia === 'trimestral' ? Math.ceil(mes / 3) : 1;

    document.getElementById('modal-body').innerHTML = `
      <div class="modal-section">
        <h3 class="modal-section-title">Registrar medición</h3>
        <form id="ig-form" class="form">
          <label>Indicador
            <select id="ig-f-indicador">
              ${cat.filter((i) => !i.fuente || i.fuente === 'manual')
                .map((i) => `<option value="${i.id}" ${i.id === ind.id ? 'selected' : ''}>${igEsc(IG_SISTEMAS[i.sistema])} · ${igEsc(i.nombre)}</option>`).join('')}
            </select>
          </label>
          <p class="muted" id="ig-f-ayuda"></p>
          <label>Año<input type="number" id="ig-f-anio" value="${this._anio}" min="2015" max="2100" /></label>
          <label>Periodo
            <select id="ig-f-periodo"></select>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="ig-f-acumulado" />
            Es el acumulado del año hasta ese periodo, no el dato de ese periodo
          </label>

          <h4 class="modal-section-title" style="margin-top:0.8rem">Lo que se contó</h4>
          <p class="muted">Con el conteo basta: el porcentaje y el estado los calcula el sistema. El valor directo es solo para los indicadores que no tienen un conteo detrás.</p>
          <label>Cantidad lograda (numerador)<input type="number" id="ig-f-num" step="any" placeholder="Ej. 21 capacitaciones ejecutadas" /></label>
          <label>Cantidad esperada (denominador)<input type="number" id="ig-f-den" step="any" placeholder="Ej. 28 capacitaciones programadas" /></label>
          <label>O el valor directo<input type="number" id="ig-f-valor" step="any" placeholder="Ej. 1.5" /></label>
          <label>Observación (opcional)<input type="text" id="ig-f-obs" /></label>

          <div style="margin-top:0.9rem; display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap">
            <button type="submit">Guardar</button>
            <button type="button" class="btn-secondary" id="ig-f-borrar">Borrar esta medición</button>
          </div>
          <p id="ig-f-msg" class="form-msg"></p>
        </form>
      </div>`;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const refrescar = () => this._refrescarForm(periodoSugerido);
    document.getElementById('ig-f-indicador').addEventListener('change', refrescar);
    document.getElementById('ig-f-anio').addEventListener('change', refrescar);
    document.getElementById('ig-f-periodo').addEventListener('change', () => this._cargarEnForm());
    document.getElementById('ig-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._guardar();
    });
    document.getElementById('ig-f-borrar').addEventListener('click', () => this._borrar());
    refrescar();
  },

  _indicadorDelForm() {
    const id = Number(document.getElementById('ig-f-indicador').value);
    return (this._catalogo || []).find((i) => i.id === id);
  },

  _refrescarForm(periodoSugerido) {
    const ind = this._indicadorDelForm();
    if (!ind) return;
    const total = ind.frecuencia === 'mensual' ? 12 : ind.frecuencia === 'trimestral' ? 4 : 1;
    const nombre = (p) => (ind.frecuencia === 'mensual' ? IG_MESES[p - 1]
      : ind.frecuencia === 'trimestral' ? `Trimestre ${p}` : 'Todo el año');
    const sel = document.getElementById('ig-f-periodo');
    const previo = Number(sel.value);
    sel.innerHTML = Array.from({ length: total }, (_, i) => i + 1)
      .map((p) => `<option value="${p}">${nombre(p)}</option>`).join('');
    sel.value = String(previo && previo <= total ? previo : Math.min(periodoSugerido || 1, total));

    document.getElementById('ig-f-ayuda').textContent =
      `${ind.formula || ''}${ind.formula ? ' · ' : ''}Meta: ${ind.meta_texto || 'sin meta'} · Frecuencia ${ind.frecuencia}`;
    this._cargarEnForm();
  },

  // Si ya hay una medición para ese indicador/año/periodo, se trae al
  // formulario: así se ve que se va a reemplazar, en vez de guardar encima sin
  // avisar.
  _cargarEnForm() {
    const ind = this._indicadorDelForm();
    const anio = Number(document.getElementById('ig-f-anio').value);
    const periodo = Number(document.getElementById('ig-f-periodo').value);
    const m = (this._mediciones || []).find((x) => x.indicador_id === ind.id
      && x.anio === anio && x.periodo === periodo);
    document.getElementById('ig-f-num').value = m && m.numerador != null ? m.numerador : '';
    document.getElementById('ig-f-den').value = m && m.denominador != null ? m.denominador : '';
    document.getElementById('ig-f-valor').value = m && m.numerador == null && m.valor != null ? m.valor : '';
    document.getElementById('ig-f-acumulado').checked = !!(m && m.acumulado);
    document.getElementById('ig-f-obs').value = (m && m.observacion) || '';
    document.getElementById('ig-f-borrar').classList.toggle('hidden', !m || !igPuede('borrar'));
    document.getElementById('ig-f-msg').textContent = m
      ? `Ya hay una medición guardada para ese periodo (${igUnidad(ind, m.valor)}); al guardar se reemplaza.` : '';
    document.getElementById('ig-f-msg').className = 'form-msg';
    this._medicionEnForm = m || null;
  },

  async _guardar() {
    const ind = this._indicadorDelForm();
    const msg = document.getElementById('ig-f-msg');
    const num = document.getElementById('ig-f-num').value;
    const den = document.getElementById('ig-f-den').value;
    const valor = document.getElementById('ig-f-valor').value;

    const hayPartes = num !== '' && den !== '';
    if (!hayPartes && valor === '') {
      msg.textContent = 'Falta el dato: o el conteo (las dos cantidades) o el valor directo.';
      msg.className = 'form-msg error';
      return;
    }
    if (hayPartes && Number(den) === 0) {
      msg.textContent = 'La cantidad esperada no puede ser cero: no habría de qué sacar el porcentaje.';
      msg.className = 'form-msg error';
      return;
    }
    try {
      Loading.show('Guardando…');
      await DB.guardarMedicionGestion({
        indicadorId: ind.id,
        anio: Number(document.getElementById('ig-f-anio').value),
        periodo: Number(document.getElementById('ig-f-periodo').value),
        numerador: hayPartes ? Number(num) : null,
        denominador: hayPartes ? Number(den) : null,
        valor: hayPartes ? null : Number(valor),
        acumulado: document.getElementById('ig-f-acumulado').checked,
        observacion: document.getElementById('ig-f-obs').value.trim(),
      });
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
    } catch (err) {
      msg.textContent = igMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  async _borrar() {
    if (!this._medicionEnForm) return;
    const msg = document.getElementById('ig-f-msg');
    try {
      Loading.show('Borrando…');
      await DB.borrarMedicionGestion(this._medicionEnForm.id);
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
    } catch (err) {
      msg.textContent = igMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },
});
