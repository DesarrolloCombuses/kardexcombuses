// Página pública (sin login) para que el nuevo empleado complete sus datos
// básicos a partir de un link con su employee_id. La cédula que escribe se
// valida del lado del servidor (funciones RPC en sql/perfil_publico.sql),
// nunca se confía en el cliente para decidir a quién pertenece el registro.
(function () {
  document.getElementById('pp-year').textContent = new Date().getFullYear();

  const params = new URLSearchParams(window.location.search);
  const employeeId = params.get('id');

  const gateCard = document.getElementById('pp-gate-card');
  const formCard = document.getElementById('pp-form-card');
  const errorCard = document.getElementById('pp-error-card');

  if (!employeeId) {
    gateCard.classList.add('hidden');
    errorCard.classList.remove('hidden');
    return;
  }

  let cedulaVerificada = null;

  const formatFecha = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  document.getElementById('pp-gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pp-gate-msg');
    const cedula = document.getElementById('pp-cedula').value.trim();
    msg.textContent = '';
    msg.className = 'form-msg';
    if (!cedula) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const perfil = await DB.obtenerPerfilPublico(employeeId, cedula);
      cedulaVerificada = cedula;

      document.getElementById('pp-saludo').textContent = `Hola, ${perfil.nombre || ''}`;
      document.getElementById('pp-cargo').textContent = perfil.cargo || '—';
      document.getElementById('pp-area').textContent = perfil.area || '—';
      document.getElementById('pp-fecha-ingreso').textContent = formatFecha(perfil.fecha_ingreso);
      document.getElementById('pp-fecha-nacimiento').value = perfil.fecha_nacimiento || '';
      document.getElementById('pp-sexo').value = perfil.sexo || '';
      document.getElementById('pp-lugar-residencia').value = perfil.lugar_residencia || '';
      document.getElementById('pp-barrio').value = perfil.barrio || '';
      document.getElementById('pp-telefono').value = perfil.telefono || '';

      gateCard.classList.add('hidden');
      formCard.classList.remove('hidden');
    } catch (err) {
      msg.textContent = 'No encontramos un registro con esa cédula para este link. Verifica e intenta de nuevo.';
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('pp-datos-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pp-datos-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';
    try {
      await DB.guardarPerfilPublico(employeeId, cedulaVerificada, {
        fechaNacimiento: document.getElementById('pp-fecha-nacimiento').value || null,
        sexo: document.getElementById('pp-sexo').value || null,
        lugarResidencia: document.getElementById('pp-lugar-residencia').value.trim() || null,
        barrio: document.getElementById('pp-barrio').value.trim() || null,
        telefono: document.getElementById('pp-telefono').value.trim() || null,
      });
      msg.textContent = 'Datos guardados. ¡Gracias!';
      msg.className = 'form-msg success';
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
