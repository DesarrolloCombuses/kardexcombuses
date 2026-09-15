// Autoservicio del empleado: pide sus propios permisos/vacaciones y ve el
// estado de lo que ya pidió. RLS ya limita todo a su propia fila (ver
// sql/permisos_vacaciones_2026-09-15.sql), así que acá no hace falta volver
// a filtrar por empleado -- lo que llega de DB.getMisPermisos() ya es solo
// lo suyo.

function formatFechaHoraPermiso(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function tagPermiso(estado) {
  return estado === 'Aprobado' ? 'completo' : estado === 'Rechazado' ? 'descartado' : 'pendiente';
}

Router.register('mis-permisos', {
  title: 'Mis permisos',

  async onEnter() {
    if (!this._bound) {
      document.getElementById('mp-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('mp-soporte-input').addEventListener('change', () => this._updateSoporteLabel());
      document.getElementById('mp-reposicion').addEventListener('change', () => this._toggleReemplazo());
      this._setupReemplazoCombobox();
      this._bound = true;
    }
    await this._load();
  },

  async _load() {
    const [miEmpleado, directorio, misPermisos] = await Promise.all([
      DB.getMiEmpleado(),
      DB.getDirectorioEmpleados(),
      DB.getMisPermisos(),
    ]);
    this._miEmpleado = miEmpleado;
    this._directorio = directorio.filter((e) => e.id !== miEmpleado?.id);
    this._misPermisos = misPermisos;
    this._pintarFicha();
    this._render();
  },

  _pintarFicha() {
    const e = this._miEmpleado;
    document.getElementById('mp-ficha-datos').innerHTML = e ? `
      <div class="detalle-fact"><div class="detalle-fact-value">${e.nombre}</div><div class="detalle-fact-label">Nombre</div></div>
      <div class="detalle-fact"><div class="detalle-fact-value">${e.cedula}</div><div class="detalle-fact-label">Cédula</div></div>
      <div class="detalle-fact"><div class="detalle-fact-value">${e.cargo || '—'}</div><div class="detalle-fact-label">Cargo</div></div>
      <div class="detalle-fact"><div class="detalle-fact-value">${e.area || '—'}</div><div class="detalle-fact-label">Área</div></div>
    ` : '<p class="empty-note">No se encontró tu ficha de empleado.</p>';
  },

  _toggleReemplazo() {
    const requiere = document.getElementById('mp-reposicion').value === 'si';
    document.getElementById('mp-reemplazo-wrap').classList.toggle('hidden', !requiere);
    if (!requiere) {
      document.getElementById('mp-reemplazo-id').value = '';
      document.getElementById('mp-reemplazo-input').value = '';
    }
  },

  _updateSoporteLabel() {
    const input = document.getElementById('mp-soporte-input');
    const label = document.getElementById('mp-soporte-label');
    label.textContent = input.files[0] ? input.files[0].name : 'Adjuntar soporte (opcional, PDF o foto)';
  },

  // Buscador de "Empleado que reemplaza" -- mismo patrón que el combobox de
  // empleado en salida.js, pero contra el directorio liviano (sin datos
  // sensibles) que sí puede leer un empleado autenticado.
  _setupReemplazoCombobox() {
    const search = document.getElementById('mp-reemplazo-input');
    const hidden = document.getElementById('mp-reemplazo-id');
    const list = document.getElementById('mp-reemplazo-list');
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._directorio.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q))
        : this._directorio;
      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `<li data-id="${e.id}">${e.nombre} <span class="combobox-cedula">· CC ${e.cedula}</span></li>`).join('');
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
      const empleado = this._directorio.find((emp) => emp.id === li.dataset.id);
      if (!empleado) return;
      hidden.value = empleado.id;
      search.value = `${empleado.nombre} — CC ${empleado.cedula}`;
      list.classList.add('hidden');
    });
  },

  _render() {
    const total = this._misPermisos.length;
    document.getElementById('mp-contador').textContent = total ? `${total} solicitud(es)` : 'Todavía no has pedido ningún permiso.';

    const lista = document.getElementById('mp-lista');
    lista.innerHTML = this._misPermisos.map((p) => {
      const meta = [
        `${formatFechaHoraPermiso(p.fecha_hora_inicio)} → ${formatFechaHoraPermiso(p.fecha_hora_fin)}`,
        p.estado === 'Rechazado' && p.motivo_rechazo ? `Motivo: ${p.motivo_rechazo}` : null,
      ].filter(Boolean).join(' · ');
      return `
        <div class="person-row">
          <div class="person-info">
            <div class="person-name">${p.tipo_permiso}</div>
            <div class="person-meta"><span>${meta}</span></div>
          </div>
          <span class="tag ${tagPermiso(p.estado)}">${p.estado}</span>
          ${p.estado === 'Aprobado' ? `<button type="button" class="btn-secondary" data-comprobante="${p.id}">Comprobante</button>` : ''}
        </div>
      `;
    }).join('');

    lista.querySelectorAll('[data-comprobante]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = this._misPermisos.find((x) => x.id === btn.dataset.comprobante);
        if (p) this._imprimirComprobante(p);
      });
    });
  },

  _imprimirComprobante(p) {
    const ventana = window.open('', '_blank');
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Comprobante de permiso</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 30px; color: #111; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  td { border: 1px solid #ccc; padding: 8px 10px; }
  td.label { font-weight: 700; background: #f3f4f6; width: 35%; }
  .print-actions { margin-bottom: 16px; }
  .print-actions button { font: inherit; padding: 8px 16px; border-radius: 6px; border: none; background: #0f8a4f; color: #fff; font-weight: 600; cursor: pointer; }
  @media print { .print-actions { display: none; } }
</style></head><body>
  <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <h2>Comprobante de permiso — APROBADO</h2>
  <table>
    <tr><td class="label">Empleado</td><td>${this._miEmpleado?.nombre || ''} — CC ${this._miEmpleado?.cedula || ''}</td></tr>
    <tr><td class="label">Tipo de permiso</td><td>${p.tipo_permiso}</td></tr>
    <tr><td class="label">Desde</td><td>${formatFechaHoraPermiso(p.fecha_hora_inicio)}</td></tr>
    <tr><td class="label">Hasta</td><td>${formatFechaHoraPermiso(p.fecha_hora_fin)}</td></tr>
    <tr><td class="label">Motivo</td><td>${p.motivo || '—'}</td></tr>
    <tr><td class="label">Aprobado por</td><td>${p.aprobado_por || '—'}</td></tr>
    <tr><td class="label">Aprobado el</td><td>${formatFechaHoraPermiso(p.aprobado_en)}</td></tr>
  </table>
</body></html>`;
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('mp-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    if (!this._miEmpleado) {
      msg.textContent = 'No se encontró tu ficha de empleado — avísale a Gestión Humana.';
      msg.className = 'form-msg error';
      return;
    }

    const tipoPermiso = document.getElementById('mp-tipo').value;
    const inicioVal = document.getElementById('mp-inicio').value;
    const finVal = document.getElementById('mp-fin').value;
    const motivo = document.getElementById('mp-motivo').value.trim() || null;
    const requiereReposicion = document.getElementById('mp-reposicion').value === 'si';
    const reemplazoEmployeeId = document.getElementById('mp-reemplazo-id').value || null;
    const soporteFile = document.getElementById('mp-soporte-input').files[0] || null;

    if (!tipoPermiso || !inicioVal || !finVal) {
      msg.textContent = 'Tipo de permiso y fechas son obligatorios.';
      msg.className = 'form-msg error';
      return;
    }
    if (requiereReposicion && !reemplazoEmployeeId) {
      msg.textContent = 'Selecciona quién te reemplaza.';
      msg.className = 'form-msg error';
      return;
    }
    const fechaHoraInicio = new Date(inicioVal).toISOString();
    const fechaHoraFin = new Date(finVal).toISOString();
    if (fechaHoraFin <= fechaHoraInicio) {
      msg.textContent = 'La fecha de fin debe ser posterior a la de inicio.';
      msg.className = 'form-msg error';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    Loading.show('Enviando…');
    try {
      await DB.createPermiso({
        employeeId: this._miEmpleado.id,
        tipoPermiso,
        fechaHoraInicio,
        fechaHoraFin,
        motivo,
        requiereReposicion,
        reemplazoEmployeeId,
        soporteFile,
      });
      msg.textContent = 'Solicitud enviada correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('mp-form').reset();
      this._toggleReemplazo();
      this._updateSoporteLabel();
      await this._load();
    } catch (err) {
      msg.textContent = 'No se pudo enviar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      Loading.hide();
    }
  },
});
