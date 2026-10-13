/* ============================================================
   Estadística de procesos disciplinarios
   ------------------------------------------------------------
   Dos entradas de menú, UN solo tablero:

     Procesos disciplinarios gestión humana  -> abre en ago–oct
     Procesos disciplinarios histórico       -> abre en todo

   Se hizo así y no como dos módulos separados porque la pregunta
   es la misma y solo cambia el periodo. Dos copias del mismo
   cálculo se habrían ido separando con cada arreglo, y el día que
   dieran cifras distintas nadie sabría cuál creer.

   Ningún dato personal pasa por acá: la vista pide conteos a
   kardex_pd_estadistica() y lo que recibe son etiquetas y
   números. Los expedientes siguen en su módulo, cerrado.
   ============================================================ */

const PDE_DECISION = {
  invitacion: 'Invitación formal',
  llamado: 'Llamado de atención',
  suspension: 'Suspensión',
  terminacion: 'Terminación del contrato',
  sin_decision: 'Sin decisión todavía',
};

const PDE_ESTADO = {
  citacion: 'En citación',
  descargos: 'En descargos',
  decision: 'En decisión',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

const PDE_ASISTENCIA = { si: 'Asistió', no: 'No asistió', sin_dato: 'Sin registrar' };

const PDE_ORDEN_ESTADO = ['En citación', 'En descargos', 'En decisión', 'Finalizado', 'Cancelado'];
// Las etiquetas del orden fijo son las YA renombradas: pdeMapear() traduce
// primero y ordena después. Poner acá la clave cruda ('4 o mas') dejaría ese
// grupo fuera del orden sin que se notara.
const PDE_ORDEN_REINCIDENCIA = ['1 proceso', '2 procesos', '3 procesos', '4 o más'];

const PDE_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Las etiquetas que significan "nadie llenó esto". Van juntas porque las
// tratan igual las barras y las donas: salen de la gráfica, pero NUNCA del
// pie que dice sobre cuántos procesos está hecha.
const PDE_SIN_DATO = ['Sin dato', 'Sin clasificar', 'Sin registrar', 'Sin decisión todavía'];

function pdeEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// '2026-08' -> 'ago 2026'. Por componentes y no con Date: una fecha ISO
// suelta se interpreta como medianoche UTC y en Colombia (UTC-5) cae el mes
// anterior cuando el día es el 1.
function pdeMesLabel(ym) {
  const [a, m] = String(ym).split('-').map(Number);
  if (!a || !m) return String(ym);
  return `${PDE_MESES[m - 1]} ${a}`;
}

// Renombra las etiquetas que vienen en clave desde la base y, si se da un
// orden fijo, lo respeta. Las dimensiones sin orden fijo van de mayor a
// menor, que es como se lee una gráfica de ranking.
function pdeMapear(dist, diccionario, ordenFijo) {
  let filas = (dist || []).map((d) => ({
    label: (diccionario && diccionario[d.label]) || d.label,
    count: d.count,
  }));
  if (ordenFijo) {
    filas.sort((a, b) => {
      const ia = ordenFijo.indexOf(a.label);
      const ib = ordenFijo.indexOf(b.label);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  } else {
    filas.sort((a, b) => b.count - a.count);
  }
  return filas;
}

// Separa lo que tiene dato de lo que no. La gráfica se dibuja solo con lo
// primero -- una barra de "sin clasificar" con 365 de 418 procesos aplasta la
// escala y deja las demás ilegibles --, y lo segundo se dice con palabras
// debajo. Esconder la barra arregla la lectura; esconder que el dato falta
// sería hacer pasar 53 procesos por 418.
function pdeSeparar(filas) {
  const con = filas.filter((f) => !PDE_SIN_DATO.includes(f.label));
  const sin = filas.filter((f) => PDE_SIN_DATO.includes(f.label))
    .reduce((s, f) => s + f.count, 0);
  return { con, sin };
}

// El pie de cada gráfica. Solo aparece cuando de verdad falta algo.
function pdeNotaCobertura(conDato, sinDato) {
  if (!sinDato) return '';
  const total = conDato + sinDato;
  const pct = Math.round((sinDato / total) * 100);
  return `<p class="empty-note">Sobre ${conDato} de ${total} procesos.`
    + ` Los otros ${sinDato} (${pct}%) llegaron sin este dato desde la hoja.</p>`;
}

function pdeBarras(elId, dist) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!(dist || []).length) {
    el.innerHTML = '<p class="empty-note">Sin procesos en este periodo.</p>';
    return;
  }
  const { con, sin } = pdeSeparar(dist);
  const nota = pdeNotaCobertura(con.reduce((s, d) => s + d.count, 0), sin);
  if (!con.length) {
    el.innerHTML = '<p class="empty-note">Ningún proceso del periodo tiene este dato registrado.</p>' + nota;
    return;
  }
  const max = Math.max(...con.map((d) => d.count)) || 1;
  el.innerHTML = con.map((d) => `
    <div class="bar-row">
      <span class="bar-label" title="${pdeEsc(d.label)}">${pdeEsc(d.label)}</span>
      <span class="bar-track"><span class="bar-fill" data-pct="${(d.count / max) * 100}"></span></span>
      <span class="bar-value">${d.count}</span>
    </div>
  `).join('') + nota;
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar-fill').forEach((bar) => { bar.style.width = bar.dataset.pct + '%'; });
  });
}

const PDE_PALETA = ['#2f6fed', '#ff9f43', '#ef5da8', '#5ec26a', '#a970ff', '#20b2aa', '#26c6da', '#7b8cff'];

function pdeDonut(donutId, legendId, totalId, dist) {
  const donut = document.getElementById(donutId);
  const legend = document.getElementById(legendId);
  if (!donut || !legend) return;
  const elTotal = document.getElementById(totalId);

  const { con, sin } = pdeSeparar(dist || []);
  const total = con.reduce((s, d) => s + d.count, 0);
  if (elTotal) elTotal.textContent = total;
  // El porcentaje se calcula sobre los que SÍ tienen el dato. Repartir el
  // 100% incluyendo los que no lo tienen daría, por ejemplo, "Suspensión
  // 1.7%" cuando sobre los procesos con decisión registrada es el 13%.
  const nota = pdeNotaCobertura(total, sin);

  if (!total) {
    donut.style.background = 'var(--slate-200)';
    legend.innerHTML = sin
      ? `<li class="empty-note">Ningún proceso del periodo tiene este dato registrado.</li><li>${nota}</li>`
      : '<li class="empty-note">Sin procesos en este periodo.</li>';
    return;
  }

  let acc = 0;
  const stops = [];
  const items = [];
  con.forEach((d, i) => {
    const color = PDE_PALETA[i % PDE_PALETA.length];
    const pct = (d.count / total) * 100;
    stops.push(`${color} ${acc}% ${acc + pct}%`);
    items.push(`
      <li>
        <span class="dot" style="background:${color}"></span>
        <span class="legend-label">${pdeEsc(d.label)}</span>
        <span class="legend-value">${pct.toFixed(1)}%</span>
      </li>
    `);
    acc += pct;
  });
  donut.style.background = `conic-gradient(${stops.join(', ')})`;
  legend.innerHTML = items.join('') + (nota ? `<li>${nota}</li>` : '');
}

function pdeMensajeError(err) {
  // El código del error va en err.code, NO dentro del mensaje: PostgREST
  // manda {code:'42501', message:'permission denied...'}, y el texto puede
  // venir en inglés. Buscando solo en el mensaje, un "sin permiso" se caía
  // al mensaje genérico y no se distinguía de una caída de red.
  const codigo = String((err && err.code) || '');
  const texto = [err && err.message, err && err.hint, err && err.details]
    .filter(Boolean).join(' ') || String(err || '');
  if (codigo === '42501' || /permiso|permission denied/i.test(texto)) {
    return 'Tu cuenta no tiene permiso para ver la estadística de procesos disciplinarios.';
  }
  if (/kardex_pd_estadistica|does not exist|PGRST202/i.test(texto) || codigo === 'PGRST202') {
    return 'Falta correr sql/procesos_disciplinarios_estadistica_2026-10-13.sql en la base de datos.';
  }
  return 'No se pudo cargar la estadística: ' + texto;
}

// ------------------------------------------------------------------
// La vista. Se construye dos veces con distinto prefijo de ids y
// distinto periodo de arranque; todo lo demás es idéntico.
// ------------------------------------------------------------------
function pdeCrearVista({ titulo, p, periodoInicial }) {
  const id = (sufijo) => `${p}-${sufijo}`;
  const $ = (sufijo) => document.getElementById(id(sufijo));

  return {
    title: titulo,

    async onEnter() {
      if (!this._bound) {
        [$('desde'), $('hasta')].forEach((el) => el.addEventListener('change', () => this._cargar()));
        $('periodo-informe').addEventListener('click', () => this._fijarPeriodo('informe'));
        $('periodo-anio').addEventListener('click', () => this._fijarPeriodo('anio'));
        $('periodo-todo').addEventListener('click', () => this._fijarPeriodo('todo'));
        this._fijarPeriodo(periodoInicial, { sinCargar: true });
        this._bound = true;
      }
      await this._cargar();
    },

    // Los atajos de periodo son del año en curso, no fechas fijas en el
    // código: un "2026-08-01" escrito acá habría quedado mintiendo en
    // enero del año que viene sin que nadie se diera cuenta.
    _fijarPeriodo(cual, opciones) {
      const anio = new Date().getFullYear();
      if (cual === 'informe') {
        $('desde').value = `${anio}-08-01`;
        $('hasta').value = `${anio}-10-31`;
      } else if (cual === 'anio') {
        $('desde').value = `${anio}-01-01`;
        $('hasta').value = `${anio}-12-31`;
      } else {
        $('desde').value = '';
        $('hasta').value = '';
      }
      if (!(opciones && opciones.sinCargar)) this._cargar();
    },

    async _cargar() {
      const desde = $('desde').value || null;
      const hasta = $('hasta').value || null;
      const aviso = $('msg');
      aviso.className = 'form-msg';
      aviso.textContent = 'Cargando…';

      let datos;
      try {
        datos = await DB.getEstadisticaProcesosDisciplinarios(desde, hasta);
      } catch (err) {
        aviso.className = 'form-msg error';
        aviso.textContent = pdeMensajeError(err);
        this._vaciar();
        return;
      }

      aviso.textContent = this._textoPeriodo(desde, hasta);
      this._pintar(datos);
    },

    _textoPeriodo(desde, hasta) {
      if (!desde && !hasta) return 'Todos los procesos registrados, sin límite de fecha.';
      if (desde && hasta) return `Procesos entre ${desde} y ${hasta}.`;
      if (desde) return `Procesos desde ${desde}.`;
      return `Procesos hasta ${hasta}.`;
    },

    _resumen(datos, clave) {
      const fila = (datos.resumen || []).find((f) => f.label === clave);
      return fila ? fila.count : 0;
    },

    _vaciar() {
      ['kpi-procesos', 'kpi-personas', 'kpi-reincidentes', 'kpi-abiertos',
        'kpi-suspensiones', 'kpi-terminaciones', 'kpi-dias', 'kpi-tarde'].forEach((k) => {
        const el = $(k);
        if (el) el.textContent = '—';
      });
      ['bars-mes', 'bars-falta', 'bars-sancion', 'bars-estado', 'bars-area', 'bars-ruta',
        'bars-cargo', 'bars-responsable', 'bars-reincidencia']
        .forEach((b) => pdeBarras(id(b), []));
      pdeDonut(id('donut-decision'), id('legend-decision'), id('donut-decision-total'), []);
      pdeDonut(id('donut-asistencia'), id('legend-asistencia'), id('donut-asistencia-total'), []);
    },

    _pintar(datos) {
      $('kpi-procesos').textContent = this._resumen(datos, 'procesos');
      $('kpi-personas').textContent = this._resumen(datos, 'personas');
      $('kpi-reincidentes').textContent = this._resumen(datos, 'reincidentes');
      $('kpi-abiertos').textContent = this._resumen(datos, 'abiertos');
      $('kpi-suspensiones').textContent = this._resumen(datos, 'suspensiones');
      $('kpi-terminaciones').textContent = this._resumen(datos, 'terminaciones');
      $('kpi-dias').textContent = this._resumen(datos, 'dias_suspension');

      // Las llegadas tarde salen del campo "falta", que en la mayoría de los
      // procesos importados viene vacío. El número solo, sin decir sobre
      // cuántos está hecho, se leería como el total de llegadas tarde de la
      // empresa -- y es el total de las que alguien alcanzó a clasificar.
      const tarde = this._resumen(datos, 'llegadas_tarde');
      const conFalta = this._resumen(datos, 'con_falta');
      const totalProc = this._resumen(datos, 'procesos');
      $('kpi-tarde').textContent = tarde;
      $('kpi-tarde-label').textContent = (conFalta < totalProc)
        ? `Llegadas tarde · solo ${conFalta} de ${totalProc} procesos tienen la falta registrada`
        : 'Llegadas tarde (retardo o incumplir horario)';

      // Los meses van en orden cronológico, no de mayor a menor: la gráfica
      // de evolución pierde todo su sentido si se reordena por tamaño.
      const meses = (datos.mes || []).slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((m) => ({ label: pdeMesLabel(m.label), count: m.count }));
      pdeBarras(id('bars-mes'), meses);

      pdeDonut(id('donut-decision'), id('legend-decision'), id('donut-decision-total'),
        pdeMapear(datos.decision, PDE_DECISION));
      pdeDonut(id('donut-asistencia'), id('legend-asistencia'), id('donut-asistencia-total'),
        pdeMapear(datos.asistencia, PDE_ASISTENCIA));

      pdeBarras(id('bars-falta'), pdeMapear(datos.falta));
      pdeBarras(id('bars-sancion'), pdeMapear(datos.sancion));
      pdeBarras(id('bars-estado'), pdeMapear(datos.estado, PDE_ESTADO, PDE_ORDEN_ESTADO));
      pdeBarras(id('bars-area'), pdeMapear(datos.area));
      pdeBarras(id('bars-ruta'), pdeMapear(datos.ruta));
      pdeBarras(id('bars-cargo'), pdeMapear(datos.cargo));
      pdeBarras(id('bars-responsable'), pdeMapear(datos.responsable));
      pdeBarras(id('bars-reincidencia'),
        pdeMapear(datos.reincidencia, { '4 o mas': '4 o más' }, PDE_ORDEN_REINCIDENCIA));
    },
  };
}

Router.register('procesos-disciplinarios-gh', pdeCrearVista({
  titulo: 'Procesos disciplinarios gestión humana',
  p: 'pdg',
  periodoInicial: 'informe',
}));

Router.register('procesos-disciplinarios-historico', pdeCrearVista({
  titulo: 'Procesos disciplinarios histórico',
  p: 'pdh',
  periodoInicial: 'todo',
}));
