// Contratos a termino fijo: fin del periodo de prueba y entrega del preaviso.
//
// Vive aparte de personal-alertas.js (que lo monta) porque es un bloque
// autonomo -- su propio filtro, su propio modal, su propia tabla -- y ese
// archivo ya carga con cinco alertas distintas.
//
// LAS DOS FECHAS
//   1. Fin del periodo de prueba: pasada esa fecha ya no se puede terminar
//      el contrato alegando el periodo de prueba.
//   2. Fecha limite del preaviso: el vencimiento menos 30 dias. Si el
//      preaviso no se entrega antes, el contrato se prorroga solo. Por eso
//      los vencidos se muestran de primeros y marcados: no es "se paso la
//      fecha", es una renovacion que nadie decidio.
//
// El plazo de 30 dias es el minimo legal y NO se toca desde la pantalla. El
// filtro de arriba decide cuanto se quiere ver por delante, que es otra cosa.
const CT_DIAS_PREAVISO_LEY = 30;

function ctEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Se parsea por componentes y no con new Date(iso): con la zona horaria de
// Colombia (UTC-5), new Date('2026-08-01') cae el 31 de julio.
function ctParseFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ctFormatFecha(iso) {
  const d = ctParseFecha(iso);
  return d ? d.toLocaleDateString('es-CO') : '—';
}

function ctAIso(fecha) {
  if (!fecha) return '';
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mm}-${dd}`;
}

function ctSumarMeses(fecha, meses) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const dia = d.getDate();
  d.setMonth(d.getMonth() + meses);
  // Si el mes destino no tiene ese dia (31 de enero + 1 mes), JavaScript se
  // pasa al mes siguiente. Se devuelve el ultimo dia del mes que tocaba.
  if (d.getDate() !== dia) d.setDate(0);
  return d;
}

function ctDiasEntre(desde, hasta) {
  return Math.round((hasta - desde) / 86400000);
}

// El periodo de prueba que propone la pantalla: la quinta parte del plazo
// pactado, sin pasar de dos meses. Es lo que exige el Codigo Sustantivo del
// Trabajo para los contratos a termino fijo. Es una PROPUESTA: manda lo que
// diga el contrato firmado, y por eso la fecha queda editable.
function ctSugerirFinPrueba(isoInicio, isoFin) {
  const inicio = ctParseFecha(isoInicio);
  if (!inicio) return '';
  const tope = ctSumarMeses(inicio, 2);
  const fin = ctParseFecha(isoFin);
  if (!fin) return ctAIso(tope);
  const quintaParte = new Date(inicio.getFullYear(), inicio.getMonth(),
    inicio.getDate() + Math.floor(ctDiasEntre(inicio, fin) / 5));
  return ctAIso(quintaParte < tope ? quintaParte : tope);
}

// Un termino fijo INFERIOR A UN AÑO solo puede prorrogarse tres veces por
// periodos iguales o menores; de ahi en adelante la renovacion no puede
// bajar de un año (art. 46 del Codigo Sustantivo del Trabajo). Con contratos
// de tres meses ese techo llega al cumplir el primer año, y es facil pasarlo
// por alto justo porque cada prorroga se siente igual a la anterior.
//
// Devuelve el aviso cuando aplica, o cadena vacia.
function ctAvisoProrrogas(contrato) {
  if (!contrato || !contrato.fecha_fin) return '';
  const dias = Number(contrato.duracion_dias) || 0;
  if (!dias || dias >= 365) return '';
  const numero = Number(contrato.numero_contrato) || 1;
  if (numero >= 4) {
    return 'Ya van ' + numero + ' contratos seguidos de menos de un año: la renovación siguiente no puede ser inferior a un año.';
  }
  if (numero === 3) {
    return 'Esta es la tercera prórroga. La próxima renovación ya no puede ser inferior a un año.';
  }
  return '';
}

function ctPuedeEditar() {
  if (window.APP_ROLE === 'admin') return true;
  if (window.APP_GRUPO === 'GESTION HUMANA') return true;
  const p = (window.APP_PERMISOS_MODULOS || {})['personal-alertas'];
  return !!(p && (p.agregar || p.editar));
}

function ctMensajeError(err) {
  const codigo = String((err && err.code) || '');
  const texto = [err && err.message, err && err.hint, err && err.details]
    .filter(Boolean).join(' ') || String(err || '');
  if (/relation .* does not exist|PGRST205|PGRST202|kardex_contratos/i.test(texto) && /does not exist|not find/i.test(texto)) {
    return 'Falta correr sql/contratos_laborales_2026-10-22.sql en la base de datos.';
  }
  if (codigo === '42501' || /permission denied|row-level security|policy/i.test(texto)) {
    return 'Tu cuenta no tiene permiso para registrar contratos.';
  }
  if (/kardex_contratos_fin_despues_inicio/i.test(texto)) {
    return 'La fecha de terminación tiene que ser posterior a la de inicio.';
  }
  if (/kardex_contratos_prueba_dentro/i.test(texto)) {
    return 'El fin del periodo de prueba tiene que caer dentro del contrato.';
  }
  return texto || 'No se pudo completar.';
}

const ContratosAlertas = {
  // Lo monta personal-alertas.js en su onEnter.
  async montar() {
    if (!document.getElementById('ct-prueba-lista')) return;
    if (!this._bound) {
      document.getElementById('ct-ventana')
        .addEventListener('change', () => this._pintar());
      const nuevo = document.getElementById('ct-nuevo-btn');
      nuevo.addEventListener('click', () => this._abrirModal(null));
      nuevo.classList.toggle('hidden', !ctPuedeEditar());
      this._bound = true;
    }
    await this._cargar();
  },

  async _cargar() {
    const mensaje = document.getElementById('ct-mensaje');
    try {
      this._contratos = await DB.getAlertasContratos(CT_DIAS_PREAVISO_LEY);
      mensaje.textContent = '';
      mensaje.className = 'muted';
    } catch (err) {
      this._contratos = [];
      mensaje.textContent = ctMensajeError(err);
      mensaje.className = 'muted form-msg error';
    }
    this._pintar();
  },

  _ventana() {
    return Number(document.getElementById('ct-ventana').value) || 45;
  },

  _pintar() {
    const todos = this._contratos || [];
    const ventana = this._ventana();
    const activos = todos.filter((c) => c.activo !== false);

    // Periodo de prueba: solo los que todavia no han vencido o vencieron
    // hace poco -- uno de hace seis meses ya no es una alerta, es historia.
    const prueba = activos
      .filter((c) => c.dias_para_prueba !== null && c.dias_para_prueba <= ventana && c.dias_para_prueba >= -15)
      .sort((a, b) => a.dias_para_prueba - b.dias_para_prueba);

    // Preaviso: los que no se han entregado. Los vencidos van de primeros y
    // nunca se esconden, aunque el filtro sea corto: ese plazo ya se paso y
    // esconderlo seria taparlo.
    const preaviso = activos
      .filter((c) => c.fecha_fin && !c.preaviso_entregado_en)
      .filter((c) => c.dias_para_preaviso <= ventana)
      .sort((a, b) => a.dias_para_preaviso - b.dias_para_preaviso);

    const fijos = todos.filter((c) => c.tipo === 'FIJO' && c.activo !== false).length;
    document.getElementById('ct-kpi-prueba').textContent = prueba.filter((c) => c.dias_para_prueba >= 0).length;
    document.getElementById('ct-kpi-preaviso').textContent = preaviso.length;
    document.getElementById('ct-kpi-total').textContent = fijos;

    const vencidos = preaviso.filter((c) => c.dias_para_preaviso < 0).length;
    document.getElementById('ct-prueba-subtitulo').textContent = prueba.length
      ? `${prueba.length} contrato(s)`
      : 'Ningún periodo de prueba vence en este plazo.';
    document.getElementById('ct-preaviso-subtitulo').textContent = preaviso.length
      ? `${preaviso.length} contrato(s)${vencidos ? ` — ${vencidos} con el plazo ya vencido` : ''}`
      : 'Ningún preaviso pendiente en este plazo.';

    this._pintarLista('ct-prueba-lista', prueba, 'prueba');
    this._pintarLista('ct-preaviso-lista', preaviso, 'preaviso');
  },

  _pintarLista(elId, filas, clase) {
    const caja = document.getElementById(elId);
    if (!caja) return;
    if (!filas.length) {
      caja.innerHTML = '<p class="empty-note">Nada pendiente por ahora.</p>';
      return;
    }

    caja.innerHTML = filas.map((c) => {
      const dias = clase === 'prueba' ? c.dias_para_prueba : c.dias_para_preaviso;
      const fecha = clase === 'prueba' ? c.fin_periodo_prueba : c.fecha_limite_preaviso;
      let etiqueta;
      let tag;
      if (dias < 0) {
        etiqueta = `Se pasó hace ${Math.abs(dias)} día(s)`;
        tag = 'pendiente';
      } else if (dias === 0) {
        etiqueta = 'Es hoy';
        tag = 'pendiente';
      } else {
        etiqueta = `En ${dias} día(s)`;
        tag = dias <= 7 ? 'pendiente' : 'activo';
      }
      const accion = clase === 'preaviso' && ctPuedeEditar()
        ? `<button type="button" class="btn-secondary" data-preaviso="${c.id}">Registrar entrega</button>
           <button type="button" class="btn-secondary" data-contrato="${c.id}">Contrato</button>`
        : (ctPuedeEditar() ? `<button type="button" class="btn-secondary" data-contrato="${c.id}">Ver contrato</button>` : '');
      const aviso = clase === 'preaviso' ? ctAvisoProrrogas(c) : '';

      return `
        <div class="detalle-list-item">
          <div style="min-width:0">
            <div class="lc-item-texto"><strong>${ctEscapeHtml(c.nombre)}</strong></div>
            <div class="person-meta">
              <span>${ctEscapeHtml(c.cargo || 'Sin cargo')}</span>
              <span>${clase === 'prueba' ? 'Prueba hasta' : 'Avisar antes del'} ${ctFormatFecha(fecha)}</span>
              ${clase === 'preaviso' ? `<span>Vence ${ctFormatFecha(c.fecha_fin)}</span>` : ''}
            </div>
            ${aviso ? `<p class="empty-note" style="margin-top:0.25rem">${ctEscapeHtml(aviso)}</p>` : ''}
          </div>
          <div class="pa-doc-cell">
            <span class="tag ${tag}">${ctEscapeHtml(etiqueta)}</span>
            ${accion}
          </div>
        </div>`;
    }).join('');

    caja.querySelectorAll('[data-preaviso]').forEach((b) => {
      b.addEventListener('click', () => this._registrarPreaviso(
        (this._contratos || []).find((c) => c.id === b.dataset.preaviso)));
    });
    caja.querySelectorAll('[data-contrato]').forEach((b) => {
      b.addEventListener('click', () => this._abrirModal(
        (this._contratos || []).find((c) => c.id === b.dataset.contrato)));
    });
  },

  // ---- Registrar o corregir un contrato ---------------------------------

  async _abrirModal(contrato) {
    const esNuevo = !contrato;
    if (esNuevo && !this._empleados) {
      this._empleados = await DB.getEmployees({ onlyActive: true });
    }

    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${esNuevo ? 'Registrar contrato' : ctEscapeHtml(contrato.nombre)}</div>
          <div class="detalle-sub">${esNuevo
            ? 'Contrato a término fijo: de aquí salen las alertas de periodo de prueba y preaviso.'
            : `CC ${ctEscapeHtml(contrato.cedula)} · ${ctEscapeHtml(contrato.cargo || 'Sin cargo')}`}</div>
        </div>
      </div>

      <div class="modal-section">
        <form class="form" id="ct-form">
          ${esNuevo ? `
          <label>Empleado <span class="req-star">*</span>
            <div class="combobox" id="ct-combobox">
              <input type="text" id="ct-empleado-buscar" autocomplete="off" placeholder="Buscar por nombre o cédula…" />
              <input type="hidden" id="ct-empleado-id" />
              <ul class="combobox-list hidden" id="ct-empleado-lista"></ul>
            </div>
          </label>` : ''}

          <div class="form-row">
            <label>Tipo de contrato
              <select id="ct-tipo">
                <option value="FIJO">Término fijo</option>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="OBRA_LABOR">Obra o labor</option>
                <option value="APRENDIZAJE">Aprendizaje</option>
              </select>
            </label>
            <label>Fecha de inicio <span class="req-star">*</span>
              <input type="date" id="ct-inicio" value="${ctEscapeHtml(contrato?.fecha_inicio || '')}" required />
            </label>
          </div>

          <div class="form-row">
            <label>Duración
              <select id="ct-duracion">
                <option value="">Elegir para calcular…</option>
                <option value="3">3 meses</option>
                <option value="4">4 meses</option>
                <option value="6">6 meses</option>
                <option value="12">1 año</option>
              </select>
            </label>
            <label>Fecha de terminación
              <input type="date" id="ct-fin" value="${ctEscapeHtml(contrato?.fecha_fin || '')}" />
            </label>
          </div>
          <p class="empty-note">La duración solo propone la fecha; manda lo que diga el contrato firmado.</p>

          <label>Fin del periodo de prueba
            <input type="date" id="ct-prueba" value="${ctEscapeHtml(contrato?.fin_periodo_prueba || '')}" />
          </label>
          <p class="empty-note" id="ct-prueba-nota"></p>

          <label>Observaciones
            <textarea id="ct-observaciones" rows="2">${ctEscapeHtml(contrato?.observaciones || '')}</textarea>
          </label>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.8rem">
            <button type="submit" id="ct-guardar">${esNuevo ? 'Registrar' : 'Guardar cambios'}</button>
            <button type="button" class="btn-secondary" id="ct-cerrar">Cancelar</button>
          </div>
          <p id="ct-form-msg" class="form-msg"></p>
        </form>
      </div>

      ${!esNuevo && contrato.fecha_fin ? `
      <div class="modal-section">
        <h3 class="modal-section-title">Prórroga</h3>
        <p class="prose-p">Al prorrogarlo se crea el contrato siguiente, que arranca el día
          después de ${ctFormatFecha(contrato.fecha_fin)} y trae su propia alerta de preaviso.
          El contrato actual queda en el historial.</p>
        ${ctAvisoProrrogas(contrato) ? `<p class="form-msg error">${ctEscapeHtml(ctAvisoProrrogas(contrato))}</p>` : ''}
        <button type="button" class="btn-secondary" id="ct-prorrogar">Registrar prórroga</button>
      </div>` : ''}

      ${!esNuevo && contrato.preaviso_entregado_en ? `
      <div class="modal-section">
        <h3 class="modal-section-title">Preaviso</h3>
        <p class="prose-p">Entregado el ${ctFormatFecha(contrato.preaviso_entregado_en)}${
          contrato.preaviso_entregado_por_nombre ? ` por ${ctEscapeHtml(contrato.preaviso_entregado_por_nombre)}` : ''}.</p>
        ${contrato.decision ? `<p class="prose-p">Decisión: ${contrato.decision === 'RENOVAR' ? 'renovar' : 'no renovar'}.</p>` : ''}
      </div>` : ''}
    `;

    if (contrato) document.getElementById('ct-tipo').value = contrato.tipo || 'FIJO';
    if (esNuevo) this._montarCombobox();

    const inicio = document.getElementById('ct-inicio');
    const fin = document.getElementById('ct-fin');
    const duracion = document.getElementById('ct-duracion');
    const prueba = document.getElementById('ct-prueba');

    const proponer = () => {
      const meses = Number(duracion.value);
      const d = ctParseFecha(inicio.value);
      if (meses && d) fin.value = ctAIso(ctSumarMeses(d, meses));
      if (inicio.value && !prueba.dataset.tocado) {
        prueba.value = ctSugerirFinPrueba(inicio.value, fin.value);
      }
      this._notaPrueba();
    };
    duracion.addEventListener('change', proponer);
    inicio.addEventListener('change', proponer);
    fin.addEventListener('change', () => { if (!prueba.dataset.tocado) proponer(); else this._notaPrueba(); });
    prueba.addEventListener('input', () => { prueba.dataset.tocado = '1'; this._notaPrueba(); });
    this._notaPrueba();

    document.getElementById('ct-cerrar').addEventListener('click', () => {
      document.getElementById('modal-backdrop').classList.add('hidden');
    });
    document.getElementById('ct-form')
      .addEventListener('submit', (e) => this._guardar(e, contrato));
    const btnProrroga = document.getElementById('ct-prorrogar');
    if (btnProrroga) btnProrroga.addEventListener('click', () => this._prorrogar(contrato));
  },

  // La prorroga es un contrato NUEVO, no una fecha cambiada: asi queda
  // cuando vencio el anterior y si se preaviso. Arranca el dia siguiente al
  // vencimiento y, por defecto, dura lo mismo que el que termina.
  //
  // Sin periodo de prueba: solo cabe en el primer contrato con la persona.
  _prorrogar(contrato) {
    const fin = ctParseFecha(contrato.fecha_fin);
    if (!fin) return;
    const inicio = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() + 1);
    const dias = Number(contrato.duracion_dias) || 0;
    const nuevoFin = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + dias);

    this._abrirModal(null);
    // _abrirModal es asincrono solo por la carga de empleados; cuando ya
    // estan cargados el formulario esta listo en el mismo tick. Se espera
    // al siguiente para no depender de eso.
    setTimeout(() => {
      const buscar = document.getElementById('ct-empleado-buscar');
      const oculto = document.getElementById('ct-empleado-id');
      if (!buscar || !oculto) return;
      oculto.value = contrato.employee_id;
      buscar.value = `${contrato.nombre} — CC ${contrato.cedula}`;
      buscar.readOnly = true;
      document.getElementById('ct-tipo').value = contrato.tipo || 'FIJO';
      document.getElementById('ct-inicio').value = ctAIso(inicio);
      document.getElementById('ct-fin').value = ctAIso(nuevoFin);
      // La prueba se deja vacia y marcada como tocada, para que el
      // recalculo automatico no la vuelva a llenar.
      const prueba = document.getElementById('ct-prueba');
      prueba.value = '';
      prueba.dataset.tocado = '1';
      const nota = document.getElementById('ct-prueba-nota');
      if (nota) nota.textContent = 'En una prórroga no hay periodo de prueba: solo cabe en el primer contrato.';
      const aviso = ctAvisoProrrogas(contrato);
      if (aviso) {
        const msg = document.getElementById('ct-form-msg');
        msg.textContent = aviso;
        msg.className = 'form-msg error';
      }
    }, 0);
  },

  _notaPrueba() {
    const nota = document.getElementById('ct-prueba-nota');
    if (!nota) return;
    const inicio = document.getElementById('ct-inicio').value;
    const fin = document.getElementById('ct-fin').value;
    const sugerido = ctSugerirFinPrueba(inicio, fin);
    nota.textContent = sugerido
      ? `Por ley: la quinta parte del contrato, sin pasar de dos meses (daría ${ctFormatFecha(sugerido)}).`
      : 'Pon la fecha de inicio para calcularlo.';
  },

  _montarCombobox() {
    const buscar = document.getElementById('ct-empleado-buscar');
    const oculto = document.getElementById('ct-empleado-id');
    const lista = document.getElementById('ct-empleado-lista');
    const MAX = 40;

    const pintar = () => {
      const q = buscar.value.trim().toLowerCase();
      if (!q) { lista.classList.add('hidden'); return; }
      const encontrados = (this._empleados || []).filter((e) =>
        String(e.nombre || '').toLowerCase().includes(q)
        || String(e.cedula || '').includes(q)).slice(0, MAX);
      lista.innerHTML = encontrados.length
        ? encontrados.map((e) => `<li data-id="${e.id}">${ctEscapeHtml(e.nombre)} — CC ${ctEscapeHtml(e.cedula)}</li>`).join('')
        : '<li class="combobox-vacio">Nadie coincide</li>';
      lista.classList.remove('hidden');
      lista.querySelectorAll('[data-id]').forEach((li) => {
        li.addEventListener('click', () => {
          const emp = this._empleados.find((e) => e.id === li.dataset.id);
          oculto.value = emp.id;
          buscar.value = `${emp.nombre} — CC ${emp.cedula}`;
          lista.classList.add('hidden');
        });
      });
    };
    buscar.addEventListener('input', () => { oculto.value = ''; pintar(); });
  },

  async _guardar(evento, contrato) {
    evento.preventDefault();
    const msg = document.getElementById('ct-form-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const fallar = (t) => { msg.textContent = t; msg.className = 'form-msg error'; };

    const employeeId = contrato ? contrato.employee_id : document.getElementById('ct-empleado-id').value;
    const inicio = document.getElementById('ct-inicio').value;
    const fin = document.getElementById('ct-fin').value;
    const prueba = document.getElementById('ct-prueba').value;
    const tipo = document.getElementById('ct-tipo').value;

    if (!employeeId) return fallar('Busca y selecciona al empleado.');
    if (!inicio) return fallar('La fecha de inicio es obligatoria.');
    // Un termino fijo sin vencimiento no genera la alerta que se pidio: es
    // justo el dato que hace falta, asi que no se deja pasar en silencio.
    if (tipo === 'FIJO' && !fin) return fallar('Un contrato a término fijo necesita fecha de terminación — de ahí sale el preaviso.');
    if (fin && fin <= inicio) return fallar('La fecha de terminación tiene que ser posterior a la de inicio.');
    if (prueba && (prueba <= inicio || (fin && prueba > fin))) {
      return fallar('El fin del periodo de prueba tiene que caer dentro del contrato.');
    }

    const boton = document.getElementById('ct-guardar');
    boton.disabled = true;
    Loading.show('Guardando…');
    try {
      await DB.guardarContrato({
        id: contrato ? contrato.id : null,
        employeeId,
        tipo,
        fechaInicio: inicio,
        fechaFin: fin || null,
        finPeriodoPrueba: prueba || null,
        observaciones: document.getElementById('ct-observaciones').value.trim() || null,
      });
      document.getElementById('modal-backdrop').classList.add('hidden');
      await this._cargar();
    } catch (err) {
      fallar(ctMensajeError(err));
    } finally {
      boton.disabled = false;
      Loading.hide();
    }
  },

  // ---- Registrar la entrega del preaviso --------------------------------

  async _registrarPreaviso(contrato) {
    if (!contrato) return;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${ctEscapeHtml(contrato.nombre)}</div>
          <div class="detalle-sub">Contrato hasta ${ctFormatFecha(contrato.fecha_fin)} · avisar antes del ${ctFormatFecha(contrato.fecha_limite_preaviso)}</div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Entrega del preaviso</h3>
        <form class="form" id="ct-preaviso-form">
          <div class="form-row">
            <label>Fecha de entrega
              <input type="date" id="ct-preaviso-fecha" value="${ctAIso(new Date())}" />
            </label>
            <label>Decisión
              <select id="ct-preaviso-decision">
                <option value="">Sin definir todavía</option>
                <option value="NO_RENOVAR">No renovar</option>
                <option value="RENOVAR">Renovar</option>
              </select>
            </label>
          </div>
          <p class="empty-note">Si se renueva, la prórroga se registra después como un contrato nuevo, con su propio vencimiento.</p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.8rem">
            <button type="submit" id="ct-preaviso-guardar">Registrar entrega</button>
            <button type="button" class="btn-secondary" id="ct-preaviso-cerrar">Cancelar</button>
          </div>
          <p id="ct-preaviso-msg" class="form-msg"></p>
        </form>
      </div>`;

    document.getElementById('ct-preaviso-cerrar').addEventListener('click', () => {
      document.getElementById('modal-backdrop').classList.add('hidden');
    });
    document.getElementById('ct-preaviso-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('ct-preaviso-msg');
      const boton = document.getElementById('ct-preaviso-guardar');
      boton.disabled = true;
      Loading.show('Guardando…');
      try {
        await DB.marcarPreavisoContrato(contrato.id, {
          fecha: document.getElementById('ct-preaviso-fecha').value || null,
          decision: document.getElementById('ct-preaviso-decision').value || null,
        });
        document.getElementById('modal-backdrop').classList.add('hidden');
        await this._cargar();
      } catch (err) {
        msg.textContent = ctMensajeError(err);
        msg.className = 'form-msg error';
      } finally {
        boton.disabled = false;
        Loading.hide();
      }
    });
  },
};

window.ContratosAlertas = ContratosAlertas;
