Router.register('salida', {
  title: 'Entrega (Salida)',
  async onEnter() {
    this._categories = await DB.getCategories();
    this._employees = await DB.getEmployees({ onlyActive: true });

    const empleadoSel = document.getElementById('salida-empleado');
    empleadoSel.innerHTML = this._employees
      .map((e) => `<option value="${e.id}">${e.nombre} — ${e.cedula}</option>`)
      .join('');
    this._updateEmpleadoInfo();

    const lineasContainer = document.getElementById('salida-lineas');
    lineasContainer.innerHTML = '';
    this._lineCount = 0;
    this._addLinea();

    if (!this._bound) {
      document.getElementById('salida-add-linea').addEventListener('click', () => this._addLinea());
      document.getElementById('salida-form').addEventListener('submit', (e) => this._submit(e));
      document.getElementById('salida-empleado').addEventListener('change', () => this._updateEmpleadoInfo());

      this._signatureReceptor = new SignaturePad(document.getElementById('firma-receptor'));
      this._signatureEntrega = new SignaturePad(document.getElementById('firma-entrega'));
      this._camera = new CameraCapture({
        inputEl: document.getElementById('foto-receptor-input'),
        previewEl: document.getElementById('foto-receptor-preview'),
      });

      document.querySelectorAll('[data-clear-signature]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.clearSignature === 'firma-receptor'
            ? this._signatureReceptor
            : this._signatureEntrega;
          target.clear();
        });
      });

      this._bound = true;
    } else {
      this._signatureReceptor.clear();
      this._signatureEntrega.clear();
      this._camera.reset();
    }

    try {
      const profile = await DB.getMyProfile();
      const nombre = profile && (profile.full_name || profile.username);
      if (nombre) {
        document.getElementById('salida-entregado-por').value = nombre;
      }
    } catch { /* opcional, no bloquea el flujo */ }
  },

  _updateEmpleadoInfo() {
    const info = document.getElementById('salida-empleado-info');
    const empleadoId = document.getElementById('salida-empleado').value;
    const empleado = this._employees.find((e) => e.id === empleadoId);

    if (!empleado || !empleado.numero_interno) {
      info.classList.add('hidden');
      info.textContent = '';
      return;
    }

    const partes = [`Vehículo interno: <strong>${empleado.numero_interno}</strong>`];
    if (empleado.ruta) partes.push(`Ruta: <strong>${empleado.ruta}</strong>`);
    info.innerHTML = partes.join(' · ');
    info.classList.remove('hidden');
  },

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
      <p class="linea-warning hidden"></p>
    `;
    document.getElementById('salida-lineas').appendChild(wrap);

    const categoriaSel = wrap.querySelector('.linea-categoria');
    const tallaSel = wrap.querySelector('.linea-talla');
    const cantidadInput = wrap.querySelector('.linea-cantidad');
    const warning = wrap.querySelector('.linea-warning');

    const validar = () => {
      const selected = tallaSel.selectedOptions[0];
      const stock = selected ? parseInt(selected.dataset.stock, 10) : 0;
      const cantidad = parseInt(cantidadInput.value, 10) || 0;
      if (cantidad > stock) {
        warning.textContent = `Solo hay ${stock} unidad(es) disponibles de esta talla — no se podrá registrar así.`;
        warning.classList.remove('hidden');
        cantidadInput.classList.add('input-error');
      } else {
        warning.classList.add('hidden');
        cantidadInput.classList.remove('input-error');
      }
    };

    const fillTallas = () => {
      const categoria = this._categories.find((c) => c.id === categoriaSel.value);
      tallaSel.innerHTML = (categoria ? categoria.item_variants : [])
        .map((v) => `<option value="${v.id}" data-stock="${v.stock_actual}">${v.talla} (stock: ${v.stock_actual})</option>`)
        .join('');
      validar();
    };
    categoriaSel.addEventListener('change', fillTallas);
    tallaSel.addEventListener('change', validar);
    cantidadInput.addEventListener('input', validar);
    fillTallas();

    wrap.querySelector('.linea-remove').addEventListener('click', () => wrap.remove());
  },

  _collectLineas() {
    return Array.from(document.querySelectorAll('#salida-lineas .linea-row')).map((row) => {
      const tallaSel = row.querySelector('.linea-talla');
      const selectedOption = tallaSel.selectedOptions[0];
      return {
        item_variant_id: tallaSel.value,
        cantidad: parseInt(row.querySelector('.linea-cantidad').value, 10),
        stockDisponible: selectedOption ? parseInt(selectedOption.dataset.stock, 10) : 0,
      };
    });
  },

  async _submit(e) {
    e.preventDefault();
    const msg = document.getElementById('salida-msg');
    msg.textContent = '';
    msg.className = 'form-msg';

    const showError = (text) => {
      msg.textContent = text;
      msg.className = 'form-msg error';
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const employeeId = document.getElementById('salida-empleado').value;
    const entregadoPor = document.getElementById('salida-entregado-por').value.trim();
    const observaciones = document.getElementById('salida-observaciones').value.trim() || null;
    const lineas = this._collectLineas();

    if (!employeeId) {
      showError('Selecciona el empleado que recibe.');
      return;
    }
    if (lineas.length === 0 || lineas.some((l) => !l.item_variant_id || !l.cantidad || l.cantidad <= 0)) {
      showError('Agrega al menos una prenda con cantidad válida.');
      return;
    }
    const sinStock = lineas.find((l) => l.cantidad > l.stockDisponible);
    if (sinStock) {
      showError(`Stock insuficiente para una de las prendas seleccionadas (disponible: ${sinStock.stockDisponible}). Corrige la cantidad marcada en rojo arriba.`);
      document.querySelector('.linea-row input.input-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (this._signatureReceptor.isEmpty()) {
      showError('Falta la firma de quien recibe.');
      return;
    }
    if (this._signatureEntrega.isEmpty()) {
      showError('Falta la firma de quien entrega.');
      return;
    }
    if (!this._camera.hasPhoto()) {
      showError('Falta la foto de quien recibe.');
      return;
    }
    if (!entregadoPor) {
      showError('Indica el nombre de quien entrega.');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';

    try {
      const session = await Auth.getSession();

      const [firmaReceptorBlob, firmaEntregaBlob] = await Promise.all([
        this._signatureReceptor.toBlob(),
        this._signatureEntrega.toBlob(),
      ]);

      const [firmaReceptorPath, firmaEntregaPath, fotoPath] = await Promise.all([
        DB.uploadToBucket('firmas', firmaReceptorBlob, 'png'),
        DB.uploadToBucket('firmas', firmaEntregaBlob, 'png'),
        DB.uploadToBucket('fotos-entrega', this._camera.getFile(), (this._camera.getFile().name.split('.').pop() || 'jpg')),
      ]);

      await DB.createMovement({
        header: {
          tipo: 'salida',
          employee_id: employeeId,
          entregado_por_nombre: entregadoPor,
          firma_receptor_url: firmaReceptorPath,
          firma_entrega_url: firmaEntregaPath,
          foto_receptor_url: fotoPath,
          observaciones,
          created_by: session.user.id,
        },
        lines: lineas.map((l) => ({ item_variant_id: l.item_variant_id, cantidad: l.cantidad })),
      });

      msg.textContent = 'Entrega registrada correctamente.';
      msg.className = 'form-msg success';
      document.getElementById('salida-observaciones').value = '';
      await this.onEnter();
    } catch (err) {
      msg.textContent = 'No se pudo registrar la entrega: ' + err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
    }
  },
});
