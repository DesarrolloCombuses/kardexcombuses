(async function bootstrap() {
  const session = await Auth.requireAuth();
  if (!session) return;

  document.getElementById('user-email').textContent = session.user.email;
  document.getElementById('user-avatar').textContent = session.user.email.slice(0, 2).toUpperCase();
  document.getElementById('logout-btn').addEventListener('click', () => Auth.signOut());

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

  Router.init('dashboard');
})();
