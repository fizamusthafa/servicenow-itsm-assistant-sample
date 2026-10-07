# ITSM Assistant: Copilot Studio agent (GitHub Copilot harness)

A full ITSM agent for ServiceNow, built on the **GitHub Copilot harness** (the "new harness") in Microsoft Copilot Studio.

- **Instructions** ([`agent/instructions.md`](agent/instructions.md)) hold the rules that apply to every conversation: confirm before writing, never invent records, always link.
- **Skills** ([`skills/`](skills)) hold the step-by-step ITSM procedures. The agent loads them on demand.
- **One MCP tool** connects to the ServiceNow MCP server in [`../mcp-server`](../mcp-server), hosted on Azure Container Apps. It exposes 33 ITSM tools.
- **Per-user auth:** each user signs in to ServiceNow with OAuth. The MCP server passes their token through, so ServiceNow access rules (ACLs), roles, and the audit trail apply to the real person. The server stores no shared credentials.

```
 Microsoft 365 Copilot / Teams          Azure Container Apps                ServiceNow
 or Copilot Studio preview
┌──────────────────────────┐ HTTPS  ┌─────────────────────────┐  HTTPS   ┌────────────────────┐
│ ITSM Assistant           │ ─────> │ ServiceNow ITSM MCP     │ ───────> │ Table API          │
│  GitHub Copilot harness  │  MCP + │ server (AUTH_MODE=oauth)│  same    │ Service Catalog API│
│  instructions + 9 skills │  user  │ stateless, no secrets   │  user    │ ACLs as the user   │
│  OAuth connection / user │  token │                         │  token   │                    │
└──────────────────────────┘        └─────────────────────────┘          └────────────────────┘
```

## What the agent can do

| Area | Skills | MCP tools |
|---|---|---|
| Incidents | `servicenow-incidents`, `incident-triage`, `major-incident` | `search_incidents`, `get_incident`, `create_incident`, `update_incident`, `assign_incident`, `resolve_incident`, `show_incident_dashboard` |
| Problems | `problem-management` | `search_problems`, `get_problem`, `create_problem`, `update_problem`, `link_incident_to_problem` |
| Changes | `servicenow-changes`, `change-risk-review` | `search_changes`, `get_change`, `create_change`, `update_change` |
| Requests | `service-request` | `search_catalog_items`, `get_catalog_item`, `submit_catalog_request`, `search_requested_items`, `get_requested_item` |
| Knowledge | `knowledge-lookup` | `search_knowledge`, `get_knowledge_article` |
| CMDB | used by triage, major-incident, and change-risk-review | `search_configuration_items`, `get_configuration_item` |
| People and work | `my-work-summary` | `get_my_profile`, `lookup_user`, `search_groups`, `list_group_members`, `list_my_approvals`, `respond_to_approval`, `add_work_note`, `get_record_activity` |

Every write tool is annotated `destructiveHint: true`. The instructions also require a preview and an explicit "yes" before any write.

## Prerequisites

- A ServiceNow instance. A free developer instance (PDI) works, and you need admin rights to register an OAuth app.
- An Azure subscription, the [Azure Developer CLI](https://aka.ms/azd) (`azd`), and the Azure CLI.
- A Copilot Studio environment where you can create agents on the GitHub Copilot harness. Building, testing, and running on this harness use **Copilot Credits**, and billing starts while you build, not only after you publish.
- Node.js 20+ and `zip`, to run the validation and packaging scripts locally.

---

## 1. Deploy the MCP server to Azure

From the repository root:

```bash
azd auth login
azd env new itsm-mcp
azd env set SERVICENOW_INSTANCE https://<your-instance>.service-now.com
azd up
azd provision    # enable /health probes using the deployed image after the first deploy
```

`azd up` builds the container in Azure Container Registry and provisions the following, all defined in [`../infra`](../infra):

- A Log Analytics workspace
- A container registry (admin user disabled; the app pulls with a managed identity)
- A Container Apps environment
- The container app, with `AUTH_MODE=oauth`, HTTPS-only ingress, health probes, and `minReplicas: 1` to avoid cold-start timeouts

When it finishes, note the endpoint:

```bash
azd env get-value MCP_ENDPOINT
# https://ca-snow-mcp-xxxx.<region>.azurecontainerapps.io/mcp
```

Check it:

```bash
curl https://<app-fqdn>/health                                      # {"status":"ok","authMode":"oauth",...}
curl -i -X POST https://<app-fqdn>/mcp -H 'content-type: application/json' -d '{}'   # 401 + WWW-Authenticate
```

The 401 is expected. The server refuses any request that doesn't carry a ServiceNow user token.

## 2. Register an OAuth app in ServiceNow

In ServiceNow, go to **System OAuth → Application Registry → New**, and choose **Create an OAuth API endpoint for external clients**. On newer releases this is **New Inbound Integration Experience → OAuth - Authorization code grant**.

| Field | Value |
|---|---|
| Name | `Copilot Studio ITSM Assistant` |
| Redirect URL | Copilot Studio shows this to you in step 4. Use a placeholder for now and update it afterwards. |
| Refresh Token Lifespan | e.g. `8640000` (100 days), so users aren't prompted to sign in often |
| Access Token Lifespan | `1800` (default) |

Save the record, then copy the **Client ID** and **Client Secret**.

The endpoints you'll need are:
- Authorization URL: `https://<your-instance>.service-now.com/oauth_auth.do`
- Token URL: `https://<your-instance>.service-now.com/oauth_token.do`
- Refresh URL: `https://<your-instance>.service-now.com/oauth_token.do`

What the agent can do depends on each user's ServiceNow roles:
- `itil` for working incidents, problems, and changes
- `catalog` / `snc_internal` for ordering
- An approver assignment for approvals

## 3. Create the agent

With PAC 2.11.2, `pac copilot init --authoring-mode cli-copilot --name "ITSM Assistant" --publisher-prefix snow --project-dir copilot-studio/cli-agent --environment <environment-url>` bootstraps an online agent and imports its solution. It is not a local-only scaffold when an environment is supplied. Confirm the target before running it. Instructions are stored in `settings.mcs.yml` under `configuration.agentSettings.instructions.segments`.

1. In [Copilot Studio](https://copilotstudio.microsoft.com), choose **Create → New agent**, and keep the default **GitHub Copilot harness**.
   > Agents can't move between harnesses later. If the harness picker shows *Standard*, switch it before creating the agent.
2. Set the name and description, and paste the instructions, from [`agent/agent-profile.md`](agent/agent-profile.md) and [`agent/instructions.md`](agent/instructions.md).
3. Choose a reasoning-capable model.

## 4. Add the MCP server as a tool

1. On the **Build** tab, go to **Tools → Add a tool → New tool → Model Context Protocol**.
2. Fill in:
   - **Server name:** `ServiceNow ITSM`
   - **Server description:** `ServiceNow incidents, problems, changes, catalog requests, knowledge, CMDB and approvals, acting as the signed-in user.`
   - **Server URL:** the `MCP_ENDPOINT` value from step 1
   - **Authentication:** **OAuth 2.0 → Manual**
     - Client ID / Client secret: from step 2
     - Authorization URL: `https://<instance>.service-now.com/oauth_auth.do`
     - Token URL template: `https://<instance>.service-now.com/oauth_token.do`
     - Refresh URL: `https://<instance>.service-now.com/oauth_token.do`
    - Scopes: use the scope configured on the ServiceNow registration. The newer inbound-integration UI requires one; `useraccount` preserves the signed-in user's existing permissions, but ServiceNow warns that it grants access to all resources that user can access. Prefer a dedicated API-restricted scope for production.
3. Create the tool. Copilot Studio then shows a **redirect (callback) URL**. Paste it into the **Redirect URL** of the ServiceNow OAuth app from step 2, and save.
4. Create the connection and sign in as a ServiceNow user. The tool list should now show all 33 tools.
5. In the tool's settings, make sure credentials are set to **end-user credentials**, not the maker's. That way each user signs in with their own ServiceNow account.

> Portal labels may differ slightly between Copilot Studio releases. What matters is: an MCP tool, OAuth 2.0 with manual configuration, ServiceNow's `oauth_auth.do` / `oauth_token.do` endpoints, and end-user credentials.

## 5. Upload the skills

```bash
copilot-studio/scripts/package-skills.sh        # validates, then writes copilot-studio/dist/<skill>.zip
```

On Windows, run `./copilot-studio/scripts/package-skills.ps1` from PowerShell. This uses `Compress-Archive` and does not require WSL or `zip`.

Then, on the **Build** tab, go to **Skills → Add skill → Upload a skill**, once for each zip in `copilot-studio/dist/`:

`servicenow-incidents`, `incident-triage`, `major-incident`, `servicenow-changes`, `change-risk-review`, `problem-management`, `service-request`, `knowledge-lookup`, `my-work-summary`

Each zip has `SKILL.md` at its root, plus a `references/` folder where the skill has one.

> **Deploying programmatically?** `pac copilot push` does **not** create skills: it reports success and creates nothing. For scripted deployment, use [build-copilot-studio-agents](https://github.com/RagnarPitla/build-copilot-studio-agents-V2-Aug-2026)'s `python3 tools/mcs_skills.py add --path copilot-studio/skills ...`, or Microsoft's `mcs-assistant` plugin. Either way, verify by reading the agent back. Portal upload is the documented route.

## 6. Test in the Preview pane

Open **Preview** and run the prompts in [`tests/test-prompts.md`](tests/test-prompts.md). On the first tool call you'll be asked to connect to ServiceNow, once per user.

Things to check:
- Read-only prompts run without asking for confirmation.
- Every write shows a preview and waits for "yes".
- Record numbers are links to your instance.
- Records you create show **your** ServiceNow user as *Opened by / Created by*, which proves per-user authentication is working.

## 7. Publish to Microsoft 365 Copilot and Teams

1. **Publish** the agent.
2. Go to **Channels → Microsoft 365 Copilot and Teams**, then turn on the channel and add it.
3. Share the agent with users or a security group, or submit it to your admin for org-wide availability.
4. Each user signs in to ServiceNow the first time they use a ServiceNow tool.

---

## Operations

| Task | How |
|---|---|
| Update the server | `azd deploy` |
| Logs | Azure portal → the container app → **Log stream**, or the Log Analytics workspace |
| Change instance | `azd env set SERVICENOW_INSTANCE …` then `azd provision` |
| Validate skills | `node copilot-studio/scripts/validate-skills.js`. This also runs as part of `npm test` in `mcp-server/` |
| Tear down | `azd down` |

## Security notes

- **No shared ServiceNow credentials in Azure.** The container only knows the instance URL. Each request carries the user's own OAuth access token.
- **The token is forwarded unchanged to ServiceNow.** ServiceNow validates it and applies that user's roles and ACLs. The MCP server never logs or stores it.
- **Input hardening.**
  - User-supplied values are cleaned of encoded-query separators (`^`) before they go into a ServiceNow query.
  - Record numbers and sys_ids are format-checked.
  - Every write only sends fields on an allowlist.
  - Unknown arguments are dropped.
- **`AUTH_MODE=basic`** (one shared service account) exists only for local development and the Cowork demo. Don't use it for a shared deployment.
