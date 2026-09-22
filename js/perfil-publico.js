// Página pública (sin login) para que el nuevo empleado complete su perfil
// a partir de un link con su employee_id. La cédula que escribe se valida
// del lado del servidor (funciones RPC en sql/perfil_publico.sql), nunca se
// confía en el cliente para decidir a quién pertenece el registro -- lo
// mismo aplica a la edad mínima (17 años), que también se revisa acá para
// dar feedback inmediato pero la valida de nuevo el servidor.
//
// Los campos del formulario NO viven acá: están en js/perfil-campos.js,
// compartidos con #/mi-perfil dentro de la app (que pide exactamente lo
// mismo, solo que ahí la persona ya inició sesión y no hay cédula que
// pedir). Este archivo es únicamente la lógica de esta página: el filtro de
// cédula, la foto y el guardado.
(function () {
  document.getElementById('pp-year').textContent = new Date().getFullYear();

  const params = new URLSearchParams(window.location.search);
  // "id" es opcional: solo lo trae el link personalizado que genera
  // Selección de personal para un aspirante recién convertido (exige que
  // coincida con la cédula). El link genérico que se comparte a toda la
  // planta no trae nada -- ahí el empleado se resuelve solo con la cédula
  // (ver perfil_publico_obtener/guardar en sql/perfil_publico.sql).
  const employeeIdUrl = params.get('id');

  const gateCard = document.getElementById('pp-gate-card');
  const formCard = document.getElementById('pp-form-card');

  let cedulaVerificada = null;
  let employeeIdResuelto = null;
  let fotoCamera = null;
  let cargoActual = null;

  const formatFecha = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // Mismo link y mismo formulario sirven tanto para que un aspirante recién
  // seleccionado complete su perfil por primera vez como para que cualquier
  // colaborador ya activo actualice sus datos más adelante -- el texto se
  // deja neutral a propósito (nada de "bienvenido" ni "tu proceso de
  // ingreso") para que tenga sentido en los dos casos.
  const MSG_EN_REVISION = 'Tu información quedó guardada. El equipo de Gestión Humana la va a revisar. Puedes volver a entrar por este mismo link cuando quieras para actualizar tus datos.';

  function bannerAprobacionHtml(perfil) {
    return perfil.perfil_aprobado_at
      ? '<div class="pp-banner aprobado" id="pp-estado-banner">✓ Tus datos ya fueron revisados y aprobados por Gestión Humana.</div>'
      : `<div class="pp-banner pendiente" id="pp-estado-banner">${MSG_EN_REVISION}</div>`;
  }

  function renderFormulario(perfil) {
    cargoActual = perfil.cargo;
    const seccionesHtml = seccionesVisibles(perfil.cargo).map((s) => seccionPublicaHtml(s, perfil)).join('');
    const inicial = (perfil.nombre || '?').trim().charAt(0).toUpperCase();

    formCard.innerHTML = `
      ${bannerAprobacionHtml(perfil)}

      <div class="pp-profile-header">
        <div class="foto-picker-row">
          <span class="person-avatar foto-picker-avatar" id="pp-foto-fallback">${inicial}</span>
          <img id="pp-foto-preview" class="foto-picker-preview hidden" alt="" />
          <div class="foto-picker-actions">
            <label class="file-picker" for="pp-foto-input">
              <svg viewBox="0 0 20 20" fill="none"><path d="M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
              <span id="pp-foto-label">${perfil.foto_url ? 'Cambiar foto' : 'Agregar foto'}</span>
            </label>
            <!-- Sin "capture": así el selector nativo del celular deja
                 elegir entre tomar una foto nueva o escogerla de la
                 galería, en vez de forzar la cámara de una (que es lo que
                 pasa con el atributo capture y no deja otra opción). -->
            <input type="file" id="pp-foto-input" accept="image/*" class="hidden" />
          </div>
        </div>
        <div class="pp-profile-header-name">
          <h2>Hola, ${perfil.nombre || ''}</h2>
          <p class="pp-subtitle" style="margin:0.15rem 0 0">Completa la mayor cantidad de datos que puedas. Puedes volver a este link cuando quieras para revisarlos.</p>
        </div>
      </div>

      <div class="detalle-facts">
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${perfil.cargo || '—'}</div><div class="detalle-fact-label">Cargo</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${perfil.area || '—'}</div><div class="detalle-fact-label">Área</div></div>
        <div class="detalle-fact"><div class="detalle-fact-value" style="font-size:1rem">${formatFecha(perfil.fecha_ingreso)}</div><div class="detalle-fact-label">Fecha de ingreso</div></div>
      </div>

      <form id="pp-datos-form" class="form">
        <fieldset class="pp-section">
          <legend>Fecha de nacimiento</legend>
          <label>Fecha de nacimiento<input type="date" id="pp-fecha-nacimiento" value="${perfil.fecha_nacimiento || ''}" required /></label>
          <p id="pp-fecha-nacimiento-msg" class="form-msg"></p>
        </fieldset>

        ${seccionesHtml}

        <fieldset class="pp-section">
          <legend>Contacto</legend>
          <div class="fieldset-grid">
            <label>Teléfono<input type="tel" id="pp-telefono" value="${perfil.telefono || ''}" placeholder="Número de celular" /></label>
            <label>Correo personal<input type="email" id="pp-email-personal" value="${perfil.email_personal || ''}" placeholder="tucorreo@ejemplo.com" /></label>
          </div>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Contactos de emergencia</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Puedes agregar más de uno.</p>
          <div id="pp-contactos"></div>
          <button type="button" id="pp-contacto-add" class="btn-secondary">+ Agregar contacto</button>
        </fieldset>

        <fieldset class="pp-section">
          <legend>Hijos</legend>
          <p class="view-intro" style="margin:0 0 0.6rem">Si tienes, puedes agregar más de uno.</p>
          <div id="pp-hijos"></div>
          <button type="button" id="pp-hijo-add" class="btn-secondary">+ Agregar hijo/a</button>
        </fieldset>

        <button type="submit" class="btn-block"><span>Guardar mis datos</span></button>
        <p id="pp-datos-msg" class="form-msg"></p>
      </form>
    `;

    document.getElementById('pp-contacto-add').addEventListener('click', () => addContactoRow('pp-contactos'));
    (perfil.contactos || []).forEach((c) => addContactoRow('pp-contactos', c));

    document.getElementById('pp-hijo-add').addEventListener('click', () => addHijoRow('pp-hijos'));
    (perfil.hijos || []).forEach((h) => addHijoRow('pp-hijos', h));

    // stamp:false -- es una foto de perfil, no debe quedar con fecha/hora
    // quemada como las de evidencia de entrega.
    fotoCamera = new CameraCapture({
      inputEl: document.getElementById('pp-foto-input'),
      previewEl: document.getElementById('pp-foto-preview'),
      stamp: false,
      filename: 'foto-perfil-publico.jpg',
    });

    document.getElementById('pp-fecha-nacimiento').addEventListener('change', (e) => {
      const err = validarFechaNacimiento(e.target.value);
      const msg = document.getElementById('pp-fecha-nacimiento-msg');
      msg.textContent = err || '';
      msg.className = err ? 'form-msg error' : 'form-msg';
    });

    document.getElementById('pp-datos-form').addEventListener('submit', onSubmitDatos);
  }

  async function onSubmitDatos(e) {
    e.preventDefault();
    const msg = document.getElementById('pp-datos-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const fechaNacimiento = document.getElementById('pp-fecha-nacimiento').value;
    const errorFecha = validarFechaNacimiento(fechaNacimiento);
    if (errorFecha) {
      document.getElementById('pp-fecha-nacimiento-msg').textContent = errorFecha;
      document.getElementById('pp-fecha-nacimiento-msg').className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';
    Loading.show('Guardando…');

    try {
      let fotoUrl = null;
      if (fotoCamera && fotoCamera.hasPhoto()) {
        Loading.setMessage('Subiendo foto…');
        fotoUrl = await DB.uploadFotoPublico(employeeIdResuelto, fotoCamera.getFile());
        Loading.setMessage('Guardando…');
      }

      const perfil = {
        fecha_nacimiento: fechaNacimiento,
        telefono: document.getElementById('pp-telefono').value.trim() || null,
        email_personal: document.getElementById('pp-email-personal').value.trim() || null,
      };
      // Solo se leen los campos que de verdad se mostraron (ver
      // seccionesVisibles) -- si "Experiencia como conductor" no aplicó,
      // esos inputs ni existen en el DOM.
      seccionesVisibles(cargoActual).flatMap((s) => s.campos).forEach((c) => { perfil[c.id] = leerValorCampo(c); });

      await DB.guardarPerfilPublico(
        employeeIdResuelto, cedulaVerificada, perfil,
        leerContactos('pp-contactos'), leerHijos('pp-hijos'), fotoUrl,
      );
      msg.textContent = '¡Datos guardados! El equipo de Gestión Humana los va a revisar.';
      msg.className = 'form-msg success';

      // guardarPerfilPublico() siempre deja el perfil pendiente de nuevo
      // del lado del servidor (ver sql/perfil_publico.sql) -- se refleja
      // acá mismo sin tener que volver a pedir todo el perfil.
      const banner = document.getElementById('pp-estado-banner');
      if (banner) {
        banner.className = 'pp-banner pendiente';
        banner.textContent = MSG_EN_REVISION;
      }
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  }

  document.getElementById('pp-gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pp-gate-msg');
    const cedula = document.getElementById('pp-cedula').value.trim();
    msg.textContent = '';
    msg.className = 'form-msg';
    if (!cedula) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Verificando…');
    try {
      const perfil = await DB.obtenerPerfilPublico(employeeIdUrl, cedula);
      cedulaVerificada = cedula;
      employeeIdResuelto = perfil.employee_id;
      renderFormulario(perfil);
      gateCard.classList.add('hidden');
      formCard.classList.remove('hidden');
    } catch (err) {
      msg.textContent = 'No encontramos un registro con esa cédula para este link. Verifica e intenta de nuevo.';
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  });
})();
