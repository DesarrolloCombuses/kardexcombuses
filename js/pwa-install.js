// Botón "Instalar app" explícito. Chrome en Android ya no muestra un aviso
// automático en la mayoría de las visitas (solo deja la opción escondida en
// el menú de tres puntos), así que sin esto la gente cree que no se puede
// instalar. Cualquier elemento con [data-install-btn] en la página se
// muestra apenas el navegador confirma (vía beforeinstallprompt) que la
// instalación es posible, y dispara el diálogo nativo al hacer clic.
(function () {
  let deferredPrompt = null;

  function buttons() {
    return document.querySelectorAll('[data-install-btn]');
  }

  function show() {
    buttons().forEach((btn) => btn.classList.remove('hidden'));
  }

  function hide() {
    buttons().forEach((btn) => btn.classList.add('hidden'));
  }

  // Ya instalada (abierta como app standalone): nunca tiene sentido ofrecer instalarla.
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    show();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hide();
  });

  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-install-btn]');
    if (!btn || !deferredPrompt) return;
    btn.disabled = true;
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } finally {
      hide();
      btn.disabled = false;
    }
  });
})();
