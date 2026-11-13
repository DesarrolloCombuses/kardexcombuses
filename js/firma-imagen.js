// Deja una firma escaneada o fotografiada lista para estamparla en un
// documento: sin fondo y sin márgenes.
//
// Por qué hace falta procesarla y no subirla tal cual
// ---------------------------------------------------
// Una firma escaneada es un rectángulo BLANCO con un trazo encima. Pegada
// así sobre el certificado laboral, ese rectángulo tapa lo que tenga debajo
// y se le nota el recuadro al imprimir. Además el escáner deja márgenes, así
// que la firma sale diminuta dentro de un marco vacío.
//
// Los dos umbrales no son números al azar; salen de medir una firma real
// (papel en 255, trazo más oscuro en 99, percentil 1 en 159):
//   - UMBRAL: por encima de esto es papel y se vuelve transparente. Más
//     arriba de 240 se queda el gris del escaneo; más abajo de 200 empieza a
//     comerse los trazos finos.
//   - PISO: por debajo de esto es trazo de verdad y va OPACO. Sin este piso,
//     una firma de tinta azul clara queda semitransparente y se imprime
//     pálida, que es lo que no puede pasar en un documento legal.
// Entre los dos se hace una rampa, que es el antialias del escáner y es lo
// que evita que el trazo quede dentado.
const FirmaImagen = {
  UMBRAL: 225,
  PISO: 160,
  // Una firma no necesita más que esto para imprimirse bien, y evita subir
  // al bucket la foto de 12 megapíxeles que salga del celular.
  ANCHO_MAX: 1200,

  _leerComoImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen. ¿Es un archivo de imagen válido?'));
      };
      img.src = url;
    });
  },

  // Devuelve { blob, ancho, alto, dataUrl } con la firma ya limpia.
  async limpiar(file, opciones = {}) {
    const umbral = opciones.umbral ?? this.UMBRAL;
    const piso = opciones.piso ?? this.PISO;

    if (!file) throw new Error('No se eligió ningún archivo.');
    if (file.type && !file.type.startsWith('image/')) {
      throw new Error('El archivo no es una imagen.');
    }

    const img = await this._leerComoImagen(file);
    let { naturalWidth: ancho, naturalHeight: alto } = img;
    if (!ancho || !alto) throw new Error('La imagen está vacía.');

    const escala = ancho > this.ANCHO_MAX ? this.ANCHO_MAX / ancho : 1;
    ancho = Math.round(ancho * escala);
    alto = Math.round(alto * escala);

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    ctx.drawImage(img, 0, 0, ancho, alto);

    const datos = ctx.getImageData(0, 0, ancho, alto);
    const p = datos.data;

    let minX = ancho, minY = alto, maxX = -1, maxY = -1;
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = (y * ancho + x) * 4;
        const claridad = (p[i] + p[i + 1] + p[i + 2]) / 3;
        if (claridad >= umbral) {
          p[i + 3] = 0;
        } else {
          p[i + 3] = claridad <= piso
            ? 255
            : Math.round(255 * (umbral - claridad) / (umbral - piso));
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) {
      throw new Error('La imagen no tiene ningún trazo visible: salió toda en blanco. '
        + 'Revisa que sea la foto de la firma y que no esté muy clara.');
    }

    ctx.putImageData(datos, 0, 0);

    // Un respiro para que el trazo no quede pegado al borde.
    const margen = 4;
    const x0 = Math.max(0, minX - margen);
    const y0 = Math.max(0, minY - margen);
    const anchoRec = Math.min(ancho, maxX + 1 + margen) - x0;
    const altoRec = Math.min(alto, maxY + 1 + margen) - y0;

    const recorte = document.createElement('canvas');
    recorte.width = anchoRec;
    recorte.height = altoRec;
    recorte.getContext('2d').drawImage(lienzo, x0, y0, anchoRec, altoRec, 0, 0, anchoRec, altoRec);

    const blob = await new Promise((resolve) => recorte.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No se pudo preparar la imagen de la firma.');

    return { blob, ancho: anchoRec, alto: altoRec, dataUrl: recorte.toDataURL('image/png') };
  },
};

window.FirmaImagen = FirmaImagen;
