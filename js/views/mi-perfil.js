// "Mi perfil": autoservicio del colaborador que YA tiene cuenta en la app.
// Pide exactamente los mismos datos que el link público
// (perfil-publico.html) -- los campos viven en js/perfil-campos.js, no acá --
// pero sin filtro de cédula: el servidor sabe de quién es el perfil por el
// correo de la sesión (kardex_mi_perfil_obtener/guardar, ver
// sql/mi_perfil_2026-09-22.sql).
//
// Igual que en el link público, guardar deja el perfil PENDIENTE de revisión
// de Gestión Humana otra vez, y la foto que se sube no se vuelve la oficial
// sola. Es a propósito: el que una persona pueda corregir sus datos no
// significa que nadie los revise.

function mpEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mpFormatFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Los ids que genera esta vista van con prefijo "mip-": "mp-" ya es de
// #/mis-permisos, que vive en el mismo app.html (oculta, pero en el DOM), y
// dos elementos con el mismo id harían que getElementById devuelva el de la
// otra vista.
// Dos mensajes distintos para el mismo estado "pendiente": al entrar, la
// persona todavía no ha guardado nada, y decirle "tus datos quedaron
// guardados" ahí no tiene sentido -- pensaría que ya hizo algo.
const MP_MSG_PENDIENTE = 'Gestión Humana todavía no ha revisado tus datos. Puedes corregir lo que necesites.';
const MP_MSG_GUARDADO = 'Tus datos quedaron guardados. Gestión Humana los va a revisar.';

Router.register('mi-perfil', {
  title: 'Mi perfil',

  async onEnter() {
    const cont = document.getElementById('mi-perfil-contenido');
    cont.innerHTML = '<p class="empty-note">Cargando tus datos…</p>';

    let perfil;
    try {
      perfil = await DB.getMiPerfil();
    } catch (err) {
      // El caso normal de error acá es una cuenta que no corresponde a
      // ninguna ficha de empleado activa (una cuenta administrativa, o
      // alguien que ya salió de la empresa). Se explica en vez de mostrar
      // el mensaje crudo de Postgres.
      cont.innerHTML = `
        <div class="panel-card">
          <p class="empty-note">${mpEscapeHtml(err.message || 'No se pudo cargar tu perfil.')}</p>
          <p class="view-intro" style="margin-top:0.6rem">Si crees que es un error, avísale a Gestión Humana: tu correo de la app tiene que ser el mismo que figura en tu ficha de empleado.</p>
        </div>
      `;
      return;
    }

    this._perfil = perfil;
    this._render(perfil);
  },

  _render(perfil) {
    const cont = document.getElementById('mi-perfil-contenido');
    const seccionesHtml = seccionesVisibles(perfil.cargo).map((s) => seccionPublicaHtml(s, perfil)).join('');
    const inicial = (perfil.nombre || '?').trim().charAt(0).toUpperCase();
    const banner = perfil.perfil_aprobado_at
      ? '<div class="pp-banner aprobado" id="mip-estado-banner">✓ Tus datos ya fueron revisados y aprobados por Gestión Humana.</div>'
      : `<div class="pp-banner pendiente" id="mip-estado-banner">${MP_MSG_PENDIENTE}</div>`;

    cont.innerHTML = `
      ${banner}

      <div class="panel-card">
        <div class="pp-profile-header">
          <div class="foto-picker-row">
            <span class="person-avatar foto-picker-avatar" id="pp-foto-fallback">${mpEscapeHtml(inicial)}</span>
            <img id="pp-foto-preview" class="foto-picker-preview hidden" alt="" />
            <div class="foto-picker-actions">
              <label class="file-picker" for="pp-foto-input">
                <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
                <span id="pp-foto-label">${perfil.foto_url ? 'Cambiar foto' : 'Agregar foto'}</span>
              </label>
              <!-- Sin "capture": el selector nativo del celular deja elegir
                   entre tomar la foto o sacarla de la galería. -->
              <input type="file" id="pp-foto-input" accept="image/*" class="hidden" />
            </div>
          </div>
          <div class="pp-profile-header-name">
            <h2>Hola, ${mpEscapeHtml(perfil.nombre || '')}</h2>
            <p class="view-intro" style="margin:0.15rem 0 0">Estos son tus datos. Corrige lo que esté mal y completa lo que falte.</p>
          </div>
        </div>

        <div class="detalle-facts">
          <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${mpEscapeHtml(perfil.cargo || '—')}</div><div class="detalle-fact-label">Cargo</div></div>
          <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${mpEscapeHtml(perfil.area || '—')}</div><div class="detalle-fact-label">Área</div></div>
          <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${mpFormatFecha(perfil.fecha_ingreso)}</div><div class="detalle-fact-label">Fecha de ingreso</div></div>
        </div>
      </div>

      <form id="mip-form" class="form panel-card" style="margin-top:1rem">
        <fieldset class="pp-section">
          <legend>Fecha de nacimiento</legend>
          <label>Fecha de nacimiento<input type="date" id="pp-fecha-nacimiento" value="${perfil.fecha_nacimiento || ''}" required /></label>
          <p id="pp-fecha-nacimiento-msg" class="form-msg"></p>
        </fieldset>

        ${seccionesHtml}

        <fieldset class="pp-section">
          <legend>Contacto</legend>
          <div class="fieldset-grid">
            <label>Teléfono<input type="tel" id="pp-telefono" value="${mpEscapeHtml(perfil.telefono || '')}" placeholder="Número de celular" /></label>
            <label>Correo personal<input type="email" id="pp-email-personal" value="${mpEscapeHtml(perfil.email_personal || '')}" placeholder="tucorreo@ejemplo.com" /></label>
          </div>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Contactos de emergencia</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Puedes agregar más de uno.</p>
          <div id="mip-contactos"></div>
          <button type="button" id="mip-contacto-add" class="btn-secondary">+ Agregar contacto</button>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Hijos</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Si tienes, puedes agregar más de uno.</p>
          <div id="mip-hijos"></div>
          <button type="button" id="mip-hijo-add" class="btn-secondary">+ Agregar hijo/a</button>
        </fieldset>

        <button type="submit" class="btn-block"><span>Guardar mis datos</span></button>
        <p id="mip-msg" class="form-msg"></p>
      </form>
    `;

    document.getElementById('mip-contacto-add').addEventListener('click', () => addContactoRow('mip-contactos'));
    (perfil.contactos || []).forEach((c) => addContactoRow('mip-contactos', c));

    document.getElementById('mip-hijo-add').addEventListener('click', () => addHijoRow('mip-hijos'));
    (perfil.hijos || []).forEach((h) => addHijoRow('mip-hijos', h));

    // stamp:false -- foto de perfil, no evidencia de entrega: no debe quedar
    // con la fecha y hora quemadas encima.
    this._fotoCamera = new CameraCapture({
      inputEl: document.getElementById('pp-foto-input'),
      previewEl: document.getElementById('pp-foto-preview'),
      stamp: false,
      filename: 'foto-perfil.jpg',
    });

    // El bucket es privado, así que la foto que ya tiene se muestra con una
    // URL firmada. Si falla (foto borrada, por ejemplo) se deja la inicial.
    if (perfil.foto_url) {
      DB.getSignedUrl('fotos-empleados', perfil.foto_url)
        .then((url) => {
          if (!url) return;
          const img = document.getElementById('pp-foto-preview');
          const fallback = document.getElementById('pp-foto-fallback');
          if (!img || !fallback) return;
          img.src = url;
          img.classList.remove('hidden');
          fallback.classList.add('hidden');
        })
        .catch(() => {});
    }

    document.getElementById('pp-fecha-nacimiento').addEventListener('change', (e) => {
      const err = validarFechaNacimiento(e.target.value);
      const msg = document.getElementById('pp-fecha-nacimiento-msg');
      msg.textContent = err || '';
      msg.className = err ? 'form-msg error' : 'form-msg';
    });

    document.getElementById('mip-form').addEventListener('submit', (e) => this._submit(e));
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('mip-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const fechaNacimiento = document.getElementById('pp-fecha-nacimiento').value;
    const errorFecha = validarFechaNacimiento(fechaNacimiento);
    if (errorFecha) {
      const fmsg = document.getElementById('pp-fecha-nacimiento-msg');
      fmsg.textContent = errorFecha;
      fmsg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Guardando…');

    try {
      let fotoNueva = false;
      if (this._fotoCamera && this._fotoCamera.hasPhoto()) {
        Loading.setMessage('Subiendo foto…');
        await DB.uploadFotoPublico(this._perfil.employee_id, this._fotoCamera.getFile());
        fotoNueva = true;
        Loading.setMessage('Guardando…');
      }

      const perfil = {
        fecha_nacimiento: fechaNacimiento,
        telefono: document.getElementById('pp-telefono').value.trim() || null,
        email_personal: document.getElementById('pp-email-personal').value.trim() || null,
      };
      // Solo los campos que de verdad se pintaron: si la sección de
      // conductor no aplicaba al cargo, esos inputs ni existen en el DOM.
      seccionesVisibles(this._perfil.cargo).flatMap((s) => s.campos)
        .forEach((c) => { perfil[c.id] = leerValorCampo(c); });

      await DB.guardarMiPerfil(perfil, leerContactos('mip-contactos'), leerHijos('mip-hijos'), fotoNueva);

      msg.textContent = '¡Listo! Tus datos quedaron guardados.';
      msg.className = 'form-msg success';

      // Guardar siempre vuelve a dejar el perfil pendiente del lado del
      // servidor; se refleja acá sin tener que recargar todo.
      const banner = document.getElementById('mip-estado-banner');
      if (banner) {
        banner.className = 'pp-banner pendiente';
        banner.textContent = MP_MSG_GUARDADO;
      }
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },
});
