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

  // Reconstruye el stock que tenía cada prenda/talla al final del día
  // indicado, usando el stock_resultante que ya queda guardado en cada
  // línea de movimiento (no hay que recalcular nada desde cero: solo
  // tomar, por cada talla, el último movimiento no anulado hasta esa
  // fecha). Las tallas que todavía no existían en esa fecha quedan en 0,
  // que es el valor correcto.
  async getStockAsOf(dateISO) {
    const [categorias, { data: historyRows, error }] = await Promise.all([
      this.getCategories(),
      window.supabaseClient
        .from('kardex_movement_items')
        .select('item_variant_id, stock_resultante, kardex_movements!inner(fecha, anulado)')
        .eq('kardex_movements.anulado', false)
        .lte('kardex_movements.fecha', dateISO),
    ]);
    if (error) throw error;

    // El orden en que vienen las filas no está garantizado, así que en vez
    // de depender de un ORDER BY sobre la tabla relacionada, se compara la
    // fecha de cada línea y se queda con la más reciente por talla.
    const stockPorVariante = new Map();
    historyRows.forEach((row) => {
      const actual = stockPorVariante.get(row.item_variant_id);
      if (!actual || row.kardex_movements.fecha > actual.fecha) {
        stockPorVariante.set(row.item_variant_id, { fecha: row.kardex_movements.fecha, stock: row.stock_resultante });
      }
    });

    const rows = [];
    categorias.forEach((cat) => {
      const variantes = [...cat.item_variants].sort((a, b) => a.talla.localeCompare(b.talla));
      const totalCategoria = variantes.reduce((sum, v) => sum + (stockPorVariante.get(v.id)?.stock || 0), 0);
      variantes.forEach((v) => {
        rows.push({
          categoria: cat.nombre,
          talla: v.talla,
          stock_actual: stockPorVariante.get(v.id)?.stock || 0,
          stock_total_categoria: totalCategoria,
        });
      });
    });
    rows.sort((a, b) => a.categoria.localeCompare(b.categoria) || a.talla.localeCompare(b.talla));
    return rows;
  },

  async getEarliestMovementDate() {
    const { data, error } = await window.supabaseClient
      .from('kardex_movements')
      .select('fecha')
      .eq('anulado', false)
      .order('fecha', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data[0]?.fecha ?? null;
  },

  async getCategories() {
    const { data, error } = await window.supabaseClient
      .from('item_categories')
      .select('id, nombre, item_variants(id, talla, stock_actual)')
      .order('nombre');
    if (error) throw error;
    return data;
  },

  // Da de alta una prenda nueva (o le agrega tallas nuevas a una que ya
  // existe, si el nombre coincide) y, si alguna talla trae cantidad
  // inicial, la registra como una ENTRADA real -- nunca escribe
  // stock_actual directo, para no repetir el problema del inventario
  // inicial (stock sin movimiento que lo explique en el Historial).
  async createPrendaConTallas({ categoriaNombre, tallas, createdBy }) {
    // Todo en mayúscula: así el catálogo queda uniforme (los datos que ya
    // existían del inventario inicial también están en mayúscula) y no
    // aparecen categorías duplicadas solo porque alguien las escribió con
    // otra combinación de mayúsculas/minúsculas.
    const nombre = categoriaNombre.trim().toUpperCase();
    const tallasNormalizadas = tallas.map((t) => ({ ...t, talla: t.talla.trim().toUpperCase() }));

    const { data: existentes, error: findError } = await window.supabaseClient
      .from('item_categories')
      .select('id, nombre')
      .ilike('nombre', nombre);
    if (findError) throw findError;

    let category = existentes.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (!category) {
      const { data: nueva, error: catError } = await window.supabaseClient
        .from('item_categories')
        .insert({ nombre })
        .select('id, nombre')
        .single();
      if (catError) throw catError;
      category = nueva;
    }

    const { data: tallasExistentes, error: tallasError } = await window.supabaseClient
      .from('item_variants')
      .select('talla')
      .eq('item_category_id', category.id);
    if (tallasError) throw tallasError;
    const existentesSet = new Set(tallasExistentes.map((v) => v.talla.toUpperCase()));

    const nuevas = tallasNormalizadas.filter((t) => !existentesSet.has(t.talla));
    const omitidas = tallasNormalizadas.filter((t) => existentesSet.has(t.talla));

    if (nuevas.length === 0) {
      return { category, creadas: [], omitidas };
    }

    const { data: variantesCreadas, error: variantsError } = await window.supabaseClient
      .from('item_variants')
      .insert(nuevas.map((t) => ({ item_category_id: category.id, talla: t.talla, stock_actual: 0 })))
      .select('id, talla');
    if (variantsError) throw variantsError;

    const lineasConStock = variantesCreadas
      .map((v) => {
        const original = nuevas.find((t) => t.talla.trim().toLowerCase() === v.talla.toLowerCase());
        return { item_variant_id: v.id, cantidad: original ? original.cantidad : 0 };
      })
      .filter((l) => l.cantidad > 0);

    if (lineasConStock.length > 0) {
      await this.createMovement({
        header: {
          tipo: 'entrada',
          observaciones: 'Alta de prenda/talla nueva en el catálogo',
          created_by: createdBy,
        },
        lines: lineasConStock,
      });
    }

    return { category, creadas: variantesCreadas, omitidas };
  },

  // ---- Facturas ---------------------------------------------------------------

  async getFacturas() {
    const { data, error } = await window.supabaseClient
      .from('facturas')
      .select('*')
      .order('fecha_remision', { ascending: false });
    if (error) throw error;

    const userIds = [...new Set(data.map((f) => f.created_by).filter(Boolean))];
    let perfiles = {};
    if (userIds.length > 0) {
      const { data: profilesData, error: profilesError } = await window.supabaseClient
        .from('profiles')
        .select('id, full_name, username')
        .in('id', userIds);
      if (profilesError) throw profilesError;
      perfiles = Object.fromEntries(
        profilesData.map((p) => [p.id, p.full_name || p.username || 'Usuario'])
      );
    }

    return data.map((f) => ({
      ...f,
      creado_por_nombre: f.created_by ? (perfiles[f.created_by] || 'Usuario') : null,
    }));
  },

  async createFactura({ numeroFactura, fechaRemision, archivoFile, observaciones, createdBy }) {
    const extension = (archivoFile.name.split('.').pop() || 'pdf').toLowerCase();
    const archivoUrl = await this.uploadToBucket('facturas', archivoFile, extension);

    const { data, error } = await window.supabaseClient
      .from('facturas')
      .insert({
        numero_factura: numeroFactura,
        fecha_remision: fechaRemision,
        archivo_url: archivoUrl,
        archivo_nombre: archivoFile.name,
        observaciones,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteFactura(id) {
    const { error } = await window.supabaseClient.from('facturas').delete().eq('id', id);
    if (error) throw error;
  },

  // ---- Aspirantes (proceso de selección) -------------------------------------

  // Trae también, embebido, el estado de aprobación del perfil del empleado
  // ya convertido (si lo hay) -- "seleccionar" al aspirante (crearle el
  // empleado y mandarle el link) es distinto de "aprobar" su perfil (que
  // ya tiene todos los datos y lo revisó Gestión Humana), y esa segunda
  // parte vive en employees, no en aspirantes.
  async getAspirantes() {
    const { data, error } = await window.supabaseClient
      .from('aspirantes')
      .select('*, employees ( perfil_aprobado_at, perfil_aprobado_por )')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async createAspirante({ nombre, cedula, telefono, cargoAspirado, areaAspirada, hojaVidaFile, observaciones }) {
    let hojaVidaUrl = null;
    let hojaVidaNombre = null;
    if (hojaVidaFile) {
      const extension = (hojaVidaFile.name.split('.').pop() || 'pdf').toLowerCase();
      hojaVidaUrl = await this.uploadToBucket('hojas-vida', hojaVidaFile, extension);
      hojaVidaNombre = hojaVidaFile.name;
    }
    const { data, error } = await window.supabaseClient
      .from('aspirantes')
      .insert({
        nombre,
        cedula: cedula || null,
        telefono: telefono || null,
        cargo_aspirado: cargoAspirado || null,
        area_aspirada: areaAspirada || null,
        hoja_vida_url: hojaVidaUrl,
        hoja_vida_nombre: hojaVidaNombre,
        observaciones: observaciones || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateAspiranteEstado(id, estado) {
    const { error } = await window.supabaseClient
      .from('aspirantes')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async deleteAspirante(id) {
    const { error } = await window.supabaseClient.from('aspirantes').delete().eq('id', id);
    if (error) throw error;
  },

  // Crea el empleado a partir de los datos ya digitados del aspirante (nombre,
  // cédula, cargo al que aspiraba) y deja el vínculo guardado en
  // aspirantes.employee_id -- así no se puede convertir dos veces por error
  // y la lista de Aspirantes puede mostrar "Ya es empleado" en vez del botón.
  async convertirAspiranteAEmpleado(aspirante) {
    const nuevoEmpleado = await this.createEmployee({
      nombre: aspirante.nombre,
      cedula: aspirante.cedula,
      cargo: aspirante.cargo_aspirado || null,
      area: aspirante.area_aspirada || null,
      activo: true,
    });
    const { error } = await window.supabaseClient
      .from('aspirantes')
      .update({ employee_id: nuevoEmpleado.id, updated_at: new Date().toISOString() })
      .eq('id', aspirante.id);
    if (error) throw error;
    return nuevoEmpleado;
  },

  // "Seleccionar" en un solo paso: marca Contratado y convierte a empleado
  // de una vez, en vez de los dos pasos separados de antes. Ojo: esto NO es
  // la aprobación final del perfil (ver aprobarPerfilEmpleado) -- es elegir
  // a este candidato y dejarle listo el link para que llene sus datos.
  async seleccionarAspirante(aspirante) {
    await this.updateAspiranteEstado(aspirante.id, 'Contratado');
    return this.convertirAspiranteAEmpleado(aspirante);
  },

  // Aprobación final: la hace Gestión Humana una vez el empleado ya
  // diligenció su perfil por el link público y lo revisaron. Queda quién y
  // cuándo para trazabilidad. guardarPerfilPublico() limpia estos dos
  // campos automáticamente si la persona vuelve a guardar algo después --
  // la aprobación debe corresponder siempre a los datos vigentes.
  async aprobarPerfilEmpleado(employeeId) {
    const nombre = await this.getMyDisplayName();
    const { error } = await window.supabaseClient
      .from('employees')
      .update({ perfil_aprobado_at: new Date().toISOString(), perfil_aprobado_por: nombre })
      .eq('id', employeeId);
    if (error) throw error;
  },

  async quitarAprobacionPerfil(employeeId) {
    const { error } = await window.supabaseClient
      .from('employees')
      .update({ perfil_aprobado_at: null, perfil_aprobado_por: null })
      .eq('id', employeeId);
    if (error) throw error;
  },

  // Revierte una aprobación: borra el empleado que se había creado
  // (contactos/hijos/perfil se van solos por el "on delete cascade" de esas
  // tablas) y deja al aspirante en el estado indicado -- "En proceso" si fue
  // un clic por error y se quiere retomar, o "Descartado" si a mitad del
  // proceso resultó que no sigue. Si el empleado ya tiene movimientos de
  // dotación registrados, el borrado falla por la relación en
  // kardex_movements -- eso es a propósito, evita perder historial real.
  async revertirAprobacion(aspirante, estadoDestino) {
    const { error: delError } = await window.supabaseClient
      .from('employees')
      .delete()
      .eq('id', aspirante.employee_id);
    if (delError) throw delError;
    const { error } = await window.supabaseClient
      .from('aspirantes')
      .update({ employee_id: null, estado: estadoDestino, updated_at: new Date().toISOString() })
      .eq('id', aspirante.id);
    if (error) throw error;
  },

  // ---- Perfil público (autodiligenciamiento por el nuevo empleado) ----------

  // Sin sesión iniciada: se llama desde perfil-publico.html. La validación
  // de que la cédula corresponda al employee_id del link (y la edad mínima)
  // las hace la función (security definer) del lado del servidor, no el
  // cliente -- ver sql/perfil_publico.sql. La función devuelve un solo
  // objeto jsonb con casi todo el perfil sociodemográfico + contactos de
  // emergencia, para no tener que declarar cada campo en la firma.
  async obtenerPerfilPublico(employeeId, cedula) {
    const { data, error } = await window.supabaseClient
      .rpc('perfil_publico_obtener', { p_employee_id: employeeId, p_cedula: cedula });
    if (error) throw error;
    return data;
  },

  // perfil: objeto plano con las claves de perfil_sociodemografico/telefono
  // que aplican al autodiligenciamiento. contactos: arreglo {nombre,
  // parentesco, telefono} (reemplaza los existentes, igual que
  // saveContactosEmergencia). fotoUrl: el path ya subido con
  // uploadFotoPublico, o null si no se tocó la foto en este guardado.
  async guardarPerfilPublico(employeeId, cedula, perfil, contactos, fotoUrl) {
    const { error } = await window.supabaseClient.rpc('perfil_publico_guardar', {
      p_employee_id: employeeId,
      p_cedula: cedula,
      p_perfil: perfil,
      p_contactos: contactos || [],
      p_foto_url: fotoUrl || null,
    });
    if (error) throw error;
  },

  // Ruta fija por empleado ("perfil-publico/<id>.jpg"): permite que subir
  // de nuevo la foto reemplace la anterior (upsert), y es lo que habilita
  // la policy de Storage a validar el path sin depender de la cédula -- ver
  // sql/perfil_publico.sql.
  async uploadFotoPublico(employeeId, blob) {
    const path = `perfil-publico/${employeeId}.jpg`;
    const { error } = await window.supabaseClient.storage
      .from('fotos-empleados')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    return path;
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

  // Nombre para mostrar/guardar como "quien registró" un movimiento. Cae a
  // profiles.full_name/username, y si nadie llenó esa fila (pasa seguido:
  // profiles es una tabla compartida con otro sistema, ver README), al
  // correo de la sesión -- así el Excel de Historial siempre identifica a
  // la persona en vez de mostrar el genérico "Usuario" para todos.
  async getMyDisplayName() {
    const [profile, { data }] = await Promise.all([
      this.getMyProfile(),
      window.supabaseClient.auth.getUser(),
    ]);
    return (profile && (profile.full_name || profile.username)) || data.user?.email || 'Usuario';
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

  // ---- Perfil sociodemográfico -----------------------------------------------

  // Solo el employee_id de cada fila que ya tiene perfil cargado -- para
  // marcar "Completo"/"Pendiente" en el listado sin traer los ~20 campos
  // de cada uno de los cientos de empleados de una sola vez.
  async getEmployeeIdsConPerfilSociodemografico() {
    const { data, error } = await window.supabaseClient
      .from('perfil_sociodemografico')
      .select('employee_id');
    if (error) throw error;
    return new Set(data.map((r) => r.employee_id));
  },

  async getPerfilSociodemografico(employeeId) {
    const { data, error } = await window.supabaseClient
      .from('perfil_sociodemografico')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async savePerfilSociodemografico(employeeId, perfil) {
    const { data, error } = await window.supabaseClient
      .from('perfil_sociodemografico')
      .upsert(
        { ...perfil, employee_id: employeeId, updated_at: new Date().toISOString() },
        { onConflict: 'employee_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Empleados + su perfil sociodemográfico embebido en una sola consulta
  // (relación 1 a 1 por el unique de employee_id) -- para las estadísticas
  // de personal, que necesitan los ~18 campos de cada uno, no solo si
  // existe o no como en getEmployeeIdsConPerfilSociodemografico(). También
  // trae contactos de emergencia e hijos (1 a muchos, PostgREST los
  // devuelve como arreglo) para no tener que pedirlos aparte al abrir cada
  // ficha o formulario de empleado.
  async getEmployeesConPerfil({ onlyActive = true } = {}) {
    let query = window.supabaseClient
      .from('employees')
      .select('*, perfil_sociodemografico ( * ), contactos_emergencia ( * ), hijos_empleado ( * )')
      .order('nombre');
    if (onlyActive) query = query.eq('activo', true);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // ---- Contactos de emergencia e hijos ---------------------------------------

  // Ambas son listas (un empleado puede tener varios), así que en vez de un
  // upsert por fila se reemplaza todo de una vez: se borran las filas
  // existentes del empleado y se insertan las actuales -- más simple que
  // llevar el control de cuáles filas cambiaron/se borraron desde un
  // formulario con filas que se agregan y quitan libremente.
  async saveContactosEmergencia(employeeId, contactos) {
    const { error: delError } = await window.supabaseClient
      .from('contactos_emergencia')
      .delete()
      .eq('employee_id', employeeId);
    if (delError) throw delError;
    if (!contactos.length) return;
    const { error } = await window.supabaseClient
      .from('contactos_emergencia')
      .insert(contactos.map((c) => ({ ...c, employee_id: employeeId })));
    if (error) throw error;
  },

  async saveHijosEmpleado(employeeId, hijos) {
    const { error: delError } = await window.supabaseClient
      .from('hijos_empleado')
      .delete()
      .eq('employee_id', employeeId);
    if (delError) throw delError;
    if (!hijos.length) return;
    const { error } = await window.supabaseClient
      .from('hijos_empleado')
      .insert(hijos.map((h) => ({ ...h, employee_id: employeeId })));
    if (error) throw error;
  },

  // ---- Movimientos (kardex) --------------------------------------------------

  // page/pageSize son opcionales: si no se pasan, trae todo (se usa así
  // para la exportación a Excel, que sí necesita el historial completo).
  // Cuando sí se pasan, se pide el conteo exacto junto con la página para
  // poder mostrar "Página X de Y" sin traer todas las filas al navegador
  // -- importante si hay miles de movimientos (entregas masivas).
  async getMovements({ tipo, employeeId, from, to, fechaEntregaFrom, fechaEntregaTo, page, pageSize } = {}) {
    let query = window.supabaseClient
      .from('kardex_movements')
      .select(`
        *,
        employees ( nombre, cedula, cargo, area, numero_interno, ruta, base ),
        facturas ( numero_factura, fecha_remision ),
        kardex_movement_items (
          id, cantidad, stock_resultante,
          item_variants ( talla, item_categories ( nombre ) )
        )
      `, pageSize ? { count: 'exact' } : {})
      .order('fecha', { ascending: false });

    if (tipo) query = query.eq('tipo', tipo);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (from) query = query.gte('fecha', from);
    if (to) query = query.lte('fecha', to);
    // Filtro por período (Abril/Agosto/Diciembre): usa fecha_entrega, no
    // fecha -- una entrada nunca la tiene, así que con este filtro activo
    // quedan excluidas automáticamente (el período es un concepto que solo
    // aplica a salidas/entregas). Ver Historial._PERIODOS.
    if (fechaEntregaFrom) query = query.gte('fecha_entrega', fechaEntregaFrom);
    if (fechaEntregaTo) query = query.lte('fecha_entrega', fechaEntregaTo);
    if (pageSize) {
      const start = (page - 1) * pageSize;
      query = query.range(start, start + pageSize - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // created_by/anulado_por apuntan a auth.users, no directamente a
    // profiles, así que no se puede embeber vía PostgREST -- se resuelven
    // aparte. Para created_by esto es solo un respaldo: desde que existe
    // la columna kardex_movements.creado_por_nombre (guardada al momento
    // de registrar, ver DB.getMyDisplayName en entrada.js/salida.js) ya
    // no depende de que profiles tenga el nombre lleno -- este fallback
    // por perfiles solo aplica a movimientos de antes de esa columna.
    const userIds = [...new Set(
      data.flatMap((m) => [m.created_by, m.anulado_por]).filter(Boolean)
    )];
    let perfiles = {};
    if (userIds.length > 0) {
      const { data: profilesData, error: profilesError } = await window.supabaseClient
        .from('profiles')
        .select('id, full_name, username')
        .in('id', userIds);
      if (profilesError) throw profilesError;
      perfiles = Object.fromEntries(
        profilesData.map((p) => [p.id, p.full_name || p.username || 'Usuario'])
      );
    }

    const movements = data.map((m) => ({
      ...m,
      creado_por_nombre: m.creado_por_nombre || (m.created_by ? (perfiles[m.created_by] || 'Usuario') : null),
      anulado_por_nombre: m.anulado_por ? (perfiles[m.anulado_por] || 'Usuario') : null,
    }));

    return { movements, total: pageSize ? count : movements.length };
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
