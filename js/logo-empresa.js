// El logo de la empresa: se sube una vez y lo usan todas las pantallas y
// todos los documentos.
//
// Antes estaba DIBUJADO en el código -- tres arcos de SVG repetidos en
// index.html, app.html, el certificado laboral y el informe técnico
// disciplinario. No era el logo real, y cambiarlo obligaba a tocar cuatro
// archivos y publicar una versión nueva de la aplicación.
//
// Ahora vive en el bucket público "marca", en una ruta fija (ver
// sql/logo_empresa_2026-11-13.sql). Público y fijo van juntos por una razón
// concreta: la pantalla de login todavía no tiene sesión, así que no puede
// pedir un enlace firmado ni leer una tabla de configuración. Así cualquier
// pantalla arma la URL sola, sin preguntarle nada a la base.
//
// El SVG de siempre se queda como respaldo: mientras nadie haya subido un
// logo, los documentos salen como salían. Que no haya logo nunca puede
// romper un certificado laboral.
const LogoEmpresa = {
  BUCKET: 'marca',
  RUTA: 'logo-empresa.png',

  // 700 px de lado: el logo se imprime a ~40 px de alto en el membrete, así
  // que esto da margen de sobra para que no se vea pixelado en un PDF a 2x,
  // sin cargar un archivo de varios megas en cada documento.
  LADO_MAX: 700,

  // Se mueve al guardar, para que el logo nuevo se vea en el acto en vez de
  // esperar a que caduque la caché del navegador.
  _sello: '',

  url(conSello = true) {
    const base = `${window.APP_CONFIG.SUPABASE_URL}/storage/v1/object/public/${this.BUCKET}/${this.RUTA}`;
    return conSello && this._sello ? `${base}?v=${this._sello}` : base;
  },

  // El de siempre, dibujado a mano. Se usa mientras no hayan subido nada.
  svg(lado = null) {
    const medida = lado ? ` width="${lado}" height="${lado}"` : '';
    return `<svg${medida} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8.5" stroke="#1c4fa0" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(-15 12 12)"/>
            <circle cx="12" cy="12" r="8.5" stroke="#2fa84f" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(105 12 12)"/>
            <circle cx="12" cy="12" r="8.5" stroke="#f2941d" stroke-width="4.6" stroke-linecap="round" stroke-dasharray="15 39" transform="rotate(225 12 12)"/>
          </svg>`;
  },

  // ---- Documentos -----------------------------------------------------------

  // Devuelve el logo incrustado como data URI, o null si todavía no hay
  // ninguno subido. NO lanza: un certificado laboral no se puede quedar sin
  // emitir porque el logo no cargó. Si falla, sale el SVG de respaldo.
  //
  // Incrustado y no enlazado por lo mismo que las firmas: html2canvas deja
  // en blanco las imágenes de otro dominio, así que un logo enlazado
  // desaparecería justo en el PDF (ver js/documento-imprimible.js).
  async dataUri(maxLado = 420) {
    try {
      return await imagenComoDataUri(this.url(), maxLado, 1, 'image/png');
    } catch {
      return null;
    }
  },

  // El contenido de la celda de membrete, igual para el certificado laboral
  // y para el informe disciplinario. Con logo propio no se repite la palabra
  // COMBUSES: el logo real ya la trae.
  marcaHtml(dataUri) {
    return dataUri
      ? `<img src="${dataUri}" alt="COMBUSES" class="logo-img" />`
      : `${this.svg(30)}\n          COMBUSES`;
  },

  // Solo un admin puede cambiar el logo (así está la política del bucket en
  // sql/logo_empresa_2026-11-13.sql). Se comprueba también acá para no
  // ofrecerle a nadie un botón que la base le va a rechazar: un "pulsa aquí"
  // que termina en "no tienes permiso" es peor que no mostrarlo.
  puedeCambiar() {
    return window.APP_ROLE === 'admin';
  },

  // Envuelve el membrete para que se pueda pulsar en la vista previa. En el
  // documento impreso no queda rastro -- el aviso y el recuadro punteado
  // solo existen en el modo vista previa (ver js/documento-imprimible.js).
  espacioLogo(dentro, hayLogo) {
    if (!this.puedeCambiar()) return dentro;
    const sugerencia = hayLogo ? 'Pulsa para cambiar el logo' : '+ Pulsa aquí para poner el logo';
    return `<span data-logo="1" title="${sugerencia}">`
      + `<span class="firma-sugerencia">${sugerencia}</span>${dentro}</span>`;
  },

  // ---- Pantallas ------------------------------------------------------------

  // Cambia el SVG de respaldo por el logo de verdad en el encabezado de la
  // aplicación y en el login. Solo lo reemplaza si la imagen CARGA: si no
  // hay logo subido, o el bucket no responde, se queda el SVG. Por eso se
  // espera al onload en vez de meter el <img> de una.
  pintarShell() {
    const marcas = document.querySelectorAll('.brand-mark');
    if (!marcas.length) return;
    const prueba = new Image();
    prueba.onload = () => {
      marcas.forEach((marca) => {
        // La clase hace que el distintivo deje de ser un cuadro de 34px y se
        // ensanche a lo que pida el logo. Hace falta porque el logo de una
        // empresa casi nunca es un icono cuadrado: es la marca con el nombre
        // al lado, y metida en un cuadro saldria de 34x11 px, ilegible.
        marca.classList.add('brand-mark--logo');
        marca.innerHTML = `<img src="${this.url()}" alt="" />`;
      });
    };
    prueba.src = this.url();
  },

  // ---- Preparar el archivo que suben ---------------------------------------

  // Lee la imagen con un <img> y no con createImageBitmap a propósito: así
  // también sirve un .svg, que es el formato en el que suelen tener el logo
  // bueno las empresas.
  _leer(file) {
    return new Promise((resolver, rechazar) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const reloj = setTimeout(() => {
        URL.revokeObjectURL(url);
        rechazar(new Error('La imagen tardó demasiado en abrirse. Prueba con un PNG o un JPG.'));
      }, 10000);
      img.onload = () => { clearTimeout(reloj); URL.revokeObjectURL(url); resolver(img); };
      img.onerror = () => {
        clearTimeout(reloj);
        URL.revokeObjectURL(url);
        rechazar(new Error('Ese archivo no se pudo abrir como imagen. Usa PNG, JPG, WEBP o SVG.'));
      };
      img.src = url;
    });
  },

  // Quita el fondo SOLO desde los bordes hacia adentro, en vez de borrar
  // todo lo que sea blanco.
  //
  // La diferencia importa: un logo con letras blancas sobre un círculo de
  // color, o con un hueco blanco en medio, se quedaría agujereado si se
  // borrara "todo lo blanco". Lo que es fondo es lo blanco que se puede
  // alcanzar caminando desde el borde de la imagen; lo blanco de adentro
  // está rodeado de color y no se toca.
  _quitarFondo(datos, ancho, alto) {
    const px = datos.data;
    const TOPE = 236;     // por encima de esto ya es papel
    const TOPE_DURO = 250;
    const GRIS = 16;      // diferencia máxima entre canales: el fondo no tiene color

    const CASI_NADA = 20;   // por debajo de este alfa ya no se ve nada

    const esFondo = (i) => {
      // Lo que ya viene transparente ES fondo, y se reconoce por el alfa y
      // NO por el color: un píxel transparente se lee como rgb(0,0,0), así
      // que juzgarlo por su color lo daría por tinta negra.
      if (px[i + 3] <= CASI_NADA) return true;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const min = Math.min(r, g, b);
      const max = Math.max(r, g, b);
      return min >= TOPE && (max - min) <= GRIS;
    };

    const visto = new Uint8Array(ancho * alto);
    const cola = new Int32Array(ancho * alto);
    let fin = 0;
    const encolar = (x, y) => {
      const n = y * ancho + x;
      if (visto[n]) return;
      if (!esFondo(n * 4)) return;
      visto[n] = 1;
      cola[fin++] = n;
    };
    for (let x = 0; x < ancho; x++) { encolar(x, 0); encolar(x, alto - 1); }
    for (let y = 0; y < alto; y++) { encolar(0, y); encolar(ancho - 1, y); }

    for (let cab = 0; cab < fin; cab++) {
      const n = cola[cab];
      const x = n % ancho;
      const y = (n / ancho) | 0;
      if (x > 0) encolar(x - 1, y);
      if (x < ancho - 1) encolar(x + 1, y);
      if (y > 0) encolar(x, y - 1);
      if (y < alto - 1) encolar(x, y + 1);
    }

    // Rampa en el borde del trazo: de golpe quedaría dentado.
    for (let n = 0; n < ancho * alto; n++) {
      if (!visto[n]) continue;
      const i = n * 4;
      // Lo que ya era transparente se deja como está. Pasarlo por la rampa
      // lo volvía NEGRO OPACO: un píxel transparente se lee como rgb(0,0,0),
      // así que la fórmula lo tomaba por tinta del trazo y le subía el alfa
      // a tope. Un logo PNG o SVG que ya venía con el fondo quitado -- lo
      // normal en el archivo bueno de una empresa -- salía como un recuadro
      // negro sobre el membrete. Es el mismo tropiezo que tuvieron las
      // firmas (ver js/firma-imagen.js).
      if (px[i + 3] <= CASI_NADA) {
        px[i + 3] = 0;
        continue;
      }
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      px[i + 3] = min >= TOPE_DURO
        ? 0
        : Math.round(255 * (TOPE_DURO - min) / (TOPE_DURO - TOPE));
    }
    return datos;
  },

  // Recorta el margen transparente. Un logo con medio centímetro de aire
  // alrededor se ve diminuto dentro de la celda del membrete, porque la
  // celda limita el aire y no el dibujo.
  _caja(datos, ancho, alto) {
    const px = datos.data;
    let minx = ancho, miny = alto, maxx = -1, maxy = -1;
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        if (px[(y * ancho + x) * 4 + 3] > 12) {
          if (x < minx) minx = x;
          if (y < miny) miny = y;
          if (x > maxx) maxx = x;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return null;
    return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
  },

  // Devuelve { blob, dataUrl, ancho, alto } listo para guardar y para
  // mostrar. Siempre PNG: un JPEG no guarda transparencia, y el logo
  // quedaría con un recuadro blanco encima del documento.
  async preparar(file, quitarFondo = true) {
    const img = await this._leer(file);
    const anchoNat = img.naturalWidth || img.width;
    const altoNat = img.naturalHeight || img.height;
    if (!anchoNat || !altoNat) throw new Error('Esa imagen no tiene tamaño. Si es un SVG, ábrelo y guárdalo como PNG.');

    const escala = Math.min(1, this.LADO_MAX / Math.max(anchoNat, altoNat));
    const ancho = Math.max(1, Math.round(anchoNat * escala));
    const alto = Math.max(1, Math.round(altoNat * escala));

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    // Sin relleno blanco, al revés que en las firmas: acá la transparencia
    // que ya traiga el archivo es justo lo que hay que conservar.
    ctx.drawImage(img, 0, 0, ancho, alto);

    let datos = ctx.getImageData(0, 0, ancho, alto);
    if (quitarFondo) datos = this._quitarFondo(datos, ancho, alto);
    ctx.putImageData(datos, 0, 0);

    const caja = this._caja(datos, ancho, alto);
    if (!caja) {
      throw new Error('La imagen queda vacía al quitarle el fondo. Desmarca "quitar el fondo" o usa un archivo con más contraste.');
    }

    const recorte = document.createElement('canvas');
    recorte.width = caja.w;
    recorte.height = caja.h;
    recorte.getContext('2d').drawImage(lienzo, caja.x, caja.y, caja.w, caja.h, 0, 0, caja.w, caja.h);

    const blob = await new Promise((r) => recorte.toBlob(r, 'image/png'));
    if (!blob) throw new Error('No se pudo convertir la imagen a PNG.');
    return { blob, dataUrl: recorte.toDataURL('image/png'), ancho: caja.w, alto: caja.h };
  },

  // upsert: la ruta es fija, así que guardar un logo nuevo pisa el anterior.
  // Es a propósito -- hay un solo logo de empresa, no una galería.
  async guardar(blob) {
    const { error } = await window.supabaseClient.storage
      .from(this.BUCKET)
      .upload(this.RUTA, blob, {
        contentType: 'image/png',
        upsert: true,
        cacheControl: '300',
      });
    if (error) {
      if (/row-level security|not authorized|violates/i.test(error.message || '')) {
        throw new Error('Tu cuenta no puede cambiar el logo de la empresa. Solo un admin puede hacerlo.');
      }
      throw error;
    }
    this._sello = String(Date.now());
    this.pintarShell();
  },

  // ---- Diálogo --------------------------------------------------------------

  // Un solo diálogo para los dos sitios desde donde se entra: Usuarios y el
  // membrete de la vista previa de un documento.
  async abrirDialogo({ alVolver = null, alCerrar = null, textoCancelar = 'Cancelar' } = {}) {
    document.getElementById('modal-box').classList.add('modal-wide');
    document.getElementById('modal-backdrop').classList.remove('hidden');

    document.getElementById('modal-body').innerHTML = `
      <div class="detalle-header">
        <div class="detalle-header-info">
          <div class="detalle-nombre">Logo de la empresa</div>
          <div class="detalle-sub">Se usa en el encabezado de la aplicación, en la pantalla de entrada y en el membrete de los documentos que emite Gestión Humana: certificado laboral e informe técnico disciplinario.</div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Logo actual</h3>
        <div class="logo-tablero">
          <div class="logo-muestra clara"><img src="${this.url()}" alt="Logo actual"
            onerror="this.closest('.logo-tablero').outerHTML='&lt;p class=&quot;empty-note&quot;&gt;Todavía no hay logo subido: por ahora se dibuja uno provisional.&lt;/p&gt;'" /></div>
          <div class="logo-muestra oscura"><img src="${this.url()}" alt="" onerror="this.style.display='none'" /></div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title">Subir el logo</h3>
        <p class="view-intro" style="margin:0 0 0.6rem">
          Lo mejor es un PNG con fondo transparente o un SVG. Si solo tienes una foto o un JPG,
          deja marcada la casilla de abajo y se le quita el fondo blanco.
        </p>
        <input type="file" id="logo-archivo" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
        <label class="logo-check">
          <input type="checkbox" id="logo-quitar-fondo" checked />
          Quitarle el fondo blanco
        </label>
        <p class="empty-note" style="margin:0.35rem 0 0">
          Solo se borra el blanco que rodea al logo por fuera, no el que tenga adentro:
          un logo con letras blancas sobre un círculo de color no se agujerea.
        </p>
        <div id="logo-preview-wrap" class="hidden" style="margin-top:0.8rem">
          <p class="empty-note" style="margin:0 0 0.4rem">Así va a quedar. El cuadro oscuro es para ver si el fondo quedó transparente de verdad.</p>
          <div class="logo-tablero">
            <div class="logo-muestra clara"><img id="logo-preview-claro" alt="Logo preparado" /></div>
            <div class="logo-muestra oscura"><img id="logo-preview-oscuro" alt="" /></div>
          </div>
          <div class="logo-membrete">
            <div class="logo-membrete-celda"><img id="logo-preview-doc" alt="" /></div>
            <div class="logo-membrete-titulo">CERTIFICACIÓN LABORAL</div>
            <div class="logo-membrete-meta"><b>Código:</b> DO-GH-02<br><b>Versión:</b> 001</div>
          </div>
          <p class="empty-note" style="margin:0.4rem 0 0">Arriba, al tamaño exacto con que sale impreso en el membrete.</p>
        </div>
      </div>
      <div class="modal-section">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" id="logo-guardar-btn">Guardar logo</button>
          <button type="button" id="logo-cancelar-btn" class="btn-secondary">${textoCancelar}</button>
        </div>
        <p id="logo-msg" class="form-msg"></p>
      </div>
    `;

    let preparado = null;
    const archivo = document.getElementById('logo-archivo');
    const casilla = document.getElementById('logo-quitar-fondo');
    const msg = () => document.getElementById('logo-msg');

    const procesar = async () => {
      const wrap = document.getElementById('logo-preview-wrap');
      const file = archivo.files && archivo.files[0];
      preparado = null;
      wrap.classList.add('hidden');
      if (!file) return;
      msg().textContent = 'Preparando la imagen…';
      msg().className = 'form-msg';
      try {
        preparado = await this.preparar(file, casilla.checked);
        ['logo-preview-claro', 'logo-preview-oscuro', 'logo-preview-doc']
          .forEach((id) => { document.getElementById(id).src = preparado.dataUrl; });
        wrap.classList.remove('hidden');
        msg().textContent = `Listo: ${preparado.ancho}×${preparado.alto} píxeles.`;
        msg().className = 'form-msg success';
      } catch (err) {
        msg().textContent = err.message;
        msg().className = 'form-msg error';
      }
    };

    archivo.addEventListener('change', procesar);
    // Volver a procesar al cambiar la casilla, sobre el archivo que ya
    // eligieron: si no, habría que buscar el archivo otra vez solo para ver
    // cómo queda sin quitarle el fondo.
    casilla.addEventListener('change', procesar);

    document.getElementById('logo-cancelar-btn').addEventListener('click',
      () => (alVolver ? alVolver() : (alCerrar ? alCerrar() : this._cerrar())));

    document.getElementById('logo-guardar-btn').addEventListener('click', async () => {
      if (!preparado) {
        msg().textContent = 'Primero elige el archivo del logo.';
        msg().className = 'form-msg error';
        return;
      }
      Loading.show('Guardando el logo…');
      try {
        await this.guardar(preparado.blob);
        if (alVolver) { await alVolver(); return; }
        if (alCerrar) { alCerrar(); return; }
        this._cerrar();
      } catch (err) {
        msg().textContent = 'No se pudo guardar el logo: ' + err.message;
        msg().className = 'form-msg error';
      } finally {
        Loading.hide();
      }
    });
  },

  _cerrar() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal-box').classList.remove('modal-wide');
    document.getElementById('modal-body').innerHTML = '';
  },
};

window.LogoEmpresa = LogoEmpresa;
