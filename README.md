# Kardex de Dotación — Combuses SA

PWA en HTML/CSS/JS puro (sin build step) para llevar el kardex de entradas y
salidas de dotación, con firma electrónica y foto en cada entrega, respaldada
por Supabase (Postgres + Auth + Storage).

## 1. Configurar Supabase

Proyecto: `https://cbplebkmxrkaafqdhiyi.supabase.co` (ya cargado en [js/config.js](js/config.js)).

1. Abre el **SQL Editor** del proyecto en supabase.com y ejecuta, en este orden:
   1. [sql/schema.sql](sql/schema.sql) — tablas, trigger de stock, vista, RLS y buckets de Storage.
   2. [sql/seed_dotacion_javier.sql](sql/seed_dotacion_javier.sql) — carga el inventario inicial (17 categorías, 336 unidades). Al final corre un `select sum(stock_actual)` que debe dar `336`.
2. Ve a **Authentication → Users** y crea el/los usuarios que van a iniciar sesión (correo + contraseña). No hay registro público en la app: los usuarios se crean únicamente desde el dashboard.
   - Al crear un usuario se dispara un trigger que crea su fila en `profiles` automáticamente.
   - Si quieres que su nombre aparezca completo en "Entregado por", edita `profiles.nombre_completo` para ese usuario desde el SQL Editor.

La *anon/publishable key* que está en `js/config.js` es segura de exponer en el cliente: la protección real de los datos la da Row Level Security (todas las tablas exigen sesión autenticada, sin acceso anónimo).

## 2. Servir la app localmente

Los Service Workers solo funcionan sobre HTTPS o `localhost`, así que no basta con abrir el HTML con doble clic. Usa cualquier servidor estático, por ejemplo:

```bash
npx serve .
# o
python -m http.server 8080
```

Luego abre `http://localhost:PUERTO/index.html`, inicia sesión con el usuario creado en Supabase.

## 3. Publicar / hospedar

Son archivos estáticos: cualquier hosting con HTTPS sirve (Netlify, Vercel, GitHub Pages, Firebase Hosting, un servidor propio con Nginx, etc.). Solo súbelo tal cual — no requiere paso de compilación.

## 4. Estructura

```
index.html            Login
app.html               Shell de la aplicación (todas las vistas)
manifest.webmanifest   Metadatos PWA
service-worker.js      Cache versionado del app shell
version.json           Número de versión actual
css/styles.css
js/config.js            URL + anon key de Supabase, versión de la app
js/supabase-client.js
js/auth.js               Login/logout/guardas de sesión
js/db.js                  Acceso a datos (Postgres + Storage)
js/signature-pad.js       Firma electrónica en <canvas>
js/camera.js               Captura de foto con la cámara del dispositivo
js/router.js                Navegación por hash entre vistas
js/pwa-update.js            Aviso de nueva versión disponible
js/app.js                    Bootstrap
js/views/*.js                 Lógica de cada vista (dashboard, inventario, entrada, salida, empleados, historial)
sql/schema.sql, sql/seed_dotacion_javier.sql
```

## 5. Publicar una nueva versión

El versionado de caché es manual (no hay build step):

1. Sube el número en [version.json](version.json).
2. Sube `APP_VERSION` en [service-worker.js](service-worker.js) (primera línea) al mismo valor — esto cambia el nombre del caché y fuerza a que el navegador reinstale el Service Worker.
3. Opcionalmente sube también `APP_VERSION` en [js/config.js](js/config.js) (solo informativo).
4. Al desplegar, los usuarios que ya tengan la app abierta verán el banner **"Hay una nueva versión disponible"** y podrán actualizar con un clic; los caches antiguos se eliminan automáticamente.

## 6. Flujo de uso

- **Entrada**: repone stock de una categoría/talla (sin firma ni foto).
- **Salida (entrega)**: selecciona empleado, agrega una o varias prendas, captura la firma del receptor, una foto del receptor y la firma de quien entrega (bodega). El stock se descuenta automáticamente vía trigger en la base de datos, que además rechaza la operación si no hay stock suficiente.
- **Historial**: lista todos los movimientos; al hacer clic en uno se ven sus líneas y, si es una salida, las firmas y foto de evidencia (se generan URLs firmadas temporales desde los buckets privados).
