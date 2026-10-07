const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} = require("@modelcontextprotocol/sdk/types.js");
const { toolsByName, toolDefinitions, uiResources } = require("./tools");
const pkg = require("../package.json");

const MAX_STRING = 10000;

class ValidationError extends Error {}

/**
 * Validate and normalise tool arguments against the tool's JSON schema.
 * Unknown properties are dropped so handlers only ever see allow-listed input.
 */
function validateArgs(schema, rawArgs) {
  const args = rawArgs == null ? {} : rawArgs;
  if (typeof args !== "object" || Array.isArray(args)) throw new ValidationError("Arguments must be an object");
  const props = schema.properties || {};
  const out = {};

  for (const [key, spec] of Object.entries(props)) {
    let v = args[key];
    if (v === undefined || v === null || v === "") continue;
    switch (spec.type) {
      case "string":
        if (typeof v === "number" || typeof v === "boolean") v = String(v);
        if (typeof v !== "string") throw new ValidationError(`"${key}" must be a string`);
        if (v.length > MAX_STRING) throw new ValidationError(`"${key}" is too long (max ${MAX_STRING} characters)`);
        if (spec.enum && !spec.enum.includes(v)) throw new ValidationError(`"${key}" must be one of: ${spec.enum.join(", ")}`);
        break;
      case "integer": {
        const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
        if (!Number.isInteger(n)) throw new ValidationError(`"${key}" must be an integer`);
        if (spec.minimum !== undefined && n < spec.minimum) throw new ValidationError(`"${key}" must be >= ${spec.minimum}`);
        if (spec.maximum !== undefined && n > spec.maximum) throw new ValidationError(`"${key}" must be <= ${spec.maximum}`);
        v = n;
        break;
      }
      case "boolean":
        if (v === "true") v = true;
        else if (v === "false") v = false;
        if (typeof v !== "boolean") throw new ValidationError(`"${key}" must be a boolean`);
        break;
      case "object": {
        if (typeof v !== "object" || Array.isArray(v)) throw new ValidationError(`"${key}" must be an object`);
        const obj = {};
        for (const [k, val] of Object.entries(v)) {
          if (!/^[A-Za-z0-9_]{1,80}$/.test(k)) throw new ValidationError(`"${key}" has an invalid key "${k}"`);
          const s = typeof val === "string" ? val : val == null ? "" : String(val);
          if (s.length > MAX_STRING) throw new ValidationError(`"${key}.${k}" is too long`);
          obj[k] = s;
        }
        v = obj;
        break;
      }
      default:
        break;
    }
    out[key] = v;
  }

  for (const key of schema.required || []) {
    if (out[key] === undefined) throw new ValidationError(`Missing required argument "${key}"`);
  }
  return out;
}

function textResult(value, isError = false) {
  const result = { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
  if (isError) result.isError = true;
  return result;
}

/**
 * Build an MCP server bound to one ServiceNow client (i.e. one caller's credentials).
 * A fresh instance is created per HTTP request (stateless Streamable HTTP).
 */
function createMcpServer(ctx) {
  const server = new Server(
    { name: "servicenow-itsm-mcp-server", version: pkg.version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "ServiceNow ITSM tools (incidents, changes, problems, requests, knowledge, CMDB, approvals). All calls run as the signed-in user. Confirm with the user before any tool marked destructive.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = toolsByName.get(name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    try {
      const args = validateArgs(tool.inputSchema, rawArgs);
      const result = await tool.handler(ctx, args);
      // Widget-enabled tools return a full CallToolResult shape.
      if (result && result.toolResult) return result.toolResult;
      if (result && result.error && Object.keys(result).length === 1) return textResult(result, true);
      return textResult(result);
    } catch (err) {
      return textResult({ error: err.message }, true);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: uiResources.map(({ text, ...r }) => r),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const res = uiResources.find((r) => r.uri === request.params.uri);
    if (!res) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    return { contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text, _meta: { ui: {} } }] };
  });

  return server;
}

module.exports = { createMcpServer, validateArgs, ValidationError };
