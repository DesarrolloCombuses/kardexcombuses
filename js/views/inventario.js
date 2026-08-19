Router.register('inventario', {
  title: 'Inventario',

  async onEnter() {
    await this._reload();

    const search = document.getElementById('inventario-search');
    search.oninput = () => this._applyFilter();

    this._channel = DB.subscribeToChanges('inventario-live', ['item_variants'], () => this._reload());
  },

  onLeave() {
    DB.unsubscribe(this._channel);
    this._channel = null;
  },

  async _reload() {
    this._rows = await DB.getStockActual();
    this._applyFilter();
  },

  _applyFilter() {
    const search = document.getElementById('inventario-search');
    const q = search.value.trim().toLowerCase();
    const filtered = q
      ? this._rows.filter((r) => r.categoria.toLowerCase().includes(q) || r.talla.toLowerCase().includes(q))
      : this._rows;
    this._render(filtered);
  },

  _render(rows) {
    const tbody = document.getElementById('inventario-tbody');
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">Sin resultados.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${r.categoria}</td>
        <td>${r.talla}</td>
        <td>${r.stock_actual}</td>
        <td>${r.stock_total_categoria}</td>
      </tr>
    `).join('');
  },
});
