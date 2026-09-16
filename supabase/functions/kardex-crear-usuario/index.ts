// Crea (o actualiza el grupo de) la cuenta de Supabase Auth de un empleado,
// para que pueda entrar a "Mis permisos" sin que Gestión Humana tenga que
// crearla a mano en el dashboard de Supabase.
//
// Por qué es una función aparte y no se hace desde el navegador: crear un
// usuario de Auth requiere la service_role key (admin.auth.admin.*), que
// nunca debe llegar al cliente. La función solo la usa acá, en el servidor.
// verify_jwt queda en true (default): la plataforma ya exige un JWT válido
// de ALGUNA cuenta del proyecto compartido; acá además se confirma que sea
// una cuenta autorizada de Kardex (kardex_is_authorized()) antes de crear
// nada -- sin esto, cualquier usuario de cualquier otro programa del mismo
// proyecto podría llamar este endpoint y crear cuentas.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRUPOS_VALIDOS = [
  "CONTABILIDAD",
  "DIRECCION ADMINISTRATIVA",
  "OPERACIONES",
  "GESTION Y CONTROL DE FLOTA",
  "GESTION HUMANA",
  "DESARROLLO TECNOLOGICO",
];

function generarPassword(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, message: "Método no permitido." }, 405);

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return json({ ok: false, message: "Falta la sesión." }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: autorizado, error: authErr } = await caller.rpc("kardex_is_authorized");
  if (authErr || !autorizado) {
    return json({ ok: false, message: "No autorizado." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "Body inválido." }, 400);
  }

  const employeeId = String(body.employeeId || "");
  const email = String(body.email || "").trim().toLowerCase();
  const alias = String(body.alias || "").trim();
  const grupo = String(body.grupo || "").trim();

  if (!UUID_RE.test(employeeId)) return json({ ok: false, message: "Falta o es inválido employeeId." }, 400);
  if (!EMAIL_RE.test(email)) return json({ ok: false, message: "El correo no es válido." }, 400);
  if (!alias) return json({ ok: false, message: "Falta el alias." }, 400);
  if (!GRUPOS_VALIDOS.includes(grupo)) return json({ ok: false, message: "Grupo inválido." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerUser } = await caller.auth.getUser();
  const creadoPorEmail = (callerUser?.user?.email || "").toLowerCase();

  const { data: empleado, error: empErr } = await admin
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("activo", true)
    .maybeSingle();
  if (empErr) return json({ ok: false, message: "Error consultando el empleado: " + empErr.message }, 500);
  if (!empleado) return json({ ok: false, message: "No encontramos un empleado activo con ese id." }, 404);

  const tempPassword = generarPassword();
  let created = true;
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { alias },
  });
  if (createErr) {
    const yaExiste = createErr.code === "email_exists" ||
      /already.*registered|already.*exists/i.test(createErr.message || "");
    if (!yaExiste) {
      return json({ ok: false, message: "No se pudo crear la cuenta: " + createErr.message }, 500);
    }
    created = false;
  }

  const { error: empUpdateErr } = await admin
    .from("employees")
    .update({ email_personal: email })
    .eq("id", employeeId);
  if (empUpdateErr) {
    return json({ ok: false, message: "La cuenta se creó, pero no se pudo enlazar el correo: " + empUpdateErr.message }, 500);
  }

  const { error: grupoErr } = await admin
    .from("kardex_empleado_grupos")
    .upsert({ employee_id: employeeId, grupo, alias, creado_por_email: creadoPorEmail, updated_at: new Date().toISOString() });
  if (grupoErr) {
    return json({ ok: false, message: "La cuenta se creó, pero no se pudo guardar el grupo: " + grupoErr.message }, 500);
  }

  return json({ ok: true, created, tempPassword: created ? tempPassword : null });
});
