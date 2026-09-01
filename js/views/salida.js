Router.register('salida', {
  title: 'Entrega (Salida)',
  async onEnter() {
    this._categories = await DB.getCategories();
    this._employees = await DB.getEmployees({ onlyActive: true });

    document.getElementById('salida-empleado').value = '';
    document.getElementById('salida-empleado-search').value = '';
    this._updateEmpleadoInfo();

    const hoy = new Date().toISOString().slice(0, 10);
    const fechaEntregaInput = document.getElementById('salida-fecha-entrega');
    fechaEntregaInput.max = hoy;
    fechaEntregaInput.value = hoy;

    const lineasContainer = document.getElementById('salida-lineas');
    lineasContainer.innerHTML = '';
    this._lineCount = 0;
    this._addLinea();

    if (!this._bound) {
      document.getElementById('salida-add-linea').addEventListener('click', () => this._addLinea());
      document.getElementById('salida-form').addEventListener('submit', (e) => this._submit(e));
      this._setupEmpleadoCombobox();
      this._bindWizardNav();

      this._signatureReceptor = new SignaturePad(document.getElementById('firma-receptor'));
      this._camera = new CameraCapture({
        inputEl: document.getElementById('foto-receptor-input'),
        previewEl: document.getElementById('foto-receptor-preview'),
      });

      document.querySelector('[data-clear-signature="firma-receptor"]').addEventListener('click', () => {
        this._signatureReceptor.clear();
      });

      this._bound = true;
    } else {
      this._signatureReceptor.clear();
      this._camera.reset();
    }

    // Quien entrega es quien tiene la sesión iniciada -- no hace falta que
    // lo escriba ni lo firme, ya queda registrado por created_by. Aquí solo
    // se muestra su nombre como confirmación en el paso final.
    let nombreEntrega = 'tu usuario';
    try {
      nombreEntrega = await DB.getMyDisplayName();
    } catch { /* se deja el valor por defecto */ }
    this._entregadoPorNombre = nombreEntrega;
    document.getElementById('salida-entregado-por-info').innerHTML =
      `Vas a registrar esta entrega como: <strong>${nombreEntrega}</strong>`;

    this._goToStep(1);
  },

  // Buscador de empleado: con 200+ empleados activos, un <select> plano
  // era impracticable (había que desplazarse a mano). Esto filtra por
  // nombre o cédula a medida que se escribe; el <input type="hidden">
  // #salida-empleado sigue siendo la fuente de verdad para el resto del
  // wizard (validación, envío), igual que antes con el <select>.
  _setupEmpleadoCombobox() {
    const search = document.getElementById('salida-empleado-search');
    const hidden = document.getElementById('salida-empleado');
    const list = document.getElementById('salida-empleado-list');
    const MAX_RESULTADOS = 40;

    const renderLista = (query) => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? this._employees.filter((e) => e.nombre.toLowerCase().includes(q) || e.cedula.includes(q))
        : this._employees;

      if (matches.length === 0) {
        list.innerHTML = '<li class="combobox-empty">Sin resultados.</li>';
      } else {
        const visibles = matches.slice(0, MAX_RESULTADOS);
        list.innerHTML = visibles.map((e) => `
          <li data-id="${e.id}">${e.nombre} <span class="combobox-cedula">· CC ${e.cedula}</span></li>
        `).join('');
        if (matches.length > visibles.length) {
          list.innerHTML += `<li class="combobox-empty">Y ${matches.length - visibles.length} más… sigue escribiendo para acotar.</li>`;
        }
      }
      list.classList.remove('hidden');
    };

    const seleccionar = (empleado) => {
      hidden.value = empleado.id;
      search.value = `${empleado.nombre} — CC ${empleado.cedula}`;
      list.classList.add('hidden');
      this._updateEmpleadoInfo();
    };

    search.addEventListener('focus', () => {
      search.select();
      renderLista('');
    });
    search.addEventListener('input', () => {
      hidden.value = '';
      this._updateEmpleadoInfo();
      renderLista(search.value);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const primero = list.querySelector('li[data-id]');
      if (primero) primero.click();
    });
    search.addEventListener('blur', () => {
      // El click en un <li> dispara blur antes que click; sin este pequeño
      // margen, la lista se esconde antes de que el click llegue a alcanzarlo.
      setTimeout(() => list.classList.add('hidden'), 150);
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const empleado = this._employees.find((emp) => emp.id === li.dataset.id);
      if (empleado) seleccionar(empleado);
    });
  },

  // ---- Asistente paso a paso: un fieldset visible a la vez, y no se
  // puede avanzar al siguiente sin pasar la validación del actual. Volver
  // hacia atrás siempre es libre; los pasos ya completados quedan
  // marcados y se puede saltar directo a ellos desde la barra de arriba.
  _bindWizardNav() {
    document.querySelectorAll('.wizard-next').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('.wizard-panel');
        const step = parseInt(panel.dataset.step, 10);
        const error = this._validateStep(step);
        const stepMsg = panel.querySelector('.wizard-msg');
        if (error) {
          stepMsg.textContent = error;
          stepMsg.classList.remove('hidden');
          return;
        }
        stepMsg.classList.add('hidden');
        this._goToStep(step + 1);
      });
    });

    document.querySelectorAll('.wizard-back').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.closest('.wizard-panel').dataset.step, 10);
        this._goToStep(step - 1);
      });
    });

    document.getElementById('salida-progress').addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li || !li.classList.contains('done')) return;
      this._goToStep(parseInt(li.dataset.step, 10));
    });
  },

  _validateStep(step) {
    if (step === 1) {
      if (!document.getElementById('salida-empleado').value) {
        return 'Selecciona el empleado que recibe.';
      }
      if (!document.getElementById('salida-fecha-entrega').value) {
        return 'Selecciona la fecha de la entrega.';
      }
    }
    if (step === 2) {
      const lineas = this._collectLineas();
      if (lineas.length === 0 || lineas.some((l) => !l.item_variant_id || !l.cantidad || l.cantidad <= 0)) {
        return 'Agrega al menos una prenda con cantidad válida.';
      }
      const sinStock = lineas.find((l) => l.cantidad > l.stockDisponible);
      if (sinStock) {
        return `Stock insuficiente para una de las prendas seleccionadas (disponible: ${sinStock.stockDisponible}). Corrige la cantidad marcada en rojo.`;
      }
    }
    if (step === 3 && this._signatureReceptor.isEmpty()) {
      return 'Falta la firma de quien recibe.';
    }
    if (step === 4) {
      if (this._camera.processing) return 'Espera un momento, la foto se está procesando…';
      if (!this._camera.hasPhoto()) return 'Falta la foto de quien recibe.';
    }
    return null;
  },

  _goToStep(n) {
    this._step = n;
    document.querySelectorAll('.wizard-panel').forEach((panel) => {
      panel.hidden = parseInt(panel.dataset.step, 10) !== n;
    });
    document.querySelectorAll('#salida-progress li').forEach((li) => {
      const s = parseInt(li.dataset.step, 10);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', s < n);
    });
    // Mientras un paso está oculto, su <canvas> de firma mide 0x0 (el
    // navegador no le da tamaño a algo que no se está mostrando), así que
    // no se podía dibujar nada encima. Por eso hay que recalcularlo justo
    // al entrar al paso donde vive la firma, no antes.
    if (n === 3) this._signatureReceptor.resize();
    document.getElementById('salida-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (empleado.base) partes.push(`Base: <strong>${empleado.base}</strong>`);
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
    const fechaEntrega = document.getElementById('salida-fecha-entrega').value;
    const observaciones = document.getElementById('salida-observaciones').value.trim() || null;
    const lineas = this._collectLineas();

    if (!employeeId) {
      showError('Selecciona el empleado que recibe.');
      return;
    }
    if (!fechaEntrega) {
      showError('Selecciona la fecha de la entrega.');
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
    if (!this._camera.hasPhoto()) {
      showError('Falta la foto de quien recibe.');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = 'Guardando…';
    Loading.show('Subiendo firma y foto…');

    try {
      const session = await Auth.getSession();

      const firmaReceptorBlob = await this._signatureReceptor.toBlob();
      if (!firmaReceptorBlob) {
        throw new Error('No se pudo capturar la firma (inténtalo de nuevo desde el paso 3 — Firma).');
      }

      const [firmaReceptorPath, fotoPath] = await Promise.all([
        DB.uploadToBucket('firmas', firmaReceptorBlob, 'png'),
        DB.uploadToBucket('fotos-entrega', this._camera.getFile(), (this._camera.getFile().name.split('.').pop() || 'jpg')),
      ]);

      Loading.setMessage('Registrando entrega…');
      await DB.createMovement({
        header: {
          tipo: 'salida',
          employee_id: employeeId,
          fecha_entrega: fechaEntrega,
          entregado_por_nombre: this._entregadoPorNombre,
          creado_por_nombre: this._entregadoPorNombre,
          firma_receptor_url: firmaReceptorPath,
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
