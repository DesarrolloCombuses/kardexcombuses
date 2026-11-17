// Sincroniza la base de INCAPACIDADES (Google Sheet publicado que mantiene
// Gestión Humana) hacia la tabla kardex_incapacidades en Supabase.
//
// Mismo camino que sync-siniestros, y por la misma razón: el CSV publicado
// de Google falla seguido con un 500 intermitente. Consultarlo en vivo deja
// la pantalla vacía justo cuando alguien la necesita. Acá se lee una vez por
// hora, server-to-server, y el cliente lee de Supabase.
//
// Se llama de dos formas (ver autorizarLlamada):
//  1) Cron cada hora: manda el header x-cron-secret con el valor del secreto
//     INCAPACIDADES_CRON_SECRET.
//  2) Botón "Actualizar ahora" del módulo Incapacidades: manda la sesión del
//     usuario, y se exige el mismo permiso que para ver el módulo.
//
// verify_jwt = false (ver supabase/config.toml) porque la llamada del cron
// no trae un JWT real -- la autorización la hace esta función.
//
// EL DIAGNÓSTICO NO ENTRA EN "datos"
// ----------------------------------
// El sheet trae código y descripción del diagnóstico: eso es historia
// clínica, no asistencia. Va a sus dos columnas aparte, y se SACA de la
// copia cruda de la fila. Si se quedara dentro de "datos", devolver ese
// campo a cualquiera filtraría justo lo que las columnas aparte protegen
// (ver sql/incapacidades_2026-11-16.sql).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INCAPACIDADES_CRON_SECRET") || "";

const INCAPACIDADES_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJ_4BO7ps-hpFiwUL9WkJhJeS2i0CS5FOzt3HXn0Rb4XVw8ixkINaXhb5XeNhumrRrZzqTyC0DMw2X/pub?gid=0&single=true&output=csv";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Mismo parser manual que sync-siniestros (comillas, comas y saltos de línea
// dentro de campos).
function parseCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c === "\r") {
      // el \n que sigue cierra la fila
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function soloDigitos(v: string | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

// El sheet escribe las fechas como DÍA/MES/AÑO. No es una suposición:
// comprobado sobre las 553 filas de hoy, el primer número pasa de 12 en 312
// de ellas y el segundo no lo hace nunca. Leerlo al revés correría media
// base de datos de mes.
function aFecha(v: string | undefined): string | null {
  const t = String(v || "").trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const iso = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  // Un 31 de febrero entra en la expresión regular pero no existe. Se
  // comprueba de verdad construyendo la fecha.
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== dia || d.getUTCMonth() + 1 !== mes) return null;
  return iso;
}

function aEntero(v: string | undefined): number | null {
  const t = String(v || "").trim().replace(/[^\d-]/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function texto(v: string | undefined): string | null {
  const t = String(v || "").trim();
  return t ? t : null;
}

async function autorizarLlamada(req: Request): Promise<boolean> {
  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (CRON_SECRET && cronSecret === CRON_SECRET) return true;

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return false;
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  // Mismo criterio que la función de lectura: quien puede ver el módulo
  // puede pedir que se actualice.
  const { data } = await caller.rpc("kardex_puede_ver_incapacidades");
  return !!data;
}

// Los nombres de columna del sheet, en MAYÚSCULAS y sin tildes ni espacios
// de sobra, para que un retoque de formato allá no deje la columna sin
// encontrar. Gestión Humana edita ese sheet a mano.
function normalizar(h: string): string {
  return h.trim().toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

// Busca una columna por varios nombres posibles; devuelve -1 si no está.
function columna(header: string[], ...nombres: string[]): number {
  for (const n of nombres) {
    const i = header.indexOf(normalizar(n));
    if (i !== -1) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, message: "Método no permitido." }, 405);

  if (!(await autorizarLlamada(req))) {
    return json({ ok: false, message: "No autorizado." }, 403);
  }

  let filas: string[][];
  try {
    const res = await fetch(INCAPACIDADES_CSV_URL);
    if (!res.ok) throw new Error(`El sheet respondió ${res.status}.`);
    filas = parseCSV(await res.text());
  } catch (err) {
    return json({ ok: false, message: "No se pudo descargar/leer el sheet: " + (err as Error).message }, 502);
  }
  if (!filas.length) return json({ ok: false, message: "El sheet vino vacío." }, 502);

  const header = filas[0].map(normalizar);
  const iCedula = columna(header, "CEDULA TRABAJADOR", "CEDULA");
  const iInicio = columna(header, "FECHA INICIAL DE INCAPACIDAD");
  if (iCedula === -1 || iInicio === -1) {
    return json({
      ok: false,
      message: "El sheet no tiene las columnas de cédula y fecha inicial -- revisa si cambió la estructura.",
    }, 502);
  }

  const iKey = columna(header, "KEY");
  const iNombre = columna(header, "NOMBRE DEL TRABAJADOR");
  const iCargo = columna(header, "CARGO");
  const iArea = columna(header, "AREA/ OBRA", "AREA/OBRA", "AREA / OBRA", "AREA");
  const iTipo = columna(header, "TIPO DE EVENTO (A.T., E.L., E.G.)", "TIPO DE EVENTO");
  const iEps = columna(header, "TIPO DE TRABAJADOR");
  const iFin = columna(header, "FECHA FINAL DE INCAPACIDAD");
  const iDias = columna(header, "DIAS DE INCAPACIDAD");
  const iDiasMes = columna(header, "DIAS MES REAL");
  const iDiasSig = columna(header, "DIAS MES SIGUIENTE");
  const iDxCod = columna(header, "CODIGO DIAGNOSTICO");
  const iDxDesc = columna(header, "DESCRIPCION DE LA CATEGORIA DE LA CONDICION DE SALUD");
  const iRegistro = columna(header, "FECHA DE REGISTRO");
  const iRuta = columna(header, "RUTA");
  const iInterno = columna(header, "INTERNO");
  const iAfiliado = columna(header, "AFILIADO");
  const iAdjunto = columna(header, "ADJUNTO DE INCAPACIDAD");

  // Las columnas de salud NO se copian a "datos".
  const ocultasEnDatos = new Set([iDxCod, iDxDesc].filter((i) => i >= 0));

  let descartadas = 0;
  const registros = filas.slice(1)
    .filter((r) => {
      // Sin cédula no hay a quién atribuirle la incapacidad, y sin fecha de
      // inicio no cuenta para ningún mes. En el sheet de hoy son 2 filas
      // vacías del final.
      const sirve = r.length > 1 && soloDigitos(r[iCedula]) && aFecha(r[iInicio]);
      if (!sirve && r.some((c) => (c || "").trim())) descartadas++;
      return sirve;
    })
    .map((r) => {
      const datos: Record<string, string> = {};
      header.forEach((nombre, i) => {
        if (nombre && !ocultasEnDatos.has(i)) datos[nombre] = (r[i] || "").trim();
      });
      return {
        sheet_key: iKey >= 0 ? texto(r[iKey]) : null,
        cedula: soloDigitos(r[iCedula]),
        nombre: iNombre >= 0 ? texto(r[iNombre]) : null,
        cargo: iCargo >= 0 ? texto(r[iCargo]) : null,
        area: iArea >= 0 ? texto(r[iArea]) : null,
        tipo_evento: iTipo >= 0 ? texto(r[iTipo]) : null,
        eps: iEps >= 0 ? texto(r[iEps]) : null,
        fecha_inicio: aFecha(r[iInicio]),
        fecha_fin: iFin >= 0 ? aFecha(r[iFin]) : null,
        dias: iDias >= 0 ? aEntero(r[iDias]) : null,
        dias_mes_real: iDiasMes >= 0 ? aEntero(r[iDiasMes]) : null,
        dias_mes_siguiente: iDiasSig >= 0 ? aEntero(r[iDiasSig]) : null,
        diagnostico_codigo: iDxCod >= 0 ? texto(r[iDxCod]) : null,
        diagnostico_descripcion: iDxDesc >= 0 ? texto(r[iDxDesc]) : null,
        fecha_registro: iRegistro >= 0 ? aFecha(r[iRegistro]) : null,
        ruta: iRuta >= 0 ? texto(r[iRuta]) : null,
        interno: iInterno >= 0 ? texto(r[iInterno]) : null,
        afiliado: iAfiliado >= 0 ? texto(r[iAfiliado]) : null,
        adjunto: iAdjunto >= 0 ? texto(r[iAdjunto]) : null,
        datos,
      };
    });

  if (!registros.length) {
    // Que el sheet responda pero no traiga ni una fila usable casi siempre
    // significa que cambió de estructura, no que Gestión Humana borró todo.
    // Borrar la copia buena en ese caso dejaría el módulo vacío sin aviso.
    return json({
      ok: false,
      message: "El sheet no trajo ninguna fila con cédula y fecha -- no se tocó la copia guardada.",
    }, 502);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const syncedAt = new Date().toISOString();

  // Reemplazo completo, igual que siniestros: así la copia queda idéntica al
  // sheet actual, incluidas las filas que hayan borrado allá. Solo se llega
  // acá si la descarga y el parseo salieron bien.
  const { error: delError } = await admin.from("kardex_incapacidades").delete().gte("id", 0);
  if (delError) return json({ ok: false, message: "No se pudo limpiar la tabla: " + delError.message }, 500);

  const CHUNK = 500;
  for (let i = 0; i < registros.length; i += CHUNK) {
    const lote = registros.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: syncedAt }));
    const { error: insError } = await admin.from("kardex_incapacidades").insert(lote);
    if (insError) return json({ ok: false, message: `No se pudo guardar (fila ${i}): ` + insError.message }, 500);
  }

  return json({ ok: true, filas: registros.length, descartadas, synced_at: syncedAt });
});
