// Service Worker con caché versionado. Al liberar una nueva versión:
// 1) subir el número en version.json, 2) actualizar APP_VERSION aquí abajo.
const APP_VERSION = '1.57.0';
const CACHE_NAME = `kardex-cache-v${APP_VERSION}`;

const APP_SHELL = [
  'index.html',
  'app.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/config.js',
  'js/supabase-client.js',
  'js/permissions.js',
  'js/auth.js',
  'js/db.js',
  'js/router.js',
  'js/text-uppercase.js',
  'js/catalogos-colombia.js',
  'js/signature-pad.js',
  'js/camera.js',
  'js/views/dashboard.js',
  'js/views/inventario.js',
  'js/views/inventario-historico.js',
  'js/views/estadisticas.js',
  'js/views/nueva-prenda.js',
  'js/views/entrada.js',
  'js/views/salida.js',
  'js/views/aspirantes.js',
  'js/views/empleados.js',
  'js/views/estadisticas-personal.js',
  'js/views/historial.js',
  'js/views/facturas.js',
  'js/views/ayuda.js',
  'js/pwa-update.js',
  'js/pwa-install.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Activa esta versión de inmediato en vez de quedarse "esperando" hasta
  // que se cierren todas las pestañas abiertas (lo que en la práctica casi
  // nunca pasa y dejaba a la gente atascada en versiones viejas).
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // { cache: 'reload' } es clave: cache.addAll() por sí solo puede
      // reusar una copia que el navegador todavía considera "fresca" en su
      // propio caché HTTP (por Last-Modified), aunque ya haya una versión
      // nueva en el servidor. Eso explicaba que, al liberar una versión,
      // algunos archivos se actualizaran y otros se quedaran atrás según
      // cuál tuviera el caché del navegador vencido en ese momento.
      Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: 'reload' }).then((response) => cache.put(url, response))
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear llamadas a la API/Storage de Supabase: deben ir siempre a la red.
  if (url.hostname.endsWith('supabase.co')) return;

  // Solo interceptar GET same-origin; todo lo demás pasa directo a la red.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
