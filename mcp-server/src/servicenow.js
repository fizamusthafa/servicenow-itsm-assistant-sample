// ── ServiceNow REST client + query helpers ──────────────────────────

class ServiceNowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Create a client bound to one caller's credentials.
 * @param {{ instance: string, authorization: string, fetchImpl?: typeof fetch }} opts
 */
function createClient({ instance, authorization, fetchImpl = fetch }) {
  async function request(method, apiPath, body) {
    const url = `${instance}/api/${apiPath}`;
    const opts = {
      method,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetchImpl(url, opts);
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      if (res.status === 401) {
        throw new ServiceNowError(401, "ServiceNow rejected the credentials (401). The user may need to sign in again.");
      }
      if (res.status === 403) {
        throw new ServiceNowError(403, `ServiceNow denied access (403): the signed-in user lacks permission for this operation. ${text}`);
      }
      throw new ServiceNowError(res.status, `ServiceNow API ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  /** GET /api/now/table/{table} with an encoded query. */
  async function list(table, { query = "", fields, limit = 20, displayValue = true } = {}) {
    const params = new URLSearchParams();
    if (query) params.set("sysparm_query", query);
    if (fields) params.set("sysparm_fields", fields);
    params.set("sysparm_limit", String(limit));
    if (displayValue) params.set("sysparm_display_value", "true");
    params.set("sysparm_exclude_reference_link", "true");
    const data = await request("GET", `now/table/${table}?${params}`);
    return data.result || [];
  }

  /** Find one record by its number field. Returns null when not found. */
  async function findByNumber(table, number, { fields, displayValue = true } = {}) {
    const rows = await list(table, { query: `number=${q(number)}`, fields, limit: 1, displayValue });
    return rows[0] || null;
  }

  async function insert(table, body) {
    const data = await request("POST", `now/table/${table}`, body);
    return data.result;
  }

  async function patch(table, sysId, body, { inputDisplayValue = false } = {}) {
    const params = new URLSearchParams({ sysparm_display_value: "true", sysparm_exclude_reference_link: "true" });
    if (inputDisplayValue) params.set("sysparm_input_display_value", "true");
    const data = await request("PATCH", `now/table/${table}/${encodeURIComponent(sysId)}?${params}`, body);
    return data.result;
  }

  function recordUrl(table, sysId) {
    if (!sysId) return undefined;
    return `${instance}/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${sysId}`)}`;
  }

  return { instance, request, list, findByNumber, insert, patch, recordUrl };
}

// ── Encoded-query safety ────────────────────────────────────────────
// `^` separates conditions in an encoded query (and `^OR` / `^NQ` add new
// clauses), so user-supplied values must never contain it. ServiceNow also
// evaluates `javascript:` values as server-side script, so that prefix is
// removed wherever it appears.
function q(value) {
  let v = String(value ?? "")
    .replace(/[\^\r\n\t]/g, " ")
    .replace(/[\u0000-\u001f]/g, "");
  let prev;
  do {
    prev = v;
    v = v.replace(/javascript\s*:/gi, "");
  } while (v !== prev);
  return v.trim().slice(0, 200);
}

const NUMBER_RE = /^[A-Z]{2,8}\d{4,12}$/i;
function assertNumber(value, label = "number") {
  const v = String(value || "").trim().toUpperCase();
  if (!NUMBER_RE.test(v)) {
    throw new ServiceNowError(400, `Invalid ${label} "${value}". Expected a ServiceNow record number such as INC0010001.`);
  }
  return v;
}

const SYS_ID_RE = /^[0-9a-f]{32}$/i;
function isSysId(value) {
  return SYS_ID_RE.test(String(value || ""));
}

// Record-number prefixes → tables for the generic record tools.
const PREFIX_TABLES = {
  INC: "incident",
  CHG: "change_request",
  PRB: "problem",
  RITM: "sc_req_item",
  REQ: "sc_request",
};

function tableForNumber(number) {
  const prefix = String(number).match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  const table = PREFIX_TABLES[prefix];
  if (!table) {
    throw new ServiceNowError(
      400,
      `Unsupported record number "${number}". Supported prefixes: ${Object.keys(PREFIX_TABLES).join(", ")}.`
    );
  }
  return table;
}

/** Convert ISO 8601 / "YYYY-MM-DD HH:mm:ss" input to ServiceNow's UTC format. */
function toSnDateTime(value, label = "date") {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ServiceNowError(400, `Invalid ${label} "${value}". Use ISO 8601, e.g. 2026-06-15T02:00:00Z.`);
  }
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function clampLimit(value, def = 20, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/** Copy only allow-listed, non-empty fields from args. */
function pick(args, fields) {
  const out = {};
  for (const f of fields) {
    if (args[f] !== undefined && args[f] !== null && args[f] !== "") out[f] = args[f];
  }
  return out;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

module.exports = {
  ServiceNowError,
  createClient,
  q,
  assertNumber,
  isSysId,
  tableForNumber,
  toSnDateTime,
  clampLimit,
  pick,
  stripHtml,
  PREFIX_TABLES,
};
