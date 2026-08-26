Router.register('inventario-historico', {
  title: 'Inventario histórico',

  async onEnter() {
    const fechaInput = document.getElementById('historico-fecha');
    const hoy = new Date().toISOString().slice(0, 10);
    fechaInput.max = hoy;
    if (!fechaInput.value) fechaInput.value = hoy;

    if (!this._bound) {
      fechaInput.addEventListener('change', () => this._reload());
      document.getElementById('historico-export-btn').addEventListener('click', () => this._exportExcel());
      this._bound = true;
    }

    try {
      const desde = await DB.getEarliestMovementDate();
      const nota = document.getElementById('historico-disponible-desde');
      nota.textContent = desde
        ? `Datos disponibles desde el ${new Date(desde).toLocaleDateString('es-CO')}. Antes de esa fecha el sistema no tenía movimientos registrados.`
        : 'Todavía no hay movimientos registrados.';
    } catch { /* no bloquea la consulta principal */ }

    await this._reload();
  },

  async _reload() {
    const fechaInput = document.getElementById('historico-fecha');
    if (!fechaInput.value) return;
    const finDelDia = new Date(`${fechaInput.value}T23:59:59.999`);
    this._fechaConsultada = fechaInput.value;

    document.getElementById('historico-stock-header').textContent =
      `Stock al ${finDelDia.toLocaleDateString('es-CO')}`;

    this._rows = await DB.getStockAsOf(finDelDia.toISOString());
    this._render(this._rows);
  },

  _exportExcel() {
    const rows = this._rows || [];
    if (rows.length === 0) {
      alert('No hay datos de inventario para exportar.');
      return;
    }
    const data = rows.map((r) => ({
      'Categoría': r.categoria,
      'Talla': r.talla,
      [`Stock al ${this._fechaConsultada}`]: r.stock_actual,
      'Total categoría': r.stock_total_categoria,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Inventario histórico');
    XLSX.writeFile(workbook, `inventario-kardex-al-${this._fechaConsultada}.xlsx`);
  },

  _render(rows) {
    const tbody = document.getElementById('historico-tbody');
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">Sin datos de inventario.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td data-label="Categoría">${r.categoria}</td>
        <td data-label="Talla">${r.talla}</td>
        <td data-label="Stock">${r.stock_actual}</td>
        <td data-label="Total categoría">${r.stock_total_categoria}</td>
      </tr>
    `).join('');
  },
});
