// Capa de acceso a datos: Postgres (via supabase-js) + Storage.
const DB = {
  // ---- Catálogo / inventario ----------------------------------------------

  async getStockActual() {
    const { data, error } = await window.supabaseClient
      .from('v_stock_actual')
      .select('*')
      .order('categoria')
      .order('talla');
    if (error) throw error;
    return data;
  },

  async getCategories() {
    const { data, error } = await window.supabaseClient
      .from('item_categories')
      .select('id, nombre, item_variants(id, talla, stock_actual)')
      .order('nombre');
    if (error) throw error;
    return data;
  },

  // ---- Perfil del usuario logueado ------------------------------------------

  async getMyProfile() {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return null;
    const { data, error } = await window.supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // ---- Empleados ------------------------------------------------------------

  async getEmployees({ onlyActive = false } = {}) {
    let query = window.supabaseClient.from('employees').select('*').order('nombre');
    if (onlyActive) query = query.eq('activo', true);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async createEmployee(employee) {
    const { data, error } = await window.supabaseClient
      .from('employees')
      .insert(employee)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateEmployee(id, changes) {
    const { data, error } = await window.supabaseClient
      .from('employees')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---- Movimientos (kardex) --------------------------------------------------

  async getMovements({ tipo, employeeId, from, to } = {}) {
    let query = window.supabaseClient
      .from('kardex_movements')
      .select(`
        *,
        employees ( nombre, cedula ),
        kardex_movement_items (
          id, cantidad, stock_resultante,
          item_variants ( talla, item_categories ( nombre ) )
        )
      `)
      .order('fecha', { ascending: false });

    if (tipo) query = query.eq('tipo', tipo);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (from) query = query.gte('fecha', from);
    if (to) query = query.lte('fecha', to);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Inserta el encabezado del movimiento y sus líneas. El trigger de la BD
  // actualiza stock_actual y valida que no quede negativo en salidas.
  async createMovement({ header, lines }) {
    const { data: movement, error: movementError } = await window.supabaseClient
      .from('kardex_movements')
      .insert(header)
      .select()
      .single();
    if (movementError) throw movementError;

    const itemsPayload = lines.map((line) => ({
      movement_id: movement.id,
      item_variant_id: line.item_variant_id,
      cantidad: line.cantidad,
    }));

    const { error: itemsError } = await window.supabaseClient
      .from('kardex_movement_items')
      .insert(itemsPayload);
    if (itemsError) throw itemsError;

    return movement;
  },

  async anularMovimiento(movementId) {
    const { error } = await window.supabaseClient.rpc('anular_movimiento', { p_movement_id: movementId });
    if (error) throw error;
  },

  // ---- Storage: firmas y fotos ------------------------------------------------

  async uploadToBucket(bucket, blob, extension) {
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error } = await window.supabaseClient.storage
      .from(bucket)
      .upload(path, blob, { contentType: blob.type || `image/${extension}` });
    if (error) throw error;
    return path;
  },

  async getSignedUrl(bucket, path, expiresInSeconds = 3600) {
    if (!path) return null;
    const { data, error } = await window.supabaseClient.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  // ---- Tiempo real ------------------------------------------------------------

  // Se suscribe a INSERT/UPDATE/DELETE en una o varias tablas y llama a
  // onChange en cada evento. Devuelve el channel para poder cerrarlo luego
  // con DB.unsubscribe(channel) al salir de la vista.
  subscribeToChanges(channelName, tables, onChange) {
    let channel = window.supabaseClient.channel(channelName);
    tables.forEach((table) => {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
    });
    channel.subscribe();
    return channel;
  },

  unsubscribe(channel) {
    if (channel) window.supabaseClient.removeChannel(channel);
  },
};
