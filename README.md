# Kardex de Dotación — Combuses SA

PWA en HTML/CSS/JS puro (sin build step) para llevar el kardex de entradas y
salidas de dotación, con firma electrónica y foto en cada entrega, respaldada
por Supabase (Postgres + Auth + Storage).

## 1. Configurar Supabase

Proyecto: `https://cbplebkmxrkaafqdhiyi.supabase.co` (ya cargado en [js/config.js](js/config.js)).

1. Abre el **SQL Editor** del proyecto en supabase.com y ejecuta, en este orden:
   1. [sql/schema.sql](sql/schema.sql) — tablas, trigger de stock, vista, RLS y buckets de Storage.
   2. [sql/seed_dotacion_javier.sql](sql/seed_dotacion_javier.sql) — carga el inventario inicial (17 categorías, 336 unidades). Al final corre un `select sum(stock_actual)` que debe dar `336`.
   3. [sql/backfill_entrada_inicial.sql](sql/backfill_entrada_inicial.sql) — registra ese inventario inicial como una **entrada** real en el Historial (el seed anterior escribe el stock directo, sin pasar por `kardex_movements`). Solo hace falta correrlo una vez; de ahí en adelante toda entrada/salida ya queda trazada automáticamente por la app.
   4. [sql/update_conductores_vehiculo.sql](sql/update_conductores_vehiculo.sql) — carga el número interno de vehículo y la ruta para los empleados que los tienen (sobre todo conductores), tomado del CSV de empleados. Seguro de re-ejecutar.
   5. [sql/facturas.sql](sql/facturas.sql) — tabla y bucket de Storage para guardar las facturas/soportes de compra (con su PDF o foto adjunto). Seguro de re-ejecutar.
   6. [sql/add_fecha_entrega.sql](sql/add_fecha_entrega.sql) — agrega la columna `fecha_entrega` a `kardex_movements` (fecha real de la entrega, elegida en el asistente de Salida). Seguro de re-ejecutar.
2. Ve a **Authentication → Users** y crea el/los usuarios que van a iniciar sesión (correo + contraseña). No hay registro público en la app: los usuarios se crean únicamente desde el dashboard.
   - `profiles` no tiene un trigger automático en este proyecto (es una tabla compartida con otro sistema). Si quieres que el nombre de un usuario aparezca completo en "Entregado por", agrega/edita su fila en `profiles` (columna `full_name`) desde el SQL Editor.

La *anon/publishable key* que está en `js/config.js` es segura de exponer en el cliente: la protección real de los datos la da Row Level Security (todas las tablas exigen sesión autenticada, sin acceso anónimo).

### Mantener actualizados los empleados

Los empleados vienen de la hoja maestra de RRHH/flota de Combuses (Google
Sheets, publicada como CSV). La app no se conecta sola a esa hoja — Google
bloquea la lectura directa desde el navegador (CORS) para links publicados,
así que la sincronización es manual:

1. Cuando haya cambios (ingresos, retiros, cambio de cargo/vehículo/ruta),
   comparte de nuevo el link publicado de la hoja.
2. Se regenera un script tipo [sql/sync_empleados_2026-08-26.sql](sql/sync_empleados_2026-08-26.sql)
   — un `insert ... on conflict (cedula) do update` idempotente que trae
   *solo* lo que usa el Kardex (nombre, cédula, cargo, área, activo,
   vehículo/ruta). Deliberadamente no importa los campos sensibles de esa
   hoja (salario, EPS/AFP, dirección, teléfono, fecha de nacimiento, etc.),
   que no tienen nada que ver con el control de dotación.
3. Se ejecuta en el SQL Editor de Supabase. No borra ni desactiva a nadie
   que no aparezca en la hoja (así no se pierde a alguien cargado a mano
   desde la app).

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
js/permissions.js        Correos autorizados y rol (admin/viewer) de cada uno
js/auth.js               Login/logout/guardas de sesión
js/db.js                  Acceso a datos (Postgres + Storage)
js/signature-pad.js       Firma electrónica en <canvas>
js/camera.js               Captura de foto con la cámara del dispositivo
js/router.js                Navegación por hash entre vistas
js/pwa-update.js            Aviso de nueva versión disponible
js/pwa-install.js            Botón "Instalar app" (evento beforeinstallprompt)
js/app.js                    Bootstrap
js/views/*.js                 Lógica de cada vista (dashboard, inventario, inventario histórico, estadísticas, agregar prenda, entrada, salida, empleados, historial, facturas, ayuda)
sql/schema.sql, sql/seed_dotacion_javier.sql, sql/backfill_entrada_inicial.sql, sql/update_conductores_vehiculo.sql, sql/facturas.sql, sql/add_fecha_entrega.sql, sql/sync_empleados_*.sql (el más reciente es la última sincronización con RRHH, ver "Mantener actualizados los empleados" arriba)
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
