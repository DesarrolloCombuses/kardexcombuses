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

window.Permissions = {
  getRole(email) {
    return AUTHORIZED_USERS[(email || '').trim().toLowerCase()] || null;
  },

  isAuthorized(email) {
    return this.getRole(email) !== null;
  },

  canAccessView(role, view) {
    if (role === 'admin') return true;
    if (role === 'viewer') return VIEWER_ALLOWED_VIEWS.includes(view);
    return false;
  },
};
