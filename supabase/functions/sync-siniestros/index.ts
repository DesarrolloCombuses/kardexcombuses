// Sincroniza la base de siniestros de transito (Google Sheet externo,
// mantenido por SST) hacia la tabla siniestros_transito en Supabase.
//
// Por que existe: js/siniestros.js antes hacia fetch() directo al CSV
// publicado del sheet cada vez que alguien abria el modulo Siniestros o
// generaba un Paz y Salvo -- ese endpoint de Google (docs.google.com/.../pub
// ?output=csv) falla seguido con error 500 intermitente, y cuando fallaba
// la persona se quedaba sin poder verificar siniestros en ese momento. Esta
// funcion mueve la lectura del sheet a un solo lugar (server-to-server, sin
// las restricciones/bloqueos que puede tener un navegador) y guarda el
// resultado en Supabase; el cliente ya no depende de que el sheet responda
// en el momento exacto en que alguien lo necesita.
//
// Se llama de dos formas (ver autorizarLlamada mas abajo):
//  1) Cron cada hora (cron.schedule "sync-siniestros-periodico", corrida a
//     mano fuera de este repo -- ver nota en el commit): manda el header
//     x-cron-secret con el valor guardado en el secreto de funcion
//     SINIESTROS_CRON_SECRET.
//  2) Boton "Actualizar ahora" en Siniestros (js/views/siniestros-transito.js):
//     manda la sesion normal del usuario: se exige que tenga permiso de ver
//     Empleados o el modulo Siniestros (mismo criterio que la policy de
//     lectura de la tabla).
//
// verify_jwt = false (ver supabase/config.toml) porque la llamada del cron
// no trae un JWT real -- la autorizacion la hace esta funcion.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("SINIESTROS_CRON_SECRET") || "";

const SINIESTROS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSlQTJ6AaUMYxwmvspfKERk05d05obM83IMZ4PKvHH8wXPkDHQqIJhUqc8MSusSkQ/pub?gid=409955472&single=true&output=csv";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Mismo parser manual que js/siniestros.js (comillas, comas y saltos de
// línea dentro de campos) -- debe coincidir en comportamiento con ese
// archivo si algún día se vuelve a tocar uno de los dos.
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

async function autorizarLlamada(req: Request): Promise<boolean> {
  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (CRON_SECRET && cronSecret === CRON_SECRET) return true;

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return false;
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const [autorizado, puedeVerSiniestros, puedeVerEmpleados] = await Promise.all([
    caller.rpc("kardex_is_authorized"),
    caller.rpc("kardex_tiene_permiso", { p_modulo: "siniestros-transito", p_accion: "ver" }),
    caller.rpc("kardex_tiene_permiso", { p_modulo: "empleados", p_accion: "ver" }),
  ]);
  return !!autorizado.data || !!puedeVerSiniestros.data || !!puedeVerEmpleados.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, message: "Método no permitido." }, 405);

  if (!(await autorizarLlamada(req))) {
    return json({ ok: false, message: "No autorizado." }, 403);
  }

  let filas: string[][];
  try {
    const res = await fetch(SINIESTROS_CSV_URL);
    if (!res.ok) throw new Error(`El sheet respondió ${res.status}.`);
    const texto = await res.text();
    filas = parseCSV(texto);
  } catch (err) {
    return json({ ok: false, message: "No se pudo descargar/leer el sheet: " + (err as Error).message }, 502);
  }
  if (!filas.length) return json({ ok: false, message: "El sheet vino vacío." }, 502);

  const headerCrudo = filas[0].map((h) => h.trim());
  const header = headerCrudo.map((h) => h.toUpperCase());
  const iCedula = header.indexOf("CEDULA");
  const iKey = header.indexOf("KEY");
  if (iCedula === -1) {
    return json({ ok: false, message: "El sheet no tiene columna CEDULA -- revisa si cambió la estructura." }, 502);
  }

  const registros = filas.slice(1)
    .filter((r) => r.length > 1 && soloDigitos(r[iCedula]))
    .map((r) => {
      const datos: Record<string, string> = {};
      // Se guarda con el encabezado en MAYÚSCULAS (no headerCrudo tal cual)
      // porque js/siniestros.js busca campos puntuales por ese nombre exacto
      // (CEDULA, FECHA SINIESTRO, CONCILIADO, etc.) -- el sheet no siempre
      // los escribe en mayúsculas de forma consistente, y esto evita que un
      // cambio de mayúscula/minúscula en el sheet rompa esas búsquedas.
      header.forEach((nombre, i) => {
        if (nombre) datos[nombre] = (r[i] || "").trim();
      });
      return {
        sheet_key: iKey >= 0 ? (r[iKey] || "").trim() || null : null,
        cedula: soloDigitos(r[iCedula]),
        datos,
      };
    });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const syncedAt = new Date().toISOString();

  // Reemplazo completo en vez de upsert por clave: así la copia siempre
  // queda idéntica al sheet actual (incluye filas que hayan borrado allá).
  // Solo se llega hasta acá si la descarga/el parseo de arriba salieron
  // bien -- si el sheet falla, esta tabla se queda tal cual estaba.
  const { error: delError } = await admin.from("siniestros_transito").delete().gte("id", 0);
  if (delError) return json({ ok: false, message: "No se pudo limpiar la tabla: " + delError.message }, 500);

  const CHUNK = 500;
  for (let i = 0; i < registros.length; i += CHUNK) {
    const lote = registros.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: syncedAt }));
    const { error: insError } = await admin.from("siniestros_transito").insert(lote);
    if (insError) return json({ ok: false, message: `No se pudo guardar (fila ${i}): ` + insError.message }, 500);
  }

  return json({ ok: true, filas: registros.length, synced_at: syncedAt });
});
