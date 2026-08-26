Router.register('inventario', {
  title: 'Inventario',

  async onEnter() {
    await this._reload();

    const search = document.getElementById('inventario-search');
    search.oninput = () => this._applyFilter();

    document.getElementById('inventario-export-btn').onclick = () => this._exportExcel();

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
    this._filteredRows = filtered;
    this._render(filtered);
  },

  _exportExcel() {
    const rows = this._filteredRows || this._rows || [];
    if (rows.length === 0) {
      alert('No hay datos de inventario para exportar.');
      return;
    }
    const data = rows.map((r) => ({
      'Categoría': r.categoria,
      'Talla': r.talla,
      'Stock actual': r.stock_actual,
      'Total categoría': r.stock_total_categoria,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 12 }, { wch: 16 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Inventario');
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `inventario-kardex-${fecha}.xlsx`);
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
