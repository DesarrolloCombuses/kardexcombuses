// Barrido de conductores contra Sonar Telematics: revisa de una vez a todos
// los conductores de rutas con flota en Sonar y, en un segundo paso, registra
// a los que falten.
//
// Por qué en dos pasos y no uno
// -----------------------------
// El primer paso NO escribe nada en Sonar: solo pregunta. Son ~120
// conductores, y antes de disparar altas en un sistema que ve toda la flota
// conviene saber cuántas van a ser de verdad. Además la cuenta de "faltan N"
// sale de haber mirado, no de la columna `sonar_synced_at` de Kardex, que
// NO es confiable: la ponía el código viejo, que daba por enviado sin
// comprobar nada.
//
// El registro se queda corto a propósito: solo toca a los que la consulta
// dejó en "falta". A quien ya está -- aunque sea en otra flota -- no se le
// intenta crear nada, porque ese intento es justo el que Sonar rechaza con
// "Existe otro conductor con la misma identificación".
const SonarBarrido = {
  _lista: [],
  _estado: new Map(), // employee_id -> { estado, mensaje }
  _corriendo: false,
  _cancelar: false,

  // De a tres. Cada llamada son dos consultas SOAP (una por flota), así que
  // con más se le carga la mano a Sonar sin ganar gran cosa; de a una
  // tardaría demasiado para 120 personas.
  CONCURRENCIA: 3,

  abrir(conductores) {
    this._lista = conductores || [];
    this._estado = new Map();
    this._cancelar = false;
    this._corriendo = false;

    const panel = document.getElementById('emp-sonar-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    this._pintarTabla();
    this._pintarResumen();
    this._pintarBotones();
    document.getElementById('emp-sonar-progreso').textContent =
      `${this._lista.length} conductores de rutas con flota en Sonar.`;
  },

  cerrar() {
    this._cancelar = true;
    document.getElementById('emp-sonar-panel')?.classList.add('hidden');
  },

  _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // Se clasifica con los HALLAZGOS que devuelve la función, no leyendo el
  // texto del mensaje: el mensaje está escrito para que lo lea una persona y
  // cambiará con el tiempo.
  _clasificar(res) {
    if (!res) return 'error';
    if (res.registrado) return res.ok ? 'registrado' : 'registrado_pendiente';
    const hallazgos = res.hallazgos || [];
    const encontrados = hallazgos.filter((h) => h.encontrado);
    if (!encontrados.length) {
      if (hallazgos.some((h) => !h.consultado)) return 'no_revisado';
      return 'falta';
    }
    if (!res.esperada) return 'en_sonar';
    if (encontrados.some((h) => h.cuenta !== res.esperada)) return 'otra_flota';
    return res.ok ? 'en_su_flota' : 'deshabilitado';
  },

  ETIQUETAS: {
    pendiente: ['Sin revisar', ''],
    revisando: ['Revisando…', ''],
    en_su_flota: ['Ya está en su flota', 'activo'],
    deshabilitado: ['Está, pero deshabilitado', 'pendiente'],
    otra_flota: ['Está en OTRA flota', 'pendiente'],
    falta: ['No está en Sonar', 'descartado'],
    registrado: ['Registrado ahora', 'activo'],
    registrado_pendiente: ['Registrado, falta habilitarlo', 'pendiente'],
    no_revisado: ['No se pudo revisar', 'descartado'],
    error: ['Error', 'descartado'],
  },

  _pintarTabla() {
    const tbody = document.getElementById('emp-sonar-tbody');
    if (!tbody) return;
    tbody.innerHTML = this._lista.map((e) => {
      const st = this._estado.get(e.id) || { estado: 'pendiente', mensaje: '' };
      const [texto, clase] = this.ETIQUETAS[st.estado] || this.ETIQUETAS.pendiente;
      return `
      <tr>
        <td>${this._esc(e.nombre || '')}</td>
        <td>${this._esc(e.ruta || '')}</td>
        <td>${clase ? `<span class="tag ${clase}">${texto}</span>` : `<span class="muted">${texto}</span>`}</td>
        <td class="muted">${this._esc(st.mensaje || '')}</td>
      </tr>`;
    }).join('');
  },

  _pintarResumen() {
    const cuenta = {};
    for (const { estado } of this._estado.values()) cuenta[estado] = (cuenta[estado] || 0) + 1;
    const sinRevisar = this._lista.length - this._estado.size;
    const partes = [];
    for (const clave of ['registrado', 'registrado_pendiente', 'en_su_flota', 'deshabilitado', 'otra_flota', 'falta', 'no_revisado', 'error']) {
      if (cuenta[clave]) partes.push(`${this.ETIQUETAS[clave][0]}: ${cuenta[clave]}`);
    }
    if (sinRevisar) partes.push(`Sin revisar: ${sinRevisar}`);
    document.getElementById('emp-sonar-resumen').textContent = partes.join(' · ');
  },

  _faltantes() {
    return this._lista.filter((e) => (this._estado.get(e.id) || {}).estado === 'falta');
  },

  _pintarBotones() {
    const btnConsultar = document.getElementById('emp-sonar-consultar-btn');
    const btnRegistrar = document.getElementById('emp-sonar-registrar-btn');
    const btnParar = document.getElementById('emp-sonar-parar-btn');
    if (!btnConsultar || !btnRegistrar || !btnParar) return;

    btnConsultar.disabled = this._corriendo;
    btnConsultar.textContent = `Consultar los ${this._lista.length}`;

    const faltan = this._faltantes().length;
    // El botón de registrar no existe hasta que la consulta diga a cuántos
    // hay que registrar: así nadie dispara altas a ciegas.
    btnRegistrar.classList.toggle('hidden', faltan === 0);
    btnRegistrar.disabled = this._corriendo;
    btnRegistrar.textContent = `Registrar los ${faltan} que faltan`;

    btnParar.classList.toggle('hidden', !this._corriendo);
  },

  async _recorrer(items, registrar) {
    this._corriendo = true;
    this._cancelar = false;
    this._pintarBotones();

    const progreso = document.getElementById('emp-sonar-progreso');
    let hechos = 0;
    const total = items.length;
    const cola = [...items];

    const trabajador = async () => {
      while (cola.length && !this._cancelar) {
        const emp = cola.shift();
        this._estado.set(emp.id, { estado: 'revisando', mensaje: '' });
        this._pintarTabla();
        let res = null;
        let mensaje = '';
        try {
          res = await DB.consultarConductorEnSonar(emp.id, registrar);
          mensaje = (res && res.message) || '';
        } catch (err) {
          mensaje = err.message;
        }
        this._estado.set(emp.id, { estado: this._clasificar(res), mensaje });
        hechos += 1;
        progreso.textContent = `${hechos} de ${total}${this._cancelar ? ' (detenido)' : ''}`;
        this._pintarTabla();
        this._pintarResumen();
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.CONCURRENCIA, total) }, () => trabajador()),
    );

    this._corriendo = false;
    this._pintarBotones();
    this._pintarResumen();
    progreso.textContent = this._cancelar
      ? `Detenido en ${hechos} de ${total}.`
      : `Listo: ${hechos} de ${total}.`;
  },

  async consultarTodos() {
    if (this._corriendo) return;
    await this._recorrer(this._lista, false);
  },

  async registrarFaltantes() {
    if (this._corriendo) return;
    const faltan = this._faltantes();
    if (!faltan.length) return;
    // Son altas en un sistema externo que ve toda la flota y no se deshacen
    // desde el ERP: se pregunta, con el número delante.
    const ok = window.confirm(
      `¿Registrar en Sonar a ${faltan.length} conductor(es)?\n\n`
      + 'Solo se registran los que la consulta dejó en "No está en Sonar". '
      + 'Esto no se puede deshacer desde el ERP.');
    if (!ok) return;
    await this._recorrer(faltan, true);
  },

  parar() {
    this._cancelar = true;
    document.getElementById('emp-sonar-progreso').textContent += ' — deteniendo…';
  },
};

window.SonarBarrido = SonarBarrido;
