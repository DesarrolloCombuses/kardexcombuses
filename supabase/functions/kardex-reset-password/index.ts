// Genera una contraseña nueva para la cuenta de acceso de un empleado.
//
// Por qué existe: kardex-crear-usuario entrega la contraseña temporal UNA
// vez, cuando crea la cuenta. Si después nadie la copió, o la persona la
// perdió, no había forma de volver a entrar -- el formulario de Usuarios
// respondía "esta cuenta ya existía" y ahí se acababa el camino. La única
// salida era el panel de Supabase, que Gestión Humana no tiene por qué
// usar.
//
// Por qué es una función aparte y no se hace desde el navegador: cambiar la
// contraseña de otra cuenta exige la service_role key, que nunca debe
// llegar al cliente.
//
// Es una función NUEVA en vez de un agregado a kardex-crear-usuario a
// propósito: si algo sale mal al desplegarla, la creación de cuentas (que
// hoy funciona) no se ve afectada.
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

// Mismo alfabeto que kardex-crear-usuario: sin I/l/O/0/1, que es donde se
// equivoca quien copia una contraseña de un papel o de un WhatsApp.
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
  const { data: callerUser } = await caller.auth.getUser();
  const quienEmail = (callerUser?.user?.email || "").toLowerCase();
  if (!quienEmail) return json({ ok: false, message: "Falta la sesión." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Restablecer la contraseña de otra persona pide más que estar
  // autorizado: pide ser admin. Un viewer (solo consulta) no puede tomarse
  // una cuenta ajena. Se revisa en el servidor y no por el rol que diga el
  // navegador, que es solo para esconder botones.
  const { data: quien, error: rolErr } = await admin
    .from("kardex_authorized_users")
    .select("rol")
    .eq("email", quienEmail)
    .maybeSingle();
  if (rolErr) return json({ ok: false, message: "Error verificando el permiso: " + rolErr.message }, 500);
  if (!quien || quien.rol !== "admin") {
    return json({ ok: false, message: "Solo un administrador puede restablecer contraseñas." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "Body inválido." }, 400);
  }

  const employeeId = String(body.employeeId || "");
  if (!UUID_RE.test(employeeId)) return json({ ok: false, message: "Falta o es inválido employeeId." }, 400);

  // Solo cuentas que este módulo administra: se parte del empleado, no de
  // un correo suelto. Así esta función no se puede usar para cambiarle la
  // contraseña a una dirección cualquiera del proyecto.
  const { data: grupo, error: grupoErr } = await admin
    .from("kardex_empleado_grupos")
    .select("employee_id, alias")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (grupoErr) return json({ ok: false, message: "Error consultando el usuario: " + grupoErr.message }, 500);
  if (!grupo) {
    return json({ ok: false, message: "Ese empleado no tiene una cuenta creada desde Usuarios." }, 404);
  }

  const { data: empleado, error: empErr } = await admin
    .from("employees")
    .select("id, nombre, email_personal")
    .eq("id", employeeId)
    .maybeSingle();
  if (empErr) return json({ ok: false, message: "Error consultando el empleado: " + empErr.message }, 500);
  if (!empleado) return json({ ok: false, message: "No encontramos la ficha de ese empleado." }, 404);

  const email = (empleado.email_personal || "").trim().toLowerCase();
  if (!email) {
    return json({ ok: false, message: "Ese empleado no tiene correo de acceso guardado. Vuelve a crear la cuenta con el formulario de arriba." }, 400);
  }

  // Una cuenta del ERP (admin o viewer) no se toca desde acá: dejarlo
  // abierto convertiría este botón en una forma de quedarse con la cuenta
  // de otro administrador. Para esas está el panel de Supabase.
  const { data: esDelErp } = await admin
    .from("kardex_authorized_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (esDelErp) {
    return json({ ok: false, message: "Esa dirección es una cuenta del ERP, no de empleado. Su contraseña se cambia desde el panel de Supabase." }, 403);
  }

  // La API de administración no deja buscar por correo, así que toca
  // recorrer las páginas. Este proyecto de Supabase es compartido con otros
  // programas de la empresa, de modo que puede haber bastantes cuentas: se
  // recorre de a 1000 y se corta apenas aparece.
  let usuario = null;
  try {
    const PERPAGE = 1000;
    const MAX_PAGINAS = 20;
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: PERPAGE });
      if (listErr) throw new Error(listErr.message);
      const usuarios = data?.users || [];
      usuario = usuarios.find((u) => (u.email || "").toLowerCase() === email) || null;
      if (usuario || usuarios.length < PERPAGE) break;
    }
  } catch (err) {
    return json({ ok: false, message: "Error buscando la cuenta: " + (err as Error).message }, 500);
  }
  if (!usuario) {
    return json({ ok: false, message: "No existe una cuenta de acceso con el correo " + email + ". Créala con el formulario de arriba." }, 404);
  }

  const nuevaPassword = generarPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(usuario.id, {
    password: nuevaPassword,
    email_confirm: true,
  });
  if (updErr) {
    return json({ ok: false, message: "No se pudo cambiar la contraseña: " + updErr.message }, 500);
  }

  // Dejar constancia de quién la restableció y cuándo. Va al final y sin
  // tumbar la operación: si las columnas todavía no existen (falta correr
  // sql/usuarios_reset_password_2026-10-30.sql), la contraseña YA cambió y
  // negarlo acá dejaría a quien la pidió sin saber cuál es. Se devuelve
  // "auditado" para que la pantalla lo diga.
  let auditado = true;
  const { error: audErr } = await admin
    .from("kardex_empleado_grupos")
    .update({
      password_reset_at: new Date().toISOString(),
      password_reset_por_email: quienEmail,
    })
    .eq("employee_id", employeeId);
  if (audErr) auditado = false;

  return json({
    ok: true,
    tempPassword: nuevaPassword,
    email,
    nombre: empleado.nombre || grupo.alias || "",
    auditado,
  });
});
