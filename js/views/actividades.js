// Registro y creación de actividades: una actividad (ej. "Entrega de
// entradas Comfama - Diciembre") agrupa muchos registros individuales de
// quién recibió algo -- cada registro deja firma y foto del receptor, y
// queda relacionado a la ficha del empleado (no se escribe a mano, se busca
// y selecciona, mismo combobox de Salida). Reutiliza SignaturePad y
// CameraCapture dentro del modal compartido, mismo patrón que
// empleados.js:_abrirFirma()/_abrirModal() -- se inicializan justo después
// de inyectar el HTML del modal, cuando el canvas ya tiene tamaño real.

function acEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function acFormatFecha(fechaIso) {
  if (!fechaIso) return '—';
  const m = String(fechaIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fechaIso;
  const [, yyyy, mm, dd] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).toLocaleDateString('es-CO');
}

// Las fotos de la actividad usan el mismo permiso que la actividad: quien
// puede agregarle registros puede subirle fotos. Gestión humana también, igual
// que en las policies.
function acPuede(accion) {
  if (window.APP_ROLE === 'admin') return true;
  if (window.APP_GRUPO === 'GESTION HUMANA') return true;
  const p = (window.APP_PERMISOS_MODULOS || {}).actividades;
  return !!(p && p[accion]);
}

function acMensajeFotos(err) {
  const m = String(err?.message || err || '');
  if (/relation .* does not exist|PGRST205|bucket/i.test(m)) {
    return 'Falta crear la galería en la base de datos: corre sql/actividades_fotos_2026-10-13.sql.';
  }
  if (/permission denied|row-level security|policy|Unauthorized/i.test(m)) {
    return 'Tu cuenta no tiene permiso para subir fotos a las actividades.';
  }
  return m || 'No se pudo completar.';
}

Router.register('actividades', {
  title: 'Actividades',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('ac-form').addEventListener('submit', (e) => this._crear(e));
      this._bound = true;
    }
    document.getElementById('ac-fecha').value = document.getElementById('ac-fecha').value || new Date().toISOString().slice(0, 10);
    this._empleados = await DB.getEmployees({ onlyActive: true });
    await this._load();
  },

  async _load() {
    this._actividades = await DB.getActividades();
    this._render();
    await this._cargarTiras();
  },

  _render() {
    const lista = document.getElementById('ac-lista');
    document.getElementById('ac-contador').textContent = this._actividades.length
      ? `${this._actividades.length} actividad(es)`
      : 'Todavía no se ha creado ninguna actividad.';
    lista.innerHTML = this._actividades.map((a) => `
      <div class="person-row">
        <div class="person-info">
          <div class="person-name">${acEscapeHtml(a.nombre)}</div>
          <div class="person-meta">
            <span>${acFormatFecha(a.fecha)}</span>
            <span>Creada por ${acEscapeHtml(a.creado_por_nombre || a.creado_por_email)}</span>
          </div>
          <div class="ac-tira" data-tira="${a.id}"></div>
        </div>
        <button type="button" class="btn-secondary" data-abrir="${a.id}">Abrir</button>
      </div>
    `).join('');
    lista.querySelectorAll('[data-abrir]').forEach((btn) => {
      btn.addEventListener('click', () => this._abrirActividad(this._actividades.find((a) => a.id === btn.dataset.abrir)));
    });
  },

  async _crear(e) {
    e.preventDefault();
    const msg = document.getElementById('ac-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const nombre = document.getElementById('ac-nombre').value.trim();
    const descripcion = document.getElementById('ac-descripcion').value.trim();
    const fecha = document.getElementById('ac-fecha').value;
    if (!nombre || !fecha) {
      msg.textContent = 'Nombre y fecha son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Creando…');
    try {
      const actividad = await DB.crearActividad({ nombre, descripcion, fecha });
      document.getElementById('ac-form').reset();
      document.getElementById('ac-fecha').value = new Date().toISOString().slice(0, 10);
      await this._load();
      this._abrirActividad(actividad);
    } catch (err) {
      msg.textContent = 'No se pudo crear: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },

  async _abrirActividad(actividad) {
    this._actividadAbierta = actividad;
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${acEscapeHtml(actividad.nombre)}</div>
          <div class="detalle-sub">${acFormatFecha(actividad.fecha)}${actividad.descripcion ? ' — ' + acEscapeHtml(actividad.descripcion) : ''}</div>
        </div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Fotos de la actividad</h3>
        <p class="muted">Las del evento: el almuerzo, la capacitación, la entrega. La foto de cada persona que recibe algo va con su firma, más abajo.</p>
        <label class="file-picker" for="ac-galeria-input" id="ac-galeria-picker">
          <svg viewBox="0 0 20 20" fill="none"><path d="M3.5 14.5V5.5a1 1 0 011-1h11a1 1 0 011 1v9a1 1 0 01-1 1h-11a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 12.5l3.2-3a1 1 0 011.3 0l3 2.8M12 10.6l1.4-1.2a1 1 0 011.3 0l1.8 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.6" cy="7.6" r="1.1" stroke="currentColor" stroke-width="1.3"/></svg>
          Agregar fotos
        </label>
        <input type="file" id="ac-galeria-input" accept="image/*" multiple class="hidden" />
        <button type="button" class="btn-secondary hidden" id="ac-collage-btn">Armar collage</button>
        <p id="ac-galeria-msg" class="form-msg"></p>
        <div id="ac-galeria" class="ac-collage"></div>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Registrar entrega</h3>
        <form id="ac-registro-form" class="form">
          <label>Empleado que recibe
            <div class="combobox" id="ac-empleado-combobox">
              <input type="text" id="ac-empleado-search" autocomplete="off" placeholder="Buscar por nombre o cédula…" />
              <input type="hidden" id="ac-empleado-id" />
              <ul class="combobox-list hidden" id="ac-empleado-list"></ul>
            </div>
          </label>
          <label>Detalle (opcional)<input type="text" id="ac-detalle" placeholder="Ej. 2 entradas" /></label>

          <h4 class="modal-section-title">Firma de quien recibe</h4>
          <canvas id="ac-firma-canvas" class="signature-canvas"></canvas>
          <button type="button" id="ac-firma-limpiar" class="btn-secondary">Limpiar firma</button>

          <h4 class="modal-section-title" style="margin-top:1rem">Foto de quien recibe</h4>
          <label class="file-picker" for="ac-foto-input">
            <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
            Tomar / adjuntar foto
          </label>
          <input type="file" id="ac-foto-input" accept="image/*" capture="environment" class="hidden" />
          <img id="ac-foto-preview" class="photo-preview hidden" alt="Foto de quien recibe" />

          <div style="margin-top:0.9rem">
            <button type="submit">Registrar</button>
            <p id="ac-registro-msg" class="form-msg"></p>
          </div>
        </form>
      </div>

      <div class="modal-section">
        <h3 class="modal-section-title">Ya registrados</h3>
        <p class="empty-note" id="ac-registros-contador"></p>
        <div id="ac-registros-lista" class="person-list"></div>
      </div>
    `;

    this._acFirma = new SignaturePad(document.getElementById('ac-firma-canvas'));
    document.getElementById('ac-firma-limpiar').addEventListener('click', () => this._acFirma.clear());
    this._acCamera = new CameraCapture({
      inputEl: document.getElementById('ac-foto-input'),
      previewEl: document.getElementById('ac-foto-preview'),
    });

    this._setupEmpleadoCombobox();
    document.getElementById('ac-registro-form').addEventListener('submit', (e) => this._registrar(e));
    document.getElementById('ac-galeria-input').addEventListener('change', (e) => this._subirFotos(e));
    document.getElementById('ac-collage-btn').addEventListener('click', () => this._collage());
    document.getElementById('ac-galeria-picker').classList.toggle('hidden', !acPuede('agregar'));

    await Promise.all([this._cargarRegistros(), this._cargarGaleria()]);
  },

  // ---- Tira de miniaturas del listado ------------------------------------
  // La prueba de que una actividad se cumplió son sus fotos. Verlas en la
  // misma fila evita abrir actividad por actividad para saber cuáles
  // quedaron sin evidencia: la fila que aparece vacía es justo la que falta.
  _MAX_MINIATURAS: 6,
  // Tope de enlaces firmados por carga. El bucket es privado y cada
  // miniatura necesita el suyo; con cientos de actividades esa firma en
  // bloque sería lo más pesado del módulo, así que de ahí en adelante la
  // fila se queda con el conteo en texto, que es lo que de verdad importa.
  _MAX_FIRMAS_TIRA: 150,

  async _cargarTiras() {
    const actividades = this._actividades || [];
    if (!actividades.length) return;

    let porActividad;
    try {
      porActividad = await DB.getFotosDeActividades(actividades.map((a) => a.id));
    } catch (err) {
      // Sin la galería creada (o sin permiso para verla) el listado sigue
      // sirviendo igual: las tiras simplemente no se pintan.
      return;
    }

    const aFirmar = [];
    actividades.forEach((a) => {
      (porActividad[a.id] || []).slice(0, this._MAX_MINIATURAS).forEach((f) => {
        if (aFirmar.length < this._MAX_FIRMAS_TIRA) aFirmar.push(f.storage_path);
      });
    });

    let urls = {};
    try {
      urls = await DB.getSignedUrls('actividades-fotos', aFirmar);
    } catch (err) {
      // Queda el conteo, que ya responde lo único urgente: si hay evidencia.
    }

    actividades.forEach((a) => this._pintarTira(a.id, porActividad[a.id] || [], urls));
  },

  _pintarTira(actividadId, fotos, urls) {
    const caja = document.querySelector(`[data-tira="${actividadId}"]`);
    if (!caja) return;
    if (!fotos.length) {
      caja.innerHTML = '<span class="ac-tira-vacia">Sin fotos todavía</span>';
      return;
    }
    const visibles = fotos.slice(0, this._MAX_MINIATURAS).filter((f) => urls[f.storage_path]);
    const restantes = fotos.length - visibles.length;
    caja.innerHTML = visibles.map((f, i) => `
      <img class="ac-tira-foto" src="${urls[f.storage_path]}" loading="lazy"
           alt="${acEscapeHtml(f.descripcion || `Foto ${i + 1} de la actividad`)}"
           data-ver-tira="${f.id}" />`).join('')
      + (restantes > 0 ? `<span class="ac-tira-mas">+${restantes}</span>` : '')
      + `<span class="ac-tira-total">${fotos.length} foto(s)</span>`;
    caja.querySelectorAll('[data-ver-tira]').forEach((img) => {
      img.addEventListener('click', () => this._verFoto(img.src, img.alt));
    });
  },

  // ---- Galería de la actividad -------------------------------------------
  async _cargarGaleria() {
    const caja = document.getElementById('ac-galeria');
    if (!caja) return;
    try {
      const fotos = await DB.getFotosActividad(this._actividadAbierta.id);
      this._fotos = fotos;
      const btnCollage = document.getElementById('ac-collage-btn');
      if (btnCollage) btnCollage.classList.toggle('hidden', !fotos.length);
      if (!fotos.length) {
        caja.innerHTML = '<p class="empty-note">Esta actividad todavía no tiene fotos.</p>';
        this._pintarTira(this._actividadAbierta.id, [], {});
        return;
      }
      // Las URL se piden todas de una: el bucket es privado y cada foto
      // necesita su enlace firmado, que además expira.
      const urls = await DB.getSignedUrls('actividades-fotos', fotos.map((f) => f.storage_path));
      caja.innerHTML = fotos.map((f, i) => `
        <figure class="ac-foto">
          <img src="${urls[f.storage_path] || ''}" alt="${acEscapeHtml(f.descripcion || `Foto ${i + 1} de la actividad`)}"
               loading="lazy" data-ver="${f.id}" />
          ${acPuede('borrar') ? `<button type="button" class="ac-foto-quitar" data-quitar="${f.id}" title="Quitar esta foto">×</button>` : ''}
          ${f.descripcion ? `<figcaption>${acEscapeHtml(f.descripcion)}</figcaption>` : ''}
        </figure>`).join('');

      caja.querySelectorAll('[data-ver]').forEach((img) => {
        img.addEventListener('click', () => this._verFoto(img.src, img.alt));
      });
      caja.querySelectorAll('[data-quitar]').forEach((b) => {
        b.addEventListener('click', () => this._quitarFoto(b.dataset.quitar));
      });

      // Misma lista y mismos enlaces que acaba de traer la galería: la fila
      // del listado queda al día sin pedir nada otra vez.
      this._pintarTira(this._actividadAbierta.id, fotos, urls);
    } catch (err) {
      caja.innerHTML = `<p class="empty-note">${acEscapeHtml(acMensajeFotos(err))}</p>`;
    }
  },

  // ---- Collage ----------------------------------------------------------

  // Baja la foto y la reduce antes de meterla al collage. Dos razones:
  //
  // 1) Se incrusta como data URI y no con su enlace. El bucket es privado y
  //    sus enlaces firmados expiran; una página con la URL adentro dejaría de
  //    verse a las pocas horas. Además html2pdf no puede leer una imagen de
  //    otro dominio sin CORS, y el PDF saldría con huecos en blanco.
  // 2) Una foto de celular pesa varios MB. Veinte sin reducir hacen un PDF
  //    que no se puede enviar por correo, que es justo para lo que se arma.
  async _fotoReducida(url, maxLado = 1100) {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    bitmap.close?.();
    return lienzo.toDataURL('image/jpeg', 0.82);
  },

  async _collage() {
    const fotos = this._fotos || [];
    const msg = document.getElementById('ac-galeria-msg');
    msg.className = 'form-msg';
    if (!fotos.length) return;

    // La ventana se abre ANTES del primer await: abrirla después de una
    // operación lenta hace que el navegador la bloquee como emergente.
    const ventana = window.open('', '_blank');
    if (!ventana) {
      msg.className = 'form-msg error';
      msg.textContent = 'El navegador bloqueó la ventana del collage. Permite las ventanas emergentes de este sitio.';
      return;
    }
    ventana.document.write('<p style="font:16px Arial;padding:24px">Armando el collage…</p>');

    Loading.show('Armando el collage…');
    const listas = [];
    try {
      const urls = await DB.getSignedUrls('actividades-fotos', fotos.map((f) => f.storage_path));
      for (let i = 0; i < fotos.length; i++) {
        Loading.setMessage(`Armando el collage… ${i + 1} de ${fotos.length}`);
        try {
          listas.push({
            src: await this._fotoReducida(urls[fotos[i].storage_path]),
            pie: fotos[i].descripcion || '',
          });
        } catch (err) {
          // Una foto que no se pudo leer no bota el collage entero: se
          // omite y abajo se dice cuántas quedaron.
        }
      }
    } catch (err) {
      Loading.hide();
      ventana.close();
      msg.className = 'form-msg error';
      msg.textContent = 'No se pudo armar el collage: ' + acMensajeFotos(err);
      return;
    }
    Loading.hide();

    if (!listas.length) {
      ventana.close();
      msg.className = 'form-msg error';
      msg.textContent = 'No se pudo leer ninguna de las fotos.';
      return;
    }
    msg.className = listas.length === fotos.length ? 'form-msg success' : 'form-msg error';
    msg.textContent = listas.length === fotos.length
      ? `Collage de ${listas.length} foto(s) listo.`
      : `Collage con ${listas.length} de ${fotos.length} foto(s): las demás no se pudieron leer.`;

    // Una sola foto va a toda la hoja; de dos en adelante, en rejilla. Tres
    // columnas solo cuando hay muchas: con cuatro fotos deja cada una del
    // tamaño de un sello, y con dos a una columna cada una se come una
    // página entera.
    const columnas = listas.length === 1 ? 1 : (listas.length <= 6 ? 2 : 3);
    const act = this._actividadAbierta;
    const estilos = `
  .hoja { padding: 0.5in 0.55in; }
  .cab { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .cab h1 { font-size: 19px; margin: 0 0 4px; }
  .cab .sub { font-size: 13px; color: #444; }
  .rejilla { display: grid; grid-template-columns: repeat(${columnas}, 1fr); gap: 10px; }
  .celda { break-inside: avoid; }
  .celda img { width: 100%; height: auto; display: block; border: 1px solid #ccc; border-radius: 4px; }
  .celda figcaption { font-size: 11px; color: #444; margin-top: 3px; }
  .pie { margin-top: 18px; font-size: 11px; color: #555; border-top: 1px solid #ccc; padding-top: 8px; }
`;
    const cuerpoHtml = `
      <div class="cab">
        <h1>${acEscapeHtml(act.nombre)}</h1>
        <div class="sub">${acFormatFecha(act.fecha)}${act.descripcion ? ' — ' + acEscapeHtml(act.descripcion) : ''}</div>
      </div>
      <div class="rejilla">
        ${listas.map((f) => `
          <figure class="celda">
            <img src="${f.src}" alt="" />
            ${f.pie ? `<figcaption>${acEscapeHtml(f.pie)}</figcaption>` : ''}
          </figure>`).join('')}
      </div>
      <p class="pie">${listas.length} foto(s) — Combuses S.A.</p>`;

    ventana.document.open();
    ventana.document.write(paginaImprimible({
      titulo: `Collage — ${act.nombre}`,
      estilos,
      cuerpoHtml,
      archivo: `collage-${String(act.nombre).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`,
    }));
    ventana.document.close();
  },

  // De a una y en orden, no todas en paralelo: si la quinta falla, las cuatro
  // que ya subieron quedan guardadas y el mensaje dice exactamente cuántas
  // entraron. Subirlas en lote obligaría a volver a escogerlas todas.
  async _subirFotos(e) {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    const msg = document.getElementById('ac-galeria-msg');
    const base = (this._fotos || []).length;
    let subidas = 0;
    // show() lleva un contador y solo se apaga cuando vuelve a cero, asi que
    // el progreso va por setMessage: un show por foto dejaba el contador en
    // alto y el overlay tapando la pantalla para siempre.
    Loading.show(`Subiendo 1 de ${archivos.length}…`);
    try {
      for (const file of archivos) {
        Loading.setMessage(`Subiendo ${subidas + 1} de ${archivos.length}…`);
        await DB.subirFotoActividad({
          actividadId: this._actividadAbierta.id,
          file,
          orden: base + subidas,
        });
        subidas += 1;
      }
      msg.textContent = `${subidas} foto(s) agregada(s).`;
      msg.className = 'form-msg success';
    } catch (err) {
      msg.textContent = subidas
        ? `Se subieron ${subidas} de ${archivos.length}. La siguiente falló: ${acMensajeFotos(err)}`
        : acMensajeFotos(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
      await this._cargarGaleria();
    }
  },

  async _quitarFoto(id) {
    if (!confirm('¿Quitar esta foto de la actividad?')) return;
    Loading.show('Quitando…');
    try {
      await DB.borrarFotoActividad(id);
      await this._cargarGaleria();
    } catch (err) {
      const msg = document.getElementById('ac-galeria-msg');
      msg.textContent = acMensajeFotos(err);
      msg.className = 'form-msg error';
    } finally {
      Loading.hide();
    }
  },

  // Visor a pantalla completa. Va pegado al body y no dentro del modal porque
  // el modal tiene su propio scroll y recorte: la foto quedaría encajonada.
  _verFoto(src, alt) {
    const previo = document.getElementById('ac-lightbox');
    if (previo) previo.remove();
    const caja = document.createElement('div');
    caja.id = 'ac-lightbox';
    caja.className = 'ac-lightbox';
    caja.innerHTML = `<img src="${src}" alt="${acEscapeHtml(alt || '')}" /><button type="button" class="ac-lightbox-cerrar" aria-label="Cerrar">×</button>`;
    const cerrar = () => {
      caja.remove();
      document.removeEventListener('keydown', alTeclear);
    };
    const alTeclear = (ev) => { if (ev.key === 'Escape') cerrar(); };
    caja.addEventListener('click', cerrar);
    document.addEventListener('keydown', alTeclear);
    document.body.appendChild(caja);
  },

  _setupEmpleadoCombobox() {
    const search = document.getElementById('ac-empleado-search');
    const hidden = document.getElementById('ac-empleado-id');
    const list = document.getElementById('ac-empleado-list');
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._empleados.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q))
        : this._empleados;
      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `<li data-id="${e.id}">${acEscapeHtml(e.nombre)} <span class="combobox-cedula">· CC ${acEscapeHtml(e.cedula)}</span></li>`).join('');
        if (matches.length > visibles.length) list.innerHTML += `<li class="combobox-empty">Y ${matches.length - visibles.length} más… sigue escribiendo para acotar.</li>`;
      }
      list.classList.remove('hidden');
    };

    search.addEventListener('focus', () => { search.select(); renderLista(search.value); });
    search.addEventListener('input', () => { hidden.value = ''; renderLista(search.value); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const primero = list.querySelector('li[data-id]');
      if (primero) primero.click();
    });
    search.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const empleado = this._empleados.find((emp) => emp.id === li.dataset.id);
      if (!empleado) return;
      hidden.value = empleado.id;
      search.value = `${empleado.nombre} — CC ${empleado.cedula}`;
      list.classList.add('hidden');
    });
  },

  async _cargarRegistros() {
    const cont = document.getElementById('ac-registros-contador');
    const lista = document.getElementById('ac-registros-lista');
    cont.textContent = 'Cargando…';
    try {
      const registros = await DB.getRegistrosActividad(this._actividadAbierta.id);
      this._registros = registros;
      cont.textContent = registros.length ? `${registros.length} persona(s) registrada(s)` : 'Todavía nadie registrado.';
      lista.innerHTML = registros.map((r) => `
        <div class="person-row">
          <div class="person-info">
            <div class="person-name">${acEscapeHtml(r.employees?.nombre || 'Empleado')}</div>
            <div class="person-meta">
              <span>CC ${acEscapeHtml(r.employees?.cedula || '—')}</span>
              ${r.detalle ? `<span>${acEscapeHtml(r.detalle)}</span>` : ''}
              <span>${new Date(r.created_at).toLocaleString('es-CO')}</span>
              <span>Registró: ${acEscapeHtml(r.registrado_por_nombre || r.registrado_por_email)}</span>
            </div>
          </div>
          <button type="button" class="btn-secondary" data-ver-evidencia="${r.id}">Ver foto/firma</button>
        </div>
      `).join('');
      lista.querySelectorAll('[data-ver-evidencia]').forEach((btn) => {
        btn.addEventListener('click', () => this._verEvidencia(registros.find((r) => r.id === btn.dataset.verEvidencia)));
      });
    } catch (err) {
      cont.textContent = 'No se pudo cargar el listado: ' + err.message;
      lista.innerHTML = '';
    }
  },

  async _verEvidencia(registro) {
    Loading.show('Cargando…');
    let urlFoto = null;
    let urlFirma = null;
    try {
      [urlFoto, urlFirma] = await Promise.all([
        registro.foto_url ? DB.getSignedUrl('fotos-entrega', registro.foto_url) : Promise.resolve(null),
        registro.firma_url ? DB.getSignedUrl('firmas', registro.firma_url) : Promise.resolve(null),
      ]);
    } catch (err) {
      alert('No se pudo cargar la evidencia: ' + err.message);
      Loading.hide();
      return;
    }
    Loading.hide();

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${acEscapeHtml(registro.employees?.nombre || 'Empleado')} — CC ${acEscapeHtml(registro.employees?.cedula || '—')}</div>
          <div class="detalle-sub">${acEscapeHtml(this._actividadAbierta.nombre)} · ${new Date(registro.created_at).toLocaleString('es-CO')}</div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Foto</h3>
        ${urlFoto ? `<img src="${urlFoto}" style="max-width:100%;border-radius:8px" />` : '<p class="empty-note">Sin foto.</p>'}
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Firma</h3>
        ${urlFirma ? `<img src="${urlFirma}" style="max-height:120px;background:#fff;border:1px solid var(--slate-200,#e5e7eb);border-radius:6px;padding:6px" />` : '<p class="empty-note">Sin firma.</p>'}
      </div>
      <div style="margin-top:0.8rem"><button type="button" class="btn-secondary" id="ac-volver-btn">← Volver a la actividad</button></div>
    `;
    document.getElementById('ac-volver-btn').addEventListener('click', () => this._abrirActividad(this._actividadAbierta));
  },

  async _registrar(e) {
    e.preventDefault();
    const msg = document.getElementById('ac-registro-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const employeeId = document.getElementById('ac-empleado-id').value;
    const detalle = document.getElementById('ac-detalle').value.trim();

    if (!employeeId) {
      msg.textContent = 'Busca y selecciona el empleado que recibe.';
      msg.className = 'form-msg error';
      return;
    }
    if (this._acFirma.isEmpty()) {
      msg.textContent = 'Falta la firma de quien recibe.';
      msg.className = 'form-msg error';
      return;
    }
    if (this._acCamera.processing) {
      msg.textContent = 'Espera un momento, la foto se está procesando…';
      msg.className = 'form-msg error';
      return;
    }
    if (!this._acCamera.hasPhoto()) {
      msg.textContent = 'Falta la foto de quien recibe.';
      msg.className = 'form-msg error';
      return;
    }
    // Aviso suave (no bloqueante): puede ser legítimo repetir/corregir un
    // registro, así que se pregunta en vez de impedirlo del todo.
    if (this._registros?.some((r) => r.employee_id === employeeId)) {
      if (!confirm('Esta persona ya está registrada en esta actividad. ¿Registrarla de nuevo de todas formas?')) return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Subiendo firma y foto…');
    try {
      const firmaBlob = await this._acFirma.toBlob();
      if (!firmaBlob) throw new Error('No se pudo capturar la firma, inténtalo de nuevo.');
      const fotoFile = this._acCamera.getFile();
      const [firmaPath, fotoPath] = await Promise.all([
        DB.uploadToBucket('firmas', firmaBlob, 'png'),
        DB.uploadToBucket('fotos-entrega', fotoFile, (fotoFile.name.split('.').pop() || 'jpg')),
      ]);

      Loading.setMessage('Registrando…');
      await DB.registrarActividadPersona({
        actividadId: this._actividadAbierta.id,
        employeeId,
        detalle: detalle || null,
        firmaUrl: firmaPath,
        fotoUrl: fotoPath,
      });

      msg.textContent = 'Registrado correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('ac-registro-form').reset();
      // form.reset() no basta para el <input type="hidden"> -- se limpia a
      // mano para no dejar pegado el employeeId anterior (el buscador de
      // texto sí se limpia, pero registraría de nuevo al mismo empleado sin
      // que se note si alguien solo le da submit otra vez).
      document.getElementById('ac-empleado-id').value = '';
      document.getElementById('ac-empleado-search').value = '';
      this._acFirma.clear();
      this._acCamera.reset();
      await this._cargarRegistros();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo registrar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },
});
