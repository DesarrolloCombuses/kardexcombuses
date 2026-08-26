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

  async _reload() {
    const [stock, employees, { movements: recent }] = await Promise.all([
      DB.getStockActual(),
      DB.getEmployees({ onlyActive: true }),
      DB.getMovements({ page: 1, pageSize: 8 }),
    ]);

    const categorias = new Set(stock.map((r) => r.item_category_id)).size;
    const stockTotal = stock.reduce((sum, r) => sum + r.stock_actual, 0);

    document.getElementById('kpi-categorias').textContent = categorias;
    document.getElementById('kpi-stock-total').textContent = stockTotal;
    document.getElementById('kpi-empleados').textContent = employees.length;

    const container = document.getElementById('dashboard-recent');
    const items = recent;
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
              <td>${new Date(m.fecha).toLocaleString('es-CO')}</td>
              <td>
                <span class="tag ${m.tipo}">${m.tipo}</span>
                ${m.anulado ? '<span class="tag anulado-tag">Anulado</span>' : ''}
              </td>
              <td>${m.employees ? m.employees.nombre : '—'}</td>
              <td>${m.kardex_movement_items.length}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },
});
