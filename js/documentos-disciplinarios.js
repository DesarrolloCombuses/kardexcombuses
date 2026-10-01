// Plantillas oficiales de los documentos del proceso disciplinario:
// citacion a descargos, acta de no comparecencia, diligencia de descargos,
// invitacion al mejoramiento, llamado de atencion, suspension y terminacion
// del contrato por justa causa.
//
// Portado TAL CUAL desde el programa "Procesos Disciplinarios"
// (DesarrolloCombuses/procesosdisciplinarios, js/documentos.js). El texto de
// estos documentos lo redacto el area juridica y ya se uso en procesos
// reales; traerlo literal es lo unico seguro. Lo que cambia en el ERP es de
// donde salen los datos (de employees y de kardex_procesos_disciplinarios, no
// de un Google Sheet publicado), no una sola palabra del documento.
//
// Expone window.PD_DOCS con construir(tipo, p, cf) / documentoHTML /
// documentoInner / PRINT_CSS. El objeto `p` usa los nombres del programa
// viejo (fechaCitacion, horaCitacion...); js/views/procesos-disciplinarios.js
// los arma desde las columnas del ERP.

(function () {
  // ---- Helpers privados (no chocan con los de app.js / firmar.html) ----
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function parseFecha(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    v = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) { const [y, mo, d] = v.slice(0, 10).split('-'); return new Date(+y, mo - 1, +d); }
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    const d = new Date(v); return isNaN(d) ? null : d;
  }
  function fechaLarga(iso) {
    if (!iso) return '____________';
    const d = parseFecha(iso); if (!d) return String(iso);
    return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  }
  function fechaConDia(iso) {
    const d = parseFecha(iso); if (!d) return '____________';
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  }

  const PRINT_CSS = `
  @page{margin:2cm 1.7cm 2.4cm 1.7cm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.34;color:#000}
  .doc-wrap{max-width:18cm;margin:0 auto;padding:0 4px}
  .doc-header{margin-bottom:10px}
  .doc-header img{height:48px;width:auto}
  .doc-footer{margin-top:24px;text-align:right;page-break-inside:avoid}
  .doc-footer img{height:58px;width:auto;max-width:100%}
  h1{text-align:center;font-size:12.5pt;text-transform:uppercase;margin:2px 0 14px;border-bottom:2px solid #000;padding-bottom:6px}
  p{margin:5px 0;text-align:justify}
  .lugar{text-align:right} .lugar2{margin-bottom:12px}
  .reporte{margin:6px 0}
  .reglamento{white-space:pre-wrap;font-size:9.5pt;line-height:1.28;margin:7px 0;text-align:justify}
  blockquote{margin:9px 22px;padding:8px 14px;border-left:3px solid #555;background:#f6f6f6;font-style:italic}
  .acta-box{border:1px solid #888;min-height:150px;padding:12px;margin:8px 0}
  .dd-enc{text-align:center;font-size:9.5pt;font-weight:bold;margin-bottom:4px}
  .dd-tit{text-align:center;font-size:12.5pt;margin:4px 0 14px;text-decoration:underline}
  .dd-datos{width:100%;border-collapse:collapse;margin:8px 0 14px}
  .dd-datos td{padding:3px 6px;font-size:10pt}
  .dd-cuest{text-align:center;margin:14px 0 8px}
  .dd-qa{white-space:pre-wrap;font-size:10pt;line-height:1.45;text-align:justify}
  .firma{margin-top:30px;page-break-inside:avoid}
  .firma .firma-linea{height:56px;width:7.5cm;border-bottom:1px solid #000;margin:6px 0 4px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .firma .firma-linea img{max-height:54px;max-width:96%}
  .firmas2{display:flex;justify-content:space-between;margin-top:40px;gap:30px;text-align:center;font-size:10pt;page-break-inside:avoid}
  .firmas2 > div{flex:1}
  .f2-linea{height:52px;width:85%;border-bottom:1px solid #000;margin:6px auto 4px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .f2-linea img{max-height:50px;max-width:96%}
  .firmas-cit{display:flex;justify-content:space-between;gap:40px;margin-top:26px;page-break-inside:avoid}
  .firmas-cit .fc-col{flex:1}
  .firmas-cit .fc-sp{height:56px;border-bottom:1px solid #000;margin:6px 0 4px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .firmas-cit .fc-sp img{max-height:54px;max-width:96%}
  h3.sec{font-size:10.5pt;font-weight:bold;text-transform:uppercase;text-align:left;margin:14px 0 4px;border-bottom:1px solid #999;padding-bottom:2px}
  .firmas-sanc{display:flex;justify-content:space-between;gap:40px;margin-top:34px;page-break-inside:avoid}
  .firmas-sanc .fs-col{flex:1;text-align:center}
  .firmas-sanc .fs-col p{text-align:center;margin:3px 0}
  .firmas-sanc .fs-sp{height:54px;border-bottom:1px solid #000;margin:6px auto 4px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .firmas-sanc .fs-sp img{max-height:52px;max-width:96%}
  `;

  // Construye el cuerpo del documento según el tipo. Devuelve { titulo, cuerpo, showTitle }.
  function construir(tipo, p, cf) {
    p = p || {}; cf = cf || {};
    const hoy = fechaLarga(new Date());
    const firmasSancion = `
    <div class="firmas-sanc">
      <div class="fs-col"><p>Atentamente,</p>
        <div class="fs-sp">${cf.firmaImg ? `<img src="${cf.firmaImg}" alt="firma">` : ''}</div>
        <p><strong>${esc(cf.nombreFirma || cf.responsable)}</strong><br>${esc(cf.cargoFirma || 'Coordinación de Procesos Disciplinarios')}<br>${esc(cf.empresa)}</p></div>
      <div class="fs-col"><p>Recibí,</p>
        <div class="fs-sp">${p.firmaDecision ? `<img src="${p.firmaDecision}" alt="firma trabajador">` : ''}</div>
        <p><strong>${esc(p.nombre)}</strong><br>C.C. ${esc(p.cc)}</p></div>
    </div>
    <div class="firmas-sanc" style="margin-top:26px">
      <div class="fs-col"><div class="fs-sp"></div><p>Testigo 1<br>C.C. ____________</p></div>
      <div class="fs-col"><div class="fs-sp"></div><p>Testigo 2<br>C.C. ____________</p></div>
    </div>`;
    let titulo = '', cuerpo = '', showTitle = true;

    if (tipo === 'citacion') {
      titulo = 'CITACIÓN A DESCARGOS';
      const pruebasTxt = (p.pruebas && p.pruebas.trim()) ? esc(p.pruebas).replace(/\n/g, '<br>') : '';
      cuerpo = `
      <p class="lugar2">${esc(cf.ciudad)}, ${hoy}</p>
      <p>Señor(a) <strong>${esc(p.nombre)}</strong><br>
         CC: ${esc(p.cc)}<br>
         ${p.celular ? `Celular: ${esc(p.celular)}<br>` : ''}${p.correoNotificacion ? `Correo: ${esc(p.correoNotificacion)}<br>` : ''}Ciudad: ${esc(cf.ciudad)}</p>
      <p><strong>ASUNTO: CITACIÓN A DESCARGOS</strong></p>
      <p>Con el fin de dar cumplimiento al artículo 115 del Código Sustantivo del Trabajo, se le cita a diligencia de descargos para el <strong>${fechaConDia(p.fechaCitacion)}</strong> a las <strong>${esc(p.horaCitacion || '____')}</strong> en las instalaciones de ${esc(cf.empresa)} con el fin de que rinda su versión sobre los hechos que tuvo conocimiento la empresa el pasado <strong>${fechaLarga(p.fechaHechos || p.fechaCitacion)}</strong> reportados por la empresa de la siguiente manera:</p>
      <p class="reporte">${esc(p.motivo || '____________').replace(/\n/g, '<br>')}</p>
      <p>Estas conductas presuntamente transgreden el Reglamento Interno de Trabajo, contrato de trabajo, manual de funciones y el Código Sustantivo del Trabajo, en los artículos:</p>
      <div class="reglamento">${esc(p.reglamento || '____________')}</div>
      <p>La empresa cuenta con las siguientes pruebas, que se le ponen de presente para que ejerza su derecho a la defensa.${pruebasTxt ? '<br>' + pruebasTxt : ''}</p>
      <p>Recuerde que puede presentarse a la diligencia con dos personas quienes actuarán como testigos de los descargos, los cuales tienen el fin único de observar el cumplimiento de las garantías constitucionales y legales en el proceso disciplinario que actualmente se tramita. Los mismos no tendrán ni voz ni voto en la diligencia, salvo que vayan a rendir testimonios como pruebas para su defensa.</p>
      <p>La no comparecencia a los descargos constituye la renuncia a rendir las declaraciones sobre lo sucedido por parte del trabajador, entendiéndose así la renuncia a su derecho a la defensa.</p>
      <div class="firmas-cit">
        <div class="fc-col"><p>Atentamente,</p>
          <div class="fc-sp">${cf.firmaImg ? `<img src="${cf.firmaImg}" alt="firma">` : ''}</div>
          <p>NOMBRE: ${esc(cf.nombreFirma || cf.responsable)}</p></div>
        <div class="fc-col"><p>Recibí:</p><div class="fc-sp">${p.firmaCitacion ? `<img src="${p.firmaCitacion}" alt="firma trabajador">` : ''}</div>
          <p>C.C: ${esc(p.cc || '____________')}<br>NOMBRE: ${esc(p.nombre || '____________')}</p></div>
      </div>`;
      showTitle = false;

    } else if (tipo === 'acta') {
      const fechaDil = p.fechaActaDescargos || p.fechaDiligenciamiento || p.fechaCitacion;
      const horaDil = p.horaActaDescargos || p.horaDiligenciamiento || p.horaCitacion || '____';
      const dirige = cf.nombreFirma || p.disciplinario || cf.responsable;
      if (norm(p.asistencia) === 'no') {
        titulo = 'ACTA DE NO COMPARECENCIA A DESCARGOS';
        const datos = `<table class="dd-datos">
        <tr><td colspan="2"><strong>Nombre:</strong> ${esc(p.nombre)}</td></tr>
        <tr><td><strong>C.C.:</strong> ${esc(p.cc)}</td><td><strong>Cargo:</strong> ${esc(p.cargo || p.area || '')}</td></tr>
        <tr><td><strong>Área:</strong> ${esc(p.area || '')}</td><td><strong>Interno:</strong> ${esc(p.interno || '')}</td></tr>
        <tr><td><strong>Propietario del vehículo:</strong> ${esc(p.propietario || '')}</td><td><strong>Ruta:</strong> ${esc(p.ruta || '')}</td></tr></table>`;
        cuerpo = `<p class="lugar2">${esc(cf.ciudad)}, ${fechaLarga(fechaDil)}</p>
        ${datos}
        <h3 class="sec">MOTIVO DE LA CITACIÓN</h3>
        <p>El trabajador fue citado a diligencia de descargos con ocasión de los siguientes hechos:</p>
        <p>${esc(p.motivo || '____________').replace(/\n/g, '<br>')}</p>
        <h3 class="sec">INASISTENCIA A LA DILIGENCIA</h3>
        <p>Se deja constancia de que el (la) trabajador(a) <strong>${esc(p.nombre)}</strong>, identificado(a) con cédula de ciudadanía N° ${esc(p.cc)}, fue citado(a) formalmente a diligencia de descargos para el día <strong>${fechaLarga(fechaDil)}</strong>${horaDil && horaDil !== '____' ? ` a las <strong>${esc(horaDil)}</strong>` : ''}, con el fin de ejercer su derecho de defensa y contradicción frente a los hechos descritos. Sin embargo, <strong>NO SE PRESENTÓ</strong> a la diligencia ni justificó su inasistencia.</p>
        <p>De conformidad con el Reglamento Interno de Trabajo y lo señalado en la citación, en el caso de que el trabajador no asista y no justifique dentro del día hábil siguiente su inasistencia, o se niegue a comparecer a la diligencia de descargos, se entenderá que renuncia al derecho que tiene de ser escuchado por la empresa, quedando esta facultada para imponer la sanción disciplinaria a que haya lugar.</p>
        ${p.reglamento && p.reglamento.trim() ? `<h3 class="sec">NORMAS PRESUNTAMENTE VULNERADAS</h3><div class="reglamento">${esc(p.reglamento)}</div>` : ''}
        <h3 class="sec">CONSTANCIA</h3>
        <p>Se deja la presente acta como evidencia de la no comparecencia del (de la) trabajador(a) a la citación a descargos, lo cual será tenido en cuenta dentro del proceso disciplinario conforme a la normatividad laboral vigente y el Reglamento Interno de Trabajo.</p>
        <div class="firmas2" style="margin-top:36px">
          <div>${cf.firmaImg ? `<div class="f2-linea"><img src="${cf.firmaImg}" alt="firma"></div>` : '<div class="f2-linea"></div>'}<strong>${esc(dirige)}</strong><br>${esc(cf.cargoFirma || 'Coordinación de Procesos Disciplinarios')}<br>${esc(cf.empresa)}</div>
          <div><div class="f2-linea"></div>Firma testigo<br>C.C. ____________</div>
        </div>`;
        showTitle = true;
      } else {
        titulo = 'Diligencia de descargos';
        const horaIni = p.horaActaDescargos || p.horaCitacion || '____';
        const horaFin = p.horaDiligenciamiento || '____';
        const interno = p.interno ? ` del interno ${esc(p.interno)}` : '';
        const ruta = p.ruta ? ` en la ruta ${esc(p.ruta)}` : '';
        cuerpo = `
        <p class="dd-enc">Procesos Administrativos<br>Recursos Humanos</p>
        <h2 class="dd-tit">Diligencia de descargos</h2>
        <table class="dd-datos"><tr><td><strong>Fecha:</strong> ${fechaLarga(fechaDil)}</td><td><strong>Hora:</strong> ${esc(horaIni)}</td></tr>
          <tr><td colspan="2"><strong>Trabajador:</strong> ${esc(p.nombre)}</td></tr>
          <tr><td><strong>C.C.:</strong> ${esc(p.cc)}</td><td><strong>Cargo:</strong> ${esc(p.cargo || p.area)}</td></tr></table>
        <p><strong>Motivo de la diligencia:</strong> Presentación de descargos por la siguiente presunta falta:</p>
        <p>El (la) trabajador(a) <strong>${esc(p.nombre)}</strong> fue citado(a) con el fin de rendir descargos por los hechos reportados relacionados con que el día ${p.fechaHechos ? `<strong>${esc(p.fechaHechos)}</strong>` : '____________'}, durante su jornada laboral como ${esc(p.cargo || p.area)}${interno}${ruta}, presuntamente: ${esc(p.motivo || '____________')}</p>
        <p>En la fecha y hora antes anotada y previa convocatoria que se hizo por escrito al trabajador para diligencia de descargos con fecha de citación del <strong>${fechaLarga(p.fechaCitacion)}</strong>, misma en la que también se le dieron a conocer las posibles faltas disciplinarias, comparece a las oficinas de la empresa el trabajador antes mencionado, con el propósito de presentar descargos o las presuntas justificaciones que pueda tener con relación a los cargos que le endilga la empresa; a tal efecto, comparece a esta diligencia en representación de la empresa la ${esc(cf.responsable || 'Coordinación de Procesos Disciplinarios')} y el trabajador antes anotado. Se invita al trabajador a que de manera libre y espontánea manifieste voluntariamente los descargos o justificaciones que pueda tener con relación a las presuntas faltas disciplinarias a que se alude y a que sea veraz en sus explicaciones:</p>
        <p class="dd-cuest"><strong>CUESTIONARIO DE DESCARGOS</strong></p>
        <div class="dd-qa">${(p.acta || p.textoActa) ? esc(p.acta || p.textoActa).replace(/\n/g, '<br>') : '<br><br><br><br><br><br>'}</div>
        <p>Siendo las <strong>${esc(horaFin)}</strong>, se da por terminada la presente diligencia y se le informa al trabajador que dentro del término legal la empresa le dará a conocer cualquier pronunciamiento con relación a los cargos y a los descargos que ha presentado.</p>
        <p>Para constancia se firma por los intervinientes,</p>
        <div class="firmas2" style="margin-top:40px">
          <div>Por la Empresa,<div class="f2-linea">${cf.firmaImg ? `<img src="${cf.firmaImg}" alt="firma">` : ''}</div>${esc(cf.nombreFirma || cf.responsable)}<br>${esc(cf.cargoFirma || 'Coordinador(a) de Procesos Disciplinarios')}</div>
          <div>Recibe,<div class="f2-linea">${p.firmaDescargos ? `<img src="${p.firmaDescargos}" alt="firma trabajador">` : ''}</div>${esc(p.nombre)}<br>C.C. ${esc(p.cc)}</div>
        </div>`;
        showTitle = false;
      }

    } else {
      // Sanción / decisión
      const fechaDesc = p.fechaActaDescargos || p.fechaDiligenciamiento || p.fechaCitacion;
      const horaDesc = p.horaActaDescargos || p.horaCitacion || '';
      const cargoTxt = p.cargo || p.area || '';
      const participo = norm(p.asistencia) === 'no' ? 'usted no compareció' : 'usted participó';
      const encabezado = `<p class="lugar2">${esc(cf.ciudad)}, ${hoy}</p>
      <p>Señor(a)<br><strong>${esc(p.nombre)}</strong><br>C.C. ${esc(p.cc)}<br>Cargo: ${esc(cargoTxt)}<br>Ciudad</p>`;
      const bloqueDescargos = (p.resumenDescargos && p.resumenDescargos.trim())
        ? `<h3 class="sec">DESCARGOS DEL TRABAJADOR</h3><p>${esc(p.resumenDescargos).replace(/\n/g, '<br>')}</p>` : '';
      const bloqueNormas = (p.reglamento && p.reglamento.trim())
        ? `<h3 class="sec">NORMAS VULNERADAS</h3><div class="reglamento">${esc(p.reglamento)}</div>` : '';

      if (norm(p.tipoDecision).includes('invit')) {
        titulo = 'INVITACIÓN AL MEJORAMIENTO';
        cuerpo = `${encabezado}
        <p>La empresa ${esc(cf.empresa)}, una vez surtida la diligencia de descargos realizada el <strong>${fechaLarga(fechaDesc)}</strong> dentro del proceso disciplinario adelantado en su contra, y garantizando el debido proceso y el derecho de defensa y contradicción, se permite comunicarle la presente <strong>INVITACIÓN AL MEJORAMIENTO</strong>, con fundamento en los hechos ocurridos el ${fechaLarga(p.fechaHechos || fechaDesc)}.</p>
        <h3 class="sec">ANTECEDENTES</h3>
        <p>${esc(p.antecedentes || p.motivo || '____________').replace(/\n/g, '<br>')}</p>
        ${bloqueDescargos}
        ${bloqueNormas}
        <h3 class="sec">CONSIDERACIONES</h3>
        <p>${esc(p.consideraciones || 'Analizados los hechos y los descargos rendidos por el trabajador, la empresa considera procedente, en esta oportunidad, realizar un llamado al mejoramiento en lugar de imponer una sanción disciplinaria, sin perjuicio de las acciones que correspondan ante una eventual reincidencia.').replace(/\n/g, '<br>')}</p>
        <h3 class="sec">INVITACIÓN AL MEJORAMIENTO</h3>
        <p>En consecuencia, la empresa lo (la) invita formalmente a mejorar su comportamiento y a dar estricto cumplimiento al Reglamento Interno de Trabajo, al contrato de trabajo, al manual de funciones y a las directrices de la empresa.</p>
        ${p.compromisos && p.compromisos.trim() ? `<p><strong>Compromisos de mejora:</strong></p><div class="reglamento">${esc(p.compromisos)}</div>` : ''}
        <p>Se le advierte que la reincidencia en este tipo de conductas podrá dar lugar a la imposición de sanciones disciplinarias más severas, conforme al procedimiento establecido en el Reglamento Interno de Trabajo y la ley.</p>
        <p>La presente invitación al mejoramiento se deja como constancia dentro de su historial laboral.</p>
        ${firmasSancion}`;
      } else if (norm(p.tipoDecision).includes('llamado') || norm(p.tipoDecision).includes('atencion')) {
        titulo = 'LLAMADO DE ATENCIÓN';
        cuerpo = `${encabezado}
        <p>La empresa ${esc(cf.empresa)}, una vez surtida la diligencia de descargos realizada el <strong>${fechaLarga(fechaDesc)}</strong> dentro del proceso disciplinario adelantado en su contra, y garantizando el debido proceso y el derecho de defensa y contradicción, se permite realizarle el presente <strong>LLAMADO DE ATENCIÓN ESCRITO</strong>, con fundamento en los hechos ocurridos el ${fechaLarga(p.fechaHechos || fechaDesc)}.</p>
        <h3 class="sec">ANTECEDENTES</h3>
        <p>${esc(p.antecedentes || p.motivo || '____________').replace(/\n/g, '<br>')}</p>
        ${bloqueDescargos}
        ${bloqueNormas}
        <h3 class="sec">CONSIDERACIONES</h3>
        <p>${esc(p.consideraciones || 'Analizados los hechos y los descargos rendidos por el trabajador, la empresa considera procedente realizar un llamado de atención escrito, dejando constancia de la conducta dentro de su historial laboral.').replace(/\n/g, '<br>')}</p>
        <h3 class="sec">LLAMADO DE ATENCIÓN</h3>
        <p>En consecuencia, la empresa le hace un <strong>LLAMADO DE ATENCIÓN ESCRITO</strong> y le exhorta a dar estricto cumplimiento al Reglamento Interno de Trabajo, al contrato de trabajo, al manual de funciones y a las directrices de la empresa.</p>
        ${p.compromisos && p.compromisos.trim() ? `<p><strong>Compromisos de mejora:</strong></p><div class="reglamento">${esc(p.compromisos)}</div>` : ''}
        <p>Se le advierte que la reincidencia en este tipo de conductas podrá dar lugar a la imposición de sanciones disciplinarias más severas, conforme al procedimiento establecido en el Reglamento Interno de Trabajo y la ley.</p>
        <p>El presente llamado de atención se deja como constancia dentro de su historial laboral.</p>
        ${firmasSancion}`;
      } else if (norm(p.tipoDecision).includes('terminacion') || norm(p.tipoDecision).includes('contrato')) {
        titulo = 'TERMINACIÓN DEL CONTRATO DE TRABAJO';
        cuerpo = `${encabezado}
        <p>La empresa ${esc(cf.empresa)}, en ejercicio de sus facultades legales y reglamentarias, una vez surtido el debido proceso y garantizado el derecho de defensa y contradicción, con fundamento en los hechos ocurridos el <strong>${fechaLarga(p.fechaHechos || fechaDesc)}</strong>, analizados dentro del proceso disciplinario para el cual usted fue citado a diligencia de descargos el <strong>${fechaLarga(fechaDesc)}</strong>${horaDesc ? ` a las <strong>${esc(horaDesc)}</strong>` : ''}, diligencia en la cual ${participo}, se permite comunicarle la <strong>TERMINACIÓN DE SU CONTRATO DE TRABAJO POR JUSTA CAUSA</strong>.</p>
        <h3 class="sec">ANTECEDENTES</h3>
        <p>${esc(p.antecedentes || p.motivo || '____________').replace(/\n/g, '<br>')}</p>
        ${bloqueDescargos}
        ${bloqueNormas}
        <h3 class="sec">CONSIDERACIONES</h3>
        <p>${esc(p.consideraciones || 'Analizados los hechos, las pruebas y los descargos rendidos, la empresa concluye que el trabajador incurrió en una falta grave que constituye justa causa para dar por terminado el contrato de trabajo, conforme al artículo 62 del Código Sustantivo del Trabajo y el Reglamento Interno de Trabajo.').replace(/\n/g, '<br>')}</p>
        <h3 class="sec">DECISIÓN</h3>
        <p>El proceso se adelantó en cumplimiento de las garantías del debido proceso, el derecho de defensa y contradicción; se realizó la debida citación y se pusieron en conocimiento las pruebas con las que contaba la empresa. En consecuencia, la empresa <strong>RESUELVE</strong>:</p>
        <p>Dar por <strong>terminado el contrato de trabajo</strong> del (de la) trabajador(a) <strong>${esc(p.nombre)}</strong>, C.C. ${esc(p.cc)}, <strong>por justa causa</strong>, de conformidad con el artículo 62 del Código Sustantivo del Trabajo y el Reglamento Interno de Trabajo${p.numeralesSancion && p.numeralesSancion.trim() ? `, ${esc(p.numeralesSancion)}` : ''}, a partir de la fecha de recibo de esta comunicación.</p>
        <p>La liquidación de las prestaciones sociales a que haya lugar se pondrá a su disposición conforme a la ley.</p>
        ${firmasSancion}`;
      } else {
        titulo = 'SUSPENSIÓN DISCIPLINARIA';
        const dias = p.diasSuspension || '____';
        cuerpo = `${encabezado}
        <p>La empresa ${esc(cf.empresa)}, en ejercicio de sus facultades legales y reglamentarias, se permite imponer la presente <strong>suspensión disciplinaria</strong>, con fundamento en los hechos ocurridos el <strong>${fechaLarga(p.fechaHechos || fechaDesc)}</strong>, analizados dentro del proceso disciplinario para el cual usted fue citado a diligencia de descargos el <strong>${fechaLarga(fechaDesc)}</strong>${horaDesc ? ` a las <strong>${esc(horaDesc)}</strong>` : ''}, diligencia en la cual ${participo}.</p>
        <h3 class="sec">ANTECEDENTES</h3>
        <p>${esc(p.antecedentes || p.motivo || '____________').replace(/\n/g, '<br>')}</p>
        ${bloqueDescargos}
        ${bloqueNormas}
        <h3 class="sec">CONSIDERACIONES</h3>
        <p>${esc(p.consideraciones || 'Analizados los hechos, las pruebas y los descargos rendidos, la empresa concluye que el trabajador incurrió en las faltas disciplinarias señaladas, encontrándose acreditada su responsabilidad, así como la afectación a las normas legales e internas de la compañía.').replace(/\n/g, '<br>')}</p>
        <h3 class="sec">DECISIÓN</h3>
        <p>El proceso se adelantó en cumplimiento de las garantías del debido proceso, el derecho de defensa y contradicción; se realizó la debida citación y se pusieron en conocimiento las pruebas con las que contaba la empresa. En consecuencia, la empresa <strong>RESUELVE</strong>:</p>
        <p>Suspender al (a la) trabajador(a) <strong>${esc(p.nombre)}</strong>, C.C. ${esc(p.cc)}, por el término de <strong>${esc(dias)} día(s)</strong>${p.numeralesSancion && p.numeralesSancion.trim() ? `, por incurrir en las faltas previstas en el Reglamento Interno de Trabajo, ${esc(p.numeralesSancion)}` : ''}.</p>
        <h3 class="sec">RECURSO</h3>
        <p>Frente a esta decisión procede el recurso de reposición, el cual debe interponerse ante ${esc(p.recursoAnte || 'la Coordinación de SST')} en el término de ${esc(p.recursoDias || '1')} día hábil siguiente al recibo de esta notificación.</p>
        <p>En caso de no impugnarse esta decisión, la suspensión se hará efectiva ${p.fechaInicioSancion ? `a partir del <strong>${fechaLarga(p.fechaInicioSancion)}</strong>` : '____________'}${p.fechaFinSancion ? ` hasta el <strong>${fechaLarga(p.fechaFinSancion)}</strong>` : ''}${p.fechaReintegro ? `, reintegrándose a laborar el día <strong>${fechaLarga(p.fechaReintegro)}</strong>` : ''}.</p>
        ${firmasSancion}`;
      }
      showTitle = true;
    }
    return { titulo, cuerpo, showTitle };
  }

  // Contenido interno (estilos + cuerpo con membrete), sin las etiquetas <html>/<head>.
  // Útil para incrustarlo (html2pdf, vista en pantalla).
  function documentoInner(titulo, cuerpo, showTitle, cf) {
    cf = cf || {};
    const header = cf.logo ? `<div class="doc-header"><img src="${cf.logo}" alt="logo"></div>` : '';
    const footer = cf.pie ? `<div class="doc-footer"><img src="${cf.pie}" alt="pie"></div>` : '';
    return `<style>${PRINT_CSS}</style><div class="doc-wrap">${header}${showTitle ? `<h1>${esc(titulo)}</h1>` : ''}${cuerpo}${footer}</div>`;
  }

  // Arma el HTML completo del documento (con membrete) listo para PDF o vista previa
  function documentoHTML(titulo, cuerpo, showTitle, cf) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo)}</title></head><body>${documentoInner(titulo, cuerpo, showTitle, cf)}</body></html>`;
  }

  window.PD_DOCS = { construir, documentoHTML, documentoInner, PRINT_CSS };
})();
