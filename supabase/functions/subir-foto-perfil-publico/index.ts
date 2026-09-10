// Sube la foto de perfil de un empleado desde el link público (candidato sin
// sesión, rol anon).
//
// Por qué existe: se intentó primero solo con policies de Storage (rol anon,
// ruta fija "perfil-publico/<id>.jpg", exige que exista un empleado con ese
// id -- ver sql/fix_rls_foto_perfil_publico_2026-09-10.sql). Se comprobó
// contra producción, con requests HTTP directas, que Supabase Storage
// rechaza CUALQUIER insert/update del rol anon en un bucket con
// public=false sin importar qué digan las policies (se probó con una policy
// "to public, with check (true)" y siguió fallando "row-level security
// policy", mientras que el mismo request contra un bucket public=true sí
// funcionó) -- es una restricción de la plataforma, no de nuestras policies.
// "fotos-empleados" tiene que seguir siendo privado (fotos de empleados, no
// para listar públicamente), así que la subida se mueve acá: la función usa
// el service role (bypassa RLS de Storage por diseño) para escribir el
// archivo, pero solo bajo la misma ruta fija de siempre y solo si el id
// corresponde a un empleado real. Igual que antes, subir el archivo NO lo
// deja como LA foto oficial (employees.foto_url) -- eso solo lo hace
// perfil_publico_guardar() en sql/schema.sql, que sí valida la cédula.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-employee-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, message: "Método no permitido." }, 405);

  const employeeId = req.headers.get("x-employee-id") || new URL(req.url).searchParams.get("employee_id") || "";
  if (!UUID_RE.test(employeeId)) {
    return json({ ok: false, message: "Falta o es inválido employee_id." }, 400);
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return json({ ok: false, message: "El archivo debe ser una imagen." }, 400);
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return json({ ok: false, message: "La imagen está vacía o pesa más de 8MB." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: empleado, error: empErr } = await admin
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .maybeSingle();
  if (empErr) return json({ ok: false, message: "Error consultando el empleado: " + empErr.message }, 500);
  if (!empleado) return json({ ok: false, message: "No encontramos un empleado con ese id." }, 404);

  const path = `perfil-publico/${employeeId}.jpg`;
  const { error: upErr } = await admin.storage
    .from("fotos-empleados")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (upErr) return json({ ok: false, message: "No se pudo guardar la foto: " + upErr.message }, 500);

  return json({ ok: true, path });
});
