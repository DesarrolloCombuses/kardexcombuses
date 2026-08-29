// Envía/actualiza un conductor de la ruta 700 en Sonar Telematics (SOAP,
// ASMX), replicando la lógica del Apps Script "SET_InsertDriver" que ya
// usaba Combuses, pero corriendo del lado del servidor: las credenciales de
// Sonar (SONAR_USER/SONAR_PASSWORD) quedan como secrets de esta función,
// nunca en el cliente ni en el repo.
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
const FLEET_ID_RUTA_700_DEFAULT = 3638;

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
    return {
      faultcode: fault.faultcode ?? "",
      faultstring: fault.faultstring ?? "",
    };
  }

  const keys = Object.keys(body);
  if (!keys.length) return null;
  const respKey = keys.find((k) => k.toLowerCase().includes("insertdriverresponse")) || keys[0];
  const respEl = body[respKey];
  if (respEl && typeof respEl === "object") return respEl as Record<string, unknown>;
  return { [respKey]: respEl };
}

function compactMessage(parsed: Record<string, unknown> | null, raw: string): string {
  if (parsed) {
    const keys = Object.keys(parsed);
    if (keys.length) {
      const k = keys[0];
      let v = String(parsed[k]).trim();
      if (v.length > 160) v = v.slice(0, 160) + "…";
      return `${k}=${v}`;
    }
  }
  const snip = (raw || "").replace(/\s+/g, " ").trim();
  return snip ? (snip.length > 160 ? snip.slice(0, 160) + "…" : snip) : "sin-detalle";
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
      .select("id, cedula, nombre, cargo, ruta, telefono, email_personal")
      .eq("id", employeeId)
      .single();
    if (empErr || !empleado) {
      return Response.json({ ok: false, message: "No se encontró el empleado." }, { status: 404 });
    }

    const rutaNormalizada = String(empleado.ruta || "").replace(/\D/g, "");
    const esConductor = /conductor/i.test(empleado.cargo || "");
    if (!esConductor || rutaNormalizada !== "700") {
      return Response.json(
        { ok: false, message: "Este empleado no es conductor de la ruta 700; no se envía a Sonar." },
        { status: 400 },
      );
    }

    const sonarUser = Deno.env.get("SONAR_USER");
    const sonarPassword = Deno.env.get("SONAR_PASSWORD");
    if (!sonarUser || !sonarPassword) {
      return Response.json(
        { ok: false, message: "Faltan las credenciales de Sonar (SONAR_USER/SONAR_PASSWORD) configuradas en el servidor." },
        { status: 500 },
      );
    }
    // Misma variable SONAR_FLEET_ID que ya usan asignar-conductor-sonar-v2 y
    // sonar-drivers en este mismo proyecto -- una sola flota para todo
    // Combuses en Sonar, no una por ruta.
    const fleetId = Number(Deno.env.get("SONAR_FLEET_ID")) || FLEET_ID_RUTA_700_DEFAULT;

    const { data: perfil } = await ctx.supabase
      .from("perfil_sociodemografico")
      .select("lugar_residencia, barrio")
      .eq("employee_id", employeeId)
      .maybeSingle();
    const direccion = [perfil?.lugar_residencia, perfil?.barrio].filter(Boolean).join(", ");

    const driver: SonarDriver = {
      dr_Id: 0,
      dr_cedula: empleado.cedula || "",
      dr_IdFleet: fleetId,
      dr_name: empleado.nombre || "",
      dr_address: direccion,
      dr_phone: empleado.telefono || "",
      dr_cellphone: empleado.telefono || "",
      dr_email: empleado.email_personal || "",
      dr_mId: "",
      dr_mIdValids: [],
    };

    let result: SoapCallResult;
    try {
      result = await sonarInsertDriver(sonarUser, sonarPassword, driver);
    } catch (err) {
      const message = "Error de red al llamar a Sonar: " + String((err as Error)?.message || err);
      await ctx.supabase.from("employees").update({ sonar_sync_error: message }).eq("id", employeeId);
      return Response.json({ ok: false, message }, { status: 502 });
    }

    const summary = compactMessage(result.parsed, result.raw);
    if (result.ok) {
      await ctx.supabase
        .from("employees")
        .update({ sonar_synced_at: new Date().toISOString(), sonar_sync_error: null })
        .eq("id", employeeId);
    } else {
      await ctx.supabase.from("employees").update({ sonar_sync_error: summary }).eq("id", employeeId);
    }

    return Response.json({ ok: result.ok, message: summary, httpStatus: result.httpStatus });
  }),
};
