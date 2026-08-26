Router.register('historial', {
  title: 'Historial de movimientos',
  async onEnter() {
    if (!this._bound) {
      document.getElementById('historial-refresh').addEventListener('click', () => this._load());
      document.getElementById('historial-tipo').addEventListener('change', () => this._load());
      this._bound = true;
    }
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

  async _load() {
    const tipo = document.getElementById('historial-tipo').value || undefined;
    const movements = await DB.getMovements({ tipo });
    this._movements = movements;

    const list = document.getElementById('historial-list');
    if (movements.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted)">Sin movimientos.</p>';
      return;
    }
    list.innerHTML = movements.map((m) => `
      <div class="movement-item ${m.anulado ? 'anulado' : ''}" data-id="${m.id}">
        <span class="tag ${m.tipo}">${m.tipo}</span>
        ${m.anulado ? '<span class="tag anulado-tag">Anulado</span>' : ''}
        <strong>${new Date(m.fecha).toLocaleString('es-CO')}</strong>
        ${m.employees ? `— ${m.employees.nombre}` : ''}
        <span class="muted"> · ${m.kardex_movement_items.length} línea(s)</span>
      </div>
    `).join('');

    list.querySelectorAll('.movement-item').forEach((el) => {
      el.addEventListener('click', () => this._openModal(el.dataset.id));
    });
  },

  async _openModal(id) {
    const m = this._movements.find((x) => x.id === id);
    if (!m) return;

    const lineasHtml = m.kardex_movement_items.map((li) => `
      <li>${li.item_variants.item_categories.nombre} — talla ${li.item_variants.talla}: ${li.cantidad} und. (stock resultante: ${li.stock_resultante})</li>
    `).join('');

    let evidenciaHtml = '';
    if (m.tipo === 'salida') {
      const [firmaReceptor, firmaEntrega, foto] = await Promise.all([
        DB.getSignedUrl('firmas', m.firma_receptor_url),
        DB.getSignedUrl('firmas', m.firma_entrega_url),
        DB.getSignedUrl('fotos-entrega', m.foto_receptor_url),
      ]);
      evidenciaHtml = `
        <p><strong>Empleado:</strong> ${m.employees ? `${m.employees.nombre} (${m.employees.cedula})` : '—'}</p>
        <p><strong>Entregado por:</strong> ${m.entregado_por_nombre || '—'}</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:0.5rem">
          ${firmaReceptor ? `<div><small>Firma receptor</small><br><img src="${firmaReceptor}" style="max-width:180px;border:1px solid var(--border);border-radius:6px"></div>` : ''}
          ${firmaEntrega ? `<div><small>Firma entrega</small><br><img src="${firmaEntrega}" style="max-width:180px;border:1px solid var(--border);border-radius:6px"></div>` : ''}
          ${foto ? `<div><small>Foto receptor</small><br><img src="${foto}" style="max-width:180px;border:1px solid var(--border);border-radius:6px"></div>` : ''}
        </div>
      `;
    }

    const anuladoHtml = m.anulado
      ? `<p class="view-error" style="margin-top:1rem">Este movimiento fue <strong>anulado</strong>${m.anulado_at ? ' el ' + new Date(m.anulado_at).toLocaleString('es-CO') : ''}${m.anulado_por_nombre ? ' por ' + m.anulado_por_nombre : ''}. El stock ya fue revertido.</p>`
      : `<button type="button" id="modal-anular-btn" class="btn-secondary" style="margin-top:1rem;color:var(--danger-text)">Anular este movimiento</button>`;

    document.getElementById('modal-body').innerHTML = `
      <h2 style="margin-top:0">
        <span class="tag ${m.tipo}">${m.tipo}</span>
        ${new Date(m.fecha).toLocaleString('es-CO')}
      </h2>
      <p><strong>Registrado por:</strong> ${m.creado_por_nombre || '—'}</p>
      ${evidenciaHtml}
      <p><strong>Prendas:</strong></p>
      <ul>${lineasHtml}</ul>
      ${m.observaciones ? `<p><strong>Observaciones:</strong> ${m.observaciones}</p>` : ''}
      ${anuladoHtml}
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const anularBtn = document.getElementById('modal-anular-btn');
    if (anularBtn) {
      anularBtn.addEventListener('click', () => this._anular(m));
    }
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
