require("dotenv").config();
const { loadConfig, configWarnings } = require("./config");
const { createApp } = require("./app");

const config = loadConfig();
for (const w of configWarnings(config)) console.error(`WARNING: ${w}`);

const app = createApp(config);
app.listen(config.port, () => {
  console.log(`ServiceNow ITSM MCP server running on port ${config.port}`);
  console.log(`ServiceNow instance: ${config.instance || "(not set)"}`);
  console.log(`Auth mode: ${config.authMode}${config.authMode === "oauth" ? " (per-user bearer token pass-through)" : " (shared service account)"}`);
  console.log(`MCP endpoint: http://localhost:${config.port}/mcp`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});
