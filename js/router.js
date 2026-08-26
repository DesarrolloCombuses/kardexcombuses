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
    window.addEventListener('hashchange', () => this._render());
    if (!location.hash) location.hash = `#/${defaultView}`;
    this._render();
  },

  navigate(name) {
    location.hash = `#/${name}`;
  },

  _render() {
    const name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    if (!this.views[name]) return;

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
    if (view.onEnter) {
      Promise.resolve(view.onEnter()).catch((err) => this._showError(name, err));
    }
  },

  _showError(viewName, err) {
    console.error(`Error cargando la vista "${viewName}":`, err);
    const section = document.querySelector(`[data-view="${viewName}"]`);
    if (!section) return;
    let banner = section.querySelector('.view-error');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'view-error';
      section.prepend(banner);
    }
    banner.textContent = `No se pudo cargar esta sección: ${err.message || err}`;
  },
};
