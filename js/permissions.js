// Control de acceso por cuenta. Quién es admin/viewer ya NO vive en una
// lista fija acá (hasta v1.102.0 sí, ver AUTHORIZED_USERS en el historial de
// git) -- la única fuente de verdad es la base de datos, tabla
// kardex_authorized_users, editable desde Usuarios ("Cuentas con acceso
// total") por cualquier cuenta admin. Se dejó de duplicar la lista a
// propósito: un cambio hecho solo en la tabla nunca se reflejaba en la app
// hasta el próximo despliegue de código, que es justo el problema que
// resuelve esto (ver sql/cuentas_autorizadas_editable_2026-09-22.sql).

// Vistas visibles para el rol "viewer" (solo consulta, sin firmar salidas
// ni modificar nada). El rol "admin" ve y puede hacer todo.
const VIEWER_ALLOWED_VIEWS = [
  'dashboard', 'inventario', 'inventario-historico', 'estadisticas', 'historial', 'facturas', 'ayuda',
];

// Vistas visibles para el rol "empleado" (autoservicio: un colaborador que
// solo pide/consulta sus propios permisos y mantiene sus propios datos, sin
// nada más del ERP). No hace falta darle ningún permiso desde Usuarios: las
// dos vistas solo muestran lo suyo, y el servidor lo resuelve por el correo
// de la sesión (kardex_own_employee_id()), no por lo que diga el cliente.
const EMPLEADO_ALLOWED_VIEWS = ['mis-permisos', 'mi-perfil'];

// Vistas extra que desbloquea cada grupo (ver sql/usuarios_grupos_2026-09-16.sql
// y js/views/usuarios.js) por encima de EMPLEADO_ALLOWED_VIEWS. Por ahora
// solo GESTION HUMANA tiene algo -- todo el dominio de Personal (mismas
// tablas que ya puede ver/editar/agregar admin ahí, ver
// sql/gestion_humana_modulos_2026-09-16.sql), más la bandeja de aprobación
// de permisos. Los demás grupos son solo un dato organizativo todavía, sin
// vista extra.
const GRUPO_EXTRA_VIEWS = {
  'GESTION HUMANA': [
    'permisos-vacaciones', 'aspirantes', 'empleados',
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores', 'personal-perfil', 'personal-rotacion',
    'actividades',
  ],
};

window.Permissions = {
  // Resuelve el rol de la cuenta que ya inició sesión: primero pregunta a
  // la base de datos si es admin/viewer (kardex_authorized_users, vía
  // DB.getMiRolAutorizado()), y si no lo es, revisa si su correo coincide
  // con el email_personal de algún empleado activo (rol "empleado",
  // autoservicio de permisos) -- eso sí vive en la base de datos
  // (kardex_own_employee_id(), ver sql/permisos_vacaciones_2026-09-15.sql)
  // porque no escala tener a cientos de empleados en una lista acá.
  async resolveRole() {
    const rol = await DB.getMiRolAutorizado();
    if (rol) return rol;
    const ownId = await DB.getOwnEmployeeId();
    return ownId ? 'empleado' : null;
  },

  // permisosModulos: mapa { [modulo]: {ver,agregar,editar,borrar} } del
  // empleado autenticado (ver DB.getMisPermisosModulos() y
  // sql/permisos_granulares_2026-09-16.sql) -- permisos sueltos que el
  // admin le dio a esta cuenta puntual, por encima de lo que ya da el
  // grupo.
  canAccessView(role, view, grupo, permisosModulos) {
    if (role === 'admin') return true;
    if (role === 'viewer') return VIEWER_ALLOWED_VIEWS.includes(view);
    if (role === 'empleado') {
      if (EMPLEADO_ALLOWED_VIEWS.includes(view)) return true;
      if ((GRUPO_EXTRA_VIEWS[grupo] || []).includes(view)) return true;
      return !!permisosModulos?.[view]?.ver;
    }
    return false;
  },
};
