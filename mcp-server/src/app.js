const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createClient } = require("./servicenow");
const { createMcpServer } = require("./mcp");

const BEARER = "Bearer";

/**
 * Resolve the Authorization header to send to ServiceNow for this request.
 * Returns null when the caller is not authenticated (oauth mode only).
 */
function upstreamAuthorization(req, config) {
  if (config.authMode === "basic") {
    return "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
  }
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(req.headers.authorization || "");
  return match ? `${BEARER} ${match[1]}` : null;
}

function jsonRpcError(res, status, code, message, headers = {}) {
  res.status(status).set(headers).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function createApp(config, { fetchImpl } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Behind one reverse proxy (Azure Container Apps ingress / dev tunnel): use
  // its X-Forwarded-For so rate limits apply per client, not per proxy.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));

  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null },
  });
  const healthLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });


  // ── MCP Streamable HTTP endpoint (stateless) ──────────────────────
  app.post("/mcp", mcpLimiter, async (req, res) => {
    const authorization = upstreamAuthorization(req, config);
    if (!authorization) {
      return jsonRpcError(res, 401, -32001, "Unauthorized: a ServiceNow OAuth bearer token is required", {
        "WWW-Authenticate": `${BEARER} realm="servicenow-mcp", error="invalid_token"`,
      });
    }

    const sn = createClient({ instance: config.instance, authorization, fetchImpl });
    const server = createMcpServer({ sn, config });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      if (req.accepts("application/json")) {
        req.headers.accept = "application/json, text/event-stream";
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err.message);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });

  // Stateless server: no SSE stream or session to resume/terminate.
  const methodNotAllowed = (_req, res) => jsonRpcError(res, 405, -32000, "Method not allowed", { Allow: "POST" });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // Health check. In basic mode it validates ServiceNow connectivity with the
  // service account; in oauth mode there is no server-side credential, so it
  // only reports liveness.
  app.get("/health", healthLimiter, async (_req, res) => {
    if (config.authMode !== "basic") {
      return res.json({ status: "ok", authMode: config.authMode, instance: config.instance });
    }
    try {
      const sn = createClient({ instance: config.instance, authorization: upstreamAuthorization(null, config), fetchImpl });
      await sn.list("incident", { fields: "number", limit: 1, displayValue: false });
      res.json({ status: "ok", authMode: config.authMode, servicenow: "connected", instance: config.instance });
    } catch (err) {
      res.status(503).json({ status: "error", message: err.message });
    }
  });

  return app;
}

module.exports = { createApp, upstreamAuthorization };
