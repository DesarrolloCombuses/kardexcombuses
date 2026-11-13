// Consulta si un conductor ya está registrado en Sonar Telematics -- buscando
// su cédula en TODAS las cuentas/flotas de Combuses -- y, si se pide, lo
// registra en la flota que le corresponde.
//
// Sonar tiene TRES endpoints, y el alta solo vive en uno
// ------------------------------------------------------
// `SET_InsertDriver` NO existe en https://b2b.sonartelematics.com/Service.asmx
// (54 operaciones, todas de lectura para conductores) ni en .../sapps.asmx
// (32, de escritura solo SET_DriverAssign, que asigna a un conductor que YA
// existe). Ahí responde "No operation found for specified action" con
// cualquier SOAPAction. Por eso el alta del ERP nunca funcionó: apuntaba al
// endpoint equivocado.
//
// El alta vive en la RAÍZ del sitio, que es otro servicio -- WCF, no ASMX
// (`BasicHttpBinding_ServiceSoap_soap`):
//
//     POST https://b2b.sonartelematics.com/
//     SOAPAction: "http://sonaravl.com/webservices/ServiceSoap/SET_InsertDriver"
//
// Dos detalles del contrato que el código viejo tenía mal, los dos sacados
// del WSDL de ese endpoint (https://b2b.sonartelematics.com/?wsdl):
//   - el SOAPAction lleva el segmento `ServiceSoap/` en medio;
//   - `dr_mIdValids` es un `ArrayOfString` del namespace DEL SERVICIO, con
//     hijos <string>. El código viejo los mandaba en el namespace de
//     Microsoft (.../2003/10/Serialization/Arrays), que el servicio ignora:
//     por eso un conductor reenviado perdía los móviles que ya tenía.
//   - hay un campo `dr_status` entre `dr_mId` y `dr_mIdValids` que no se
//     mandaba; el orden de la secuencia importa.
//
// Por qué busca en TODAS las cuentas y no solo en la de su ruta
// -------------------------------------------------------------
// Combuses tiene más de una cuenta en Sonar, cada una con su propia flota, y
// las rutas están repartidas entre ellas. Un conductor que cambia de ruta
// puede quedar registrado en la flota de su ruta ANTERIOR. Buscando solo en
// la flota que le toca hoy, el ERP concluiría que "no está" cuando sí está
// -- y es exactamente lo que explica el rechazo "Existe otro conductor con la
// misma identificación" que daba el alta: Sonar lo encontraba en la otra
// flota, el ERP no.
//
// Solo la puede invocar un usuario ya autenticado en el ERP (auth: 'user').
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { XMLParser } from "npm:fast-xml-parser@4";

const SONAR_ENDPOINT = Deno.env.get("SONAR_ENDPOINT") || "https://b2b.sonartelematics.com/Service.asmx";
const NS_SONAR = "http://sonaravl.com/webservices/";
// El WSDL declara las acciones con el segmento "ServiceSoap/" en medio. El
// servidor acepta las dos formas (probado contra producción: con y sin el
// segmento responde igual), pero se manda la declarada en el WSDL.
const SOAP_ACTION_GET_DRIVERS_V2 = `${NS_SONAR}ServiceSoap/GET_Drivers_v2`;

// El alta NO está en Service.asmx sino en la raíz del sitio (ver cabecera).
// Overridable por si Sonar lo mueve.
const SONAR_ENDPOINT_ALTA = Deno.env.get("SONAR_ENDPOINT_ALTA") || "https://b2b.sonartelematics.com/";
const SOAP_ACTION_INSERT = `${NS_SONAR}ServiceSoap/SET_InsertDriver`;

interface SonarAccount {
  userEnv: string;
  passwordEnv: string;
  fleetEnv: string;
  fleetDefault: number;
}

const SONAR_ACCOUNTS: Record<string, SonarAccount> = {
  urbana: { userEnv: "SONAR_USER", passwordEnv: "SONAR_PASSWORD", fleetEnv: "SONAR_FLEET_ID", fleetDefault: 3638 },
  urbana2: { userEnv: "SONAR_USER_2", passwordEnv: "SONAR_PASSWORD_2", fleetEnv: "SONAR_FLEET_ID_2", fleetDefault: 3721 },
};

// Qué cuenta le corresponde a cada ruta. Sirve para decir si el conductor
// está donde debería; la búsqueda se hace igual en todas.
// Mantener sincronizada con RUTAS_SONAR en js/views/empleados.js.
const RUTA_A_CUENTA: Record<string, string> = {
  "700": "urbana",
  "2": "urbana2",
  "41": "urbana2",
  "313": "urbana2",
  AEROPUERTO: "urbana",
  "URBANAS ZAMORA-ARANJUEZ": "urbana2",
  "ARANJUEZ - GUADALUPE": "urbana2",
};

const ALIAS_RUTA: Record<string, string> = { ZAMORA: "2" };

// SIEMPRE todas las cuentas, nunca solo la de su ruta (el porqué está en la
// cabecera). Está aparte, y no en línea dentro del handler, para que la
// decisión se pueda probar: es la que arregla el caso de los conductores que
// cambiaron de ruta.
function cuentasAConsultar(): string[] {
  return Object.keys(SONAR_ACCOUNTS);
}

function normalizaRuta(ruta: string): string {
  const texto = String(ruta || "").trim().toUpperCase();
  const digitos = texto.replace(/\D/g, "");
  return digitos || ALIAS_RUTA[texto] || texto;
}

function xmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findByLocalName(obj: unknown, name: string): unknown {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  if (name in record) return record[name];
  for (const key of Object.keys(record)) {
    const found = findByLocalName(record[key], name);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

interface Hallazgo {
  cuenta: string;
  fleetId: number;
  // null = no se pudo consultar (faltan credenciales, red, o Sonar devolvió
  // ERROR). No es lo mismo que "no está": hay que poder distinguirlos, o el
  // ERP diría "no está registrado" cuando lo que pasó fue que no pudo mirar.
  consultado: boolean;
  error?: string;
  encontrado: boolean;
  dr_Id?: string;
  dr_status?: string;
  moviles?: string[];
}

async function consultarCuenta(cuentaKey: string, cedula: string): Promise<Hallazgo> {
  const cuenta = SONAR_ACCOUNTS[cuentaKey];
  const fleetId = Number(Deno.env.get(cuenta.fleetEnv)) || cuenta.fleetDefault;
  const base: Hallazgo = { cuenta: cuentaKey, fleetId, consultado: false, encontrado: false };

  const user = Deno.env.get(cuenta.userEnv);
  const password = Deno.env.get(cuenta.passwordEnv);
  if (!user || !password) {
    return { ...base, error: `faltan las credenciales ${cuenta.userEnv}/${cuenta.passwordEnv} en el servidor` };
  }

  const envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<GET_Drivers_v2 xmlns="${NS_SONAR}">` +
    `<User>${xmlEscape(user)}</User><Password>${xmlEscape(password)}</Password><FleetId>${fleetId}</FleetId>` +
    `<DrvId></DrvId><DrvDoc>${xmlEscape(cedula)}</DrvDoc>` +
    "</GET_Drivers_v2></soap:Body></soap:Envelope>";

  let texto: string;
  try {
    const resp = await fetch(SONAR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${SOAP_ACTION_GET_DRIVERS_V2}"` },
      body: envelope,
    });
    texto = await resp.text();
    if (!resp.ok) return { ...base, error: `Sonar respondió HTTP ${resp.status}` };
  } catch (err) {
    return { ...base, error: "no se pudo conectar: " + String((err as Error)?.message || err) };
  }

  // parseTagValue:false para no convertir cédulas ni mIds a número (se
  // pierden los ceros a la izquierda).
  let doc: unknown;
  try {
    doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(texto);
  } catch (_) {
    return { ...base, error: "Sonar devolvió una respuesta que no se pudo leer" };
  }

  const result = findByLocalName(doc, "GET_Drivers_v2Result") as Record<string, unknown> | null;
  if (!result) return { ...base, error: "Sonar no devolvió resultado" };
  if (String(result.status || "").toUpperCase() !== "OK") {
    const desc = String(result.description || "").trim();
    return { ...base, error: desc || `Sonar respondió ${result.status || "sin estado"}` };
  }

  const raw = (result.drList as Record<string, unknown> | undefined)?.Driver;
  const lista = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const d = lista.find((x) => String(x.dr_cedula || "").trim() === cedula.trim());
  if (!d) return { ...base, consultado: true };

  const valids = (d.dr_mIdValids as Record<string, unknown> | undefined)?.string;
  return {
    ...base,
    consultado: true,
    encontrado: true,
    dr_Id: String(d.dr_Id || ""),
    dr_status: String(d.dr_status || "").toUpperCase(),
    moviles: (Array.isArray(valids) ? valids : valids ? [valids] : []).map(String),
  };
}

interface DatosAlta {
  dr_Id: number;
  dr_cedula: string;
  dr_IdFleet: number;
  dr_name: string;
  dr_address: string;
  dr_phone: string;
  dr_cellphone: string;
  dr_email: string;
  dr_mId: string;
  dr_status: string;
  dr_mIdValids: string[];
}

// El orden de los elementos NO es decorativo: el WSDL los declara como una
// <xsd:sequence>, así que cambiarlos de sitio hace que el servicio deje de
// reconocer los que vengan después.
function buildAltaEnvelope(user: string, password: string, d: DatosAlta): string {
  // Los <string> van SIN xmlns propio: heredan el del servicio, que es lo
  // que pide el ArrayOfString del WSDL.
  const valids = d.dr_mIdValids.length
    ? `<dr_mIdValids>${d.dr_mIdValids.map((v) => `<string>${xmlEscape(v)}</string>`).join("")}</dr_mIdValids>`
    : "<dr_mIdValids />";
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
    + `<SET_InsertDriver xmlns="${NS_SONAR}">`
    + `<User>${xmlEscape(user)}</User><Password>${xmlEscape(password)}</Password>`
    + "<Driver>"
    + `<dr_Id>${xmlEscape(d.dr_Id)}</dr_Id>`
    + `<dr_cedula>${xmlEscape(d.dr_cedula)}</dr_cedula>`
    + `<dr_IdFleet>${xmlEscape(d.dr_IdFleet)}</dr_IdFleet>`
    + `<dr_name>${xmlEscape(d.dr_name)}</dr_name>`
    + `<dr_address>${xmlEscape(d.dr_address)}</dr_address>`
    + `<dr_phone>${xmlEscape(d.dr_phone)}</dr_phone>`
    + `<dr_cellphone>${xmlEscape(d.dr_cellphone)}</dr_cellphone>`
    + `<dr_email>${xmlEscape(d.dr_email)}</dr_email>`
    + `<dr_mId>${xmlEscape(d.dr_mId)}</dr_mId>`
    + `<dr_status>${xmlEscape(d.dr_status)}</dr_status>`
    + valids
    + "</Driver></SET_InsertDriver></soap:Body></soap:Envelope>";
}

interface ResultadoAlta {
  ok: boolean;
  status: string;
  description: string;
  errorCode: string;
  regId: string;
  httpStatus: number;
  raw: string;
}

// Sonar responde HTTP 200 aunque rechace: el resultado real viene dentro del
// XML, en <status>/<description>/<error_code>/<regId>.
async function sonarAlta(user: string, password: string, d: DatosAlta): Promise<ResultadoAlta> {
  const resp = await fetch(SONAR_ENDPOINT_ALTA, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${SOAP_ACTION_INSERT}"` },
    body: buildAltaEnvelope(user, password, d),
  });
  const raw = await resp.text();
  let doc: unknown = null;
  try {
    doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(raw);
  } catch (_) { /* se reporta abajo con el crudo */ }
  const r = findByLocalName(doc, "SET_InsertDriverResult") as Record<string, unknown> | null;
  const txt = (k: string) => String((r || {})[k] ?? "").trim();
  const status = txt("status").toUpperCase();
  return {
    ok: resp.ok && status === "OK",
    status,
    description: txt("description"),
    errorCode: txt("error_code"),
    regId: txt("regId"),
    httpStatus: resp.status,
    raw,
  };
}

// El texto que ve Gestión Humana. Cada caso dice además QUÉ HACER, porque el
// único que puede actuar es quien está mirando la ficha.
function armaMensaje(hallazgos: Hallazgo[], esperada: string | null, ruta: string): { ok: boolean; message: string } {
  const flota = (h: Hallazgo) => `flota ${h.fleetId}`;
  const encontrados = hallazgos.filter((h) => h.encontrado);
  const fallidos = hallazgos.filter((h) => !h.consultado);

  if (!encontrados.length) {
    // Si ninguna consulta se pudo hacer, no se puede afirmar que no esté.
    if (fallidos.length === hallazgos.length) {
      return {
        ok: false,
        message: "No se pudo consultar Sonar: " + fallidos.map((h) => `${flota(h)} (${h.error})`).join("; "),
      };
    }
    const ids = hallazgos.filter((h) => h.consultado).map((h) => h.fleetId);
    const revisadas = ids.length === 1 ? `la flota ${ids[0]}` : `las flotas ${ids.join(" y ")}`;
    // Si alguna flota no se pudo revisar, NO se puede afirmar que el
    // conductor no esté en Sonar: solo que no apareció donde sí se miró.
    // Decir "no está registrado" ahí mandaría a crear un duplicado.
    if (fallidos.length) {
      return {
        ok: false,
        message: `No aparece en ${revisadas}, pero no se pudo revisar ${fallidos.map((h) => `la ${flota(h)} (${h.error})`).join(", ")},`
          + " así que no se puede descartar que esté allá. Conviene reintentar antes de crearlo en Sonar.",
      };
    }
    return {
      ok: false,
      message: `No está registrado en Sonar: se buscó su cédula en ${revisadas} y no aparece.`
        + " Hay que crearlo en la plataforma de Sonar (no se puede dar de alta desde el ERP).",
    };
  }

  const detalle = (h: Hallazgo) => {
    const mov = h.moviles && h.moviles.length ? `, ${h.moviles.length} móvil(es) habilitado(s)` : "";
    return `${flota(h)}: id ${h.dr_Id}, ${h.dr_status || "sin estado"}${mov}`;
  };

  // Sin cuenta esperada (ruta que no está en RUTA_A_CUENTA) no hay con qué
  // comparar: se informa dónde está y se dice que falta configurar la ruta,
  // en vez de acusar a Sonar de tenerlo en la flota equivocada.
  if (!esperada) {
    return {
      ok: false,
      message: `Está registrado en Sonar — ${encontrados.map(detalle).join(" | ")}.`
        + ` Su ruta (${ruta}) no está configurada para Sonar, así que no se puede verificar si esa es la flota que le corresponde.`,
    };
  }

  const enLaSuya = encontrados.find((h) => h.cuenta === esperada);
  const enOtras = encontrados.filter((h) => h.cuenta !== esperada);

  if (enLaSuya && !enOtras.length) {
    if (enLaSuya.dr_status === "ENABLED") {
      return { ok: true, message: `Registrado en Sonar y habilitado — ${detalle(enLaSuya)}.` };
    }
    return {
      ok: false,
      message: `Está en Sonar (${detalle(enLaSuya)}) pero NO está habilitado. Hay que habilitarlo en la plataforma de Sonar.`,
    };
  }

  if (enLaSuya && enOtras.length) {
    return {
      ok: false,
      message: `Está registrado en MÁS DE UNA flota — ${[enLaSuya, ...enOtras].map(detalle).join(" | ")}.`
        + ` Su ruta (${ruta}) corresponde a la ${flota(enLaSuya)}; la otra quedó de un registro anterior y conviene que Sonar la depure.`,
    };
  }

  // Está, pero en una flota que no es la suya: el caso que hacía fallar el
  // alta con "Existe otro conductor con la misma identificación".
  const otra = enOtras[0];
  const suya = esperada ? SONAR_ACCOUNTS[esperada] : null;
  const suyaId = suya ? Number(Deno.env.get(suya.fleetEnv)) || suya.fleetDefault : null;
  return {
    ok: false,
    message: `Está en Sonar pero en OTRA flota — ${enOtras.map(detalle).join(" | ")}.`
      + (suyaId ? ` Su ruta (${ruta}) corresponde a la flota ${suyaId}, donde no aparece.` : "")
      + " Por eso Sonar rechaza crearlo de nuevo diciendo que ya existe otro conductor con la misma identificación:"
      + " hay que moverlo de flota en la plataforma de Sonar, no crearlo otra vez.",
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ ok: false, message: "Método no permitido." }, { status: 405 });
    }

    let body: { employee_id?: string; registrar?: boolean };
    try {
      body = await req.json();
    } catch (_) {
      return Response.json({ ok: false, message: "Cuerpo de la petición inválido." }, { status: 400 });
    }

    const employeeId = body?.employee_id;
    if (!employeeId) {
      return Response.json({ ok: false, message: "Falta employee_id." }, { status: 400 });
    }

    const { data: empleado, error: empErr } = await ctx.supabase
      .from("employees")
      .select("id, cedula, nombre, cargo, ruta, base, telefono")
      .eq("id", employeeId)
      .single();
    if (empErr || !empleado) {
      return Response.json({ ok: false, message: "No se encontró el empleado." }, { status: 404 });
    }

    const cedula = String(empleado.cedula || "").trim();
    if (!cedula) {
      return Response.json({ ok: false, message: "El empleado no tiene cédula registrada; sin ella no se puede buscar en Sonar." }, { status: 400 });
    }

    const rutaNormalizada = normalizaRuta(empleado.ruta);
    const esperada = RUTA_A_CUENTA[rutaNormalizada] || null;

    // Se consultan TODAS las cuentas, no solo la de su ruta (ver cabecera).
    const hallazgos = await Promise.all(
      cuentasAConsultar().map((k) => consultarCuenta(k, cedula)),
    );

    let { ok, message } = armaMensaje(hallazgos, esperada, empleado.ruta || "sin ruta");
    let registrado = false;
    let regId: string | null = null;

    // ---- Alta, solo si se pidió expresamente ----
    // Se registra DESPUÉS de haber mirado todas las flotas y solo si no
    // apareció en ninguna. Si ya existe (aunque sea en otra flota), crear
    // otra vez es lo que hace que Sonar conteste "Existe otro conductor con
    // la misma identificación": el duplicado se evita no intentandolo.
    if (body?.registrar === true) {
      const yaEsta = hallazgos.some((h) => h.encontrado);
      const noRevisado = hallazgos.some((h) => !h.consultado);
      if (yaEsta) {
        message = "No se registró porque ya existe en Sonar. " + message;
      } else if (noRevisado) {
        message = "No se registró: " + message;
      } else if (!esperada) {
        message = `No se puede registrar: la ruta (${empleado.ruta || "sin ruta"}) no está configurada para Sonar, así que no se sabe en qué flota va.`;
      } else {
        const cuenta = SONAR_ACCOUNTS[esperada];
        const user = Deno.env.get(cuenta.userEnv);
        const password = Deno.env.get(cuenta.passwordEnv);
        const fleetId = Number(Deno.env.get(cuenta.fleetEnv)) || cuenta.fleetDefault;
        if (!user || !password) {
          message = `No se puede registrar: faltan las credenciales ${cuenta.userEnv}/${cuenta.passwordEnv} en el servidor.`;
        } else {
          const { data: perfil } = await ctx.supabase
            .from("perfil_sociodemografico")
            .select("lugar_residencia, barrio")
            .eq("employee_id", employeeId)
            .maybeSingle();
          const direccion = [perfil?.lugar_residencia, perfil?.barrio].filter(Boolean).join(", ");
          // Combuses no usa dr_email para un correo: lo usa para ver de un
          // vistazo, dentro de Sonar, a qué base pertenece el conductor.
          const dr_email = empleado.base ? `BASE ${String(empleado.base).trim().toUpperCase()}` : "";
          const telefono = String(empleado.telefono || "");

          let alta: ResultadoAlta;
          try {
            alta = await sonarAlta(user, password, {
              dr_Id: 0, // 0 = nuevo; con un id existente Sonar actualizaría ese registro
              dr_cedula: cedula,
              dr_IdFleet: fleetId,
              dr_name: empleado.nombre || "",
              dr_address: direccion,
              dr_phone: telefono,
              dr_cellphone: telefono,
              dr_email,
              dr_mId: "",
              dr_status: "ENABLED",
              dr_mIdValids: [],
            });
          } catch (err) {
            alta = { ok: false, status: "", description: "Error de red: " + String((err as Error)?.message || err),
                     errorCode: "", regId: "", httpStatus: 0, raw: "" };
          }

          if (!alta.ok) {
            message = `Sonar rechazó el registro: ${alta.description || alta.status || `HTTP ${alta.httpStatus}`}`
              + (alta.errorCode && alta.errorCode !== "0" ? ` (código ${alta.errorCode})` : "");
            console.error("sonar alta rechazada", JSON.stringify({
              employee_id: employeeId, cuenta: esperada, fleetId,
              httpStatus: alta.httpStatus, raw: (alta.raw || "").slice(0, 2000),
            }));
          } else {
            // No se da por bueno el "OK": se vuelve a leer Sonar, que es la
            // única prueba de que el conductor quedó en la flota.
            regId = alta.regId || null;
            let comprobado: Hallazgo | null = null;
            try {
              comprobado = await consultarCuenta(esperada, cedula);
            } catch (_) { comprobado = null; }
            if (comprobado && comprobado.encontrado) {
              registrado = true;
              ok = comprobado.dr_status === "ENABLED";
              message = ok
                ? `Registrado en Sonar: flota ${comprobado.fleetId}, id ${comprobado.dr_Id}, habilitado.`
                : `Registrado en Sonar (flota ${comprobado.fleetId}, id ${comprobado.dr_Id}) pero quedó ${comprobado.dr_status || "sin estado"}: hay que habilitarlo en la plataforma.`;
            } else {
              message = `Sonar respondió OK${regId ? ` (id ${regId})` : ""}, pero al volver a consultar el conductor no aparece en la flota. Revíselo en la plataforma de Sonar.`;
            }
          }
        }
      }
    }

    // El badge de la ficha se alimenta de estas dos columnas. "Verificado"
    // significa lo que de verdad se comprobó: está en Sonar, en su flota y
    // habilitado.
    if (ok) {
      await ctx.supabase
        .from("employees")
        .update({ sonar_synced_at: new Date().toISOString(), sonar_sync_error: null })
        .eq("id", employeeId);
    } else {
      await ctx.supabase
        .from("employees")
        .update({ sonar_synced_at: null, sonar_sync_error: message.slice(0, 500) })
        .eq("id", employeeId);
    }

    return Response.json({ ok, message, esperada, hallazgos, registrado, regId });
  }),
};
