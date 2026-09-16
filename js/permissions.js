// Control de acceso por cuenta. Esta lista decide qué ve cada quien dentro
// de la app (rol admin/viewer) y se puede cambiar sin tocar la base de
// datos. La restricción real -- que un correo fuera de esta lista no pueda
// leer ni escribir nada de Kardex aunque tenga sesión válida en el proyecto
// de Supabase compartido -- vive además en la base de datos: la tabla
// kardex_authorized_users y la función kardex_is_authorized() (ver
// sql/rls_solo_autorizados_2026-09-15.sql), usadas en las policies RLS de
// las tablas propias de Kardex. IMPORTANTE: cuando se agregue o quite a
// alguien acá, hay que repetir el cambio en esa tabla, o quedará
// autorizado/bloqueado distinto en la app que en la base de datos.
const AUTHORIZED_USERS = {
  'kardex@combuses.com.co': 'admin',
  'vinculaciones@combuses.com.co': 'admin',
  'analistafacturacion@combuses.com.co': 'viewer',
  'contabilidad@combuses.com.co': 'viewer',
};

// Vistas visibles para el rol "viewer" (solo consulta, sin firmar salidas
// ni modificar nada). El rol "admin" ve y puede hacer todo.
const VIEWER_ALLOWED_VIEWS = [
  'dashboard', 'inventario', 'inventario-historico', 'estadisticas', 'historial', 'facturas', 'ayuda',
];

// Vistas visibles para el rol "empleado" (autoservicio: un colaborador que
// solo pide/consulta sus propios permisos, sin nada más del ERP).
const EMPLEADO_ALLOWED_VIEWS = ['mis-permisos'];

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
    'personal-cumpleanos', 'personal-alertas', 'personal-conductores', 'personal-perfil',
  ],
};

window.Permissions = {
  getRole(email) {
    return AUTHORIZED_USERS[(email || '').trim().toLowerCase()] || null;
  },

  isAuthorized(email) {
    return this.getRole(email) !== null;
  },

  // Resuelve el rol de una cuenta: primero contra la lista fija de arriba
  // (admin/viewer, sin ir a la base de datos), y si no está ahí, revisa si
  // el correo coincide con el email_personal de algún empleado activo (rol
  // "empleado", autoservicio de permisos). No escala tener a cientos de
  // empleados en AUTHORIZED_USERS uno por uno, por eso ese segundo camino
  // vive en la base de datos (kardex_own_employee_id(), ver
  // sql/permisos_vacaciones_2026-09-15.sql) en vez de acá.
  async resolveRole(email) {
    const staticRole = this.getRole(email);
    if (staticRole) return staticRole;
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
