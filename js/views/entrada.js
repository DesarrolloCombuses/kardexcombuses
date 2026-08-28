Router.register('entrada', {
  title: 'Registrar entrada',
  async onEnter() {
    const [categories, facturas] = await Promise.all([DB.getCategories(), DB.getFacturas()]);
    this._categories = categories;

    const facturaSel = document.getElementById('entrada-factura');
    facturaSel.innerHTML = '<option value="">Sin factura asociada</option>' + facturas
      .map((f) => `<option value="${f.id}">${f.numero_factura} — ${new Date(`${f.fecha_remision}T00:00:00`).toLocaleDateString('es-CO')}</option>`)
      .join('');

    const lineasContainer = document.getElementById('entrada-lineas');
    lineasContainer.innerHTML = '';
    this._lineCount = 0;
    this._addLinea();

    const form = document.getElementById('entrada-form');
    if (!form.dataset.bound) {
      document.getElementById('entrada-add-linea').addEventListener('click', () => this._addLinea());
      form.addEventListener('submit', (e) => this._submit(e));
      form.dataset.bound = '1';
    }
  },

  // Igual patrón que Salida (ver js/views/salida.js _addLinea): una fila por
  // prenda/talla, para poder registrar en un solo movimiento varias líneas
  // que vienen de la misma factura, en vez de tener que repetir el envío
  // (y volver a elegir la factura) por cada talla.
  _addLinea() {
    const id = `linea-${this._lineCount++}`;
    const wrap = document.createElement('div');
    wrap.className = 'linea-row-wrap';
    wrap.dataset.linea = id;
    wrap.innerHTML = `
      <div class="linea-row">
        <select class="linea-categoria">
          ${this._categories.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <select class="linea-talla"></select>
        <input type="number" class="linea-cantidad" min="1" value="1" required />
        <button type="button" class="linea-remove">Quitar</button>
      </div>
    `;
    document.getElementById('entrada-lineas').appendChild(wrap);

    const categoriaSel = wrap.querySelector('.linea-categoria');
    const tallaSel = wrap.querySelector('.linea-talla');

    const fillTallas = () => {
      const categoria = this._categories.find((c) => c.id === categoriaSel.value);
      tallaSel.innerHTML = (categoria ? categoria.item_variants : [])
        .map((v) => `<option value="${v.id}">${v.talla} (stock actual: ${v.stock_actual})</option>`)
        .join('');
    };
    categoriaSel.addEventListener('change', fillTallas);
    fillTallas();

    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  },

  _collectLineas() {
    return Array.from(document.querySelectorAll('#entrada-lineas .linea-row')).map((row) => ({
      item_variant_id: row.querySelector('.linea-talla').value,
      cantidad: parseInt(row.querySelector('.linea-cantidad').value, 10),
    }));
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('entrada-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const facturaId = document.getElementById('entrada-factura').value || null;
    const observaciones = document.getElementById('entrada-observaciones').value.trim() || null;
    const lineas = this._collectLineas();

    if (lineas.length === 0 || lineas.some((l) => !l.item_variant_id || !l.cantidad || l.cantidad <= 0)) {
      msg.textContent = 'Agrega al menos una prenda con talla y cantidad válidas.';
      msg.className = 'form-msg error';
      return;
    }

    try {
      const session = await Auth.getSession();
      await DB.createMovement({
        header: {
          tipo: 'entrada',
          factura_id: facturaId,
          observaciones,
          created_by: session.user.id,
        },
        lines: lineas,
      });
      msg.textContent = 'Entrada registrada correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('entrada-form').reset();
      await this.onEnter();
    } catch (err) {
      msg.textContent = 'No se pudo registrar la entrada: ' + err.message;
      msg.className = 'form-msg error';
    }
  },
});
