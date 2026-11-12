# ERP Combuses

PWA en HTML/CSS/JS puro (sin build step) para la gestión de dotación y
personal de Combuses SA: kardex de entradas y salidas con firma electrónica
y foto en cada entrega, selección de aspirantes y perfil de empleados,
respaldada por Supabase (Postgres + Auth + Storage).

## 1. Configurar Supabase

Proyecto: `https://cbplebkmxrkaafqdhiyi.supabase.co` (ya cargado en [js/config.js](js/config.js)).

1. Abre el **SQL Editor** del proyecto en supabase.com y ejecuta, en este orden:
   1. [sql/schema.sql](sql/schema.sql) — tablas, trigger de stock, vista, RLS y buckets de Storage.
   2. [sql/seed_dotacion_javier.sql](sql/seed_dotacion_javier.sql) — carga el inventario inicial (17 categorías, 336 unidades). Al final corre un `select sum(stock_actual)` que debe dar `336`.
   3. [sql/backfill_entrada_inicial.sql](sql/backfill_entrada_inicial.sql) — registra ese inventario inicial como una **entrada** real en el Historial (el seed anterior escribe el stock directo, sin pasar por `kardex_movements`). Solo hace falta correrlo una vez; de ahí en adelante toda entrada/salida ya queda trazada automáticamente por la app.
   4. [sql/update_conductores_vehiculo.sql](sql/update_conductores_vehiculo.sql) — carga el número interno de vehículo y la ruta para los empleados que los tienen (sobre todo conductores), tomado del CSV de empleados. Seguro de re-ejecutar.
   5. [sql/facturas.sql](sql/facturas.sql) — tabla y bucket de Storage para guardar las facturas/soportes de compra (con su PDF o foto adjunto). Seguro de re-ejecutar.
   6. [sql/add_fecha_entrega.sql](sql/add_fecha_entrega.sql) — agrega la columna `fecha_entrega` a `kardex_movements` (fecha real de la entrega, elegida en el asistente de Salida). Seguro de re-ejecutar.
   7. [sql/update_base_vehiculo_2026-08-27.sql](sql/update_base_vehiculo_2026-08-27.sql) — carga la columna `base` de `employees` (el afiliado al que va dirigido el vehículo, ya agregada por el `alter table` de `schema.sql`), cruzando por número interno de vehículo en vez de por cédula. Seguro de re-ejecutar; si cambia la base de algún vehículo, se regenera este script igual que `sql/sync_empleados_*.sql`.
   8. [sql/add_factura_entrada.sql](sql/add_factura_entrada.sql) — agrega `factura_id` a `kardex_movements` para poder vincular cada entrada con la factura de la que salió (antes no había forma de identificarlo y se anotaba a mano en observaciones). Debe correrse después de `sql/facturas.sql`. Seguro de re-ejecutar.
   9. [sql/add_creado_por_nombre.sql](sql/add_creado_por_nombre.sql) — agrega `creado_por_nombre` a `kardex_movements`, guardado al momento de registrar cada entrada/salida (con respaldo al correo si `profiles` no tiene el nombre lleno), para que Historial y el Excel siempre identifiquen quién hizo cada movimiento. Seguro de re-ejecutar.
   10. [sql/perfil_sociodemografico.sql](sql/perfil_sociodemografico.sql) — tabla `perfil_sociodemografico` (edad, género, estado civil, escolaridad, vivienda, desplazamiento, etc. por empleado) para el diagnóstico del SG-SST, con RLS igual al resto de ERP Combuses. Seguro de re-ejecutar.
   11. [sql/sonar_conductores.sql](sql/sonar_conductores.sql) — agrega `sonar_synced_at`/`sonar_sync_error` a `employees`, para rastrear si un conductor de la ruta 700 ya quedó registrado en Sonar Telematics (ver sección "Integración con Sonar Telematics" más abajo). Seguro de re-ejecutar.
2. Ve a **Authentication → Users** y crea el/los usuarios que van a iniciar sesión (correo + contraseña). No hay registro público en la app: los usuarios se crean únicamente desde el dashboard.
   - `profiles` no tiene un trigger automático en este proyecto (es una tabla compartida con otro sistema). Si quieres que el nombre de un usuario aparezca completo en vez de su correo, agrega/edita su fila en `profiles` (columna `full_name`) desde el SQL Editor.

La *anon/publishable key* que está en `js/config.js` es segura de exponer en el cliente: la protección real de los datos la da Row Level Security (todas las tablas exigen sesión autenticada, sin acceso anónimo).

### Integración con Sonar Telematics (conductores de rutas 700, 2 y 41)

**Importante**: el proyecto Supabase de Combuses es compartido con el sistema de flota, que ya tiene su propio ecosistema de Edge Functions y secrets de Sonar (`asignar-conductor-sonar*`, `sonar-dispatch`, `sonar-sync-positions`, etc. — no viven en este repo). Antes de tocar cualquier secret o función de Sonar desde aquí, correr `supabase secrets list` y `supabase functions list` para no pisar algo que ya está en producción.

**El ERP consulta Sonar, no da de alta en Sonar.** El alta de un conductor se hace a mano en la plataforma de Sonar. No es una decisión de diseño: Sonar **no expone ninguna operación para crear conductores**. Está comprobado de dos formas, y conviene no volver a intentarlo sin leer esto:
- Contra el WSDL: `Service.asmx` declara 54 operaciones y `sapps.asmx` 32. De conductores solo hay lectura (`GET_Drivers`, `GET_Drivers_v2`, `GET_DriversByStatus`, `GET_DriversHistory`); la única escritura relacionada es `SET_DriverAssign`, que asigna a un conductor **que ya existe** a un móvil. La cadena "InsertDriver" no aparece en ninguno de los dos.
- Contra el servidor: mandando la petición con credenciales de prueba en las 5 combinaciones posibles de endpoint × SOAPAction (`tempuri/`, `sonaravl/`, `sonaravl/ServiceSoap/` en los dos endpoints), las 5 responden `No operation found for specified action`. La prueba es concluyente porque el servidor **sí distingue** los dos casos: a `GET_Drivers_v2` con esas mismas credenciales falsas responde "El nombre de usuario y/o la contraseña no son válidos", o sea que la operación existe y solo faltan credenciales.

Hasta v1.148.0 hubo aquí una función `sonar-insert-driver` que intentaba el alta con `SET_InsertDriver` y nunca creó a nadie; su error ("Sonar rechazó el envío") mandaba a Gestión Humana a corregir perfiles buscando una falla que no estaba en los datos. Si Sonar llega a habilitar un webservice de alta, el envelope que se usaba está en el historial de git (`git show v1.148.0 -- supabase/functions/sonar-insert-driver/index.ts`).

Lo que sí hace el ERP: cuando se guarda un empleado con cargo "Conductor" y una ruta configurada (ver `RUTAS_SONAR` en [js/views/empleados.js](js/views/empleados.js)) — y cada vez que se pulsa "Consultar en Sonar" en su ficha — consulta si esa cédula ya está registrada, con la Edge Function [supabase/functions/sonar-consultar-conductor](supabase/functions/sonar-consultar-conductor/index.ts), que:
- Solo se puede invocar con una sesión autenticada del ERP (no expone las credenciales de Sonar al cliente).
- **Busca en TODAS las flotas, no solo en la de su ruta.** Un conductor que cambió de ruta puede estar registrado en la flota de su ruta anterior; buscando solo en la que le toca hoy, el ERP diría "no está" cuando sí está. Eso es justo lo que explicaba el rechazo "Existe otro conductor con la misma identificación": Sonar lo encontraba en la otra flota y el ERP no.
- Distingue "no está" de "no se pudo consultar", y dice en cada caso qué hacer (crearlo en Sonar, habilitarlo, o moverlo de flota).
- **Combuses tiene más de una cuenta/flota en Sonar** — no todas las rutas comparten usuario ni flota. La función resuelve cada ruta a una "cuenta" (ver `RUTA_A_CUENTA` dentro del archivo):
  - `urbana` (rutas 700 y AEROPUERTO): secrets `SONAR_USER` / `SONAR_PASSWORD` / `SONAR_FLEET_ID`, ya existentes en el proyecto (compartidos con `asignar-conductor-sonar-v2`).
  - `urbana2` (rutas 2, 41, 313, ZAMORA-ARANJUEZ y ARANJUEZ - GUADALUPE): secrets `SONAR_USER_2` / `SONAR_PASSWORD_2` / `SONAR_FLEET_ID_2`, creados para esta integración.
  - Para sumar una ruta nueva: si ya usa una cuenta existente, agregarla a `RUTA_A_CUENTA` (y a `RUTAS_SONAR` en `empleados.js`); si es una cuenta nueva, crear sus secrets con un sufijo nuevo (`_3`, etc.) y agregar la entrada en `SONAR_ACCOUNTS`.

Para desplegarla o actualizarla:
```bash
supabase functions deploy sonar-consultar-conductor --project-ref cbplebkmxrkaafqdhiyi
```
Las credenciales de Sonar se configuran con `supabase secrets set SONAR_USER_N=... SONAR_PASSWORD_N=... SONAR_FLEET_ID_N=... --project-ref cbplebkmxrkaafqdhiyi` — nunca se escriben en este repo.

### Mantener actualizados los empleados

Los empleados vienen de la hoja maestra de RRHH/flota de Combuses (Google
Sheets, publicada como CSV). La app no se conecta sola a esa hoja — Google
bloquea la lectura directa desde el navegador (CORS) para links publicados,
así que la sincronización es manual:

1. Cuando haya cambios (ingresos, retiros, cambio de cargo/vehículo/ruta),
   comparte de nuevo el link publicado de la hoja.
2. Se regenera un script tipo [sql/sync_empleados_2026-08-26.sql](sql/sync_empleados_2026-08-26.sql)
   — un `insert ... on conflict (cedula) do update` idempotente que trae
   *solo* lo que usa ERP Combuses (nombre, cédula, cargo, área, activo,
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
perfil-publico.html    Página pública sin login (link + cédula) para que el nuevo empleado complete su perfil básico
js/perfil-publico.js   Lógica de perfil-publico.html
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
js/views/*.js                 Lógica de cada vista (dashboard, inventario, inventario histórico, estadísticas, agregar prenda, entrada, salida, aspirantes —selección de personal—, empleados —incluye el perfil sociodemográfico—, historial, facturas, ayuda)
supabase/functions/sonar-consultar-conductor   Edge Function: consulta en qué flota de Sonar Telematics está registrado un conductor (ver "Integración con Sonar Telematics" arriba)
sql/schema.sql, sql/seed_dotacion_javier.sql, sql/backfill_entrada_inicial.sql, sql/update_conductores_vehiculo.sql, sql/facturas.sql, sql/add_fecha_entrega.sql, sql/update_base_vehiculo_*.sql, sql/add_factura_entrada.sql, sql/add_creado_por_nombre.sql, sql/perfil_sociodemografico.sql, sql/aspirantes.sql, sql/perfil_publico.sql (funciones RPC que usa perfil-publico.html para validar la cédula del lado del servidor sin necesitar sesión), sql/link_facturas_observaciones_*.sql (cruza a mano una sola vez el número de factura que haya quedado en Observaciones de entradas viejas contra facturas.numero_factura), sql/sync_empleados_*.sql (el más reciente es la última sincronización con RRHH, ver "Mantener actualizados los empleados" arriba), sql/sonar_conductores.sql (columnas de seguimiento de la consulta a Sonar)
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
