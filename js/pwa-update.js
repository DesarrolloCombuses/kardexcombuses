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

  // Cada cuánto preguntar si ya hay versión nueva publicada. Con la app
  // abierta todo el día (el caso normal acá: se deja en una pestaña fija),
  // el navegador por su cuenta puede tardar hasta 24h en revisar el service
  // worker, así que sin este chequeo la pestaña se queda en la versión
  // vieja indefinidamente aunque ya esté publicada la nueva.
  const MINUTOS_CHEQUEO = 2;

  window.addEventListener('load', async () => {
    try {
      // updateViaCache:'none' evita que el navegador resuelva
      // service-worker.js desde su propio caché HTTP al chequear: sin esto
      // el chequeo puede "encontrar" el archivo viejo y concluir que no hay
      // nada nuevo.
      const registration = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });

      // Forzar el chequeo de versión nueva apenas carga la página, en vez
      // de esperar a que el navegador lo haga por su cuenta.
      registration.update();

      // OJO: acá nunca se recarga directo aunque version.json ya anuncie
      // otra versión. La recarga va atada a "controllerchange" (el service
      // worker nuevo YA tomó control) a propósito: si se recargara solo por
      // ver un número distinto, el service worker viejo seguiría sirviendo
      // el HTML viejo desde caché, la versión no cambiaría y la pestaña
      // quedaría recargándose en un ciclo infinito.
      let knownVersion = window.APP_CONFIG.APP_VERSION;
      const chequear = async () => {
        if (document.hidden) return;
        try {
          const res = await fetch('version.json', { cache: 'no-store' });
          const data = await res.json();
          if (data.version !== knownVersion) {
            knownVersion = data.version;
          }
          // Se llama siempre, no solo cuando version.json cambió: el
          // service worker puede tener cambios aunque el número no se haya
          // subido todavía en el archivo servido por caché intermedio.
          registration.update();
        } catch { /* sin conexión: ignorar, se reintenta en el próximo ciclo */ }
      };

      setInterval(chequear, MINUTOS_CHEQUEO * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) chequear(); });
      window.addEventListener('focus', chequear);
      window.addEventListener('online', chequear);
    } catch (err) {
      console.error('No se pudo registrar el service worker', err);
    }
  });
})();
