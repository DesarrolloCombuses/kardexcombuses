// Capa de acceso a datos: Postgres (via supabase-js) + Storage.
const DB = {
  // Cifras del Panel/Dashboard (categorías, stock total, empleados activos,
  // stock bajo, últimos movimientos) ya agregadas en el servidor -- a
  // diferencia del resto de este archivo, acá no se consultan las tablas
  // directo: kardex_dashboard_kpis() (ver sql/dashboard_permiso_2026-09-21.sql)
  // filtra por permiso y devuelve solo los campos que pinta la pantalla, para
  // que dar "ver" en 'dashboard' no abra por REST la tabla completa de
  // employees (con cédula/salario/etc.) solo para mostrar un conteo.
  async getDashboardKpis() {
    const { data, error } = await window.supabaseClient.rpc('kardex_dashboard_kpis');
    if (error) throw error;
    return data;
  },

  // Cuentas "superadmin" (rol admin/viewer, ven todo sin pasar por el
  // sistema de permisos granulares) -- viven en kardex_authorized_users, una
  // tabla sin policies propias (ver sql/rls_solo_autorizados_2026-09-15.sql),
  // así que solo se leen/escriben a través de estas funciones. Es la ÚNICA
  // fuente de verdad de quién es admin/viewer (ver Permissions.resolveRole
  // en js/permissions.js) -- ya no hay una lista duplicada en el código.
  async getCuentasAutorizadas() {
    const { data, error } = await window.supabaseClient.rpc('kardex_cuentas_autorizadas');
    if (error) throw error;
    return data;
  },

  // Mi propio rol admin/viewer (o null si no tengo) -- autoconsulta sin
  // permiso especial, ver sql/cuentas_autorizadas_editable_2026-09-22.sql.
  async getMiRolAutorizado() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mi_rol_autorizado');
    if (error) throw error;
    return data;
  },

  // Dar o cambiar el rol admin/viewer de OTRA cuenta -- exige que quien
  // llama ya sea admin, y rechaza que alguien se cambie a sí mismo (ver la
  // migración de arriba).
  async guardarCuentaAutorizada(email, rol) {
    const { error } = await window.supabaseClient.rpc('kardex_guardar_cuenta_autorizada', { p_email: email, p_rol: rol });
    if (error) throw error;
  },

  // Quitarle el acceso total a OTRA cuenta -- no borra su login de Supabase
  // Auth, solo deja de estar en esta lista (ver el comentario de la función
  // en SQL).
  async quitarCuentaAutorizada(email) {
    const { error } = await window.supabaseClient.rpc('kardex_quitar_cuenta_autorizada', { p_email: email });
    if (error) throw error;
  },

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

  // Para detectar reingresos (alguien que ya trabajó acá) antes de intentar
  // crear el empleado. employees.cedula ya no es única a secas -- solo lo es
  // ENTRE ACTIVOS (ver employees_cedula_activo_unique en schema.sql) -- así
  // que puede haber varios registros inactivos con la misma cédula (uno por
  // cada paso de esa persona por la empresa); esta consulta los trae todos,
  // el más reciente primero, para poder avisar antes de crear uno nuevo.
  async buscarEmpleadosPorCedula(cedula) {
    const { data, error } = await window.supabaseClient
      .from('employees')
      .select('id, nombre, activo, fecha_salida, motivo_renuncia')
      .eq('cedula', cedula)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Todos los registros (activo + inactivos) de una cédula, del más
  // antiguo al más reciente -- para pintar "Historial de vinculación" en
  // la ficha del empleado (ver _cargarHistorialVinculacion en empleados.js).
  // Más de una fila significa reingreso: alguien que ya trabajó acá, se
  // fue, y volvió a ser contratado (ver employees_cedula_activo_unique en
  // schema.sql, que permite varios inactivos con la misma cédula).
  async getHistorialVinculacion(cedula) {
    const { data, error } = await window.supabaseClient
      .from('employees')
      .select('id, nombre, cargo, area, activo, fecha_salida, motivo_renuncia, perfil_sociodemografico ( fecha_ingreso )')
      .eq('cedula', cedula)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  // Base/afiliado al que está asignado un vehículo, para autocompletar el
  // campo "Base" en vivo apenas se digita el número interno (en vez de
  // esperar a guardar y que lo corrija el trigger sync_employee_base_from_vehiculo).
  async buscarBaseVehiculo(numeroInterno) {
    const { data, error } = await window.supabaseClient
      .from('vehiculo_bases')
      .select('base')
      .eq('numero_interno', numeroInterno)
      .maybeSingle();
    if (error) throw error;
    return data ? data.base : null;
  },

  // Comparendos (infracciones de tránsito) y accidentes por cédula, para el
  // Paz y Salvo -- a diferencia de los siniestros (Google Sheet externo),
  // este dato sí vive en Supabase porque el usuario lo sube a mano cada
  // cierto tiempo (ver sql/accidentes_infracciones_import_*.sql).
  async buscarInfraccionesPorCedula(cedula) {
    const { data, error } = await window.supabaseClient
      .from('infracciones_transito')
      .select('comparendo_nro, fecha_comparendo, codigo_infraccion, infraccion, tipo_comparendo, placa')
      .eq('cedula', cedula)
      .order('fecha_comparendo', { ascending: false });
    if (error) throw error;
    return data;
  },

  async buscarAccidentesPorCedula(cedula) {
    const { data, error } = await window.supabaseClient
      .from('accidentes_transito')
      .select('nro_croquis, fecha_accidente, clase_accidente, gravedad_accidente, direccion, placa')
      .eq('cedula', cedula)
      .order('fecha_accidente', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Todos los comparendos/accidentes (no filtrados por una cédula puntual),
  // para la vista de estadísticas de Siniestros de tránsito.
  async getInfraccionesTransito() {
    const { data, error } = await window.supabaseClient
      .from('infracciones_transito')
      .select('comparendo_nro, fecha_comparendo, placa, codigo_infraccion, infraccion, tipo_comparendo, cedula, nombre_infractor')
      .order('fecha_comparendo', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getAccidentesTransito() {
    const { data, error } = await window.supabaseClient
      .from('accidentes_transito')
      .select('nro_croquis, fecha_accidente, direccion, placa, clase_accidente, gravedad_accidente, cedula, nombre_infractor')
      .order('fecha_accidente', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Parque automotor: se lee de flota_vehiculos/flota_documentos_estado, las
  // tablas reales del "Portal de Documentos" que usan los coordinadores de
  // ruta (programa aparte, mismo proyecto de Supabase) -- ahí es donde
  // realmente se suben los PDF/fotos de SOAT, tecnomecánica, tarjeta de
  // operación y mantenimiento preventivo, con storage_path apuntando al
  // archivo real en el bucket "flota-documentos". La tabla vieja
  // parque_automotor (un import congelado, sin los archivos reales) ya no
  // se usa acá.
  async getFlotaVehiculos() {
    const { data, error } = await window.supabaseClient
      .from('flota_vehiculos')
      .select('*')
      .order('placa');
    if (error) throw error;
    return data;
  },

  // flota_documentos_estado es una vista: un renglón por documento (placa +
  // tipo) con el estado de vencimiento ya calculado (VENCIDO/POR_VENCER/
  // VIGENTE/SIN_FECHA, mismo umbral de 30 días que se usaba acá) y el
  // storage_path si ya se subió el archivo real.
  async getFlotaDocumentosEstado() {
    const { data, error } = await window.supabaseClient
      .from('flota_documentos_estado')
      .select('*');
    if (error) throw error;
    return data;
  },

  // URL firmada (expira pronto, el bucket es privado) para abrir/descargar
  // el documento real de un vehículo.
  async getUrlDocumentoFlota(storagePath) {
    const { data, error } = await window.supabaseClient
      .storage.from('flota-documentos')
      .createSignedUrl(storagePath, 300);
    if (error) throw error;
    return data.signedUrl;
  },

  // Crea el empleado a partir de los datos ya digitados del aspirante (nombre,
  // cédula, cargo al que aspiraba) y deja el vínculo guardado en
  // aspirantes.employee_id -- así no se puede convertir dos veces por error
  // y la lista de Aspirantes puede mostrar "Ya es empleado" en vez del botón.
  // Un reingreso (alguien que ya trabajó acá) crea un registro NUEVO -- el
  // historial inactivo anterior se deja intacto, sin reactivarlo ni
  // mezclarlo (ver buscarEmpleadosPorCedula, usado en aspirantes.js para
  // avisar antes de llegar acá).
  async convertirAspiranteAEmpleado(aspirante) {
    const empleado = await this.createEmployee({
      nombre: aspirante.nombre,
      cedula: aspirante.cedula,
      cargo: aspirante.cargo_aspirado || null,
      area: aspirante.area_aspirada || null,
      activo: true,
    });
    const { error } = await window.supabaseClient
      .from('aspirantes')
      .update({ employee_id: empleado.id, updated_at: new Date().toISOString() })
      .eq('id', aspirante.id);
    if (error) throw error;
    return empleado;
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
  async guardarPerfilPublico(employeeId, cedula, perfil, contactos, hijos, fotoUrl) {
    const { error } = await window.supabaseClient.rpc('perfil_publico_guardar', {
      p_employee_id: employeeId,
      p_cedula: cedula,
      p_perfil: perfil,
      p_contactos: contactos || [],
      p_hijos: hijos || [],
      p_foto_url: fotoUrl || null,
    });
    if (error) throw error;
  },

  // Historial de perfil_publico_guardar() para un empleado: qué campo
  // cambió, con qué valor antes y después, cada vez que alguien guarda
  // desde el link público. Solo lectura (RLS: authenticated), las filas las
  // crea únicamente esa función (security definer).
  async getAuditoriaPerfilPublico(employeeId) {
    const { data, error } = await window.supabaseClient
      .from('perfil_publico_auditoria')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Sube la foto vía Edge Function (subir-foto-perfil-publico) en vez de
  // Storage directo -- Supabase rechaza cualquier insert/update del rol
  // anon en un bucket privado sin importar qué digan las policies (se
  // confirmó contra producción: incluso una policy "to public, with check
  // (true)" fallaba iguial, mientras que el mismo request contra un bucket
  // público sí funcionaba -- es una restricción de la plataforma). La
  // función usa el service role del lado del servidor para poder escribir
  // en el bucket privado, y valida que employeeId corresponda a un
  // empleado real antes de guardar. Ruta fija ("perfil-publico/<id>.jpg")
  // para que volver a subir reemplace la anterior.
  async uploadFotoPublico(employeeId, blob) {
    const { data, error } = await window.supabaseClient.functions.invoke('subir-foto-perfil-publico', {
      body: blob,
      headers: { 'Content-Type': 'image/jpeg', 'x-employee-id': employeeId },
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message || 'No se pudo subir la foto.');
    return data.path;
  },

  // ---- Mi perfil (autoservicio DENTRO de la app, con sesión) ----------------

  // Mismo perfil que el link público, pero el servidor resuelve de quién es
  // por el correo del JWT en vez de pedir la cédula (ver
  // sql/mi_perfil_2026-09-22.sql). Devuelve también employee_id, que hace
  // falta para subir la foto.
  async getMiPerfil() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mi_perfil_obtener');
    if (error) throw error;
    return data;
  },

  // fotoNueva es un booleano, no la ruta: la arma el servidor con el id que
  // él mismo resolvió, para que una cuenta no pueda dejar su foto_url
  // apuntando al archivo de otra persona.
  async guardarMiPerfil(perfil, contactos, hijos, fotoNueva) {
    const { error } = await window.supabaseClient.rpc('kardex_mi_perfil_guardar', {
      p_perfil: perfil,
      p_contactos: contactos || [],
      p_hijos: hijos || [],
      p_foto_nueva: !!fotoNueva,
    });
    if (error) throw error;
  },

  // Solo nombre + fecha de nacimiento: corre en cada carga de la app para
  // decidir si toca saludar. Devuelve null si la cuenta no es de un empleado
  // activo (las administrativas no lo son).
  async getMiCumpleanos() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mi_cumpleanos');
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

  // Mismo límite de 1000 filas por consulta que getEmployeesConPerfil -- ver
  // el comentario ahí para el detalle.
  async getEmployees({ onlyActive = false } = {}) {
    const PAGE_SIZE = 1000;
    let empleados = [];
    let desde = 0;
    for (;;) {
      let query = window.supabaseClient.from('employees').select('*').order('nombre').range(desde, desde + PAGE_SIZE - 1);
      if (onlyActive) query = query.eq('activo', true);
      const { data, error } = await query;
      if (error) throw error;
      empleados = empleados.concat(data);
      if (data.length < PAGE_SIZE) break;
      desde += PAGE_SIZE;
    }
    return empleados;
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

  // Llama a la Edge Function que inserta/actualiza al conductor en Sonar
  // Telematics (SOAP). Las credenciales de Sonar viven como secrets de la
  // función, nunca en el cliente. Requiere sesión activa (auth: 'user').
  async enviarConductorASonar(employeeId) {
    const { data, error } = await window.supabaseClient.functions.invoke('sonar-insert-driver', {
      body: { employee_id: employeeId },
    });
    if (error) {
      let mensaje = error.message;
      try {
        const body = await error.context?.json();
        if (body?.message) mensaje = body.message;
      } catch (_) {}
      throw new Error(mensaje);
    }
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
  //
  // Pasa por el RPC kardex_empleados_con_perfil (ver
  // sql/columnas_ocultas_empleados_2026-09-18.sql) en vez de un select()
  // directo -- si el admin le ocultó columnas a esta cuenta desde Usuarios,
  // el propio servidor arma la respuesta sin esas claves (no depende de qué
  // pida el cliente). Mismo shape de retorno que antes (array plano con
  // perfil_sociodemografico/contactos_emergencia/hijos_empleado embebidos),
  // así que las vistas que ya la llaman no cambian.
  //
  // El RPC no soporta paginar con .range() como un select() normal, así que
  // recibe límite/desde y se repite el mismo bucle -- PostgREST igual capa
  // en 1000 filas por llamada (límite del lado del servidor, no algo que se
  // pueda subir desde el cliente) -- con más de 1000 empleados en la tabla,
  // sin paginar se perdía en silencio todo lo que quedara después del corte
  // alfabético (ej. apellidos con "V" en adelante), sin ningún error visible.
  async getEmployeesConPerfil({ onlyActive = true } = {}) {
    const PAGE_SIZE = 1000;
    let empleados = [];
    let desde = 0;
    let camposOcultos = [];
    for (;;) {
      const { data, error } = await window.supabaseClient.rpc('kardex_empleados_con_perfil', {
        p_only_active: onlyActive,
        p_limit: PAGE_SIZE,
        p_offset: desde,
      });
      if (error) throw error;
      empleados = empleados.concat(data.empleados);
      camposOcultos = data.campos_ocultos || [];
      if (data.empleados.length < PAGE_SIZE) break;
      desde += PAGE_SIZE;
    }
    this._camposOcultosEmpleados = new Set(camposOcultos);
    return empleados;
  },

  // Campos que la cuenta actual tiene ocultos en Empleados (ver y
  // descargar) -- se llena como efecto de getEmployeesConPerfil, que
  // siempre se llama antes de usar esto (ver _buildExcel en
  // js/views/empleados.js). Vacío para admin/GESTION HUMANA o cualquier
  // cuenta sin restricción configurada.
  camposOcultosEmpleados() {
    return this._camposOcultosEmpleados || new Set();
  },

  // Columnas ocultas configuradas hoy para un empleado puntual -- para
  // precargar el formulario "Editar permisos" en Usuarios.
  async getColumnasOcultasEmpleado(employeeId) {
    const { data, error } = await window.supabaseClient
      .from('kardex_columnas_ocultas_empleados')
      .select('campo')
      .eq('employee_id', employeeId);
    if (error) throw error;
    return new Set((data || []).map((f) => f.campo));
  },

  // Mismo patrón borrar-todo-y-reinsertar que guardarPermisosUsuario --
  // más simple que llevar el control de qué campo se marcó/desmarcó.
  async guardarColumnasOcultasEmpleado(employeeId, campos) {
    const { error: delError } = await window.supabaseClient
      .from('kardex_columnas_ocultas_empleados')
      .delete()
      .eq('employee_id', employeeId);
    if (delError) throw delError;
    if (!campos.length) return;
    const { data: sessionData } = await window.supabaseClient.auth.getSession();
    const creadoPorEmail = sessionData?.session?.user?.email || 'desconocido';
    const { error } = await window.supabaseClient
      .from('kardex_columnas_ocultas_empleados')
      .insert(campos.map((campo) => ({ employee_id: employeeId, campo, creado_por_email: creadoPorEmail })));
    if (error) throw error;
  },

  // ¿Esta cuenta está restringida a solo ver empleados activos? (ver
  // sql/solo_activos_empleados_2026-09-18.sql) -- para precargar el
  // checkbox en "Editar permisos".
  async getSoloActivosEmpleado(employeeId) {
    const { data, error } = await window.supabaseClient
      .from('kardex_restriccion_activos_empleados')
      .select('employee_id')
      .eq('employee_id', employeeId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },

  async guardarSoloActivosEmpleado(employeeId, soloActivos) {
    if (soloActivos) {
      const { data: sessionData } = await window.supabaseClient.auth.getSession();
      const { error } = await window.supabaseClient
        .from('kardex_restriccion_activos_empleados')
        .upsert({ employee_id: employeeId, creado_por_email: sessionData?.session?.user?.email || 'desconocido' });
      if (error) throw error;
    } else {
      const { error } = await window.supabaseClient
        .from('kardex_restriccion_activos_empleados')
        .delete()
        .eq('employee_id', employeeId);
      if (error) throw error;
    }
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

  // Solo el employee_id de cada salida NO anulada -- para el indicador
  // "Sin dotación entregada" (Personal > Cumpleaños y alertas), sin traer
  // el detalle completo de cada movimiento. Igual que getEmployees, pagina
  // de a 1000: el número de movimientos crece mucho más rápido que el de
  // empleados.
  async getEmployeeIdsConDotacion() {
    const PAGE_SIZE = 1000;
    const ids = new Set();
    let desde = 0;
    for (;;) {
      const { data, error } = await window.supabaseClient
        .from('kardex_movements')
        .select('employee_id')
        .eq('tipo', 'salida')
        .eq('anulado', false)
        .not('employee_id', 'is', null)
        .range(desde, desde + PAGE_SIZE - 1);
      if (error) throw error;
      data.forEach((r) => ids.add(r.employee_id));
      if (data.length < PAGE_SIZE) break;
      desde += PAGE_SIZE;
    }
    return ids;
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

  // folder es opcional: lo usan los buckets donde cada empleado sube a su
  // propia carpeta (ej. "permisos-soportes", aislado por RLS con
  // storage.foldername -- ver sql/permisos_vacaciones_2026-09-15.sql).
  async uploadToBucket(bucket, blob, extension, folder = null) {
    const path = folder ? `${folder}/${crypto.randomUUID()}.${extension}` : `${crypto.randomUUID()}.${extension}`;
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

  // ---- Actividades ------------------------------------------------------------
  // Ver sql/actividades_2026-09-22.sql. Una actividad agrupa muchos
  // registros individuales de "a quién se le dio esto" (firma + foto del
  // receptor, mismos buckets que ya usa Salida).

  async crearActividad({ nombre, descripcion, fecha }) {
    const { data: sessionData } = await window.supabaseClient.auth.getSession();
    const nombreCreador = await this.getMyDisplayName();
    const { data, error } = await window.supabaseClient
      .from('kardex_actividades')
      .insert({
        nombre,
        descripcion: descripcion || null,
        fecha,
        creado_por_email: sessionData.session.user.email,
        creado_por_nombre: nombreCreador,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getActividades() {
    const { data, error } = await window.supabaseClient
      .from('kardex_actividades')
      .select('*')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Con permiso solo "agregar" (sin "ver"), RLS filtra todas las filas --
  // devuelve [] en silencio, no error, consistente con el resto de la app.
  async getRegistrosActividad(actividadId) {
    const { data, error } = await window.supabaseClient
      .from('kardex_actividad_registros')
      .select('*, employees(nombre, cedula, cargo, area)')
      .eq('actividad_id', actividadId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Sin .select() a propósito: no hace falta el registro de vuelta (no hay
  // tabla hija que dependa de su id, a diferencia de createMovement), y así
  // una cuenta con solo "agregar" (sin "ver") puede registrar igual --
  // pedir el registro de vuelta exigiría además el permiso "ver".
  async registrarActividadPersona({ actividadId, employeeId, detalle, firmaUrl, fotoUrl }) {
    const { data: sessionData } = await window.supabaseClient.auth.getSession();
    const nombreRegistrador = await this.getMyDisplayName();
    const { error } = await window.supabaseClient
      .from('kardex_actividad_registros')
      .insert({
        actividad_id: actividadId,
        employee_id: employeeId,
        detalle: detalle || null,
        firma_url: firmaUrl,
        foto_url: fotoUrl,
        registrado_por_email: sessionData.session.user.email,
        registrado_por_nombre: nombreRegistrador,
      });
    if (error) throw error;
  },

  // ---- Permisos y vacaciones ---------------------------------------------

  // Id del empleado propio del usuario autenticado, o null si es una cuenta
  // administrativa (kardex@/vinculaciones@) sin ficha de empleado asociada.
  async getOwnEmployeeId() {
    const { data, error } = await window.supabaseClient.rpc('kardex_own_employee_id');
    if (error) throw error;
    return data;
  },

  // Ficha propia de solo lectura (nombre/cédula/cargo/área), para el
  // encabezado de "Mis permisos". No pasa por employees directo -- esa
  // tabla sigue protegida solo para kardex_is_authorized().
  async getMiEmpleado() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mi_empleado');
    if (error) throw error;
    return data?.[0] || null;
  },

  // Directorio liviano (sin columnas sensibles) para que un empleado
  // autenticado elija a quién lo reemplaza -- distinto de getEmployees(),
  // que exige kardex_is_authorized() y no le sirve a este rol.
  async getDirectorioEmpleados() {
    const { data, error } = await window.supabaseClient.rpc('kardex_directorio_empleados');
    if (error) throw error;
    return data;
  },

  async getMisPermisos() {
    const { data, error } = await window.supabaseClient
      .from('permisos_solicitudes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Bandeja de admin: RLS ya filtra a lo que kardex_is_authorized() puede
  // ver (todas), con el nombre del empleado y del reemplazo embebidos.
  async getPermisos() {
    const { data, error } = await window.supabaseClient
      .from('permisos_solicitudes')
      .select(`
        *,
        employee:employees!permisos_solicitudes_employee_id_fkey ( nombre, cedula, cargo, area ),
        reemplazo:employees!permisos_solicitudes_reemplazo_employee_id_fkey ( nombre )
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async createPermiso({ employeeId, tipoPermiso, fechaHoraInicio, fechaHoraFin, motivo, requiereReposicion, reemplazoEmployeeId, soporteFile }) {
    let soporteUrl = null;
    let soporteNombre = null;
    if (soporteFile) {
      const extension = (soporteFile.name.split('.').pop() || 'pdf').toLowerCase();
      soporteUrl = await this.uploadToBucket('permisos-soportes', soporteFile, extension, employeeId);
      soporteNombre = soporteFile.name;
    }
    const { data: sessionData } = await window.supabaseClient.auth.getSession();
    const { data, error } = await window.supabaseClient
      .from('permisos_solicitudes')
      .insert({
        employee_id: employeeId,
        tipo_permiso: tipoPermiso,
        fecha_hora_inicio: fechaHoraInicio,
        fecha_hora_fin: fechaHoraFin,
        motivo: motivo || null,
        requiere_reposicion: requiereReposicion,
        reemplazo_employee_id: reemplazoEmployeeId || null,
        soporte_url: soporteUrl,
        soporte_nombre: soporteNombre,
        creado_por_email: sessionData.session.user.email,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updatePermisoEstado(id, estado, { motivoRechazo, aprobadoPor } = {}) {
    const { error } = await window.supabaseClient
      .from('permisos_solicitudes')
      .update({
        estado,
        motivo_rechazo: motivoRechazo || null,
        aprobado_por: aprobadoPor || null,
        aprobado_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  },

  // ---- Usuarios (cuentas de acceso por grupo) --------------------------------

  // Grupo del empleado autenticado, o null si no tiene ninguno asignado
  // (incluye el caso admin/viewer, que no tienen ficha de empleado).
  async getMiGrupo() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mi_grupo');
    if (error) throw error;
    return data;
  },

  // Crea (o actualiza el grupo de) la cuenta de Auth de un empleado. Corre en
  // el servidor (Edge Function con service_role) porque crear un usuario de
  // Auth no se puede hacer con la anon key desde el navegador.
  async crearUsuario({ employeeId, email, alias, grupo }) {
    const { data, error } = await window.supabaseClient.functions.invoke('kardex-crear-usuario', {
      body: { employeeId, email, alias, grupo },
    });
    if (error) {
      // Con un status distinto de 2xx, supabase-js deja el mensaje real (el
      // {ok:false, message:...} que devuelve la función) en error.context
      // (la Response cruda) en vez de en error.message -- sin esto se vería
      // el genérico "Edge Function returned a non-2xx status code".
      const detalle = await error.context?.json?.().catch(() => null);
      throw new Error(detalle?.message || error.message);
    }
    if (!data?.ok) throw new Error(data?.message || 'No se pudo crear el usuario.');
    return data;
  },

  async getUsuariosGrupos() {
    const { data, error } = await window.supabaseClient
      .from('kardex_empleado_grupos')
      .select('*, employee:employees(nombre, cedula, cargo, area, email_personal)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async quitarGrupoUsuario(employeeId) {
    const { error } = await window.supabaseClient
      .from('kardex_empleado_grupos')
      .delete()
      .eq('employee_id', employeeId);
    if (error) throw error;
  },

  // Permisos sueltos por módulo (ver/agregar/editar/borrar), aditivos por
  // encima de lo que ya da el grupo -- ver sql/permisos_granulares_2026-09-16.sql.
  async getMisPermisosModulos() {
    const { data, error } = await window.supabaseClient.rpc('kardex_mis_permisos_modulos');
    if (error) throw error;
    const mapa = {};
    (data || []).forEach((fila) => { mapa[fila.modulo] = fila; });
    return mapa;
  },

  async getPermisosUsuario(employeeId) {
    const { data, error } = await window.supabaseClient
      .from('kardex_permisos_usuario')
      .select('*')
      .eq('employee_id', employeeId);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach((fila) => { mapa[fila.modulo] = fila; });
    return mapa;
  },

  // permisos: array de { modulo, ver, agregar, editar, borrar }. Se
  // reemplazan todas las filas de ese empleado por las que traigan al
  // menos un flag en true (más simple que ir comparando fila por fila).
  async guardarPermisosUsuario(employeeId, permisos) {
    const { data: sessionData } = await window.supabaseClient.auth.getSession();
    const { error: delError } = await window.supabaseClient
      .from('kardex_permisos_usuario')
      .delete()
      .eq('employee_id', employeeId);
    if (delError) throw delError;

    const filas = permisos
      .filter((p) => p.ver || p.agregar || p.editar || p.borrar)
      .map((p) => ({
        employee_id: employeeId,
        modulo: p.modulo,
        ver: !!p.ver,
        agregar: !!p.agregar,
        editar: !!p.editar,
        borrar: !!p.borrar,
        creado_por_email: sessionData.session.user.email,
      }));
    if (filas.length === 0) return;

    const { error: insError } = await window.supabaseClient.from('kardex_permisos_usuario').insert(filas);
    if (insError) throw insError;
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

  // ===================================================================
  // Contabilidad > Fondo de reposición de siniestros
  //
  // Los aportes viven por interno de vehículo; la placa y la ruta se leen
  // de flota_vehiculos (el "Portal de Documentos", mismo Supabase) al
  // consultar, en vez de duplicarlas acá -- ver el comentario del esquema
  // en sql/contabilidad_fondo_2026-09-22.sql.
  // ===================================================================
  async getFondos() {
    const { data, error } = await window.supabaseClient
      .from('kardex_fondos')
      .select('*')
      .order('orden');
    if (error) throw error;
    return data;
  },

  async getFondoVehiculos() {
    const { data, error } = await window.supabaseClient
      .from('kardex_fondo_vehiculos')
      .select('*')
      .order('interno');
    if (error) throw error;
    return data;
  },

  // Sin filtro por fondo a propósito: son ~7.700 filas entre los dos fondos,
  // se traen de una y la vista cambia de fondo sin volver a consultar.
  async getFondoAportes() {
    const PAGE_SIZE = 1000;
    let filas = [];
    let desde = 0;
    for (;;) {
      const { data, error } = await window.supabaseClient
        .from('kardex_fondo_aportes')
        .select('fondo, interno, periodo, valor, concepto, es_saldo_inicial')
        .order('periodo')
        .range(desde, desde + PAGE_SIZE - 1);
      if (error) throw error;
      filas = filas.concat(data);
      if (data.length < PAGE_SIZE) break;
      desde += PAGE_SIZE;
    }
    return filas;
  },

  async getFondoResumen() {
    const { data, error } = await window.supabaseClient
      .from('kardex_fondo_resumen')
      .select('*')
      .order('orden');
    if (error) throw error;
    return data;
  },

  async getFondoRendimientos() {
    const { data, error } = await window.supabaseClient
      .from('kardex_fondo_rendimientos_vehiculo')
      .select('*')
      .order('interno');
    if (error) throw error;
    return data;
  },
};

// Todas las funciones async de esta capa pasan por acá para traducir
// errores de red (no hay internet, o la conexión se cae a medias) a un
// mensaje claro en español -- antes el error crudo del navegador (ej.
// "Failed to fetch") quedaba tal cual en el "No se pudo guardar: ..." de
// cada formulario, que no le dice nada a quien lo lee. No toca
// subscribeToChanges/unsubscribe (no son async, no hacen una petición que
// pueda fallar así).
Object.keys(DB).forEach((key) => {
  const original = DB[key];
  if (typeof original !== 'function' || original.constructor.name !== 'AsyncFunction') return;
  DB[key] = async function (...args) {
    try {
      return await original.apply(DB, args);
    } catch (err) {
      if (err instanceof TypeError && /fetch/i.test(err.message || '')) {
        throw new Error('Sin conexión a internet. Verifica tu red e intenta de nuevo.');
      }
      throw err;
    }
  };
});
