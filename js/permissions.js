// Control de acceso por cuenta. A propósito vive acá (no en SQL/RLS) para
// poder cambiar quién entra y qué ve sin tocar la base de datos. OJO: esto
// solo oculta/bloquea cosas del lado de la app -- alguien que abriera la
// consola del navegador con una sesión "viewer" técnicamente podría seguir
// llamando a Supabase directo. Si eso llega a importar, la restricción real
// tiene que moverse a políticas RLS en el momento en que se necesite.
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
