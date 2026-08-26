const PAGE_SIZE = 15;

Router.register('historial', {
  title: 'Historial de movimientos',
  async onEnter() {
    if (!this._bound) {
      document.getElementById('historial-refresh').addEventListener('click', () => this._load());
      document.getElementById('historial-tipo').addEventListener('change', () => {
        this._page = 1;
        this._load();
      });
      document.getElementById('historial-export-btn').addEventListener('click', () => this._exportExcel());
      document.getElementById('historial-prev').addEventListener('click', () => {
        if (this._page > 1) { this._page -= 1; this._load(); }
      });
      document.getElementById('historial-next').addEventListener('click', () => {
        if (this._page < this._totalPages) { this._page += 1; this._load(); }
      });
      this._bound = true;
    }
    this._page = this._page || 1;
    await this._load();
    this._channel = DB.subscribeToChanges(
      'historial-live',
      ['kardex_movements', 'kardex_movement_items'],
      () => this._loadDebounced()
    );
  },

  onLeave() {
    clearTimeout(this._debounce);
    DB.unsubscribe(this._channel);
    this._channel = null;
  },

  _loadDebounced() {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this._load(), 300);
  },

  // Trae solo la página actual (no todo el historial): con entregas
  // masivas el listado puede crecer a miles de filas y traerlas todas de
  // una sola vez sería lento tanto para Supabase como para el navegador.
  async _load() {
    const tipo = document.getElementById('historial-tipo').value || undefined;
    const { movements, total } = await DB.getMovements({ tipo, page: this._page, pageSize: PAGE_SIZE });
    this._movements = movements;
    this._total = total;
    this._totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (this._page > this._totalPages) {
      this._page = this._totalPages;
      if (total > 0) return this._load();
    }

    this._renderPagination();

    const list = document.getElementById('historial-list');
    if (movements.length === 0) {
      list.innerHTML = '<p class="muted">Sin movimientos.</p>';
      return;
    }
    list.innerHTML = movements.map((m) => {
      const nLineas = m.kardex_movement_items.length;
      const filas = [];
      if (m.tipo === 'salida' && m.employees) {
        const extra = [
          m.employees.cargo,
          m.employees.numero_interno ? `vehículo ${m.employees.numero_interno}` : '',
          m.employees.ruta ? `ruta ${m.employees.ruta}` : '',
        ].filter(Boolean).join(' · ');
        filas.push(`
          <div class="movement-card-row">
            <span class="movement-card-label">Empleado</span>
            <span class="movement-card-value">
              <strong>${m.employees.nombre}</strong> · CC ${m.employees.cedula}
              ${extra ? `<br><span class="muted">${extra}</span>` : ''}
            </span>
          </div>
        `);
      }
      filas.push(`
        <div class="movement-card-row">
          <span class="movement-card-label">${m.tipo === 'salida' ? 'Entregado / registrado por' : 'Registrado por'}</span>
          <span class="movement-card-value">${m.tipo === 'salida' && m.entregado_por_nombre ? m.entregado_por_nombre : (m.creado_por_nombre || '—')}</span>
        </div>
      `);
      return `
        <div class="movement-card ${m.anulado ? 'anulado' : ''}" data-id="${m.id}">
          <div class="movement-card-top">
            <span class="tag ${m.tipo}">${m.tipo}</span>
            ${m.anulado ? '<span class="tag anulado-tag">Anulado</span>' : ''}
            <span class="movement-card-fecha">${new Date(m.fecha).toLocaleString('es-CO')}</span>
          </div>
          <div class="movement-card-body">
            ${filas.join('')}
          </div>
          <div class="movement-card-foot muted">${nLineas} línea(s) de prenda</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.movement-card').forEach((el) => {
      el.addEventListener('click', () => this._openModal(el.dataset.id));
    });
  },

  _renderPagination() {
    const wrap = document.getElementById('historial-pagination');
    if (this._total === 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const start = (this._page - 1) * PAGE_SIZE + 1;
    const end = Math.min(this._page * PAGE_SIZE, this._total);
    document.getElementById('historial-pagination-info').textContent =
      `Mostrando ${start}–${end} de ${this._total} movimiento(s) · Página ${this._page} de ${this._totalPages}`;
    document.getElementById('historial-prev').disabled = this._page <= 1;
    document.getElementById('historial-next').disabled = this._page >= this._totalPages;
  },

  // Una fila por prenda/talla dentro de cada movimiento (no una por
  // movimiento), para que en Excel se pueda sumar/filtrar por categoría
  // igual que en cualquier kardex de bodega. La lista en pantalla está
  // paginada, así que para exportar se vuelve a pedir el historial
  // completo (con el mismo filtro de tipo) en una sola llamada aparte.
  async _exportExcel() {
    const btn = document.getElementById('historial-export-btn');
    const tipo = document.getElementById('historial-tipo').value || undefined;
    btn.disabled = true;
    try {
      const { movements } = await DB.getMovements({ tipo });
      if (movements.length === 0) {
        alert('No hay movimientos para exportar.');
        return;
      }
      this._buildExcel(movements);
    } finally {
      btn.disabled = false;
    }
  },

  _buildExcel(movements) {
    const data = [];
    movements.forEach((m) => {
      const base = {
        'Fecha': new Date(m.fecha).toLocaleString('es-CO'),
        'Tipo': m.tipo === 'entrada' ? 'Entrada' : 'Salida',
        'Empleado': m.employees ? `${m.employees.nombre} (${m.employees.cedula})` : '',
        'Entregado por': m.entregado_por_nombre || '',
        'Registrado por': m.creado_por_nombre || '',
        'Anulado': m.anulado ? 'Sí' : 'No',
        'Anulado por': m.anulado_por_nombre || '',
        'Anulado el': m.anulado_at ? new Date(m.anulado_at).toLocaleString('es-CO') : '',
        'Observaciones': m.observaciones || '',
      };
      m.kardex_movement_items.forEach((li) => {
        data.push({
          ...base,
          'Categoría': li.item_variants.item_categories.nombre,
          'Talla': li.item_variants.talla,
          'Cantidad': li.cantidad,
          'Stock resultante': li.stock_resultante,
        });
      });
    });

    const sheet = XLSX.utils.json_to_sheet(data, {
      header: ['Fecha', 'Tipo', 'Categoría', 'Talla', 'Cantidad', 'Stock resultante', 'Empleado', 'Entregado por', 'Registrado por', 'Anulado', 'Anulado por', 'Anulado el', 'Observaciones'],
    });
    sheet['!cols'] = [
      { wch: 19 }, { wch: 9 }, { wch: 30 }, { wch: 9 }, { wch: 10 }, { wch: 15 },
      { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 9 }, { wch: 20 }, { wch: 19 }, { wch: 30 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Historial');
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `historial-kardex-${fecha}.xlsx`);
  },

  async _openModal(id) {
    const m = this._movements.find((x) => x.id === id);
    if (!m) return;

    const prendasHtml = m.kardex_movement_items.map((li) => `
      <tr>
        <td>${li.item_variants.item_categories.nombre}</td>
        <td>${li.item_variants.talla}</td>
        <td>${li.cantidad}</td>
        <td>${li.stock_resultante}</td>
      </tr>
    `).join('');

    const emp = m.employees;
    const datosHtml = [
      this._modalRow('Registrado por', m.creado_por_nombre || '—'),
      m.tipo === 'salida' && emp ? this._modalRow('Empleado', `${emp.nombre} · CC ${emp.cedula}`) : '',
      m.tipo === 'salida' && emp?.cargo ? this._modalRow('Cargo', emp.cargo) : '',
      m.tipo === 'salida' && emp?.area ? this._modalRow('Área', emp.area) : '',
      m.tipo === 'salida' && emp?.numero_interno ? this._modalRow('Vehículo interno', emp.numero_interno) : '',
      m.tipo === 'salida' && emp?.ruta ? this._modalRow('Ruta', emp.ruta) : '',
      m.tipo === 'salida' ? this._modalRow('Entregado por', m.entregado_por_nombre || '—') : '',
    ].join('');

    let evidenciaHtml = '';
    if (m.tipo === 'salida') {
      const [firmaReceptor, firmaEntrega, foto] = await Promise.all([
        DB.getSignedUrl('firmas', m.firma_receptor_url),
        DB.getSignedUrl('firmas', m.firma_entrega_url),
        DB.getSignedUrl('fotos-entrega', m.foto_receptor_url),
      ]);
      const item = (label, url) => url ? `
        <a class="evidencia-item" href="${url}" target="_blank" rel="noopener">
          <span class="evidencia-label">${label}</span>
          <img src="${url}" alt="${label}">
        </a>
      ` : '';
      const items = [item('Firma receptor', firmaReceptor), item('Firma entrega', firmaEntrega), item('Foto receptor', foto)].join('');
      if (items) {
        evidenciaHtml = `
          <div class="modal-section">
            <h3 class="modal-section-title">Evidencia de entrega</h3>
            <div class="evidencia-grid">${items}</div>
          </div>
        `;
      }
    }

    const anuladoHtml = m.anulado
      ? `<p class="view-error" style="margin-top:1rem">Este movimiento fue <strong>anulado</strong>${m.anulado_at ? ' el ' + new Date(m.anulado_at).toLocaleString('es-CO') : ''}${m.anulado_por_nombre ? ' por ' + m.anulado_por_nombre : ''}. El stock ya fue revertido.</p>`
      : (window.APP_ROLE === 'admin' ? `<button type="button" id="modal-anular-btn" class="btn-secondary" style="margin-top:1.2rem;color:var(--danger-text)">Anular este movimiento</button>` : '');

    document.getElementById('modal-body').innerHTML = `
      <div class="modal-header">
        <span class="tag ${m.tipo}">${m.tipo}</span>
        ${m.anulado ? '<span class="tag anulado-tag">Anulado</span>' : ''}
        <span class="modal-header-fecha">${new Date(m.fecha).toLocaleString('es-CO')}</span>
      </div>

      <div class="modal-section">
        <div class="movement-card-body">${datosHtml}</div>
      </div>

      ${evidenciaHtml}

      <div class="modal-section">
        <h3 class="modal-section-title">Prendas (${m.kardex_movement_items.length})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Categoría</th><th>Talla</th><th>Cant.</th><th>Stock result.</th></tr></thead>
            <tbody>${prendasHtml}</tbody>
          </table>
        </div>
      </div>

      ${m.observaciones ? `
        <div class="modal-section">
          <h3 class="modal-section-title">Observaciones</h3>
          <p class="modal-observaciones">${m.observaciones}</p>
        </div>
      ` : ''}

      ${anuladoHtml}
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const anularBtn = document.getElementById('modal-anular-btn');
    if (anularBtn) {
      anularBtn.addEventListener('click', () => this._anular(m));
    }
  },

  _modalRow(label, value) {
    return `
      <div class="movement-card-row">
        <span class="movement-card-label">${label}</span>
        <span class="movement-card-value">${value}</span>
      </div>
    `;
  },

  async _anular(m) {
    const confirmado = confirm(
      `¿Anular este movimiento de ${m.tipo}? El stock se revertirá automáticamente. Esta acción queda registrada y no se puede deshacer.`
    );
    if (!confirmado) return;

    try {
      await DB.anularMovimiento(m.id);
      this._closeModal();
      await this._load();
    } catch (err) {
      alert('No se pudo anular el movimiento: ' + err.message);
    }
  },

  _closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
  },
});
