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

  async signOut() {
    await window.supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  },

  // Llamar al cargar index.html (login): si ya hay sesión, salta directo a la app.
  async redirectIfAuthenticated() {
    const session = await this.getSession();
    if (session) window.location.href = 'app.html';
  },

  // Llamar al cargar app.html: si no hay sesión, exige login.
  async requireAuth() {
    const session = await this.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  },
};
