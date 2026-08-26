Router.register('nueva-prenda', {
  title: 'Agregar prenda',

  async onEnter() {
    this._categorias = await DB.getCategories();
    document.getElementById('nueva-prenda-categorias-list').innerHTML = this._categorias
      .map((c) => `<option value="${c.nombre}"></option>`)
      .join('');

    document.getElementById('nueva-prenda-tallas').innerHTML = '';
    this._addTalla();
    this._updateCatalogoInfo();

    if (!this._bound) {
      document.getElementById('nueva-prenda-categoria').addEventListener('input', () => this._updateCatalogoInfo());
      document.getElementById('nueva-prenda-add-talla').addEventListener('click', () => this._addTalla());
      document.getElementById('nueva-prenda-form').addEventListener('submit', (e) => this._submit(e));
      this._bound = true;
    }
  },

  _findCategoria(nombre) {
    const q = nombre.trim().toLowerCase();
    if (!q) return null;
    return this._categorias.find((c) => c.nombre.toLowerCase() === q) || null;
  },

  // Muestra si el nombre escrito ya existe en el catálogo (con sus tallas
  // actuales) o si es una prenda nueva, para que la persona no cree por
  // error una categoría duplicada con otro nombre parecido.
  _updateCatalogoInfo() {
    const nombre = document.getElementById('nueva-prenda-categoria').value;
    const box = document.getElementById('nueva-prenda-catalogo-info');
    const categoria = this._findCategoria(nombre);

    if (!nombre.trim()) {
      box.className = 'catalogo-info hidden';
      box.innerHTML = '';
    } else if (categoria) {
      const chips = categoria.item_variants.length > 0
        ? `<div class="catalogo-chips">${categoria.item_variants
            .map((v) => `<span class="catalogo-chip">${v.talla}: ${v.stock_actual}</span>`)
            .join('')}</div>`
        : '<span>Todavía no tiene tallas registradas.</span>';
      box.className = 'catalogo-info existe';
      box.innerHTML = `<strong>Ya tienes esta prenda en el catálogo.</strong> Estas son sus tallas actuales:${chips}`;
    } else {
      box.className = 'catalogo-info nueva';
      box.innerHTML = '<strong>Esta prenda no existe todavía.</strong> Si guardas, se creará como una prenda nueva en el catálogo.';
    }

    this._revalidarTallas();
  },

  _addTalla() {
    const tallasContainer = document.getElementById('nueva-prenda-tallas');
    const row = document.createElement('div');
    row.className = 'linea-row-wrap';
    row.innerHTML = `
      <div class="linea-row">
        <div class="linea-field">
          <span class="linea-field-label">Talla</span>
          <input type="text" class="nueva-talla-nombre" style="text-transform:uppercase" placeholder="Ej: M, 38" required />
        </div>
        <div class="linea-field linea-field-qty">
          <span class="linea-field-label">Cantidad inicial</span>
          <input type="number" class="nueva-talla-cantidad" min="0" value="0" />
        </div>
        <button type="button" class="linea-remove">Quitar</button>
      </div>
      <p class="linea-warning hidden"></p>
    `;
    tallasContainer.appendChild(row);
    row.querySelector('.nueva-talla-nombre').addEventListener('input', () => this._validarTallaRow(row));
    row.querySelector('.linea-remove').addEventListener('click', () => row.remove());
  },

  // Si la talla escrita ya existe para la prenda seleccionada, avisa de
  // inmediato en vez de dejar que la persona la mande y se entere después.
  _validarTallaRow(row) {
    const nombreInput = row.querySelector('.nueva-talla-nombre');
    const warning = row.querySelector('.linea-warning');
    const talla = nombreInput.value.trim().toUpperCase();
    const categoria = this._findCategoria(document.getElementById('nueva-prenda-categoria').value);
    const variante = talla && categoria
      ? categoria.item_variants.find((v) => v.talla.toUpperCase() === talla)
      : null;

    if (variante) {
      warning.textContent = `Ya existe la talla "${variante.talla}" en "${categoria.nombre}" (stock actual: ${variante.stock_actual}). Quítala de la lista — para sumarle stock usa "Entrada".`;
      warning.classList.remove('hidden');
      nombreInput.classList.add('input-error');
    } else {
      warning.classList.add('hidden');
      nombreInput.classList.remove('input-error');
    }
  },

  _revalidarTallas() {
    document.querySelectorAll('#nueva-prenda-tallas .linea-row-wrap').forEach((row) => this._validarTallaRow(row));
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('nueva-prenda-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const categoriaNombre = document.getElementById('nueva-prenda-categoria').value.trim();
    const filas = Array.from(document.querySelectorAll('#nueva-prenda-tallas .linea-row')).map((row) => ({
      talla: row.querySelector('.nueva-talla-nombre').value.trim(),
      cantidad: parseInt(row.querySelector('.nueva-talla-cantidad').value, 10) || 0,
    }));

    if (!categoriaNombre) {
      msg.textContent = 'Escribe el nombre de la prenda.';
      msg.className = 'form-msg error';
      return;
    }
    const tallasValidas = filas.filter((f) => f.talla);
    if (tallasValidas.length === 0) {
      msg.textContent = 'Agrega al menos una talla.';
      msg.className = 'form-msg error';
      return;
    }
    const nombresRepetidos = tallasValidas.map((f) => f.talla.toLowerCase());
    if (new Set(nombresRepetidos).size !== nombresRepetidos.length) {
      msg.textContent = 'Hay tallas repetidas en la lista.';
      msg.className = 'form-msg error';
      return;
    }

    const categoriaExistente = this._findCategoria(categoriaNombre);
    if (categoriaExistente) {
      const yaExisten = tallasValidas.filter((f) =>
        categoriaExistente.item_variants.some((v) => v.talla.toUpperCase() === f.talla.toUpperCase())
      );
      if (yaExisten.length > 0) {
        msg.textContent = `Ya existe(n) la(s) talla(s) ${yaExisten.map((f) => f.talla).join(', ')} en "${categoriaExistente.nombre}". Quítala(s) de la lista o corrige el nombre — para sumar stock usa "Entrada".`;
        msg.className = 'form-msg error';
        return;
      }
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';

    try {
      const session = await Auth.getSession();
      const resultado = await DB.createPrendaConTallas({
        categoriaNombre,
        tallas: tallasValidas,
        createdBy: session.user.id,
      });

      let resumen = `Se agregaron ${resultado.creadas.length} talla(s) nueva(s) a "${resultado.category.nombre}".`;
      if (resultado.omitidas.length > 0) {
        resumen += ` ${resultado.omitidas.length} ya existía(n) y se omitió(eron).`;
      }
      msg.textContent = resumen;
      msg.className = 'form-msg success';

      document.getElementById('nueva-prenda-form').reset();
      await this.onEnter();
    } catch (err) {
      msg.textContent = 'No se pudo guardar: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  },
});
