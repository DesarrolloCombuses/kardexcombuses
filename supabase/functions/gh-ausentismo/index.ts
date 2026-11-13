// Ausentismo operativo por mes: de cada turno programado, si la persona
// registró o no asistencia ese día.
//
// Por qué es una Edge Function y no una consulta del navegador
// ------------------------------------------------------------
// Las tres tablas que hacen falta (`programacion_turnos`, `asistencias`,
// `colaboradores`) son del sistema de flota, no de Kardex: el cliente del
// ERP no las puede leer. Aquí se leen con el service role y solo sale el
// AGREGADO por mes -- conteos, nunca quién faltó. Si algún día hace falta el
// detalle por persona, que sea una función aparte y con su propio permiso.
//
// Qué se está midiendo, exactamente
// ---------------------------------
// "Ausencia" = había turno programado y no hubo NINGÚN registro de
// asistencia ese día. No distingue incapacidad, permiso ni falta
// injustificada: esa clasificación existe (`novedades_asistencia.tipo`)
// pero la tabla está vacía. Mientras siga vacía, este número es
// "ausentismo operativo", no el ausentismo del indicador 2 del documento.
//
// Y cubre solo al personal que se programa en la app, que es cerca de un
// tercio de la planta. Por eso se devuelven `personas` y `activos`: sin la
// cobertura al lado, el porcentaje engaña.
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

const PAGINA = 1000; // PostgREST no devuelve más de 1000 filas por llamada.
const MESES_POR_DEFECTO = 12;

// Trae TODAS las filas paginando. Sin esto solo llegarían las primeras 1000
// y el ausentismo saldría inventado: faltarían marcaciones, así que
// sobrarían ausencias.
async function traerTodo(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tabla: string,
  columnas: string,
  desde: string,
  hasta: string,
): Promise<Record<string, unknown>[]> {
  const filas: Record<string, unknown>[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await admin
      .from(tabla)
      .select(columnas)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    if (!data || !data.length) break;
    filas.push(...data);
    if (data.length < PAGINA) break;
  }
  return filas;
}

function soloDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// Horas que dura un turno, a partir de "06:00:00" / "14:30:00".
//
// Uno de cada cinco turnos programados CRUZA LA MEDIANOCHE (sale antes de la
// hora a la que entró). Restando a secas darían horas negativas y el
// denominador del indicador saldría corto, así que en ese caso se suman las
// 24 horas del día siguiente.
//
// Devuelve null si el horario no se puede leer, para poder contar esos
// turnos aparte en vez de sumarlos como cero -- que es la forma silenciosa
// de encoger el denominador.
function horasDeTurno(entrada: unknown, salida: unknown): number | null {
  const minutos = (t: unknown): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  };
  const ini = minutos(entrada);
  const fin = minutos(salida);
  if (ini === null || fin === null) return null;
  let dur = fin - ini;
  if (dur <= 0) dur += 24 * 60;
  return dur / 60;
}

// "2026-10-03" -> "2026-10". Se corta el texto en vez de construir un Date
// para no toparse con el desfase de zona horaria (UTC-5 mueve el día).
function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

function primerDiaDeHaceNMeses(n: number): string {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - (n - 1), 1))
    .toISOString().slice(0, 10);
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

  // Esto lee tablas de otro sistema con el service role, así que no basta
  // con tener una sesión: hay que estar autorizado en el ERP. Se comprueba
  // en el servidor y no por lo que diga el navegador.
  const { data: quien, error: rolErr } = await admin
    .from("kardex_authorized_users")
    .select("rol")
    .eq("email", quienEmail)
    .maybeSingle();
  if (rolErr) return json({ ok: false, message: "Error verificando el permiso: " + rolErr.message }, 500);
  if (!quien) return json({ ok: false, message: "No tiene permiso para consultar estos datos." }, 403);

  let meses = MESES_POR_DEFECTO;
  try {
    const body = await req.json();
    const n = Number(body?.meses);
    if (Number.isFinite(n) && n >= 1 && n <= 24) meses = Math.floor(n);
  } catch (_) {
    // Sin cuerpo se usan los 12 meses por defecto.
  }

  const desde = primerDiaDeHaceNMeses(meses);
  // Los turnos se programan por adelantado: `programacion_turnos` tiene
  // fechas futuras. Contarlas como ausencia haría que el mes en curso
  // apareciera con un ausentismo altísimo que es puro turno por ocurrir.
  const hoy = new Date().toISOString().slice(0, 10);

  let turnos: Record<string, unknown>[];
  let marcaciones: Record<string, unknown>[];
  let colaboradores: Record<string, unknown>[];
  try {
    [turnos, marcaciones, colaboradores] = await Promise.all([
      traerTodo(admin, "programacion_turnos", "dni,fecha,hora_entrada,hora_salida", desde, hoy),
      traerTodo(admin, "asistencias", "colaborador_id,fecha", desde, hoy),
      (async () => {
        const { data, error } = await admin.from("colaboradores").select("id,dni");
        if (error) throw new Error("colaboradores: " + error.message);
        return data || [];
      })(),
    ]);
  } catch (err) {
    return json({
      ok: false,
      message: "No se pudieron leer los datos de turnos y asistencia: " + String((err as Error)?.message || err),
    }, 502);
  }

  // `asistencias` referencia al colaborador por uuid; `programacion_turnos`
  // lo hace por cédula. El puente es `colaboradores`.
  const dniDe = new Map<string, string>();
  for (const c of colaboradores) dniDe.set(String(c.id), soloDigitos(c.dni));

  // Un día con al menos una marcación cuenta como presente, venga del turno
  // que venga: no se está midiendo puntualidad.
  const presente = new Set<string>();
  let marcacionesSinColaborador = 0;
  for (const m of marcaciones) {
    const dni = dniDe.get(String(m.colaborador_id));
    if (!dni) { marcacionesSinColaborador += 1; continue; }
    presente.add(`${dni}|${String(m.fecha).slice(0, 10)}`);
  }

  // La formula del documento es POR HORAS ("horas de ausencia en turnos
  // programados / horas de trabajo programadas x 100"), no por turnos
  // contados: un turno de 11 horas no pesa lo mismo que uno de 8.
  interface FilaMes {
    turnos: number;
    ausencias: number;
    horasProgramadas: number;
    horasAusencia: number;
    sinHorario: number;
    personas: Set<string>;
  }
  const porMes = new Map<string, FilaMes>();
  for (const t of turnos) {
    const dni = soloDigitos(t.dni);
    const fecha = String(t.fecha).slice(0, 10);
    if (!dni || !fecha) continue;
    const key = mesDe(fecha);
    let fila = porMes.get(key);
    if (!fila) {
      fila = { turnos: 0, ausencias: 0, horasProgramadas: 0, horasAusencia: 0, sinHorario: 0, personas: new Set() };
      porMes.set(key, fila);
    }
    fila.turnos += 1;
    fila.personas.add(dni);
    const horas = horasDeTurno(t.hora_entrada, t.hora_salida);
    if (horas === null) fila.sinHorario += 1;
    else fila.horasProgramadas += horas;
    const falto = !presente.has(`${dni}|${fecha}`);
    if (falto) {
      fila.ausencias += 1;
      if (horas !== null) fila.horasAusencia += horas;
    }
  }

  // Cuánta planta cubre esto: sin el denominador real, un 0,4% se lee como
  // "casi nadie falta" cuando puede ser "casi nadie está medido".
  const { count: activos } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("activo", true);

  const filas = [...porMes.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, v]) => ({
      key,
      turnos: v.turnos,
      ausencias: v.ausencias,
      personas: v.personas.size,
      horasProgramadas: Math.round(v.horasProgramadas * 100) / 100,
      horasAusencia: Math.round(v.horasAusencia * 100) / 100,
      sinHorario: v.sinHorario,
      // El indicador: horas de ausencia sobre horas programadas.
      pct: v.horasProgramadas > 0 ? (v.horasAusencia / v.horasProgramadas) * 100 : null,
    }));

  return json({
    ok: true,
    desde,
    hasta: hoy,
    activos: activos ?? null,
    // La advertencia viaja en la respuesta, no solo en la pantalla: quien
    // lea esto por su cuenta tiene que toparse con ella igual.
    definicion: "Horas de ausencia / horas programadas x 100 (meta ≤ 3%). Ausencia = turno programado sin ningún registro de asistencia ese día; no distingue incapacidad, permiso ni falta injustificada.",
    marcacionesSinColaborador,
    meses: filas,
  });
});
