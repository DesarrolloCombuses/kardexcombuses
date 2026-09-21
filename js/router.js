// Router simple por hash: muestra la sección <section data-view="..."> que
// coincide con location.hash y llama al init() de la vista registrada.
const Router = {
  views: {},
  current: null,

  register(name, viewDef = {}) {
    // Guarda el objeto de vista completo (no solo title/onEnter) para que
    // conserve sus propios métodos/estado (_render, _rows, _bound, etc.)
    // y el `this` dentro de onEnter siga apuntando a ese mismo objeto.
    this.views[name] = viewDef;
  },

  init(defaultView = 'dashboard') {
    // Se guarda para el fallback de _render(): cada rol tiene una vista de
    // "inicio" distinta (ej. el rol empleado no puede ver "dashboard"), así
    // que no se puede mandar siempre a 'dashboard' a quien le nieguen el
    // acceso a una vista -- eso sería un loop infinito para ese rol.
    this.defaultView = defaultView;
    window.addEventListener('hashchange', () => this._render());
    if (!location.hash) location.hash = `#/${defaultView}`;
    this._render();
  },

  navigate(name) {
    location.hash = `#/${name}`;
  },

  _render() {
    const name = (location.hash.replace('#/', '') || this.defaultView || 'dashboard').split('?')[0];
    if (!this.views[name]) return;

    // Defensa extra además de ocultar los enlaces del menú: si alguien
    // escribe a mano el hash de una sección que su cuenta no tiene
    // permitida (ej. #/salida con una cuenta de solo consulta), lo manda
    // de vuelta a su vista de inicio en vez de montar esa vista. Usar
    // this.defaultView (no 'dashboard' fijo) evita un loop infinito con
    // roles que no pueden ver dashboard (ej. el rol empleado).
    if (window.APP_ROLE && !Permissions.canAccessView(window.APP_ROLE, name, window.APP_GRUPO, window.APP_PERMISOS_MODULOS)) {
      this.navigate(this.defaultView || 'dashboard');
      return;
    }

    document.querySelectorAll('[data-view]').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === name);
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === name);
    });

    // Evita re-montar la misma vista dos veces seguidas: al cargar la app
    // sin hash todavía en la URL, fijar location.hash dispara "hashchange"
    // de forma asíncrona, pero _render() ya se había llamado de forma
    // síncrona justo antes para esa misma vista (ver init() más abajo).
    // Sin este guard, onEnter() se ejecuta dos veces y cosas como la
    // suscripción a Realtime truenan al intentar suscribirse dos veces
    // al mismo canal.
    if (this.current === name) return;

    if (this.current) {
      const prevView = this.views[this.current];
      if (prevView && prevView.onLeave) prevView.onLeave();
    }

    this.current = name;
    const view = this.views[name];
    const titleEl = document.getElementById('topbar-title');
    if (titleEl && view.title) titleEl.textContent = view.title;
    document.body.classList.remove('sidebar-open');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
    if (view.onEnter) this._entrar(name, view);
  },

  // Corre onEnter de la vista. Antes quita el aviso de error de una entrada
  // anterior: sin eso el banner rojo se quedaba pegado aunque la vista ya
  // hubiera cargado bien la segunda vez (se veía la lista completa y arriba
  // seguía el "No se pudo cargar esta sección" viejo).
  async _entrar(name, view) {
    this._quitarError(name);
    try {
      await view.onEnter();
    } catch (err) {
      if (await this._sesionPerdida(err)) return;
      this._showError(name, err);
    }
  },

  // Botón "Reintentar" del aviso de error. Llama antes a onLeave para que
  // la vista suelte lo que armó en su onEnter (ej. la suscripción a
  // Realtime de Dashboard/Historial) en vez de armarlo dos veces.
  reintentar(name) {
    const view = this.views[name];
    if (!view) return;
    if (view.onLeave) view.onLeave();
    this._entrar(name, view);
  },

  // La base responde "No autorizado" (o un error de JWT) no solo cuando a la
  // cuenta le falta un permiso, sino también cuando la petición le llega SIN
  // sesión: supabase-js manda la llave pública en vez del token del usuario
  // si no logra renovarlo (token vencido, pestaña que estuvo dormida, red
  // que se cayó un momento). Si de verdad ya no hay sesión guardada, no
  // tiene sentido dejar el mensaje suelto: se manda al login con el motivo.
  async _sesionPerdida(err) {
    if (!/no autorizado|jwt/i.test(err?.message || '')) return false;
    try {
      const { data } = await window.supabaseClient.auth.getSession();
      if (data?.session) return false;
    } catch (_) {
      return false;
    }
    sessionStorage.setItem('kardex_auth_error', 'Tu sesión venció. Ingresa de nuevo.');
    window.location.href = 'index.html';
    return true;
  },

  // Solo el aviso que arma _showError (hijo directo de la sección), no otros
  // elementos .view-error que una vista pinte por su cuenta (ej. Historial).
  _quitarError(viewName) {
    document.querySelector(`[data-view="${viewName}"] > .view-error`)?.remove();
  },

  _showError(viewName, err) {
    console.error(`Error cargando la vista "${viewName}":`, err);
    const section = document.querySelector(`[data-view="${viewName}"]`);
    if (!section) return;
    this._quitarError(viewName);

    const mensaje = err.message || err;
    const banner = document.createElement('div');
    banner.className = 'view-error';

    const texto = document.createElement('span');
    texto.textContent = `No se pudo cargar esta sección: ${mensaje}`;
    banner.append(texto);

    if (/no autorizado/i.test(mensaje)) {
      const pista = document.createElement('div');
      pista.className = 'view-error-pista';
      pista.textContent = 'Si tu cuenta sí tiene acceso a esta sección, suele ser que la sesión se venció: toca "Reintentar" o cierra sesión y vuelve a entrar.';
      banner.append(pista);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary view-error-retry';
    btn.textContent = 'Reintentar';
    btn.addEventListener('click', () => this.reintentar(viewName));
    banner.append(btn);

    section.prepend(banner);
  },
};
