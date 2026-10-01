/* ============================================================
   Procesos disciplinarios: la hoja publicada
   ------------------------------------------------------------
   Gestión Humana lleva los procesos disciplinarios en un Google
   Sheet publicado como CSV. El programa anterior lo leía desde
   el navegador; acá se hace lo mismo, pero solo para traerlos
   una vez al ERP -- después la fuente es la base de datos.

   Por qué se lee la hoja y no la tabla del programa anterior:
   la tabla tiene 303 procesos y la hoja 417. Los 303 están todos
   en la hoja; los 114 que faltan son de 2026 y nunca llegaron a
   la tabla. La hoja es la que está al día.

   OJO: esta hoja está publicada en internet sin contraseña y
   trae cédulas, nombres, celulares, correos y el texto completo
   de las actas de descargos. La URL no se guarda en el repo
   público: la pega quien importa, una sola vez.
   ============================================================ */
(function () {
  // Parser CSV que respeta comillas y saltos de línea dentro de un campo
  // (las actas de descargos son textos de varios párrafos). Portado del
  // programa anterior, donde ya estaba probado contra esta misma hoja.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Encabezados: mayúsculas, sin tildes, sin espacios de sobra. La hoja tiene
  // encabezados con espacio al final ('RESPONSABLE ') y uno mal escrito
  // ('TERMIANDOS'); se toman como están, no se corrigen allá.
  const norm = (s) => String(s || '').toUpperCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  // Encabezado de la hoja -> clave que entiende kardex_pd_importar_hoja().
  // Las claves son nuestras, no las de la hoja: si allá renombran una columna,
  // se arregla acá y el SQL no se toca.
  const MAPA = {
    'KEY': 'key',
    'CC': 'cc',
    'NOMBRE': 'nombre',
    'EMPRESA': 'empresa',
    'FECHA DE INGRESO': 'fecha_ingreso',
    'INTERNO': 'interno',
    'AREA': 'area',
    'PROPIETARIO': 'propietario',
    'RUTA': 'ruta',
    'CARGO': 'cargo',
    'MOTIVO': 'motivo',
    'FECHA CITACION': 'fecha_citacion',
    'HORA DE CITACION': 'hora_citacion',
    'ASITENCIA': 'asistencia',
    'REGLAMENTO INTERNO DE TRABAJO': 'normas',
    'FALTA': 'falta',
    'PRIMERA VEZ': 'primera_vez',
    'SEGUNDA VEZ': 'segunda_vez',
    'TERCERA VEZ': 'tercera_vez',
    'CUARTA VEZ': 'cuarta_vez',
    'ACTA': 'acta',
    'FECHA ACTA DESCARGOS': 'fecha_acta',
    'HORA ACTA DESCARGOS': 'hora_acta',
    'TEXTO ACTA': 'texto_acta',
    'DISCIPLINARIO': 'disciplinario',
    'ASUNTO': 'asunto',
    'HORA DILIGENCIAMIENTO DESCARGOS': 'hora_diligencia',
    'FECHA DE INICIO DE SANCION': 'fecha_inicio_sancion',
    'FECHA DE FINALIZACION DE SANCION': 'fecha_fin_sancion',
    'DIAS DE SUSPENCION': 'dias_suspension',
    'ESTADO': 'estado',
    'CORREO DE NOTIFICACION': 'correo_notificacion',
    'CELULAR': 'celular',
    'RESPONSABLE': 'responsable',
    'FIRMA CITACION': 'firma_citacion',
    'FIRMA DE SANCION': 'firma_sancion',
    'PRUEBAS': 'pruebas',
    'PRUEBAS VIDEOS': 'pruebas_videos',
    'CARGA DE ARCHIVOS TERMIANDOS': 'archivos_finales',
    'CORREO AFILIADO': 'correo_afiliado',
    'CELULAR AFILIADO': 'celular_afiliado',
    'NUMERO DE CELULAR CITADO': 'celular_citado',
    'CORREO CITADO': 'correo_citado',
  };

  // 'FECHA DILIGENCIAMIENTO DESCARGOS' aparece DOS veces en la hoja y son
  // cosas distintas: la primera es la fecha en que se llenó el formulario
  // (las 417 filas la tienen, formato dd/mm/aaaa) y la segunda es la fecha
  // real de la diligencia, escrita a mano ("4 de September 2025", 65 filas).
  // Por eso el mapeo va por posición y no solo por nombre.
  const REPETIDA = 'FECHA DILIGENCIAMIENTO DESCARGOS';
  const REPETIDA_CLAVES = ['fecha_registro', 'fecha_diligencia'];

  function clavesPorColumna(encabezado) {
    let vistas = 0;
    return encabezado.map((h) => {
      const n = norm(h);
      if (n === REPETIDA) {
        const clave = REPETIDA_CLAVES[vistas] || null;
        vistas += 1;
        return clave;
      }
      return MAPA[n] || null;
    });
  }

  // Hay filas sin la columna KEY que sí son procesos reales (una, hoy: un
  // llamado de atención de 2025 con acta y las dos firmas). Descartarlas por
  // no traer identificador sería perder el proceso, así que se les arma una
  // llave con lo que las distingue. Tiene que ser siempre la misma para que
  // una segunda importación la reconozca y no la duplique, y lleva prefijo
  // para no chocar nunca con las llaves de la hoja, que son hex de 8 dígitos.
  function llaveDerivada(o) {
    const trozos = [o.cc, o.fecha_citacion, o.hora_citacion, o.fecha_registro]
      .map((v) => String(v || '').replace(/[^0-9A-Za-z]/g, ''))
      .filter(Boolean);
    return 'sinkey-' + trozos.join('-');
  }

  // CSV -> filas listas para el RPC. Sin cédula no hay a quién atribuir el
  // proceso, así que esas sí se descartan.
  function filasDeCSV(texto) {
    const rows = parseCSV(texto);
    if (!rows.length) return { filas: [], descartadas: 0 };
    const claves = clavesPorColumna(rows[0]);
    const filas = [];
    let descartadas = 0;
    for (let r = 1; r < rows.length; r++) {
      const cruda = rows[r];
      if (!cruda || !cruda.length) continue;
      const o = {};
      for (let c = 0; c < claves.length; c++) {
        if (!claves[c]) continue;
        const v = cruda[c] != null ? String(cruda[c]).trim() : '';
        if (v) o[claves[c]] = v;
      }
      if (!o.key && !o.cc) continue;          // fila en blanco de la hoja
      if (!o.cc) { descartadas += 1; continue; }
      if (!o.key) o.key = llaveDerivada(o);
      filas.push(o);
    }
    return { filas, descartadas };
  }

  async function descargar(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    } catch (err) {
      throw new Error('No se pudo descargar la hoja. Revisa el enlace y la conexión.');
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error('La hoja respondió HTTP ' + res.status + '. ¿Sigue publicada como CSV?');
    return res.text();
  }

  window.HOJA_PROCESOS = {
    parseCSV,
    filasDeCSV,
    async traer(url) {
      const { filas, descartadas } = filasDeCSV(await descargar(url));
      if (!filas.length) throw new Error('La hoja se descargó pero no trajo ningún proceso. ¿El enlace apunta a la hoja correcta?');
      return { filas, descartadas };
    },
  };
})();
