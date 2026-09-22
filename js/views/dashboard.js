Router.register('dashboard', {
  title: 'Panel',

  async onEnter() {
    await this._reload();
    this._channel = DB.subscribeToChanges(
      'dashboard-live',
      ['item_variants', 'kardex_movements', 'kardex_movement_items', 'employees'],
      () => this._reloadDebounced()
    );
  },

  onLeave() {
    clearTimeout(this._debounce);
    DB.unsubscribe(this._channel);
    this._channel = null;
  },

  _reloadDebounced() {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this._reload(), 300);
  },

  // Mismo umbral que Estadísticas (5 = alerta, 2 = crítico) para que el
  // conteo que ve el usuario en el Dashboard y en Estadísticas coincida.
  _UMBRAL_BAJO: 5,
  _UMBRAL_CRITICO: 2,

  async _reload() {
    const kpis = await DB.getDashboardKpis();
    const bajoStock = kpis.bajo_stock;

    document.getElementById('kpi-categorias').textContent = kpis.categorias;
    document.getElementById('kpi-stock-total').textContent = kpis.stock_total;
    document.getElementById('kpi-empleados').textContent = kpis.empleados_activos;
    document.getElementById('kpi-bajo-stock').textContent = bajoStock.length;
    document.getElementById('kpi-bajo-stock-icon').dataset.tone = bajoStock.length > 0 ? 'red' : 'green';

    this._renderStockAlert(bajoStock);

    const container = document.getElementById('dashboard-recent');
    const items = kpis.movimientos_recientes;
    if (items.length === 0) {
      container.innerHTML = '<p class="muted" style="padding:1rem">Sin movimientos todavía.</p>';
      return;
    }
    container.innerHTML = `
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Empleado</th><th>Líneas</th></tr></thead>
        <tbody>
          ${items.map((m) => `
            <tr class="${m.anulado ? 'anulado-row' : ''}">
              <td data-label="Fecha">${new Date(m.fecha).toLocaleString('es-CO')}</td>
              <td data-label="Tipo">
                <span class="tag ${m.tipo}">${m.tipo}</span>
                ${m.anulado ? '<span class="tag anulado-tag">Anulado</span>' : ''}
              </td>
              <td data-label="Empleado">${m.empleado_nombre || '—'}</td>
              <td data-label="Líneas">${m.lineas}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _renderStockAlert(items) {
    const box = document.getElementById('dashboard-stock-alert');
    const list = document.getElementById('dashboard-low-stock');

    if (items.length === 0) {
      box.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    const MAX_VISIBLES = 6;
    const visibles = items.slice(0, MAX_VISIBLES);
    const criticos = items.filter((r) => r.stock_actual <= this._UMBRAL_CRITICO).length;

    document.getElementById('dashboard-stock-alert-title').textContent = criticos > 0
      ? `${items.length} prenda${items.length === 1 ? '' : 's'} con stock bajo — ${criticos} a punto de agotarse`
      : `${items.length} prenda${items.length === 1 ? '' : 's'} con stock bajo`;

    list.innerHTML = visibles.map((r) => {
      const nivel = r.stock_actual <= this._UMBRAL_CRITICO ? 'critico' : 'alerta';
      // Mínimo de 6% para que un stock en 0 siga mostrando una barra roja
      // visible en vez de desaparecer (justo el caso más urgente).
      const pct = Math.max(6, Math.min(100, (r.stock_actual / this._UMBRAL_BAJO) * 100));
      return `
        <div class="low-stock-row">
          <span class="lsr-name">${r.categoria}<small>Talla ${r.talla}</small></span>
          <span class="low-stock-track"><span class="low-stock-fill ${nivel}" style="width:${pct}%"></span></span>
          <span class="lsr-value ${nivel}">${r.stock_actual} und.</span>
        </div>
      `;
    }).join('');

    if (items.length > visibles.length) {
      list.innerHTML += `<p class="empty-note">Y ${items.length - visibles.length} más — ver todas en Estadísticas.</p>`;
    }

    box.classList.remove('hidden');
  },
});
