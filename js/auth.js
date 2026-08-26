// Autenticación: login, logout y guardas de sesión.
const Auth = {
  async getSession() {
    const { data, error } = await window.supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async signIn(email, password) {
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  // Cierra la sesión sin navegar -- para usarla cuando ya estamos en index.html
  // y solo hace falta invalidar el token, no recargar la página.
  async signOutSilently() {
    await window.supabaseClient.auth.signOut();
  },

  async signOut() {
    await this.signOutSilently();
    window.location.href = 'index.html';
  },

  // Llamar al cargar index.html (login): si ya hay sesión, salta directo a la
  // app -- salvo que la cuenta ya no esté en la lista de autorizadas (por
  // ejemplo, se le quitó el acceso mientras tenía sesión abierta en otro
  // dispositivo), en cuyo caso se cierra la sesión y se queda en el login.
  async redirectIfAuthenticated() {
    const session = await this.getSession();
    if (!session) return;
    if (!Permissions.getRole(session.user.email)) {
      await this.signOutSilently();
      return;
    }
    window.location.href = 'app.html';
  },

  // Llamar al cargar app.html: si no hay sesión o la cuenta no está
  // autorizada, manda de vuelta al login (con el mensaje guardado para
  // mostrarlo ahí, ya que acá no hay dónde mostrarlo antes de navegar).
  async requireAuth() {
    const session = await this.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    if (!Permissions.getRole(session.user.email)) {
      await this.signOutSilently();
      sessionStorage.setItem('kardex_auth_error', 'No está permitido el ingreso con una cuenta distinta a las autorizadas.');
      window.location.href = 'index.html';
      return null;
    }
    return session;
  },
};
