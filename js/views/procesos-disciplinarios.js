// Procesos disciplinarios: citación a descargos → diligencia de descargos →
// decisión. Reemplaza al programa aparte "Procesos Disciplinarios", que vivía
// en el mismo Supabase pero guardaba el proceso entero en una columna jsonb y
// sacaba los empleados de un Google Sheet publicado.
//
// Los documentos los arma js/documentos-disciplinarios.js (window.PD_DOCS),
// portado literal de ese programa: el texto es jurídico y ya se usó en
// procesos reales. Acá solo cambia de dónde salen los datos.
//
// Ver sql/procesos_disciplinarios_2026-10-01.sql.

const PD_ESTADOS = {
  citacion: { label: 'Citación a descargos', tag: 'pendiente' },
  descargos: { label: 'Descargos rendidos', tag: 'pendiente' },
  decision: { label: 'Con decisión', tag: 'completo' },
  finalizado: { label: 'Finalizado', tag: 'completo' },
  cancelado: { label: 'Cancelado', tag: 'descartado' },
};

const PD_DECISIONES = [
  { valor: 'invitacion', label: 'Invitación al mejoramiento' },
  { valor: 'llamado', label: 'Llamado de atención escrito' },
  { valor: 'suspension', label: 'Suspensión disciplinaria' },
  { valor: 'terminacion', label: 'Terminación del contrato por justa causa' },
];

// Datos fijos del membrete. En el programa viejo vivían en una tabla de
// configuración editable; acá son constantes porque en año y medio de uso
// nunca cambiaron, y quien firma sí se resuelve en vivo (ver _firmante).
const PD_EMPRESA = 'COMPAÑÍA METROPOLITANA DE BUSES S.A. (COMBUSES S.A.)';
const PD_CIUDAD = 'Medellín';
const PD_CARGO_FIRMA = 'Coordinación de Procesos Disciplinarios';

function pdFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('es-CO');
}

function pdHora(v) {
  return v ? String(v).slice(0, 5) : '';
}

function pdEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pdMensajeError(err) {
  const texto = err?.message || '';
  if (/row-level security|violates row/i.test(texto)) {
    return 'Tu cuenta no tiene permiso para esta acción en Procesos disciplinarios. Pídele a Gestión Humana que te lo habilite en Usuarios.';
  }
  return texto || 'Error desconocido.';
}

/* ---- La escala del Art. 108 del RIT -------------------------------------
   El catálogo escribe la escala en palabras ("Llamado de atención por
   escrito", "Suspensión de 8 días", "Falta grave y justa causa..."). Para
   poder contrastarla con la decisión que eligió Gestión Humana hay que
   traducirla a los mismos valores que guarda tipo_decision.
-------------------------------------------------------------------------- */

// De menos a más grave. Sirve para decir si la sanción elegida se pasa o se
// queda corta frente a lo que prevé el reglamento.
const PD_GRAVEDAD = { invitacion: 0, llamado: 1, suspension: 2, terminacion: 3 };

function pdNorm(v) {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pdDecisionDeEscala(texto) {
  const t = pdNorm(texto).trim();
  if (!t) return null;
  if (t.includes('justa causa') || t.includes('falta grave')) return { tipo: 'terminacion', dias: null };
  if (t.includes('suspension')) {
    const m = t.match(/(\d+)/);
    return { tipo: 'suspension', dias: m ? Number(m[1]) : null };
  }
  if (t.includes('llamado')) return { tipo: 'llamado', dias: null };
  return null;
}

// Número de la falta dentro del Art. 108. `falta` se guarda como texto
// ("12. No reportar las novedades…") porque así venía del programa anterior.
function pdNumeroFalta(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*[.\-)]/);
  if (m) return Number(m[1]);
  const porTexto = (window.CATALOGO_FALTAS || []).find((f) => pdNorm(f.d) === pdNorm(t));
  return porTexto ? porTexto.n : null;
}

// La escala que le aplica a ESTE proceso.
//
// Se prefiere la copia que se guardó al crearlo (sancion_primera..cuarta):
// es la que estaba vigente ese día, y el RIT puede cambiar. Solo si no hay
// copia -- los 443 procesos importados no la traen -- se va al catálogo.
function pdEscalaDe(p) {
  const copia = [p.sancion_primera, p.sancion_segunda, p.sancion_tercera, p.sancion_cuarta];
  if (copia.some((s) => s && String(s).trim())) return copia.map((s) => s || '');
  const falta = (window.CATALOGO_FALTAS || []).find((f) => f.n === pdNumeroFalta(p.falta));
  return falta ? falta.s.slice() : null;
}

// Qué vez le corresponde a esta persona POR ESTA MISMA FALTA.
//
// La escala del Art. 108 va por falta, no por total de procesos: alguien con
// tres procesos de faltas distintas que comete la falta 1 por primera vez va
// por primera vez -- llamado de atención -- y no por tercera con suspensión
// de 8 días. Contar el total es lo que produce una sanción mal escalada.
//
// Solo cuentan los ANTERIORES por fecha de citación: un proceso no se escala
// a sí mismo ni con lo que vino después.
//
// `sinClasificar` no es un detalle de adorno: 386 de los 443 procesos
// importados no dicen en qué falta se fundaron, así que el conteo puede
// quedarse corto. Decirlo en voz alta es lo que evita aplicar una primera
// vez donde en realidad iba una tercera.
function pdVezPorFalta(p, todos) {
  const cedula = p.empleado_cedula;
  if (!cedula) return null;
  const n = pdNumeroFalta(p.falta);
  const otros = (todos || []).filter((x) => x.empleado_cedula === cedula
    && x.id !== p.id
    && (!p.fecha_citacion || !x.fecha_citacion || x.fecha_citacion < p.fecha_citacion));
  const mismos = n ? otros.filter((x) => pdNumeroFalta(x.falta) === n) : [];
  return {
    falta: n,
    vez: mismos.length + 1,
    anteriores: mismos.length,
    otros: otros.length,
    sinClasificar: otros.filter((x) => !pdNumeroFalta(x.falta)).length,
  };
}

function pdFechaISO(v) {
  const s = String(v ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  return isNaN(f.getTime()) ? null : f;
}

// Dias habiles entre dos fechas, como los cuenta el RIT: "cinco (5) dias
// habiles (entendida de lunes a viernes)" (art. 106 num. 7). NO descuenta
// festivos, porque Kardex no tiene calendario de festivos. Eso hace que el
// conteo salga por lo alto y el aviso pueda adelantarse un dia o dos; se
// prefiere avisar de mas que dejar pasar un proceso vencido.
function pdHabilesEntre(desdeIso, hastaIso) {
  const a = pdFechaISO(desdeIso);
  const b = pdFechaISO(hastaIso);
  if (!a || !b || b < a) return null;
  let n = 0;
  const d = new Date(a.getTime());
  while (d < b) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) n += 1;
  }
  return n;
}

function pdCorridosEntre(desdeIso, hastaIso) {
  const a = pdFechaISO(desdeIso);
  const b = pdFechaISO(hastaIso);
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / 86400000);
}

// Los plazos del articulo 106 del RIT. Un proceso que se sale de ellos no se
// cae en el momento: se cae despues, cuando alguien lo discute y ya no hay
// como devolverse. Por eso se avisa mientras todavia se puede hacer algo.
//
// Avisa, no bloquea: el plazo puede estar justificado (la empresa se entero
// tarde de los hechos) y el conteo de habiles no descuenta festivos.
function pdAvisosPlazos(p, hoyIso) {
  const avisos = [];
  const hechos = p.fecha_hechos || '';
  const cit = p.fecha_citacion || '';
  const desc = p.fecha_descargos || '';

  // 1. La citacion sale dentro de los 5 dias habiles siguientes a los hechos,
  //    o de los 4 siguientes a que la empresa se entere (art. 106 num. 2).
  //    Kardex no guarda la fecha de conocimiento, asi que solo se puede medir
  //    contra los hechos -- y hay que decirlo, o el aviso acusa de mas.
  if (hechos && cit) {
    if (cit < hechos) {
      avisos.push('La citación (' + cit + ') tiene fecha anterior a los hechos (' + hechos + '). Una de las dos está mal.');
    } else {
      const h = pdHabilesEntre(hechos, cit);
      if (h !== null && h > 5) {
        avisos.push('Entre los hechos y la citación pasaron ' + h + ' días hábiles. El Art. 106 del RIT da 5 hábiles desde los hechos, o 4 desde que la empresa se entera. Si la empresa se enteró después, déjalo dicho en los antecedentes.');
      }
    }
  }

  // 2. Los descargos se rinden "finalizados los (5) dias" que el trabajador
  //    tiene para allegar pruebas (art. 106 num. 2 y 3). Dias corridos: el
  //    RIT dice "habiles" cuando lo son, y en este no lo dice.
  if (cit && desc) {
    if (desc < cit) {
      avisos.push('Los descargos (' + desc + ') quedaron antes de la citación (' + cit + '). Una de las dos fechas está mal.');
    } else {
      const c = pdCorridosEntre(cit, desc);
      if (c !== null && c < 5) {
        avisos.push('Entre la citación y los descargos pasaron ' + c + ' día(s). El Art. 106 del RIT dice que los descargos se rinden finalizados los 5 días que el trabajador tiene para allegar pruebas.');
      }
    }
  }

  // 3. La decision se toma dentro de los 5 dias habiles siguientes a los
  //    descargos (art. 106 num. 7). Solo se mira mientras siga sin decidir:
  //    de una decision ya tomada no guardamos en que fecha se tomo, y acusar
  //    sin saberlo seria inventar.
  if (desc && !p.tipo_decision && hoyIso) {
    const h = pdHabilesEntre(desc, hoyIso);
    if (h !== null && h > 5) {
      avisos.push('Desde los descargos han pasado ' + h + ' días hábiles sin decisión. El Art. 106 del RIT da 5 hábiles para decidir, y pasarse debilita la inmediatez de la sanción.');
    }
  }

  return avisos;
}

Router.register('procesos-disciplinarios', {
  title: 'Procesos disciplinarios',

  _editandoId: null,

  async onEnter() {
    if (!this._bound) {
      document.getElementById('pd-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('pd-falta').addEventListener('change', () => this._pintarEscala());
      // La fecha de citación decide qué procesos cuentan como anteriores.
      document.getElementById('pd-fecha-citacion').addEventListener('change', () => this._pintarEscala());
      document.getElementById('pd-articulo').addEventListener('change', () => this._agregarArticulo());
      document.getElementById('pd-cancelar-edicion').addEventListener('click', () => this._salirDeEdicion());
      document.getElementById('pd-search').addEventListener('input', () => this._render());
      ['pd-filtro-estado', 'pd-filtro-desde', 'pd-filtro-hasta'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => this._render());
      });
      document.getElementById('pd-filtros-limpiar').addEventListener('click', () => this._limpiarFiltros());
      document.getElementById('pd-importar').addEventListener('click', () => this._importar());
      this._llenarCatalogos();
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [procesos, empleados] = await Promise.all([
      DB.getProcesosDisciplinarios(),
      DB.getEmployees({ onlyActive: true }),
    ]);
    this._procesos = procesos;
    this._empleados = empleados;
    this._setupCombobox();
    this._pintarStats();
    this._render();
  },

  // ---- Catálogos del Reglamento Interno ---------------------------------

  _llenarCatalogos() {
    const faltas = window.CATALOGO_FALTAS || [];
    document.getElementById('pd-falta').innerHTML =
      '<option value="">Sin clasificar todavía…</option>'
      + faltas.map((f) => `<option value="${f.n}">${f.n}. ${pdEsc(f.d)}</option>`).join('');

    const articulos = window.CATALOGO_ARTICULOS || [];
    document.getElementById('pd-articulo').innerHTML =
      '<option value="">Insertar un artículo del RIT…</option>'
      + articulos.map((a) => `<option value="${a.id}">${pdEsc(a.titulo)}</option>`).join('');

    // OJO: el select de tipo de decisión NO se llena acá. Vive dentro del
    // modal de detalle (_bloquePasos), que no existe hasta que se abre una
    // ficha -- buscarlo al arrancar tiraba onEnter antes de cargar los datos.
  },

  // La escala de la falta (1ª, 2ª, 3ª, 4ª vez) se muestra al elegirla: es lo
  // que le dice a Gestión Humana qué sanción corresponde según cuántas veces
  // lleva la persona, que es la decisión difícil de este proceso.
  _pintarEscala() {
    const n = Number(document.getElementById('pd-falta').value);
    const caja = document.getElementById('pd-escala');
    const falta = (window.CATALOGO_FALTAS || []).find((f) => f.n === n);
    if (!falta) {
      caja.classList.add('hidden');
      caja.innerHTML = '';
      return;
    }

    // Cuál de las cuatro columnas le toca a ESTA persona por ESTA falta.
    // Antes la pantalla mostraba las cuatro y el total de procesos por
    // separado, y dejaba que quien decide las juntara de cabeza. Juntarlas
    // mal es escalar de más, que es lo que después se discute en un juzgado.
    const emp = this._empleadoElegido;
    const conteo = emp ? pdVezPorFalta({
      empleado_cedula: emp.cedula,
      falta: `${falta.n}. ${falta.d}`,
      // Al corregir un proceso ya guardado hay que excluirlo: si no, se
      // cuenta a sí mismo como antecedente y se escala una vez de más.
      id: this._editandoId,
      // La fecha de citación que se esté escribiendo. Sin ella cuentan
      // todos los que ya existen, que es el lado prudente del error: de los
      // dos, quedarse corto es el que deja una falta sin escalar.
      fecha_citacion: (document.getElementById('pd-fecha-citacion') || {}).value || null,
    }, this._procesos) : null;

    const disponibles = falta.s.filter((s) => s && String(s).trim()).length;
    const agotada = !!conteo && conteo.vez > disponibles;
    const vez = conteo && !agotada ? conteo.vez : 0;

    const veces = ['Primera vez', 'Segunda vez', 'Tercera vez', 'Cuarta vez'];
    const filas = falta.s
      .map((s, i) => (s
        ? `<div class="detalle-fact${i + 1 === vez ? ' pd-vez-actual' : ''}">`
          + `<div class="detalle-fact-value">${pdEsc(s)}</div>`
          + `<div class="detalle-fact-label">${veces[i]}${i + 1 === vez ? ' · le corresponde' : ''}</div></div>`
        : ''))
      .join('');

    let nota;
    let alarma = false;
    if (!emp) {
      nota = 'Elige primero a la persona y te digo qué vez le corresponde por esta falta.';
    } else if (agotada) {
      nota = `Esta persona ya tiene ${conteo.anteriores} proceso(s) por esta misma falta: la escala del Art. 108 no prevé otra vez más.`;
      alarma = true;
    } else {
      nota = conteo.anteriores
        ? `Tiene ${conteo.anteriores} proceso(s) anterior(es) por esta misma falta, así que le corresponde la ${veces[vez - 1].toLowerCase()}.`
        : 'No tiene procesos anteriores por esta misma falta: le corresponde la primera vez.';
      if (conteo.otros - conteo.anteriores > 0) {
        nota += ` Tiene ${conteo.otros - conteo.anteriores} proceso(s) por otras faltas, que no cuentan para esta escala.`;
      }
      if (conteo.sinClasificar) {
        nota += ` OJO: hay ${conteo.sinClasificar} proceso(s) suyo(s) sin clasificar, así que podría corresponderle una vez más alta.`;
        alarma = true;
      }
    }

    caja.innerHTML = `
      <p class="muted" style="margin:0 0 0.4rem">Escala del Art. 108 del RIT para esta falta.</p>
      <div class="detalle-facts">${filas}</div>
      <p class="${alarma ? 'form-msg error' : 'muted'}" style="margin:0.4rem 0 0">${pdEsc(nota)}</p>`;
    caja.classList.remove('hidden');
  },

  // Los artículos se van sumando al campo de normas en vez de reemplazarlo:
  // una citación normalmente cita varios.
  _agregarArticulo() {
    const sel = document.getElementById('pd-articulo');
    const art = (window.CATALOGO_ARTICULOS || []).find((a) => a.id === sel.value);
    sel.value = '';
    if (!art) return;
    const campo = document.getElementById('pd-normas');
    if (campo.value.includes(art.texto)) return;
    campo.value = campo.value.trim() ? `${campo.value.trim()}\n\n${art.texto}` : art.texto;
  },

  // ---- Buscador de empleado ---------------------------------------------

  _setupCombobox() {
    const search = document.getElementById('pd-empleado-input');
    const hidden = document.getElementById('pd-empleado-id');
    const list = document.getElementById('pd-empleado-list');
    const MAX = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._empleados.filter((e) => e.nombre.toLowerCase().includes(q) || (e.cedula || '').includes(q))
        : this._empleados;
      list.innerHTML = matches.length === 0
        ? '<li class="combobox-empty">Sin resultados.</li>'
        : matches.slice(0, MAX).map((e) => `<li data-id="${e.id}">${pdEsc(e.nombre)} <span class="combobox-cedula">· CC ${pdEsc(e.cedula)}</span></li>`).join('')
          + (matches.length > MAX ? `<li class="combobox-empty">Y ${matches.length - MAX} más… sigue escribiendo.</li>` : '');
      list.classList.remove('hidden');
    };

    if (search.dataset.comboboxBound) return;
    search.dataset.comboboxBound = '1';
    search.addEventListener('focus', () => { search.select(); renderLista(search.value); });
    search.addEventListener('input', () => { hidden.value = ''; this._pintarDatosEmpleado(null); renderLista(search.value); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const primero = list.querySelector('li[data-id]');
      if (primero) primero.click();
    });
    search.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const empleado = this._empleados.find((emp) => emp.id === li.dataset.id);
      if (!empleado) return;
      hidden.value = empleado.id;
      search.value = `${empleado.nombre} — CC ${empleado.cedula}`;
      list.classList.add('hidden');
      this._pintarDatosEmpleado(empleado);
    });
  },

  _pintarDatosEmpleado(empleado) {
    const caja = document.getElementById('pd-datos-empleado');
    // Se guarda para que la escala del Art. 108 pueda decir qué vez le
    // corresponde: hace falta saber la persona Y la falta a la vez, y cada
    // una se elige en un campo distinto.
    this._empleadoElegido = empleado || null;
    this._pintarEscala();
    if (!empleado) {
      caja.classList.add('hidden');
      caja.innerHTML = '';
      return;
    }
    const previos = (this._procesos || []).filter((p) => p.empleado_cedula === empleado.cedula);
    const fichas = [
      ['Nombre', empleado.nombre],
      ['Cédula', empleado.cedula],
      ['Cargo', empleado.cargo || '—'],
      ['Área', empleado.area || '—'],
      ['Interno', empleado.numero_interno || '—'],
      ['Ruta', empleado.ruta || '—'],
    ].map(([l, v]) => `<div class="detalle-fact"><div class="detalle-fact-value">${pdEsc(v)}</div><div class="detalle-fact-label">${l}</div></div>`).join('');
    caja.innerHTML = `
      <div class="detalle-facts">${fichas}</div>
      <p class="muted" style="margin:0.4rem 0 0">
        ${previos.length
          ? `Tiene ${previos.length} proceso(s) disciplinario(s) en total. El total NO decide la sanción:`
            + ' la escala del Art. 108 va por falta, y abajo se dice cuántos hay por la que elijas.'
          : 'Sin procesos disciplinarios anteriores.'}
      </p>`;
    caja.classList.remove('hidden');
  },

  // ---- KPIs, filtros y listado ------------------------------------------

  _pintarStats() {
    const procesos = this._procesos || [];
    const mes = new Date().toISOString().slice(0, 7);
    const porPersona = new Map();
    procesos.forEach((p) => porPersona.set(p.empleado_cedula, (porPersona.get(p.empleado_cedula) || 0) + 1));

    document.getElementById('pd-stat-total').textContent = procesos.length;
    document.getElementById('pd-stat-abiertos').textContent =
      procesos.filter((p) => p.estado !== 'finalizado' && p.estado !== 'cancelado').length;
    document.getElementById('pd-stat-mes').textContent =
      procesos.filter((p) => (p.fecha_citacion || '').slice(0, 7) === mes).length;
    document.getElementById('pd-stat-reincidentes').textContent =
      [...porPersona.values()].filter((n) => n >= 2).length;
  },

  _limpiarFiltros() {
    document.getElementById('pd-search').value = '';
    document.getElementById('pd-filtro-estado').value = '';
    document.getElementById('pd-filtro-desde').value = '';
    document.getElementById('pd-filtro-hasta').value = '';
    this._render();
  },

  _iniciales(nombre) {
    const partes = (nombre || '').trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
  },

  _render() {
    const q = document.getElementById('pd-search').value.trim().toLowerCase();
    const estado = document.getElementById('pd-filtro-estado').value;
    const desde = document.getElementById('pd-filtro-desde').value;
    const hasta = document.getElementById('pd-filtro-hasta').value;

    let filtrados = this._procesos || [];
    if (estado) filtrados = filtrados.filter((p) => p.estado === estado);
    if (desde) filtrados = filtrados.filter((p) => (p.fecha_citacion || '') >= desde);
    if (hasta) filtrados = filtrados.filter((p) => (p.fecha_citacion || '') <= hasta);
    if (q) {
      filtrados = filtrados.filter((p) =>
        (p.empleado_nombre || '').toLowerCase().includes(q)
        || (p.empleado_cedula || '').includes(q)
        || (p.motivo || '').toLowerCase().includes(q));
    }

    const total = (this._procesos || []).length;
    document.getElementById('pd-contador').textContent =
      filtrados.length === total ? `${total} proceso(s)` : `Mostrando ${filtrados.length} de ${total} proceso(s)`;

    const conteo = new Map();
    (this._procesos || []).forEach((p) => conteo.set(p.empleado_cedula, (conteo.get(p.empleado_cedula) || 0) + 1));

    const lista = document.getElementById('pd-lista');
    if (filtrados.length === 0) {
      lista.innerHTML = total === 0
        ? '<p class="empty-note">Todavía no hay procesos. Si vienes del programa anterior, usa “Traer los procesos del programa anterior”.</p>'
        : '<p class="empty-note">Sin resultados con estos filtros.</p>';
      return;
    }

    lista.innerHTML = filtrados.map((p) => {
      const est = PD_ESTADOS[p.estado] || PD_ESTADOS.citacion;
      const n = conteo.get(p.empleado_cedula) || 1;
      const meta = [
        `Citación: ${pdFecha(p.fecha_citacion)}`,
        p.falta ? pdEsc(p.falta) : null,
        (p.pruebas || []).length ? `${p.pruebas.length} prueba(s)` : null,
      ].filter(Boolean).join(' · ');
      return `
        <div class="person-row">
          <span class="person-avatar">${this._iniciales(p.empleado_nombre)}</span>
          <div class="person-info">
            <div class="person-name">${pdEsc(p.empleado_nombre || 'Sin nombre')}</div>
            <div class="person-meta"><span>${meta}</span></div>
          </div>
          ${n >= 2 ? `<span class="tag pendiente">${n} procesos</span>` : ''}
          <span class="tag ${est.tag}">${est.label}</span>
          <button type="button" class="btn-secondary" data-detalle="${p.id}">Ver detalle</button>
        </div>`;
    }).join('');

    lista.querySelectorAll('[data-detalle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._abrirDetalle(btn.dataset.detalle);
      });
    });
  },

  // ---- Detalle y pasos ---------------------------------------------------

  // El listado viene sin los campos largos (acta de descargos, normas,
  // consideraciones…). Al abrir una ficha se pide el proceso completo: es
  // una fila, se trae en nada, y evita que el listado cargue 435 actas que
  // nadie va a leer.
  async _abrirDetalle(id) {
    Loading.show('Abriendo…');
    try {
      this._verDetalle(await DB.getProcesoDisciplinario(id));
    } catch (err) {
      alert('No se pudo abrir el proceso: ' + pdMensajeError(err));
    } finally {
      Loading.hide();
    }
  },

  _verDetalle(p) {
    const est = PD_ESTADOS[p.estado] || PD_ESTADOS.citacion;
    const pruebas = p.pruebas || [];
    const previos = (this._procesos || []).filter(
      (x) => x.empleado_cedula === p.empleado_cedula && x.id !== p.id);

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <span class="person-avatar detalle-avatar">${this._iniciales(p.empleado_nombre)}</span>
        <div class="detalle-header-info">
          <div class="detalle-nombre">${pdEsc(p.empleado_nombre || 'Sin nombre')}</div>
          <div class="detalle-sub">CC ${pdEsc(p.empleado_cedula)} · ${pdEsc(p.empleado_cargo || 'Sin cargo')}${p.empleado_interno ? ` · Interno ${pdEsc(p.empleado_interno)}` : ''}</div>
        </div>
        <div class="detalle-tags"><span class="tag ${est.tag}">${est.label}</span></div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value">${pdFecha(p.fecha_hechos)}</div><div class="detalle-fact-label">Hechos</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${pdFecha(p.fecha_citacion)} ${pdHora(p.hora_citacion)}</div><div class="detalle-fact-label">Citación</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${p.asistencia === 'si' ? 'Asistió' : p.asistencia === 'no' ? 'No asistió' : '—'}</div><div class="detalle-fact-label">Descargos</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value">${pdEsc(PD_DECISIONES.find((d) => d.valor === p.tipo_decision)?.label || '—')}</div><div class="detalle-fact-label">Decisión</div></div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Hechos</h3>
        <p class="prose-p" style="white-space:pre-wrap">${pdEsc(p.motivo || 'Sin describir.')}</p>
        ${p.falta ? `<p class="muted">Falta: ${pdEsc(p.falta)}</p>` : ''}
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Documentos</h3>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap">
          <button type="button" class="btn-secondary" data-doc="citacion">Citación a descargos</button>
          <button type="button" class="btn-secondary" data-doc="acta">${p.asistencia === 'no' ? 'Acta de no comparecencia' : 'Diligencia de descargos'}</button>
          <button type="button" class="btn-secondary" data-doc="sancion"${p.tipo_decision ? '' : ' disabled title="Registra primero la decisión"'}>Decisión / sanción</button>
        </div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Pruebas</h3>
        ${p.pruebas_texto ? `<p class="prose-p" style="white-space:pre-wrap">${pdEsc(p.pruebas_texto)}</p>` : ''}
        ${pruebas.length
          ? `<div class="detalle-list">${pruebas.map((a) => `
              <div class="detalle-list-item">
                <span class="lc-item-texto">${pdEsc(a.archivo_nombre || a.archivo_url)}</span>
                <button type="button" class="btn-secondary" data-prueba="${a.archivo_url}">Ver</button>
                <button type="button" class="btn-secondary" data-borrar-prueba="${a.id}" style="color:var(--danger-text)">Quitar</button>
              </div>`).join('')}</div>`
          : '<p class="muted">Sin archivos adjuntos.</p>'}
        <div class="foto-picker-row" style="margin-top:0.5rem">
          <label class="file-picker" for="pd-prueba-input">
            <svg viewBox="0 0 20 20" fill="none"><path d="M5 2.5h7l3 3V17a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8.5v5M7.5 11h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>Adjuntar prueba (foto, video o PDF)</span>
          </label>
          <input type="file" id="pd-prueba-input" accept=".pdf,image/*,video/*" multiple class="hidden" />
        </div>
      </div>

      <!-- Es la sección misma, no un envoltorio: el margen entre secciones
           sale de '.modal-section + .modal-section' y un div de por medio
           rompe esa adyacencia. -->
      <div id="pd-anexos-origen" class="modal-section hidden"></div>

      ${this._bloquePasos(p)}

      ${previos.length ? `
        <div class="modal-section">
          <h3 class="modal-section-title">Otros procesos de esta persona (${previos.length})</h3>
          <div class="detalle-list">${previos.map((x) => `
            <div class="detalle-list-item">
              <span class="lc-item-texto">
                <span class="detalle-list-item-main">${pdFecha(x.fecha_citacion)} — ${pdEsc(PD_ESTADOS[x.estado]?.label || x.estado)}</span>
                <span class="detalle-list-item-sub">${pdEsc((x.motivo || '').slice(0, 110))}</span>
              </span>
            </div>`).join('')}</div>
        </div>` : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">Acciones</h3>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap">
          <button type="button" class="btn-secondary" id="pd-editar">Editar el proceso</button>
          <button type="button" class="btn-secondary" id="pd-borrar" style="color:var(--danger-text)">Eliminar</button>
        </div>
        <p id="pd-detalle-msg" class="form-msg"></p>
      </div>
    `;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.querySelectorAll('[data-doc]').forEach((b) => {
      b.addEventListener('click', () => this._generarDocumento(p, b.dataset.doc));
    });
    document.querySelectorAll('[data-prueba]').forEach((b) => {
      b.addEventListener('click', () => this._verPrueba(b.dataset.prueba));
    });
    document.querySelectorAll('[data-borrar-prueba]').forEach((b) => {
      b.addEventListener('click', () => this._borrarPrueba(p, b.dataset.borrarPrueba));
    });
    document.getElementById('pd-prueba-input').addEventListener('change', (e) => this._subirPruebas(p, e.target.files));
    document.getElementById('pd-editar').addEventListener('click', () => this._editar(p));
    document.getElementById('pd-borrar').addEventListener('click', () => this._borrar(p));
    document.getElementById('pd-paso-descargos').addEventListener('submit', (e) => this._guardarDescargos(e, p));
    document.getElementById('pd-paso-decision').addEventListener('submit', (e) => this._guardarDecision(e, p));
    document.getElementById('pd-decision-tipo').addEventListener('change', () => {
      this._toggleSuspension();
      this._avisarEscala(p);
    });
    document.getElementById('pd-dias').addEventListener('input', () => this._avisarEscala(p));
    // Y una vez al abrir la ficha: si la decisión ya estaba guardada fuera
    // de la escala, hay que verlo sin tener que tocar nada.
    this._avisarEscala(p);
    this._toggleSuspension();
    this._cargarAnexosOrigen(p);
  },

  // Archivos que la hoja menciona pero que no se pudieron traer: viven en el
  // Drive del programa anterior y el CSV solo da el nombre, no un enlace. Se
  // muestran igual, porque saber que existe un video de la prueba (y cómo se
  // llama) es lo que permite ir a buscarlo. Cuando se suba al ERP queda como
  // prueba normal, acá arriba.
  _ANEXOS_ORIGEN: [
    ['firma_citacion', 'Firma de la citación'],
    ['firma_sancion', 'Firma de la sanción'],
    ['pruebas', 'Prueba'],
    ['pruebas_videos', 'Prueba en video'],
    ['archivos_finales', 'Documento final firmado'],
  ],

  // La fila cruda no viaja con la lista (pesa), así que se pide al abrir la
  // ficha y el bloque se pinta después. Si falla, no se dice nada: es
  // información de apoyo, no vale romper la ficha por ella.
  async _cargarAnexosOrigen(p) {
    const caja = document.getElementById('pd-anexos-origen');
    if (!caja || !p.origen_key) return;
    let origen = p.origen_fila;
    if (!origen) {
      try {
        origen = await DB.getOrigenProceso(p.id);
      } catch (err) {
        return;
      }
      p.origen_fila = origen;
    }
    if (!origen) return;
    const items = this._ANEXOS_ORIGEN
      .map(([clave, etiqueta]) => [etiqueta, String(origen[clave] || '').trim()])
      .filter(([, valor]) => valor);
    if (!items.length) return;
    // La ficha pudo cerrarse mientras llegaba la respuesta.
    if (!document.body.contains(caja)) return;
    caja.innerHTML = `
      <h3 class="modal-section-title">Archivos del programa anterior (${items.length})</h3>
      <p class="muted">Están en el Drive del programa anterior; la hoja solo trae el nombre. Para tenerlos acá, súbelos como prueba.</p>
      <div class="detalle-list">${items.map(([etiqueta, valor]) => `
        <div class="detalle-list-item">
          <span class="lc-item-texto">
            <span class="detalle-list-item-main">${pdEsc(etiqueta)}</span>
            <span class="detalle-list-item-sub">${pdEsc(valor.split('/').pop())}</span>
          </span>
        </div>`).join('')}</div>`;
    caja.classList.remove('hidden');
  },

  // Los dos pasos que siguen a la citación, como formularios dentro del
  // detalle: así se avanza el proceso sin salir de la ficha.
  _bloquePasos(p) {
    const sel = (valor, opciones) => opciones
      .map((o) => `<option value="${o.v}"${valor === o.v ? ' selected' : ''}>${o.t}</option>`).join('');

    // El número de la falta ES el numeral del Art. 108 en que se funda la
    // sanción: no hay por qué volver a escribirlo a mano. Se propone, no se
    // impone -- una sanción puede fundarse en más de un numeral.
    const nFalta = pdNumeroFalta(p.falta);
    const numerales = p.numerales_sancion
      || (nFalta ? `numeral ${nFalta} del artículo 108 del Reglamento Interno de Trabajo` : '');

    // Los días de suspensión llegaban de la hoja como texto libre y vienen
    // hechos un desorden: 394 dicen "1 días", otros "Dos", "2", "3 días", y
    // uno dice "-23 días". El campo pasa a ser un número para no repetir el
    // problema, pero lo que trajo la hoja no se tira: si no se puede leer
    // como número se muestra aparte, porque es lo único que queda de lo que
    // se decidió ese día.
    const diasCrudo = String(p.dias_suspension ?? '').trim();
    const diasNum = Number((diasCrudo.match(/-?\d+/) || [])[0]);
    const diasOk = Number.isFinite(diasNum) && diasNum > 0 ? String(diasNum) : '';
    // Dos cosas distintas: que lo de la hoja no se parezca a lo que queda en
    // el campo ("1 días" -> 1), y que no se pueda leer en absoluto ("Dos",
    // "-23 días"). La primera es un dato de contexto; la segunda hay que
    // arreglarla antes de emitir la sanción, y decir "no se puede leer"
    // cuando sí se pudo sería mentir.
    const diasRaro = !!diasCrudo && diasCrudo !== diasOk;
    const diasIlegible = !!diasCrudo && !diasOk;

    const hoyIso = new Date().toISOString().slice(0, 10);
    const plazos = pdAvisosPlazos(p, hoyIso);

    return `
      ${plazos.length ? `<div class="modal-section">
        <h3 class="modal-section-title">Plazos del Art. 106 del RIT</h3>
        <ul class="pd-plazos">${plazos.map((t) => `<li>${pdEsc(t)}</li>`).join('')}</ul>
        <p class="form-msg">Son avisos, no bloqueos: el plazo puede estar justificado, y los días hábiles se cuentan sin descontar festivos.</p>
      </div>` : ''}

      <div class="modal-section">
        <h3 class="modal-section-title">2. Diligencia de descargos</h3>
        <form id="pd-paso-descargos" class="form">
          <div class="fieldset-grid">
            <label>¿Compareció?<select id="pd-asistencia">${sel(p.asistencia || '', [
              { v: '', t: 'Todavía no se hizo' }, { v: 'si', t: 'Sí, compareció' }, { v: 'no', t: 'No compareció' },
            ])}</select></label>
            <label>Fecha<input type="date" id="pd-fecha-descargos" value="${p.fecha_descargos || ''}" /></label>
            <label>Hora de inicio<input type="time" id="pd-hora-ini" value="${pdHora(p.hora_descargos_inicio)}" /></label>
            <label>Hora de cierre<input type="time" id="pd-hora-fin" value="${pdHora(p.hora_descargos_fin)}" /></label>
          </div>
          <label>Quién dirige la diligencia<input type="text" id="pd-dirige" value="${pdEsc(p.dirige_descargos || '')}" /></label>
          <label>Cuestionario de descargos (preguntas y respuestas)<textarea id="pd-acta" rows="7" placeholder="Pregunta…&#10;R/ …">${pdEsc(p.acta_descargos || '')}</textarea></label>
          <div><button type="submit" class="btn-secondary">Guardar descargos</button><p id="pd-msg-descargos" class="form-msg"></p></div>
        </form>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">3. Decisión</h3>
        <form id="pd-paso-decision" class="form">
          <label>Tipo de decisión<select id="pd-decision-tipo">
            <option value="">Sin decidir todavía…</option>
            ${PD_DECISIONES.map((d) => `<option value="${d.valor}"${p.tipo_decision === d.valor ? ' selected' : ''}>${d.label}</option>`).join('')}
          </select></label>
          <!-- Contrasta la decisión con la escala del Art. 108 para la vez
               que le corresponde a esta persona por esta falta. Avisa, no
               bloquea: la sanción la decide Gestión Humana. -->
          <p id="pd-escala-aviso" class="form-msg"></p>
          <label>Antecedentes<textarea id="pd-antecedentes" rows="3" placeholder="Si se deja vacío, el documento usa los hechos.">${pdEsc(p.antecedentes || '')}</textarea></label>
          <label>Resumen de los descargos del trabajador<textarea id="pd-resumen" rows="3">${pdEsc(p.resumen_descargos || '')}</textarea></label>
          <label>Consideraciones<textarea id="pd-consideraciones" rows="3" placeholder="Si se deja vacío, el documento trae el texto estándar.">${pdEsc(p.consideraciones || '')}</textarea></label>
          <label>Compromisos de mejora <span class="pd-pista">(solo salen en la invitación al mejoramiento y en el llamado de atención)</span><textarea id="pd-compromisos" rows="2">${pdEsc(p.compromisos || '')}</textarea></label>
          <label>Numerales del RIT en que se funda la sanción<input type="text" id="pd-numerales" value="${pdEsc(numerales)}" /></label>
          <div id="pd-bloque-suspension" class="fieldset-grid hidden">
            <label>Días de suspensión<input type="number" id="pd-dias" min="1" max="90" step="1" value="${pdEsc(diasOk)}" /></label>
            <label>Inicio<input type="date" id="pd-ini-sancion" value="${p.fecha_inicio_sancion || ''}" /></label>
            <label>Fin<input type="date" id="pd-fin-sancion" value="${p.fecha_fin_sancion || ''}" /></label>
            <label>Reintegro<input type="date" id="pd-reintegro" value="${p.fecha_reintegro || ''}" /></label>
            <!-- RIT art. 106 num. 9: el recurso se presenta "ante la misma
                 area que notifico la sancion", que es la que firma el
                 documento, y el termino es de 1 dia contado desde la
                 notificacion -- dia corrido, no habil: el RIT dice "dias
                 habiles" cuando lo son, y aca no lo dice. -->
            <label>Recurso ante<input type="text" id="pd-recurso-ante" value="${pdEsc(p.recurso_ante || this._areaQueNotifica())}" /></label>
            <label>Días para el recurso<input type="number" id="pd-recurso-dias" min="1" max="30" step="1" value="${pdEsc(p.recurso_dias || '1')}" /></label>
          </div>
          ${diasRaro ? `<p class="form-msg${diasIlegible ? ' error' : ''}">El programa anterior traía «${pdEsc(diasCrudo)}» en los días de suspensión.${diasIlegible ? ' No se pudo leer como un número de días: escribe el correcto antes de emitir la sanción.' : ''}</p>` : ''}
          <label>Estado del proceso<select id="pd-estado">${sel(p.estado, [
            { v: 'citacion', t: 'Citación a descargos' }, { v: 'descargos', t: 'Descargos rendidos' },
            { v: 'decision', t: 'Con decisión' }, { v: 'finalizado', t: 'Finalizado' },
            { v: 'cancelado', t: 'Cancelado' },
          ])}</select></label>
          <div><button type="submit" class="btn-secondary">Guardar decisión</button><p id="pd-msg-decision" class="form-msg"></p></div>
        </form>
      </div>`;
  },

  _toggleSuspension() {
    const tipo = document.getElementById('pd-decision-tipo').value;
    document.getElementById('pd-bloque-suspension').classList.toggle('hidden', tipo !== 'suspension');
  },

  // Contrasta la decisión elegida con la escala del Art. 108 para la vez que
  // le corresponde a esta persona POR ESTA FALTA.
  //
  // Avisa, no bloquea. La sanción la decide Gestión Humana con los
  // antecedentes delante, y hay motivos legítimos para apartarse de la
  // escala -- atenuantes, acuerdos, un hecho que no encaja del todo. Lo que
  // no puede pasar es apartarse sin darse cuenta.
  _avisarEscala(p) {
    const caja = document.getElementById('pd-escala-aviso');
    if (!caja) return;
    const poner = (texto, clase) => { caja.textContent = texto; caja.className = 'form-msg ' + clase; };

    const elegida = document.getElementById('pd-decision-tipo').value;
    if (!elegida) { caja.textContent = ''; caja.className = 'form-msg'; return; }

    const escala = pdEscalaDe(p);
    const conteo = pdVezPorFalta(p, this._procesos);
    if (!escala || !conteo || !conteo.falta) {
      poner('Este proceso no dice en qué falta del Art. 108 se funda, así que no se puede'
        + ' contrastar con la escala del RIT. Clasifícala con «Editar» para que el sistema pueda ayudarte.', '');
      return;
    }

    const veces = ['primera', 'segunda', 'tercera', 'cuarta'];
    const disponibles = escala.filter((s) => s && String(s).trim()).length;
    const nombre = (v) => (PD_DECISIONES.find((d) => d.valor === v) || {}).label || v;
    const coletilla = conteo.sinClasificar
      ? ` (y ${conteo.sinClasificar} proceso(s) suyo(s) sin clasificar que no se pudieron contar)`
      : '';
    const base = `Es la ${veces[Math.min(conteo.vez, 4) - 1]} vez de esta persona por esta falta${coletilla}. `;

    if (conteo.vez > disponibles) {
      poner(base + 'La escala del Art. 108 no prevé otra vez más para esta falta: las anteriores'
        + ' ya llegaban hasta la sanción máxima.', 'error');
      return;
    }

    const texto = escala[conteo.vez - 1] || '';
    const esperada = pdDecisionDeEscala(texto);
    if (!esperada) {
      poner(base + 'No se pudo leer qué sanción prevé la escala para esta vez.', '');
      return;
    }

    const dif = PD_GRAVEDAD[elegida] - PD_GRAVEDAD[esperada.tipo];
    if (dif > 0) {
      poner(base + `El Art. 108 prevé «${texto}» y estás imponiendo ${nombre(elegida).toLowerCase()},`
        + ' que es MÁS GRAVE. Si es a propósito, déjalo explicado en las consideraciones.', 'error');
      return;
    }
    if (dif < 0) {
      poner(base + `El Art. 108 prevé «${texto}» y estás imponiendo algo más leve. Se puede,`
        + ' pero conviene que quede explicado en las consideraciones.', '');
      return;
    }
    if (elegida === 'suspension' && esperada.dias) {
      const puestos = Number(document.getElementById('pd-dias').value);
      if (puestos && puestos !== esperada.dias) {
        poner(base + `El Art. 108 prevé ${esperada.dias} día(s) de suspensión y pusiste ${puestos}.`, 'error');
        return;
      }
    }
    poner(base + `Coincide con lo que prevé el Art. 108: «${texto}».`, 'success');
  },

  // ---- Documentos --------------------------------------------------------

  // Quien firma por la empresa se resuelve por cargo, no por un nombre fijo en
  // el código: si mañana cambia la persona a cargo del proceso disciplinario,
  // basta con que su cargo en Empleados lo diga (mismo criterio que el
  // certificado laboral).
  _firmante() {
    return (this._empleados || []).find((e) => e.activo && /procesos?\s+disciplinarios?/i.test(e.cargo || ''))
      || (this._empleados || []).find((e) => e.activo && /gesti[oó]n\s+humana/i.test(e.cargo || ''))
      || null;
  },

  // El RIT no nombra un area fija para el recurso: dice "la misma area que
  // notifico la sancion" (art. 106 num. 9). La que notifica es la que firma,
  // asi que se propone el cargo del firmante y no una constante.
  _areaQueNotifica() {
    const f = this._firmante();
    return (f && f.cargo) ? f.cargo : PD_CARGO_FIRMA;
  },

  // Traduce una fila del ERP al objeto que esperan las plantillas portadas
  // (nombres del programa viejo: fechaCitacion, horaCitacion, ...). Es el
  // único punto de contacto entre los dos mundos; las plantillas no se tocan.
  _aProcesoDoc(p, firmaTrabajador) {
    return {
      nombre: p.empleado_nombre || '',
      cc: p.empleado_cedula || '',
      cargo: p.empleado_cargo || '',
      area: p.empleado_area || '',
      interno: p.empleado_interno || '',
      ruta: p.empleado_ruta || '',
      propietario: p.vehiculo_propietario || '',
      celular: p.celular || '',
      correoNotificacion: p.correo || '',
      motivo: p.motivo || '',
      reglamento: p.normas || '',
      pruebas: p.pruebas_texto || '',
      falta: p.falta || '',
      fechaHechos: p.fecha_hechos || '',
      fechaCitacion: p.fecha_citacion || '',
      horaCitacion: pdHora(p.hora_citacion),
      asistencia: p.asistencia || '',
      fechaActaDescargos: p.fecha_descargos || '',
      horaActaDescargos: pdHora(p.hora_descargos_inicio),
      horaDiligenciamiento: pdHora(p.hora_descargos_fin),
      acta: p.acta_descargos || '',
      disciplinario: p.dirige_descargos || '',
      tipoDecision: p.tipo_decision || '',
      antecedentes: p.antecedentes || '',
      resumenDescargos: p.resumen_descargos || '',
      consideraciones: p.consideraciones || '',
      compromisos: p.compromisos || '',
      numeralesSancion: p.numerales_sancion || '',
      diasSuspension: p.dias_suspension || '',
      fechaInicioSancion: p.fecha_inicio_sancion || '',
      fechaFinSancion: p.fecha_fin_sancion || '',
      fechaReintegro: p.fecha_reintegro || '',
      recursoAnte: p.recurso_ante || '',
      recursoDias: p.recurso_dias || '',
      ...firmaTrabajador,
    };
  },

  async _generarDocumento(p, tipo) {
    // El popup se abre en el mismo tick del clic; después de un await el
    // navegador lo bloquea por no venir de una acción del usuario.
    const ventana = window.open('', '_blank');
    if (!ventana) {
      alert('El navegador bloqueó la ventana emergente. Habilítala para este sitio e intenta de nuevo.');
      return;
    }
    ventana.document.write('<p style="font-family:Arial,Helvetica,sans-serif;padding:2rem;color:#445">Generando documento…</p>');

    const firmante = this._firmante();
    let firmaImg = null;
    if (firmante?.firma_url) {
      try {
        firmaImg = await DB.getSignedUrl('firmas', firmante.firma_url);
      } catch {
        firmaImg = null;   // sin firma guardada se deja el espacio en blanco
      }
    }

    const cf = {
      empresa: PD_EMPRESA,
      ciudad: PD_CIUDAD,
      responsable: p.responsable || PD_CARGO_FIRMA,
      nombreFirma: firmante ? firmante.nombre : '',
      cargoFirma: firmante ? firmante.cargo : PD_CARGO_FIRMA,
      firmaImg,
    };

    const datos = this._aProcesoDoc(p, {});
    const { titulo, cuerpo, showTitle } = window.PD_DOCS.construir(tipo, datos, cf);

    // Los márgenes del documento viven en el @page de PRINT_CSS, y la hoja de
    // paginaImprimible fija @page margin 0 -- se reponen como padding de la
    // hoja para que el PDF salga con los mismos márgenes de siempre.
    const estilos = `${window.PD_DOCS.PRINT_CSS}
  body { padding: 26px 16px; background: #dde3ec; }
  .page { padding: 2cm 1.7cm 2.4cm; }
  .print-actions button { font-size: 14px; }`;

    const html = paginaImprimible({
      titulo,
      estilos,
      cuerpoHtml: `<div class="doc-wrap">${showTitle ? `<h1>${pdEsc(titulo)}</h1>` : ''}${cuerpo}</div>`,
      archivo: `${slugArchivo(titulo)}-${slugArchivo(p.empleado_nombre || p.empleado_cedula)}.pdf`,
    });

    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
  },

  // ---- Pruebas -----------------------------------------------------------

  async _verPrueba(path) {
    try {
      const url = await DB.getSignedUrl('procesos-disciplinarios', path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert('No se pudo abrir el archivo: ' + pdMensajeError(err));
    }
  },

  async _subirPruebas(p, files) {
    if (!files || !files.length) return;
    Loading.show('Subiendo pruebas…');
    try {
      for (const file of files) await DB.subirPruebaProceso(p.id, file);
      await this._load();
      await this._abrirDetalle(p.id);
    } catch (err) {
      alert('No se pudo subir: ' + pdMensajeError(err));
    } finally {
      Loading.hide();
    }
  },

  async _borrarPrueba(p, pruebaId) {
    if (!confirm('¿Quitar esta prueba del proceso?')) return;
    Loading.show('Quitando…');
    try {
      await DB.borrarPruebaProceso(pruebaId);
      await this._load();
      await this._abrirDetalle(p.id);
    } catch (err) {
      alert('No se pudo quitar: ' + pdMensajeError(err));
    } finally {
      Loading.hide();
    }
  },

  // ---- Guardar los pasos -------------------------------------------------

  async _guardarPaso(e, p, campos, msgId, estadoSugerido) {
    e.preventDefault();
    const msg = document.getElementById(msgId);
    msg.textContent = '';
    msg.className = 'form-msg';
    Loading.show('Guardando…');
    try {
      await DB.guardarProcesoDisciplinario(campos, p.id);
      await this._load();
      msg.textContent = 'Guardado.';
      msg.className = 'form-msg success';
      await this._abrirDetalle(p.id);
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + pdMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  _guardarDescargos(e, p) {
    const asistencia = document.getElementById('pd-asistencia').value || null;
    return this._guardarPaso(e, p, {
      asistencia,
      fecha_descargos: document.getElementById('pd-fecha-descargos').value || null,
      hora_descargos_inicio: document.getElementById('pd-hora-ini').value || null,
      hora_descargos_fin: document.getElementById('pd-hora-fin').value || null,
      dirige_descargos: document.getElementById('pd-dirige').value.trim() || null,
      acta_descargos: document.getElementById('pd-acta').value.trim() || null,
      // Si ya se hizo la diligencia, el proceso deja de estar "en citación".
      ...(asistencia && p.estado === 'citacion' ? { estado: 'descargos' } : {}),
    }, 'pd-msg-descargos');
  },

  _guardarDecision(e, p) {
    return this._guardarPaso(e, p, {
      tipo_decision: document.getElementById('pd-decision-tipo').value || null,
      antecedentes: document.getElementById('pd-antecedentes').value.trim() || null,
      resumen_descargos: document.getElementById('pd-resumen').value.trim() || null,
      consideraciones: document.getElementById('pd-consideraciones').value.trim() || null,
      compromisos: document.getElementById('pd-compromisos').value.trim() || null,
      numerales_sancion: document.getElementById('pd-numerales').value.trim() || null,
      dias_suspension: document.getElementById('pd-dias').value.trim() || null,
      fecha_inicio_sancion: document.getElementById('pd-ini-sancion').value || null,
      fecha_fin_sancion: document.getElementById('pd-fin-sancion').value || null,
      fecha_reintegro: document.getElementById('pd-reintegro').value || null,
      recurso_ante: document.getElementById('pd-recurso-ante').value.trim() || null,
      recurso_dias: document.getElementById('pd-recurso-dias').value.trim() || null,
      estado: document.getElementById('pd-estado').value,
    }, 'pd-msg-decision');
  },

  async _borrar(p) {
    if (!confirm(`¿Eliminar el proceso de ${p.empleado_nombre} del ${pdFecha(p.fecha_citacion)}? No se puede deshacer.`)) return;
    const msg = document.getElementById('pd-detalle-msg');
    Loading.show('Eliminando…');
    try {
      await DB.borrarProcesoDisciplinario(p.id);
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo eliminar: ' + pdMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  // ---- Alta y edición de la citación -------------------------------------

  _editar(p) {
    document.getElementById('modal-backdrop').classList.add('hidden');
    this._editandoId = p.id;
    const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
    set('pd-empleado-input', `${p.empleado_nombre || ''} — CC ${p.empleado_cedula}`);
    set('pd-empleado-id', p.employee_id || '');
    set('pd-fecha-hechos', (p.fecha_hechos || '').slice(0, 10));
    set('pd-motivo', p.motivo);
    set('pd-normas', p.normas);
    set('pd-pruebas-texto', p.pruebas_texto);
    set('pd-fecha-citacion', (p.fecha_citacion || '').slice(0, 10));
    set('pd-hora-citacion', pdHora(p.hora_citacion));
    const falta = (window.CATALOGO_FALTAS || []).find((f) => `${f.n}. ${f.d}` === p.falta || f.d === p.falta);
    set('pd-falta', falta ? String(falta.n) : '');
    this._pintarEscala();

    const buscador = document.getElementById('pd-empleado-input');
    buscador.readOnly = true;
    buscador.classList.add('input-bloqueado');
    document.getElementById('pd-datos-empleado').classList.add('hidden');

    document.getElementById('pd-form-titulo').textContent = 'Editar la citación';
    document.getElementById('pd-submit').textContent = 'Guardar cambios';
    document.getElementById('pd-cancelar-edicion').classList.remove('hidden');
    document.getElementById('pd-registrar-detalle').open = true;
    document.getElementById('pd-registrar-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _salirDeEdicion() {
    this._editandoId = null;
    document.getElementById('pd-form').reset();
    document.getElementById('pd-empleado-id').value = '';
    const buscador = document.getElementById('pd-empleado-input');
    buscador.readOnly = false;
    buscador.classList.remove('input-bloqueado');
    this._pintarDatosEmpleado(null);
    this._pintarEscala();
    document.getElementById('pd-form-titulo').textContent = 'Nuevo proceso (citación a descargos)';
    document.getElementById('pd-submit').textContent = 'Guardar y generar la citación';
    document.getElementById('pd-cancelar-edicion').classList.add('hidden');
    document.getElementById('pd-msg').textContent = '';
    document.getElementById('pd-msg').className = 'form-msg';
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('pd-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const fallar = (t) => { msg.textContent = t; msg.className = 'form-msg error'; };

    const employeeId = document.getElementById('pd-empleado-id').value;
    const fechaHechos = document.getElementById('pd-fecha-hechos').value;
    const motivo = document.getElementById('pd-motivo').value.trim();
    const fechaCitacion = document.getElementById('pd-fecha-citacion').value;

    if (!this._editandoId && !employeeId) return fallar('Busca y selecciona al empleado.');
    if (!motivo) return fallar('Describe los hechos — es el cuerpo de la citación.');
    if (!fechaCitacion) return fallar('La fecha de citación es obligatoria.');
    const hoy = new Date().toISOString().slice(0, 10);
    if (fechaHechos && fechaHechos > hoy) return fallar('La fecha de los hechos no puede ser futura.');
    if (fechaHechos && fechaCitacion < fechaHechos) {
      return fallar('No se puede citar a descargos antes de que ocurran los hechos — revisa las dos fechas.');
    }

    const faltaN = Number(document.getElementById('pd-falta').value);
    const falta = (window.CATALOGO_FALTAS || []).find((f) => f.n === faltaN);
    const empleado = this._empleados.find((x) => x.id === employeeId);

    const campos = {
      fecha_hechos: fechaHechos || null,
      motivo,
      normas: document.getElementById('pd-normas').value.trim() || null,
      pruebas_texto: document.getElementById('pd-pruebas-texto').value.trim() || null,
      falta: falta ? `${falta.n}. ${falta.d}` : null,
      falta_numero: falta ? falta.n : null,
      sancion_primera: falta ? (falta.s[0] || null) : null,
      sancion_segunda: falta ? (falta.s[1] || null) : null,
      sancion_tercera: falta ? (falta.s[2] || null) : null,
      sancion_cuarta: falta ? (falta.s[3] || null) : null,
      fecha_citacion: fechaCitacion,
      hora_citacion: document.getElementById('pd-hora-citacion').value || null,
    };

    if (!this._editandoId) {
      Object.assign(campos, {
        employee_id: employeeId,
        empleado_cedula: empleado.cedula,
        empleado_nombre: empleado.nombre,
        empleado_cargo: empleado.cargo || null,
        empleado_area: empleado.area || null,
        empleado_interno: empleado.numero_interno || null,
        empleado_ruta: empleado.ruta || null,
        estado: 'citacion',
      });
    }

    const editando = this._editandoId;
    const btn = document.getElementById('pd-submit');
    btn.disabled = true;
    Loading.show('Guardando…');
    try {
      const id = await DB.guardarProcesoDisciplinario(campos, editando);
      this._salirDeEdicion();
      document.getElementById('pd-registrar-detalle').open = false;
      await this._load();
      msg.textContent = editando ? 'Proceso actualizado.' : 'Proceso creado.';
      msg.className = 'form-msg success';
      // Al crear se abre la citación de una: el proceso existe para citar.
      // Se pide completo porque el documento usa los campos largos, que el
      // listado ya no trae.
      //
      // Va en su propio try: el proceso YA quedó guardado, y si falla traerlo
      // para imprimir, el mensaje no puede decir "no se pudo guardar". Eso
      // haría que alguien lo volviera a crear y quedara duplicado.
      if (!editando && id) {
        try {
          this._generarDocumento(await DB.getProcesoDisciplinario(id), 'citacion');
        } catch (err) {
          msg.textContent = 'Proceso creado, pero no se pudo abrir la citación: '
            + pdMensajeError(err) + ' Ábrela desde “Ver detalle”.';
          msg.className = 'form-msg error';
        }
      }
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + pdMensajeError(err);
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
      Loading.hide();
    }
  },

  // ---- Importación del programa anterior ---------------------------------

  // La URL de la hoja publicada no vive en el código: el repo es público y la
  // hoja trae cédulas, celulares y las actas completas. Se pega una vez y
  // queda en este navegador.
  _CLAVE_URL_HOJA: 'pd_url_hoja',

  // Se pide en el modal del ERP y no con un prompt del navegador: así se ve
  // igual que el resto, cabe un enlace largo y se puede explicar qué es.
  _pedirUrlHoja() {
    const guardada = localStorage.getItem(this._CLAVE_URL_HOJA) || '';
    return new Promise((resolve) => {
      const backdrop = document.getElementById('modal-backdrop');
      document.getElementById('modal-body').innerHTML = `
        <div class="modal-section">
          <h3 class="modal-section-title">Traer los procesos anteriores</h3>
          <p class="muted">Se traen los del programa anterior y los de la hoja que lleva Gestión Humana. No se borra nada allá, lo ya traído se completa en vez de duplicarse, y lo que se haya editado acá no se pisa.</p>
          <form id="pd-hoja-form" class="form">
            <label>Enlace CSV de la hoja
              <input type="url" id="pd-hoja-url" required placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=0&amp;single=true&amp;output=csv" value="${pdEsc(guardada)}" />
            </label>
            <p class="muted">En el Sheet: Archivo → Compartir → Publicar en la Web → CSV.</p>
            <div>
              <button type="submit">Traer los procesos</button>
              <button type="button" class="btn-secondary" id="pd-hoja-cancelar">Cancelar</button>
              <p id="pd-hoja-msg" class="form-msg"></p>
            </div>
          </form>
        </div>`;
      backdrop.classList.remove('hidden');

      const cerrar = (valor) => { backdrop.classList.add('hidden'); resolve(valor); };
      document.getElementById('pd-hoja-cancelar').addEventListener('click', () => cerrar(null));
      document.getElementById('pd-hoja-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const limpia = document.getElementById('pd-hoja-url').value.trim();
        if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(limpia)) {
          document.getElementById('pd-hoja-msg').textContent = 'Ese no parece el enlace publicado de un Google Sheet.';
          return;
        }
        localStorage.setItem(this._CLAVE_URL_HOJA, limpia);
        cerrar(limpia);
      });
    });
  },

  async _importar() {
    const url = await this._pedirUrlHoja();
    if (!url) return;

    // Un solo show para toda la importacion; las etapas y el progreso van
    // por setMessage. Con un show por lote el contador quedaba en decenas y
    // el overlay no se cerraba al terminar -- la pantalla se veia colgada
    // cuando en realidad ya habia acabado.
    Loading.show('Trayendo procesos…');
    const partes = [];
    try {
      // 1) La tabla del programa anterior. Si falla (por ejemplo, si ya la
      //    apagaron) no se detiene la importación: la hoja es la fuente buena.
      try {
        Loading.setMessage('Leyendo el programa anterior…');
        const r = await DB.importarProcesosDisciplinarios((hechas, total) => {
          Loading.setMessage(`Leyendo el programa anterior… ${hechas} de ${total}`);
        });
        partes.push(`Del programa anterior: ${r.copiados} de ${r.total} proceso(s).`);
      } catch (err) {
        partes.push('Del programa anterior: no se pudo leer (' + pdMensajeError(err) + ').');
      }

      // 2) La hoja.
      Loading.setMessage('Descargando la hoja…');
      const { filas, descartadas, faltantes, desconocidas } = await window.HOJA_PROCESOS.traer(url);

      // Si la hoja cambió de columnas, se pregunta ANTES de subir nada.
      // Lo ya guardado no corre peligro (el RPC actualiza con coalesce y
      // nunca pisa un valor con vacío), pero los procesos nuevos entrarían
      // sin ese dato, y una columna vacía no se distingue después de un
      // dato que nunca existió.
      if (faltantes.length) {
        Loading.hide();
        const sigue = confirm(
          'La hoja ya no trae estas columnas:\n\n  ' + faltantes.join('\n  ')
          + '\n\nLo que ya está guardado no se toca, pero los procesos nuevos'
          + ' entrarán sin esos datos.\n\n¿Traerlos de todas formas?');
        if (!sigue) {
          partes.push('No se trajo nada: la hoja cambió de columnas.');
          alert(partes.join('\n'));
          return;
        }
        Loading.show('Trayendo procesos…');
      }
      const r = await DB.importarProcesosDeHoja(filas, (hechas, total) => {
        Loading.setMessage(`Subiendo procesos… ${hechas} de ${total}`);
      });
      partes.push(
        `De la hoja: ${r.insertados} nuevo(s) y ${r.actualizados} completado(s).`
        + (r.respetados ? `\n${r.respetados} no se tocaron porque ya se editaron acá en el ERP.` : '')
        + (descartadas ? `\n${descartadas} fila(s) de la hoja se saltaron por no tener cédula o identificador.` : '')
        + (faltantes.length ? `\nOJO: la hoja ya no trae ${faltantes.join(', ')}.` : '')
        // No es un error: es que Gestión Humana está llevando información que
        // el ERP todavía no guarda. Vale la pena saberlo.
        + (desconocidas.length ? `\nLa hoja trae columnas que el ERP no usa: ${desconocidas.join(', ')}.` : '')
      );

      await this._load();
      const resumen = await DB.getResumenProcesos();
      partes.push(
        `\nEn total quedan ${resumen.total} procesos de ${resumen.personas} personas.\n`
        + `${resumen.con_empleado} están enlazados a una ficha de Empleados y ${resumen.sin_empleado} no `
        + '(gente que ya no está en la tabla; el proceso se guarda igual).'
      );
      alert(partes.join('\n'));
    } catch (err) {
      alert([...partes, '', 'No se pudo terminar: ' + pdMensajeError(err)].join('\n'));
      await this._load();
    } finally {
      Loading.hide();
    }
  },
});
