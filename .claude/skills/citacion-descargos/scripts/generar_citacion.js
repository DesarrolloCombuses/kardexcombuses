// Genera el cuerpo de una citación a descargos (.docx) a partir de un JSON.
// Uso: node generar_citacion.js datos.json cuerpo.docx
// Luego: python3 merge_membrete.py cuerpo.docx ../assets/Hoja_Membrete.docx salida.docx
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');

const [, , jsonPath, outPath] = process.argv;
const D = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const base = path.dirname(path.resolve(jsonPath));

const F = 'Arial', S = 22;
const run = (t, o = {}) => new TextRun({ text: t, font: F, size: S, bold: o.bold, highlight: o.hl ? 'yellow' : undefined });
const p = (parts, o = {}) => new Paragraph({
  alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { after: o.after ?? 160, before: o.before ?? 0, line: 264 },
  indent: o.indent ? { left: o.indent } : undefined,
  keepNext: o.keepNext,
  pageBreakBefore: o.pageBreakBefore,
  children: (Array.isArray(parts) ? parts : [parts]).map(t => typeof t === 'string' ? run(t, { bold: o.bold }) : t),
});
const L = AlignmentType.LEFT;
const item = (n, t) => p([run(n + ' ', { bold: true }), run(t)], { indent: 360, after: 80 });
const head = (t) => p(t, { bold: true, before: 200, after: 100, keepNext: true });

const T = D.trabajador;
const body = [
  p(`Medellín, ${D.fecha_citacion}`, { after: 240 }),
  p([run(`${T.tratamiento || 'Señor(a)'} `), run(T.nombre.toUpperCase(), { bold: true })], { after: 60, align: L }),
  p(`C.C. ${T.cedula}`, { after: 60, align: L }),
  p(`Cargo: ${T.cargo}`, { after: 60, align: L }),
  p(`Ciudad: ${T.ciudad || 'Medellín'}`, { after: 240, align: L }),
  p('ASUNTO: CITACIÓN A DILIGENCIA DE DESCARGOS', { bold: true, after: 240 }),
  p([run('Con el fin de dar cumplimiento al artículo 115 del Código Sustantivo del Trabajo y al artículo 106 del Reglamento Interno de Trabajo de COMBUSES S.A., se le informa la apertura de proceso disciplinario y se le cita a diligencia de descargos para el día '),
     run(`${D.fecha_descargos} a las ${D.hora_descargos}`, { bold: true }),
     run(` en ${D.lugar || 'las instalaciones de COMBUSES S.A., ante la Coordinación de Gestión Humana'}, con el fin de que rinda su versión sobre los hechos que fueron puestos en conocimiento de la empresa el pasado ${D.fecha_conocimiento}, ${D.origen_informe}, de la siguiente manera:`)]),
  ...D.hechos.map((h, i) => p([run(`${i + 1}. ${h.titulo}. `, { bold: true }), run(h.texto)])),
  p('Estas conductas presuntamente transgreden el Reglamento Interno de Trabajo, el contrato de trabajo, el manual de funciones y el Código Sustantivo del Trabajo, en los siguientes artículos:', { before: 120 }),
  head('CONTRATO DE TRABAJO Y MANUAL DE FUNCIONES'),
  ...(D.contrato && D.contrato.length
    ? D.contrato.map(t => p(t))
    : [p([run('[Gestión Humana: insertar aquí la cláusula de objeto y las obligaciones del contrato de trabajo, y las funciones del cargo según el manual de funciones / perfil del cargo.]', { hl: true })])]),
];

for (const bloque of D.normas) {
  body.push(head(bloque.titulo));
  for (const sec of bloque.secciones) {
    if (sec.capitulo) body.push(p(sec.capitulo, { bold: true, after: 60, keepNext: true }));
    if (sec.encabezado) body.push(p(sec.encabezado, { bold: true, after: 80, keepNext: true }));
    for (const it of sec.items || []) body.push(item(it.num, it.texto));
  }
  if (bloque.nota) body.push(p(bloque.nota, { before: 120 }));
}

body.push(head('PRUEBAS'));
body.push(p('La empresa cuenta con las siguientes pruebas, que se le ponen de presente para que ejerza su derecho a la defensa' + (D.evidencias?.length ? ' (se adjuntan como anexo):' : ':')));
D.pruebas.forEach((t, i) => body.push(item(String.fromCharCode(97 + i) + ')', t)));
body.push(p('De conformidad con el artículo 106 del Reglamento Interno de Trabajo, usted cuenta con cinco (5) días hábiles, contados a partir del recibo de la presente citación, para controvertir las pruebas o allegar las que considere pertinentes y conducentes para esclarecer los hechos, las cuales serán practicadas en la diligencia de descargos.', { before: 160 }));
body.push(p('Recuerde que puede presentarse a la diligencia con dos personas, quienes actuarán como testigos de los descargos, los cuales tienen el fin único de observar el cumplimiento de las garantías constitucionales y legales en el proceso disciplinario que actualmente se tramita. Los mismos no tendrán ni voz ni voto en la diligencia, salvo que vayan a rendir testimonio como pruebas para su defensa.'));
body.push(p('La no comparecencia a los descargos constituye la renuncia a rendir las declaraciones sobre lo sucedido por parte del trabajador, entendiéndose así la renuncia a su derecho a la defensa.', { keepNext: true }));
body.push(p('', { after: 200, keepNext: true }));

const nb = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noB = { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb };
const cB = { top: nb, bottom: nb, left: nb, right: nb };
const cell = (lines, w) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: cB,
  children: lines.map(l => p(l, { align: L, after: 40 })) });
const Fm = D.firmante;
body.push(new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513], borders: noB, rows: [
  new TableRow({ cantSplit: true, children: [
    cell(['Atentamente,', '', '', '', '______________________________', `NOMBRE: ${Fm.nombre.toUpperCase()}`, `C.C. ${Fm.cedula}`], 4513),
    cell(['Recibí:', '', '', '', '______________________________', `NOMBRE: ${T.nombre.toUpperCase()}`, `C.C. ${T.cedula}`, 'Fecha de recibido: ____________'], 4513),
  ] })] }));

if (D.evidencias?.length) {
  body.push(p('ANEXO – EVIDENCIAS DEL INFORME DISCIPLINARIO', { bold: true, align: AlignmentType.CENTER, after: 200, pageBreakBefore: true }));
  const W = 3008, MAXW = 140, MAXH = 303;
  const imgCell = (e) => {
    if (!e) return new TableCell({ width: { size: W, type: WidthType.DXA }, borders: cB, children: [p('')] });
    const file = path.resolve(base, e.archivo);
    const data = fs.readFileSync(file);
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
    let w = e.ancho_px, h = e.alto_px;
    if (!(w && h) && ext === 'png') { w = data.readUInt32BE(16); h = data.readUInt32BE(20); }
    if (!(w && h)) { w = 738; h = 1600; } // captura de celular típica
    const k = Math.min(MAXW / w, MAXH / h);
    return new TableCell({ width: { size: W, type: WidthType.DXA }, borders: cB, children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: ext, data, transformation: { width: Math.round(w * k), height: Math.round(h * k) } })] }),
      p(e.leyenda, { align: AlignmentType.CENTER, after: 200 }),
    ] });
  };
  const rows = [];
  for (let i = 0; i < D.evidencias.length; i += 3)
    rows.push(new TableRow({ cantSplit: true, children: [0, 1, 2].map(j => imgCell(D.evidencias[i + j])) }));
  body.push(new Table({ width: { size: 9024, type: WidthType.DXA }, columnWidths: [W, W, W], borders: noB, rows }));
}

const doc = new Document({
  styles: { default: { document: { run: { font: F, size: S } } } },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children: body }],
});
Packer.toBuffer(doc).then(b => fs.writeFileSync(outPath, b));
