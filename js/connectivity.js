// Indicador de conexión: un banner fijo arriba de todo que avisa cuando se
// pierde internet (para que quede claro que lo que se está haciendo puede
// no estar guardándose) y cuando vuelve. navigator.onLine solo dice si hay
// una interfaz de red activa -- puede seguir en "true" con wifi conectado
// pero sin salida real a internet -- por eso además se verifica de forma
// activa contra Supabase cada cierto tiempo, no solo con los eventos
// online/offline del navegador.
(function () {
  let online = true;
  let banner = null;
  let verificando = false;
  let ocultarTimeout = null;

  function crearBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = 'connectivity-banner';
    banner.className = 'connectivity-banner hidden';
    document.body.appendChild(banner);
    return banner;
  }

  function pintar(estadoNuevo) {
    const el = crearBanner();
    clearTimeout(ocultarTimeout);
    if (estadoNuevo === 'offline') {
      el.className = 'connectivity-banner offline';
      el.textContent = 'Sin conexión a internet. Lo que hagas ahora puede no quedar guardado hasta que vuelva la señal.';
    } else if (estadoNuevo === 'restored') {
      el.className = 'connectivity-banner restored';
      el.textContent = 'Conexión restablecida.';
      ocultarTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
    } else {
      el.classList.add('hidden');
    }
  }

  function setOnline(value) {
    const eraOffline = !online;
    online = value;
    if (value) {
      pintar(eraOffline ? 'restored' : 'hidden');
    } else {
      pintar('offline');
    }
  }

  async function verificarReal() {
    if (verificando) return;
    verificando = true;
    try {
      const url = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL;
      if (!url) return;
      // No importa qué responda (hasta un 404 sirve) -- si fetch no lanza
      // error de red, es que sí hay conexión real hasta Supabase, no solo
      // hasta el router de la oficina/casa.
      await fetch(`${url}/auth/v1/health`, { method: 'GET', cache: 'no-store' });
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      verificando = false;
    }
  }

  window.addEventListener('online', verificarReal);
  window.addEventListener('offline', () => setOnline(false));

  setInterval(verificarReal, 20000);
  verificarReal();

  window.Connectivity = {
    isOnline: () => online,
    checkNow: verificarReal,
  };
})();
