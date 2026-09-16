(async function bootstrap() {
  const session = await Auth.requireAuth();
  if (!session) return;

  window.APP_ROLE = await Permissions.resolveRole(session.user.email);
  window.APP_GRUPO = window.APP_ROLE === 'empleado' ? await DB.getMiGrupo() : null;
  window.APP_PERMISOS_MODULOS = window.APP_ROLE === 'empleado' ? await DB.getMisPermisosModulos() : null;

  document.getElementById('user-email').textContent = session.user.email;
  document.getElementById('user-avatar').textContent = session.user.email.slice(0, 2).toUpperCase();
  document.getElementById('logout-btn').addEventListener('click', () => Auth.signOut());
  // Visible a propósito (no solo en DevTools) para poder confirmar de un
  // vistazo si el navegador ya sirvió la versión nueva después de un
  // despliegue, sin depender de que aparezca el banner de actualización.
  document.getElementById('sidebar-version').textContent = `v${window.APP_CONFIG.APP_VERSION}`;

  if (window.APP_ROLE === 'empleado') {
    // Autoservicio de un colaborador: no es una cuenta administrativa, así
    // que se le quita TODO el menú salvo "Mis permisos" -- lista blanca en
    // vez de negra, para que un ítem nuevo que se agregue después no quede
    // visible por accidente para este rol. GESTION HUMANA además tiene todo
    // el dominio de Personal (ver kardex_es_gestion_humana()), así que
    // también ve esas vistas.
    const extra = window.APP_GRUPO === 'GESTION HUMANA' ? [
      'permisos-vacaciones', 'aspirantes', 'empleados',
      'personal-cumpleanos', 'personal-alertas', 'personal-conductores', 'personal-perfil',
    ] : [];
    // Permisos sueltos por módulo (ver DB.getMisPermisosModulos()): cualquier
    // módulo donde el admin le haya dado "ver" a esta cuenta puntual, por
    // encima de lo que ya da el grupo.
    Object.keys(window.APP_PERMISOS_MODULOS || {}).forEach((modulo) => {
      if (window.APP_PERMISOS_MODULOS[modulo].ver && !extra.includes(modulo)) extra.push(modulo);
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      if (el.dataset.nav !== 'mis-permisos' && !extra.includes(el.dataset.nav)) el.remove();
    });
    document.querySelectorAll('.nav-group').forEach((group) => {
      if (!group.querySelector('[data-nav]')) group.remove();
    });
  } else {
    // admin/viewer son cuentas administrativas, no fichas de empleado -- no
    // les corresponde el autoservicio de "Mis permisos".
    document.querySelector('[data-nav="mis-permisos"]')?.remove();
    // "Usuarios" (crear cuentas) es exclusivo del admin.
    if (window.APP_ROLE !== 'admin') document.querySelector('[data-nav="usuarios"]')?.remove();

    // Cuentas de solo consulta: se quitan del menú las secciones que no
    // pueden ver (Router también las bloquea si alguien escribe el hash a
    // mano, esto es solo para que ni aparezcan como opción).
    if (window.APP_ROLE === 'viewer') {
      ['nueva-prenda', 'entrada', 'salida', 'aspirantes', 'empleados', 'personal-cumpleanos', 'personal-alertas', 'personal-conductores', 'personal-perfil', 'permisos-vacaciones', 'usuarios'].forEach((name) => {
        document.querySelector(`[data-nav="${name}"]`)?.remove();
      });
      // Si al quitar los ítems de arriba un submenú (Inventario/Movimientos/
      // Personal) se quedó sin ningún enlace adentro, se quita el submenú
      // completo para no dejar un encabezado colapsable vacío.
      document.querySelectorAll('.nav-group').forEach((group) => {
        if (!group.querySelector('[data-nav]')) group.remove();
      });
    }
  }

  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const closeSidebar = () => {
    document.body.classList.remove('sidebar-open');
    sidebarBackdrop.classList.add('hidden');
  };
  sidebarToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    sidebarBackdrop.classList.toggle('hidden', !open);
  });
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // Modal compartido (detalle de movimiento en Historial, alta de prenda en
  // Inventario, etc.): el cierre se maneja acá una sola vez para toda la
  // app, en vez de que cada vista registre su propio listener sobre los
  // mismos elementos.
  const modalBackdrop = document.getElementById('modal-backdrop');
  const closeModal = () => {
    modalBackdrop.classList.add('hidden');
    // modal-wide la agrega el visor de facturas (necesita más ancho); se
    // quita acá para que no se quede pegada la próxima vez que se abra
    // el modal compartido desde otra vista (ej. detalle de Historial).
    document.getElementById('modal-box').classList.remove('modal-wide');
  };
  modalBackdrop.querySelector('#modal-close').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  Router.init(window.APP_ROLE === 'empleado' ? 'mis-permisos' : 'dashboard');
})();
