// Overlay de carga global: se muestra mientras se guarda/registra algo, en
// cualquier vista de la app (empleados, aspirantes, entrada, salida,
// facturas, perfil público...). Antes la única señal era un texto chico
// "Guardando…" dentro del formulario -- fácil de no ver, sobre todo en
// celular -- y con conexión lenta o inestable la persona no sabía si su
// clic había hecho algo o no.
//
// Uso: Loading.show('Guardando…') / Loading.hide(). Lleva un contador para
// que llamadas anidadas (ej. sube una foto y despues guarda el resto) no
// oculten el overlay antes de tiempo -- solo se oculta cuando el contador
// vuelve a cero.
(function () {
  let contador = 0;
  let overlayEl = null;

  function crearOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'loading-overlay';
    overlayEl.className = 'loading-overlay hidden';
    overlayEl.innerHTML = `
      <div class="loading-overlay-box">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span class="loading-overlay-msg" id="loading-overlay-msg">Guardando…</span>
      </div>
    `;
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  window.Loading = {
    show(mensaje) {
      contador++;
      const el = crearOverlay();
      document.getElementById('loading-overlay-msg').textContent = mensaje || 'Guardando…';
      el.classList.remove('hidden');
    },
    // Cambia el mensaje sin abrir un nivel nuevo -- para cuando una misma
    // operación pasa por varias etapas (ej. "Subiendo foto…" y después
    // "Guardando…") y ya se llamó show() una vez para toda la operación.
    setMessage(mensaje) {
      const msgEl = document.getElementById('loading-overlay-msg');
      if (msgEl) msgEl.textContent = mensaje;
    },
    hide() {
      contador = Math.max(0, contador - 1);
      if (contador === 0 && overlayEl) overlayEl.classList.add('hidden');
    },
  };
})();
