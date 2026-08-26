Router.register('estadisticas', {
  title: 'Estadísticas de Inventario',

  _palette: ['#2f6fed', '#20b2aa', '#a970ff', '#ff9f43', '#26c6da', '#ef5da8', '#5ec26a', '#7b8cff'],

  async onEnter() {
    await this._reload();
    this._channel = DB.subscribeToChanges('estadisticas-live', ['item_variants'], () => this._reloadDebounced());
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
    const rows = await DB.getStockActual();
    this._render(rows);
  },

  _render(rows) {
    const categorias = [];
    const seen = new Set();
    for (const r of rows) {
      if (!seen.has(r.item_category_id)) {
        seen.add(r.item_category_id);
        categorias.push({ id: r.item_category_id, nombre: r.categoria, total: r.stock_total_categoria });
      }
    }
    categorias.sort((a, b) => b.total - a.total);

    const totalUnidades = categorias.reduce((sum, c) => sum + c.total, 0);
    const bajoStock = rows.filter((r) => r.stock_actual <= 5);

    this._animateNumber('stat-total-unidades', totalUnidades);
    this._animateNumber('stat-categorias', categorias.length);
    this._animateNumber('stat-tallas', rows.length);
    this._animateNumber('stat-bajo-stock', bajoStock.length);
    this._animateNumber('stat-donut-total', totalUnidades);

    this._renderBars(categorias);
    this._renderDonut(categorias, totalUnidades);
    this._renderLowStock(bajoStock);
  },

  _renderBars(categorias) {
    const el = document.getElementById('stat-bars');
    if (categorias.length === 0) {
      el.innerHTML = '<p class="empty-note">Sin datos de inventario todavía.</p>';
      return;
    }
    const max = categorias[0].total || 1;
    el.innerHTML = categorias.map((c) => `
      <div class="bar-row">
        <span class="bar-label" title="${c.nombre}">${c.nombre}</span>
        <span class="bar-track"><span class="bar-fill" data-pct="${(c.total / max) * 100}"></span></span>
        <span class="bar-value">${c.total}</span>
      </div>
    `).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.bar-fill').forEach((bar) => {
        bar.style.width = bar.dataset.pct + '%';
      });
    });
  },

  _renderDonut(categorias, total) {
    const donut = document.getElementById('stat-donut');
    const legend = document.getElementById('stat-legend');
    if (total === 0) {
      donut.style.background = 'var(--slate-200)';
      legend.innerHTML = '<li class="empty-note">Sin datos.</li>';
      return;
    }

    let acc = 0;
    const stops = [];
    const legendItems = [];
    categorias.forEach((c, i) => {
      const color = this._palette[i % this._palette.length];
      const pct = (c.total / total) * 100;
      const from = acc;
      const to = acc + pct;
      stops.push(`${color} ${from}% ${to}%`);
      legendItems.push(`
        <li>
          <span class="dot" style="background:${color}"></span>
          <span class="legend-label">${c.nombre}</span>
          <span class="legend-value">${pct.toFixed(1)}%</span>
        </li>
      `);
      acc = to;
    });

    donut.style.background = `conic-gradient(${stops.join(', ')})`;
    legend.innerHTML = legendItems.join('');
  },

  _renderLowStock(items) {
    const el = document.getElementById('stat-low-stock');
    if (items.length === 0) {
      el.innerHTML = '<p class="empty-note">Ninguna prenda con stock bajo (5 unidades o menos). Todo en orden.</p>';
      return;
    }
    const sorted = [...items].sort((a, b) => a.stock_actual - b.stock_actual);
    el.innerHTML = sorted.map((r) => {
      const nivel = r.stock_actual <= 2 ? 'critico' : 'alerta';
      const pct = Math.min(100, (r.stock_actual / 5) * 100);
      return `
        <div class="low-stock-row">
          <span class="lsr-name">${r.categoria}<small>Talla ${r.talla}</small></span>
          <span class="low-stock-track"><span class="low-stock-fill ${nivel}" data-pct="${pct}"></span></span>
          <span class="lsr-value ${nivel}">${r.stock_actual} und.</span>
        </div>
      `;
    }).join('');
    requestAnimationFrame(() => {
      el.querySelectorAll('.low-stock-fill').forEach((bar) => {
        bar.style.width = bar.dataset.pct + '%';
      });
    });
  },

  _animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
    if (start === target) {
      el.textContent = target;
      return;
    }
    const duration = 600;
    const startTime = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  },
});
