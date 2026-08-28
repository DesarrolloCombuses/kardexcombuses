Router.register('entrada', {
  title: 'Registrar entrada',
  async onEnter() {
    const [categories, facturas] = await Promise.all([DB.getCategories(), DB.getFacturas()]);
    this._categories = categories;

    const categoriaSel = document.getElementById('entrada-categoria');
    categoriaSel.innerHTML = this._categories
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('');
    categoriaSel.onchange = () => this._fillTallas();
    this._fillTallas();

    const facturaSel = document.getElementById('entrada-factura');
    facturaSel.innerHTML = '<option value="">Sin factura asociada</option>' + facturas
      .map((f) => `<option value="${f.id}">${f.numero_factura} — ${new Date(`${f.fecha_remision}T00:00:00`).toLocaleDateString('es-CO')}</option>`)
      .join('');

    const form = document.getElementById('entrada-form');
    if (!form.dataset.bound) {
      form.addEventListener('submit', (e) => this._submit(e));
      form.dataset.bound = '1';
    }
  },

  _fillTallas() {
    const categoriaId = document.getElementById('entrada-categoria').value;
    const categoria = this._categories.find((c) => c.id === categoriaId);
    const tallaSel = document.getElementById('entrada-talla');
    tallaSel.innerHTML = (categoria ? categoria.item_variants : [])
      .map((v) => `<option value="${v.id}">${v.talla} (stock actual: ${v.stock_actual})</option>`)
      .join('');
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('entrada-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const itemVariantId = document.getElementById('entrada-talla').value;
    const cantidad = parseInt(document.getElementById('entrada-cantidad').value, 10);
    const facturaId = document.getElementById('entrada-factura').value || null;
    const observaciones = document.getElementById('entrada-observaciones').value.trim() || null;

    if (!itemVariantId || !cantidad || cantidad <= 0) {
      msg.textContent = 'Selecciona una talla y una cantidad válida.';
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
        lines: [{ item_variant_id: itemVariantId, cantidad }],
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
