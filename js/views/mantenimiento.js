// Seguridad vial: consulta de los alistamientos diarios y los mantenimientos
// que captura la "Plataforma SICOV" (otra app, mismo Supabase) y que se le
// reportan a la Superintendencia de Transporte, y de las preoperacionales de
// las rutas urbanas.
//
// El módulo se llama "Seguridad vial" de cara al usuario, pero su
// identificador sigue siendo 'mantenimiento': es el valor del permiso en
// kardex_permisos_usuario (con su CHECK) y la ruta #/mantenimiento. Cambiarlo
// costaría una migración y rompería los enlaces guardados, sin que nadie lo
// note.
//
// Esta vista SOLO LEE. El alistamiento lo llena el conductor en su formulario
// y el mantenimiento el taller en el suyo; ahí se valida la placa contra la
// flota, la cédula contra employees y las actividades contra el catálogo
// oficial. Duplicar ese registro acá sería abrir una segunda puerta a un dato
// que se le afirma a un regulador.
//
// El catálogo de actividades se guarda por su id OFICIAL, así que lo que se
// muestra en la ficha es exactamente lo que viaja en el reporte.

// Por componentes y no con new Date(iso): Colombia es UTC-5 y una fecha sola
// ('2026-10-09') se leería como medianoche UTC, que acá es el día antes.
function mtFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '—';
  return new Date(a, m - 1, d).toLocaleDateString('es-CO');
}

function mtHora(hhmmss) {
  if (!hhmmss) return '—';
  return String(hhmmss).slice(0, 5);
}

function mtHoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

function mtEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 1 y 2 son los valores que exige el manual de la Supertransporte; se guardan
// como número porque es lo que viaja en el reporte.
const MT_TIPO = { 1: 'Preventivo', 2: 'Correctivo' };

// ---- Checklist urbano (preoperacionales de Zamora y Aranjuez) -------------
// Copiado literal de supabase/functions/_shared/preop.ts del backend de las
// apps de conductor, que es donde se valida y donde se calcula el
// estado_general. Acá solo sirve para PINTAR: poner el ítem con su nombre
// legible y su color según la gravedad. El original manda; si allá cambian un
// valor, acá aparecería sin color hasta que se copie de nuevo -- por eso
// MT_PREOP_NIVEL cae en 1 (alerta) ante un valor que no reconoce, y no en 0:
// más vale señalar de más que dar por bueno algo que no se sabe qué es.
const MT_PREOP_CAMPOS = {
  conductor_apto: { 'Sí, apto': 0, 'No, no apto': 2 },
  fluidos: { 'OK': 0, 'Alguno bajo': 1, 'Falta alguno o requiere cambio': 2 },
  llantas: { 'OK': 0, 'Presión baja o desgaste visible': 1, 'Llanta lisa o desinflada': 2 },
  direccion_suspension: { 'OK': 0, 'Vibra o hace ruido extraño': 1, 'Juego excesivo o no responde bien': 2 },
  luces: { 'OK': 0, 'Alguna no sirve': 1, 'Varias no encienden': 2 },
  visibilidad: { 'OK': 0, 'Requiere ajuste o no limpia bien': 1, 'Dañado, no funciona o parabrisas fisurado': 2 },
  cinturones: { 'OK': 0, 'Alguno dañado': 1, 'No funcionan': 2 },
  emergencia: { 'OK': 0, 'Algo incompleto o vencido': 1, 'Falta extintor o botiquín': 2 },
  puertas: { 'OK': 0, 'Pasamanos flojo o puerta dura': 1, 'No cierra bien o no hay salida de emergencia': 2 },
  documentacion: { 'OK': 0, 'Alguno por vencer': 1, 'Alguno vencido o falta': 2 },
  frenos: { 'OK': 0, 'Se sienten suaves o flojos': 1, 'No frenan bien': 2 },
};

// El orden importa: el autorreporte del conductor va primero porque si él
// dice que no está apto, lo del vehículo pasa a segundo plano.
const MT_PREOP_ETIQUETAS = [
  ['conductor_apto', '¿El conductor se reporta apto?'],
  ['frenos', 'Frenos'],
  ['llantas', 'Llantas'],
  ['direccion_suspension', 'Dirección y suspensión'],
  ['luces', 'Luces'],
  ['fluidos', 'Fluidos'],
  ['visibilidad', 'Visibilidad (limpiabrisas, espejos, parabrisas)'],
  ['cinturones', 'Cinturones'],
  ['emergencia', 'Equipo de emergencia'],
  ['puertas', 'Puertas y pasamanos'],
  ['documentacion', 'Documentación'],
];

function mtPreopNivel(campo, valor) {
  const niveles = MT_PREOP_CAMPOS[campo];
  if (!niveles) return 1;
  const n = niveles[String(valor || '').trim()];
  return n === undefined ? 1 : n;
}

const MT_PREOP_ESTADO = {
  OK: { texto: 'OK', clase: 'activo' },
  ALERTA: { texto: 'Alerta', clase: 'pendiente' },
  CRITICO: { texto: 'Crítico', clase: 'novedad' },
};

// Cada pestaña tiene su propia escala de estado, así que el filtro se
// repuebla: ofrecerle "Con novedad" a un preoperacional no encontraría nada.
const MT_ESTADOS_POR_TAB = {
  alistamientos: [['', 'Todos'], ['OK', 'Sin novedad'], ['CON_NOVEDAD', 'Con novedad']],
  mantenimientos: [],
  preoperacionales: [['', 'Todos'], ['OK', 'OK'], ['ALERTA', 'Alerta'], ['CRITICO', 'Crítico']],
};

// ---- Qué flota reporta por cuál formulario -------------------------------
// La flota no alista toda por el mismo lado. SICOV es la operación del
// AEROPUERTO; el checklist urbano es el de ZAMORA y ARANJUEZ - GUADALUPE; y
// los vehículos de terminal no reportan por ninguno de los dos. Medir a todos
// contra el mismo formulario fue lo que infló la alerta de "sin alistar" a 70
// cuando los carros del aeropuerto son 51.
//
// Se reconoce por el NOMBRE de la ruta y no por su código (700, 2, 41, 313),
// porque el mismo código aparece con nombres distintos: hay vehículos de
// ruta 313 que son de Aranjuez y otros que son de terminal.
const MT_OPERACIONES = [
  ['aeropuerto', 'Aeropuerto', /AEROPUERTO/],
  ['zamora', 'Zamora', /ZAMORA/],
  ['aranjuez', 'Aranjuez - Guadalupe', /ARANJUEZ/],
];

function mtNormalizar(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().trim();
}

// 'aeropuerto' | 'zamora' | 'aranjuez' | null (terminal y cualquier otra).
function mtOperacion(texto) {
  const t = mtNormalizar(texto);
  if (!t) return null;
  const hit = MT_OPERACIONES.find(([, , re]) => re.test(t));
  return hit ? hit[0] : null;
}

// El vehículo de la flota trae el nombre en nombre_ruta ('AEROPUERTO') y el
// código en ruta ('700'); el preoperacional la trae ya con nombre en ruta.
function mtOperacionVehiculo(v) {
  return mtOperacion(v && v.nombre_ruta) || mtOperacion(v && v.ruta);
}

// Los íconos los pone el JS porque la tarjeta cambia de significado con la
// pestaña: el mismo recuadro mide alistamientos, correctivos o una ruta.
const MT_ICONOS = {
  bus: '<svg viewBox="0 0 20 20" fill="none"><path d="M3 13.5V9l1.8-4.2A1.5 1.5 0 016.2 4h7.6a1.5 1.5 0 011.4.8L17 9v4.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 13.5h14v1.9a.6.6 0 01-.6.6h-1.3a.6.6 0 01-.6-.6v-1.9M3 13.5v1.9c0 .3.3.6.6.6h1.3c.3 0 .6-.3.6-.6v-1.9" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="11" r="1" fill="currentColor"/><circle cx="14" cy="11" r="1" fill="currentColor"/></svg>',
  alerta: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 3.2l7 12.3H3L10 3.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v3.2M10 13.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  reloj: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4.5l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  llave: '<svg viewBox="0 0 20 20" fill="none"><path d="M12.5 3.6a3.9 3.9 0 00-5 5L4 12.1a1.4 1.4 0 102 2l3.5-3.5a3.9 3.9 0 005-5l-2 2-1.6-.4-.4-1.6 2-2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M6.4 10.2l2.4 2.4 4.8-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  escudo: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 2.8l5.4 2v4.6c0 3.3-2.2 6.3-5.4 7.3-3.2-1-5.4-4-5.4-7.3V4.8l5.4-2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 17.2s5.2-4.7 5.2-8.4A5.2 5.2 0 0010 3.6a5.2 5.2 0 00-5.2 5.2c0 3.7 5.2 8.4 5.2 8.4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="8.8" r="1.9" stroke="currentColor" stroke-width="1.4"/></svg>',
};

function mtMensajeError(err) {
  const m = String(err?.message || err || '');
  if (/permission denied|row-level security|policy/i.test(m)) {
    return 'Tu cuenta no tiene permiso para consultar seguridad vial. Pídeselo a un administrador en Usuarios.';
  }
  if (/relation .* does not exist|PGRST205/i.test(m)) {
    return 'Las tablas de la plataforma SICOV todavía no están creadas en esta base de datos.';
  }
  return m || 'Error desconocido.';
}

Router.register('mantenimiento', {
  title: 'Seguridad vial',

  _tab: 'alistamientos',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('mt-search').addEventListener('input', () => this._pintar());
      document.getElementById('mt-estado').addEventListener('change', () => this._pintar());
      document.getElementById('mt-ruta').addEventListener('change', () => this._pintar());
      document.getElementById('mt-desde').addEventListener('change', () => this._load());
      document.getElementById('mt-hasta').addEventListener('change', () => this._load());
      document.getElementById('mt-hoy').addEventListener('click', () => this._rango('hoy'));
      document.getElementById('mt-mes').addEventListener('click', () => this._rango('mes'));
      document.querySelectorAll('#mt-tabs [data-tab]').forEach((b) => {
        b.addEventListener('click', () => this._verTab(b.dataset.tab));
      });
      this._bound = true;
    }
    // Arranca en el día de hoy: es la consulta que se hace a diario ("¿quién
    // no ha alistado?"), y evita traer meses de registros sin que nadie los
    // haya pedido.
    if (!document.getElementById('mt-desde').value) this._rango('hoy', { sinCargar: true });
    this._verTab(this._tab);
    await this._load();
  },

  _rango(cual, { sinCargar = false } = {}) {
    const hoy = mtHoyISO();
    const desde = cual === 'mes' ? `${hoy.slice(0, 7)}-01` : hoy;
    document.getElementById('mt-desde').value = desde;
    document.getElementById('mt-hasta').value = hoy;
    if (!sinCargar) this._load();
  },

  _verTab(tab) {
    this._tab = tab;
    ['alistamientos', 'mantenimientos', 'preoperacionales'].forEach((t) => {
      document.getElementById(`mt-panel-${t}`).classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('#mt-tabs [data-tab]').forEach((b) => {
      b.classList.toggle('activo', b.dataset.tab === tab);
    });
    // Cada pestaña trae su escala. Un mantenimiento no tiene estado -- lo que
    // tiene es tipo preventivo o correctivo --, así que ahí el filtro se
    // esconde en vez de ofrecer opciones que no aplican.
    const opciones = MT_ESTADOS_POR_TAB[tab] || [];
    const sel = document.getElementById('mt-estado');
    sel.closest('.filtro-inline').classList.toggle('hidden', !opciones.length);
    if (opciones.length) {
      sel.innerHTML = opciones.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    }
    // La ruta solo existe en las urbanas: el aeropuerto es una sola.
    document.getElementById('mt-ruta-filtro').classList.toggle('hidden', tab !== 'preoperacionales');
    if (tab !== 'preoperacionales') document.getElementById('mt-ruta').value = '';
    if (this._alistamientos) this._pintar();
  },

  async _load() {
    const desde = document.getElementById('mt-desde').value || mtHoyISO();
    const hasta = document.getElementById('mt-hasta').value || mtHoyISO();
    Loading.show('Cargando…');
    try {
      const [alistamientos, mantenimientos, catalogo, vehiculos, preoperacionales] = await Promise.all([
        DB.getAlistamientosSicov({ desde, hasta }),
        DB.getMantenimientosSicov({ desde, hasta }),
        this._catalogo ? Promise.resolve(this._catalogo) : DB.getCatalogoActividadesSicov(),
        // La flota se usa solo para saber quién falta por alistar. Si esa
        // consulta falla, el resto de la vista no tiene por qué caerse.
        DB.getFlotaVehiculos().catch(() => []),
        // Las preoperacionales urbanas son de otro sistema: si todavía no se
        // abrió su permiso, las otras dos pestañas tienen que seguir sirviendo.
        DB.getPreoperacionales({ desde, hasta }).catch((e) => { this._errorPreop = e; return []; }),
      ]);
      this._alistamientos = alistamientos;
      this._mantenimientos = mantenimientos;
      this._catalogo = catalogo;
      this._catalogoPorId = Object.fromEntries(catalogo.map((a) => [a.id, a]));
      this._vehiculos = vehiculos;
      this._preoperacionales = preoperacionales;
      if (preoperacionales.length) this._errorPreop = null;
      this._pintar();
    } catch (err) {
      document.getElementById('mt-contador').textContent = mtMensajeError(err);
      document.getElementById('mt-tbody-alist').innerHTML =
        `<tr><td colspan="6" class="empty-note">${mtEsc(mtMensajeError(err))}</td></tr>`;
      document.getElementById('mt-tbody-mant').innerHTML = '';
    } finally {
      Loading.hide();
    }
  },

  _filtrados(filas, campos) {
    const q = document.getElementById('mt-search').value.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter((f) => campos.some((c) => String(f[c] || '').toLowerCase().includes(q)));
  },

  _pintar() {
    this._pintarKpis();
    if (this._tab === 'alistamientos') this._pintarAlistamientos();
    else if (this._tab === 'mantenimientos') this._pintarMantenimientos();
    else this._pintarPreoperacionales();
    this._pintarFaltantes();
  },

  // ---- Dashboard ---------------------------------------------------------
  // Los KPI siguen la PESTAÑA y el RANGO de fechas. Antes estaban clavados en
  // "hoy" y en los alistamientos, así que no se movían con nada: tres
  // pestañas que miden operaciones distintas mostraban el mismo número.
  // El buscador, el estado y la ruta siguen filtrando solo la tabla: son otra
  // pregunta ("dónde está este carro", no "cómo va la operación").

  // El día en foco es el 'hasta' del filtro, no hoy: así el panel sigue al
  // rango, y la etiqueta siempre dice de qué día está hablando.
  _diaFoco() {
    return document.getElementById('mt-hasta').value || mtHoyISO();
  },

  _diaTexto() {
    const h = this._diaFoco();
    return h === mtHoyISO() ? 'hoy' : `el ${mtFecha(h)}`;
  },

  _periodoTexto() {
    const d = document.getElementById('mt-desde').value;
    if (d === this._diaFoco()) return this._diaTexto();
    return `del ${mtFecha(d)} al ${mtFecha(this._diaFoco())}`;
  },

  // Vehículos vinculados de una operación: el universo contra el que se mide
  // quién faltó. Devuelve null -- y no [] -- cuando la flota no se pudo leer,
  // porque "faltan 0" sería una afirmación y lo que pasa es que no se sabe.
  _flotaDe(op) {
    if (!this._vehiculos || !this._vehiculos.length) return null;
    return this._vehiculos.filter((v) => v.vinculado && mtOperacionVehiculo(v) === op);
  },

  // Cada operación reporta por su propio formulario.
  _reportesDe(op) {
    if (op === 'aeropuerto') return this._alistamientos || [];
    return (this._preoperacionales || []).filter((p) => mtOperacion(p.ruta) === op);
  },

  _faltantes(op) {
    const flota = this._flotaDe(op);
    if (!flota) return null;
    const dia = this._diaFoco();
    const reportaron = new Set(this._reportesDe(op)
      .filter((r) => r.fecha === dia)
      .map((r) => mtNormalizar(r.placa)));
    return flota
      .filter((v) => !reportaron.has(mtNormalizar(v.placa)))
      .sort((a, b) => String(a.placa).localeCompare(String(b.placa), 'es'));
  },

  _kpiRuta(op, nombre) {
    const flota = this._flotaDe(op);
    const hechos = this._reportesDe(op).filter((p) => p.fecha === this._diaFoco()).length;
    return {
      valor: flota ? `${hechos}/${flota.length}` : String(hechos),
      label: `${nombre} ${this._diaTexto()}`,
      tono: flota && hechos >= flota.length ? 'green' : 'amber',
      icono: 'pin',
    };
  },

  _kpis() {
    const periodo = this._periodoTexto();

    if (this._tab === 'mantenimientos') {
      const ms = this._mantenimientos || [];
      return [
        { valor: ms.length, label: `Mantenimientos ${periodo}`, tono: 'green', icono: 'llave' },
        { valor: ms.filter((m) => Number(m.tipo) === 1).length, label: 'Preventivos', tono: 'blue', icono: 'escudo' },
        { valor: ms.filter((m) => Number(m.tipo) === 2).length, label: 'Correctivos', tono: 'red', icono: 'alerta' },
        { valor: new Set(ms.map((m) => mtNormalizar(m.placa))).size, label: 'Vehículos intervenidos', tono: 'amber', icono: 'bus' },
      ];
    }

    if (this._tab === 'preoperacionales') {
      // Las urbanas son dos rutas con su propia flota, así que van separadas:
      // "20 preoperacionales" no dice si Zamora reportó y Aranjuez no.
      const ps = this._preoperacionales || [];
      const graves = ps.filter((p) => p.estado_general === 'ALERTA' || p.estado_general === 'CRITICO').length;
      return [
        { valor: ps.length, label: `Preoperacionales ${periodo}`, tono: 'blue', icono: 'bus' },
        this._kpiRuta('zamora', 'Zamora'),
        this._kpiRuta('aranjuez', 'Aranjuez'),
        { valor: graves, label: `Con alerta o crítico ${periodo}`, tono: 'red', icono: 'alerta' },
      ];
    }

    const as = this._alistamientos || [];
    const flota = this._flotaDe('aeropuerto');
    const faltan = this._faltantes('aeropuerto');
    const tarjetas = [
      { valor: as.length, label: `Alistamientos ${periodo}`, tono: 'blue', icono: 'bus' },
      { valor: as.filter((a) => a.estado === 'CON_NOVEDAD').length, label: `Con novedad ${periodo}`, tono: 'red', icono: 'alerta' },
      {
        valor: faltan ? faltan.length : '—',
        label: faltan
          ? `Sin alistar ${this._diaTexto()} · de ${flota.length} del aeropuerto`
          : 'Sin alistar: no se pudo leer la flota',
        tono: 'amber',
        icono: 'reloj',
      },
    ];
    if (faltan && flota.length) {
      const cobertura = Math.round(((flota.length - faltan.length) / flota.length) * 100);
      tarjetas.push({ valor: `${cobertura}%`, label: `Cobertura del aeropuerto ${this._diaTexto()}`, tono: 'green', icono: 'check' });
    }
    return tarjetas;
  },

  _pintarKpis() {
    const tarjetas = this._kpis();
    for (let i = 1; i <= 4; i++) {
      const caja = document.getElementById(`mt-kpi-${i}`);
      const k = tarjetas[i - 1];
      caja.classList.toggle('hidden', !k);
      if (!k) continue;
      const icono = document.getElementById(`mt-kpi-${i}-icono`);
      icono.dataset.tone = k.tono;
      icono.innerHTML = MT_ICONOS[k.icono] || MT_ICONOS.bus;
      document.getElementById(`mt-kpi-${i}-valor`).textContent = k.valor;
      document.getElementById(`mt-kpi-${i}-label`).textContent = k.label;
    }
  },

  // El panel de "quién no reportó" también cambia con la pestaña, porque cada
  // operación se mide contra su propio formulario. En mantenimientos no
  // aplica -- un vehículo que no entró al taller no está en falta -- y por eso
  // ahí el panel desaparece en vez de mostrar una cuenta que no significa nada.
  _pintarFaltantes() {
    const detalle = document.getElementById('mt-faltantes-detalle');
    const ops = this._tab === 'alistamientos'
      ? [['aeropuerto', 'Aeropuerto']]
      : this._tab === 'preoperacionales'
        ? [['zamora', 'Zamora'], ['aranjuez', 'Aranjuez - Guadalupe']]
        : [];
    detalle.classList.toggle('hidden', !ops.length);
    if (!ops.length) return;

    const titulo = document.getElementById('mt-faltantes-titulo');
    const lista = document.getElementById('mt-faltantes-lista');

    // Si la consulta de preoperacionales falló, TODOS saldrían como faltantes.
    // Decir "faltan 54" cuando lo que pasa es que no se pudo leer sería la
    // peor versión de esta pantalla.
    if (this._tab === 'preoperacionales' && this._errorPreop) {
      titulo.textContent = 'No se puede saber quién falta';
      lista.innerHTML = `<p class="empty-note">${mtEsc(mtMensajeError(this._errorPreop))}</p>`;
      return;
    }

    const grupos = ops.map(([op, nombre]) => ({
      nombre,
      flota: this._flotaDe(op),
      faltan: this._faltantes(op),
    }));
    const sinFlota = grupos.some((g) => !g.faltan);
    const total = grupos.reduce((n, g) => n + (g.faltan ? g.faltan.length : 0), 0);
    titulo.textContent = sinFlota
      ? 'No se pudo leer la flota para saber quién falta'
      : total
        ? `${total} vehículo(s) sin reportar ${this._diaTexto()}`
        : `Todos reportaron ${this._diaTexto()}`;

    lista.innerHTML = grupos.map((g) => {
      if (!g.faltan) {
        return `<p class="empty-note">${mtEsc(g.nombre)}: no se pudo leer la flota, así que no se puede decir quién falta.</p>`;
      }
      if (!g.faltan.length) {
        return `<p class="muted" style="margin:0 0 .6rem"><strong>${mtEsc(g.nombre)}</strong> · los ${g.flota.length} vinculados reportaron.</p>`;
      }
      return `<p class="muted" style="margin:0 0 .4rem"><strong>${mtEsc(g.nombre)}</strong> · ${g.faltan.length} de ${g.flota.length} vinculados sin reportar</p>
        <div class="detalle-list" style="margin-bottom:1rem">${g.faltan.map((v) => `
          <div class="detalle-list-item">
            <span class="lc-item-texto">
              <span class="detalle-list-item-main">${mtEsc(v.placa)}</span>
              <span class="detalle-list-item-sub">${mtEsc(v.interno ? `Interno ${v.interno}` : 'Sin interno')}${v.nombre_ruta ? ` · ${mtEsc(v.nombre_ruta)}` : ''}</span>
            </span>
          </div>`).join('')}</div>`;
    }).join('');

    // Los de terminal no reportan por ninguno de los dos formularios y por eso
    // no se cuentan en ningún lado. Decirlo evita que parezca que se perdieron.
    const otros = (this._vehiculos || []).filter((v) => v.vinculado && !mtOperacionVehiculo(v)).length;
    if (otros) {
      lista.innerHTML += `<p class="empty-note">No se cuentan ${otros} vehículo(s) vinculado(s) de otras rutas (terminal): no reportan por estos formularios.</p>`;
    }
  },

  _pintarAlistamientos() {
    const estado = document.getElementById('mt-estado').value;
    let filas = this._filtrados(this._alistamientos || [],
      ['placa', 'conductor_nombre', 'conductor_num_id', 'responsable_nombre']);
    if (estado) filas = filas.filter((a) => a.estado === estado);

    document.getElementById('mt-contador').textContent =
      `${filas.length} alistamiento(s)` + (filas.length !== (this._alistamientos || []).length
        ? ` de ${(this._alistamientos || []).length}` : '');

    const tbody = document.getElementById('mt-tbody-alist');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Sin alistamientos en este período.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((a) => `
      <tr>
        <td>${mtFecha(a.fecha)}</td>
        <td><strong>${mtEsc(a.placa)}</strong></td>
        <td>${mtEsc(a.conductor_nombre || '—')}<br><span class="muted">CC ${mtEsc(a.conductor_num_id || '—')}</span></td>
        <td>${a.kilometraje != null ? Number(a.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td><span class="tag ${a.estado === 'CON_NOVEDAD' ? 'novedad' : 'activo'}">${a.estado === 'CON_NOVEDAD' ? 'Con novedad' : 'Sin novedad'}</span></td>
        <td><button type="button" class="btn-secondary" data-ver-alist="${a.id}">Ver</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-ver-alist]').forEach((b) => {
      b.addEventListener('click', () => this._verAlistamiento(
        filas.find((x) => String(x.id) === b.dataset.verAlist)));
    });
  },

  _pintarMantenimientos() {
    const filas = this._filtrados(this._mantenimientos || [],
      ['placa', 'responsable_nombre', 'responsable_num_id', 'detalle_libre']);

    document.getElementById('mt-contador').textContent =
      `${filas.length} mantenimiento(s)` + (filas.length !== (this._mantenimientos || []).length
        ? ` de ${(this._mantenimientos || []).length}` : '');

    const tbody = document.getElementById('mt-tbody-mant');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-note">Sin mantenimientos en este período.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((m) => `
      <tr>
        <td>${mtFecha(m.fecha)}</td>
        <td>${mtHora(m.hora)}</td>
        <td><strong>${mtEsc(m.placa)}</strong></td>
        <td><span class="tag ${m.tipo === 2 ? 'pendiente' : 'activo'}">${MT_TIPO[m.tipo] || m.tipo}</span></td>
        <td>${mtEsc(m.responsable_nombre || '—')}<br><span class="muted">CC ${mtEsc(m.responsable_num_id || '—')}</span></td>
        <td>${m.kilometraje != null ? Number(m.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td><button type="button" class="btn-secondary" data-ver-mant="${m.id}">Ver</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-ver-mant]').forEach((b) => {
      b.addEventListener('click', () => this._verMantenimiento(
        filas.find((x) => String(x.id) === b.dataset.verMant)));
    });
  },

  _pintarPreoperacionales() {
    const estado = document.getElementById('mt-estado').value;
    const ruta = document.getElementById('mt-ruta').value;
    let filas = this._filtrados(this._preoperacionales || [],
      ['placa', 'ruta', 'interno', 'conductor_nombre', 'conductor_cedula']);
    if (estado) filas = filas.filter((p) => p.estado_general === estado);
    if (ruta) filas = filas.filter((p) => mtOperacion(p.ruta) === ruta);

    const total = (this._preoperacionales || []).length;
    document.getElementById('mt-contador').textContent =
      `${filas.length} preoperacional(es)` + (filas.length !== total ? ` de ${total}` : '');

    const tbody = document.getElementById('mt-tbody-preop');
    if (!filas.length) {
      // Si la consulta falló (permiso no abierto todavía), decirlo: una tabla
      // vacía haría pensar que no hay checklists, que es muy distinto.
      const msg = this._errorPreop
        ? mtMensajeError(this._errorPreop)
        : 'Sin preoperacionales en este período.';
      tbody.innerHTML = `<tr><td colspan="7" class="empty-note">${mtEsc(msg)}</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map((p) => {
      const est = MT_PREOP_ESTADO[p.estado_general] || { texto: p.estado_general, clase: 'pendiente' };
      return `
      <tr>
        <td>${mtFecha(p.fecha)}</td>
        <td>${mtEsc(p.ruta || '—')}</td>
        <td><strong>${mtEsc(p.placa)}</strong>${p.interno ? `<br><span class="muted">Interno ${mtEsc(p.interno)}</span>` : ''}</td>
        <td>${mtEsc(p.conductor_nombre || '—')}<br><span class="muted">CC ${mtEsc(p.conductor_cedula || '—')}</span></td>
        <td>${p.kilometraje != null ? Number(p.kilometraje).toLocaleString('es-CO') : '—'}</td>
        <td>${mtEsc(p.combustible || '—')}</td>
        <td><span class="tag ${est.clase}">${est.texto}</span>
          <button type="button" class="btn-secondary" data-ver-preop="${p.id}">Ver</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-ver-preop]').forEach((b) => {
      b.addEventListener('click', () => this._verPreoperacional(
        filas.find((x) => String(x.id) === b.dataset.verPreop)));
    });
  },

  // Todo el checklist está en columnas de la misma fila, así que no hace
  // falta una segunda consulta: se abre al instante.
  _verPreoperacional(p) {
    if (!p) return;
    const est = MT_PREOP_ESTADO[p.estado_general] || { texto: p.estado_general, clase: 'pendiente' };
    const items = MT_PREOP_ETIQUETAS
      .map(([campo, etiqueta]) => ({ campo, etiqueta, valor: p[campo], nivel: mtPreopNivel(campo, p[campo]) }))
      .filter((x) => x.valor)
      // Lo grave primero: es a lo que hay que reaccionar.
      .sort((a, b) => b.nivel - a.nivel);
    const clasePorNivel = ['activo', 'pendiente', 'novedad'];
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Preoperacional ${mtEsc(p.placa)} · ${mtFecha(p.fecha)}</h3>
        <p class="muted">Ruta ${mtEsc(p.ruta || '—')}${p.interno ? ` · Interno ${mtEsc(p.interno)}` : ''}<br>
        Conductor: ${mtEsc(p.conductor_nombre || '—')} (CC ${mtEsc(p.conductor_cedula || '—')})<br>
        ${p.kilometraje != null ? `${Number(p.kilometraje).toLocaleString('es-CO')} km · ` : ''}Combustible: ${mtEsc(p.combustible || '—')}
        ${p.created_at ? `<br>Registrado: ${new Date(p.created_at).toLocaleString('es-CO')}` : ''}</p>
        <p><span class="tag ${est.clase}">${est.texto}</span></p>
        ${p.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(p.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Checklist</h3>
        <div class="detalle-list">${items.map((x) => `
          <div class="detalle-list-item">
            <span class="lc-item-texto">
              <span class="detalle-list-item-main">${mtEsc(x.etiqueta)}</span>
            </span>
            <span class="tag ${clasePorNivel[x.nivel]}">${mtEsc(x.valor)}</span>
          </div>`).join('')}</div>
      </div>`);
  },

  _nombreActividad(id) {
    return this._catalogoPorId?.[id]?.descripcion || `Actividad ${id}`;
  },

  _abrirModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
  },

  async _verAlistamiento(a) {
    if (!a) return;
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Alistamiento ${mtEsc(a.placa)} · ${mtFecha(a.fecha)}</h3>
        <p class="muted">Conductor: ${mtEsc(a.conductor_nombre || '—')} (CC ${mtEsc(a.conductor_num_id || '—')})<br>
        Responsable del proceso: ${mtEsc(a.responsable_nombre || '—')}<br>
        Registrado: ${a.registrado_en ? new Date(a.registrado_en).toLocaleString('es-CO') : '—'}${a.kilometraje != null ? ` · ${Number(a.kilometraje).toLocaleString('es-CO')} km` : ''}</p>
        ${a.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(a.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Checklist</h3>
        <div id="mt-detalle-actividades"><p class="muted">Cargando…</p></div>
      </div>`);
    try {
      const actividades = await DB.getActividadesAlistamiento(a.id);
      const caja = document.getElementById('mt-detalle-actividades');
      if (!caja) return;                       // se cerró mientras llegaba
      if (!actividades.length) {
        caja.innerHTML = '<p class="muted">Este alistamiento no tiene actividades registradas.</p>';
        return;
      }
      // Las no conformes primero: son la razón de abrir la ficha.
      const orden = [...actividades].sort((x, y) => Number(x.conforme) - Number(y.conforme));
      caja.innerHTML = `<div class="detalle-list">${orden.map((x) => `
        <div class="detalle-list-item">
          <span class="lc-item-texto">
            <span class="detalle-list-item-main">${mtEsc(this._nombreActividad(x.actividad_id))}</span>
            ${x.observacion ? `<span class="detalle-list-item-sub">${mtEsc(x.observacion)}</span>` : ''}
          </span>
          <span class="tag ${x.conforme ? 'activo' : 'novedad'}">${x.conforme ? 'Conforme' : 'No conforme'}</span>
        </div>`).join('')}</div>`;
    } catch (err) {
      const caja = document.getElementById('mt-detalle-actividades');
      if (caja) caja.innerHTML = `<p class="muted">${mtEsc(mtMensajeError(err))}</p>`;
    }
  },

  async _verMantenimiento(m) {
    if (!m) return;
    this._abrirModal(`
      <div class="modal-section">
        <h3 class="modal-section-title">Mantenimiento ${mtEsc(m.placa)} · ${mtFecha(m.fecha)} ${mtHora(m.hora)}</h3>
        <p class="muted">${MT_TIPO[m.tipo] || m.tipo} · Responsable: ${mtEsc(m.responsable_nombre || '—')} (CC ${mtEsc(m.responsable_num_id || '—')})${m.kilometraje != null ? ` · ${Number(m.kilometraje).toLocaleString('es-CO')} km` : ''}</p>
        ${m.detalle_libre ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(m.detalle_libre)}</p>` : ''}
        ${m.observaciones ? `<p class="prose-p" style="white-space:pre-wrap">${mtEsc(m.observaciones)}</p>` : ''}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Actividades</h3>
        <div id="mt-detalle-actividades"><p class="muted">Cargando…</p></div>
      </div>`);
    try {
      const actividades = await DB.getActividadesMantenimiento(m.id);
      const caja = document.getElementById('mt-detalle-actividades');
      if (!caja) return;
      if (!actividades.length) {
        caja.innerHTML = '<p class="muted">Sin actividades del catálogo; mira el detalle de arriba.</p>';
        return;
      }
      caja.innerHTML = `<div class="detalle-list">${actividades.map((x) => `
        <div class="detalle-list-item">
          <span class="lc-item-texto">
            <span class="detalle-list-item-main">${mtEsc(this._nombreActividad(x.actividad_id))}</span>
            ${x.observacion ? `<span class="detalle-list-item-sub">${mtEsc(x.observacion)}</span>` : ''}
          </span>
        </div>`).join('')}</div>`;
    } catch (err) {
      const caja = document.getElementById('mt-detalle-actividades');
      if (caja) caja.innerHTML = `<p class="muted">${mtEsc(mtMensajeError(err))}</p>`;
    }
  },
});
