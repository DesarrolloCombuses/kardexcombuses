// Registra un conductor en Sonar Telematics.
//
// Esta función existe por compatibilidad: hay llamadores fuera de este repo
// que ya apuntan a `sonar-insert-driver`, y se dejó en pie para no romperlos.
// NO tiene lógica propia -- reenvía a `sonar-consultar-conductor` con
// `registrar: true`, que es donde vive la implementación real.
//
// Se hizo así a propósito. La versión anterior de este archivo SÍ tenía su
// propia implementación, apuntaba al endpoint equivocado
// (https://b2b.sonartelematics.com/Service.asmx con namespace `tempuri`, que
// no expone SET_InsertDriver) y por eso nunca registró a nadie. Mantener dos
// implementaciones del mismo envío es justo la forma de que una de las dos se
// quede atrás en silencio otra vez.
//
// Lo que hace la implementación real, y que se hereda tal cual:
//   - busca la cédula en TODAS las flotas antes de crear nada;
//   - si el conductor ya existe, aunque sea en otra flota, NO lo crea (eso es
//     lo que Sonar rechaza con "Existe otro conductor con la misma
//     identificación");
//   - no se fía del "OK" de Sonar: vuelve a consultar para confirmar que
//     quedó, y en qué estado.
//
// La autorización no se relaja: se reenvía el Authorization de quien llama y
// la función de destino exige la misma sesión y el mismo permiso de siempre.
import "@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const DESTINO = `${SUPABASE_URL}/functions/v1/sonar-consultar-conductor`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, message: "Método no permitido." }, 405);

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return json({ ok: false, message: "Falta la sesión." }, 401);

  let body: { employee_id?: string };
  try {
    body = await req.json();
  } catch (_) {
    return json({ ok: false, message: "Cuerpo de la petición inválido." }, 400);
  }
  if (!body?.employee_id) return json({ ok: false, message: "Falta employee_id." }, 400);

  let resp: Response;
  try {
    resp = await fetch(DESTINO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        // apikey viaja aparte en las llamadas desde el navegador; si vino, se
        // reenvía igual, porque el gateway de funciones la pide.
        ...(req.headers.get("apikey") ? { apikey: req.headers.get("apikey")! } : {}),
      },
      body: JSON.stringify({ employee_id: body.employee_id, registrar: true }),
    });
  } catch (err) {
    return json({
      ok: false,
      message: "No se pudo contactar al servicio de Sonar: " + String((err as Error)?.message || err),
    }, 502);
  }

  const texto = await resp.text();
  // Se devuelve el cuerpo y el estado TAL CUAL: quien llama espera el mismo
  // {ok, message} de siempre, y reescribir el mensaje aquí solo serviría para
  // que las dos funciones digan cosas distintas del mismo envío.
  return new Response(texto, {
    status: resp.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
