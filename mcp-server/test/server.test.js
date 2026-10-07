const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { validateArgs } = require("../src/mcp");
const { q, assertNumber, toSnDateTime, tableForNumber } = require("../src/servicenow");

const INSTANCE = "https://example.service-now.com";

/** Fake ServiceNow: records calls, answers with a per-test responder. */
function fakeServiceNow() {
  const calls = [];
  let responder = () => ({ result: [] });
  const fetchImpl = async (url, opts) => {
    const call = { url: new URL(url), method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const out = responder(call);
    const status = out && out.__status ? out.__status : 200;
    return {
      ok: status < 400,
      status,
      json: async () => out,
      text: async () => JSON.stringify(out),
    };
  };
  return {
    calls,
    fetchImpl,
    respond(fn) {
      responder = fn;
    },
    reset() {
      calls.length = 0;
      responder = () => ({ result: [] });
    },
  };
}

async function startServer(config, sn) {
  const app = createApp(config, { fetchImpl: sn.fetchImpl });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

let rpcId = 0;
async function rpc(base, method, params, headers = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const BEARER = "Bearer";
const USER_TOKEN = "user-access-token-123";
const TOKEN = { Authorization: `${BEARER} ${USER_TOKEN}` };

async function callTool(base, name, args, headers = TOKEN) {
  const r = await rpc(base, "tools/call", { name, arguments: args }, headers);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const result = r.body.result;
  const text = result.content[0].text;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { result, data };
}

describe("oauth mode", () => {
  const sn = fakeServiceNow();
  let ctx;
  before(async () => {
    ctx = await startServer(loadConfig({ SERVICENOW_INSTANCE: INSTANCE, AUTH_MODE: "oauth" }), sn);
  });
  after(() => ctx.server.close());

  test("does not serve archived instructional GIF assets", async () => {
    const response = await fetch(`${ctx.base}/demo-assets/teams-audio-devices.gif`);
    assert.equal(response.status, 404);
    assert.equal((await fetch(`${ctx.base}/demo-assets/01-devices.png`)).status, 404);
    assert.equal((await rpc(ctx.base, "tools/list", {})).status, 401);
  });

  test("rejects requests without a bearer token", async () => {
    const r = await rpc(ctx.base, "tools/list", {});
    assert.equal(r.status, 401);
    assert.ok(r.headers.get("www-authenticate").startsWith(BEARER));
    assert.equal(sn.calls.length, 0);
  });

  test("rejects basic credentials in oauth mode", async () => {
    const r = await rpc(ctx.base, "tools/list", {}, { Authorization: "Basic YWRtaW46YWRtaW4=" });
    assert.equal(r.status, 401);
  });

  test("accepts JSON-only clients without weakening authentication", async () => {
    const r = await rpc(ctx.base, "tools/list", {}, { ...TOKEN, Accept: "application/json" });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.tools.length, 33);
    const unauthorized = await rpc(ctx.base, "tools/list", {}, { Accept: "application/json" });
    assert.equal(unauthorized.status, 401);
  });

  test("accepts clients without an Accept header", async () => {
    const response = await fetch(`${ctx.base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} }),
    });
    assert.equal(response.status, 200);
  });

  test("rejects clients that do not accept JSON", async () => {
    const response = await rpc(ctx.base, "tools/list", {}, { ...TOKEN, Accept: "text/plain" });
    assert.equal(response.status, 406);
  });

  test("initialize succeeds", async () => {
    const r = await rpc(
      ctx.base,
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      TOKEN
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.result.serverInfo.name, "servicenow-itsm-mcp-server");
    assert.ok(r.body.result.capabilities.tools);
  });

  test("tools/list advertises the full ITSM tool set", async () => {
    const r = await rpc(ctx.base, "tools/list", {}, TOKEN);
    const names = r.body.result.tools.map((t) => t.name);
    for (const n of [
      "search_incidents",
      "create_incident",
      "update_change",
      "search_problems",
      "link_incident_to_problem",
      "search_catalog_items",
      "submit_catalog_request",
      "search_knowledge",
      "get_configuration_item",
      "get_my_profile",
      "add_work_note",
      "respond_to_approval",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    const dash = r.body.result.tools.find((t) => t.name === "show_incident_dashboard");
    assert.equal(dash._meta.ui.resourceUri, "ui://servicenow/incident-dashboard.html");
    for (const t of r.body.result.tools) {
      assert.ok(t.annotations.readOnlyHint || t.annotations.destructiveHint, `${t.name} lacks a read/write annotation`);
      assert.ok(!("handler" in t));
    }
  });

  test("forwards the caller's token to ServiceNow", async () => {
    sn.reset();
    sn.respond(() => ({ result: [{ sys_id: "a".repeat(32), number: "INC0010001", short_description: "VPN down" }] }));
    const { data } = await callTool(ctx.base, "search_incidents", { query: "VPN" });
    assert.equal(sn.calls[0].headers.Authorization, `${BEARER} ${USER_TOKEN}`);
    assert.equal(sn.calls[0].url.origin, INSTANCE);
    assert.equal(data[0].number, "INC0010001");
    assert.match(data[0].url, /^https:\/\/example\.service-now\.com\/nav_to\.do\?uri=incident\.do/);
  });

  test("strips encoded-query separators from user input", async () => {
    sn.reset();
    await callTool(ctx.base, "search_incidents", { query: "x^NQactive=false", assigned_to: "bob^ORpriority=1" });
    const query = sn.calls[0].url.searchParams.get("sysparm_query");
    assert.ok(!query.includes("^NQ"));
    assert.ok(!query.includes("^ORpriority"));
    assert.match(query, /short_descriptionLIKEx NQactive=false/);
  });

  test("validation: missing required argument is a tool error", async () => {
    sn.reset();
    const { result, data } = await callTool(ctx.base, "get_incident", {});
    assert.equal(result.isError, true);
    assert.match(data.error, /Missing required argument "number"/);
    assert.equal(sn.calls.length, 0);
  });

  test("validation: malformed record number is rejected before calling ServiceNow", async () => {
    sn.reset();
    const { result } = await callTool(ctx.base, "get_incident", { number: "INC001^ORactive=true" });
    assert.equal(result.isError, true);
    assert.equal(sn.calls.length, 0);
  });

  test("create_incident only sends allow-listed fields", async () => {
    sn.reset();
    sn.respond(() => ({ result: { number: "INC0010099", sys_id: "b".repeat(32), state: "1" } }));
    const { data } = await callTool(ctx.base, "create_incident", {
      short_description: "Printer jam",
      urgency: "3",
      sys_created_by: "spoofed",
      state: "7",
    });
    assert.equal(sn.calls[0].method, "POST");
    assert.deepEqual(sn.calls[0].body, { short_description: "Printer jam", urgency: "3" });
    assert.equal(data.number, "INC0010099");
  });

  test("not-found results are flagged as errors", async () => {
    sn.reset();
    const { result, data } = await callTool(ctx.base, "get_change", { number: "CHG0000999" });
    assert.equal(result.isError, true);
    assert.match(data.error, /not found/);
  });

  test("knowledge article returns text and a source link without image references", async () => {
    sn.reset();
    sn.respond(() => ({ result: [{ sys_id: "a".repeat(32), number: "KB0000011", text: '<p>Choose your microphone.</p><img src="https://media.example.com/audio.gif" alt="Audio &amp; devices"><img src="https://media.example.com/audio.gif">' }] }));
    const { data } = await callTool(ctx.base, "get_knowledge_article", { number: "KB0000011" });
    assert.equal(data.text, "Choose your microphone.");
    assert.equal(Object.hasOwn(data, "images"), false);
    assert.match(data.url, /kb_knowledge/);
    assert.equal(sn.calls.length, 1);
  });

  test("knowledge article omits relative attachments without fetching them", async () => {
    sn.reset();
    sn.respond(() => ({ result: [{ sys_id: "a".repeat(32), number: "KB0000011", text: '<img src="/sys_attachment.do?sys_id=abc" alt="Screenshot">' }] }));
    const { data } = await callTool(ctx.base, "get_knowledge_article", { number: "KB0000011" });
    assert.equal(Object.hasOwn(data, "images"), false);
    assert.equal(sn.calls.length, 1);
  });

  test("knowledge article omits unsafe and credential-bearing image URLs", async () => {
    sn.reset();
    sn.respond(() => ({ result: [{ sys_id: "a".repeat(32), number: "KB0000011", text: '<img src="javascript:alert(1)"><img src="data:image/gif;base64,abc"><img src="http://media.example.com/a.gif"><img src="https://user:pass@media.example.com/a.gif"><img src="https://media.example.com/a.gif?token=secret"><template><img src="https://media.example.com/hidden.gif"></template>' }] }));
    const { data } = await callTool(ctx.base, "get_knowledge_article", { number: "KB0000011" });
    assert.equal(Object.hasOwn(data, "images"), false);
  });

  test("ServiceNow 401 surfaces a re-sign-in message", async () => {
    sn.reset();
    sn.respond(() => ({ __status: 401, error: { message: "User Not Authenticated" } }));
    const { result, data } = await callTool(ctx.base, "search_problems", {});
    assert.equal(result.isError, true);
    assert.match(data.error, /sign in again/);
  });

  test("search_changes window filter builds an overlap query", async () => {
    sn.reset();
    await callTool(ctx.base, "search_changes", { window_start: "2026-06-15T02:00:00Z", window_end: "2026-06-15T06:00:00Z" });
    const query = sn.calls[0].url.searchParams.get("sysparm_query");
    assert.match(query, /start_date<=2026-06-15 06:00:00/);
    assert.match(query, /end_date>=2026-06-15 02:00:00/);
  });

  test("link_incident_to_problem patches the incident's problem_id", async () => {
    sn.reset();
    sn.respond((c) => {
      if (c.method === "PATCH") return { result: {} };
      const table = c.url.pathname.split("/").pop();
      return { result: [{ sys_id: table === "incident" ? "1".repeat(32) : "2".repeat(32), number: "X" }] };
    });
    await callTool(ctx.base, "link_incident_to_problem", { incident_number: "INC0010001", problem_number: "PRB0000001" });
    const patch = sn.calls.find((c) => c.method === "PATCH");
    assert.match(patch.url.pathname, /\/table\/incident\/1{32}$/);
    assert.deepEqual(patch.body, { problem_id: "2".repeat(32) });
  });

  test("submit_catalog_request validates sys_id and calls order_now", async () => {
    sn.reset();
    const bad = await callTool(ctx.base, "submit_catalog_request", { sys_id: "../../table/sys_user" });
    assert.equal(bad.result.isError, true);
    assert.equal(sn.calls.length, 0);

    sn.respond(() => ({ result: { request_number: "REQ0010001", request_id: "c".repeat(32) } }));
    const { data } = await callTool(ctx.base, "submit_catalog_request", {
      sys_id: "d".repeat(32),
      variables: { justification: "new starter" },
    });
    assert.match(sn.calls[0].url.pathname, /\/api\/sn_sc\/servicecatalog\/items\/d{32}\/order_now$/);
    assert.deepEqual(sn.calls[0].body, { sysparm_quantity: "1", variables: { justification: "new starter" } });
    assert.equal(data.request_number, "REQ0010001");
  });

  test("respond_to_approval requires comments to reject and targets the caller's approval", async () => {
    sn.reset();
    const r1 = await callTool(ctx.base, "respond_to_approval", { number: "CHG0000001", decision: "rejected" });
    assert.equal(r1.result.isError, true);
    assert.equal(sn.calls.length, 0);

    sn.respond((c) => (c.method === "PATCH" ? { result: {} } : { result: [{ sys_id: "e".repeat(32) }] }));
    await callTool(ctx.base, "respond_to_approval", { number: "CHG0000001", decision: "approved" });
    const query = sn.calls[0].url.searchParams.get("sysparm_query");
    assert.match(query, /approver=javascript:gs\.getUserID\(\)/);
    assert.match(query, /state=requested/);
    assert.deepEqual(sn.calls[1].body, { state: "approved" });
  });

  test("add_work_note rejects unsupported record prefixes", async () => {
    sn.reset();
    const { result } = await callTool(ctx.base, "add_work_note", { number: "ABC0000001", work_notes: "hi" });
    assert.equal(result.isError, true);
    assert.equal(sn.calls.length, 0);
  });

  test("show_incident_dashboard returns structured content for the widget", async () => {
    sn.reset();
    sn.respond(() => ({ result: [{ sys_id: "f".repeat(32), number: "INC1", priority: "1 - Critical", state: "New", short_description: "x" }] }));
    const r = await rpc(ctx.base, "tools/call", { name: "show_incident_dashboard", arguments: {} }, TOKEN);
    assert.equal(r.body.result.structuredContent.count, 1);
    assert.equal(r.body.result.structuredContent.instanceLabel, "example.service-now.com");
  });

  test("resources/read serves the dashboard widget", async () => {
    const list = await rpc(ctx.base, "resources/list", {}, TOKEN);
    assert.equal(list.body.result.resources[0].uri, "ui://servicenow/incident-dashboard.html");
    assert.ok(!("text" in list.body.result.resources[0]));
    const read = await rpc(ctx.base, "resources/read", { uri: "ui://servicenow/incident-dashboard.html" }, TOKEN);
    assert.match(read.body.result.contents[0].text, /<html/i);
  });

  test("GET /mcp is not allowed (stateless server)", async () => {
    const res = await fetch(`${ctx.base}/mcp`);
    assert.equal(res.status, 405);
  });

  test("health reports liveness without calling ServiceNow", async () => {
    sn.reset();
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).authMode, "oauth");
    assert.equal(sn.calls.length, 0);
  });
});

describe("basic mode", () => {
  const sn = fakeServiceNow();
  let ctx;
  before(async () => {
    ctx = await startServer(
      loadConfig({ SERVICENOW_INSTANCE: INSTANCE, AUTH_MODE: "basic", SERVICENOW_USERNAME: "svc", SERVICENOW_PASSWORD: "pw" }),
      sn
    );
  });
  after(() => ctx.server.close());

  test("uses the service account and ignores caller credentials", async () => {
    await callTool(ctx.base, "search_incidents", {}, { Authorization: `${BEARER} someone-elses-token` });
    assert.equal(sn.calls[0].headers.Authorization, "Basic " + Buffer.from("svc:pw").toString("base64"));
  });

  test("assign_incident auto-routes from category", async () => {
    sn.reset();
    sn.respond((c) =>
      c.method === "PATCH"
        ? { result: { number: "INC0010003", assignment_group: "Network" } }
        : { result: [{ sys_id: "9".repeat(32), number: "INC0010003", category: "Network" }] }
    );
    const { data } = await callTool(ctx.base, "assign_incident", { number: "INC0010003" }, {});
    assert.equal(data.assignment_group, "Network");
    assert.equal(data.auto_routed, true);
    assert.equal(sn.calls[1].url.searchParams.get("sysparm_input_display_value"), "true");
  });
});

describe("helpers", () => {
  test("q() removes separators and control characters", () => {
    assert.equal(q("a^b\nc"), "a b c");
    assert.equal(q("x".repeat(500)).length, 200);
    assert.equal(q("JavaScript:gs.getUserID()"), "gs.getUserID()");
    assert.equal(q("javajavascript:script:x"), "x");
  });

  test("assertNumber normalises and validates", () => {
    assert.equal(assertNumber("inc0010001"), "INC0010001");
    assert.throws(() => assertNumber("INC0010001^ORx=1"));
    assert.throws(() => assertNumber(""));
  });

  test("toSnDateTime converts ISO to ServiceNow UTC format", () => {
    assert.equal(toSnDateTime("2026-06-15T02:00:00Z"), "2026-06-15 02:00:00");
    assert.equal(toSnDateTime("2026-06-15 02:00:00"), "2026-06-15 02:00:00");
    assert.throws(() => toSnDateTime("next tuesday"));
  });

  test("tableForNumber maps prefixes", () => {
    assert.equal(tableForNumber("RITM0010001"), "sc_req_item");
    assert.equal(tableForNumber("PRB0000001"), "problem");
    assert.throws(() => tableForNumber("KB0000001"));
  });

  test("validateArgs coerces and drops unknown properties", () => {
    const schema = {
      properties: { n: { type: "integer", minimum: 1, maximum: 5 }, b: { type: "boolean" }, s: { type: "string" } },
      required: ["s"],
    };
    assert.deepEqual(validateArgs(schema, { n: "3", b: "true", s: 7, extra: "x" }), { n: 3, b: true, s: "7" });
    assert.throws(() => validateArgs(schema, { s: "x", n: 9 }));
    assert.throws(() => validateArgs(schema, {}));
  });

  test("loadConfig rejects bad settings", () => {
    assert.throws(() => loadConfig({ AUTH_MODE: "none" }));
    assert.throws(() => loadConfig({ SERVICENOW_INSTANCE: "http://insecure.example.com" }));
    assert.equal(loadConfig({ SERVICENOW_INSTANCE: "https://x.service-now.com/" }).instance, "https://x.service-now.com");
  });
});

describe("rate limiting", () => {
  test("returns 429 once the per-minute limit is exceeded", async () => {
    const sn = fakeServiceNow();
    const config = { ...loadConfig({ SERVICENOW_INSTANCE: INSTANCE, AUTH_MODE: "oauth" }), rateLimitPerMinute: 2 };
    const ctx = await startServer(config, sn);
    try {
      assert.equal((await rpc(ctx.base, "tools/list", {}, TOKEN)).status, 200);
      assert.equal((await rpc(ctx.base, "tools/list", {}, TOKEN)).status, 200);
      assert.equal((await rpc(ctx.base, "tools/list", {}, TOKEN)).status, 429);
    } finally {
      ctx.server.close();
    }
  });
});
