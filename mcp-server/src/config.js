// ── Runtime configuration ───────────────────────────────────────────
// AUTH_MODE=oauth  → every MCP request must carry the signed-in user's
//                    ServiceNow OAuth access token in the standard HTTP
//                    Authorization header. It is forwarded to ServiceNow so ACLs
//                    and the audit trail apply to the real user. No shared secret.
// AUTH_MODE=basic  → a single service account (SERVICENOW_USERNAME/PASSWORD)
//                    is used for every request. Local dev / Cowork demo only.

function loadConfig(env = process.env) {
  const instance = (env.SERVICENOW_INSTANCE || "").replace(/\/+$/, "");
  const authMode = (env.AUTH_MODE || "basic").trim().toLowerCase();

  if (!["oauth", "basic"].includes(authMode)) {
    throw new Error(`Invalid AUTH_MODE "${env.AUTH_MODE}". Use "oauth" or "basic".`);
  }
  if (instance && !/^https:\/\/[a-z0-9.-]+$/i.test(instance)) {
    throw new Error("SERVICENOW_INSTANCE must be an https:// origin, e.g. https://dev12345.service-now.com");
  }

  return {
    instance,
    authMode,
    username: env.SERVICENOW_USERNAME,
    password: env.SERVICENOW_PASSWORD,
    port: Number(env.PORT) || 3001,
    // Per client IP. Copilot Studio calls originate from a shared pool, so keep this generous.
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 600,
  };
}

function configWarnings(config) {
  const warnings = [];
  if (!config.instance) warnings.push("SERVICENOW_INSTANCE is not set");
  if (config.authMode === "basic" && (!config.username || !config.password)) {
    warnings.push("AUTH_MODE=basic but SERVICENOW_USERNAME / SERVICENOW_PASSWORD are not set");
  }
  return warnings;
}

module.exports = { loadConfig, configWarnings };
