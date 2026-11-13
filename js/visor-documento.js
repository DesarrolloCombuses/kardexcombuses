// Vista previa de un documento oficial ANTES de emitirlo.
//
// Por qué existe
// --------------
// Hasta ahora el certificado laboral se abría directo en una ventana nueva,
// ya listo para imprimir. El problema no era la ventana: era que la primera
// vez que alguien veía el documento, el documento ya estaba emitido. Si le
// faltaba la firma de quien certifica, o un dato venía mal, se descubría con
// la hoja impresa en la mano o con el PDF ya enviado -- y un certificado
// laboral es un documento legal, no se corrige después de entregado.
//
// Este visor mete un paso en medio: muestra el documento EXACTO dentro de la
// app, con los avisos de lo que le falta arriba del todo, y solo desde ahí se
// pasa a imprimir o a corregir.
//
// Por qué un <iframe> y no pegar el HTML en el modal
// --------------------------------------------------
// El documento trae sus propios estilos (tamaño carta, tipografía, tablas con
// bordes) y la app trae los suyos. Pegados en la misma página se pisan: el
// documento se vería distinto aquí que al imprimirlo, que es exactamente lo
// que un visor no puede hacer. Dentro del iframe el documento está aislado y
// se ve tal cual sale. Y se arma con el MISMO paginaImprimible() que la
// ventana de impresión, solo que sin su barra de botones, para que no haya
// dos versiones del documento que puedan separarse con el tiempo.
const VisorDocumento = {
  // 8.5 pulgadas a 96 dpi: el ancho real con el que se imprime. La hoja se
  // dibuja siempre a este ancho y se reduce con un scale para que quepa en
  // la pantalla, en vez de dejar que el navegador recalcule el texto a otro
  // ancho -- así lo que se ve es la misma distribución de la hoja impresa,
  // no una versión "adaptada" que después no coincide.
  ANCHO_HOJA: 816,

  // avisos: [{ texto, etiqueta?, accion? }] -- lo que le falta al documento.
  // alCorregir / alCerrar: funciones opcionales; si no vienen, no se pinta
  // ese botón.
  // alFirmar: se llama con el valor de data-firmar del espacio de firma que
  // se pulse dentro del documento. Es lo que permite poner la firma donde
  // va, en vez de tener que salir a buscar la ficha de esa persona.
  // alLogo: lo mismo para el membrete, marcado con data-logo.
  mostrar({ titulo, subtitulo, estilos, cuerpoHtml, archivo, avisos = [], alCorregir = null, alCerrar = null, alFirmar = null, alLogo = null }) {
    const caja = document.getElementById('modal-box');
    if (caja) caja.classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    const avisosHtml = avisos.length ? `
      <div class="visor-avisos">
        ${avisos.map((a, i) => `
          <div class="visor-aviso">
            <span>${a.texto}</span>
            ${a.accion ? `<button type="button" class="btn-secondary visor-aviso-btn" data-aviso="${i}">${a.etiqueta || 'Arreglar'}</button>` : ''}
          </div>`).join('')}
      </div>` : '';

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">${titulo}</div>
          ${subtitulo ? `<div class="detalle-sub">${subtitulo}</div>` : ''}
        </div>
      </div>
      ${avisosHtml}
      <div class="visor-acciones">
        <button type="button" id="visor-emitir">Imprimir o descargar PDF</button>
        ${alCorregir ? '<button type="button" id="visor-corregir" class="btn-secondary">Corregir datos</button>' : ''}
        ${alCerrar ? '<button type="button" id="visor-cerrar" class="btn-secondary">Cerrar</button>' : ''}
        <span class="visor-estado" id="visor-estado">Así va a quedar impreso.</span>
      </div>
      <div class="visor-lienzo" id="visor-lienzo">
        <iframe id="visor-iframe" title="Vista previa del documento"></iframe>
      </div>
    `;

    const lienzo = document.getElementById('visor-lienzo');
    const marco = document.getElementById('visor-iframe');

    // El alto del documento no se sabe hasta que el navegador lo dibuja: un
    // certificado cabe en una hoja, un informe disciplinario con anexos
    // puede ocupar cuatro. Se mide al cargar y se vuelve a medir si cambia
    // el ancho de la ventana.
    const ajustar = () => {
      const doc = marco.contentDocument;
      if (!doc || !doc.body) return;
      const alto = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1056);
      const k = Math.min(1, (lienzo.clientWidth || this.ANCHO_HOJA) / this.ANCHO_HOJA);
      marco.style.width = this.ANCHO_HOJA + 'px';
      marco.style.height = alto + 'px';
      marco.style.transform = `scale(${k})`;
      lienzo.style.height = Math.round(alto * k) + 'px';
    };

    // El documento va dentro de un iframe, así que el clic ocurre en OTRO
    // documento: hay que escucharlo allá dentro. srcdoc hereda el origen de
    // la app, por eso se puede. Se engancha al cargar, junto con la medida.
    const alCargar = () => {
      ajustar();
      const doc = marco.contentDocument;
      if (!doc || (!alFirmar && !alLogo)) return;
      doc.addEventListener('click', (e) => {
        const cerca = (sel) => (e.target.closest ? e.target.closest(sel) : null);
        // El logo primero: esta en el membrete y nunca se solapa con una
        // firma, pero si algun dia uno quedara dentro del otro, mandaria el
        // mas especifico y no el orden en que se escribieron los ifs.
        const logo = alLogo ? cerca('[data-logo]') : null;
        if (logo) {
          e.preventDefault();
          soltar();
          alLogo();
          return;
        }
        const zona = alFirmar ? cerca('[data-firmar]') : null;
        if (!zona) return;
        e.preventDefault();
        soltar();
        alFirmar(zona.getAttribute('data-firmar'));
      });
    };

    // El listener va ANTES de asignar el srcdoc: si el documento es corto,
    // el load puede llegar antes de que termine esta función.
    marco.addEventListener('load', alCargar);

    // srcdoc por propiedad y no como atributo del innerHTML: el documento
    // lleva comillas dobles por todas partes (atributos, estilos, data URIs
    // de las firmas) y meterlo dentro de un atributo obliga a escaparlo
    // entero, con una sola comilla mal escapada bastando para partir la
    // página en dos.
    marco.srcdoc = paginaImprimible({ titulo, estilos, cuerpoHtml, archivo, acciones: false });

    const alRedimensionar = () => ajustar();
    window.addEventListener('resize', alRedimensionar);

    const emitir = () => {
      const estado = document.getElementById('visor-estado');
      // window.open tiene que salir del clic mismo, sin ningún await en
      // medio, o el navegador lo toma por una ventana que se abrió sola y
      // la bloquea. Por eso el documento ya viene armado desde antes.
      const ventana = window.open('', '_blank');
      if (!ventana) {
        if (estado) {
          estado.textContent = 'El navegador bloqueó la ventana. Habilita las ventanas emergentes para este sitio.';
          estado.className = 'visor-estado error';
        }
        return;
      }
      ventana.document.open();
      ventana.document.write(paginaImprimible({ titulo, estilos, cuerpoHtml, archivo }));
      ventana.document.close();
      if (estado) estado.textContent = 'Se abrió en una ventana nueva para imprimir o descargar.';
    };

    document.getElementById('visor-emitir').addEventListener('click', emitir);

    const soltar = () => window.removeEventListener('resize', alRedimensionar);
    const corregirBtn = document.getElementById('visor-corregir');
    if (corregirBtn) corregirBtn.addEventListener('click', () => { soltar(); alCorregir(); });
    const cerrarBtn = document.getElementById('visor-cerrar');
    if (cerrarBtn) cerrarBtn.addEventListener('click', () => { soltar(); alCerrar(); });

    document.querySelectorAll('.visor-aviso-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const aviso = avisos[Number(b.dataset.aviso)];
        if (aviso?.accion) { soltar(); aviso.accion(); }
      });
    });
  },
};

window.VisorDocumento = VisorDocumento;
