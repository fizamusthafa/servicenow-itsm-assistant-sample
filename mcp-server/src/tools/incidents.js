const fs = require("fs");
const path = require("path");
const { q, assertNumber, clampLimit, pick } = require("../servicenow");
const { str, limitProp, notFound, withLinks } = require("./util");

// ── MCP App (widget) resource ───────────────────────────────────────
// SEP-1865 UI resource served to Cowork via resources/read.
const DASHBOARD_URI = "ui://servicenow/incident-dashboard.html";
const DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, "..", "widgets", "incident-dashboard.html"), "utf8");
const uiResources = [
  {
    uri: DASHBOARD_URI,
    name: "ServiceNow Incident Dashboard",
    description: "Interactive incident dashboard with priority, state, and assignee at a glance.",
    mimeType: "text/html;profile=mcp-app",
    text: DASHBOARD_HTML,
  },
];

// ── Auto-routing: incident category → IT assignment group ───────────
// Group names verified against the connected instance's sys_user_group table.
const ROUTING_MAP = {
  network: "Network",
  hardware: "Hardware",
  software: "Software",
  database: "Database",
  "inquiry / help": "Service Desk",
  inquiry: "Service Desk",
  inquiry_help: "Service Desk",
};
const DEFAULT_GROUP = "Service Desk";

function routeGroupForCategory(category) {
  const key = String(category || "").trim().toLowerCase();
  return ROUTING_MAP[key] || DEFAULT_GROUP;
}

const INCIDENT_FIELDS = "sys_id,number,short_description,priority,state,assigned_to,assignment_group,opened_at,category,cmdb_ci";

const searchProps = {
  state: str("Filter by state number: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed"),
  priority: str("Filter by priority: 1 (Critical) through 5 (Planning)"),
  assigned_to: str("Filter by assignee display name (contains match)"),
  assignment_group: str("Filter by assignment group name (contains match)"),
  cmdb_ci: str("Filter by configuration item name (contains match)"),
  query: str("Free-text search in short_description"),
  active_only: { type: "boolean", description: "Only return active (not resolved/closed) incidents" },
  limit: limitProp,
};

// ── Shared incident search (used by tool + widget dashboard) ────────
async function fetchIncidents(sn, args) {
  const parts = [];
  if (args.state) parts.push(`state=${q(args.state)}`);
  if (args.priority) parts.push(`priority=${q(args.priority)}`);
  if (args.assigned_to) parts.push(`assigned_to.nameLIKE${q(args.assigned_to)}`);
  if (args.assignment_group) parts.push(`assignment_group.nameLIKE${q(args.assignment_group)}`);
  if (args.cmdb_ci) parts.push(`cmdb_ci.nameLIKE${q(args.cmdb_ci)}`);
  if (args.query) parts.push(`short_descriptionLIKE${q(args.query)}`);
  if (args.active_only) parts.push("active=true");
  parts.push("ORDERBYDESCsys_created_on");
  const rows = await sn.list("incident", {
    query: parts.join("^"),
    fields: INCIDENT_FIELDS,
    limit: clampLimit(args.limit),
  });
  return withLinks(sn, "incident", rows);
}

async function lookup(sn, number, fields = "sys_id,number") {
  return sn.findByNumber("incident", assertNumber(number), { fields });
}

const tools = [
  {
    name: "show_incident_dashboard",
    description:
      "Open an interactive ServiceNow incident dashboard. Use when the user wants to see, browse, triage, or get an overview of incidents. Accepts the same optional filters as search_incidents.",
    annotations: { readOnlyHint: true, title: "Incident Dashboard" },
    _meta: { ui: { resourceUri: DASHBOARD_URI, visibility: ["model", "app"] } },
    inputSchema: { type: "object", properties: searchProps },
    async handler({ sn }, args) {
      const incidents = await fetchIncidents(sn, args);
      const summary = incidents
        .slice(0, 10)
        .map((i) => `${i.number} [${i.priority}] ${i.state} — ${i.short_description}`)
        .join("\n");
      // Widget-enabled result: compact structuredContent for the UI +
      // a text summary so the agent (and non-widget hosts) still get the data.
      return {
        toolResult: {
          content: [
            {
              type: "text",
              text: incidents.length === 0 ? "No incidents matched the filter." : `${incidents.length} incident(s):\n${summary}`,
            },
          ],
          structuredContent: {
            instance: sn.instance,
            instanceLabel: (sn.instance || "").replace(/^https?:\/\//, ""),
            count: incidents.length,
            incidents,
          },
        },
      };
    },
  },
  {
    name: "search_incidents",
    description:
      "Search ServiceNow incidents by state, priority, assignee, assignment group, configuration item, or keyword. Returns up to 20 results (newest first) with record links.",
    annotations: { readOnlyHint: true, title: "Search Incidents" },
    inputSchema: { type: "object", properties: searchProps },
    handler: ({ sn }, args) => fetchIncidents(sn, args),
  },
  {
    name: "get_incident",
    description: "Get full details of a single ServiceNow incident by its number (e.g. INC0010001).",
    annotations: { readOnlyHint: true, title: "Get Incident" },
    inputSchema: {
      type: "object",
      properties: { number: str("Incident number, e.g. INC0010001") },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const row = await sn.findByNumber("incident", assertNumber(args.number));
      if (!row) return notFound("Incident", args.number);
      return { ...row, url: sn.recordUrl("incident", row.sys_id) };
    },
  },
  {
    name: "create_incident",
    description:
      "Create a new incident in ServiceNow. Only call after the user has confirmed a preview of the incident.",
    annotations: { destructiveHint: true, title: "Create Incident" },
    inputSchema: {
      type: "object",
      properties: {
        short_description: str("Brief summary"),
        description: str("Full details"),
        category: str("Category: hardware, software, network, inquiry, database"),
        subcategory: str("Subcategory (optional)"),
        urgency: str("1 (High), 2 (Medium), 3 (Low)"),
        impact: str("1 (High), 2 (Medium), 3 (Low)"),
        assignment_group: str("Assignment group display name"),
        caller_id: str("Caller user name or sys_id"),
        cmdb_ci: str("Affected configuration item name or sys_id"),
      },
      required: ["short_description"],
    },
    async handler({ sn }, args) {
      const body = pick(args, [
        "short_description",
        "description",
        "category",
        "subcategory",
        "urgency",
        "impact",
        "assignment_group",
        "caller_id",
        "cmdb_ci",
      ]);
      const r = await sn.insert("incident", body);
      return {
        number: r.number,
        sys_id: r.sys_id,
        state: r.state,
        url: sn.recordUrl("incident", r.sys_id),
        message: `Incident ${r.number} created successfully`,
      };
    },
  },
  {
    name: "update_incident",
    description:
      "Update fields on an existing ServiceNow incident (assignee, priority, state, impact/urgency, work notes, customer comments).",
    annotations: { destructiveHint: true, title: "Update Incident" },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Incident number"),
        assigned_to: str("New assignee sys_id or name"),
        assignment_group: str("New assignment group name or sys_id"),
        priority: str("New priority (1-5)"),
        impact: str("New impact (1-3)"),
        urgency: str("New urgency (1-3)"),
        state: str("New state number: 1=New, 2=In Progress, 3=On Hold"),
        category: str("New category"),
        subcategory: str("New subcategory"),
        cmdb_ci: str("Affected configuration item name or sys_id"),
        short_description: str("Revised short description"),
        work_notes: str("Add an internal work note"),
        comments: str("Add a customer-visible comment"),
      },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const rec = await lookup(sn, args.number);
      if (!rec) return notFound("Incident", args.number);
      const body = pick(args, [
        "assigned_to",
        "assignment_group",
        "priority",
        "impact",
        "urgency",
        "state",
        "category",
        "subcategory",
        "cmdb_ci",
        "short_description",
        "work_notes",
        "comments",
      ]);
      if (Object.keys(body).length === 0) return { error: "No fields to update were provided." };
      const r = await sn.patch("incident", rec.sys_id, body);
      return {
        number: r.number,
        url: sn.recordUrl("incident", rec.sys_id),
        message: `Incident ${rec.number} updated`,
        updated_fields: Object.keys(body),
      };
    },
  },
  {
    name: "resolve_incident",
    description: "Resolve a ServiceNow incident with a close code and close notes. Only call after the user has confirmed.",
    annotations: { destructiveHint: true, title: "Resolve Incident" },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Incident number"),
        close_notes: str("Resolution / close notes"),
        close_code: str("Solved (Permanently), Solved (Work Around), Not Solved, Closed/Resolved by Caller"),
      },
      required: ["number", "close_notes"],
    },
    async handler({ sn }, args) {
      const rec = await lookup(sn, args.number);
      if (!rec) return notFound("Incident", args.number);
      const r = await sn.patch("incident", rec.sys_id, {
        state: "6",
        close_notes: args.close_notes,
        close_code: args.close_code || "Solved (Permanently)",
      });
      return {
        number: r.number,
        state: "Resolved",
        url: sn.recordUrl("incident", rec.sys_id),
        message: `Incident ${rec.number} resolved`,
      };
    },
  },
  {
    name: "assign_incident",
    description:
      "Route an incident to the correct IT assignment group. If 'group' is omitted, the group is chosen automatically from the incident's category (Network→Network, Hardware→Hardware, Software→Software, Database→Database, Inquiry/Help→Service Desk).",
    annotations: { destructiveHint: true, title: "Assign Incident" },
    _meta: { ui: { visibility: ["model", "app"] } },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Incident number, e.g. INC0010003"),
        group: str(
          "Optional assignment group display name (e.g. Network, Hardware, Software, Database, Service Desk). If omitted, auto-routed from the incident category."
        ),
      },
      required: ["number"],
    },
    async handler({ sn }, args) {
      // Look up sys_id + category (category needed for auto-routing).
      const rec = await lookup(sn, args.number, "sys_id,number,category");
      if (!rec) return notFound("Incident", args.number);
      const category = rec.category;
      const auto = !args.group;
      const group = args.group || routeGroupForCategory(category);
      // sysparm_input_display_value=true so the group display name resolves to its sys_id.
      const r = await sn.patch("incident", rec.sys_id, { assignment_group: group }, { inputDisplayValue: true });
      const applied =
        r.assignment_group && typeof r.assignment_group === "object" ? r.assignment_group.display_value : r.assignment_group;
      return {
        number: r.number,
        category,
        assignment_group: applied || group,
        auto_routed: auto,
        url: sn.recordUrl("incident", rec.sys_id),
        message: `Incident ${rec.number} assigned to ${applied || group}${auto ? ` (auto-routed from category "${category}")` : ""}`,
      };
    },
  },
];

module.exports = { tools, uiResources, routeGroupForCategory, fetchIncidents, DASHBOARD_URI };
