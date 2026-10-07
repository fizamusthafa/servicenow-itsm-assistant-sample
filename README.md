# ServiceNow ITSM Assistant sample

This source sample lets a customer build their own Copilot Studio ITSM Assistant with a ServiceNow MCP server, nine skills, per-user OAuth, and concise instructions. It is a guided setup, not an importable solution or access to the author's agent.

Knowledge answers return article text and source links. Screenshot search, inline article images, and the archived Teams audio demo are excluded.

## 1. Check prerequisites

- Node.js 20+, Git, [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), and [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd).
- An Azure subscription with deployment and role-assignment permissions for Container Apps, Container Registry, Log Analytics, and managed identities. Hosting incurs charges.
- A Copilot Studio environment with the GitHub Copilot harness and Copilot Credits billing enabled. Availability and portal labels can vary.
- A test ServiceNow instance with synthetic records and admin access to register an OAuth application. End users need appropriate roles and ACL permissions.

Do not start with production records.

## 2. Clone and test

```powershell
git clone https://github.com/fizamusthafa/servicenow-itsm-assistant-sample.git
cd servicenow-itsm-assistant-sample
cd mcp-server
npm ci
npm test
cd ..
node copilot-studio/scripts/validate-skills.js
```

The 42 automated tests use mocked ServiceNow responses, not your live instance.

## 3. Deploy the MCP server

From the repository root, select your own subscription and region when prompted:

```powershell
az login
azd auth login
azd env new itsm-sample
azd env set SERVICENOW_INSTANCE https://YOUR-INSTANCE.service-now.com
azd up
azd provision
azd env get-value MCP_ENDPOINT
```

The second provision enables health probes after the placeholder image is replaced. Save the returned HTTPS endpoint ending in `/mcp` for step 6. The deployed server uses `AUTH_MODE=oauth`; do not use shared basic credentials for a shared deployment.

Verify using the hostname from your endpoint:

```powershell
curl.exe https://YOUR-APP-HOST/health
curl.exe -i -X POST https://YOUR-APP-HOST/mcp -H "Content-Type: application/json" -d "{}"
```

Expect health status `ok` and anonymous MCP status `401`. OAuth-mode health does not prove ServiceNow connectivity.

## 4. Register ServiceNow OAuth

Open **System OAuth > Application Registry > New** and create an OAuth API endpoint for external clients. Some releases show **New Inbound Integration Experience > OAuth - Authorization code grant**.

Name it `ITSM Assistant sample`. Save its client ID and secret securely. Update the callback URL with the exact Copilot Studio URL from step 6 before connecting.

| Setting | URL |
|---|---|
| Authorization | `https://YOUR-INSTANCE.service-now.com/oauth_auth.do` |
| Token | `https://YOUR-INSTANCE.service-now.com/oauth_token.do` |
| Refresh | `https://YOUR-INSTANCE.service-now.com/oauth_token.do` |

Use the scope configured on your registration. `useraccount` preserves the user's existing access but is broad; review an API-restricted scope before production. Never commit secrets or paste them into instructions.

## 5. Create the agent

1. Open [Copilot Studio](https://copilotstudio.microsoft.com) in your target environment.
2. Create an agent using the **GitHub Copilot harness**. Confirm it before creating; do not substitute Standard if this harness is unavailable.
3. Name it `ITSM Assistant` and describe it as `ServiceNow ITSM support acting as the signed-in user`.
4. Paste [the instructions](copilot-studio/agent/instructions.md) into its instructions field and choose an available reasoning-capable model.
5. Turn **memory on** in the agent settings. Review retention requirements. Memory is not an identity source and must not store profiles, tickets, secrets, or personal data.

## 6. Connect the MCP tool

1. Go to **Tools > Add a tool > New tool > Model Context Protocol**.
2. Use name `ServiceNow ITSM` and your `MCP_ENDPOINT` from step 3.
3. Choose **OAuth 2.0 > Manual** and enter your client ID, secret, endpoints, and scope.
4. Copy the callback URL displayed by Studio into the ServiceNow registration and save it.
5. Create the connection and sign in with your own ServiceNow account.
6. Enable **end-user credentials**, not maker credentials. Verify all 33 tools appear.

Each user must connect and consent for their own account. ServiceNow enforces that user's permissions and audit identity.

## 7. Upload the skills

From PowerShell at the repository root:

```powershell
./copilot-studio/scripts/package-skills.ps1
```

For Bash use `bash copilot-studio/scripts/package-skills.sh`. In Studio, open **Skills > Add skill > Upload a skill** and upload each ZIP from `copilot-studio/dist`:

`servicenow-incidents`, `incident-triage`, `major-incident`, `servicenow-changes`, `change-risk-review`, `problem-management`, `service-request`, `knowledge-lookup`, `my-work-summary`.

Verify all nine appear. The script packages skills but does not upload them.

## 8. Test in Preview

Start a fresh one-to-one conversation:

- "Hi." Verify `get_my_profile` runs before a personalized answer.
- "What approvals are waiting for me?"
- "My VPN won't connect. Can you help?" Verify knowledge is checked before a ticket is offered.
- "Show me the open high-priority incidents."
- "Create a test incident for a printer that keeps jamming." Verify a preview appears and no write happens until explicit approval.

Use synthetic records. Decline one write, approve a separate test write, and inspect the ServiceNow audit identity. Repeat with two limited-role accounts to check isolation and ACL failures. Test token revocation and reconnection. See [additional test prompts](copilot-studio/tests/test-prompts.md).

## 9. Publish and share

Publish, add the **Microsoft 365 Copilot and Teams** channel, and share with users or a security group in your tenant. Recheck that memory is on. Each user needs the relevant licensing, agent access, and their own ServiceNow connection.

Customers in another tenant should follow these steps in their own tenant. Sharing an agent link does not replace tenant setup.

## Troubleshooting

| Symptom | Check |
|---|---|
| OAuth fails | Exact callback URL, hostname, client settings, scope |
| MCP returns 401 | Reconnect the end user's ServiceNow account |
| ServiceNow returns 403 | Roles, ACLs, and scope; do not bypass them |
| Tools unreachable | Endpoint ends in `/mcp`, healthy app, credentials enabled |
| Wrong user's records | End-user credentials and `get_my_profile` output |
| Skills missing | Upload all nine ZIPs and reopen the skills list |

Use `azd deploy` for server updates. Use `azd down` to remove sample Azure resources when finished; review the deletion prompt. Keep `.azure` state private.

## Before sharing beyond a demo

Run `npm ci` and `npm test` in `mcp-server`, then validate the skills. With two distinct, limited-role ServiceNow users, verify profile isolation, ACL-denied reads and writes, reconnection after token revocation, and explicit confirmation before a synthetic write. Confirm no write occurs when approval is declined.

This sample has local automated coverage. Cross-tenant installation and the full live restricted-role, revocation, and write acceptance suite have not been certified. Instructions are model-driven safeguards, not a server-enforced approval gate. Review table access, OAuth scopes, audit trails, and data handling before production use.

No deployment state, tenant-bound agent export, live OAuth connections, credentials, or demo captures are included. Use fresh secrets and rotate any exposed credentials. Review costs, networking, audit logs, data retention, and model behavior before production. CMDB status is recorded evidence, not a live health check.

See [detailed setup notes](copilot-studio/README.md) and the [MIT license](LICENSE).