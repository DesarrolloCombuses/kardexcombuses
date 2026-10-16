// Envoltura común para los documentos imprimibles que se abren en una
// ventana nueva: agrega el fondo gris + "hoja" centrada tamaño carta, para
// que en pantalla se vea como una página real y no como texto corrido de
// borde a borde del navegador -- y un botón "Descargar PDF" que genera el
// archivo de verdad con html2pdf.js (cargado desde CDN dentro de esta
// misma ventana nueva, no en app.html), en vez de depender de que la
// persona sepa usar "Imprimir > Guardar como PDF". Se deja también
// "Imprimir" como respaldo, por si html2pdf falla (ej. una firma cuya
// imagen no se pudo leer por CORS) -- el print nativo no depende de eso.
//
// Vive fuera de las vistas porque la usan dos módulos: el certificado
// laboral de Empleados y el informe técnico disciplinario (FO-GH-06). Era un
// método privado de la vista Empleados; se movió sin tocarle una sola línea
// del cuerpo (la sangría de 2 espacios que le quedó es la que traía como
// método -- el HTML generado sale idéntico byte a byte).
// Baja una imagen y la devuelve como data URI reducido, para incrustarla en
// un documento imprimible en vez de enlazarla. Tres razones, todas vividas:
//
// 1) Los buckets del ERP son privados y sus enlaces firmados EXPIRAN. Un
//    documento que guarde la URL se queda sin fotos a las pocas horas --
//    justo cuando alguien lo reabre para imprimirlo.
// 2) html2pdf dibuja la hoja con html2canvas, que al tropezar con una imagen
//    de otro dominio deja el recuadro en blanco: el PDF sale con el texto y
//    sin la evidencia, que es media razon de ser del documento.
// 3) Una foto de celular pesa varios megas. Varias sin reducir hacen un PDF
//    que no se puede enviar por correo y que tarda en generarse.
//
// Lanza si la imagen no se pudo leer; quien llama decide que hacer con esa
// foto (listarla como anexo, saltarla) sin perder el documento entero.
//
// Lleva limite de tiempo porque createImageBitmap, ante un archivo que no
// puede decodificar, se queda esperando: ni resuelve ni falla. Sin este
// corte una sola foto dañada dejaba el documento "generandose" para
// siempre, con el overlay tapando la pantalla -- comprobado en Chrome.
//
// 8 segundos: una foto de celular se lee en menos de uno hasta en un
// equipo lento, y el limite se paga por cada foto que falle, no una sola
// vez -- con diez adjuntos dañados, quince segundos cada uno serian dos
// minutos y medio de espera. Se lee de window para poder bajarlo en las
// pruebas sin esperar el limite real.
const IMAGEN_LIMITE_MS = 8000;
function limiteImagenMs() {
  return Number(window.IMAGEN_LIMITE_MS) || IMAGEN_LIMITE_MS;
}

function conLimite(promesa, ms, queEs) {
  let reloj;
  return Promise.race([
    promesa.finally(() => clearTimeout(reloj)),
    new Promise((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error('La imagen tardó demasiado (' + queEs + ')')), ms);
    }),
  ]);
}

async function imagenComoDataUri(url, maxLado = 1100, calidad = 0.82) {
  const respuesta = await conLimite(fetch(url), limiteImagenMs(), 'descarga');
  if (!respuesta.ok) throw new Error('No se pudo descargar la imagen (' + respuesta.status + ')');
  const bitmap = await conLimite(createImageBitmap(await respuesta.blob()), limiteImagenMs(), 'lectura');
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close?.();
  return lienzo.toDataURL('image/jpeg', calidad);
}

function paginaImprimible({ titulo, estilos, cuerpoHtml, archivo }) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${titulo}</title>
<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body { background: #dde3ec; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 26px 16px; }
  .print-actions { max-width: 8.5in; margin: 0 auto 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .print-actions button { font: inherit; padding: 9px 18px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; }
  .print-actions .btn-pdf { background: #2f6fed; color: #fff; }
  .print-actions .btn-pdf:disabled { opacity: 0.6; cursor: default; }
  .print-actions .btn-print { background: #fff; color: #2f6fed; border: 1.5px solid #2f6fed; }
  .print-actions .estado { font-size: 12.5px; color: #445; }
  .page { background: #fff; width: 8.5in; min-height: 11in; margin: 0 auto; box-shadow: 0 4px 24px rgba(15,23,42,.16); }
  ${estilos}
  @page { size: letter; margin: 0; }
  @media print {
    html, body { background: #fff; }
    .print-actions { display: none; }
    body { padding: 0; }
    .page { box-shadow: none; margin: 0; width: auto; min-height: auto; }
  }
</style>
</head>
<body>
  <div class="print-actions">
    <button type="button" class="btn-pdf" id="btn-descargar-pdf">Descargar PDF</button>
    <button type="button" class="btn-print" onclick="window.print()">Imprimir</button>
    <span class="estado" id="pdf-estado"></span>
  </div>
  <div class="page">${cuerpoHtml}</div>
  <script>
    document.getElementById('btn-descargar-pdf').addEventListener('click', function () {
      var boton = document.getElementById('btn-descargar-pdf');
      var estado = document.getElementById('pdf-estado');
      boton.disabled = true;
      estado.textContent = 'Generando PDF…';
      html2pdf()
        .set({
          filename: ${JSON.stringify(archivo)},
          margin: 0,
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        })
        .from(document.querySelector('.page'))
        .save()
        .then(function () { estado.textContent = 'PDF descargado.'; })
        .catch(function () { estado.textContent = 'No se pudo generar el PDF -- prueba con "Imprimir" y elige "Guardar como PDF".'; })
        .finally(function () { boton.disabled = false; });
    });
  </script>
</body>
</html>`;
}
