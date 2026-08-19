// Inicializa el cliente de Supabase (supabase-js cargado vía CDN en el HTML).
window.supabaseClient = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
