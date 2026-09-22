// Registra el service worker y avisa al usuario cuando hay una versión nueva.
//
// El service worker llama a skipWaiting()/clients.claim() apenas se instala,
// así que una versión nueva se activa sola en segundo plano sin esperar a
// que se cierren todas las pestañas abiertas. Cuando eso pasa, el navegador
// dispara "controllerchange" en cada pestaña -- ahí mostramos el banner con
// una cuenta regresiva y recargamos solos si nadie hace nada: da un chance
// corto de terminar algo en curso (firmar, tomar una foto) sin quedar
// esperando indefinidamente a que alguien note el aviso y le dé clic.
(function () {
  if (!('serviceWorker' in navigator)) return;

  const SEGUNDOS_AUTO_RECARGA = 10;

  const banner = document.getElementById('update-banner');
  const bannerTexto = document.getElementById('update-banner-texto');
  const reloadBtn = document.getElementById('update-reload-btn');
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  let cuentaRegresiva = null;

  function recargar() {
    if (reloading) return;
    reloading = true;
    clearInterval(cuentaRegresiva);
    window.location.reload();
  }

  function showBanner() {
    if (!banner) return;
    banner.classList.remove('hidden');
    let restantes = SEGUNDOS_AUTO_RECARGA;
    const actualizarTexto = () => {
      if (bannerTexto) bannerTexto.textContent = `Hay una nueva versión disponible. Se actualiza sola en ${restantes}s…`;
    };
    actualizarTexto();
    clearInterval(cuentaRegresiva);
    cuentaRegresiva = setInterval(() => {
      restantes--;
      if (restantes <= 0) { recargar(); return; }
      actualizarTexto();
    }, 1000);
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', recargar);
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

      // Forzar el chequeo de versión nueva apenas carga la página, en vez
      // de esperar a que el navegador lo haga por su cuenta (puede tardar
      // hasta 24h) o a que la pestaña recupere el foco.
      registration.update();

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
