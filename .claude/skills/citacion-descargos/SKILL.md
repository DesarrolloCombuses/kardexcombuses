---
name: citacion-descargos
description: Genera la citación a diligencia de descargos de COMBUSES S.A. en Word, con la hoja membrete, a partir de un informe disciplinario (formato FO-GH-06). Usar cuando pidan una citación a descargos, abrir un proceso disciplinario o revisar qué numerales del Reglamento Interno de Trabajo aplican a un informe.
---

# Citación a descargos – COMBUSES S.A.

> **Lo que NO viene en el repositorio.** `kardexcombuses` es público, así que
> `assets/` y los `*.local.json` están excluidos en `.gitignore`. Al clonar
> hay que reponerlos a mano:
>
> | Archivo | Qué es | De dónde sale |
> |---|---|---|
> | `assets/Reglamento_Interno_de_Trabajo.pdf` | El RIT completo | Gestión Humana |
> | `assets/Hoja_Membrete.docx` | Hoja membreteada en blanco | Gestión Humana |
> | `firmante.local.json` | Quién firma, con su cédula | Gestión Humana |
>
> El membrete en blanco se deja fuera a propósito: publicado permitiría armar
> un documento que parezca de COMBUSES. Si falta `firmante.local.json`,
> **pregunta quién firma en vez de inventarlo**.
>
> El texto de los artículos del RIT sí está versionado, en
> `js/catalogo-rit.js` (artículos 96, 98, 100, 108 y 112) y
> `js/catalogo-faltas.js` (las 122 faltas del art. 108 con su escala). Sirven
> para el paso 2 cuando no tengas el PDF a mano.

## Entradas
- **Informe disciplinario** (.docx o .pdf, formato FO-GH-06): datos del trabajador, hechos y evidencias.
- **Reglamento Interno de Trabajo**: `assets/Reglamento_Interno_de_Trabajo.pdf`.
- **Membrete**: `assets/Hoja_Membrete.docx`, carta, con encabezado, marca de agua y franja de pie.

## Pasos

1. **Leer el informe.**
   - Texto: `pandoc informe.docx -t plain`.
   - Imágenes de evidencia: descomprime el .docx y toma las de `word/media/`. Descarta los logos pequeños.
   - Saca: nombre, cédula, cargo, área, fecha de entrega del informe y cada hecho con su fecha.
   - Si alguna fecha es incoherente (por ejemplo, el informe se "entregó" antes que los hechos que narra), pregúntalo o márcalo en el resumen.

2. **Elegir los numerales.**
   - Extrae el RIT con `pdftotext -layout assets/Reglamento_Interno_de_Trabajo.pdf rit.txt`.
   - Usa `referencias/criterios_numerales.md` como guía.
   - Copia el texto **literal** de cada numeral desde el RIT.
   - Las faltas del art. 108 van en MAYÚSCULAS, como en el RIT.
   - Solo incluye numerales que los hechos soporten.

3. **Calcular las fechas** según el art. 106 del RIT, en días hábiles de lunes a viernes sin festivos de Colombia:
   - La citación debe entregarse dentro de los **4 días hábiles** siguientes a que la empresa conoce los hechos.
   - Los descargos van **después** de los **5 días hábiles** que tiene el trabajador para aportar pruebas.
   - Ojo: el art. 106 num. 2 escribe ahí "(5) días", **sin** "hábiles", y sí lo dice en otros numerales. Se cuentan hábiles por decisión del 18/11/2026 —la citación de ese día ya lo prometió así y dar más tiempo es el error barato—, **pendiente de que jurídica lo confirme**. El módulo del ERP dice lo mismo: si cambia, hay que cambiarlo acá, en `js/documentos-disciplinarios.js` y en `pdAvisosPlazos` de `js/views/procesos-disciplinarios.js`.
   - Ejemplo: citación entregada un miércoles → descargos desde el jueves de la semana siguiente.
   - Hora por defecto: 11:00 a. m.

4. **Armar el JSON** con la estructura de `ejemplo/datos_ejemplo.json`:
   - `hechos`: cada uno con `titulo` corto ("Presunto incumplimiento de…", con la fecha entre paréntesis) y `texto` redactado en condicional o "presuntamente". Resume el informe sin copiar opiniones.
   - `normas`: bloques "REGLAMENTO INTERNO DE TRABAJO" y "CÓDIGO SUSTANTIVO DEL TRABAJO", con sus secciones e items `{num, texto}`.
   - `contrato`: déjalo vacío si no te dan el contrato ni el manual de funciones. Saldrá un párrafo resaltado en amarillo para que Gestión Humana lo complete.
   - `pruebas`: el informe FO-GH-06 más una línea por cada evidencia.
   - `evidencias`: rutas a las imágenes, con leyenda. Salen en un anexo de 3 por fila.
   - `firmante`: sale de `firmante.local.json` (no versionado). Si ese archivo no está, pregunta quién firma y con qué cédula; no lo inventes ni lo dejes en blanco.

5. **Generar el documento:**
   ```bash
   node scripts/generar_citacion.js datos.json /tmp/cuerpo.docx
   python3 scripts/merge_membrete.py /tmp/cuerpo.docx assets/Hoja_Membrete.docx "Citacion_Descargos_<Nombre_Apellido>.docx"
   ```
   Requiere `npm i docx` si no está instalado.

6. **Verificar:**
   - Convierte a PDF (`soffice --headless --convert-to pdf`) y revisa las páginas.
   - Las firmas no deben quedar solas en una página.
   - El anexo no debe partirse.
   - El texto no debe pisar el encabezado ni la franja del pie.

## Al terminar
Entrega el .docx y un resumen corto con:
- La fecha y hora de los descargos y el plazo límite de entrega de la citación.
- Los numerales elegidos, con una línea de por qué aplica cada grupo.
- Lo que quedó pendiente (contrato o manual de funciones, fechas dudosas).
