// Envía/actualiza un conductor en Sonar Telematics (SOAP, ASMX), replicando
// la lógica de los Apps Script "SET_InsertDriver" que ya usaba Combuses,
// pero corriendo del lado del servidor: las credenciales de Sonar quedan
// como secrets de esta función, nunca en el cliente ni en el repo.
//
// Combuses tiene MÁS DE UNA cuenta/flota en Sonar -- no todas las rutas
// comparten usuario ni flota (ej: ruta 700 usa una cuenta, rutas 2 y 41
// usan otra distinta). Por eso cada ruta se resuelve a una "cuenta" abajo;
// para sumar una ruta nueva basta con agregarla a RUTA_A_CUENTA (si ya
// tiene cuenta) o crear una cuenta nueva con sus propios secrets
// SONAR_USER_N/SONAR_PASSWORD_N/SONAR_FLEET_ID_N y redesplegar.
//
// Solo la puede invocar un usuario ya autenticado en el ERP (auth: 'user'
// exige una sesión válida de Supabase Auth) -- a diferencia del webhook de
// Apps Script original, que cualquiera con la URL podía llamar.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { XMLParser } from "npm:fast-xml-parser@4";

const SONAR_ENDPOINT = Deno.env.get("SONAR_ENDPOINT") || "https://b2b.sonartelematics.com/Service.asmx";
const NS_TEMPURI = "http://tempuri.org/";
const NS_SONAR = "http://sonaravl.com/webservices/";
const SOAP_ACTION_INSERT_TEMPURI = NS_TEMPURI + "SET_InsertDriver";
const SOAP_ACTION_INSERT_SONAR = NS_SONAR + "SET_InsertDriver";

interface SonarAccount {
  userEnv: string;
  passwordEnv: string;
  fleetEnv: string;
  fleetDefault: number;
}

// "urbana" ya la usaba asignar-conductor-sonar-v2 (SONAR_USER/SONAR_PASSWORD/
// SONAR_FLEET_ID, sin tocar). "urbana2" es una cuenta nueva, con sus propios
// secrets (SONAR_USER_2/SONAR_PASSWORD_2/SONAR_FLEET_ID_2) para no pisar la
// primera.
const SONAR_ACCOUNTS: Record<string, SonarAccount> = {
  urbana: { userEnv: "SONAR_USER", passwordEnv: "SONAR_PASSWORD", fleetEnv: "SONAR_FLEET_ID", fleetDefault: 3638 },
  urbana2: { userEnv: "SONAR_USER_2", passwordEnv: "SONAR_PASSWORD_2", fleetEnv: "SONAR_FLEET_ID_2", fleetDefault: 3721 },
};

const RUTA_A_CUENTA: Record<string, string> = {
  "700": "urbana",
  "2": "urbana2",
  "41": "urbana2",
  "313": "urbana2",
  AEROPUERTO: "urbana",
  "URBANAS ZAMORA-ARANJUEZ": "urbana2",
  "ARANJUEZ - GUADALUPE": "urbana2",
};

// La ruta puede llegar como "700", "Ruta 700" o "R700" según quién la
// digitó -- si tiene dígitos se usa solo esos; las rutas con nombre (ej.
// "AEROPUERTO", sin dígitos) se comparan por el texto completo. Debe
// coincidir con normalizaRuta() en js/views/empleados.js.
// Nombres de ruta sin dígitos que son otra forma de escribir una ruta ya
// configurada arriba (en la flota la ruta 2 se llama ZAMORA). Debe coincidir
// con ALIAS_RUTA en js/views/empleados.js.
const ALIAS_RUTA: Record<string, string> = { ZAMORA: "2" };

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

interface SonarDriver {
  dr_Id: number;
  dr_cedula: string;
  dr_IdFleet: number;
  dr_name: string;
  dr_address: string;
  dr_phone: string;
  dr_cellphone: string;
  dr_email: string;
  dr_mId: string;
  dr_mIdValids: string[];
}

function buildSoapEnvelope(user: string, password: string, drv: SonarDriver, ns: string, useSoap12: boolean): string {
  const hasList = drv.dr_mIdValids.length > 0;
  const listXml = hasList
    ? `<dr_mIdValids xmlns="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${drv.dr_mIdValids
        .map((v) => `<string>${xmlEscape(v)}</string>`)
        .join("")}</dr_mIdValids>`
    : `<dr_mIdValids xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />`;

  const envOpen = useSoap12
    ? '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://schemas.xmlsoap.org/soap/envelope/">'
    : '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">';
  const bodyOpen = useSoap12 ? "<soap12:Body>" : "<soap:Body>";
  const bodyClose = useSoap12 ? "</soap12:Body>" : "</soap:Body>";
  const envClose = useSoap12 ? "</soap12:Envelope>" : "</soap:Envelope>";

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    envOpen +
    bodyOpen +
    `  <SET_InsertDriver xmlns="${ns}">` +
    `    <User>${xmlEscape(user)}</User>` +
    `    <Password>${xmlEscape(password)}</Password>` +
    "    <Driver>" +
    `      <dr_Id>${xmlEscape(drv.dr_Id)}</dr_Id>` +
    `      <dr_cedula>${xmlEscape(drv.dr_cedula)}</dr_cedula>` +
    `      <dr_IdFleet>${xmlEscape(drv.dr_IdFleet)}</dr_IdFleet>` +
    `      <dr_name>${xmlEscape(drv.dr_name)}</dr_name>` +
    `      <dr_address>${xmlEscape(drv.dr_address)}</dr_address>` +
    `      <dr_phone>${xmlEscape(drv.dr_phone)}</dr_phone>` +
    `      <dr_cellphone>${xmlEscape(drv.dr_cellphone)}</dr_cellphone>` +
    `      <dr_email>${xmlEscape(drv.dr_email)}</dr_email>` +
    `      <dr_mId>${xmlEscape(drv.dr_mId)}</dr_mId>` +
    listXml +
    "    </Driver>" +
    "  </SET_InsertDriver>" +
    bodyClose +
    envClose
  );
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

function parseSoapXml(xml: string): Record<string, unknown> | null {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(xml);
  const body = findByLocalName(doc, "Body") as Record<string, unknown> | null;
  if (!body) return null;

  const fault = findByLocalName(body, "Fault") as Record<string, unknown> | null;
  if (fault) {
    // Se devuelve el Fault COMPLETO. Antes se copiaban solo faultcode y
    // faultstring, y eso perdia dos cosas: el <detail>, que es donde los
    // ASMX ponen la excepcion real, y el <Reason> de SOAP 1.2. Sin eso, el
    // unico dato que llegaba a la pantalla era "faultcode=s:Client", que
    // significa "la peticion no le gusto al servidor" y nada mas.
    return { ...fault, __esFault: true };
  }

  const keys = Object.keys(body);
  if (!keys.length) return null;
  const respKey = keys.find((k) => k.toLowerCase().includes("insertdriverresponse")) || keys[0];
  const respEl = body[respKey];
  if (respEl && typeof respEl === "object") return respEl as Record<string, unknown>;
  return { [respKey]: respEl };
}

// El texto de un nodo que puede venir como string, como {"#text": ...} o
// anidado (el <Reason><Text> de SOAP 1.2, el <detail> de un ASMX).
function textoDeNodo(v: unknown, profundidad = 0): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (profundidad > 4) return "";
  if (Array.isArray(v)) {
    return v.map((x) => textoDeNodo(x, profundidad + 1)).filter(Boolean).join(" | ");
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return String(obj["#text"]).trim();
    return Object.entries(obj)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, val]) => textoDeNodo(val, profundidad + 1))
      .filter(Boolean)
      .join(" | ");
  }
  return "";
}

function recorta(v: string): string {
  return v.length > 300 ? v.slice(0, 300) + "…" : v;
}

function compactMessage(parsed: Record<string, unknown> | null, raw: string): string {
  if (parsed && parsed.__esFault) {
    // El motivo primero: faultstring (SOAP 1.1), Reason (1.2) o detail (lo
    // que mete .NET). El faultcode va al final y entre parentesis, porque
    // solo dice de quien fue la culpa, no que paso.
    const motivo = ["faultstring", "Reason", "detail", "Detail"]
      .map((k) => textoDeNodo(parsed[k]))
      .find((t) => t !== "");
    const codigo = textoDeNodo(parsed.faultcode) || textoDeNodo(parsed.Code);
    if (motivo) return recorta(codigo ? `${motivo} (${codigo})` : motivo);
    // Un Fault sin ningun texto util: mejor el XML crudo que un codigo solo.
    const crudo = (raw || "").replace(/\s+/g, " ").trim();
    if (crudo) return recorta(crudo);
    return codigo ? `Sonar respondio un error sin explicacion (${codigo})` : "sin-detalle";
  }
  if (parsed) {
    const keys = Object.keys(parsed);
    if (keys.length) {
      const k = keys[0];
      const v = textoDeNodo(parsed[k]) || String(parsed[k]).trim();
      return `${k}=${recorta(v)}`;
    }
  }
  const snip = (raw || "").replace(/\s+/g, " ").trim();
  return snip ? recorta(snip) : "sin-detalle";
}

interface SoapCallResult {
  ok: boolean;
  httpStatus: number;
  raw: string;
  parsed: Record<string, unknown> | null;
}

async function doSoapCall(envelope: string, action: string, useSoap12: boolean): Promise<SoapCallResult> {
  const headers: Record<string, string> = {};
  if (useSoap12) {
    headers["Content-Type"] = `application/soap+xml; charset=utf-8; action="${action}"`;
  } else {
    headers["Content-Type"] = "text/xml; charset=utf-8";
    headers["SOAPAction"] = `"${action}"`;
  }
  const resp = await fetch(SONAR_ENDPOINT, { method: "POST", headers, body: envelope });
  const text = await resp.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = parseSoapXml(text);
  } catch (_) {
    parsed = null;
  }
  return { ok: resp.ok, httpStatus: resp.status, raw: text, parsed };
}

async function sonarInsertDriver(user: string, password: string, driver: SonarDriver): Promise<SoapCallResult> {
  // Igual que el Apps Script original: primero intenta tempuri + SOAP 1.1,
  // y si no responde 2xx, cae a sonar + SOAP 1.2.
  const env1 = buildSoapEnvelope(user, password, driver, NS_TEMPURI, false);
  const res1 = await doSoapCall(env1, SOAP_ACTION_INSERT_TEMPURI, false);
  if (res1.httpStatus >= 200 && res1.httpStatus < 300) return res1;

  const env2 = buildSoapEnvelope(user, password, driver, NS_SONAR, true);
  return await doSoapCall(env2, SOAP_ACTION_INSERT_SONAR, true);
}

// Sonar responde HTTP 200 aunque rechace la operacion: el resultado real
// viene en <status>/<description>/<error_code> dentro del XML.
function sonarResultado(parsed: Record<string, unknown> | null): { status: string; description: string; errorCode: string } {
  const val = (k: string) => {
    const v = findByLocalName(parsed, k);
    return v === null || v === undefined || typeof v === "object" ? "" : String(v).trim();
  };
  return { status: val("status").toUpperCase(), description: val("description"), errorCode: val("error_code") };
}

interface SonarDriverExistente {
  dr_Id: string;
  dr_status: string;
  dr_mId: string;
  dr_mIdValids: string[];
}

// Busca un conductor por cedula en la flota. Si ya existe (p.ej. alguien que
// vuelve a la empresa y quedo DESHABILITADO), hay que actualizar ESE registro:
// con dr_Id=0 Sonar no crea otro ni toca el existente.
async function sonarBuscarPorCedula(user: string, password: string, fleetId: number, cedula: string): Promise<SonarDriverExistente | null> {
  const envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<GET_Drivers_v2 xmlns="${NS_SONAR}">` +
    `<User>${xmlEscape(user)}</User><Password>${xmlEscape(password)}</Password><FleetId>${fleetId}</FleetId>` +
    `<DrvId></DrvId><DrvDoc>${xmlEscape(cedula)}</DrvDoc>` +
    "</GET_Drivers_v2></soap:Body></soap:Envelope>";
  const resp = await fetch(SONAR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NS_SONAR}GET_Drivers_v2"` },
    body: envelope,
  });
  const text = await resp.text();
  // parseTagValue:false para no convertir cedulas/mIds a numero (se pierden ceros a la izquierda).
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(text);
  const result = findByLocalName(doc, "GET_Drivers_v2Result") as Record<string, unknown> | null;
  if (!result || String(result.status || "").toUpperCase() !== "OK") return null;
  const raw = (result.drList as Record<string, unknown> | undefined)?.Driver;
  const lista = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const d = lista.find((x) => String(x.dr_cedula || "").trim() === cedula.trim());
  if (!d) return null;
  const valids = (d.dr_mIdValids as Record<string, unknown> | undefined)?.string;
  return {
    dr_Id: String(d.dr_Id || "0"),
    dr_status: String(d.dr_status || "").toUpperCase(),
    dr_mId: typeof d.dr_mId === "string" ? d.dr_mId : "",
    dr_mIdValids: (Array.isArray(valids) ? valids : valids ? [valids] : []).map(String),
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ ok: false, message: "Método no permitido." }, { status: 405 });
    }

    let body: { employee_id?: string };
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
      .select("id, cedula, nombre, cargo, ruta, base, telefono, email_personal")
      .eq("id", employeeId)
      .single();
    if (empErr || !empleado) {
      return Response.json({ ok: false, message: "No se encontró el empleado." }, { status: 404 });
    }

    const rutaNormalizada = normalizaRuta(empleado.ruta);
    const esConductor = /conductor/i.test(empleado.cargo || "");
    const cuentaKey = RUTA_A_CUENTA[rutaNormalizada];
    if (!esConductor || !cuentaKey) {
      return Response.json(
        { ok: false, message: "Este empleado no es conductor de una ruta configurada para Sonar; no se envía." },
        { status: 400 },
      );
    }
    const cuenta = SONAR_ACCOUNTS[cuentaKey];

    const sonarUser = Deno.env.get(cuenta.userEnv);
    const sonarPassword = Deno.env.get(cuenta.passwordEnv);
    if (!sonarUser || !sonarPassword) {
      return Response.json(
        { ok: false, message: `Faltan las credenciales de Sonar (${cuenta.userEnv}/${cuenta.passwordEnv}) configuradas en el servidor.` },
        { status: 500 },
      );
    }
    const fleetId = Number(Deno.env.get(cuenta.fleetEnv)) || cuenta.fleetDefault;

    const { data: perfil } = await ctx.supabase
      .from("perfil_sociodemografico")
      .select("lugar_residencia, barrio")
      .eq("employee_id", employeeId)
      .maybeSingle();
    const direccion = [perfil?.lugar_residencia, perfil?.barrio].filter(Boolean).join(", ");

    // Combuses no usa este campo para un correo real: lo usan para
    // identificar rápido, dentro del visor de Sonar, a qué base pertenece
    // el conductor (ej. "BASE 3"), tomando el valor ya calculado en
    // employees.base a partir de su vehículo (ver _autocompletarBaseVehiculo
    // en js/views/empleados.js y el trigger que lo recalcula al guardar).
    const dr_email = empleado.base ? `BASE ${String(empleado.base).trim().toUpperCase()}` : "";

    const cedula = String(empleado.cedula || "").trim();
    let existente: SonarDriverExistente | null = null;
    try {
      existente = await sonarBuscarPorCedula(sonarUser, sonarPassword, fleetId, cedula);
    } catch (_) {
      existente = null;
    }

    const driver: SonarDriver = {
      dr_Id: existente ? Number(existente.dr_Id) || 0 : 0,
      dr_cedula: cedula,
      dr_IdFleet: fleetId,
      dr_name: empleado.nombre || "",
      dr_address: direccion,
      dr_phone: empleado.telefono || "",
      dr_cellphone: empleado.telefono || "",
      dr_email,
      // Se conservan los vehiculos que el conductor ya tenia habilitados en Sonar.
      dr_mId: existente?.dr_mId || "",
      dr_mIdValids: existente?.dr_mIdValids || [],
    };

    let result: SoapCallResult;
    try {
      result = await sonarInsertDriver(sonarUser, sonarPassword, driver);
    } catch (err) {
      const message = "Error de red al llamar a Sonar: " + String((err as Error)?.message || err);
      await ctx.supabase.from("employees").update({ sonar_sync_error: message }).eq("id", employeeId);
      return Response.json({ ok: false, message }, { status: 502 });
    }

    const sonar = sonarResultado(result.parsed);
    const httpOk = result.httpStatus >= 200 && result.httpStatus < 300;
    const sonarRechazo = !httpOk || (sonar.status !== "" && sonar.status !== "OK");

    // La unica prueba confiable es volver a leer Sonar: el conductor debe
    // existir en la flota y estar HABILITADO.
    let despues: SonarDriverExistente | null = null;
    try {
      despues = await sonarBuscarPorCedula(sonarUser, sonarPassword, fleetId, cedula);
    } catch (_) {
      despues = null;
    }

    let ok = false;
    let message: string;
    if (sonarRechazo) {
      message = `Sonar rechazó el envío: ${sonar.description || compactMessage(result.parsed, result.raw)}${sonar.errorCode && sonar.errorCode !== "0" ? ` (código ${sonar.errorCode})` : ""}`;
    } else if (!despues) {
      message = `Sonar respondió "${sonar.description || sonar.status || "OK"}", pero el conductor no aparece en la flota ${fleetId}.`;
    } else if (despues.dr_status !== "ENABLED") {
      message = `El conductor ya existía en Sonar (id ${despues.dr_Id}) y sigue ${despues.dr_status || "sin estado"}: se actualizaron sus datos, pero hay que habilitarlo directamente en la plataforma de Sonar.`;
    } else {
      ok = true;
      message = existente
        ? `Actualizado en Sonar (ya existía, id ${despues.dr_Id}).`
        : `Creado en Sonar (id ${despues.dr_Id}).`;
    }

    if (ok) {
      await ctx.supabase
        .from("employees")
        .update({ sonar_synced_at: new Date().toISOString(), sonar_sync_error: null })
        .eq("id", employeeId);
    } else {
      await ctx.supabase.from("employees").update({ sonar_sync_error: message.slice(0, 500) }).eq("id", employeeId);
      console.error("sonar-insert-driver rechazo", JSON.stringify({
        employee_id: employeeId, cedula, ruta: empleado.ruta, rutaNormalizada,
        cuenta: cuentaKey, fleetId, httpStatus: result.httpStatus,
        // El XML crudo queda en los logs de la funcion: es donde esta el
        // motivo completo cuando el mensaje de pantalla se queda corto.
        raw: (result.raw || "").slice(0, 2000),
      }));
    }

    return Response.json({ ok, message, httpStatus: result.httpStatus, sonar_id: despues?.dr_Id || null });
  }),
};
