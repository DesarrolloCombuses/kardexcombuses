Router.register('entrada', {
  title: 'Registrar entrada',
  async onEnter() {
    this._categories = await DB.getCategories();

    const categoriaSel = document.getElementById('entrada-categoria');
    categoriaSel.innerHTML = this._categories
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('');
    categoriaSel.onchange = () => this._fillTallas();
    this._fillTallas();

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
