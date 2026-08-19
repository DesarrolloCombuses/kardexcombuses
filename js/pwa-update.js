// Registra el service worker y avisa al usuario cuando hay una versión nueva.
//
// El service worker llama a skipWaiting()/clients.claim() apenas se instala,
// así que una versión nueva se activa sola en segundo plano sin esperar a
// que se cierren todas las pestañas abiertas. Cuando eso pasa, el navegador
// dispara "controllerchange" en cada pestaña — ahí mostramos el banner en
// vez de recargar solos, para no perder una firma/foto a medio capturar.
(function () {
  if (!('serviceWorker' in navigator)) return;

  const banner = document.getElementById('update-banner');
  const reloadBtn = document.getElementById('update-reload-btn');
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  function showBanner() {
    if (!banner) return;
    banner.classList.remove('hidden');
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      reloading = true;
      window.location.reload();
    });
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (hadController) {
      // Ya había una versión controlando esta pestaña: esto es una
      // actualización real, no el primer registro del service worker.
      showBanner();
    }
    hadController = true;
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('service-worker.js');

      // Respaldo: revisar version.json al recuperar el foco de la ventana,
      // por si el navegador tardó en chequear el service worker por su cuenta.
      let knownVersion = window.APP_CONFIG.APP_VERSION;
      window.addEventListener('focus', async () => {
        try {
          const res = await fetch('version.json', { cache: 'no-store' });
          const data = await res.json();
          if (data.version !== knownVersion) {
            knownVersion = data.version;
            registration.update();
          }
        } catch { /* sin conexión: ignorar */ }
      });
    } catch (err) {
      console.error('No se pudo registrar el service worker', err);
    }
  });
})();
